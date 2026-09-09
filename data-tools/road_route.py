#!/usr/bin/env python3
"""
TankApp – Straßen-Routing (OSRM) für echte Fahrstrecken statt Luftlinie.

Die Selektion rechnet die Umweg-Ökonomie (KONZEPT.md §7) bisher mit
**Luftlinie × Circuity-Faktor 1,3**. Das ist eine grobe Näherung: die
tatsächliche Straße schlängelt sich, Einbahnstraßen erzwingen Umwege, und
die Fahrzeit hängt nicht nur von der Kilometerzahl ab. Dieses Modul fragt
deshalb einen **OSRM-Server** (Open Source Routing Machine, Datenbasis
OpenStreetMap) nach echter Route (Distanz + Fahrzeit) ab — kostenlos,
ohne API-Key.

* Standard-Server: der öffentliche Demo-Server `router.project-osrm.org`
  (Fair use: für den privaten Wochenlauf über ein paar hundert Stationen
  völlig ok; keine Garantie, bitte nicht als Produktiv-API missbrauchen).
* Alternativ eigener Server (Docker, ein Befehl, komplett offline auf dem
  NAS): `docker run -t -i -p 5000:5000 osrm/osrm-backend osrm-routed
  --algorithm mld /data/germany-latest.osrm` und `--osrm-url
  http://mein-nas:5000`.
* Anfragen gehen als **Table-API-Batch** (1 Aufruf je 100 Ziele, ein
  gemeinsamer Start = Anker) und werden lokal gecacht
  (`results/road_route_cache.json`) -> wiederholte Läufe sind offline.
* Fällt der Server aus (kein Netz, kaputte Antwort), wird automatisch auf
  Luftlinie × Circuity zurückgefallen — die Pipeline läuft immer durch.

Nur Standardbibliothek (urllib) -> läuft auf Pi, NAS-Shell und PC.

    from road_route import RoadRouter
    rr = RoadRouter(mode="driving", cache_path=Path("results/road_route_cache.json"))
    d_km, t_min = rr.route_one(home_lat, home_lon, st_lat, st_lon)   # Einzelabfrage
    res = rr.routes_from(home_lat, home_lon, [(lat, lon), ...])      # Batch {idx: (km, min)}
"""

from __future__ import annotations

import argparse
import json
import math
import re as _re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

EARTH_R_KM = 6371.0088
DEFAULT_OSRM_URL = "https://router.project-osrm.org"
TABLE_BATCH = 100
# Straße/Luftlinie über diesem Faktor ist in der Stadt praktisch immer ein
# Snapping-Artefakt (Punkt rastet auf eine Autobahnrampe/-kante ein, von der
# man erst in die falsche Richtung muss), keine echte Route. Stadt < 1,5,
# Region bis ~2,0; > 2,3 -> Anker/Stationspunkt auf die Hausstraße setzen.
CIRCUITY_WARN = 2.3
# Deutsche Autobahn-Kennzeichnung (A5, A648 …) im OSM 'ref'-Feld.
_AUTOBAHN_RE = _re.compile(r"^A\s?\d{1,3}")


def google_directions_link(olat: float, olon: float,
                           dlat: float, dlon: float) -> str:
    """Google-Maps-Routenlink (eigene Google-Strecke zum direkten Vergleich)."""
    return (f"https://www.google.com/maps/dir/?api=1"
            f"&origin={olat:.6f},{olon:.6f}&destination={dlat:.6f},{dlon:.6f}")


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * EARTH_R_KM * math.asin(math.sqrt(a))


def _key(profile: str, alat: float, alon: float, blat: float, blon: float) -> str:
    """Cache-Schlüssel: Profil + gerundete Koordinaten (5 Nachkommastellen ~1 m)."""
    return f"{profile}|{alat:.5f},{alon:.5f}|{blat:.5f},{blon:.5f}"


