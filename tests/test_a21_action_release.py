"""A21-B1.4 — Handlungsfreigabe braucht aktuelle Evidenz (Issue 201).

Befund: Ein bestandenes, **historisches** M7-Gate ersetzte fehlende aktuelle
Evidenz. ``price=None`` fiel auf ``last_price`` zurück, fehlende
Prognosepfade rechneten das Median-Potenzial trotzdem zu einer prädiktiven
Aktion — bei ``stale_data_at_origin=True`` sagte die Antwort „warten“
(``decision_ready=false``): Bereitschaft und Handlung widersprachen sich.

Vertrag (jetzt): ``action`` ist nur dann eine Handlung, wenn die zentrale
Freigabekette trägt **und** M7 bestanden ist; sonst ``no_advice`` +
maschinenlesbare ``blocking_reasons``. ``decision_ready == (action !=
"no_advice")`` — nie ein Widerspruch. Preis/Potenzial bleiben sichtbar
(last_price-Anker, Fenster), ``p_correct`` und ``valid_until`` nur bei
Freigabe; die A2-Tankwarnung bleibt als eigener Physik-Block unabhängig.
Bewusst kein Kriterium: „PIT active“ — rohe Veröffentlichungen sind
freigebbar, nur die Herkunft muss bekannt sein (``origin_unknown`` sperrt).
"""

import datetime as dt
import json

import pytest

from app.config import Settings
from app.data import LiveData
from app.decide import (
    ACTION_BLOCKING_REASONS,
    evaluate_decide,
    release_still_valid,
)
from app.feedback import _empty_feedback_store, load_store

UID = "00000000-0000-0000-0000-000000000001"
NOW = dt.datetime(2026, 9, 10, 14, 0, tzinfo=dt.timezone.utc)  # 16:00 Berlin

CITY_PARAMS = {"city": "Frankfurt", "fuel": "e10", "liters": 40, "station_id": UID}


def _assert_contract(body):
    """Bereitschaft ↔ Handlung — die Invariante jedes decide-Payloads."""
    assert body["decision_ready"] == (body["primary"]["action"] != "no_advice")
    if body["decision_ready"]:
        assert body["blocking_reasons"] == []
        assert body["valid_until"] is not None
    else:
        assert body["valid_until"] is None
        assert body["primary"]["p_correct"] is None
    # p_correct nur bei Freigabe — nie neben no_advice.
    if body["primary"]["p_correct"] is not None:
        assert body["decision_ready"]
    assert all(code in ACTION_BLOCKING_REASONS for code in body["blocking_reasons"])
    assert body["blocking_reasons"] == list(dict.fromkeys(body["blocking_reasons"]))


