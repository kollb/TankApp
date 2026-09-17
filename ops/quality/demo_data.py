"""Synthetischer Demo-Stack für die Qualitäts-Gates (D4).

Warum es dieses Modul gibt: Lighthouse und der Lastpfad sollen eine laufende
App **mit Daten** messen — gegen einen leeren Server messen sie nur den
Rahmen (leere Panels, ``error_code`` statt Antwort). Echte Preishistorie liegt
hinter der InfluxDB des Betreibers und gehört nicht ins Repo, also entsteht
hier ein deterministischer Ersatz:

* ``data/setup/polling.json`` — sechs Stationen einer Demostadt mit
  Koordinaten und Anker,
* ``data/runtime/engine/current.json`` — eine Publikation aus einem echten
  Engine-Lauf (Fit, 24-h- und 7-d-Prognose, Bootstrap-Draws),
* frische Preiszeilen, die genau so aussehen wie ein InfluxDB-Resultat, plus
  24 h Verlauf für die Tageskurve.

Kein Netz, keine Geheimnisse, keine echten Preise: Alles ist Zufall mit
festem Samen (``numpy.default_rng(7)``) und dient ausschließlich Messung und
Last. Die Dateien landen in einem temporären Datenverzeichnis, nie im
produktiven ``data/``.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

CITY = "Demostadt"
FUEL = "e10"
ANCHOR = (50.1109, 8.6821)  # Frankfurt-Innenstadt als Geometrie-Vorlage.
# Sechs Stationen, 0,6–5 km um den Anker — genug für Ranking, Karte und Radar.
# UUID-Form ist Pflicht (polling_plan.validate_sets prüft sie), die Ziffern
# sind fortlaufend gewählt, damit Logs und Artefakte lesbar bleiben.
STATIONS = [
    ("00000000-0000-0000-0000-0000000000d1", "Demo-Tank Nord", 50.1290, 8.6900),
    ("00000000-0000-0000-0000-0000000000d2", "Demo-Tank Ost", 50.1150, 8.7300),
    ("00000000-0000-0000-0000-0000000000d3", "Demo-Tank Süd", 50.0940, 8.6760),
    ("00000000-0000-0000-0000-0000000000d4", "Demo-Tank West", 50.1180, 8.6410),
    ("00000000-0000-0000-0000-0000000000d5", "Demo-Tank Mitte", 50.1110, 8.6830),
    ("00000000-0000-0000-0000-0000000000d6", "Demo-Tank Außen", 50.1520, 8.6210),
]
# Tagesverlauf: morgens teuer, abends günstig (wie im echten Markt).
_BASE_CT = 172.0
_DAILY_CT = 5.0
_NOISE_CT = 0.25


def write_polling(path: Path) -> None:
    """Polling-Set der Demostadt (gleiche Struktur wie die echte Datei)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "request_interval_seconds": 300,
        "sets": {
            CITY: {
                "label": CITY,
                "lat": ANCHOR[0],
                "lon": ANCHOR[1],
                "batch": [uuid for uuid, *_ in STATIONS],
                "stations": [
                    {
                        "uuid": uuid,
                        "name": name,
                        "brand": "DEMO",
                        "lat": lat,
                        "lon": lon,
                    }
                    for uuid, name, lat, lon in STATIONS
                ],
            }
        },
    }
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def synthetic_observations(days: int = 70, end: pd.Timestamp | None = None):
    """Preisverlauf aller Demo-Stationen im 5-Minuten-Raster (UTC-Index).

    Alle Stationen teilen einen Tages-Marktfaktor — sonst wären die
    Bootstrap-Draws unabhängig und die gemeinsame Ziehung (A11) hätte im
    Lastpfad nichts zu koppeln.
    """
    end = (
        pd.Timestamp.now(tz="UTC").floor("5min")
        if end is None
        else pd.Timestamp(end).tz_convert("UTC").floor("5min")
    )
    index = pd.date_range(end - pd.Timedelta(days=days), end, freq="5min", tz="UTC")[
        :-1
    ]
    local = index.tz_convert("Europe/Berlin")
    hour = local.hour.to_numpy() + local.minute.to_numpy() / 60.0
    day_index = (local.normalize() - local.normalize().min()).days.to_numpy()
    rng = np.random.default_rng(7)
    # Gemeinsamer Markt: Tagesniveau + Tagesform über alle Stationen.
    day_level = rng.normal(0.0, 1.5, size=int(day_index.max()) + 1)
    market = _DAILY_CT * np.cos((hour - 4.0) * 2 * np.pi / 24.0) + day_level[day_index]
    frames = []
    for position, (uuid, name, _lat, _lon) in enumerate(STATIONS):
        offset = -2.0 + position * 0.8  # Station 1 günstig, Station 6 teuer.
        price = _BASE_CT + offset + market + rng.normal(0.0, _NOISE_CT, len(index))
        open_window = (hour >= 6.0) & (hour < 23.0)
        frames.append(
            pd.DataFrame(
                {
                    "timestamp": index,
                    "city": CITY,
                    "station_id": uuid,
                    "station_name": name,
                    "fuel": FUEL,
                    "price": np.where(open_window, np.round(price, 3) / 100.0, np.nan),
                    "status": np.where(open_window, "open", "closed"),
                    "source": "influxdb",
                }
            )
        )
    return pd.concat(frames, ignore_index=True)


