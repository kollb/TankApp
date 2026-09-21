"""Read-only live data and public projections. No price API calls, no demo fallback."""

import datetime as dt
import hashlib
import json
import math
import os
import threading
import time
import uuid
import zlib
from collections import OrderedDict
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

# --- O20: feste Farbskala des Tagesstreifens --------------------------------
#
# Die GUI färbte die 19 Stunden relativ zum Minimum/Maximum **des Tages**:
# Kommt um 18 Uhr ein günstigerer Preis dazu, wird der ganze bisherige Tag
# heller — eine Stunde, die morgens „dunkel = billig“ war, ist abends
# dieselbe Zahl in einer anderen Farbe. Dazu gewann je Stunde die **letzte**
# Meldung, während die Fenstersuche das Stunden-Minimum nutzt (zwei
# Wahrheiten für dieselbe Zelle).
#
# Die Skala kommt deshalb aus einem festen Bezugszeitraum (7 Tage) und nicht
# aus dem Tag selbst: 25./75. Perzentil der Preise mit Meldung. Eine neue
# Meldung verschiebt dieses Band praktisch nicht, und die Tonlage einer
# Stunde bedeutet dasselbe wie gestern („unter/über dem üblichen Band dieser
# Station“). Zu dünner Bestand (< STRIP_BAND_MIN_DAYS Tage oder
# < STRIP_BAND_MIN_POINTS Preise) liefert **keine** Skala — die GUI zeigt die
# Zahlen dann ohne Farburteil, statt eine Skala aus zwei Messwerten zu
# erfinden.
STRIP_BAND_HOURS = 168
STRIP_BAND_MIN_DAYS = 3
STRIP_BAND_MIN_POINTS = 96
DAY_SERIES_HOURS = 24


def _calibration_active(value: Any) -> bool:
    """Validiert den B2-Modellstatus am API-Rand (kein JSON-Flag-Vertrauen)."""
    try:
        from engine.calibration import calibration_active

        return bool(calibration_active(value))
    except Exception:
        # Ein defektes/älteres Artefakt darf die lesende API nicht umwerfen und
        # erst recht keine Kalibrierung behaupten.
        return False


def price_band(prices, days: int | None = None) -> dict[str, Any] | None:
    """25./75. Perzentil als feste Tonlagen-Skala (O20), sonst ``None``.

    Bewusst ohne Numerik-Abhängigkeit (Decision Layer, ``app/pside.py``):
    ``statistics.quantiles`` reicht für zwei Perzentile. ``days`` ist die
    Zahl der Tage, aus denen die Preise stammen — sie steht mit in der
    Antwort, damit die GUI benennen kann, wofür die Skala gilt.
    """
    import statistics

    values = sorted(
        float(value)
        for value in prices or ()
        if isinstance(value, (int, float)) and math.isfinite(float(value))
    )
    if len(values) < STRIP_BAND_MIN_POINTS:
        return None
    if days is not None and days < STRIP_BAND_MIN_DAYS:
        return None
    lo, _median, hi = statistics.quantiles(values, n=4, method="inclusive")
    if not (lo < hi):
        # Konstanter Bestand (Demo-Artefakt, tote Station): eine Spanne von
        # null wäre eine Skala ohne Aussage — ehrlich keine Skala.
        return None
    return {
        "lo": round(lo, 4),
        "hi": round(hi, 4),
        "basis": "percentile_25_75",
        "hours": STRIP_BAND_HOURS,
        "n_points": len(values),
        "days": days,
    }


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

# --- Größen-Grenzen der JSON-Artefakte (O22) --------------------------------
#
# Hauskonvention: Ein Artefakt über ``READ_JSON_MAX_BYTES`` wird nicht gelesen
# (Speicherschutz). Vor 0.44.0 war das ein stilles ``default`` — für die
# Veröffentlichung der Prognosen bedeutete es: ab rund fünf Stationen kippte die
# ganze App lautlos in den „noch keine Daten“-Zustand, während der Modell-Job
# weiter Erfolg meldete. Deshalb gibt es jetzt zusätzlich ein **Budget**:
#
#   PUBLICATION_BUDGET_BYTES  darüber wird es gelb (``publication_large``)
#   READ_JSON_MAX_BYTES       darüber ist die Datei nicht mehr lesbar
#                             (``publication_unreadable``, severity error)
#
# Das Budget liegt bewusst unter der Hälfte des Leselimits: Eine weitere
# Station im Polling-Set oder ein zusätzlicher Kraftstoff soll angekündigt
# sein, bevor die Klippe erreicht ist (docs/archiv/OPTIMIERUNGS-BEFUND-2026-09-18.md O22).
READ_JSON_MAX_BYTES = 10_000_000
PUBLICATION_BUDGET_BYTES = 6_000_000

# O22 Maßnahme (d): Die Veröffentlichung ist **aufgeteilt** — ein kleiner
# Index (``engine/current.json``) plus eine Datei je Station/Kraftstoff unter
# ``engine/forecasts/``. Hintergrund: Die Klippe ist eine Eigenschaft der
# *einzelnen* Datei; mit 20 Stationen wuchs das Monolith-Artefakt auf 13,5 MB
# (über dem Leselimit), obwohl kompakt geschrieben und gerundet wurde. Jede
# Stations-Datei bleibt weit unter dem Limit, der Index zeigt auf sie.
# ``publication()`` fügt beides zur gewohnten Bundle-Form zusammen — die
# Leser (``/forecast``, ``/decide``, ``/stats/summary``, RP2-Cache) sehen
# dieselbe Struktur wie vor der Aufteilung. Alt-Artefakte ohne ``layout``
# bleiben lesbar (ein Monolith übergangsweise, Demo-Stapel, Test-Fixtures).
PUBLICATION_LAYOUT_SPLIT = "split-forecast-files"
PUBLICATION_FORECASTS_DIRNAME = "forecasts"
# A1: Eine Veröffentlichung ist eine **Generation** — ein Satz unveränderbarer
# Stations-Dateien in ``forecasts/<generation>/`` plus der Index, der darauf
# zeigt. Der alte flache Layout (Dateien mit stabilem Namen direkt unter
# ``forecasts/``) bleibt lesbar; neu geschrieben wird nur generationiert.
PUBLICATION_GENERATIONS_DIRNAME = "generations"


def publication_forecasts_dir(settings):
    """Verzeichnis der Stations-Dateien der aufgeteilten Veröffentlichung."""
    return publication_path(settings).parent / PUBLICATION_FORECASTS_DIRNAME


def forecast_file_name(row) -> str:
    """Dateiname einer Stations-Prognose in der aufgeteilten Veröffentlichung.

    UUID plus Kraftstoff (mehrere Kraftstoffe je Station sind möglich); der
    Name ist stabil, damit ein behaltener Vormodell-Lauf
    (``retained_previous``) dieselbe Adressierung trägt wie sein Vorgänger.
    """
    fuel = str(row.get("fuel") or "").strip().lower() or "fuel"
    return f"{row.get('station_id')}.{fuel}.json"


def _new_generation_id(published_at) -> str:
    """A1: Sortierbare Generations-ID — Zeitstempel plus kurzer Zufallsschweif.

    Lexikographisch == zeitlich (``<millis>-<hex>``), damit die Retention
    sortieren kann. Der Zufallsschweig trennt zwei Läufe in derselben
    Millisekunde (Testumgebungen, schnelle Folgejobs) — zwei verschiedene
    Generationen dürfen nie denselben Namen tragen.
    """
    try:
        stamp = dt.datetime.fromisoformat(str(published_at).replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=UTC)
        millis = int(stamp.timestamp() * 1000)
    except (TypeError, ValueError):
        millis = int(time.time() * 1000)
    return f"{millis:015d}-{uuid.uuid4().hex[:8]}"


def _generation_files(index: dict) -> set[str]:
    """Alle Dateizeiger eines Index als Menge (``forecasts/…``-Pfade)."""
    files = set()
    for entry in index.get("forecasts") or []:
        if isinstance(entry, dict) and entry.get("file"):
            files.add(str(entry["file"]))
    return files


def _best_effort_remove(path: Path) -> None:
    """A1: Datei oder Baum best-effort entfernen — Stille ist erlaubt.

    Retention-Aufräumen darf die erfolgreiche Veröffentlichung nicht kippen:
    Bleibt eine alte Generation liegen, räumt der nächste Lauf sie aus.
    """
    try:
        if path.is_dir():
            for member in sorted(path.iterdir()):
                _best_effort_remove(member)
            path.rmdir()
        elif path.is_file():
            path.unlink()
    except OSError:
        pass


def _verify_forecast_part(part_path, row: dict, entry: dict) -> None:
    """A1: Stations-Datei vor dem Commit prüfen — Hash, Schema, Identität.

    Die Datei muss existieren, als JSON lesbar sein, eine ``forecast``-Zeile
    tragen, deren Identität (Station/Kraftstoff) zur Index-Zeile passt, und —
    wenn die Index-Zeile einen ``sha256`` trägt — exakt diesen Hash liefern.
    Fehlschlagen ist ein harter Fehler: Der Index wird nicht getauscht, der
    vorige Stand bleibt gültig.
    """
    try:
        raw = part_path.read_bytes()
    except (OSError, ValueError) as exc:
        raise ValueError(f"Stations-Datei {part_path.name} unlesbar: {exc}") from exc
    digest = entry.get("sha256")
    if digest and hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError(
            f"Stations-Datei {part_path.name} weicht vom Index-Hash ab (A1)"
        )
    try:
        parsed = json.loads(raw.decode("utf-8-sig"))
    except (OSError, ValueError, UnicodeDecodeError) as exc:
        raise ValueError(f"Stations-Datei {part_path.name} ungültiges JSON: {exc}")
    if not isinstance(parsed, dict) or not isinstance(parsed.get("forecast"), dict):
        raise ValueError(
            f"Stations-Datei {part_path.name} trägt kein ``forecast`` (A1)"
        )
    stored = parsed["forecast"]
    if stored.get("station_id") != row.get("station_id"):
        raise ValueError(
            f"Stations-Datei {part_path.name}: Identität weicht vom Index ab (A1)"
        )
    if str(stored.get("fuel") or "").lower() != str(row.get("fuel") or "").lower():
        raise ValueError(
            f"Stations-Datei {part_path.name}: Kraftstoff weicht vom Index ab (A1)"
        )