@pytest.fixture
def settings(tmp_path):
    polling = tmp_path / "polling.json"
    polling.write_text(
        json.dumps(
            {
                "sets": {
                    "Frankfurt": {
                        "label": "Frankfurt",
                        "anchor": [50.11, 8.68],
                        "batch": [UID],
                        "stations": [
                            {
                                "uuid": UID,
                                "name": "Station Alpha",
                                "brand": "ARAL",
                                "lat": 50.12,
                                "lon": 8.69,
                            }
                        ],
                    }
                }
            }
        )
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


# --- M7-Ledger (geprüfter Skill, öffnet das M7-Gate) -----------------------


def _skill_store():
    """Besterand plus geprüfte Skill-Zeilen — ``calibrated`` ist True (O6)."""
    snaps, settlements = [], []
    rows = []
    for day in range(20):
        rows.extend(
            [
                (day, 12, 0.75, "win"),
                (day, 12, 0.75, "win"),
                (day, 12, 0.75, "win"),
                (day, 12, 0.75, "loss"),
                (day, 12, 0.25, "win"),
                (day, 12, 0.25, "loss"),
                (day, 12, 0.25, "loss"),
                (day, 12, 0.25, "loss"),
            ]
        )
    for i, (day, hour, p, outcome) in enumerate(rows):
        snaps.append(
            {
                "id": f"s{i}",
                "action": "wait",
                "p_correct": p,
                "p_source": "verteilung",
                "emitted_at": (NOW - dt.timedelta(days=day))
                .replace(hour=hour, minute=0, second=0, microsecond=0)
                .isoformat(),
            }
        )
        settlements.append({"snapshot_id": f"s{i}", "outcome": outcome})
    return {
        **_empty_feedback_store(),
        "episodes": [{"id": "ep", "snapshots": snaps}],
        "settlements": settlements,
    }


def _seed_m7(settings):
    store_file = settings.runtime / "feedback" / "store.json"
    store_file.parent.mkdir(parents=True, exist_ok=True)
    store_file.write_text(json.dumps(_skill_store()), encoding="utf-8")


# --- Prognose-Veröffentlichung ---------------------------------------------

# Fenster 16:00–20:00 Berlin, Blöcke 14:00/16:00/18:00 UTC — dieselbe
# Anordnung wie tests/test_b4.py (Fensterbeginn 16:00 Berlin ⇒ Block 0).
POINTS = [
    {"timestamp": "2026-09-10T16:00:00+02:00", "q50": 1.60},
    {"timestamp": "2026-09-10T17:00:00+02:00", "q50": 1.61},
    {"timestamp": "2026-09-10T18:00:00+02:00", "q50": 1.62},
    {"timestamp": "2026-09-10T19:00:00+02:00", "q50": 1.63},
    {"timestamp": "2026-09-10T20:00:00+02:00", "q50": 1.64},
]
BLOCKS = [
    {"start": "2026-09-10T14:00:00+00:00", "end": "2026-09-10T16:00:00+00:00"},
    {"start": "2026-09-10T16:00:00+00:00", "end": "2026-09-10T18:00:00+00:00"},
    {"start": "2026-09-10T18:00:00+00:00", "end": "2026-09-10T20:00:00+00:00"},
]
MINIMA = [
    [1.61, 1.70, 1.71],
    [1.60, 1.71, 1.72],
    [1.70, 1.68, 1.72],
    [1.62, 1.71, 1.72],
]
PIT_ENVELOPE = {
    "status": "active",
    "by_horizon": {
        "24h": {
            "schema_version": 1,
            "method": "isotonic_pit_quantile_recalibration",
            "levels": [0.0, 1.0],
            "cdf": [0.0, 1.0],
        }
    },
}


def _evidence_row(**overrides):
    """Eine Prognosezeile mit **vollständiger** Evidenz — per Override lochen."""
    row = {
        "station_id": UID,
        "city": "Frankfurt",
        "fuel": "e10",
        "origin": NOW.isoformat(),
        "points": POINTS,
        "draws_24h": {
            "n": 4,
            "block_minutes": 120,
            "blocks": BLOCKS,
            "minima": MINIMA,
            "nowcast": [1.68, 1.69, 1.70, 1.71],
        },
        "rolling_picp_7d": {
            "current": {"badge": "green", "picp_pct": 95.0, "points": 144, "n_days": 7}
        },
        "stale_data_at_origin": False,
        "calibrated": False,
        "calibration": None,
    }
    row.update(overrides)
    return row


def _publish(settings, row):
    path = settings.runtime / "engine/current.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"published_at": NOW.isoformat(), "forecasts": [row]}),
        encoding="utf-8",
    )


def _live(
    settings,
    *,
    price_ts=NOW - dt.timedelta(minutes=5),
    price="1.689",
    status="open",
    clock=None,
):
    def query(cfg, flux):
        if price is None:
            return []
        return [
            {
                "_time": price_ts.isoformat(),
                "city": "Frankfurt",
                "station_id": UID,
                "station": "Station Alpha",
                "status": status,
                "e10": str(price),
            }
        ]

    return LiveData(settings, query=query, clock=clock or (lambda: NOW))


def _decide(live, **extra):
    params = dict(CITY_PARAMS)
    params.update(extra)
    body = evaluate_decide(live, params)
    assert body.get("error_code") is None
    _assert_contract(body)
    return body


def _shadow_actions(settings):
    store = load_store(settings)
    return [
        snap["action"]
        for ep in store["episodes"]
        if ep.get("id") != "ep"
        for snap in ep.get("snapshots", [])
    ]


# --- Repro (Issue 201) -----------------------------------------------------


