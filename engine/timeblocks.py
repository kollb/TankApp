"""DST-sichere lokale Kalenderblöcke.

Ein Forecast bleibt in UTC identifizierbar, während die fachliche Rasterung
an der lokalen Wanduhr hängt. Die zwei 02:00-Uhren am Herbstwechsel sind daher
zwei Blöcke; die nicht existente 02:00-Uhr im Frühjahr wird durch den
Transitionszeitpunkt repräsentiert. Dieses Modul ist absichtlich frei von
pandas, damit API und Worker denselben Vertrag verwenden können.
"""

from __future__ import annotations

from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo


def block_key_utc(stamp: datetime, timezone_name: str, minutes: int = 120) -> datetime:
    """UTC-Identität des lokalen Kalenderblocks, der ``stamp`` enthält.

    Für normale Grenzen existiert genau eine UTC-Abbildung. Bei einer
    wiederholten Grenze wird die jüngste Abbildung gewählt, die nicht nach dem
    Messzeitpunkt liegt; bei einer übersprungenen Grenze die spätere
    Falt-Abbildung, also der reale Übergang. Dadurch bleiben UTC-Reihenfolge,
    beide Herbst-Folds und die Rastersemantik stabil, auch wenn ein Forecast
    nicht jeden Slot enthält.
    """
    if minutes <= 0 or 1440 % minutes != 0:
        raise ValueError("block minutes must be a positive divisor of one day")
    if stamp.tzinfo is None:
        raise ValueError("block compression requires a timezone-aware timestamp")

    zone = ZoneInfo(timezone_name)
    instant = stamp.astimezone(timezone.utc)
    local = instant.astimezone(zone)
    if minutes >= 1440:
        hour = minute = 0
    else:
        wall_minutes = (local.hour * 60 + local.minute) // minutes * minutes
        hour, minute = divmod(wall_minutes, 60)
    naive = datetime.combine(local.date(), time(hour, minute))

    mappings: list[datetime] = []
    valid: list[datetime] = []
    for fold in (0, 1):
        candidate = naive.replace(tzinfo=zone, fold=fold)
        candidate_utc = candidate.astimezone(timezone.utc)
        mappings.append(candidate_utc)
        if candidate_utc.astimezone(zone).replace(tzinfo=None) == naive:
            valid.append(candidate_utc)

    # At a spring gap both mappings are non-round-tripping.  The later
    # mapping is the transition instant (02:00 CET -> 03:00 CEST).
    choices = valid or mappings
    eligible = [candidate for candidate in choices if candidate <= instant]
    return max(eligible) if eligible else min(choices)


def block_keys(stamps: list[datetime], timezone_name: str, minutes: int = 120):
    """Return block keys in input order; kept tiny for worker/API reuse."""
    return [block_key_utc(stamp, timezone_name, minutes) for stamp in stamps]