def latest_prices(observations: pd.DataFrame, minutes_ago: int = 2):
    """Letzter Preis je Station, zeitlich frisch gesetzt (Demo-„Live-Stand“)."""
    now = pd.Timestamp.now(tz="UTC").floor("5min") - pd.Timedelta(minutes=minutes_ago)
    order = {uuid: position for position, (uuid, *_rest) in enumerate(STATIONS)}
    open_rows = observations.loc[observations.status.eq("open")]
    out = {}
    for uuid, group in open_rows.groupby("station_id"):
        price = float(group.price.iloc[-1])
        # Kleiner Versatz je Station: nicht alle gleichzeitig „frisch“
        # gesenkt, damit die Rangliste etwas zu sortieren hat.
        out[uuid] = round(price + (order.get(uuid, 0) % 3) * 0.002, 3)
    return now, out


def latest_rows(now: pd.Timestamp, prices: dict[str, float]) -> list[dict]:
    """InfluxDB-Resultat „letzte Zeile je Station“ (Form wie export_influx)."""
    stamp = (now - pd.Timedelta(minutes=2)).isoformat().replace("+00:00", "Z")
    return [
        {
            "_time": stamp,
            "city": CITY,
            "station_id": uuid,
            "station": name,
            "status": "open",
            FUEL: f"{prices[uuid]:.3f}",
        }
        for uuid, name, _lat, _lon in STATIONS
        if uuid in prices
    ]


def series_rows(
    observations: pd.DataFrame,
    now: pd.Timestamp,
    hours: int = 24,
    station_ids: list[str] | None = None,
) -> list[dict]:
    """InfluxDB-Resultat eines Zeitfensters (Tageskurve in /overview).

    ``station_ids`` filtert wie der Flux-Filter der App — ohne ihn liefert
    die „Abfrage“ alle Stationen und ``LiveData.series`` bricht mit
    „Wrong identity“ (die Tageskurve bliebe im Demo-Stack immer leer).
    """
    start = now - pd.Timedelta(hours=hours)
    window = observations.loc[
        observations.timestamp.between(start, now)
        & observations.timestamp.dt.minute.eq(0)
    ]
    if station_ids:
        window = window.loc[window.station_id.isin(station_ids)]
    rows = []
    for row in window.itertuples(index=False):
        price = row.price
        if price != price:  # geschlossen → keine Preisspalte, wie in echt.
            continue
        rows.append(
            {
                "_time": row.timestamp.isoformat().replace("+00:00", "Z"),
                "city": CITY,
                "station_id": row.station_id,
                "station": row.station_name,
                "status": row.status,
                FUEL: f"{price:.3f}",
            }
        )
    return rows