def test_repro_zwei_stunden_alter_preis_keine_freigabe_trotz_m7(settings):
    """M7 bestanden, Preis 2 h alt (``price=null``), ``stale_data_at_origin``,
    Future-Punkte, keine Draws — SOLL: keine prädiktive Handlungsfreigabe,
    Sperrgrund benannt (vorher: ``primary.action="wait"``, kein Sperrgrund)."""
    _seed_m7(settings)
    _publish(
        settings,
        _evidence_row(
            origin=(NOW - dt.timedelta(hours=2)).isoformat(),
            stale_data_at_origin=True,
            calibration={},
            draws_24h={},
            rolling_picp_7d={},
            points=[
                {"timestamp": (NOW + dt.timedelta(minutes=m)).isoformat(), "q50": 1.6}
                for m in (5, 55, 65, 115)
            ],
        ),
    )
    live = _live(settings, price_ts=NOW - dt.timedelta(hours=2))
    body = _decide(live)

    assert body["primary"]["action"] == "no_advice"
    assert body["decision_ready"] is False
    for code in ("price_stale", "data_stale", "paths_missing", "quality_missing"):
        assert code in body["blocking_reasons"]
    assert body["primary"]["p_correct"] is None

    # Preis/Potenzial bleiben sichtbar — nur die Freigabe ist gesperrt.
    assert body["primary"]["station"]["price_now"] == 1.689  # last_price-Anker
    assert body["windows_today"]
    assert body["primary"]["expected_saving_eur"] > 0

    # Der Ledger misst die Tabelle weiter im Shadow-Betrieb (Issue 201).
    assert _shadow_actions(settings) == ["wait"]


# --- Sperrgründe einzeln (Abnahme: fehlend/stale/geschlossen, Pfade,
#     Forecast, Herkunft, Güte) ---------------------------------------------


def test_preis_ohne_last_price_ist_price_missing(settings):
    _seed_m7(settings)
    _publish(settings, _evidence_row())
    body = _decide(_live(settings, price=None))
    assert body["primary"]["action"] == "no_advice"
    assert body["blocking_reasons"][0] == "price_missing"


def test_alter_preis_mit_last_price_ist_price_stale(settings):
    # stations() lässt price nur frisch und offen stehen — 20 min ist dort
    # noch ``price``, aber über der Frische-Schwelle (10 min): der Zweig
    # „vorhanden, aber alt“.
    _seed_m7(settings)
    _publish(settings, _evidence_row())
    body = _decide(_live(settings, price_ts=NOW - dt.timedelta(minutes=20)))
    assert body["primary"]["action"] == "no_advice"
    assert "price_stale" in body["blocking_reasons"]


def test_geschlossene_station_ist_station_unusable(settings):
    _seed_m7(settings)
    _publish(settings, _evidence_row())
    body = _decide(_live(settings, status="closed"))
    assert body["primary"]["action"] == "no_advice"
    assert "station_unusable" in body["blocking_reasons"]


def test_fehlende_prognose_ist_forecast_missing_ohne_folgesperren(settings):
    _seed_m7(settings)
    body = _decide(_live(settings))
    assert "forecast_missing" in body["blocking_reasons"]
    # Ohne Prognose sind Herkunft/Pfade/Güte subsumiert — kein Sperren-Chor.
    assert not {"origin_unknown", "paths_missing", "quality_missing"} & set(
        body["blocking_reasons"]
    )


def test_abgelaufenes_modell_ist_forecast_expired(settings):
    _seed_m7(settings)
    _publish(settings, _evidence_row(origin=(NOW - dt.timedelta(hours=25)).isoformat()))
    body = _decide(_live(settings))
    assert body["primary"]["action"] == "no_advice"
    assert "forecast_expired" in body["blocking_reasons"]


def test_prognose_ohne_zukunftspunkte_ist_forecast_expired(settings):
    _seed_m7(settings)
    _publish(
        settings,
        _evidence_row(
            points=[
                {"timestamp": (NOW - dt.timedelta(minutes=m)).isoformat(), "q50": 1.6}
                for m in (55, 5, 55, 65, 115)
            ]
        ),
    )
    body = _decide(_live(settings))
    assert "forecast_expired" in body["blocking_reasons"]


def test_unbekannte_herkunft_ist_origin_unknown(settings):
    _seed_m7(settings)
    _publish(settings, _evidence_row(origin=None))
    body = _decide(_live(settings))
    assert body["primary"]["action"] == "no_advice"
    assert "origin_unknown" in body["blocking_reasons"]


def test_fehlende_pfade_ist_paths_missing_kein_median_potenzial(settings):
    _seed_m7(settings)
    _publish(settings, _evidence_row(draws_24h={}))
    body = _decide(_live(settings))
    assert body["primary"]["action"] == "no_advice"
    assert "paths_missing" in body["blocking_reasons"]
    # Das Median-Potenzial bleibt Anzeige, nie Handlung.
    assert body["primary"]["expected_saving_eur"] > 0


def test_nichtendliche_pfade_sind_paths_invalid(settings):
    _seed_m7(settings)
    row = _evidence_row()
    row["draws_24h"] = {
        "n": 4,
        "block_minutes": 120,
        "blocks": BLOCKS,
        "minima": [[None, 1.70, 1.71], *MINIMA[1:]],
        "nowcast": [1.68, 1.69, 1.70, 1.71],
    }
    _publish(settings, row)
    body = _decide(_live(settings))
    assert body["primary"]["action"] == "no_advice"
    assert "paths_invalid" in body["blocking_reasons"]


