"""O45 — Zwei Ersparnisse, ein Name: die Basis muss im Satz stehen.

Befund (Nutzer-Rückmeldung 21.09.2026): Die Empfehlung las sich als
Widerspruch —

    Bis heute 11:50 Uhr warten lohnt sich
    Prognose rechnet bis 11:50 Uhr mit ~2.221 € … erwartet ~2.09 € Ersparnis
    für 55 L.
    2,229 €/L

Denn 2,229 − 2,221 sind 0,44 €, nicht 2,09 €. Beide Zahlen sind richtig,
sie rechnen nur gegen verschiedene Größen:

* ``expected_saving_eur`` = max(0, (Anker − Median der **Fensterminima**) ×
  Liter) — dieselbe Größe, gegen die ``p_better`` (P(min ≤ Anker − 1 ct))
  und das Advice-Settlement (``_realized_min``) rechnen;
* ``expected_saving_median_eur`` = max(0, (Anker − ``expected_price``) ×
  Liter) — die Größe, die zum angezeigten ct/L-Abstand passt.

Die 2,09 € gehören zu 2,191 €/L, einem Preis, den die Karte nie gezeigt
hat. Dieser Test hält die Zahlen des Befunds fest und dass der Satz der
Entscheidungstabelle beide Basen nennt, sobald sie auseinanderfallen.
"""

import datetime as dt
import json

import pytest

from app.config import Settings
from app.data import LiveData
from app.decide import _table_action, _wait_saving_clause, evaluate_decide
from app.pside import THETA_CT, p_better

UID = "00000000-0000-0000-0000-000000000001"
OTHER = "00000000-0000-0000-0000-000000000002"
# 10:00 Uhr Berlin — das Fenster des Befunds (10–12 Uhr, Tanken bis 11:50).
NOW = dt.datetime(2026, 9, 21, 8, 0, tzinfo=dt.timezone.utc)

ANCHOR = 2.229  # €/L, aktuell
LITERS = 55.0
MEDIAN_PRICE = 2.221  # €/L, Median der q50-Punkte im Fenster
MEDIAN_MIN = 2.191  # €/L, Median der Fensterminima

# Ersparnisse des Befunds — ausgerechnet, damit der Test die Formel zeigt.
SAVING_MINIMA = round((ANCHOR - MEDIAN_MIN) * LITERS, 2)  # 2.09 €
SAVING_MEDIAN = round((ANCHOR - MEDIAN_PRICE) * LITERS, 2)  # 0.44 €