def make_query(observations: pd.DataFrame, prices: dict[str, float]):
    """Abfrage-Funktion für ``LiveData(query=…)`` — ersetzt die InfluxDB.

    Der Flux-Text entscheidet, was zurückkommt: „tail(n: 1)“ ist die
    Stationstabfrage (letzter Stand je Station), alles andere ein
    Zeitfenster (Tageskurve). Beides liefert dieselben Zeilenformen wie
    ``data-tools/export_influx.py``.

    Wichtiger als der Zeitfenster-Default: der **Station-Filter** aus dem
    Flux-Text wird gehonoriert. ``LiveData.series`` prüft Zeile für Zeile
    die Identität und bricht bei fremden Stationen mit „Wrong identity“ —
    ohne Filter lief die Tageskurve im Demo-Stack deshalb immer leer.
    """

    station_re = re.compile(r"contains\(value: r\.station_id, set: (\[[^\]]*\])")
    range_re = re.compile(
        r"range\(start: time\(v: \"([^\"]+)\"\), stop: time\(v: \"([^\"]+)\"\)"
    )

    # Der Verlauf wird einmal je (Horizont, Station, 5-Minuten-Takt) gebaut
    # und wiederverwendet. Ohne diesen Cache würde die Demo-Abfrage pro
    # Request über 100 k Zeilen filtern — das wäre Last des Messaufbaus,
    # nicht der App.
    cache: dict[tuple, list[dict]] = {}

    def query(_cfg, text: str):
        now = pd.Timestamp.now(tz="UTC").floor("5min")
        if "tail(n: 1)" in text:
            return latest_rows(now, prices)
        station_ids: list[str] | None = None
        match = station_re.search(text)
        if match:
            try:
                loaded = json.loads(match.group(1))
                if isinstance(loaded, list):
                    station_ids = [str(item) for item in loaded]
            except json.JSONDecodeError:
                station_ids = None
        stop: pd.Timestamp | None = None
        match = range_re.search(text)
        if match:
            try:
                stop = pd.Timestamp(match.group(2))
            except ValueError:
                stop = None
        hours = 24
        if stop is None and "start: -" in text:
            try:
                raw = text.split("start: -")[1].split("h")[0].split("d")[0]
                hours = min(168, max(1, int("".join(filter(str.isdigit, raw)) or 24)))
            except (ValueError, IndexError):
                hours = 24
        key = (tuple(station_ids) if station_ids else None, hours, now)
        if key not in cache:
            for stale in [k for k in cache if k[2] != now]:
                cache.pop(stale, None)
            if stop is not None:
                cache[key] = series_rows(observations, stop, hours, station_ids)
            else:
                cache[key] = series_rows(observations, now, hours, station_ids)
        return cache[key]

    return query