def test_fehlende_gueteinfo_ist_quality_missing(settings):
    _seed_m7(settings)
    # Kein roter PICP ≠ positive Güte — nicht belegt ist keine Aussage.
    _publish(settings, _evidence_row(rolling_picp_7d={}))
    body = _decide(_live(settings))
    assert "quality_missing" in body["blocking_reasons"]

    # O4: Unter QUALITY_MIN_DAYS Tagen ist das Badge keine Aussage.
    _publish(
        settings,
        _evidence_row(
            rolling_picp_7d={
                "current": {
                    "badge": "green",
                    "picp_pct": 95.0,
                    "points": 20,
                    "n_days": 2,
                }
            }
        ),
    )
    body = _decide(_live(settings))
    assert "quality_missing" in body["blocking_reasons"]


def test_rotes_guete_gate_ist_quality_gate(settings):
    _seed_m7(settings)
    _publish(
        settings,
        _evidence_row(
            rolling_picp_7d={
                "current": {
                    "badge": "red",
                    "picp_pct": 88.5,
                    "points": 144,
                    "n_days": 7,
                }
            }
        ),
    )
    body = _decide(_live(settings))
    assert body["primary"]["action"] == "no_advice"
    assert "quality_gate" in body["blocking_reasons"]


def test_ohne_m7_ist_m7_pending_der_einzige_sperregrund(settings):
    # Kette frei, aber kein Skill-Ledger — genau der alte M7-Fall, unverändert.
    _publish(settings, _evidence_row())
    body = _decide(_live(settings))
    assert body["primary"]["action"] == "no_advice"
    assert body["blocking_reasons"] == ["m7_pending"]
    assert "Kalibrierung" in body["primary"]["reason_short"]


def test_kette_gebrochen_schlaegt_den_m7_hinweis(settings):
    # Der Evidenzgrund führt den Text — nicht „Kalibrierung steht aus“.
    _publish(settings, _evidence_row(draws_24h={}))
    body = _decide(_live(settings))
    assert set(body["blocking_reasons"]) == {"paths_missing", "m7_pending"}
    assert "Kalibrierung" not in body["primary"]["reason_short"]
    assert "Prognoseverteilung" in body["primary"]["reason_short"]


# --- Positivtests legitimer Freigaben --------------------------------------


def test_freigabe_mit_roher_verteilung_ist_moeglich(settings):
    """PIT ist kein Universalkriterium — raw + pit_24h sind freigebbar."""
    _seed_m7(settings)
    _publish(settings, _evidence_row())
    body = _decide(_live(settings))
    assert body["primary"]["action"] == "wait"
    assert body["decision_ready"] is True
    assert body["blocking_reasons"] == []
    assert body["primary"]["p_correct"] is not None
    assert body["calibrated"] is True


def test_freigabe_mit_pit_24h_ist_moeglich(settings):
    _seed_m7(settings)
    _publish(
        settings,
        _evidence_row(calibrated=True, calibration=PIT_ENVELOPE),
    )
    body = _decide(_live(settings))
    assert body["primary"]["action"] == "wait"
    assert body["decision_ready"] is True
    store = load_store(settings)
    new = [
        s for ep in store["episodes"] if ep.get("id") != "ep" for s in ep["snapshots"]
    ]
    assert new[-1]["forecast_calibration_state"] == "pit_24h"


def test_kaputte_huelle_faellt_auf_raw_und_sperrt_nicht(settings):
    # Aktive Hülle ohne gültige Kurve ⇒ raw (B2) — kein Herkunfts-Verlust,
    # solange origin bekannt ist.
    broken = {"status": "active", "by_horizon": {"24h": {"schema_version": 1}}}
    _seed_m7(settings)
    _publish(settings, _evidence_row(calibrated=True, calibration=broken))
    body = _decide(_live(settings))
    assert body["primary"]["action"] == "wait"
    store = load_store(settings)
    new = [
        s for ep in store["episodes"] if ep.get("id") != "ep" for s in ep["snapshots"]
    ]
    assert new[-1]["forecast_calibration_state"] == "raw"