class RoadRouter:
    """Holt Straßen-Distanzen/Fahrzeiten von OSRM, mit Datei-Cache und Fallback."""

    def __init__(self, mode: str = "driving", base_url: str | None = None,
                 cache_path: Path | None = None, circuity: float = 1.3,
                 timeout: int = 30, quiet: bool = False):
        self.mode = mode                      # 'driving' | 'walking' | 'cycling'
        self.profile = {"driving": "car", "walking": "foot",
                        "cycling": "bike"}.get(mode, "car")
        self.base_url = (base_url or DEFAULT_OSRM_URL).rstrip("/")
        self.cache_path = cache_path
        self.circuity = circuity              # nur für den Luftlinie-Fallback
        self.timeout = timeout
        self.quiet = quiet
        self.cache: dict[str, dict] = {}
        self.hits = self.misses = self.fallbacks = 0
        # Strecken mit auffällig hohem Straße/Luftlinie-Faktor (Snapping-Verdacht):
        # Liste von (Index, faktor, dist_km). Aufruf liest das nach routes_from().
        self.suspicious: list[tuple[int, float, float]] = []
        # Ergebnis des Anker-Snap-Checks (erste Streckenabschnitte); None =
        # nicht geprüft / Server nicht erreichbar.
        self.anchor_snap: dict | None = None
        if cache_path:
            self._load_cache()

    # ------------------------------------------------------------ Cache
    def _load_cache(self) -> None:
        try:
            if self.cache_path and self.cache_path.exists():
                self.cache = json.loads(self.cache_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            self.cache = {}

    def _save_cache(self) -> None:
        if not self.cache_path:
            return
        try:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.cache_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.cache, ensure_ascii=False),
                          encoding="utf-8")
            tmp.replace(self.cache_path)
        except OSError:
            pass

    # ------------------------------------------------------------ Fallback
    def _fallback(self, alat: float, alon: float, blat: float, blon: float
                  ) -> tuple[float, float]:
        """Luftlinie × Circuity; Fahrzeit über 50 km/h Stadt-Schätzung."""
        d = haversine_km(alat, alon, blat, blon) * self.circuity
        return d, d / 50.0 * 60.0

    # ------------------------------------------------------------ OSRM-Abruf
    def _table_batch(self, src: tuple[float, float],
                     targets: list[tuple[float, float]],
                     want_duration: bool) -> list[dict | None]:
        """Ein OSRM-Table-API-Aufruf für bis zu TABLE_BATCH Ziele.

        Liefert je Ziel {'dist_km': float, 'dur_min': float|None} oder None
        (nicht erreichbar / keine Antwort).
        """
        url = f"{self.base_url}/table/v1/{self.profile}/" + _coords(src, targets)
        params = {"sources": "0",
                  "destinations": ";".join(str(i + 1) for i in range(len(targets))),
                  "annotations": "distance,duration" if want_duration else "distance"}
        url += "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={"User-Agent": "TankApp/1.0"})
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            payload = json.loads(r.read().decode("utf-8"))
        if payload.get("code") != "Ok":
            raise RuntimeError(f"OSRM antwortete code={payload.get('code')!r}")
        dists = payload.get("distances") or [[]]
        durs = payload.get("durations") or [[]]
        out: list[dict | None] = []
        drow = dists[0] if dists else []
        trow = durs[0] if durs else []
        for i in range(len(targets)):
            d = drow[i] if i < len(drow) else None
            t = trow[i] if i < len(trow) else None
            if d is None or (isinstance(d, float) and math.isnan(d)) or d < 0:
                out.append(None)
            else:
                out.append({"dist_km": float(d) / 1000.0,
                            "dur_min": (float(t) / 60.0) if t is not None and t >= 0 else None})
        return out

    def routes_from(self, src_lat: float, src_lon: float,
                    targets: list[tuple[float, float]],
                    want_duration: bool = True) -> dict[int, tuple[float, float | None]]:
        """Batch: echte Einfach-Route vom Anker zu jedem Ziel.

        Rückgabe: {Index in `targets`: (dist_km, dur_min|None)}.
        Nicht erreichbare/fehlgeschlagene Ziele bekommen den Luftlinie-Fallback.
        """
        result: dict[int, tuple[float, float | None]] = {}
        todo: list[tuple[int, tuple[float, float], str]] = []
        for i, (blat, blon) in enumerate(targets):
            k = _key(self.profile, src_lat, src_lon, blat, blon)
            hit = self.cache.get(k)
            if hit is not None:
                self.hits += 1
                result[i] = (float(hit["dist_km"]), hit.get("dur_min"))
            else:
                todo.append((i, (blat, blon), k))

        if todo:
            self._log(f"OSRM: {len(todo)} neue Routen anfragen "
                      f"({self.hits} aus Cache) …")
        server_ok = True
        for start in range(0, len(todo), TABLE_BATCH):
            chunk = todo[start:start + TABLE_BATCH]
            if server_ok:
                try:
                    answers = self._table_batch(
                        (src_lat, src_lon), [t for _, t, _ in chunk], want_duration)
                except (urllib.error.URLError, urllib.error.HTTPError,
                        TimeoutError, ConnectionError, OSError,
                        json.JSONDecodeError, RuntimeError) as e:
                    self._log(f"  ! OSRM nicht erreichbar ({type(e).__name__}: {e}) "
                              f"— Fallback Luftlinie × {self.circuity:g}")
                    server_ok = False
                    answers = None
            else:
                answers = None
            for (i, (blat, blon), k), ans in zip(chunk, answers or [None] * len(chunk)):
                if ans is not None:
                    self.misses += 1
                    self.cache[k] = ans
                    result[i] = (ans["dist_km"], ans.get("dur_min"))
                else:
                    self.fallbacks += 1
                    d, t = self._fallback(src_lat, src_lon, blat, blon)
                    # Nur echte Antworten landen im Cache; Fallback wird beim
                    # nächsten Lauf erneut probiert (Server könnte dann gehen).
                    result[i] = (d, t if want_duration else None)
        # Plausibilität: Straße/Luftlinie je Ziel; Fallback (= Circuity) ausnehmen.
        self.suspicious = []
        for i, (blat, blon) in enumerate(targets):
            d_road = result[i][0]
            d_air = haversine_km(src_lat, src_lon, blat, blon)
            if d_air > 0.05 and d_road > 0:
                fac = d_road / d_air
                # Fallback-Ziele haben genau circuity-Faktor und nicht geholte Route;
                # nur echte OSRM-Antworten über der Schwelle sind verdächtig.
                k = _key(self.profile, src_lat, src_lon, blat, blon)
                if fac > CIRCUITY_WARN and k in self.cache:
                    self.suspicious.append((i, fac, d_road))
        if self.suspicious:
            self._log(f"  ⚠ {len(self.suspicious)} Strecke(n) mit Straße/Luftlinie "
                      f"> {CIRCUITY_WARN:g} (meist Autobahn-Rampen-Snap: Anker "
                      "auf die Hausstraße setzen, nicht auf die Autobahn/Dreieck).")
        # Anker-Snap prüfen, sobald der Server erreichbar war und wir ein Ziel haben:
        # schnappt der Startpunkt auf die Autobahn, sind ALLE Routen zu lang.
        self.anchor_snap = None
        if self.misses and targets:
            self.anchor_snap = self.check_anchor_snap(
                src_lat, src_lon, targets[0][0], targets[0][1])
            if self.anchor_snap and self.anchor_snap["on_autobahn"]:
                self._log(f"  ⚠ Anker snap auf {self.anchor_snap['first_road']} "
                          "(AUTOBAHN/Rampe)! Jede Route läuft erst über die "
                          "Autobahn -> Strecken zu lang. Anker-Koordinate in "
                          "config.local.json auf die eigene HAUSstraße setzen.")
        if self.misses:
            self._save_cache()
        return result

    def route_one(self, src_lat: float, src_lon: float,
                  dst_lat: float, dst_lon: float,
                  want_duration: bool = True) -> tuple[float, float | None]:
        """Einzel-Route (Komfort für Reports/Skripte außerhalb der Selektion)."""
        return self.routes_from(src_lat, src_lon, [(dst_lat, dst_lon)],
                                want_duration)[0]

    def check_anchor_snap(self, src_lat: float, src_lon: float,
                          dst_lat: float, dst_lon: float) -> dict | None:
        """Eine Route mit Wegbeschreibung: schnappt der ANKER auf die Autobahn?

        OSRM (wie Google) schnappt jeden Punkt auf die nächste befahrbare
        Kante. Liegt der Anker zufällig an einer Autobahnrampe/-kante
        (z. B. Koordinate vom Rechtsklick aufs Autobahnkreuz), ist die
        erste befahrene Straße 'A 648' — schon jede kurze Fahrt wird zum
        Autobahn-Umweg. Erkenntnis: erster Streckenabschnitt mit
        A-Nummer im 'ref' = Anker auf/auf der Auffahrt zur Autobahn.
        """
        url = (f"{self.base_url}/route/v1/{self.profile}/"
               f"{src_lon:.6f},{src_lat:.6f};{dst_lon:.6f},{dst_lat:.6f}"
               "?steps=true&overview=false")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "TankApp/1.0"})
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                payload = json.loads(r.read().decode("utf-8"))
            if payload.get("code") != "Ok" or not payload.get("routes"):
                return None
            steps = (payload["routes"][0].get("legs") or [{}])[0].get("steps") or []
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError,
                ConnectionError, OSError, json.JSONDecodeError, KeyError, IndexError):
            return None
        roads: list[dict[str, str]] = []
        for s in steps[:8]:
            nm = (s.get("name") or "").strip()
            ref = (s.get("ref") or "").strip()
            if nm or ref:
                roads.append({"name": nm, "ref": ref})
        first = roads[0] if roads else {"name": "", "ref": ""}
        on_ab = bool(_AUTOBAHN_RE.match(first.get("ref") or ""))
        return {"roads": roads, "on_autobahn": on_ab,
                "first_road": (first.get("ref") or first.get("name") or "?")}

    def _log(self, msg: str) -> None:
        if not self.quiet:
            print(msg, file=sys.stderr, flush=True)


