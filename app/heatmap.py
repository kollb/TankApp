"""Heatmaps DoW×Stunde — Niveau (Median) + Cheap-Probability.

Input: list of points {timestamp: datetime (UTC aware), station_id, price: float}
Output: matrix 7×24 (Mo=0 .. So=6, Stunde 0..23 Berlin)

- kind=level: Medianpreis je Zelle
- kind=probability: P(Preis ≤ Vergleichsmedian) je Zelle (Cheap-Probability)

Für station_id-Filter:
  level = Median dieser Station je Zelle
  probability = P(Station ≤ Stadtmedian_je_Zelle)

Für city (kein station_id):
  level = Median über alle Stationen je Zelle
  probability je nach ``basis`` (B12):
    basis="overall" → P(Preis ≤ Gesamtmedian aller Preise des Fensters)
    basis="hour"    → P(Preis ≤ Median **derselben Stunde**) — Spalten-Basis,
                      die den Tagesgang herausrechnet, damit die Wochentage
                      (Zeilen) fair vergleichbar bleiben

Die Vergleichs-Basis wirkt nur auf ``probability`` ohne ``station_id``; mit
Station vergleicht die Heatmap ohnehin gegen den Zellen-Median, mit
``kind=level`` ist sie wirkungslos.
"""

import datetime as dt
import math
from collections import defaultdict

try:
    from zoneinfo import ZoneInfo

    BERLIN = ZoneInfo("Europe/Berlin")
except Exception:
    BERLIN = dt.timezone.utc


DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
HOURS = list(range(24))
# B12: erlaubte Vergleichs-Basen der Cheap-Probability ohne Station.
BASES = ("overall", "hour")


def _berlin_dow_hour(ts: dt.datetime):
    try:
        b = ts.astimezone(BERLIN)
    except Exception:
        b = ts
    return b.weekday(), b.hour


def _median(values: list[float]):
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    return s[n // 2] if n % 2 == 1 else (s[n // 2 - 1] + s[n // 2]) / 2


def build_heatmap(
    points: list[dict],
    kind: str = "level",
    station_id: str | None = None,
    basis: str = "overall",
):
    """7×24-Matrix (DoW × Stunde) aus offenen Preispunkten.

    ``basis`` (B12) bestimmt die Vergleichsgröße der Cheap-Probability **ohne**
    ``station_id``: ``overall`` = Gesamtmedian des Fensters (wie bisher),
    ``hour`` = Median derselben Stunde über alle Wochentage (Spalten-Basis).
    """
    if basis not in BASES:
        raise ValueError("invalid_basis")

    # Gruppiere Punkte je Zelle
    # Für probability brauchen wir Stadtmedian je Zelle, je Stunde oder gesamt
    cell_prices_all = defaultdict(list)  # (dow, hour) -> list prices aller Stationen
    cell_prices_station = defaultdict(
        list
    )  # (dow, hour) -> list prices gefilterte Station
    hour_prices = defaultdict(list)  # hour -> list prices aller Wochentage

    for p in points:
        ts = p["timestamp"]
        if not isinstance(ts, dt.datetime):
            continue
        dow, hour = _berlin_dow_hour(ts)
        price = p.get("price")
        if price is None or not math.isfinite(price):
            continue
        cell_prices_all[(dow, hour)].append(price)
        hour_prices[hour].append(price)
        if station_id is None or p.get("station_id") == station_id:
            cell_prices_station[(dow, hour)].append(price)

    # Gesamtmedian für city (über alle Punkte)
    all_prices_flat = [price for lst in cell_prices_all.values() for price in lst]
    overall_median = _median(all_prices_flat)

    # B12: Spaltenmedian je Stunde (alle Wochentage, alle Stationen des Fensters)
    hour_median = {h: _median(lst) for h, lst in hour_prices.items()}

    # Stadtmedian je Zelle (für station-spezifische probability)
    cell_median = {key: _median(lst) for key, lst in cell_prices_all.items()}

    # Matrix aufbauen 7×24
    matrix = [[None for _ in range(24)] for _ in range(7)]
    for dow in range(7):
        for hour in range(24):
            key = (dow, hour)
            if kind == "level":
                lst = (
                    cell_prices_station[key]
                    if cell_prices_station
                    else cell_prices_all[key]
                )
                median = _median(lst)
                matrix[dow][hour] = None if median is None else round(median, 3)
            else:  # probability
                if station_id:
                    # P(Station ≤ Stadtmedian_je_Zelle)
                    reference = cell_median.get(key)
                    lst = cell_prices_station.get(key, [])
                elif basis == "hour":
                    # B12: P(Preis ≤ Median derselben Stunde) — Tagesgang raus
                    reference = hour_median.get(hour)
                    lst = cell_prices_all.get(key, [])
                else:
                    # P(Preis ≤ Gesamtmedian) je Zelle
                    reference = overall_median
                    lst = cell_prices_all.get(key, [])
                if not lst or reference is None:
                    matrix[dow][hour] = None
                else:
                    cnt = sum(1 for price in lst if price <= reference + 1e-9)
                    matrix[dow][hour] = round(cnt / len(lst) * 100, 1)

    total_points = len(points)
    station_points = (
        sum(len(v) for v in cell_prices_station.values())
        if station_id
        else total_points
    )
    stations_involved = len(set(p.get("station_id") for p in points))

    return {
        "days": DAYS,
        "hours": HOURS,
        "matrix": matrix,
        "points": station_points if station_id else total_points,
        "stations": stations_involved,
        "basis": basis,
    }