def build_publication(
    observations: pd.DataFrame, origin: pd.Timestamp, cfg=None
) -> dict:
    """Engine-Publikation der Demo-Stationen (gleiches Schema wie der NAS-Lauf)."""
    from engine.config import Config
    from engine.data import normalize_observations, prepare_series
    from engine.models import fit, predict

    if cfg is None:
        # Kleiner als produktiv (2000 Ziehungen): Der Demo-Stack soll in
        # Sekunden stehen, nicht Minuten. Draws bleiben echt.
        cfg = Config(bootstrap_samples=200)
    normalized, _ = normalize_observations(observations, cfg)
    series_list = prepare_series(normalized, cfg)
    if not series_list:
        raise RuntimeError("Demo-Daten: keine Series nach der Aufbereitung.")
    # Wiederverwendung der echten Serialisierer: Das Publikationsschema ist
    # damit per Konstruktion identisch zum NAS-Lauf (kein zweiter Pfad).
    from app.model_jobs import _draws, _records

    forecasts = []
    for item in series_list:
        model = fit(item, origin, cfg)
        frame24, paths24 = predict(model, hours=24, return_paths=True)
        frame168, paths168 = predict(model, hours=168, return_paths=True)
        forecasts.append(
            {
                **item.identity(),
                "origin": origin.isoformat(),
                "last_observation": model.get("last_observation"),
                "points": _records(frame24),
                "points_3d": [],
                "points_7d": _records(frame168),
                "draws_24h": _draws(frame24.index, paths24, cfg),
                "draws_7d": _draws(frame168.index, paths168, cfg),
                "train_days": cfg.train_days,
                "range_from": model.get("training_start"),
                "range_to": model.get("last_observation"),
                "n_points": model.get("training_points"),
                "n_days": model.get("training_days"),
                "metrics": None,
                "dst": None,
                "backtest_days": None,
                "backtest_cached": False,
                "backtest_computed_at": None,
                "rolling_picp_7d": None,
                "horizons": {},
                "decision_rows": [],
            }
        )
    return {
        "schema_version": 1,
        "published_at": origin.isoformat(),
        "forecasts": forecasts,
        "failures": [],
        "policies": [],
        "archive_quality": {},
        "gapfill_quality": {},
        "model_file": None,
        "calibrated": False,
        "decision_ready": False,
    }


def build_selection_artifact(settings, observations: pd.DataFrame, n_boot: int = 400) -> dict:
    """O16: δ̂-Selektion für den Demo-Stapel — derselbe Pfad wie der NAS-Lauf.

    Schreibt die synthetischen Beobachtungen als Trainingsbestand
    (``runtime/training/e10.csv.gz``) und ruft das echte
    ``app.selection.build_selection`` auf; das Artefakt landet unter
    ``runtime/selection/current.json`` (wie ``app/worker.py`` es schreibt).
    Kleineres B als produktiv (2000): Der Demo-Stapel soll in Sekunden
    stehen; die q-Wert-Untergrenze 1/(B+1) bleibt für Demo-Zwecke fein genug.
    """
    from app.selection import build_selection
    from engine.storage import write_json

    training_dir = Path(settings.runtime) / "training"
    training_dir.mkdir(parents=True, exist_ok=True)
    frame = observations.copy()
    frame.to_csv(training_dir / "e10.csv.gz", index=False, compression="gzip")
    result = build_selection(settings, fuels=["e10"], n_boot=n_boot)
    write_json(Path(settings.runtime) / "selection" / "current.json", result)
    return result


def build(data_dir: Path, days: int = 70) -> dict:
    """Legt den kompletten Demo-Datenbestand an; liefert die Query-Funktion."""
    data_dir = Path(data_dir)
    (data_dir / "setup").mkdir(parents=True, exist_ok=True)
    (data_dir / "runtime/engine").mkdir(parents=True, exist_ok=True)
    write_polling(data_dir / "setup/polling.json")
    # Die App prüft nur, ob die Datei da ist — gelesen wird sie im Demo-Betrieb
    # nie (die Abfrage ist injiziert). Keine echten Zugangsdaten.
    (data_dir / "influx.env").write_text(
        "TANKAPP_INFLUX_URL=http://127.0.0.1:8086\n"
        "TANKAPP_INFLUX_ORG=demo\n"
        "TANKAPP_INFLUX_BUCKET=demo\n"
        "TANKAPP_INFLUX_TOKEN=demo-token-not-a-secret\n",
        encoding="utf-8",
    )
    observations = synthetic_observations(days=days)
    origin = pd.Timestamp(observations.timestamp.max()).tz_convert("UTC")
    publication = build_publication(observations, origin)
    (data_dir / "runtime/engine/current.json").write_text(
        json.dumps(publication), encoding="utf-8"
    )
    _now, prices = latest_prices(observations)
    return {"observations": observations, "prices": prices, "origin": origin}