def test_valid_until_grenzt_preisfrische_und_modellalter(settings):
    _seed_m7(settings)
    _publish(settings, _evidence_row())
    # Alter Preis 8 min, Schwelle 10 min ⇒ Gültigkeit endet in 2 min —
    # deutlich vor der Modellalter-Grenze (origin + 24 h).
    body = _decide(_live(settings, price_ts=NOW - dt.timedelta(minutes=8)))
    assert body["decision_ready"] is True
    assert body["valid_until"] == (NOW + dt.timedelta(minutes=2)).isoformat()

    _publish(settings, _evidence_row())
    body = _decide(_live(settings))
    # Alter 5 min, Schwelle 10 min ⇒ Preisfrische endet in 5 min — vor dem
    # Modellalter (origin + 24 h).
    assert body["valid_until"] == (NOW + dt.timedelta(minutes=5)).isoformat()


def test_release_still_valid_ist_fail_safe():
    now = NOW
    assert release_still_valid(None, now) is True
    assert release_still_valid({"valid_until": None}, now) is True
    assert release_still_valid({}, now) is True
    future = (now + dt.timedelta(minutes=5)).isoformat()
    past = (now - dt.timedelta(minutes=5)).isoformat()
    assert release_still_valid({"valid_until": future}, now) is True
    assert release_still_valid({"valid_until": past}, now) is False
    assert release_still_valid({"valid_until": "Müll"}, now) is False


# --- A2-Tankphysik bleibt unabhängig ---------------------------------------


def test_reservetank_ist_physik_auch_ohne_freigabe(settings):
    """Kein Warten im Reservebereich — und die Warnung erscheint als eigener
    Physik-Block auch dann, wenn die Evidenzkette die Handlung sperrt."""
    _seed_m7(settings)
    _publish(settings, _evidence_row(draws_24h={}))
    body = _decide(_live(settings), tank_percent=5, tank_capacity_l=50)
    assert body["primary"]["action"] == "no_advice"
    assert body["tank"]["blocks_wait"] is True
    assert body["tank"]["message"].startswith("Warten riskant")
    # Die Physik kippt die Tabellen-Aktion schon im Shadow-Ledger („auch vor
    # dem M7-Gate“, tests/test_decide_tank.py).
    assert _shadow_actions(settings) == ["refuel_now"]


def test_reservetank_kippt_eine_freigegebene_warteempfehlung(settings):
    _seed_m7(settings)
    _publish(settings, _evidence_row())
    body = _decide(_live(settings), tank_percent=5, tank_capacity_l=50)
    assert body["primary"]["action"] == "refuel_now"
    assert body["decision_ready"] is True
    assert body["primary"]["confidence_badge"] == "high"


# --- Cache: keine abgelaufene Freigabe erneut ------------------------------


def test_uebersicht_cache_zeigt_keine_abgelaufene_freigabe(settings):
    _seed_m7(settings)
    _publish(settings, _evidence_row())
    state = {"now": NOW}

    def query(cfg, flux):
        return [
            {
                "_time": (state["now"] - dt.timedelta(minutes=5)).isoformat(),
                "city": "Frankfurt",
                "station_id": UID,
                "station": "Station Alpha",
                "status": "open",
                "e10": "1.689",
            }
        ]

    live = LiveData(settings, query=query, clock=lambda: state["now"])
    params = {"city": "Frankfurt", "fuel": "e10", "liters": 40}

    first = live.overview(params, etag="fester-etag")
    assert first["decide"]["decision_ready"] is True
    assert first["decide"]["primary"]["action"] == "wait"

    # 6 h später: dieselbe Datenstands-Kennung (also derselbe Cache-Slot),
    # aber die Freigabe ist über ``valid_until`` abgelaufen — der Treffer darf
    # die alte Aktion nicht erneut freigeben. Der Neuaufbau sieht dann
    # realistischerweise zwei gebrochene Glieder: der Stale-While-Revalidate-
    # Preiscache trägt die alte Beobachtung (``price_stale``) und alle
    # Future-Punkte sind vergangen (``forecast_expired``).
    state["now"] = NOW + dt.timedelta(hours=6)
    second = live.overview(params, etag="fester-etag")
    assert second["decide"]["primary"]["action"] == "no_advice"
    assert second["decide"]["decision_ready"] is False
    assert second["decide"]["valid_until"] is None
    assert {"price_stale", "forecast_expired"} <= set(
        second["decide"]["blocking_reasons"]
    )

    # Ein nicht abgelaufener Treffer bleibt ein Treffer (identisches Objekt).
    state["now"] = NOW
    live.overview_cache.clear()
    again = live.overview(params, etag="fester-etag")
    cached = live.overview(params, etag="fester-etag")
    assert cached is again