def write_split_publication(engine_dir, published_at, forecasts, index_extra=None):
    """A1/O22(d): Aufgeteilte, generationskonsistente Veröffentlichung.

    Einziger Schreiber dieses Layouts (``app/refresh.py`` ruft die Funktion;
    Tests schreiben darüber dasselbe Format). Ein Lauf schreibt eine **neue
    Generation**: alle Stations-Dateien entstehen unter
    ``forecasts/generations/<generation>/`` (unveränderlich, nie
    überschrieben), werden vor dem Commit geprüft (Hash/Schema/Identität,
    ``_verify_forecast_part``) und erst danach wird der Index
    ``current.json`` atomar getauscht — der Index ist der Commit-Zeiger.
    Leser sehen damit ausschließlich eine vollständige alte oder eine
    vollständige neue Generation, nie einen Mischstand (Befund A1).

    Schlägt ein Schritt fehl, bleibt der vorige Index gültig; die
    verwaiste Generation bleibt liegen und wird vom nächsten erfolgreichen
    Lauf abgeräumt. Alte Generationen werden erst gelöscht, wenn sie weder
    vom neuen noch vom vorigen Index referenziert sind — ein warmer Leser
    darf den vorletzten Stand noch vor sich haben.

    Rückgabe: ``total_bytes`` (Summe aller Dateien der neuen Generation
    plus Index), ``index_bytes``, ``largest_file_bytes`` (die Klippe gilt
    der einzelnen Datei), ``file_count`` (Stations-Dateien ohne Index) und
    ``generation``.
    """
    from engine.storage import write_json

    engine_dir = Path(engine_dir)
    forecasts_dir = engine_dir / PUBLICATION_FORECASTS_DIRNAME
    generations_dir = forecasts_dir / PUBLICATION_GENERATIONS_DIRNAME
    index_path = engine_dir / "current.json"

    # Voriger Index in Memory: Seine Referenzen überleben das Aufräumen
    # (warmer Leser), sein ``generation``-Feld bestimmt die Retention.
    prev_index, _prev_reason = read_json_checked(index_path)
    prev_index = prev_index if isinstance(prev_index, dict) else {}
    prev_referenced = _generation_files(prev_index)
    prev_generation = prev_index.get("generation")

    generation = _new_generation_id(published_at)
    gen_dir = generations_dir / generation
    gen_dir.mkdir(parents=True, exist_ok=True)

    index_rows = []
    total_bytes = 0
    largest_bytes = 0
    for row in forecasts:
        name = forecast_file_name(row)
        part_path = gen_dir / name
        part_bytes = write_json(
            part_path,
            {
                "schema_version": 1,
                "generation": generation,
                "published_at": published_at,
                "forecast": row,
            },
            indent=None,
        )
        # A1: Prüfung vor dem Commit — die Datei muss dem Index-Hash und der
        # Identität entsprechen, sonst wird der Index NICHT getauscht.
        index_entry = {
            "city": row.get("city"),
            "station_id": row.get("station_id"),
            "fuel": row.get("fuel"),
            "origin": row.get("origin"),
            "retained_previous": bool(row.get("retained_previous")),
            "file": f"{PUBLICATION_FORECASTS_DIRNAME}/{PUBLICATION_GENERATIONS_DIRNAME}/{generation}/{name}",
            "sha256": hashlib.sha256(part_path.read_bytes()).hexdigest(),
        }
        _verify_forecast_part(part_path, row, index_entry)
        total_bytes += part_bytes
        largest_bytes = max(largest_bytes, part_bytes)
        index_rows.append(index_entry)

    index = {
        "schema_version": 1,
        "layout": PUBLICATION_LAYOUT_SPLIT,
        "generation": generation,
        "published_at": published_at,
        "forecasts": index_rows,
    }
    index.update(index_extra or {})
    # Atomarer Tausch des Index — der Commit-Zeiger. Erst jetzt ist die neue
    # Generation für Leser sichtbar; vorher sah jeder die alte.
    index_bytes = write_json(index_path, index, indent=None)
    total_bytes += index_bytes
    largest_bytes = max(largest_bytes, index_bytes)

    # Aufräumen: Referenzen des neuen UND des vorigen Index bleiben; alles
    # andere unter ``forecasts/`` ist Abfall (ältere Generationen, verwaiste
    # Stations-Dateien des alten flachen Layouts). Best-effort — Abräumen
    # darf die erfolgreiche Veröffentlichung nicht kippen.
    # A1: Es bleiben die Generationen, auf die der neue ODER der vorherige
    # Index verweisen (beide gelesen, bevor der Index getauscht wird —
    # warmer Leser ist abgedeckt). Alles andere ist Rest eines abgebrochenen
    # Laufes oder ein zu alter Stand und wird abgeräumt.
    keep = _generation_files(index) | prev_referenced
    prefix = f"{PUBLICATION_FORECASTS_DIRNAME}/{PUBLICATION_GENERATIONS_DIRNAME}/"
    keep_generations = {
        rel.split("/")[2]
        for rel in keep
        if rel.startswith(prefix) and len(rel.split("/")) == 4
    }
    try:
        for child in sorted(forecasts_dir.iterdir()):
            rel = f"{PUBLICATION_FORECASTS_DIRNAME}/{child.name}"
            if rel in keep:
                continue
            if child.name == PUBLICATION_GENERATIONS_DIRNAME:
                for gen in sorted(child.iterdir()):
                    if gen.name in keep_generations:
                        continue
                    _best_effort_remove(gen)
            else:
                _best_effort_remove(child)
    except OSError:
        pass

    return {
        "total_bytes": total_bytes,
        "index_bytes": index_bytes,
        "largest_file_bytes": largest_bytes,
        "file_count": len(index_rows),
        "generation": generation,
        "previous_generation": prev_generation,
    }


# --- Preis-Plausibilität (O35) ----------------------------------------------
#
# Ein Paar Grenzen für alle Pfade — eine „zweite Wahrheit“ wäre hier genau
# die Lücke, die der Befund beschreibt: Der Trainingspfad filtert
# 0,40–5,00 €/L samt Hampel-Artefakten (engine/data.py), das Ledger
# verweigert Belege außerhalb derselben Grenzen (app/feedback.py,
# ``MIN_PRICE_PAID``/``MAX_PRICE_PAID`` sind Aliasse auf diese Werte). Vor
# 0.46.0 kannte der **Live-Pfad** keine Grenze: ein API-Ausreißer
# (verrutschte Dezimalstelle) sortierte sich an die Spitze der Stationsliste
# und wurde Empfehlungs-Anker. Jetzt gilt: Werte außerhalb der Grenzen sind
# Beobachtungen, aber keine Preise — die Station bleibt sichtbar, ohne Preis,
# mit Kennzeichnung (``implausible_price``), und der Vorfall wird gezählt
# (``/api/v1/health`` → ``price_implausible``, Alarm ``price_implausible``).
PRICE_PLAUSIBLE_MIN = 0.40
PRICE_PLAUSIBLE_MAX = 5.00
# Beobachtungs-Fenster des Zählers: Was länger zurückliegt, ist für die
# Frage „kommt das gerade gehäuft vor?“ nicht mehr aussagekräftig.
IMPLAUSIBLE_WINDOW_H = 24.0
IMPLAUSIBLE_MAX_ENTRIES = 100
IMPLAUSIBLE_RELATIVE = ("quality", "implausible_prices.json")

_IMPLAUSIBLE_LOCK = threading.Lock()


def implausible_price_path(settings) -> Path:
    return (
        Path(getattr(settings, "runtime", Path(".")))
        / IMPLAUSIBLE_RELATIVE[0]
        / IMPLAUSIBLE_RELATIVE[1]
    )


def plausible_price(value: float | None) -> bool:
    """Ein Preis ist plausibel, wenn er endlich ist und in den Grenzen liegt.

    Dieselbe Frage, die ``engine/data.py`` fürs Training beantwortet — hier
    für den Live-Pfad, als eine Funktion statt zweier Literal-Paare.
    """
    try:
        price = float(value)
    except (TypeError, ValueError):
        return False
    return math.isfinite(price) and PRICE_PLAUSIBLE_MIN <= price <= PRICE_PLAUSIBLE_MAX


