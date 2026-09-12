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

Neben den Werten liefert das Ergebnis zwei Ehrlichkeits-Angaben, die die GUI
braucht, um nicht zu übertreiben (P0 12.09.2026 — „günstigste Stunde 06–08
Uhr, 100 % Chance“, obwohl der Tracking-Bestand erst vier Tage alt war):

- ``range_from`` / ``range_to``: echte Reichweite der verwendeten Preise.
  Das angefragte Fenster (``weeks``) ist oft deutlich größer als der Bestand,
  sonst wirken leere Wochentags-Zeilen wie Datenverlust.
- ``reference_counts``: Stichprobe der **Vergleichs-Basis** je Zelle (nur
  ``probability``). Eine Zelle kann 8+ eigene Preise haben und trotzdem ein
  Artefakt sein — wenn der Stunden-Median selbst aus 16 Preisen besteht, sind
  „100 % günstig“ Mechanik, keine Aussage.
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


def _as_utc(ts: dt.datetime) -> dt.datetime:
    """Naive Zeitstempel als UTC lesen — sonst wirft min()/max() TypeError."""
    return ts if ts.tzinfo is not None else ts.replace(tzinfo=dt.timezone.utc)


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
    used_stamps: list[dt.datetime] = []  # echte Reichweite der verwendeten Preise
    used_stations: set = set()  # nur Stationen, deren Preise wirklich zählen

    for p in points:
        ts = p["timestamp"]
        if not isinstance(ts, dt.datetime):
            continue
        price = p.get("price")
        if price is None or not math.isfinite(price):
            continue
        dow, hour = _berlin_dow_hour(ts)
        used_stamps.append(_as_utc(ts))
        if p.get("station_id") is not None:
            used_stations.add(p["station_id"])
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

    # Matrix aufbauen 7×24 — plus Zähler je Zelle: Die GUI blendet Zellen
    # mit zu wenigen Preisen aus (sonst kürt ein einzelner Nacht-Preis die
    # „günstigste Stunde“). Die Werte bleiben ehrlich im Payload, die
    # Deutung („belastbar oder nicht“) trifft die Anzeige.
    matrix = [[None for _ in range(24)] for _ in range(7)]
    counts = [[0 for _ in range(24)] for _ in range(7)]
    # Stichprobe der Vergleichs-Basis je Zelle (nur probability): mit Station
    # der Stadtmedian derselben Zelle, bei basis=hour der Spalten-Median,
    # bei basis=overall der Gesamtmedian des Fensters (dann überall gleich).
    # Für level gibt es keine Vergleichs-Basis → None statt erfundener Zahlen.
    reference_counts = None if kind == "level" else [[0] * 24 for _ in range(7)]
    overall_count = len(all_prices_flat)
    for dow in range(7):
        for hour in range(24):
            key = (dow, hour)
            if reference_counts is not None:
                if station_id:
                    reference_counts[dow][hour] = len(cell_prices_all.get(key, ()))
                elif basis == "hour":
                    reference_counts[dow][hour] = len(hour_prices.get(hour, ()))
                else:
                    reference_counts[dow][hour] = overall_count
            if kind == "level":
                lst = (
                    cell_prices_station[key]
                    if cell_prices_station
                    else cell_prices_all[key]
                )
                counts[dow][hour] = len(lst)
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
                counts[dow][hour] = len(lst)
                if not lst or reference is None:
                    matrix[dow][hour] = None
                else:
                    cnt = sum(1 for price in lst if price <= reference + 1e-9)
                    matrix[dow][hour] = round(cnt / len(lst) * 100, 1)

    total_points = len(used_stamps)
    station_points = (
        sum(len(v) for v in cell_prices_station.values())
        if station_id
        else total_points
    )
    stations_involved = len(used_stations)

    return {
        "days": DAYS,
        "hours": HOURS,
        "matrix": matrix,
        "counts": counts,
        "reference_counts": reference_counts,
        "points": station_points if station_id else total_points,
        "stations": stations_involved,
        "basis": basis,
        # Echte Reichweite der verwendeten Preise (UTC, ISO-8601) — das
        # angefragte Fenster ist oft größer als der Bestand.
        "range_from": min(used_stamps).isoformat() if used_stamps else None,
        "range_to": max(used_stamps).isoformat() if used_stamps else None,
    }
