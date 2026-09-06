#!/usr/bin/env python3
"""
Demo-Datengenerator für TankApp (Schritt 1: Tankstellen-Selektion).

Erzeugt realistische historische 5-Minuten-Preisdaten für 3 fiktive Städte,
solange die echten historischen Daten noch nicht vorliegen. Das Spaltenformat
entsprechend exakt dem Schema, das die Selektions-Pipeline erwartet:

    timestamp,station_id,station_name,brand,city,lat,lon,fuel,price

Modellierte Realitäts-Effekte (damit die Mathematik in station_selection.py
auch "etwas zu finden" hat):
  * marktüblicher Intraday-Zyklus (Morgensprung ~06-08h, Tief am Abend ~19-22h)
  * Wochenmuster (Wochenende/Feiertage tendenziell anders), AR(2)-Marktrauschen,
    28-tägige "Rohöl"-Welle
  * stationsfeste Niveau-Offsets je Marke (Premium vs. Discounter)
  * individuelle Phasenverschiebung je Station (jede Station hat eine andere
    mathematisch messbare "billigste Stunde")
  * Amplitudenunterschiede (Discounter schwanken stärker)
  * Ausfallfenster (Datenlücken) -> Coverage-Gate wird getestet
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

RNG = np.random.default_rng(20260906)

# Marktübliche Marken-Policies (Niveau-Offset in ct/L ggü. Stadt-Median,
# Amplitude = Stärke des eigenen Tageszyklus in ct/L)
BRANDS = {
    "Aral":             {"offset": +2.8, "amp": 0.6, "n": 3},
    "Shell":            {"offset": +2.5, "amp": 0.6, "n": 3},
    "Esso":             {"offset": +1.1, "amp": 0.8, "n": 2},
    "TotalEnergies":    {"offset": +0.7, "amp": 0.9, "n": 2},
    "HEM":              {"offset": -1.1, "amp": 1.3, "n": 2},
    "Star":             {"offset": -1.4, "amp": 1.4, "n": 2},
    "JET":              {"offset": -1.6, "amp": 1.5, "n": 2},
    "Freie Tankstelle": {"offset": -2.3, "amp": 1.7, "n": 2},
}

# Fiktive Städte (Name, lat, lon, Basispreis in EUR/L, Zyklus-Phase)
CITIES = {
    "Auerbach":  (52.40, 13.05, 1.619, 0.0),
    "Lindenberg": (51.34, 12.37, 1.599, 0.6),
    "Neuental":  (50.98, 11.03, 1.639, 1.2),
}

STREET = ["Hauptstraße", "Bahnhofstraße", "Ringstraße", "Industrieweg",
          "Am Kreuzberg", "Berliner Allee", "Wiesenweg", "Südring"]


def intraday_cycle(hours: np.ndarray, phase: float = 0.0) -> np.ndarray:
    """Stilisierte Tageskurve in ct/L über Grundniveau.

    Charakteristik (vgl. bundeskartellamt-/literaturtypische Muster):
      * starker Morgenanstieg mit Maximum ~07:30
      * Abfall über Mittag/Nachmittag
      * Minimum am späten Abend ~20:00-21:30
      * leichter Nachtanstieg Richtung Morgensprung
    """
    h = hours - phase
    c = (
        2.3 * np.cos(2 * np.pi * (h - 7.5) / 24.0)
        + 0.9 * np.cos(2 * np.pi * 2 * (h - 9.0) / 24.0)
        + 0.4 * np.cos(2 * np.pi * 3 * (h - 18.0) / 24.0)
    )
    return c


def ar2_noise(n: int, sigma: float = 0.25, phi1: float = 0.92, phi2: float = -0.25) -> np.ndarray:
    e = RNG.normal(0.0, sigma, n)
    x = np.zeros(n)
    for t in range(2, n):
        x[t] = phi1 * x[t - 1] + phi2 * x[t - 2] + e[t]
    return x


@dataclass
class Station:
    sid: str
    name: str
    brand: str
    city: str
    lat: float
    lon: float
    offset: float      # ct/L gegenüber Stadt-Basislinie
    amp: float         # ct/L eigene Zyklus-Amplitude
    phase_shift: float # Stunden, die der eigene Zyklus verschoben ist
    echo: float        # eigenes Rausch-Sigma
    night_dip: bool = False  # 24h-Discounter-Profil: Tief in den frühen Morgenstunden


def make_stations(city: str, lat0: float, lon0: float) -> list[Station]:
    stations: list[Station] = []
    k = 0
    used_names: set[str] = set()
    first_freie_done = False
    for brand, cfg in BRANDS.items():
        for _ in range(cfg["n"]):
            k += 1
            street = RNG.choice(STREET)
            while f"{brand} {street}" in used_names:
                street = f"{RNG.choice(STREET)} {RNG.integers(2, 60)}"
            used_names.add(f"{brand} {street}")
            # je Stadt ein 24h-Discounter mit Nacht-Tief (realistischer
            # Randfall für die Fenster-Frage 08–24 Uhr)
            night = (brand == "Freie Tankstelle" and not first_freie_done)
            if night:
                first_freie_done = True
            stations.append(Station(
                sid=f"{city[:2].upper()}-{k:02d}",
                name=f"{brand} {city} {street}",
                brand=brand,
                city=city,
                lat=lat0 + RNG.normal(0, 0.045),
                lon=lon0 + RNG.normal(0, 0.065),
                offset=cfg["offset"] + RNG.normal(0, 0.5),
                amp=max(0.2, cfg["amp"] + RNG.normal(0, 0.1 if night else 0.3)),
                # Nacht-Discounter: enger, nachtverlagerter Rhythmus
                phase_shift=RNG.normal(0, 0.5) if night else RNG.normal(0, 1.1),
                echo=RNG.uniform(0.10, 0.30),
                night_dip=night,
            ))
    return stations


def simulate(days: int, step_min: int = 5) -> pd.DataFrame:
    steps_per_day = (24 * 60) // step_min
    n = days * steps_per_day
    t0 = pd.Timestamp("2026-07-01 00:00:00")
    idx = pd.date_range(t0, periods=n, freq=f"{step_min}min")
    hours = idx.hour.to_numpy() + idx.minute.to_numpy() / 60.0
    dow = idx.dayofweek.to_numpy()
    tday = (idx - t0).total_seconds().to_numpy() / 86400.0

    frames: list[pd.DataFrame] = []
    for city, (lat0, lon0, base_eur, cphase) in CITIES.items():
        # Stadt-Niveau: Intraday-Zyklus + Wocheneffekt + Rohölwelle + AR(2)
        weekly = np.where(dow >= 5, -0.5, 0.0) + np.where(dow == 0, +0.35, 0.0)
        crude = 1.6 * np.sin(2 * np.pi * tday / 28.0)
        # langsame Niveaudrift (Rohölpreis-Proxy), aber stationär genug, dass
        # alle Stationen der Stadt *gemeinsam* driften -> hebt sich in Δ auf
        drift_ct = np.cumsum(ar2_noise(n, sigma=0.05)) * 0.03
        city_level_ct = intraday_cycle(hours, cphase) + weekly + crude + drift_ct
        city_level_ct -= city_level_ct.mean()  # Basispreis bleibt base_eur

        st = make_stations(city, lat0, lon0)
        # eine Station mit schlechter Datenqualität (testet Coverage-Gate)
        bad_cov = RNG.integers(0, len(st))

        day_idx = ((idx - t0).total_seconds().to_numpy() // 86400).astype(int)

        for i, s in enumerate(st):
            own = s.amp * intraday_cycle(hours, cphase + s.phase_shift)
            if s.night_dip:
                # zusätzliches Preis-Tief 01–05 Uhr (Typ "24h-Discounter"
                # an Ausfallstraßen): Gauß-Dip, zentriert ~03:00; so tief,
                # dass das Tagesminimum tatsächlich in der Nacht liegt
                own -= s.amp * 3.0 * np.exp(-0.5 * ((hours - 3.0) / 2.2) ** 2)
            own -= own.mean()   # Niveau bleibt Sache von s.offset
            # stationäres AR(2)-Rauschen (kein Random Walk -> Markt könnte
            # sich sonst beliebig weit vom Markpreis entfernen -> unrealistisch)
            noise = ar2_noise(n, sigma=s.echo)
            # leichte tagesbezogene Niveau-Schwankung je Station (Lieferkosten,
            # lokale Konkurrenz) -> macht Bootstrap-CIs und AV ehrlich
            daily_lvl = RNG.normal(0.0, 0.28, days)[day_idx]
            price_ct = (base_eur * 100 + city_level_ct + s.offset + own
                        + daily_lvl + noise)
            price = np.round(price_ct / 100.0, 3)

            valid = np.ones(n, dtype=bool)
            # sporadische Ausfallfenster 2-12 h
            for _ in range(int(days / 9)):
                start = RNG.integers(0, n - 200)
                length = RNG.integers(24, 144)
                valid[start:start + length] = False
            if i == bad_cov:
                valid[:] = RNG.random(n) < 0.62  # ~62 % Abdeckung

            df = pd.DataFrame({
                "timestamp": idx,
                "station_id": s.sid,
                "station_name": s.name,
                "brand": s.brand,
                "city": s.city,
                "lat": round(s.lat, 6),
                "lon": round(s.lon, 6),
                "fuel": "E10",
                "price": np.where(valid, price, np.nan),
            })
            frames.append(df.dropna(subset=["price"]))

    out = pd.concat(frames, ignore_index=True)
    return out.sort_values(["city", "station_id", "timestamp"], ignore_index=True)


def main() -> None:
    ap = argparse.ArgumentParser(description="TankApp Demo-Datengenerator")
    ap.add_argument("--days", type=int, default=56, help="Historie in Tagen (Default 56)")
    ap.add_argument("--out", type=Path, default=Path("data/demo"),
                    help="Ausgabeverzeichnis für CSVs (eine pro Stadt)")
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    df = simulate(args.days)
    for city, g in df.groupby("city"):
        p = args.out / f"prices_{city.lower()}.csv"
        g.to_csv(p, index=False)
        print(f"  {p}  ({len(g):>7,} Zeilen, {g.station_id.nunique()} Stationen)")
    ts_min, ts_max = df.timestamp.min(), df.timestamp.max()
    print(f"Zeitraum: {ts_min} .. {ts_max} | {df.station_id.nunique()} Stationen gesamt")


if __name__ == "__main__":
    main()
