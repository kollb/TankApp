"""Read-only live data and public projections. No price API calls, no demo fallback."""

import datetime as dt
import hashlib
import json
import math
import os
import threading
import time
from pathlib import Path
from typing import Any

import export_influx as influx
from polling_plan import validate_sets

UTC = dt.timezone.utc
FUELS = {"e10", "e5", "diesel"}

try:
    from zoneinfo import ZoneInfo

    BERLIN_TZ = ZoneInfo("Europe/Berlin")
except Exception:  # pragma: no cover
    BERLIN_TZ = UTC


# --- Straßen-Distanzen: Request-Pfad ohne Netzwerk --------------------------
#
# Anker- und Stationskoordinaten ändern sich nur mit polling.json, und die
# gerouteten Ergebnisse liegen persistent in runtime/road_route_cache.json.
# Bis 0.24.0 hat JEDER Request (inklusive /health) die Distanzen neu
# abgeleitet: frisches RoadRouter-Objekt je Anker und je unbekanntem Paar
# eine Live-OSRM-Anfrage. Auf dem NAS, wo Internet/DNS wackelig sind, deckt
# der Socket-Timeout (4 s) die DNS-Auflösung nicht ab — eine einzige
# hängende Anfrage hat dann alle Requests hinter dem globalen Lock gekettet.
# Gemessen: /health 54 s, /stations 67 s. Jetzt:
#   * Request-Pfad: liest nur den lokalen Routen-Cache. Unbekannte Paare
#     bekommen sofort die Luftlinie ('air', nie erfunden) — niemand wartet.
#   * OSRM-Abholung: Daemon-Thread im Hintergrund mit hartem Wanduhr-Budget
#     und Cooldown. Der nächste Request nutzt die neuen Einträge
#     (Datei-mtime entwerten das Metadata-Memo) — ohne Warten.
#   * TANKAPP_OSRM_URL: eigener OSRM-Server (empfohlen: NAS-Docker,
#     LAN-only, ohne Drittanbieter-Demo). Leer = RoadRouter-Default
#     (öffentlicher Demo-Server). TANKAPP_OSRM=0: kein Netz, nur Luftlinie.
ROUTE_REFRESH_DEADLINE_S = 20.0  # Wanduhr-Budget je Hintergrund-Abholung
ROUTE_REFRESH_COOLDOWN_S = 300.0  # Mindestabstand zwischen Hintergrund-Versuchen
META_TTL_S = 30.0  # Backstop für das Metadata-Memo (grobes mtime, z. B. NAS)

_META_LOCK = threading.Lock()
_META_MEMO: dict[str, Any] = {"key": None, "value": None, "at": 0.0}
# Nur der Kick-Zustand (kurz, keine IO unter dem Lock) — der Request-Pfad
# darf nie auf einen langsamen Hintergrund-Fetch warten.
_ROUTE_REFRESH_LOCK = threading.Lock()
_ROUTE_REFRESH: dict[tuple[float, float], dict[str, Any]] = {}
# Serialisiert die Routen-Cache-Datei-IO (laden → holen → ersetzen): zwei
# Anker dürfen sich keine Einträge wegüberschreiben. Halten nur die
# Hintergrund-Threads (Warten dort ist unkritisch, der Request-Pfad nicht).
_ROAD_CACHE_LOCK = threading.Lock()


def _osrm_enabled() -> bool:
    """TANKAPP_OSRM: 1 (Default) = Straßen-Distanzen via OSRM; 0 = Luftlinie."""
    return os.environ.get("TANKAPP_OSRM", "1") not in {"0", "off", "false"}


def _osrm_base_url() -> str | None:
    """TANKAPP_OSRM_URL, z. B. eigener OSRM auf dem NAS (http://nas:5000)."""
    return (os.environ.get("TANKAPP_OSRM_URL") or "").strip() or None


def _route_key(anchor, lat, lon) -> str:
    """Derselbe Schlüssel wie road_route._key (Profil 'car', 5 Nachkommastellen)."""
    return f"car|{anchor[0]:.5f},{anchor[1]:.5f}|{lat:.5f},{lon:.5f}"


def _kick_route_refresh(anchor, missing_targets, cache_path):
    """Debounce: höchstens ein laufender Fetch je Anker + Cooldown bei Fehler.

    Der Thread ist Daemon mit hartem Wanduhr-Budget; der Aufrufer wartet nie
    — auch nicht auf die Datei-Locks, die der Fetch hält. Schlägt die
    Abholung fehl (kein Internet), wird nichts geschrieben und der Cooldown
    greift — der nächste Request wird nicht langsamer. Ein erfolgreicher
    Fetch setzt keinen Cooldown: Fehlen danach wieder Einträge (z. B.
    überschrieben durch den Fetch eines anderen Ankers), darf sofort erneut
    geholt werden.
    """
    key = (float(anchor[0]), float(anchor[1]))
    now = time.monotonic()
    with _ROUTE_REFRESH_LOCK:
        state = _ROUTE_REFRESH.get(key)
        if state is not None:
            if state["thread"].is_alive():
                return
            failed_at = state["failed_at"]
            if failed_at is not None and now - failed_at < ROUTE_REFRESH_COOLDOWN_S:
                return
        thread = threading.Thread(
            target=_run_route_refresh,
            args=(anchor, missing_targets, cache_path, key),
            daemon=True,
            name=f"tankapp-route-refresh-{key[0]:.4f},{key[1]:.4f}",
        )
        _ROUTE_REFRESH[key] = {"thread": thread, "started": now, "failed_at": None}
    thread.start()


def _run_route_refresh(anchor, missing_targets, cache_path, key):
    """Holt fehlende Straßen-Routen im Hintergrund in die Cache-Datei.

    Lohnt sich nur, weil der Request-Pfad nie darauf wartet: Der nächste
    Request sieht die neue Datei-mtime, leitet die Metadaten neu ab und
    liefert 'road' ohne weiteren Netz-Call. Hartes Wanduhr-Budget
    (``ROUTE_REFRESH_DEADLINE_S``): Danach wird der Arbeitsthread verworfen
    (Daemon — sein spätes Ergebnis landet trotzdem atomar in der Datei) und
    der Anker geht in den Fehler-Cooldown.
    """
    try:
        from road_route import RoadRouter
    except ImportError:
        return
    todo = [tuple(coords) for coords in missing_targets]
    result = {"ok": None}

    def work():
        with _ROAD_CACHE_LOCK:
            try:
                router = RoadRouter(
                    mode="driving",
                    base_url=_osrm_base_url(),
                    cache_path=cache_path,
                    timeout=4,
                    quiet=True,
                    circuity=1.0,
                )
                # Gegen die frische Datei-Cache verifizieren: Der Fetch eines
                # anderen Ankers kann die Einträge inzwischen gefüllt haben.
                pending = [
                    coords
                    for coords in todo
                    if _route_key(anchor, *coords) not in router.cache
                ]
                if not pending:
                    result["ok"] = True
                    return
                # Socket-Timeout je Call Richtung Budget verkürzen. Die
                # DNS-Auflösung unterliegt ihm NICHT — die harte Wanduhr-
                # Deadline unten ist darum der eigentliche Stopp.
                router.timeout = max(
                    1.0, min(router.timeout, ROUTE_REFRESH_DEADLINE_S / 2.0)
                )
                router.routes_from(anchor[0], anchor[1], pending, want_duration=False)
                # Nur echte OSRM-Antworten landen in der Datei (misses);
                # Fallback-Ziele fehlen weiter → nächster Versuch.
                result["ok"] = router.misses > 0
            except Exception:
                # Kein Netz / kranke Antwort: nichts geschrieben; nächster
                # Versuch erst nach dem Cooldown.
                result["ok"] = False

    self_thread = threading.current_thread()
    worker = threading.Thread(target=work, daemon=True)
    worker.start()
    worker.join(timeout=ROUTE_REFRESH_DEADLINE_S)
    with _ROUTE_REFRESH_LOCK:
        state = _ROUTE_REFRESH.get(key)
        # Nur unseren eigenen Zustand annotieren — ein späterer Kick
        # könnte den Eintrag inzwischen ersetzt haben.
        if state is not None and state["thread"] is self_thread:
            if worker.is_alive() or result["ok"] is False:
                state["failed_at"] = time.monotonic()


# B7-Revalidierung: /overview wird nur neu berechnet, wenn sich die
# zugrunde liegenden Daten geändert haben ODER die Uhr die
# Revalidierungsgrenze überschritten hat. Das „due“-Status der Episoden und
# die Fenster-/Stundenlogik in decide hängen von der Uhr ab (Minuten-
# Granularität), deshalb trägt die Datenversion ein grobes Uhrzeit-Fenster —
# uhrzeitabhängiger Inhalt ist höchstens OVERVIEW_REVALIDATE_SECONDS alt.
# Dafür wird ein Refresh mit gleichem Datenstand zu einem 304 (oder Cache-
# Treffer) statt einer 5–10-s-Neuberechnung.
OVERVIEW_REVALIDATE_SECONDS = 60