def _record_implausible_observations(
    settings, observations: list[dict], *, now: dt.datetime
) -> None:
    """Zählt unplausible Live-Preise — je Beobachtung einmal, nie je Poll.

    Dedupliziert über (Station, Zeitstempel der Beobachtung): Derselbe
    0,05-€/L-Wert bleibt in der Wiederholung desselben Polls **ein**
    Vorfall. Einträge älter als ``IMPLAUSIBLE_WINDOW_H`` fallen heraus.
    """
    if not observations:
        return
    path = implausible_price_path(settings)
    with _IMPLAUSIBLE_LOCK:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            entries = raw.get("entries") if isinstance(raw, dict) else None
        except (OSError, ValueError):
            entries = None
        entries = [entry for entry in (entries or []) if isinstance(entry, dict)]
        seen = {
            (entry.get("station_id"), entry.get("observed_at")) for entry in entries
        }
        for entry in observations:
            key = (entry.get("station_id"), entry.get("observed_at"))
            if key in seen:
                continue
            seen.add(key)
            # NaN/Inf sind keine JSON-Zahlen — der Zähler bleibt gültiges JSON
            # (der Wert ist dann None; gezählt wird der Vorfall trotzdem).
            value = entry.get("value")
            if isinstance(value, float) and not math.isfinite(value):
                entry = {**entry, "value": None}
            entries.append(entry)
        cutoff = now - dt.timedelta(hours=IMPLAUSIBLE_WINDOW_H)
        kept = []
        for entry in entries:
            try:
                stamp = dt.datetime.fromisoformat(str(entry.get("observed_at")))
            except (TypeError, ValueError):
                continue
            if stamp.tzinfo is None:
                stamp = stamp.replace(tzinfo=UTC)
            if stamp >= cutoff:
                kept.append(entry)
        kept = kept[-IMPLAUSIBLE_MAX_ENTRIES:]
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(".tmp")
            temporary.write_text(
                json.dumps({"entries": kept}, ensure_ascii=False, allow_nan=False),
                encoding="utf-8",
            )
            os.replace(temporary, path)
        except (OSError, ValueError):
            pass  # Zählen darf nie den Antwort-Pfad sprengen


def implausible_price_status(settings, clock=None) -> dict[str, Any]:
    """Zähler für ``/api/v1/health`` und den Alarm — nur ein lokaler Read."""
    try:
        raw = json.loads(implausible_price_path(settings).read_text(encoding="utf-8"))
        entries = raw.get("entries") if isinstance(raw, dict) else None
    except (OSError, ValueError):
        entries = None
    now = clock() if clock else dt.datetime.now(UTC)
    cutoff = now - dt.timedelta(hours=IMPLAUSIBLE_WINDOW_H)
    count = 0
    last_at = None
    for entry in entries or []:
        if not isinstance(entry, dict):
            continue
        try:
            stamp = dt.datetime.fromisoformat(str(entry.get("observed_at")))
        except (TypeError, ValueError):
            continue
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=UTC)
        if stamp >= cutoff:
            count += 1
            observed = entry.get("observed_at")
            if isinstance(observed, str) and (last_at is None or observed > last_at):
                last_at = observed
    return {"count_24h": count, "last_at": last_at}


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


# Bis zu dieser Größe wird der ganze Inhalt für den Abdruck gelesen; darüber
# nur Kopf und Ende (Archive wachsen ausschließlich am Ende, und die App
# ersetzt ihre Bestände atomar — dabei wechselt der Inode).
_STAMP_FULL_DIGEST_BYTES = 64 * 1024
_STAMP_EDGE_BYTES = 16 * 1024


def _content_digest(path, size: int) -> str:
    """Kurzer Inhaltsabdruck (crc32) — fängt gleich große Änderungen.

    Bis :data:`_STAMP_FULL_DIGEST_BYTES` wird die Datei ganz gelesen (die
    beobachteten Bestände sind wenige Kilobyte); darüber nur Kopf und Ende.
    """
    with path.open("rb") as handle:
        if size <= _STAMP_FULL_DIGEST_BYTES:
            crc = zlib.crc32(handle.read())
        else:
            head = handle.read(_STAMP_EDGE_BYTES)
            handle.seek(max(0, size - _STAMP_EDGE_BYTES))
            crc = zlib.crc32(handle.read(_STAMP_EDGE_BYTES), zlib.crc32(head))
    return f"{crc & 0xFFFFFFFF:08x}"


def _file_stamp(path) -> str:
    """Gerät:Inode:mtime_ns:Größe:Inhaltsabdruck — „absent“ ohne Datei.

    ``int(mtime):Größe`` (bis 0.64.0) kollidierte, sobald sich der Inhalt
    innerhalb derselben Sekunde änderte und die Größe gleich blieb (Audit
    §3.5: „Beleg storniert, gleich langer Ersatzbeleg“ → dieselbe
    ``data_version``, also 304 auf einen veralteten Stand). Jetzt zählen
    Nanosekunden, Inode **und** Inhalt: Der crc32-Abdruck unterscheidet
    zwei gleich große, gleich alte Stände; ein atomarer Austausch (alle
    App-Schreibpfade) fällt schon am neuen Inode auf. Gelesen wird je
    Aufruf höchstens :data:`_STAMP_FULL_DIGEST_BYTES` (darüber Kopf/Ende)
    — bewusst begrenzt statt den ganzen Bestand je Request zu hashen.
    """
    try:
        stamp = path.stat()
    except (OSError, ValueError):
        return "absent"
    try:
        digest = _content_digest(path, stamp.st_size)
    except (OSError, ValueError):
        # Unlesbar (Rechte, Race, Verzeichnis): der Stempel bleibt ehrlich
        # grob — die nächste Anfrage sieht den neuen Dateistand.
        digest = "unreadable"
    return f"{stamp.st_dev}:{stamp.st_ino}:{stamp.st_mtime_ns}:{stamp.st_size}:{digest}"