@pytest.fixture
def o45_settings(tmp_path):
    polling = tmp_path / "polling.json"
    polling.write_text(
        json.dumps(
            {
                "sets": {
                    "Frankfurt": {
                        "label": "Frankfurt",
                        "anchor": [50.11, 8.68],
                        "batch": [UID, OTHER],
                        "stations": [
                            {
                                "uuid": UID,
                                "name": "Station A",
                                "brand": "BrandA",
                                "lat": 50.1109,
                                "lon": 8.6821,
                            },
                            {
                                "uuid": OTHER,
                                "name": "Station B",
                                "brand": "BrandB",
                                "lat": 50.1150,
                                "lon": 8.6850,
                            },
                        ],
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    env = tmp_path / "influx.env"
    env.write_text(
        "TANKAPP_INFLUX_URL=http://nas:8086\nTANKAPP_INFLUX_ORG=local\n"
        "TANKAPP_INFLUX_BUCKET=tankapp\nTANKAPP_INFLUX_TOKEN=dummy\n"
    )
    static = tmp_path / "web"
    static.mkdir()
    (static / "index.html").write_text("<html>test</html>")
    return Settings(
        data=tmp_path / "data",
        archive=tmp_path / "archive",
        polling=polling,
        influx_env=env,
        netrc=tmp_path / "netrc",
        static=static,
    )


def raw_price(ts, uid, city, price, status="open", fuel="e10"):
    return {
        "_time": ts.isoformat(),
        "city": city,
        "station_id": uid,
        "station": "Station",
        "status": status,
        fuel: str(price),
    }


def _draws(minima):
    """Ein 2-h-Block (10:00–12:00 Berlin = 08:00 UTC) mit ``minima``."""
    return {
        "n": len(minima),
        "block_minutes": 120,
        "blocks": [
            {
                "start": "2026-09-21T08:00:00+00:00",
                "end": "2026-09-21T10:00:00+00:00",
            }
        ],
        "minima": minima,
        "nowcast": [ANCHOR] * len(minima),
    }


def _write_publication(settings, minima):
    """Veröffentlichung mit Medianpreis 2,221 €/L und den gegebenen Minima."""
    points = [
        {"timestamp": "2026-09-21T10:00:00+02:00", "q50": MEDIAN_PRICE},
        {"timestamp": "2026-09-21T11:00:00+02:00", "q50": MEDIAN_PRICE},
    ]
    draws = _draws(minima)
    path = settings.runtime / "engine/current.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "published_at": NOW.isoformat(),
                "forecasts": [
                    {
                        "station_id": UID,
                        "city": "Frankfurt",
                        "fuel": "e10",
                        "origin": NOW.isoformat(),
                        "points": points,
                        "points_7d": points,
                        "draws_24h": draws,
                        "draws_7d": draws,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )


def _decide(settings):
    def query(cfg, flux):
        yield raw_price(NOW - dt.timedelta(minutes=3), UID, "Frankfurt", ANCHOR)

    live = LiveData(settings, query=query, clock=lambda: NOW)
    return evaluate_decide(live, {"city": "Frankfurt", "fuel": "e10", "liters": LITERS})


def test_o45_befund_numbers():
    """Die beiden €-Zahlen des Befunds sind verschiedene Größen.

    2,09 € entsprechen 2,191 €/L — nicht dem angezeigten Medianpreis
    2,221 €/L; der trägt 0,44 €. Genau dieses Auseinanderfallen las sich
    in der Karte wie ein Rechenfehler.
    """
    assert SAVING_MINIMA == 2.09
    assert SAVING_MEDIAN == 0.44
    assert round(ANCHOR - SAVING_MINIMA / LITERS, 3) == MEDIAN_MIN


def test_o45_live_payload_carries_both_bases(o45_settings):
    """/decide liefert beide Ersparnisse — und die GUI-Basis passt zum Preis."""
    # 71 % der Fensterminima liegen mindestens 1 ct/L unter dem Anker —
    # die „71 %“ des Befunds, gerechnet mit derselben Funktion.
    minima = [[MEDIAN_MIN]] * 71 + [[2.225]] * 29
    _write_publication(o45_settings, minima)

    res = _decide(o45_settings)
    primary = res["primary"]

    assert primary["station"]["price_now"] == ANCHOR
    assert primary["recommended_window"]["expected_price"] == MEDIAN_PRICE
    assert primary["recommended_window"]["expected_min_price"] == MEDIAN_MIN
    assert primary["expected_saving_eur"] == SAVING_MINIMA
    assert primary["expected_saving_median_eur"] == SAVING_MEDIAN
    assert p_better(minima, 0, ANCHOR, THETA_CT) == 0.71

    # Die Zahl neben dem ct/L-Abstand muss zum angezeigten Preis passen —
    # dieselbe Rechnung, die die Karte aufmacht.
    assert primary["expected_saving_median_eur"] == round(
        (
            primary["station"]["price_now"]
            - primary["recommended_window"]["expected_price"]
        )
        * LITERS,
        2,
    )
    # Beide Basen stehen auch je Fenster da (windows_today/windows_week).
    for window in res["windows_today"] + res["windows_week"]:
        assert window["expected_saving_eur"] == SAVING_MINIMA
        assert window["expected_saving_median_eur"] == SAVING_MEDIAN


def test_o45_reason_names_both_bases():
    """Der Satz der Tabelle nennt beide Basen, sobald sie auseinanderfallen."""
    _action, badge, reason, code = _table_action(
        ANCHOR,
        MEDIAN_PRICE,
        SAVING_MINIMA,
        None,
        0.71,
        saving_median_eur=SAVING_MEDIAN,
    )
    assert (_action, badge, code) == ("wait", "high", None)
    assert "im günstigsten Moment bis zu 2,09 €" in reason
    assert "im Mittel 0,44 €" in reason
    # de-DE (MICROCOPY §3): Komma, nie Punkt.
    assert "2.09" not in reason and "0.44" not in reason


def test_o45_reason_stays_short_without_divergence():
    """Ohne Draws (beide Größen identisch) bleibt die kurze Fassung."""
    action, _badge, reason, code = _table_action(
        1.70,
        1.64,
        2.40,
        None,
        0.8,
        saving_median_eur=2.40,
    )
    assert (action, code) == ("wait", None)
    assert "bis zu 2,40 €" in reason
    assert "im günstigsten Moment" not in reason
    # Und der Aufruf ohne die Median-Ersparnis (Altpfad/Shadow-Auswertung)
    # erfindet keine zweite Zahl.
    action_default, _b, reason_default, code_default = _table_action(
        ANCHOR, MEDIAN_PRICE, 2.40, None, 0.8
    )
    assert (action_default, code_default) == ("wait", None)
    assert "bis zu 2,40 €" in reason_default
    assert "im Mittel" not in reason_default


def test_o45_clause_without_median_advantage():
    """Trägt nur das Fensterminimum einen Vorsprung, sagt der Satz das."""
    clause = _wait_saving_clause(SAVING_MINIMA, 0.0)
    assert "im günstigsten Moment bis zu 2,09 €" in clause
    assert "im Mittel kein Vorsprung gegenüber jetzt" in clause
