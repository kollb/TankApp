"""Heatmaps DoW×Stunde — Niveau (Median) + Cheap-Probability.

Input: list of points {timestamp: datetime (UTC aware), station_id, price: float}
Output: matrix 7×24 (Mo=0 .. So=6, Stunde 0..23 Berlin)

- kind=level: Medianpreis je Zelle
- kind=probability: P(Preis ≤ Stadtmedian) je Zelle (Cheap-Probability)

Für station_id-Filter:
  level = Median dieser Station je Zelle
  probability = P(Station ≤ Stadtmedian_je_Zelle)

Für city (kein station_id):
  level = Median über alle Stationen je Zelle
  probability = P(Preis ≤ Gesamtmedian) je Zelle
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


def _berlin_dow_hour(ts: dt.datetime):
    try:
        b = ts.astimezone(BERLIN)
    except Exception:
        b = ts
    return b.weekday(), b.hour


def build_heatmap(
    points: list[dict], kind: str = "level", station_id: str | None = None
):
    # Gruppiere Punkte je Zelle
    # Für probability brauchen wir Stadtmedian je Zelle oder gesamt
    cell_prices_all = defaultdict(list)  # (dow, hour) -> list prices aller Stationen
    cell_prices_station = defaultdict(
        list
    )  # (dow, hour) -> list prices gefilterte Station

    for p in points:
        ts = p["timestamp"]
        if not isinstance(ts, dt.datetime):
            continue
        dow, hour = _berlin_dow_hour(ts)
        price = p.get("price")
        if price is None or not math.isfinite(price):
            continue
        cell_prices_all[(dow, hour)].append(price)
        if station_id is None or p.get("station_id") == station_id:
            cell_prices_station[(dow, hour)].append(price)

    # Gesamtmedian für city (über alle Punkte)
    all_prices_flat = [price for lst in cell_prices_all.values() for price in lst]
    overall_median = None
    if all_prices_flat:
        sorted_all = sorted(all_prices_flat)
        n = len(sorted_all)
        overall_median = (
            sorted_all[n // 2]
            if n % 2 == 1
            else (sorted_all[n // 2 - 1] + sorted_all[n // 2]) / 2
        )

    # Stadtmedian je Zelle (für station-spezifische probability)
    cell_median = {}
    for key, lst in cell_prices_all.items():
        if lst:
            s = sorted(lst)
            n = len(s)
            cell_median[key] = (
                s[n // 2] if n % 2 == 1 else (s[n // 2 - 1] + s[n // 2]) / 2
            )

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
                if not lst:
                    matrix[dow][hour] = None
                else:
                    s = sorted(lst)
                    n = len(s)
                    median = (
                        s[n // 2] if n % 2 == 1 else (s[n // 2 - 1] + s[n // 2]) / 2
                    )
                    matrix[dow][hour] = round(median, 3)
            else:  # probability
                if station_id:
                    # P(Station ≤ Stadtmedian_je_Zelle)
                    med = cell_median.get(key)
                    lst = cell_prices_station.get(key, [])
                    if not lst or med is None:
                        matrix[dow][hour] = None
                    else:
                        cnt = sum(1 for price in lst if price <= med + 1e-9)
                        matrix[dow][hour] = (
                            round(cnt / len(lst) * 100, 1) if lst else None
                        )
                else:
                    # P(Preis ≤ Gesamtmedian) je Zelle
                    lst = cell_prices_all.get(key, [])
                    if not lst or overall_median is None:
                        matrix[dow][hour] = None
                    else:
                        cnt = sum(1 for price in lst if price <= overall_median + 1e-9)
                        matrix[dow][hour] = (
                            round(cnt / len(lst) * 100, 1) if lst else None
                        )

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
    }