def _file_stamp(path) -> str:
    """mtime:Größe als Versions-Anteil — „absent“ ohne Datei, kein Fehler."""
    try:
        stamp = path.stat()
        return f"{int(stamp.st_mtime)}:{stamp.st_size}"
    except (OSError, ValueError):
        return "absent"


def data_version(settings, clock) -> str:
    """Billiges Datenstands-Signal für die /overview-Revalidierung.

    Nur Datei-Stats, keine InfluxDB-Queries — der Revalidierungspfad muss
    nicht teurer sein als ein Cache-Treffer. Die Overview-Antwort kann sich
    nur ändern, wenn sich eine ihrer Quellen geändert hat:
      - Collector-Heartbeat: letzter Tankerkönig-Poll (Token-Bucket:
        höchstens 1×/300 s) → neue Preise in InfluxDB
      - Engine-/Selektions-Artefakte: neuer Modelllauf
      - Feedback-Store: neue Belege
      - Polling-Set: geänderter Stations-Mix
    plus das Uhrzeit-Fenster (siehe OVERVIEW_REVALIDATE_SECONDS).
    """
    from . import collector_status

    heartbeat = collector_status.nas_heartbeat(settings)
    hb_ts = str(heartbeat.get("timestamp") or "none") if heartbeat else "none"
    local_ts = "none"
    poll_dir_env = os.environ.get("TANKAPP_POLL_DIR")
    candidates = (
        [Path(poll_dir_env)]
        if poll_dir_env
        else [
            settings.data / "poll",
            settings.runtime / "poll",
            Path("/dev/shm/tankapp"),
        ]
    )
    for candidate in candidates:
        try:
            if not candidate.is_dir():
                continue
        except OSError:
            continue
        local = collector_status.local_heartbeat(candidate)
        if local and local.get("timestamp"):
            local_ts = str(local["timestamp"])
            break
    tick = int(clock().timestamp() // OVERVIEW_REVALIDATE_SECONDS)
    raw = "|".join(
        (
            f"hb:{hb_ts}:{_file_stamp(settings.runtime / 'collector' / 'heartbeat.json')}",
            f"local:{local_ts}",
            f"engine:{_file_stamp(settings.runtime / 'engine' / 'current.json')}",
            f"selection:{_file_stamp(settings.runtime / 'selection' / 'current.json')}",
            f"feedback:{_file_stamp(settings.runtime / 'feedback' / 'store.json')}",
            f"polling:{_file_stamp(settings.polling)}",
            f"tick:{tick}",
        )
    )
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def haversine_km(lat1, lon1, lat2, lon2):
    """Luftlinie als Fallback, wenn keine Straßenroute vorliegt."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    inner = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    )
    return 6371.0 * 2 * math.asin(math.sqrt(inner))


def driving_km(anchor, targets, cache_path):
    """Fahrstrecke Anker → Stationen (OSRM). Request-Pfad: nur lokale Cache.

    targets: list[(lat, lon)]. Rückgabe: list[(km, 'road'|'air')].
    'road' für alle Paare, die im Routen-Cache liegen (echte OSRM-Antworten);
    'air' (Luftlinie, nie erfunden) für den Rest — ohne auf das Netz zu
    warten. Fehlende Routen holt :func:`_kick_route_refresh` im Hintergrund,
    damit kein Request — erst recht kein Docker-Healthcheck-/health — von
    der Internet-Lage des NAS abhängt. Der Anker bleibt intern; nur
    abgeleitete Kilometer verlassen die Funktion.
    """
    if not targets:
        return []
    air = [(round(haversine_km(*anchor, lat, lon), 1), "air") for lat, lon in targets]
    if not _osrm_enabled():
        return air
    try:
        from road_route import RoadRouter
    except ImportError:
        return air
    try:
        router = RoadRouter(
            mode="driving",
            base_url=_osrm_base_url(),
            cache_path=cache_path,
            timeout=4,
            quiet=True,
            circuity=1.0,
        )
    except Exception:
        # Cache-Datei unreadable/ungeeignet: Luftlinie, kein Request-Abbruch.
        return air
    out = []
    missing = []
    for i, (lat, lon) in enumerate(targets):
        hit = router.cache.get(_route_key(anchor, lat, lon))
        if hit is not None:
            out.append((round(float(hit["dist_km"]), 1), "road"))
        else:
            out.append(air[i])
            missing.append((lat, lon))
    if missing:
        _kick_route_refresh(anchor, missing, cache_path)
    return out


def read_json(path, default=None):
    try:
        if path.stat().st_size > 10_000_000:
            return default
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return default


def _road_cache_file(settings):
    cache_dir = getattr(settings, "runtime", None)
    return (cache_dir / "road_route_cache.json") if cache_dir else None


def _metadata_stamp(settings, cache_file) -> str:
    """Billige Datenstands-Variante für das Memo: nur stat, kein Parse.

    Polling-Datei (Stationen/Anker), Routen-Cache-Datei (neue 'road'
    Einträge nach Hintergrund-Fetch) und OSRM-Schalter. Grobes mtime
    (Netzwerkdateisysteme) deckt die ``META_TTL_S``-Backstop-Regel ab.
    """
    return "|".join(
        (
            f"polling:{_file_stamp(settings.polling)}",
            f"roads:{_file_stamp(cache_file) if cache_file is not None else 'none'}",
            f"osrm:{_osrm_enabled()}",
        )
    )


def metadata(settings):
    """Stationen-Metadaten mit Distanzen — memoisiert, Request-Pfad-sicher.

    Rückgabe (stations, problem); problem ist ``polling_missing`` bzw.
    ``polling_invalid`` (B21: polling.json ist Host-Datei via
    TANKAPP_POLLING_FILE → /config/polling.json RO; fehlt sie, ist das der
    Grund für „Keine Stadt eingerichtet“ + „Noch kein frischer Preis“
    trotz Collector-✓ und Influx-✓ — der erwartete Pfad steht für
    preflight.sh/NAS-Mounts im Log).

    Das Memo ist auf die Datei-Stats (``_metadata_stamp``) geschlüsselt:
    Wiederholte Requests zahlen eine Dict-Kopie statt Re-Parse und
    Re-Ableitung aller Distanzen. Distanzen selbst kommen cache-only aus
    :func:`driving_km` — der Request-Pfad macht kein Netzwerk.
    """
    cache_file = _road_cache_file(settings)
    bundle = _metadata_bundle(settings, cache_file)
    stations = bundle[0]
    problem = bundle[2]
    return ({key: dict(meta) for key, meta in stations.items()}, problem)


def anchors_by_city(settings) -> dict[str, tuple[float, float]]:
    """Anker-Koordinate (Heimat-Startpunkt) je Stadt, wie im Polling-Set
    konfiguriert (``anchor`` bzw. ``lat``/``lon`` auf Set-Ebene).

    Anders als die Stations-Metadaten sind diese Koordinaten bewusst nur über
    diese separate Funktion erreichbar: Die Karte zeichnet den Anker als
    Startpunkt (Radar-Zentrum, Entfernungsursprung), andere Payloads tragen
    ihn nicht.
    """
    cache_file = _road_cache_file(settings)
    bundle = _metadata_bundle(settings, cache_file)
    return {city: (float(lat), float(lon)) for city, (lat, lon) in bundle[1].items()}


def _metadata_bundle(settings, cache_file) -> tuple[dict, dict, str | None]:
    """Memoisierter Bau von (stations, anchors, problem)."""
    stamp = _metadata_stamp(settings, cache_file)
    now = time.monotonic()
    with _META_LOCK:
        memo = _META_MEMO
        if memo["key"] == stamp and now - memo["at"] < META_TTL_S:
            stations, anchors, problem = memo["value"]
            return (
                {key: dict(meta) for key, meta in stations.items()},
                dict(anchors),
                problem,
            )
    stations, anchors, problem = _build_station_metadata(settings, cache_file)
    with _META_LOCK:
        _META_MEMO["key"] = stamp
        _META_MEMO["value"] = (stations, anchors, problem)
        _META_MEMO["at"] = now
    return (
        {key: dict(meta) for key, meta in stations.items()},
        dict(anchors),
        problem,
    )


def _build_station_metadata(settings, cache_file):
    payload = read_json(settings.polling)
    if payload is None:
        return {}, {}, "polling_missing"
    try:
        groups = validate_sets(payload)
    except (ValueError, TypeError, KeyError):
        return {}, {}, "polling_invalid"
    stations = {}
    anchors = {}
    pending = []
    for key, group in groups.items():
        city = group.get("label") or key
        anchor = group.get("anchor")
        if anchor is None:
            lat0, lon0 = group.get("lat"), group.get("lon")
            if (
                type(lat0) in (int, float)
                and type(lon0) in (int, float)
                and math.isfinite(lat0)
                and math.isfinite(lon0)
            ):
                anchor = [lat0, lon0]
        anchor_ok = (
            isinstance(anchor, list)
            and len(anchor) == 2
            and all(type(value) in (int, float) for value in anchor)
            and all(math.isfinite(value) for value in anchor)
            and 47 <= anchor[0] <= 56
            and 5 <= anchor[1] <= 16
        )
        if anchor_ok:
            anchors[city] = (float(anchor[0]), float(anchor[1]))
        details = {item["uuid"]: item for item in group.get("stations", [])}
        for uid in group.get("batch") or list(details):
            item = details.get(uid, {})
            lat, lon = item.get("lat"), item.get("lon")
            coordinates = (
                type(lat) in (float, int)
                and type(lon) in (float, int)
                and math.isfinite(lat)
                and math.isfinite(lon)
                and -90 <= lat <= 90
                and -180 <= lon <= 180
            )
            identity = (city, uid)
            stations[identity] = {
                "station_id": uid,
                "city": city,
                "name": item.get("name") or uid,
                "brand": item.get("brand") or "",
                "lat": lat if coordinates else None,
                "lon": lon if coordinates else None,
                "dist_km": None,
                "dist_mode": None,
                "maps_url": f"https://www.google.com/maps/dir/?api=1&destination={lat},{lon}&travelmode=driving"
                if coordinates
                else None,
            }
            if anchor_ok and coordinates:
                pending.append((identity, (lat, lon), tuple(anchor)))
    by_anchor = {}
    for identity, coords, anchor in pending:
        by_anchor.setdefault(anchor, []).append((identity, coords))
    for anchor, items in by_anchor.items():
        distances = driving_km(anchor, [coords for _, coords in items], cache_file)
        for (identity, _), (km, kind) in zip(items, distances):
            stations[identity]["dist_km"] = km
            stations[identity]["dist_mode"] = kind
    return stations, anchors, None


def public_job(settings, name):
    raw = read_json(settings.runtime / "jobs" / f"{name}.json", {})
    if not isinstance(raw, dict):
        raw = {}
    payload = {
        key: raw.get(key)
        for key in (
            "state",
            "started_at",
            "finished_at",
            "last_success_at",
            "next_run_at",
            # B24: Abbruchzeitpunkt und -phase eines hart beendeten Laufs —
            # damit „Läuft …“-Geister durch einen ehrlichen `aborted`-Zustand
            # ersetzt werden und die GUI die Abbruchphase zeigen kann.
            "aborted_at",
            "aborted_phase",
            # Issue 50: Datenstand des letzten erfolgreichen
            # Webhook-Triggerlaufs (Epochensekunden) — Idempotenz-Anker.
            "data_watermark",
            "error_code",
            # Bereinigte Ursache des letzten Fehlschlags (app/errors.py).
            "error_detail",
        )
    }
    # Fortschritt nur für *laufende* Jobs (app/progress.py): „Läuft …“ ohne
    # „wo?“ ist bei einem 20-Minuten-Modelllauf genau die Lücke, die der
    # System-Status schließen soll.
    if raw.get("state") == "running":
        try:
            from .progress import read_progress

            payload["progress"] = read_progress(settings, name)
        except Exception:
            payload["progress"] = None
    return payload


def publication(settings):
    raw = read_json(settings.runtime / "engine/current.json", {})
    return raw if isinstance(raw, dict) else {}


def selection_publication(settings):
    raw = read_json(settings.runtime / "selection/current.json", {})
    return raw if isinstance(raw, dict) else {}


class LiveData:
    """Bounded cache, re-evaluate age on EVERY request; never call statusless last(price)."""

    def __init__(self, settings, query=None, clock=None):
        self.settings = settings
        self.query = query or influx.query_rows
        # collector_status liest ein Nicht-Preis-Measurement: rohe Zeilen statt
        # Preis-Schema (siehe export_influx.query_raw). Ein injiziertes ``query``
        # (Tests) dient unverändert für beide Lesewege.
        self.query_any = query or influx.query_raw
        self.clock = clock or (lambda: dt.datetime.now(UTC))
        self.lock = threading.Lock()
        self.cache = {}
        # B7-Revalidierung: /overview-Antwort-Cache, key = ETag
        # (Datenstand + Parameter). Verwaiste ETags tauchen nie wieder auf;
        # die Obergrenze hält das Dict klein (Einträge sind kleine JSONs).
        self.overview_cache = {}
        self.jobs_enabled = False
        self.job_errors = {}
        # stats_summary liest die Engine-Veröffentlichung über diesen Provider,
        # damit kein circular import entsteht (data ↔ stats_summary).
        try:
            from .stats_summary import set_publication_provider

            set_publication_provider(lambda: publication(self.settings))
        except Exception:
            pass

    # --- Stations-Preise: Steady-State wartet nie auf InfluxDB ------------
    #
    # Gleiche Muster-Wirkung wie bei den Straßen-Distanzen: Sobald ein
    # Cache-Eintrag existiert, liefert der Request immer sofort den
    # letzten bekannten Stand — frisch (≤ STALE_AFTER_S) direkt aus dem
    # Cache, veraltet als Stale-While-Revalidate: bekannte Zeilen sofort
    # antworten, ein einzelner Hintergrund-Refresh (Daemon, Single-Flight
    # je Key) liest InfluxDB neu. Freshness-Semantik unangetastet:
    # fresh/age_minutes hängen am Beobachtungszeitstempel und werden je
    # Request neu bewertet — der Cache bestimmt nur, wie oft neu gelesen
    # wird, nicht, wann ein Preis „abläuft“.
    #
    # Die ERST-Ladung je Stations-Menge bleibt synchron (bisheriges
    # Verhalten): Sie passiert nur einmal, und der Server warmt alle
    # Kraftstoffe beim Start im Hintergrund vor (prewarm()), sodass der
    # erste GUI-Request danach in der Praxis nie auf InfluxDB wartet.
    STALE_AFTER_S = 30.0  # Neulese-Intervall wie bisher (30 s)

    def _load(self, fuel, metas):
        """Letzter bekannter Preis-Stand je Kraftstoff.

        Cache-Eintrag ``(mono, rows, error, loading)`` je
        ``(fuel, Stationen-Menge)``:
          * frisch (≤ STALE_AFTER_S): wird wie gehabt ausgeliefert
          * veraltet: bekannter Stand sofort (Stale-While-Revalidate);
            falls noch kein Refresh läuft, wird einer gestartet
            (Single-Flight, Daemon-Thread)
          * kein Eintrag (Erst-Ladung): synchron wie bisher
          * ``influx_not_configured``: synchroner Spezialfall
        Fehler-Semantik unverändert: ein fehlgeschlagener Read behält den
        bekannten Stand und meldet ``influx_read_failed`` — ab Stale-
        While-Revalidate sichtbar, sobald der Hintergrund-Read gescheitert
        ist, nicht erst beim wartenden Request.
        """
        key = (fuel, tuple(sorted(metas)))
        if not self.settings.influx_env.is_file():
            return {}, "influx_not_configured"
        with self.lock:
            entry = self.cache.get(key)
            if entry is not None:
                mono, rows, error, loading = entry
                if time.monotonic() - mono < self.STALE_AFTER_S:
                    return rows, error
                if not loading:
                    self.cache[key] = (mono, rows, error, True)
                    threading.Thread(
                        target=self._refresh_station_rows,
                        args=(key, fuel, metas),
                        daemon=True,
                        name=f"tankapp-influx-{fuel}",
                    ).start()
                # bekannter Stand sofort — auch während des Refresh-Laufs
                return rows, error

        # Erst-Ladung für diese Stations-Menge: synchron (außerhalb des
        # Locks, damit andere Kraftstoffe nicht blockiert werden).
        try:
            rows, error = self._fetch_station_rows(fuel, metas)
        except Exception:
            rows, error = {}, "influx_read_failed"
        if error:
            # Kein bekannter Stand vorhanden: Teilstand nicht publizieren
            # (Semantik wie vor Stale-While-Revalidate).
            rows = {}
        with self.lock:
            current = self.cache.get(key)
            if (
                current is not None
                and not current[3]
                and time.monotonic() - current[0] < self.STALE_AFTER_S
            ):
                # Ein konkurrierender Ladethread hat frischen Stand gelöst.
                return current[1], current[2]
            # Wie sonst: nur eine Stations-Mengen-Generation im Cache.
            self.cache = {k: v for k, v in self.cache.items() if k[1] == key[1]}
            self.cache[key] = (time.monotonic(), rows, error, False)
        return rows, error

    def _refresh_station_rows(self, key, fuel, metas):
        """Hintergrund-Read von InfluxDB (Daemon-Thread, nie Request-blockend).

        Schreibt das Ergebnis unter ``self.lock`` in denselben Cache, aus
        dem der Request-Pfad liest: neue Zeitstempel → Eintrag wieder
        frisch, ``loading`` geclert. Ein fehlgeschlagener Read behält den
        bekannten Stand (Semantik unverändert) und meldet den Fehler; der
        nächste veraltete Request startet den nächsten Versuch —
        Single-Flight verhindert Anstapeln.
        """
        try:
            rows, error = self._fetch_station_rows(fuel, metas)
        except Exception:
            rows, error = {}, "influx_read_failed"
        with self.lock:
            entry = self.cache.get(key)
            previous = entry[1] if entry is not None else {}
            # Wie bisher: fehlerhafter Read publiziert keinen Teilstand —
            # der bekannte Stand bleibt, der Fehler wird gemeldet.
            if error:
                rows = previous
            # Nur eine Stations-Mengen-Generation im Cache.
            self.cache = {k: v for k, v in self.cache.items() if k[1] == key[1]}
            self.cache[key] = (time.monotonic(), rows, error, False)

    def _fetch_station_rows(self, fuel, metas):
        """Synchroner InfluxDB-Read (2-Tage-Fenster, letzte Zeile je Station).

        Von :meth:`_load` (Erst-Ladung, synchron) und
        :meth:`_refresh_station_rows` (Hintergrund) aufgerufen;
        Zeilen-Validierung und Fehler-Einteilung unverändert.
        """
        now = self.clock()
        rows, error = {}, None
        try:
            cfg = influx.load_config(self.settings.influx_env, timeout=10)
            cfg.validate()
            lookup = influx.station_lookup(self.settings.polling)
            selected = influx.selected_uuid_sets(lookup)
            query = influx.flux_query(
                cfg.bucket,
                fuel,
                now - dt.timedelta(days=2),
                now,
                sorted(selected),
                selected,
            )
            query += '  |> group(columns: ["city", "station_id"])\n  |> sort(columns: ["_time"])\n  |> tail(n: 1)\n'
            seen, kept = 0, 0
            for raw in self.query(cfg, query):
                # Einzelne defekte Zeilen überspringen, statt alle
                # Stationen auf influx_read_failed zu setzen. Werden
                # aber ALLE gelieferten Zeilen verworfen, ist das kein
                # Teilerfolg, sondern ein expliziter Lesefehler (kein
                # stilles Leer-Ergebnis bei Totalausfall).
                seen += 1
                try:
                    if not raw.get("station_id"):
                        raise ValueError("UUID required")
                    row = influx.normalized_row(raw, lookup, fuel)
                    stamp = influx.instant(row["timestamp"])
                    if not now - dt.timedelta(days=2) <= stamp <= now:
                        raise ValueError("Timestamp outside query")
                    identity = (row["city"], row["station_id"])
                    if identity not in metas:
                        raise ValueError("Unselected station")
                    rows[identity] = row
                    kept += 1
                except (ValueError, KeyError, TypeError):
                    continue
            if seen and not kept:
                error = "influx_read_failed"
        except (ValueError, OSError, KeyError, TypeError):
            error = "influx_read_failed"
        return rows, error

    def prewarm(self):
        """Stations-Cache aller Kraftstoffe im Hintergrund erwärmen (Start).

        Löst die (sonst synchronen) Erst-Ladungen in einem Daemon-Thread
        aus, damit der Serverstart nicht auf InfluxDB wartet: Der erste
        GUI-Request nach dem Neustart trifft dann in der Praxis schon auf
        einen warmen Cache; ansonsten gelten die normalen Cache-Regeln.
        Ohne InfluxDB-Konfiguration oder gültiges Polling-Set tut die
        Methode nichts (keine sinnlosen Refresh-Läufe).
        """
        if not self.settings.influx_env.is_file():
            return
        try:
            metas, problem = metadata(self.settings)
        except Exception:
            return
        if problem:
            return

        def warm():
            for fuel in FUELS:
                self._load(fuel, metas)

        threading.Thread(
            target=warm, daemon=True, name="tankapp-influx-prewarm"
        ).start()

    def stations(self, fuel="e10", city=None):
        if fuel not in FUELS:
            raise ValueError("invalid_fuel")
        metas, problem = metadata(self.settings)
        cities = list(dict.fromkeys(city_name for city_name, _ in metas))
        if city and city not in cities:
            raise ValueError("unknown_city")
        # Anker nur für die abgefragte Stadt ausliefern — die Karte zeichnet
        # ihn als Startpunkt, andere Antworten tragen die Koordinate nicht.
        anchor_map = anchors_by_city(self.settings)
        if city:
            anchor_map = {city: anchor_map[city]} if city in anchor_map else {}
        rows, error = ({}, problem) if problem else self._load(fuel, metas)
        now = self.clock()
        result = []
        for identity, meta in metas.items():
            if city and meta["city"] != city:
                continue
            row = rows.get(identity)
            age = (
                (now - influx.instant(row["timestamp"])).total_seconds() / 60
                if row
                else None
            )
            fresh = error is None and age is not None and 0 <= age <= 30
            status = row["status"] if row else "unknown"
            price = float(row["price"]) if row and row["price"] else None
            result.append(
                {
                    **meta,
                    "fuel": fuel,
                    "status": status,
                    "observed_at": row["timestamp"] if row else None,
                    "age_minutes": round(age, 2) if age is not None else None,
                    "fresh": fresh,
                    "last_price": price,
                    "price": price if fresh and status == "open" else None,
                }
            )
        result.sort(
            key=lambda row: (row["price"] is None, row["price"] or 0, row["name"])
        )
        return {
            "generated_at": now.isoformat(),
            "cities": cities,
            "fuel": fuel,
            "city": city,
            "source": "influxdb",
            "connection_error": error,
            "stations": result,
            "anchors": {
                c: {"lat": lat, "lon": lon} for c, (lat, lon) in anchor_map.items()
            },
            "fresh_prices": sum(row["price"] is not None for row in result),
            "decision_ready": False,
            "calibrated": False,
        }

    def series(self, uid, city, fuel, hours=24):
        if fuel not in FUELS or not 1 <= hours <= 168:
            raise ValueError("invalid_query")
        metas, problem = metadata(self.settings)
        if (city, uid) not in metas:
            raise ValueError("unknown_station")
        if problem or not self.settings.influx_env.is_file():
            return {
                "points": [],
                "n_points": 0,
                "range_from": None,
                "range_to": None,
                "error_code": problem or "influx_not_configured",
            }
        now = self.clock()
        try:
            cfg = influx.load_config(self.settings.influx_env, timeout=10)
            cfg.validate()
            lookup = influx.station_lookup(self.settings.polling)
            query = influx.flux_query(
                cfg.bucket,
                fuel,
                now - dt.timedelta(hours=hours),
                now,
                [city],
                {city: [uid]},
            )
            points = []
            for raw in self.query(cfg, query):
                if raw.get("station_id") != uid or raw.get("city") != city:
                    raise ValueError("Wrong identity")
                row = influx.normalized_row(raw, lookup, fuel)
                stamp = influx.instant(row["timestamp"])
                if not now - dt.timedelta(hours=hours) <= stamp <= now:
                    raise ValueError("Wrong time")
                points.append(
                    {
                        "timestamp": stamp.isoformat(),
                        "status": row["status"],
                        "price": float(row["price"]) if row["price"] else None,
                    }
                )
                if len(points) > 20_000:
                    raise ValueError("Too many points")
            ordered = sorted(points, key=lambda p: p["timestamp"])
            # C11: echte Reichweite des Bestands — das angefragte Fenster
            # (``hours``) ist oft größer als das, was wirklich vorliegt. Ohne
            # diese Angabe sieht eine kurze Kurve aus wie ein Datenverlust.
            # Gezählt werden nur Punkte mit Preis; geschlossene Meldungen sind
            # echte Beobachtungen, aber kein Preis-Bestand.
            priced = [p for p in ordered if p["price"] is not None]
            return {
                "points": ordered,
                "n_points": len(priced),
                "range_from": priced[0]["timestamp"] if priced else None,
                "range_to": priced[-1]["timestamp"] if priced else None,
                "error_code": None,
            }
        except (ValueError, OSError, KeyError, TypeError):
            return {
                "points": [],
                "n_points": 0,
                "range_from": None,
                "range_to": None,
                "error_code": "influx_read_failed",
            }

    def job_log(self, name: str, lines: int = 200):
        """Letzte Zeilen von ``runtime/jobs/<name>.log`` (bereinigt, begrenzt).

        Dieselbe Datei, die auf dem NAS auch ``tail -f`` lesen kann; über die
        API erreichbar, damit „Modell-Update fehlgeschlagen“ im GUI nicht das
        Ende der Diagnose ist. Nur bekannte Jobs, nur diese eine Datei, jede
        Zeile durch :func:`app.errors.redact` — nie ein beliebiger Pfad.
        """
        from .errors import redact
        from .worker import INTERVALS

        empty = {
            "job": name,
            "available": False,
            "count": 0,
            "total": 0,
            "lines": [],
            "updated_at": None,
            "error_code": "log_missing",
        }
        if name not in INTERVALS:
            return {**empty, "error_code": "unknown_job"}
        path = self.settings.runtime / "jobs" / f"{name}.log"
        try:
            raw = path.read_text(encoding="utf-8", errors="replace").splitlines()
            stamp = path.stat().st_mtime
        except OSError:
            return empty
        tail = raw[-max(1, min(500, lines)) :]
        return {
            "job": name,
            "available": True,
            "count": len(tail),
            "total": len(raw),
            "lines": [redact(line, 400) for line in tail],
            "updated_at": dt.datetime.fromtimestamp(stamp, UTC).isoformat(),
            "error_code": None,
        }

    def trigger_info(self):
        """Issue 50: Webhook-Trigger-Statistik des Schedulers (Prozesslebenszeit).

        Ohne anhängenden Scheduler (z. B. reine Read-Only-Instanzen) bleibt
        das Feld leer — die intervallo-basierten Jobs ändern dadurch nichts.
        """
        scheduler = getattr(self, "scheduler", None)
        if scheduler is None:
            return {}
        with scheduler.lock:
            return {
                name: {
                    "triggers": scheduler.trigger_counts.get(name, 0),
                    "last_trigger_skip": scheduler.trigger_skips.get(name),
                }
                for name in ("models", "selection")
            }

    def health(self):
        job_errors = self.job_errors.copy()
        trigger_stats = self.trigger_info()
        metas, problem = metadata(self.settings)
        archive = read_json(
            self.settings.runtime / "jobs" / "archive-sync" / "state.json", None
        )
        if not isinstance(archive, dict):
            archive = read_json(self.settings.archive / ".sync/state.json", {})
        if not isinstance(archive, dict):
            archive = {}
        bundle = publication(self.settings)
        sel = selection_publication(self.settings)
        # Collector status without network: /health is polled by the Docker
        # HEALTHCHECK (3–5 s budget) and must not depend on InfluxDB response
        # times. Full details (incl. InfluxDB) live in /api/v1/collector/status.
        try:
            from .collector_status import build_collector_status

            collector = build_collector_status(
                self.settings, None, self.clock, allow_influx=False
            )
        except BaseException:
            collector = {
                "available": False,
                "error_code": "collector_check_failed",
                "generated_at": self.clock().isoformat(),
            }
        if problem:
            collector["polling_error"] = problem

        # Jobs einmal zusammenbauen — derselbe Block dient unten den Alarmen.
        jobs = {
            name: {
                **public_job(self.settings, name),
                **(
                    {"state": "failed", "error_code": job_errors[name]}
                    if name in job_errors
                    else {}
                ),
                # Issue 50: Trigger-Zählung/Sprung-Grund nur für die
                # inferenz-baren Jobs (models/selection) vorhanden.
                **trigger_stats.get(name, {}),
            }
            for name in ("archive", "models", "selection", "settlement")
        }

        # B4: aggregierter Alarm-Block — nur Aggregation der obigen Prüfungen,
        # keine neuen Netz-/Influx-Zugriffe (Healthcheck-Budget 3–5 s).
        try:
            from .alarms import build_alarms

            alarms = build_alarms(
                self.settings,
                collector=collector,
                jobs=jobs,
                job_errors=job_errors,
                polling_error=problem,
                station_count=len(metas),
            )
        except Exception:
            alarms = []

        # B4: Zustellung sichtbar machen — ist der Webhook konfiguriert, und
        # welche Errors gelten als gemeldet? Liest nur die lokale
        # Zustandsdatei (kein Netz), damit das Healthcheck-Budget bleibt.
        try:
            from .notify import notify_status

            notify = notify_status(self.settings)
        except Exception:
            notify = {
                "configured": False,
                "open_errors": [],
                "last_ok_at": None,
                "last_sent_at": None,
            }

        # B9: Version + Build-Hash (einmalig beim Import bestimmt).
        try:
            from .version import build_info

            version = build_info()
        except Exception:
            version = {"version": None, "commit": None}

        # Selection count: support both old flat and new by_fuel formats.
        # Count all ranked stations (not top_global, which is capped at 10/fuel),
        # so /health and /api/v1/selection agree.
        sel_count = 0
        if isinstance(sel, dict):
            if "by_fuel" in sel:
                for fuel_data in sel.get("by_fuel", {}).values():
                    if not isinstance(fuel_data, dict):
                        continue
                    cities = fuel_data.get("cities") or []
                    if cities:
                        sel_count += sum(len(c.get("stations", [])) for c in cities)
                    else:
                        sel_count += len(fuel_data.get("top_global", []))
            else:
                sel_count = sel.get("count", 0)

        return {
            "app": "online",
            "generated_at": self.clock().isoformat(),
            "version": version.get("version"),
            "commit": version.get("commit"),
            "polling_error": problem,
            # B21: Pfad für „Polling-Set fehlt“-Diagnose im GUI (System.tsx)
            "polling_path": str(self.settings.polling),
            "station_count": len(metas),
            "influx_configured": self.settings.influx_env.is_file(),
            "archive_configured": self.settings.netrc.is_file()
            and self.settings.netrc.stat().st_size > 0,
            "jobs_enabled": self.jobs_enabled,
            "alarms": alarms,
            "notify": notify,
            "archive": {
                key: archive.get(key)
                for key in (
                    "archive_since",
                    "requested_until",
                    "status",
                    "missing_files",
                    "last_complete_until",
                )
            },
            "jobs": jobs,
            "models": {
                "published_at": bundle.get("published_at"),
                "count": len(bundle.get("forecasts", [])),
                "calibrated": False,
                "decision_ready": False,
            },
            "selection": {
                "published_at": sel.get("generated_at")
                if isinstance(sel, dict)
                else None,
                "fuels": sel.get("fuels", []) if isinstance(sel, dict) else [],
                "count": sel_count,
                "error_code": None if sel else "selection_not_available",
            },
            "collector": collector,
        }

    def forecast(self, uid, city, fuel, include_draws: bool = False):
        metas, _ = metadata(self.settings)
        if fuel not in FUELS or (city, uid) not in metas:
            raise ValueError("unknown_station")
        bundle = publication(self.settings)
        for row in bundle.get("forecasts", []):
            if (
                row.get("station_id"),
                row.get("city"),
                row.get("fuel", "").lower(),
            ) != (uid, city, fuel):
                continue
            origin = influx.instant(row["origin"])
            age = (self.clock() - origin).total_seconds() / 3600
            result = {
                **row,
                "stale": age < 0 or age > 24,
                "model_age_hours": max(0, age),
                "published_at": bundle.get("published_at"),
                # C11: Datenreichweite des Fits. ``**row`` bringt die Felder
                # aus neuen Bundles schon mit; die explizite Zeile setzt sie
                # bei älteren Publikationen auf None statt sie fehlen zu lassen.
                "range_from": row.get("range_from"),
                "range_to": row.get("range_to"),
                "n_points": row.get("n_points"),
                "n_days": row.get("n_days"),
                "calibrated": False,
                "decision_ready": False,
            }
            if not include_draws:
                # Draws sind Decision-Layer-Input, kein öffentlicher Forecast-Ballast.
                result.pop("draws_24h", None)
                result.pop("draws_7d", None)
            return result
        return {
            "points": [],
            "error_code": "model_not_available",
            "range_from": None,
            "range_to": None,
            "n_points": None,
            "n_days": None,
            "calibrated": False,
            "decision_ready": False,
        }

    def last_forecasts(self):
        """Gibt alle letzten Prognosen für den RP2-Cache zurück."""
        bundle = publication(self.settings)
        forecasts = bundle.get("forecasts", [])

        valid_forecasts = []
        for row in forecasts:
            if not all(
                k in row for k in ["station_id", "city", "fuel", "origin", "points"]
            ):
                continue
            slim = {
                k: v
                for k, v in row.items()
                if k not in ("points_3d", "points_7d", "draws_24h", "draws_7d")
            }
            valid_forecasts.append(slim)

        return {
            "generated_at": bundle.get("published_at"),
            "forecasts": valid_forecasts,
            "count": len(valid_forecasts),
            "calibrated": False,
            "decision_ready": False,
        }

    def heatmap(
        self,
        city,
        fuel="e10",
        kind="level",
        weeks=6,
        station_id=None,
        basis="overall",
    ):
        """Heatmaps DoW×Stunde: Niveau (Median) + Cheap-Probability.

        ``basis`` (B12) ist nur für ``kind=probability`` **ohne** ``station_id``
        wirksam: ``overall`` vergleicht jede Zelle gegen den Gesamtmedian des
        Fensters, ``hour`` gegen den Median derselben Stunde (Spalten-Basis,
        rechnet den Tagesgang heraus und macht die Wochentage vergleichbar).
        """
        from .heatmap import BASES as HEATMAP_BASES, build_heatmap

        if fuel not in FUELS:
            raise ValueError("invalid_fuel")
        if kind not in ("level", "probability"):
            raise ValueError("invalid_kind")
        if not 1 <= weeks <= 12:
            raise ValueError("invalid_weeks")
        if basis not in HEATMAP_BASES:
            raise ValueError("invalid_basis")
        metas, problem = metadata(self.settings)
        if problem:
            return {"error_code": problem, "days": [], "hours": [], "matrix": []}
        cities = list(dict.fromkeys(c for c, _ in metas))
        if city not in cities:
            raise ValueError("unknown_city")
        if station_id and (city, station_id) not in metas:
            raise ValueError("unknown_station")

        now = self.clock()
        start = now - dt.timedelta(days=weeks * 7)

        if not self.settings.influx_env.is_file():
            return {
                "error_code": "influx_not_configured",
                "days": [],
                "hours": [],
                "matrix": [],
            }

        try:
            cfg = influx.load_config(self.settings.influx_env, timeout=10)
            cfg.validate()
            lookup = influx.station_lookup(self.settings.polling)
            city_stations = [sid for (c, sid) in metas if c == city]
            if not city_stations:
                raise ValueError("unknown_city")
            query = influx.flux_query(
                cfg.bucket,
                fuel,
                start,
                now,
                [city],
                {city: city_stations},
            )
            points = []
            for raw in self.query(cfg, query):
                if raw.get("city") != city:
                    continue
                try:
                    row = influx.normalized_row(raw, lookup, fuel)
                except Exception:
                    continue
                stamp = influx.instant(row["timestamp"])
                if not start <= stamp <= now:
                    continue
                if row["status"] != "open" or not row["price"]:
                    continue
                try:
                    price_val = float(row["price"])
                except Exception:
                    continue
                points.append(
                    {
                        "timestamp": stamp,
                        "station_id": row["station_id"],
                        "price": price_val,
                    }
                )
                if len(points) > 200_000:
                    raise ValueError("Too many points")
        except ValueError as e:
            if str(e) == "Too many points":
                return {
                    "error_code": "too_many_points",
                    "days": [],
                    "hours": [],
                    "matrix": [],
                }
            return {
                "error_code": "influx_read_failed",
                "days": [],
                "hours": [],
                "matrix": [],
            }
        except Exception:
            return {
                "error_code": "influx_read_failed",
                "days": [],
                "hours": [],
                "matrix": [],
            }

        result = build_heatmap(points, kind=kind, station_id=station_id, basis=basis)

        return {
            "generated_at": now.isoformat(),
            "city": city,
            "fuel": fuel,
            "kind": kind,
            "weeks": weeks,
            "station_id": station_id,
            "basis": result["basis"],
            "days": result["days"],
            "hours": result["hours"],
            "matrix": result["matrix"],
            "counts": result["counts"],
            # P0: Ehrlichkeits-Angaben — Reichweite der verwendeten Preise und
            # Stichprobe der Vergleichs-Basis. Die GUI sagt damit, warum eine
            # Zeile leer ist (Bestand jünger als das Fenster) und wann „100 %
            # günstig“ Mechanik einer dünnen Basis statt einer Aussage ist.
            "reference_counts": result["reference_counts"],
            "range_from": result["range_from"],
            "range_to": result["range_to"],
            "points": result["points"],
            "stations": result["stations"],
            "error_code": None,
        }

    def selection(self, fuel="e10", city=None):
        """Meine Stationen mit δ̂ — Ranking, Bootstrap-KI, AV-Score, billigste Stunde."""
        if fuel not in FUELS:
            raise ValueError("invalid_fuel")
        metas, problem = metadata(self.settings)
        if problem:
            return {
                "error_code": problem,
                "stations": [],
                "count": 0,
                "range_from": None,
                "range_to": None,
                "n_points": None,
                "n_days": None,
            }
        cities = list(dict.fromkeys(c for c, _ in metas))
        if city and city not in cities:
            raise ValueError("unknown_city")

        try:
            from .selection import read_selection

            data = read_selection(self.settings)
        except Exception:
            return {
                "error_code": "selection_read_failed",
                "stations": [],
                "count": 0,
                "range_from": None,
                "range_to": None,
                "n_points": None,
                "n_days": None,
            }

        # data kann entweder by_fuel Struktur oder flache Liste sein
        if "by_fuel" in data:
            fuel_data = data["by_fuel"].get(fuel, {})
            # fuel_data enthält cities und top_global
            if city:
                # Finde Stadt
                city_entry = next(
                    (c for c in fuel_data.get("cities", []) if c.get("city") == city),
                    None,
                )
                if city_entry:
                    stations = city_entry.get("stations", [])
                else:
                    stations = []
                    city_entry = None
            else:
                # Alle Städte zusammen oder top_global
                stations = []
                for c in fuel_data.get("cities", []):
                    stations.extend(c.get("stations", []))
                # Sortiere nach rank
                stations = sorted(stations, key=lambda x: x.get("rank", 999))
                city_entry = None
            # A12/A13: Lebenszyklus + Preis-Zwillinge für System-Tab + Artefakt-Warnung
            if city and city_entry is not None:
                price_twins = city_entry.get("price_twins", []) or []
                lifecycle_counts = city_entry.get("lifecycle_counts")
                dead_stations = city_entry.get("dead_stations", []) or []
                closed_stations = city_entry.get("closed_stations", []) or []
                nofuel_stations = city_entry.get("nofuel_stations", []) or []
                # Stadt-spezifische Coverage/Diagnose falls vorhanden
                coverage_info = {
                    "coverage_window": city_entry.get("coverage_window"),
                    "coverage_reference": city_entry.get("coverage_reference"),
                    "coverage_threshold": city_entry.get("coverage_threshold"),
                }
            else:
                price_twins = fuel_data.get("price_twins", []) or []
                lifecycle_counts = fuel_data.get("lifecycle_totals")
                dead_stations = []
                closed_stations = []
                nofuel_stations = []
                for c in fuel_data.get("cities", []) or []:
                    dead_stations.extend(c.get("dead_stations", []) or [])
                    closed_stations.extend(c.get("closed_stations", []) or [])
                    nofuel_stations.extend(c.get("nofuel_stations", []) or [])
                coverage_info = {}
            return {
                "generated_at": data.get("generated_at")
                or fuel_data.get("generated_at"),
                "fuel": fuel,
                "city": city,
                "cities": [c.get("city") for c in fuel_data.get("cities", [])],
                "count": len(stations),
                "total_count": len(stations),
                "stations": stations,
                "top_global": fuel_data.get("top_global", [])[:10],
                # C11: Datenreichweite des Rankings, aus dem Artefakt
                # durchgereicht (engine/selection.py). Bei Altbeständen ohne
                # die Felder bleibt es None — die GUI zeigt dann nichts an.
                "range_from": fuel_data.get("range_from"),
                "range_to": fuel_data.get("range_to"),
                "n_points": fuel_data.get("n_points"),
                "n_days": fuel_data.get("n_days"),
                "error_code": None,
                "calibrated": False,
                "decision_ready": False,
                # A12/A13: Warnungen als Daten (nie auto-apply)
                "price_twins": price_twins,
                "price_twin_count": len(price_twins),
                "lifecycle_counts": lifecycle_counts,
                "dead_stations": dead_stations[:20],
                "dead_count": len(dead_stations),
                "closed_stations": closed_stations[:20],
                "closed_count": len(closed_stations),
                "nofuel_stations": nofuel_stations[:20],
                "nofuel_count": len(nofuel_stations),
                "dead_after_days": fuel_data.get("dead_after_days"),
                **coverage_info,
            }
        else:
            # Fallback altes Format
            stations = data.get("stations", [])
            filtered = [
                s
                for s in stations
                if s.get("fuel", "").lower() == fuel.lower()
                and (city is None or s.get("city") == city)
            ]
            return {
                "generated_at": data.get("generated_at"),
                "fuel": fuel,
                "city": city,
                "cities": data.get("cities", []),
                "count": len(filtered),
                "total_count": data.get("count", 0),
                "stations": sorted(filtered, key=lambda x: x.get("rank", 999)),
                "range_from": data.get("range_from"),
                "range_to": data.get("range_to"),
                "n_points": data.get("n_points"),
                "n_days": data.get("n_days"),
                "error_code": data.get("error_code"),
                "calibrated": False,
                "decision_ready": False,
            }

    def collector_status(self):
        """Pi/tmpfs Livestatus — Collector-Herzschlag ans NAS."""
        try:
            from .collector_status import build_collector_status

            return build_collector_status(self.settings, self.query_any, self.clock)
        except Exception:
            return {"available": False, "error_code": "collector_check_failed"}

    def route_evaluate(self, params: dict):
        """Serverseitige Umweg-Ökonomie."""
        try:
            from .route import evaluate_route

            return evaluate_route(self, params)
        except ValueError as e:
            raise e
        except Exception:
            return {"error_code": "route_evaluate_failed"}

    def decide(self, params: dict):
        """Entscheidungs-API — GET /api/v1/decide (Konzept §4, §11.1)."""
        try:
            from .decide import evaluate_decide
            from .feedback import StoreTooLarge

            return evaluate_decide(self, params)
        except ValueError as e:
            raise e
        except StoreTooLarge:
            return {"error_code": "store_too_large"}
        except Exception:
            return {"error_code": "decide_failed"}

    def episodes(self, status: str | None = None):
        """Liefert Episoden (z. B. ?status=due für Due-Prompt beim Öffnen)."""
        try:
            from .feedback import StoreTooLarge, load_store

            store = load_store(self.settings)
            episodes = store.get("episodes", [])
            if status:
                filtered = [e for e in episodes if e.get("status") == status]
            else:
                filtered = episodes
            return {
                "generated_at": self.clock().isoformat(),
                "count": len(filtered),
                "episodes": filtered,
                "error_code": None,
            }
        except StoreTooLarge:
            return {"error_code": "store_too_large", "episodes": [], "count": 0}
        except Exception:
            return {"error_code": "episodes_read_failed", "episodes": [], "count": 0}

    def diary(self, limit: int = 50, outcome: str | None = None):
        """Prognose-Tagebuch (GUI-Neuentwurf §6.2 Abschnitt 4, Konzept §12).

        Liest die **echten** Settlements aus dem Advice-Ledger
        (`app/feedback.py`) und verbindet jeden Eintrag mit dem Snapshot, der
        ihn ausgelöst hat: Aktion, Station (Name aus dem Snapshot, nicht nur
        die ID), Fenster, Versprechen (p) und Ergebnis (win/loss/tie/void +
        Begründung). Kein Demo-Eintrag, keine erfundene Zeile — solange nichts
        abgerechnet ist, bleibt die Liste leer und das Feld `reason` erklärt,
        woran es liegt. ``decline_reason`` nennt bei „keine Empfehlung“ den
        Grund der Tabelle; ``emitted_at`` ist die erste Bestätigung dieser
        Entscheidung, ``settled_at`` ihre Abrechnung (Kollabierung, §5.4).

        `limit` kappt die Liste (neueste zuerst), `outcome` filtert
        ("win", "loss", "tie", "void").
        """
        try:
            if limit < 1 or limit > 500:
                raise ValueError("invalid_query")
            from .feedback import StoreTooLarge, load_store

            store = load_store(self.settings)
            snapshots = {
                s.get("id"): s
                for ep in store.get("episodes", [])
                for s in ep.get("snapshots", []) or []
            }
            rows = []
            for settlement in store.get("settlements", []) or []:
                snap = snapshots.get(settlement.get("snapshot_id")) or {}
                if outcome and settlement.get("outcome") != outcome:
                    continue
                rows.append(
                    {
                        "snapshot_id": settlement.get("snapshot_id"),
                        "episode_id": settlement.get("episode_id"),
                        "settled_at": settlement.get("settled_at"),
                        "emitted_at": snap.get("emitted_at"),
                        "action": snap.get("action"),
                        "station_id": snap.get("alt_station_id")
                        or snap.get("station_id"),
                        # Namen aus dem Snapshot: Ohne sie fiel die GUI auf
                        # die rohe Stations-UUID zurück, wenn die Station nicht
                        # mehr im aktuellen Set lag — im Tagebuch stand dann
                        # „919e1134-…“ statt eines Namens.
                        "station_name": snap.get("alt_station_name")
                        or snap.get("station_name"),
                        "city": snap.get("city"),
                        "fuel": snap.get("fuel"),
                        "window_start": snap.get("window_start"),
                        "window_end": snap.get("window_end"),
                        "price_then": settlement.get("p_emit"),
                        "price_window": settlement.get("p_realized"),
                        "outcome": settlement.get("outcome"),
                        "void_reason": settlement.get("void_reason"),
                        "regret_eur": settlement.get("regret_eur"),
                        "p_correct": snap.get("p_correct"),
                        "p_besser": snap.get("p_besser"),
                        # Grund der Ablehnung (nur ``no_advice``): Eine
                        # kollabierte Ablehnung gilt weiter, bis sie widerrufen
                        # wird — die Zeitspanne zeigt die GUI aus
                        # ``emitted_at`` (erste Bestätigung) und ``settled_at``.
                        "decline_reason": snap.get("decline_reason"),
                        "liters": snap.get("liters_assumed"),
                        "intent": snap.get("intent"),
                    }
                )
            rows.sort(key=lambda row: row.get("settled_at") or "", reverse=True)
            pending = snapshots and not rows
            return {
                "generated_at": self.clock().isoformat(),
                "count": len(rows),
                "entries": rows[:limit],
                "settled_total": len(store.get("settlements", []) or []),
                "reason": None
                if rows
                else ("no_settlements" if pending else "no_advice_history"),
                "error_code": None,
            }
        except ValueError:
            return {"error_code": "invalid_query", "entries": [], "count": 0}
        except StoreTooLarge:
            return {"error_code": "store_too_large", "entries": [], "count": 0}
        except Exception:
            return {"error_code": "diary_read_failed", "entries": [], "count": 0}

    def set_intent(self, episode_id: str, intent: str):
        """Setzt den Intent einer Episode (wait, navigate, refuel_now, dismiss)."""
        try:
            from .feedback import StoreTooLarge, set_intent

            res = set_intent(self.settings, episode_id, intent, clock=self.clock)
            return res
        except StoreTooLarge:
            return {"error_code": "store_too_large"}
        except ValueError as exc:
            # B11: Belegter Store ist wiederholbar (503), kein Eingabefehler.
            if str(exc) == "store_locked":
                return {"error_code": "store_locked"}
            return {"error_code": "set_intent_failed"}
        except Exception:
            return {"error_code": "set_intent_failed"}

    def record_fill(self, fill_data: dict):
        """Registriert einen Tankbeleg (Wallet-Ledger) — validiert (§11.2)."""
        try:
            from .feedback import StoreTooLarge, record_fill

            return record_fill(
                self.settings, fill_data, live_data=self, clock=self.clock
            )
        except StoreTooLarge:
            return {"error_code": "store_too_large"}
        except ValueError as exc:
            # Fach-Codes aus der Validierung (invalid_liters, invalid_price,
            # unknown_station, price_not_available, …) statt Pauschal-Fehler.
            return {"error_code": str(exc) or "invalid_query"}
        except Exception:
            return {"error_code": "record_fill_failed"}

    def fills(self):
        """Wallet-Verlauf: alle Tankbelege (auch stornierte, mit ``voided``-Flag)."""
        try:
            from .feedback import StoreTooLarge, load_store

            store = load_store(self.settings)
            fills = store.get("fills", [])
            return {
                "generated_at": self.clock().isoformat(),
                "count": len(fills),
                "fills": fills,
                "error_code": None,
            }
        except StoreTooLarge:
            return {"error_code": "store_too_large", "fills": [], "count": 0}
        except Exception:
            return {"error_code": "fills_read_failed", "fills": [], "count": 0}

    def void_fill(self, fill_id: str):
        """Storniert einen Beleg (A3) — Flag statt Löschen, mit Audit-Spur."""
        try:
            from .feedback import StoreTooLarge, void_fill

            return void_fill(self.settings, fill_id, clock=self.clock)
        except StoreTooLarge:
            return {"error_code": "store_too_large"}
        except ValueError as exc:
            # B11: Belegter Store ist wiederholbar (503), kein Eingabefehler.
            if str(exc) == "store_locked":
                return {"error_code": "store_locked"}
            return {"error_code": "void_fill_failed"}
        except Exception:
            return {"error_code": "void_fill_failed"}

    def fills_summary(self):
        """A4: Monats-/Jahresbilanz des Wallet-Ledgers (Werkstatt-Panel)."""
        try:
            from .feedback import StoreTooLarge, compute_wallet_balance, load_store

            store = load_store(self.settings)
            balance = compute_wallet_balance(store, now=self.clock())
            balance["error_code"] = None
            return balance
        except StoreTooLarge:
            return {"error_code": "store_too_large"}
        except Exception:
            return {"error_code": "fills_summary_failed"}

    # --- A1: Fahrzeug-/Haushaltsprofile (ohne Login, serverseitig) ---

    def profiles(self):
        try:
            from .profiles import load_store, public_profiles

            return public_profiles(load_store(self.settings))
        except Exception:
            return {
                "error_code": "profiles_read_failed",
                "profiles": [],
                "active": None,
            }

    def create_profile(self, payload: dict):
        try:
            from .profiles import ProfileError, create_profile

            return create_profile(self.settings, payload, clock=self.clock)
        except ProfileError as exc:
            return {"error_code": str(exc) or "invalid_query"}
        except Exception:
            return {"error_code": "profile_write_failed"}

    def update_profile(self, profile_id: str, payload: dict):
        try:
            from .profiles import ProfileError, update_profile

            return update_profile(self.settings, profile_id, payload, clock=self.clock)
        except ProfileError as exc:
            return {"error_code": str(exc) or "invalid_query"}
        except Exception:
            return {"error_code": "profile_write_failed"}

    def activate_profile(self, profile_id: str | None):
        try:
            from .profiles import ProfileError, activate_profile

            return activate_profile(self.settings, profile_id)
        except ProfileError as exc:
            return {"error_code": str(exc) or "invalid_query"}
        except Exception:
            return {"error_code": "profile_write_failed"}

    def delete_profile(self, profile_id: str):
        try:
            from .profiles import ProfileError, delete_profile

            return delete_profile(self.settings, profile_id)
        except ProfileError as exc:
            return {"error_code": str(exc) or "invalid_query"}
        except Exception:
            return {"error_code": "profile_write_failed"}

    def fills_csv(self) -> str:
        """Tankbelege als CSV (A6) — ``;``-getrennt, deutsche Dezimalkommas.

        Die eigene Bilanz gehört dem Nutzer: ein Download im System-Tab macht
        sie portabel (Tabellenkalkulation, Archiv), ohne Fremdformate.
        """
        import csv
        import io

        payload = self.fills()
        rows = payload.get("fills", []) or []
        buf = io.StringIO()
        writer = csv.writer(buf, delimiter=";", quoting=csv.QUOTE_MINIMAL)
        writer.writerow(
            [
                "id",
                "getankt_am",
                "station_id",
                "station",
                "liter",
                "preis_eur_l",
                "kraftstoff",
                "quelle",
                "compliance",
                "ersparnis_eur",
                "storniert",
            ]
        )

        def de(number) -> str:
            try:
                value = float(number)
            except (TypeError, ValueError):
                return ""
            return f"{value:.2f}".replace(".", ",")

        for f in rows:
            writer.writerow(
                [
                    f.get("id", ""),
                    f.get("tanked_at", ""),
                    f.get("station_id", ""),
                    f.get("station_name", ""),
                    de(f.get("liters")),
                    de(f.get("price_paid")),
                    f.get("fuel", ""),
                    f.get("source", ""),
                    f.get("compliance", ""),
                    de(f.get("saved_vs_always_now_eur")),
                    "ja" if f.get("voided") else "",
                ]
            )
        return buf.getvalue()

    def stats_summary(self, params: dict):
        """Drei-Schichten-Statistik: Markt-Backtest, Live-Advice, Wallet."""
        try:
            from .feedback import StoreTooLarge
            from .stats_summary import evaluate_stats_summary

            return evaluate_stats_summary(self, params)
        except StoreTooLarge:
            return {"error_code": "store_too_large"}
        except Exception:
            return {"error_code": "stats_summary_failed"}

    def overview_etag(self, params: dict) -> str | None:
        """ETag für /overview — Datenstand + Parameter, billig berechenbar.

        Revalidierung ist nur möglich, wenn ``data_version()`` läuft;
        sonst None (ehrlicher Fallback: kein 304, Antwort wird immer
        berechnet).
        """
        try:
            version = data_version(self.settings, self.clock)
        except Exception:
            return None
        canonical = json.dumps(params, sort_keys=True, ensure_ascii=False, default=str)
        return hashlib.sha1(f"{version}|{canonical}".encode("utf-8")).hexdigest()

    def overview(self, params: dict, etag: str | None = None) -> dict:
        """B7: Der Alltag in einer Anfrage — statt sechs parallelen GUI-Polls.

        Das GUI holte für den Alltagstab decide, fills, stats/summary,
        due-Episoden und die Tageskurve je eigenen Poll; auf der NAS-HDD
        hängen die Threads an den File-Locks, und ein manueller Refresh
        feuerte alle parallel (5–10 s, UI scheinbar blockiert). Hier laufen
        dieselben Bausteine in einem Handler: eine Anfrage, ein Read pro
        Quelle, dieselben Antworten wie die Einzelpfade (keine neue
        Semantik, nur gebündelt).

        Mit ``etag`` (vom Server-Handler via ``overview_etag``) wird das
        Ergebnis je Datenstand + Parameter gecacht: Die eine teure
        Berechnung pro Datenstand dient danach aus dem Speicher — auch
        für Geräte/Anfragen ohne If-None-Match.
        """
        fuel = str(params.get("fuel") or "e10").lower()
        if fuel not in FUELS:
            raise ValueError("invalid_fuel")
        if etag:
            with self.lock:
                cached = self.overview_cache.get(etag)
            if cached is not None:
                return cached
        city = params.get("city")
        station_id = params.get("station_id")

        decide_params = dict(params)
        day_res = None
        if station_id:
            metas, problem = metadata(self.settings)
            known = problem is None and any(uid == station_id for (_c, uid) in metas)
            if not known:
                # Station veraltet (z. B. nach Stations-Tausch): decide wählt
                # selbst eine Station, die Tageskurve entfällt — der Rest des
                # Alltags bleibt voll funktionsfähig.
                decide_params.pop("station_id", None)
            elif city:
                day_res = self.series(station_id, city, fuel, 24)

        decide_res = self.decide(decide_params)
        fills_res = self.fills()
        summary_params = {"fuel": fuel}
        if city:
            summary_params["city"] = city
        summary_res = self.stats_summary(summary_params)
        episodes_res = self.episodes("due")

        result = {
            "generated_at": self.clock().isoformat(),
            "decide": decide_res,
            "fills": fills_res,
            "stats_summary": summary_res,
            "episodes": episodes_res,
            "day": day_res,
            "error_code": None,
        }
        if etag:
            with self.lock:
                if len(self.overview_cache) >= 64:
                    self.overview_cache.clear()
                self.overview_cache[etag] = result
        return result

    def day_series(self, station_id: str, day: str):
        """Tageskurve für das Stations-Labor im Statistik-Bereich.

        Quelle ist die Engine-Veröffentlichung (runtime/engine/current.json).
        Wenn keine Engine-Daten vorhanden sind, wird ein leeres Array
        zurückgegeben — keine Demo-Daten, keine erfundenen Punkte.
        """
        try:
            metas, _ = metadata(self.settings)
            # Bestimme die Stadt der Station aus den Metadaten
            city_for_station = None
            for (city, uid), _meta in metas.items():
                if uid == station_id:
                    city_for_station = city
                    break

            if not city_for_station:
                return {
                    "ok": False,
                    "station_id": station_id,
                    "day": day,
                    "points": [],
                    "error_code": "unknown_station",
                }

            bundle = publication(self.settings)
            points: list[dict[str, Any]] = []
            for row in bundle.get("forecasts", []) or []:
                if row.get("station_id") != station_id:
                    continue
                if row.get("city") != city_for_station:
                    continue
                forecast_points = row.get("points") or []
                try:
                    target_date = dt.date.fromisoformat(day)
                except Exception:
                    return {
                        "ok": False,
                        "station_id": station_id,
                        "day": day,
                        "points": [],
                        "error_code": "invalid_day",
                    }
                for fp in forecast_points:
                    try:
                        ts = dt.datetime.fromisoformat(
                            str(fp.get("timestamp", "")).replace("Z", "+00:00")
                        )
                    except Exception:
                        continue
                    local_date = (
                        ts.astimezone(BERLIN_TZ).date() if ts.tzinfo else ts.date()
                    )
                    if local_date != target_date:
                        continue
                    q50 = fp.get("q50")
                    # NaN heißt „Punkt nicht gestützt“ (engine/models.py) —
                    # kein Preis, also kein Punkt auf der Tageskurve.
                    try:
                        q50_value = float(q50)
                    except (TypeError, ValueError):
                        continue
                    if not math.isfinite(q50_value):
                        continue
                    # €/L → ct/L
                    ct_value = round(q50_value * 100.0, 1)
                    points.append(
                        {
                            "h": ts.astimezone(BERLIN_TZ).hour
                            if ts.tzinfo
                            else ts.hour,
                            "ct": ct_value,
                            "open": True,
                        }
                    )
                if points:
                    break

            return {
                "ok": True,
                "station_id": station_id,
                "day": day,
                "points": points,
                "source": "engine" if points else None,
            }
        except Exception:
            return {
                "ok": False,
                "station_id": station_id,
                "day": day,
                "points": [],
            }