def _coords(src: tuple[float, float], targets: list[tuple[float, float]]) -> str:
    """OSRM-Koordinaten-String: 'lon,lat;lon,lat;...' (Quelle zuerst)."""
    pts = [src] + list(targets)
    return ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in pts)


# --------------------------------------------------------------- CLI (Test)

def main() -> int:
    ap = argparse.ArgumentParser(
        description="OSRM-Routing testen: echte Straßen-km + Fahrzeit zwischen "
                    "zwei Punkten ('lat,lon' je Punkt).")
    ap.add_argument("points", nargs="+",
                    help="Punkte als 'lat,lon' (erster = Start, weitere = Ziele)")
    ap.add_argument("--mode", default="driving",
                    choices=["driving", "walking", "cycling"])
    ap.add_argument("--osrm-url", default=None,
                    help=f"OSRM-Server (Default: {DEFAULT_OSRM_URL}; "
                         "eigener Server z. B. http://nas:5000)")
    ap.add_argument("--cache", type=Path, default=Path("results/road_route_cache.json"))
    args = ap.parse_args()

    pts = []
    for spec in args.points:
        try:
            lat, lon = (float(x) for x in spec.split(",")[:2])
        except ValueError:
            raise SystemExit(f"Punkt nicht lesbar: {spec!r} (erwartet 'lat,lon')")
        pts.append((lat, lon))
    if len(pts) < 2:
        raise SystemExit("Mindestens Start + ein Ziel als 'lat,lon' angeben.")

    rr = RoadRouter(mode=args.mode, base_url=args.osrm_url, cache_path=args.cache)
    src, targets = pts[0], pts[1:]
    res = rr.routes_from(src[0], src[1], targets)
    print(f"Routing-Profil: {rr.profile} | Server: {rr.base_url}")
    print(f"Cache-Treffer {rr.hits}, neu geholt {rr.misses}, Fallback {rr.fallbacks}\n")
    sus = {i: (fac, d) for i, fac, d in rr.suspicious}
    for i, ((lat, lon), (d, t)) in enumerate(zip(targets, [res[j] for j in sorted(res)]), 1):
        idx = i - 1
        luft = haversine_km(src[0], src[1], lat, lon)
        tstr = f"{t:.0f} min" if t is not None else "—"
        flag = "  ⚠ FAKTOR SEHR HOCH" if idx in sus else ""
        print(f"Ziel {i} ({lat:.5f}, {lon:.5f}): Straße {d:.2f} km, {tstr} "
              f"| Luftlinie {luft:.2f} km (Faktor {d / luft:.2f}×){flag}")
        print(f"        Google-Vergleich: {google_directions_link(src[0], src[1], lat, lon)}")
    if rr.anchor_snap:
        s = rr.anchor_snap
        weg = " → ".join((r["ref"] or r["name"]) for r in s["roads"][:5]) or "(…)"
        print(f"\nAnker snap: Start auf [{s['first_road']}]. Erste Wegpunkte: {weg}")
        if s["on_autobahn"]:
            print("  ⚠ Der Anker schnappt auf eine AUTOBAHN/Rampe: Jede Route ist\n"
                  "    zu lang, weil man erst über die Autobahn muss. Ursache ist\n"
                  "    die Anker-Koordinate (Rechtsklick aufs Autobahnkreuz?),\n"
                  "    nicht die Routing-Engine — Google schnappt genauso. Koordinate\n"
                  "    auf die eigene HAUSstraße setzen (Google Maps auf Adresse).")
    if sus:
        print("\n  ⚠ Ein Faktor > ~2,3 in der Stadt heißt fast immer: der Start-Punkt\n"
          "    wurde auf eine Autobahnrampe/-kante geschnappt (von da aus muss man\n"
          "    erst in die falsche Richtung). Den Anker in analysis/config.local.json\n"
          "    auf die eigene HAUSstraße setzen (Koordinaten per Google Maps auf die\n"
          "    Adresse, nicht auf das Autobahnkreuz). Stimmt die Google-Strecke oben\n"
          "    mit OSRM überein, ist die Route echt; weicht sie stark ab, lag es am Snap.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