def _price_source_parts(settings, clock) -> list[str]:
    """Die Preisquellen als Stempel-Liste: Herzschläge, Polling-Set, Uhrfenster.

    „Preise“ heißt hier: alles, was eine neue Influx-Zeile oder ein neues
    Beobachtungsfenster bewirkt. Der Ledger (Store/Archiv), die
    Engine-Veröffentlichung und das Profil gehören **nicht** dazu — sie
    ändern keine Preishistorie (A21-B2.3, #204).
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
    return [
        f"hb:{hb_ts}:{_file_stamp(settings.runtime / 'collector' / 'heartbeat.json')}",
        f"local:{local_ts}",
        f"polling:{_file_stamp(settings.polling)}",
        f"tick:{tick}",
    ]


def prices_version(settings, clock) -> str:
    """Datenstand der **Preisquellen** — Grundlage der Verlaufs-Ablage.

    Der Verlauf (``/series``, Tagesband) hängt an Station, Stadt,
    Kraftstoff, Fensterlänge und diesem Stand — nicht an Litern, Zeitwert,
    Tankstand oder Belegen. Ein Literwechsel oder ein neuer Snapshot darf
    darum keine neue Influx-Query kosten (Audit §3.5: 3,76 s für eine
    Liter-Änderung). Neuer Collector-Poll, neues Polling-Set oder ein neues
    Uhrfenster invalidieren dagegen sofort.
    """
    raw = "|".join(_price_source_parts(settings, clock))
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def data_version(settings, clock) -> str:
    """Billiges Datenstands-Signal für die /overview-Revalidierung.

    Nur Datei-Stats und kurze Inhaltsabdrücke, keine InfluxDB-Queries — der
    Revalidierungspfad muss nicht teurer sein als ein Cache-Treffer. Die
    Overview-Antwort kann sich nur ändern, wenn sich eine ihrer Quellen
    geändert hat:
      - Collector-Heartbeat: letzter Tankerkönig-Poll (Token-Bucket:
        höchstens 1×/300 s) → neue Preise in InfluxDB
      - Engine-/Selektions-Artefakte: neuer Modelllauf
      - Feedback-Store: neue Belege
      - Feedback-Archiv: 90-Tage-Auslagerung (F3-Allzeitbilanz)
      - Profil-Store (A21-B2.3): aktives Profil → Liter/Wallet/Personalisierung
      - Polling-Set: geänderter Stations-Mix
    plus das Uhrzeit-Fenster (siehe OVERVIEW_REVALIDATE_SECONDS).

    Der Stempel je Datei ist ``mtime_ns:Größe:Inhaltsabdruck`` (A21-B2.3):
    „gleiche Sekunde, gleiche Größe“ kann damit nicht mehr kollidieren
    (Audit §3.5), ohne je Request den ganzen Inhalt zu lesen.
    """
    raw = "|".join(
        _price_source_parts(settings, clock)
        + [
            f"engine:{_file_stamp(settings.runtime / 'engine' / 'current.json')}",
            f"selection:{_file_stamp(settings.runtime / 'selection' / 'current.json')}",
            f"feedback:{_file_stamp(settings.runtime / 'feedback' / 'store.json')}",
            f"archive:{_file_stamp(settings.runtime / 'feedback' / 'archive.jsonl')}",
            # A21-B2.3 (#204): Das aktive Profil (Liter, Tankgröße, Verbrauch)
            # geht in Personalisierung und Wallet ein — eine Profiländerung
            # ist damit ein neuer Datenstand für ETags und Lesezustand.
            f"profiles:{_file_stamp(settings.runtime / 'profiles' / 'profiles.json')}",
        ]
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


def read_json_checked(path, max_bytes: int = READ_JSON_MAX_BYTES):
    """Liest ein JSON-Artefakt und nennt den Grund, wenn es nicht geht (O22).

    Rückgabe ``(data, reason)``; ``reason`` ist ``None`` bei Erfolg, sonst
    ``"missing"`` (keine Datei — der normale Leerzustand vor dem ersten Lauf),
    ``"too_large"`` (über ``max_bytes``, also nicht gelesen) oder ``"invalid"``
    (nicht parsebar). Der Unterschied ist der ganze Punkt: „zu groß“ ist ein
    Alarm, „nicht da“ ist ein Zustand.
    """
    try:
        size = path.stat().st_size
    except (OSError, ValueError):
        return None, "missing"
    if size > max_bytes:
        return None, "too_large"
    try:
        return json.loads(path.read_text(encoding="utf-8-sig")), None
    except (OSError, ValueError):
        return None, "invalid"


def read_json(path, default=None):
    """Wie :func:`read_json_checked`, nur ohne Grund — für kleine Artefakte."""
    data, reason = read_json_checked(path)
    return default if reason is not None else data


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


# O23: Veröffentlichung und Selektion werden **je Datenstand** geparst, nicht
# je Anfrage. Vorher parste jede Anfrage die komplette Datei neu: /health
# (Docker-Healthcheck alle 30 s + GUI-Poll) einmal, /stats/summary dreimal
# (Backtest, Güte, Live-Phase) — gemessen 21,7 ms je Health-Aufruf und 90,3 ms
# je Stats-Aufruf auf einer 2,52-MB-Veröffentlichung, davon 88 % ``json.loads``.
#
# Muster: dasselbe wie ``metadata``/``_metadata_stamp`` (Datei-Stempel statt
# TTL) — nur mit ``st_mtime_ns``, damit zwei Läufe innerhalb derselben Sekunde
# (Test-Suite, schnelle Job-Folge) nicht denselben Schlüssel ergeben. Der Pfad
# ist Teil des Schlüssels: Das Memo ist process-global, die App kennt aber
# mehrere Datenverzeichnisse (Tests, Demo-Stapel).
#
# Kosten: Das Memo hält **eine** geparste Veröffentlichung im Speicher —
# gemessen 3,8× die Dateigröße (2,52 MB Datei → 9,6 MB Python-Objekte). Dafür
# fällt der Parse aus jedem Lesepfad; ohne Memo zahlt dieselbe Anfrage ihn
# mehrfach und der Healthcheck dauerhaft.
_PUBLICATION_MEMO: dict[str, Any] = {"key": None, "value": None, "reason": None}
_SELECTION_MEMO: dict[str, Any] = {"key": None, "value": None}
_PUBLICATION_LOCK = threading.Lock()
_SELECTION_LOCK = threading.Lock()
# O37: Was kostet der Parse? Das Lese-Memo (O23) macht ihn selten — aber wenn
# er teuer wird (wachsende Veröffentlichung, O22), soll ``/api/v1/health`` es
# zeigen, bevor es wehtut. Je Artefakt die letzte Messung samt Datenstands-
# Schlüssel: Passt der Schlüssel nicht zum aktuellen Stand, nennt
# ``publication_status`` keine Zahl, statt eine alte als aktuelle auszugeben.
_PARSE_STATS: dict[str, Any] = {"publication": None, "selection": None}


def _memo_stamp(path) -> str:
    """mtime (ns) + Größe + Inode als Memo-Schlüssel — „absent“ ohne Datei.

    Drei Anteile, weil jeder allein eine Lücke hat: Die ``mtime`` kann auf
    manchen Dateisystemen grob auflösen (gemessen: zwei Schreibvorgänge im
    Abstand von Mikrosekunden mit identischem ``st_mtime_ns``), die Größe
    bleibt bei einem gleich langen Artefakt gleich — und die **Inode** ändert
    sich bei jedem Schreiber der App, denn ``engine/storage.write_json``
    ersetzt atomar über Temp-Datei und ``os.replace``. Zusammen gilt: Jeder
    neue Stand wird erkannt; ein veralteter Eintrag kann nur entstehen, wenn
    dieselbe Inode bei gleicher Größe und gleicher (grober) mtime neu
    geschrieben würde — das tut kein Schreiber dieses Projekts.
    """
    try:
        stamp = path.stat()
        return f"{stamp.st_mtime_ns}:{stamp.st_size}:{stamp.st_ino}"
    except (OSError, ValueError):
        return "absent"


def publication_path(settings):
    return Path(settings.runtime) / "engine" / "current.json"


def selection_publication_path(settings):
    return Path(settings.runtime) / "selection" / "current.json"


def _part_matches_entry(part: dict, entry: dict) -> bool:
    """A1: Passt der Inhalt der Stations-Datei zur Index-Zeile?

    Identität (Station/Kraftstoff) muss stimmen, und wenn die Index-Zeile
    einen ``sha256`` trägt, ist zusätzlich der Hash der Datei-Bytes zu
    prüfen. Der Index ist der Commit-Zeiger; sein Inhalt darf nicht still
    von der Datei abweichen (Mischstand oder Beschädigung).
    """
    if not isinstance(part, dict) or not isinstance(part.get("forecast"), dict):
        return False
    row = part["forecast"]
    if entry.get("station_id") is not None and row.get("station_id") != entry.get(
        "station_id"
    ):
        return False
    if (
        entry.get("fuel") is not None
        and str(row.get("fuel") or "").lower() != str(entry.get("fuel")).lower()
    ):
        return False
    return True


def _merge_split_publication(raw: dict, base_dir) -> tuple[dict, str | None]:
    """O22(d)/A1: Index + Stations-Dateien zur gewohnten Bundle-Form fügen.

    Der Index trägt je Prognose einen Zeiger (``file``) und — seit A1 — den
    ``sha256`` der Stations-Datei; die Zeile selbst liegt in der Datei (in
    der neuen Generation unter ``forecasts/generations/<gen>/``). Rückgabe
    ist ``(Bundle, Grund)`` — der Grund ist ``None``, wenn alle Dateien
    lesbar und konsistent waren, sonst der erste Fehlergrund (für
    ``publication_status``: fehlende Stations-Dateien sind ``incomplete``,
    zu große/ungültige ``too_large``/``invalid``, abweichender
    Inhalt/Hash ``corrupt`` — nie das „missing“ des Erstlauf-Zustands).
    Unlesbare/inkonsistente Zeilen fehlen im Bundle und stehen in
    ``skipped_forecast_files`` — laut statt still.
    """
    rows: list[Any] = []
    skipped: list[dict] = []
    reason: str | None = None
    for entry in raw.get("forecasts") or []:
        if not isinstance(entry, dict):
            continue
        rel = entry.get("file")
        if not rel or not isinstance(rel, str):
            rows.append(entry)  # defensive: Inline-Zeile im Index
            continue
        part_path = base_dir / rel
        part, part_reason = read_json_checked(part_path)
        if part_reason is None:
            # A1: Prüfung vor der Annahme — Hash (aus dem Index) und
            # Identität. Eine Datei, die zu ihrer Index-Zeile nicht passt,
            # ist ein Mischstand/Beschädigung, kein lesbarer Inhalt.
            digest = entry.get("sha256")
            if (
                isinstance(digest, str)
                and digest
                and hashlib.sha256(part_path.read_bytes()).hexdigest() != digest
            ):
                part_reason = "corrupt"
            elif not _part_matches_entry(part, entry):
                part_reason = "corrupt"
        row = part.get("forecast") if isinstance(part, dict) else None
        if part_reason is None and isinstance(row, dict):
            rows.append({**row, "file": rel})
        else:
            mapped = {
                "missing": "incomplete",
                "too_large": "too_large",
                "invalid": "invalid",
                "corrupt": "corrupt",
            }.get(part_reason or "invalid", "invalid")
            skipped.append({"file": rel, "reason": mapped})
            reason = reason or mapped
    merged = {**raw, "forecasts": rows}
    if skipped:
        merged["skipped_forecast_files"] = skipped
    return merged, reason


def publication(settings):
    """Veröffentlichung der Prognosen — memoisiert über ``(Pfad, mtime, Größe)``.

    Die Rückgabe ist **gemeinsam genutzt**: Aufrufer lesen sie, sie darf nicht
    verändert werden (``tests/test_o23_parse_budget.py`` hält das fest). Ein
    geänderter Datenstand ersetzt den Eintrag vollständig; ein Parse-Fehler
    liefert ``{}`` und merkt sich den Grund für ``publication_status``.

    Seit O22(d) liegt die Veröffentlichung aufgeteilt (ein Index plus eine
    Datei je Station); die Funktion fügt sie zur gewohnten Form zusammen.
    Alt-Artefakte ohne ``layout``-Kennzeichnung werden unverändert gelesen.
    """
    path = publication_path(settings)
    key = (str(path), _memo_stamp(path))
    with _PUBLICATION_LOCK:
        if _PUBLICATION_MEMO["key"] == key and _PUBLICATION_MEMO["value"] is not None:
            return _PUBLICATION_MEMO["value"]
    from . import metrics

    started = time.monotonic()
    with metrics.measure("publication"):
        raw, reason = read_json_checked(path)
        value = raw if isinstance(raw, dict) else {}
        if reason is None and isinstance(raw, dict):
            if raw.get("layout") == PUBLICATION_LAYOUT_SPLIT:
                value, split_reason = _merge_split_publication(raw, path.parent)
                reason = reason or split_reason
    elapsed_ms = round((time.monotonic() - started) * 1000.0, 1)
    with _PUBLICATION_LOCK:
        _PUBLICATION_MEMO["key"] = key
        _PUBLICATION_MEMO["value"] = value
        _PUBLICATION_MEMO["reason"] = reason
        _PARSE_STATS["publication"] = {
            "key": key,
            "ms": elapsed_ms,
            "at": dt.datetime.now(UTC).isoformat(),
        }
    return value


def clear_publication_cache() -> None:
    """Verwirft beide Lese-Memos (O23).

    Nur für Tests und für Werkzeuge, die die Dateien selbst schreiben und
    sofort den neuen Stand lesen wollen. Im Request-Pfad unnötig: Der
    Datei-Stempel erkennt jede Änderung.
    """
    with _PUBLICATION_LOCK:
        _PUBLICATION_MEMO.update({"key": None, "value": None, "reason": None})
    with _SELECTION_LOCK:
        _SELECTION_MEMO.update({"key": None, "value": None})


def publication_status(settings) -> dict[str, Any]:
    """Größe und Lesbarkeit der Veröffentlichung — ohne Parse (O22).

    Die Antwort nennt die Byte-Größe, das Budget, das Leselimit und den Grund,
    wenn die Datei nicht nutzbar ist. ``/api/v1/health`` zeigt sie, und
    ``app/alarms.py`` macht daraus ``publication_large`` (warn) bzw.
    ``publication_unreadable`` (error).

    Eine **fehlende** Datei ist kein Fehler: Vor dem ersten Modell-Lauf gibt es
    keine Veröffentlichung, und die App sagt das an anderer Stelle
    („noch keine Prognose“). ``reason`` ist dann ``"missing"``, ``error_code``
    bleibt ``None``.
    """
    path = publication_path(settings)
    status: dict[str, Any] = {
        "bytes": None,
        "budget_bytes": PUBLICATION_BUDGET_BYTES,
        "max_bytes": READ_JSON_MAX_BYTES,
        "over_budget": False,
        "readable": False,
        "error_code": None,
        "reason": None,
        # A1: Die Veröffentlichungs-Generation des aktuellen Index — damit
        # GUI/Health benennen können, welchen Stand sie sehen (und alte
        # Generationen im Aufräumen nicht mit neuen verwechseln).
        "generation": None,
        # O37: Dauer des letzten Pars **dieses** Datenstands. None heißt
        # „für den aktuellen Stand hat noch niemand geparst“ — ehrlicher
        # als eine alte Zahl, die als aktuelle aussieht.
        "parse_ms": None,
        "parsed_at": None,
    }
    try:
        size = path.stat().st_size
    except (OSError, ValueError):
        status["reason"] = "missing"
        return status
    status["bytes"] = size
    status["over_budget"] = size > PUBLICATION_BUDGET_BYTES
    if size > READ_JSON_MAX_BYTES:
        status["error_code"] = "publication_unreadable"
        status["reason"] = "too_large"
        return status
    with _PUBLICATION_LOCK:
        memo_key = _PUBLICATION_MEMO["key"]
        memo_reason = _PUBLICATION_MEMO["reason"]
        measured = _PARSE_STATS["publication"]
    stamp = _memo_stamp(path)
    # O37: Die Parse-Dauer gehört zum Datenstand. Passt der Schlüssel nicht
    # zum aktuellen Stand, bleibt ``parse_ms`` None — eine Zahl von einem
    # älteren Stand wäre eine falsche Aussage über diesen.
    if isinstance(measured, dict) and measured.get("key") == (str(path), stamp):
        status["parse_ms"] = measured.get("ms")
        status["parsed_at"] = measured.get("at")
    if memo_reason is not None and memo_key == (str(path), stamp):
        # Ein Parse-Fehler ist per ``stat`` unsichtbar — das Lese-Memo (O23)
        # nennt den Grund, ohne dass diese Prüfung selbst parst.
        status["error_code"] = "publication_unreadable"
        status["reason"] = memo_reason
        return status
    # O22(d): Bei aufgeteilter Veröffentlichung entscheidet jede Stations-
    # Datei einzeln über die Lesbarkeit. Die Zeiger stehen im Index; das
    # Memo hat ihn bereits geparst, sonst holt die Prüfung das nach (der
    # Index ist klein — die Stations-Dateien bleiben bei reinem ``stat``).
    bundle = None
    if memo_key == (str(path), stamp):
        with _PUBLICATION_LOCK:
            bundle = _PUBLICATION_MEMO["value"]
    if not isinstance(bundle, dict) or bundle.get("layout") != PUBLICATION_LAYOUT_SPLIT:
        if isinstance(bundle, dict):
            status["generation"] = bundle.get("generation")
            status["readable"] = True
            return status
        parsed, parse_reason = read_json_checked(path)
        if parse_reason in ("invalid", "too_large"):
            # Kaputter Index: Die Prüfung hat den Grund gerade selbst gesehen —
            # ehrlich melden statt „lesbar“ (das Memo ergänzt ihn sonst erst,
            # nachdem ein anderer Leser geparst hat).
            status["error_code"] = "publication_unreadable"
            status["reason"] = parse_reason
            return status
        if (
            not isinstance(parsed, dict)
            or parsed.get("layout") != PUBLICATION_LAYOUT_SPLIT
        ):
            status["readable"] = True
            return status
        bundle = parsed
    # A1: Die Generations-ID gehört zum Datenstand — sie steht im Index.
    if isinstance(bundle, dict) and bundle.get("generation"):
        status["generation"] = bundle.get("generation")
    total = size
    largest = size
    count = 0
    worst_reason = None
    # A1: Die Merge-Prüfung (Hash/Identität) steht im zusammengeführten
    # Bundle — der Health-Pfad nutzt sie statt die Dateien neu zu hashen.
    if isinstance(bundle, dict):
        for item in bundle.get("skipped_forecast_files") or []:
            item_reason = item.get("reason") if isinstance(item, dict) else None
            worst_reason = worst_reason or item_reason
    for entry in bundle.get("forecasts") or []:
        rel = entry.get("file") if isinstance(entry, dict) else None
        if not rel or not isinstance(rel, str):
            continue
        count += 1
        try:
            part_size = (path.parent / rel).stat().st_size
        except (OSError, ValueError):
            worst_reason = worst_reason or "incomplete"
            continue
        total += part_size
        largest = max(largest, part_size)
        if part_size > READ_JSON_MAX_BYTES:
            worst_reason = worst_reason or "too_large"
    status["bytes"] = total
    status["index_bytes"] = size
    status["file_count"] = count
    status["largest_file_bytes"] = largest
    # Das Budget gilt der einzelnen Datei (der Klippe), nicht der Summe: Die
    # Aufteilung entfernt die Klippe, Gesamtwachstum ist kein Alarm mehr.
    status["over_budget"] = largest > PUBLICATION_BUDGET_BYTES
    if worst_reason is not None:
        status["error_code"] = "publication_unreadable"
        status["reason"] = worst_reason
        return status
    status["readable"] = True
    return status


def selection_publication(settings):
    """Selektions-Artefakt — memoisiert wie :func:`publication` (O23).

    Dieselbe Regel: einmal je Datenstand parsen. ``/api/v1/health`` liest es
    für die Lebenszyklus- und Preis-Zwilling-Alarme, ``/api/v1/selection`` für
    die Antwort; vorher parste jeder der beiden Pfade die Datei selbst.
    """
    path = selection_publication_path(settings)
    key = (str(path), _memo_stamp(path))
    with _SELECTION_LOCK:
        if _SELECTION_MEMO["key"] == key and _SELECTION_MEMO["value"] is not None:
            return _SELECTION_MEMO["value"]
    started = time.monotonic()
    raw, _reason = read_json_checked(path)
    value = raw if isinstance(raw, dict) else {}
    elapsed_ms = round((time.monotonic() - started) * 1000.0, 1)
    with _SELECTION_LOCK:
        _SELECTION_MEMO["key"] = key
        _SELECTION_MEMO["value"] = value
        _PARSE_STATS["selection"] = {
            "key": key,
            "ms": elapsed_ms,
            "at": dt.datetime.now(UTC).isoformat(),
        }
    return value


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
        # die Obergrenze hält die Ablage klein (Einträge sind kleine JSONs).
        # A21-B2.3 (#204): LRU mit gezielter Verdrängung — das frühere
        # ``clear()`` bei 64 Einträgen warf auch den gerade gültigen Stand
        # weg und ließ den nächsten Poll neu rechnen (Audit §3.5).
        self.overview_cache = OrderedDict()
        # A21-B2.3 (#204): Verlauf/Tagesband je *Datenabhängigkeit*
        # (Station, Stadt, Kraftstoff, Fenster, Datenstand) — nicht je
        # Parameter. Dieselbe Ablage für Einzel- und Overview-Pfad.
        self.series_cache = OrderedDict()
        self.series_lock = threading.Lock()
        self.series_inflight = {}
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
    # /overview-Antworten je ETag vorhalten; die älteste fällt gezielt
    # heraus, statt bei Erreichen der Grenze alles zu leeren.
    OVERVIEW_MAX_ENTRIES = 64

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
            # I3: city is a field, not a tag — grouping by it would split a
            # rename into two series and drop the latest price.
            query += (
                '  |> group(columns: ["station_id"])'
                '\n  |> sort(columns: ["_time"])\n  |> tail(n: 1)\n'
            )
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
        implausible_seen = []
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
            # O35: Derselbe Schutz wie im Trainings- und Belegpfad. Ein Wert
            # außerhalb 0,40–5,00 €/L ist eine Beobachtung, aber kein Preis —
            # er wird nicht publiziert (weder ``price`` noch ``last_price``,
            # sonst stünde das Artefakt als „letzter bekannter Preis“ in der
            # Karte), sortiert sich damit nicht an die Spitze, und der
            # Vorfall wird gezählt statt verschwiegen. ``normalized_row``
            # filtert den Wert bereits aus ``price`` heraus und liefert ihn
            # als ``raw_price`` mit — hier wird das Schweigen gebrochen.
            implausible_value = None
            if row and not row.get("price") and row.get("raw_price") is not None:
                raw_value = row["raw_price"]
                if not plausible_price(raw_value):
                    implausible_value = raw_value
                    implausible_seen.append(
                        {
                            "station_id": identity[1],
                            "city": identity[0],
                            "fuel": fuel,
                            "value": implausible_value,
                            "observed_at": row["timestamp"],
                            "recorded_at": now.isoformat(),
                        }
                    )
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
                    "implausible_price": implausible_value,
                }
            )
        try:
            _record_implausible_observations(self.settings, implausible_seen, now=now)
        except Exception:
            pass  # Zählen darf nie den Antwort-Pfad sprengen
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

    # --- Verlauf/History: Ablage am Datenstand, nicht an den Parametern ----
    #
    # Der Verlauf hängt an Station, Stadt, Kraftstoff, Fensterlänge und
    # Datenstand — **nicht** an Litern, Zeitwert oder Tankstand. Ein
    # Parameterwechsel („41,25 statt 55 Liter“) darf darum keine neue
    # Influx-Query auslösen (Audit §3.5: 3,76 s für genau diesen Fall).
    SERIES_MAX_ENTRIES = 12
    # Ein kaputter Read ist kein Datenstand: Fehler werden höchstens so
    # lange ausgeliefert, danach versucht es der nächste Request erneut.
    SERIES_ERROR_TTL_S = 5.0
    # Mitläufer warten höchstens so lange auf den Singleflight-Eigentümer;
    # danach rechnen sie selbst (keine Anfrage wartet unbegrenzt).
    SERIES_WAIT_TIMEOUT_S = 15.0

    def _series_revision(self) -> str:
        """Preisdatenstand, an dem der Verlauf hängt (ohne Ledger/Profil)."""
        try:
            return prices_version(self.settings, self.clock)
        except Exception:
            return "unknown"

    def _series_cached(self, key):
        """Ablagetreffer — ``None``, wenn nichts (mehr) Gültiges daliegt.

        Fehlereinträge verfallen nach :data:`SERIES_ERROR_TTL_S`; danach
        wird neu gelesen statt den Fehler zu wiederholen.
        """
        with self.series_lock:
            entry = self.series_cache.get(key)
            if entry is None:
                return None
            mono, cached = entry
            if cached.get("error_code") is not None and (
                time.monotonic() - mono > self.SERIES_ERROR_TTL_S
            ):
                del self.series_cache[key]
                return None
            self.series_cache.move_to_end(key)
            # Flache Kopie: ``day_with_band`` ersetzt Felder im Ergebnis —
            # die Ablage darf davon nichts sehen.
            return dict(cached)

    def series(self, uid, city, fuel, hours=24):
        if fuel not in FUELS or not 1 <= hours <= 168:
            raise ValueError("invalid_query")
        metas, problem = metadata(self.settings)
        if (city, uid) not in metas:
            raise ValueError("unknown_station")
        if problem or not self.settings.influx_env.is_file():
            # Konfigurationszustand, kein Datenstand: nicht ablegen (billig
            # zu beantworten, und ein Fix wirkt sofort).
            return {
                "points": [],
                "n_points": 0,
                "range_from": None,
                "range_to": None,
                "error_code": problem or "influx_not_configured",
            }
        key = (uid, city, fuel, hours, self._series_revision())
        cached = self._series_cached(key)
        if cached is not None:
            return cached
        with self.series_lock:
            event = self.series_inflight.get(key)
            if event is None:
                event = threading.Event()
                self.series_inflight[key] = event
                owner = True
            else:
                owner = False
        if not owner:
            # Singleflight: parallele identische Misses erzeugen **eine**
            # Query. Der Eigentümer hinterlässt immer ein Ergebnis (auch
            # einen Fehler); erst wenn er nichts hinterlässt, rechnet
            # dieser Thread selbst.
            event.wait(self.SERIES_WAIT_TIMEOUT_S)
            cached = self._series_cached(key)
            if cached is not None:
                return cached
        try:
            result = self._read_series(uid, city, fuel, hours)
            # Erst ablegen, dann die Mitläufer wecken — sonst wachen sie
            # auf, finden nichts und rechnen doppelt.
            with self.series_lock:
                self.series_cache[key] = (time.monotonic(), result)
                self.series_cache.move_to_end(key)
                while len(self.series_cache) > self.SERIES_MAX_ENTRIES:
                    # Gezielt die älteste Ablage verdrängen — kein clear(),
                    # das auch den gerade gültigen Stand wegwirft.
                    self.series_cache.popitem(last=False)
        finally:
            with self.series_lock:
                waiter = self.series_inflight.pop(key, None)
            if waiter is not None:
                waiter.set()
        return dict(result)

    def _read_series(self, uid, city, fuel, hours):
        """Die Influx-Query hinter :meth:`series` (ein Aufruf je Ablage-Miss)."""
        now = self.clock()
        try:
            from . import metrics

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
            # A21-B2.1: Der Influx-Read ist ein eigener Span. Auf dem NAS
            # hängt er an Netz/DB und ist keine Rechenzeit des Requests.
            with metrics.measure("history"):
                rows = list(self.query(cfg, query))
            for raw in rows:
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

    def _performance(self) -> dict[str, Any]:
        """Latenz- und Sperren-Blick für ``/api/v1/health`` (O37).

        ``app/metrics`` fasst die ``X-Process-Time``-Werte der letzten
        Antworten zusammen (p95, Maximum, langsamste Route, Budget aus
        ``docs/entwicklung/QUALITAET.md``); der Sperren-Zähler kommt aus ``app.feedback``
        und zeigt, ob ein Lesepfad wieder die Store-Sperre nimmt (O26).
        Beide Teile sind optional: Fällt einer aus, fehlt er hier — /health
        darf an der Selbstmessung nicht scheitern.
        """
        from . import metrics

        performance: dict[str, Any] = dict(metrics.summary())
        try:
            from .feedback import lock_stats

            performance["store_lock"] = lock_stats()
        except Exception:
            performance["store_lock"] = None
        return performance

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

        # O33: Backup-Alterung — einmal lesen, derselbe Stand dient dem
        # Alarm-Block und dem Health-Payload (kein zweiter Scan).
        try:
            from .backup import backup_status

            backup = backup_status(self.settings, clock=self.clock)
        except Exception:
            backup = {"configured": False, "stale": False, "reason": None}

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
                clock=self.clock,
                backup=backup,
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
                # B2: technische PIT-Rekalibrierung je veröffentlichter
                # Station. Sie ist nicht mit der M7-Produktfreigabe identisch.
                "calibrated": bool(bundle.get("calibrated", False)),
                "decision_ready": False,
            },
            # O22: Größe und Lesbarkeit der Veröffentlichung. Die Klippe war
            # vorher unsichtbar — eine Datei über dem Leselimit fällt als
            # ``{}`` aus, also als „noch keine Daten“, während der Modell-Job
            # Erfolg meldet. ``bytes``/``budget_bytes``/``max_bytes`` sagen,
            # wie nah der Betrieb daran ist (``alarms[]`` schlägt an).
            "publication": publication_status(self.settings),
            # O37: Selbstmessung — Latenz-Fenster der letzten Antworten
            # (``app/metrics.py``, dasselbe, was ``X-Process-Time`` je Antwort
            # sagt) plus Sperren-Zähler des persönlichen Speichers (O26).
            # Beides ist billig und macht O22/O23/O26 im Betrieb sichtbar,
            # bevor sie wehtun: Eine Antwort, die 900 ms braucht, weil eine
            # Datei gewachsen ist, steht hier, nicht nur im Gefühl.
            "performance": self._performance(),
            # O35: Live-Preise außerhalb 0,40–5,00 €/L werden nicht als Preis
            # publiziert, aber gezählt — hier der Stand der letzten 24 h,
            # damit ein API-Artefakt sichtbar wird statt still zu sortieren.
            "price_implausible": implausible_price_status(
                self.settings, clock=self.clock
            ),
            # O33: Alter des letzten Laufzeit-Backups. ``configured: false``
            # heißt „nicht überwacht“ und ist bewusst kein Alarm — aber es
            # steht hier, statt unsichtbar zu bleiben.
            "backup": backup,
            # O39: Wer im LAN die eigenen Belege lesen kann, ist eine
            # Entscheidung (docs/betrieb/BETRIEB.md), keine Nebenwirkung der
            # Bind-Zeile. ``read_protected: true`` heißt: die persönlichen
            # Routen (Belege, Bilanz, Tagebuch, Profile, Episoden, Overview)
            # antworten nur mit ``TANKAPP_READ_TOKEN``; false = offen wie
            # bisher. Markt- und Modelldaten sind nie betroffen.
            "personal_data": {
                "read_protected": bool(getattr(self.settings, "read_token", "")),
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
                # B2 ist ein Modellzustand, nicht die M7-Produktfreigabe.
                # Die gespeicherte Hülle wird durch die Engine validiert,
                # statt ein beliebiges ``calibrated: true`` aus JSON zu
                # vertrauen.
                "calibration": row.get("calibration"),
                "calibration_candidate": row.get("calibration_candidate"),
                "calibrated": _calibration_active(row.get("calibration")),
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
            slim["calibrated"] = _calibration_active(row.get("calibration"))
            valid_forecasts.append(slim)

        return {
            "generated_at": bundle.get("published_at"),
            "forecasts": valid_forecasts,
            "count": len(valid_forecasts),
            # Nur wenn jede übertragene Station eine *valide* aktive Hülle
            # trägt. ``decision_ready`` bleibt ausschließlich M7 vorbehalten.
            "calibrated": bool(valid_forecasts)
            and all(row["calibrated"] for row in valid_forecasts),
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

        B30: Beobachtungen **vor** der 12-Uhr-Bodenkante
        (``app/law.py``, aus ``TANKAPP_PRICE_LAW_LOCAL``) zählen nicht mit —
        sie beschreiben die Rechtslage vor dem Gesetz. ``law_floor`` und
        ``points_before_law`` im Payload machen den Schnitt sichtbar.
        """
        from .heatmap import BASES as HEATMAP_BASES, build_heatmap
        from .law import law_floor_utc

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

        result = build_heatmap(
            points,
            kind=kind,
            station_id=station_id,
            basis=basis,
            law_floor=law_floor_utc(self.settings),
        )

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
            # B30: Bodenkante der 12-Uhr-Regel — worauf diese Heatmap steht
            # und wie viele nutzbare Preise davor ausgeblendet sind.
            "law_floor": result["law_floor"],
            "points_before_law": result["points_before_law"],
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
            # B30: Bodenkante der 12-Uhr-Regel — der Stadt-Eintrag, wenn eine
            # Stadt gewählt ist, sonst die Fuel-Aggregation (compute_all).
            # Altbestände ohne die Felder liefern None; die GUI zeigt dann
            # keine Kanten-Zeile, statt eine Reichweite zu erfinden.
            law_source = city_entry if (city and city_entry) else fuel_data
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
                # B30: worauf dieses Ranking steht — Kante der 12-Uhr-Regel
                # und wie viele Beobachtungen (über wie viele Tage) davor
                # ausgeblendet sind.
                "law_floor": law_source.get("law_floor"),
                "points_before_law": law_source.get("points_before_law"),
                "days_before_law": law_source.get("days_before_law"),
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
            # Zwei Fälle ohne by_fuel (O41): (1) read_selection meldet „kein
            # Artefakt“ als Daten — leere Listen und der Grund, keine
            # erfundenen Felder; (2) ein Altbestand vor der by_fuel-Ära mit
            # flacher Stationsliste, den kein Schreiber mehr erzeugt —
            # gefiltert nach Kraftstoff/Stadt wie bisher.
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

    def _store_corrupted_payload(self) -> dict[str, Any]:
        """S3: Fehlerbild eines defekten Ledger-Stores — mit Rettungsangebot.

        Der Defekt wird nicht als leerer Store durchgereicht (stiller
        Datenverlust), sondern benannt; ``quarantine``/``backup`` nennen, was
        zur Wiederherstellung da ist.
        """
        from .feedback import store_recovery_options

        return {
            "error_code": "store_corrupted",
            **store_recovery_options(self.settings),
        }

    def _profiles_corrupted_payload(self) -> dict[str, Any]:
        """S3: Fehlerbild eines defekten Profil-Stores (analogs zum Ledger)."""
        from .profiles import profiles_recovery_options

        return {
            "error_code": "profiles_corrupted",
            **profiles_recovery_options(self.settings),
        }

    def _store_corrupted_payload(self) -> dict[str, Any]:
        """S3: Fehlerbild eines defekten Ledger-Stores — mit Rettungsangebot.

        Der Defekt wird nicht als leerer Store durchgereicht (stiller
        Datenverlust), sondern benannt; ``quarantine``/``backup`` nennen, was
        zur Wiederherstellung da ist.
        """
        from .feedback import store_recovery_options

        return {
            "error_code": "store_corrupted",
            **store_recovery_options(self.settings),
        }

    def _archive_corrupted_payload(self) -> dict[str, Any]:
        """A21-B3.1: Fehlerbild eines defekten Archivs — mit Rettungsangebot.

        Gleiches Muster wie beim Store: Das Archiv geht in Allzeitbilanz und
        M7 ein; ein Defekt darin ist keine leere Auslage, sondern ein
        benannter Zustand. ``quarantine`` führt die Archiv-Kopie, ``backup``
        den letzten gesicherten Stand.
        """
        from .feedback import store_recovery_options

        return {
            "error_code": "archive_corrupted",
            **store_recovery_options(self.settings),
        }

    def decide(self, params: dict, read=None):
        """Entscheidungs-API — GET /api/v1/decide (Konzept §4, §11.1).

        ``read`` ist der gemeinsame Lesezustand (A21-B2.2): ``/overview``
        reicht ihn an ``decide`` **und** ``stats_summary`` weiter.
        """
        try:
            from .decide import evaluate_decide
            from .feedback import ArchiveCorrupted, StoreCorrupted, StoreTooLarge

            return evaluate_decide(self, params, read=read)
        except ValueError as e:
            raise e
        except StoreTooLarge:
            return {"error_code": "store_too_large"}
        except StoreCorrupted:
            return self._store_corrupted_payload()
        except ArchiveCorrupted:
            # A21-B3.1: Das Archiv geht in die Allzeitbilanz und in M7 ein —
            # ein Defekt darin ist kein „weniger Daten“, sondern keiner.
            return self._archive_corrupted_payload()
        except Exception as exc:
            # O44: „decide_failed“ war das Ende der Diagnose — die Ursache
            # steckte in einem stummen ``except``, während die GUI nur einen
            # Code zeigte (Befund 17.09.2026: ``TypeError`` an ``null``-Draws).
            # Die bereinigte Ursache (ohne Pfade/Token, app/errors.py) geht
            # jetzt in den Container-Log **und** als ``detail`` in die Antwort
            # — dieselbe Sprache wie ``error_detail`` der Jobs
            # (app/worker.py), dieselbe Anzeige („Ursache: …“, JobCard).
            from .errors import public_detail

            detail = public_detail(exc)
            print(f"decide: fehlgeschlagen — {detail}", flush=True)
            return {"error_code": "decide_failed", "detail": detail}

    def episodes(self, status: str | None = None):
        """Liefert Episoden (z. B. ?status=due für Due-Prompt beim Öffnen)."""
        try:
            from .feedback import StoreCorrupted, StoreTooLarge, load_store

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
        except StoreCorrupted:
            # S3: Defekt ist kein „leeres Tagebuch“ — ehrlicher Code statt
            # einer leeren Liste, die nach „noch nichts da“ aussieht.
            return {**self._store_corrupted_payload(), "episodes": [], "count": 0}
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
            from .feedback import (
                StoreCorrupted,
                StoreTooLarge,
                load_store,
                snapshot_p_source,
            )

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
                        # O5: Herkunft der versprochenen P — dieselbe Quelle,
                        # über die der Brier getrennt ausgewiesen wird.
                        "p_source": snapshot_p_source(snap),
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
        except StoreCorrupted:
            return {**self._store_corrupted_payload(), "entries": [], "count": 0}
        except Exception:
            return {"error_code": "diary_read_failed", "entries": [], "count": 0}

    def set_intent(self, episode_id: str, intent: str):
        """Setzt den Intent einer Episode (wait, navigate, refuel_now, dismiss)."""
        try:
            from .feedback import StoreCorrupted, StoreTooLarge, set_intent

            res = set_intent(self.settings, episode_id, intent, clock=self.clock)
            return res
        except StoreTooLarge:
            return {"error_code": "store_too_large"}
        except StoreCorrupted:
            return self._store_corrupted_payload()
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
            from .feedback import (
                ArchiveCorrupted,
                StoreCorrupted,
                StoreTooLarge,
                record_fill,
            )

            return record_fill(
                self.settings, fill_data, live_data=self, clock=self.clock
            )
        except StoreTooLarge:
            return {"error_code": "store_too_large"}
        except StoreCorrupted:
            # S3: Defekt blockiert das Schreiben — kein Beleg geht verloren,
            # aber auch keiner wird über den Defekt geschrieben.
            return self._store_corrupted_payload()
        except ArchiveCorrupted:
            # A21-B3.1: Die Retention kann das defekte Archiv nicht
            # fortsetzen — der Beleg ist nicht gebucht (Aufrufer hat den
            # Fehler), der Bestand bleibt unverändert.
            return self._archive_corrupted_payload()
        except ValueError as exc:
            # Fach-Codes aus der Validierung (invalid_liters, invalid_price,
            # unknown_station, price_not_available, …) statt Pauschal-Fehler.
            return {"error_code": str(exc) or "invalid_query"}
        except Exception:
            return {"error_code": "record_fill_failed"}

    def fills(self):
        """Wallet-Verlauf: alle Tankbelege (auch stornierte, mit ``voided``-Flag)."""
        try:
            from .feedback import StoreCorrupted, StoreTooLarge, load_store

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
        except StoreCorrupted:
            return {**self._store_corrupted_payload(), "fills": [], "count": 0}
        except Exception:
            return {"error_code": "fills_read_failed", "fills": [], "count": 0}

    def void_fill(self, fill_id: str):
        """Storniert einen Beleg (A3) — Flag statt Löschen, mit Audit-Spur."""
        try:
            from .feedback import (
                ArchiveCorrupted,
                StoreCorrupted,
                StoreTooLarge,
                void_fill,
            )

            return void_fill(self.settings, fill_id, clock=self.clock)
        except StoreTooLarge:
            return {"error_code": "store_too_large"}
        except StoreCorrupted:
            return self._store_corrupted_payload()
        except ArchiveCorrupted:
            return self._archive_corrupted_payload()
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
            from .feedback import (
                ArchiveCorrupted,
                StoreCorrupted,
                StoreTooLarge,
                compute_wallet_balance,
                load_ledger,
            )

            store = load_ledger(self.settings)
            balance = compute_wallet_balance(store, now=self.clock())
            balance["error_code"] = None
            return balance
        except StoreTooLarge:
            return {"error_code": "store_too_large"}
        except StoreCorrupted:
            return self._store_corrupted_payload()
        except ArchiveCorrupted:
            # A21-B3.1: Monats-/Jahresbilanz rechnet über Store **plus**
            # Archiv — ein Defekt darf nicht als runde Teilbilanz durchgehen.
            return self._archive_corrupted_payload()
        except Exception:
            return {"error_code": "fills_summary_failed"}

    # --- A1: Fahrzeug-/Haushaltsprofile (ohne Login, serverseitig) ---

    def profiles(self):
        try:
            from .profiles import ProfileStoreCorrupted, load_store, public_profiles

            return public_profiles(load_store(self.settings))
        except ProfileStoreCorrupted:
            return {
                **self._profiles_corrupted_payload(),
                "profiles": [],
                "active": None,
            }
        except Exception:
            return {
                "error_code": "profiles_read_failed",
                "profiles": [],
                "active": None,
            }

    def create_profile(self, payload: dict):
        try:
            from .profiles import ProfileError, ProfileStoreCorrupted, create_profile

            return create_profile(self.settings, payload, clock=self.clock)
        except ProfileError as exc:
            return {"error_code": str(exc) or "invalid_query"}
        except ProfileStoreCorrupted:
            return self._profiles_corrupted_payload()
        except Exception:
            return {"error_code": "profile_write_failed"}

    def update_profile(self, profile_id: str, payload: dict):
        try:
            from .profiles import (
                ProfileError,
                ProfileStoreCorrupted,
                update_profile,
            )

            return update_profile(self.settings, profile_id, payload, clock=self.clock)
        except ProfileError as exc:
            return {"error_code": str(exc) or "invalid_query"}
        except ProfileStoreCorrupted:
            return self._profiles_corrupted_payload()
        except Exception:
            return {"error_code": "profile_write_failed"}

    def activate_profile(self, profile_id: str | None):
        try:
            from .profiles import ProfileError, ProfileStoreCorrupted, activate_profile

            return activate_profile(self.settings, profile_id)
        except ProfileError as exc:
            return {"error_code": str(exc) or "invalid_query"}
        except ProfileStoreCorrupted:
            return self._profiles_corrupted_payload()
        except Exception:
            return {"error_code": "profile_write_failed"}

    def delete_profile(self, profile_id: str):
        try:
            from .profiles import ProfileError, ProfileStoreCorrupted, delete_profile

            return delete_profile(self.settings, profile_id)
        except ProfileError as exc:
            return {"error_code": str(exc) or "invalid_query"}
        except ProfileStoreCorrupted:
            return self._profiles_corrupted_payload()
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

    def stats_summary(self, params: dict, read=None):
        """Drei-Schichten-Statistik: Markt-Backtest, Live-Advice, Wallet.

        ``read`` (A21-B2.2) ist der gemeinsame Lesezustand aus ``/overview``.
        """
        try:
            from .feedback import ArchiveCorrupted, StoreCorrupted, StoreTooLarge
            from .stats_summary import evaluate_stats_summary

            return evaluate_stats_summary(self, params, read=read)
        except StoreTooLarge:
            return {"error_code": "store_too_large"}
        except StoreCorrupted:
            # S3: Wallet-/Advice-Teil fehlt bei Defekt — der Markt-Backtest
            # allein wäre eine halbe Bilanz; ehrlicher Code statt leeren
            # Zählern.
            return self._store_corrupted_payload()
        except ArchiveCorrupted:
            # A21-B3.1: dasselbe für das Archiv — die Kennzahlen rechnen auf
            # dem gemergten Ledger, einem Defekt darf keine Teilstatistik
            # folgen, die wie eine vollständige aussieht.
            return self._archive_corrupted_payload()
        except Exception:
            return {"error_code": "stats_summary_failed"}

    def read_etag(self, route: str, params: dict) -> str | None:
        """ETag eines read-only-Endpunkts — Datenstand + Route + Parameter (O25).

        Billig berechenbar: ``data_version()`` stempelt Datei-Stats und kurze
        Inhaltsabdrücke (je Datei höchstens 64 KiB), keine Influx-Query. Die Route gehört in den Wert, damit zwei Endpunkte beim
        selben Datenstand nicht dasselbe ETag tragen (ein Client, der beide
        pollt, bekäme sonst ein 304 für die falsche Antwort).

        Revalidierung ist nur möglich, wenn ``data_version()`` läuft; sonst
        None (ehrlicher Fallback: kein 304, die Antwort wird immer berechnet).
        """
        try:
            version = data_version(self.settings, self.clock)
        except Exception:
            return None
        canonical = json.dumps(params, sort_keys=True, ensure_ascii=False, default=str)
        raw = f"{version}|{route}|{canonical}"
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()

    def overview_etag(self, params: dict) -> str | None:
        """ETag für /overview — dieselbe Regel wie :meth:`read_etag` (B7)."""
        return self.read_etag("/api/v1/overview", params)

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
                    self.overview_cache.move_to_end(etag)
            if cached is not None:
                # A21-B1.4: Eine abgelaufene Freigabe darf aus keinem Cache
                # erneut erscheinen — der Treffer endet am ``valid_until`` der
                # mitgelieferten Aktion (Issue 201). ``no_advice`` altert
                # nicht und bleibt ein Treffer.
                from .decide import release_still_valid

                if release_still_valid(cached.get("decide"), self.clock()):
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
                day_res = self.day_with_band(station_id, city, fuel)

        from . import metrics, read_state
        from .feedback import ArchiveCorrupted, StoreCorrupted, StoreTooLarge

        # A21-B2.2 (#203): **ein** Lesezustand für diesen Request. Decide und
        # Stats-Summary teilen Ledger, Statistik und Schwellen; der
        # Snapshot-Vorblick benutzt denselben heißen Store.
        # A21-B3.1: Ein defekter Store oder Archiv wirft die ganze Antwort
        # nicht mehr auf 500 — ``decide`` und ``stats_summary`` laden ihren
        # eigenen Zustand, scheitern benannt und laufen als ``partial_errors``
        # mit; die unbeschädigten Teile (fills, episodes, day) bleiben.
        try:
            bundle = read_state.load_bundle(self.settings, self.clock())
        except (StoreCorrupted, StoreTooLarge, ArchiveCorrupted):
            bundle = None

        with metrics.measure("decide"):
            decide_res = self.decide(decide_params, read=bundle)
        fills_res = self.fills()
        summary_params = {"fuel": fuel}
        if city:
            summary_params["city"] = city
        with metrics.measure("stats"):
            summary_res = self.stats_summary(summary_params, read=bundle)
        episodes_res = self.episodes("due")

        # Explizite Teilfehler: ``error_code`` außen bleibt die Aussage über
        # die **Anfrage**, ist aber kein Vollständigkeitsnachweis (Audit
        # §4.3) — eine Komponente kann fehlschlagen, während außen ``null``
        # steht. ``partial_errors`` benennt sie, ``data_version`` die
        # Revision, aus der alle Teile stammen.
        # Alle Teile, die einen Fehlercode tragen können — auch ``fills`` und
        # ``episodes``: Sonst bliebe genau der Fall verdeckt, den der Audit
        # §4.3 zeigte (innen Fehler, außen ``null``).
        partial_errors = [
            {"component": component, "error_code": code}
            for component, code in (
                ("day", (day_res or {}).get("error_code")),
                ("decide", (decide_res or {}).get("error_code")),
                ("stats_summary", (summary_res or {}).get("error_code")),
                ("fills", (fills_res or {}).get("error_code")),
                ("episodes", (episodes_res or {}).get("error_code")),
            )
            if code
        ]

        result = {
            "generated_at": self.clock().isoformat(),
            # Ohne Lesezustand (defekter Store/Archiv) bleibt der Datenstand
            # trotzdem ehrlich: ``data_version`` stempelt nur Datei-Stats,
            # liest den Ledger-Inhalt nicht.
            "data_version": (
                bundle.data_version
                if bundle is not None
                else data_version(self.settings, self.clock)
            ),
            "partial_errors": partial_errors,
            "decide": decide_res,
            "fills": fills_res,
            "stats_summary": summary_res,
            "episodes": episodes_res,
            "day": day_res,
            "error_code": None,
        }
        if etag:
            with self.lock:
                self.overview_cache[etag] = result
                self.overview_cache.move_to_end(etag)
                while len(self.overview_cache) > self.OVERVIEW_MAX_ENTRIES:
                    self.overview_cache.popitem(last=False)
        return result

    def day_with_band(self, station_id: str, city: str, fuel: str) -> dict:
        """O20: Tageskurve **plus** feste Tonlagen-Skala aus einer Abfrage.

        Der Alltag brauchte bisher 24 h (`day.points`); die Farbskala des
        Tagesstreifens braucht einen Bezugszeitraum, der sich nicht mit jeder
        neuen Meldung verschiebt. Zwei Abfragen (24 h + 168 h) wären doppelte
        Kosten im meistgenutzten Pfad — deshalb **eine** Abfrage über
        ``STRIP_BAND_HOURS``, aus der die Tageskurve geschnitten und das Band
        gerechnet wird. Die Antwortform von ``series`` bleibt erhalten
        (``points``/``n_points``/``range_from``/``range_to``/``error_code``,
        jetzt über die 24 h), neu ist ``band``.
        """
        result = self.series(station_id, city, fuel, STRIP_BAND_HOURS)
        points = result.get("points") or []
        cutoff = self.clock() - dt.timedelta(hours=DAY_SERIES_HOURS)
        day_points: list[dict[str, Any]] = []
        band_prices: list[float] = []
        band_days: set[dt.date] = set()
        for point in points:
            price = point.get("price")
            stamp_raw = point.get("timestamp")
            try:
                stamp = dt.datetime.fromisoformat(str(stamp_raw))
            except (TypeError, ValueError):
                continue
            if isinstance(price, (int, float)) and math.isfinite(float(price)):
                band_prices.append(float(price))
                band_days.add(stamp.astimezone(BERLIN_TZ).date())
            if stamp >= cutoff:
                day_points.append(point)
        priced = [p for p in day_points if p.get("price") is not None]
        result["points"] = day_points
        result["n_points"] = len(priced)
        result["range_from"] = priced[0]["timestamp"] if priced else None
        result["range_to"] = priced[-1]["timestamp"] if priced else None
        result["band"] = price_band(band_prices, days=len(band_days))
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
