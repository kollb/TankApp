"""Regressions-Schutz für analysis/noon_rule_check.py (0.49.5).

Statuszeilen ohne gültigen Preis (valid=false / leerer Preis, z. B. eine
ganztägig geschlossene Station) dürfen den Lauf nicht in
``ValueError: All-NaN slice encountered`` kippen. Das war im ersten
NAS-Echteinsatz passiert, weil _prepare nicht filterte."""

import datetime as dt
from zoneinfo import ZoneInfo

import pandas as pd
import pytest

pytest.importorskip("numpy")
pytest.importorskip("pandas")

from analysis.noon_rule_check import _prepare, day_extrema, noon_steps  # noqa: E402

BERLIN = ZoneInfo("Europe/Berlin")


def _closed_day_csv(tmp_path):
    """Eine Station: drei Tage gültige 5-Minuten-Werte nach Gesetz plus ein
    komplett geschlossener Tag, dazu eine Geisterstation nur aus ungültigen
    Zeilen — das war der NAS-Absturz."""
    rows = []
    price = 1.95
    for day in pd.date_range("2026-09-09", "2026-09-11", tz=BERLIN):
        t = day + dt.timedelta(hours=6)
        while t < day + dt.timedelta(days=1):
            valid = (t.hour, t.minute) not in {(10, 0), (13, 30)}
            if t.hour == 12 and t.minute == 0:
                price += 0.06  # einziger Anstieg des Tages, genau um 12
            elif t.minute % 30 == 0:
                price = max(1.80, price - 0.005)
            rows.append(
                {
                    "timestamp": t.astimezone(dt.timezone.utc).isoformat(),
                    "station_id": "s1",
                    "station_name": "Test",
                    "brand": "Test",
                    "city": "Frankfurt",
                    "lat": 50.1,
                    "lon": 8.6,
                    "fuel": "E10",
                    "price": f"{price:.3f}" if valid else "",
                    "status": "open" if valid else "closed",
                    "valid": "true" if valid else "false",
                }
            )
            t += dt.timedelta(minutes=5)
    for h in range(24):  # Geisterstation: ein ganzer Tag ohne gültige Zeile
        rows.append(
            {
                "timestamp": f"2026-09-10T{h:02d}:30:00+00:00",
                "station_id": "ghost",
                "station_name": "Ghost",
                "brand": "x",
                "city": "Frankfurt",
                "lat": 50.1,
                "lon": 8.6,
                "fuel": "E10",
                "price": "",
                "status": "closed",
                "valid": "false",
            }
        )
    path = tmp_path / "closed_day.csv"
    pd.DataFrame(rows).to_csv(path, index=False)
    return path


def test_all_invalid_station_day_zaehlt_nicht_und_stuerzt_nicht_ab(tmp_path):
    """Frisst genau den All-NaN slice-Fall: Geisterstation und geschlossene
    Fenster werden gefiltert, statt die Tages-Extreme zu zerschlagen."""
    df = _prepare([_closed_day_csv(tmp_path)], "E10")
    # Der 5-Minuten-Grid liefert fuer s1 drei Tage; der Geist hat keine
    # einzige gueltige Beobachtung und taucht nirgendwo auf.
    assert df.station_id.unique().tolist() == ["s1"]
    days = day_extrema(df, min_obs=48, min_hours=6)
    assert not days.empty
    # Sprungkante und Tageslauf bleiben bewertbar: 12-Uhr-Schritt sichtbar.
    steps = noon_steps(df, max_gap=pd.Timedelta(minutes=120))
    jump = steps[steps["step_ct"] > 0]
    assert not jump.empty
