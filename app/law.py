"""Bodenkante der 12-Uhr-Regel für Anzeige, Selektion und Kalibrierung (B30).

Seit dem in ``engine/config.py: price_law_local`` stehenden Zeitpunkt darf der
Preis nur noch einmal täglich (12:00 Uhr) erhöht werden. Beobachtungen **vor**
diesem Zeitpunkt beschreiben eine andere Rechtslage: Ihr Tagesmuster (Tief am
Abend, Hoch am Morgen) ist das Gegenteil dessen, was die Nach-Gesetz-Daten
zeigen — belegt in [docs/archiv/BEFUND-12-UHR-REGEL-2026-09-18.md].

Dieses Modul liefert die gemeinsame Kante als **eine** UTC-Instanz:

- ``law_floor_utc(settings)``  — wirksame Kante (``None`` = keine Kante),
- ``price_law_local(settings)``— der konfigurierte lokale Zeitpunkt,
- ``law_floor_label(settings)``— Klartextdatum für Logs und Berichte.

Bewusst nur Standardbibliothek: ``app/heatmap.py`` und der Live-API-Pfad dürfen
kein pandas importieren (siehe ``app/config.py::engine_config``). Die Umrechnung
lokaler Zeitpunkt → UTC-Instanz folgt derselben Vorsicht wie
``engine/models.py::utc_time``: mehrdeutige (DST-Rücksprung) und nicht
existente (DST-Lücke) Wanduhrzeiten werden **abgelehnt**, nicht still
verschoben.

**Eine Quelle.** Der wirksame Wert kommt aus ``Settings.price_law_local``
(``TANKAPP_PRICE_LAW_LOCAL``) und wird über ``app/config.py::engine_config`` in
die Engine-Konfiguration durchgereicht — dasselbe Muster wie
``decision_hour``. :data:`DEFAULT_PRICE_LAW_LOCAL` spiegelt den Default von
``engine/config.py`` für Pfade ohne Settings; ``tests/test_b30_law_floor.py``
nagelt beide auf denselben Wert fest.
"""

from __future__ import annotations

import datetime as dt

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover - abgespecktes Image ohne zoneinfo
    ZoneInfo = None

UTC = dt.timezone.utc
TIMEZONE = "Europe/Berlin"
# Spiegel des Defaults aus engine/config.py (Config.price_law_local). Die
# App-Seite übergibt ihren Wert immer an die Engine; der Spiegel gilt nur für
# Aufrufer ohne Settings und wird per Test gegen die Engine geprüft.
DEFAULT_PRICE_LAW_LOCAL = "2026-04-01T12:00"


def _zone(name: str):
    if ZoneInfo is None:  # pragma: no cover - siehe Import oben
        return dt.timezone.utc
    try:
        return ZoneInfo(name)
    except Exception:
        return ZoneInfo(TIMEZONE)


def price_law_local(settings) -> str:
    """Konfigurierter lokaler Zeitpunkt der Regel (nie leer)."""
    raw = getattr(settings, "price_law_local", "") or ""
    return raw.strip() or DEFAULT_PRICE_LAW_LOCAL


def law_floor_enabled(settings) -> bool:
    """``TANKAPP_LAW_FLOOR=0`` schaltet die Kante ab (Gegenmessung)."""
    return bool(getattr(settings, "law_floor", True))


def parse_price_law(value: str, timezone: str = TIMEZONE) -> dt.datetime | None:
    """Lokalen Zeitpunkt der Regel als UTC-Instanz lesen.

    ``None`` bei leerem oder ungültigem Wert, bei mehrdeutiger Wanduhrzeit
    (DST-Rücksprung) und bei nicht existenter Wanduhrzeit (DST-Lücke) —
    dieselbe Ablehnung wie ``engine/models.py::utc_time`` statt einer
    stillschweigend verschobenen Kante. Bereits offset-behaftete Werte werden
    unverändert übernommen.
    """
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        naive = dt.datetime.fromisoformat(raw)
    except ValueError:
        return None
    if naive.tzinfo is not None:
        return naive.astimezone(UTC)
    zone = _zone(timezone)
    first = naive.replace(tzinfo=zone, fold=0).astimezone(UTC)
    second = naive.replace(tzinfo=zone, fold=1).astimezone(UTC)
    if first != second:
        return None  # mehrdeutig: zwei gültige UTC-Instanzen derselben Wanduhr
    if first.astimezone(zone).replace(tzinfo=None) != naive:
        return None  # nicht existent: die Wanduhrzeit fällt in die DST-Lücke
    return first


def law_floor_utc(settings) -> dt.datetime | None:
    """Wirksame Bodenkante als UTC-Instanz; ``None`` heißt „keine Kante"."""
    if not law_floor_enabled(settings):
        return None
    return parse_price_law(price_law_local(settings))


def law_floor_iso(settings) -> str | None:
    """Kante als ISO-8601-String (UTC) für Payloads; ``None`` ohne Kante."""
    floor = law_floor_utc(settings)
    return floor.isoformat() if floor is not None else None


def law_floor_label(settings) -> str | None:
    """Klartextdatum der Kante („01.04.2026") für Logs und Berichte."""
    floor = law_floor_utc(settings)
    if floor is None:
        return None
    local = floor.astimezone(_zone(TIMEZONE))
    return f"{local.day:02d}.{local.month:02d}.{local.year}"
