"""O30 — Die Bilanz zeigt netto, was netto entschieden wurde.

„Du hast diesen Monat 14,20 € gespart“ stand neben Entscheidungen, die
derselbe Nutzer **mit** Umwegkosten getroffen hat (`p_lohnt` rechnet netto,
O9). Die Zahl war nicht falsch, aber nicht die, nach der entschieden wurde.

Batch-Check: Die Bilanz zeigt eine Netto-Zeile, die mit O9 übereinstimmt —
dieselbe Formel (`app.route.net_economics`), dieselben Parameter wie im
Profil — und beide Zeilen sind benannt.
"""

import datetime as dt

from app.feedback import (
    compute_wallet_balance,
    compute_wallet_stats,
    fill_detour_cost_eur,
)
from app.route import net_economics

NOW = dt.datetime(2026, 9, 17, 12, 0, tzinfo=dt.timezone.utc)

# Beleg mit Umweg: 4 km extra, 7 L/100 km, 45 km/h, Zeitwert 10 €/h — die
# Parameter, die zur Empfehlung im Snapshot standen (Profil).
PROVENANCE = {
    "distance_source": "estimated_snapshot",
    "detour_km_total": 4.0,
    "reference_price": 1.7,
    "consumption_l_100km": 7.0,
    "speed_kmh": 45.0,
    "time_value_eur_h": 10.0,
}


def fill(fill_id: str, **overrides) -> dict:
    row = {
        "id": fill_id,
        "tanked_at": (NOW - dt.timedelta(days=3)).isoformat(),
        "liters": 40.0,
        "price_paid": 1.6,
        "price_source": "live",
        "compliance": "followed",
        "settled": "im_fenster",
        "saved_vs_always_now_eur": 4.0,
        "elsewhere_net_eur": None,
        "elsewhere_net_provenance": None,
    }
    row.update(overrides)
    return row


def store(*fills) -> dict:
    return {"schema_version": 5, "fills": list(fills), "episodes": []}


def test_umwegkosten_sind_dieselbe_formel_wie_die_entscheidung():
    row = fill("a", elsewhere_net_provenance=PROVENANCE)
    cost, source = fill_detour_cost_eur(row)
    expected = net_economics(1.7, 1.6, 40.0, 4.0, 7.0, 45.0, 10.0)
    assert cost == expected["detour_cost_eur"]
    # Und damit: netto = brutto − Umweg, exakt wie in der Entscheidung.
    assert round(4.0 - cost, 2) == round(expected["gross_eur"] - cost, 2)
    assert source == "estimated_snapshot"


def test_beleg_ohne_umweg_kostet_nichts_und_erfindet_keine_kilometer():
    cost, source = fill_detour_cost_eur(fill("b"))
    assert cost == 0.0
    assert source is None


def test_unvollstaendige_herkunft_wird_nicht_ergaenzt():
    """Fehlt ein Parameter, bleibt die Zeile brutto — kein erfundener Wert."""
    partial = {key: value for key, value in PROVENANCE.items() if key != "speed_kmh"}
    cost, source = fill_detour_cost_eur(fill("c", elsewhere_net_provenance=partial))
    assert cost == 0.0
    assert source is None


def test_wallet_stats_weist_brutto_und_netto_aus():
    stats = compute_wallet_stats(
        store(fill("a", elsewhere_net_provenance=PROVENANCE), fill("b")), now=NOW
    )
    cost = net_economics(1.7, 1.6, 40.0, 4.0, 7.0, 45.0, 10.0)["detour_cost_eur"]
    assert stats["saved_eur"] == 8.0  # 2 × 4,00 € brutto
    assert stats["saved_net_eur"] == round(8.0 - cost, 2)
    assert stats["detour_cost_eur"] == round(cost, 2)
    assert stats["n_detour_fills"] == 1
    assert stats["n_detour_estimated"] == 1
    # Ohne Umweg bleibt netto = brutto (keine pauschale Schätzung).
    plain = compute_wallet_stats(store(fill("b")), now=NOW)
    assert plain["saved_net_eur"] == plain["saved_eur"] == 4.0
    assert plain["n_detour_fills"] == 0


def test_bilanz_zaehlt_netto_je_monat_und_insgesamt():
    balance = compute_wallet_balance(
        store(
            fill("a", elsewhere_net_provenance=PROVENANCE),
            fill("b", tanked_at=(NOW - dt.timedelta(days=40)).isoformat()),
        ),
        now=NOW,
    )
    cost = net_economics(1.7, 1.6, 40.0, 4.0, 7.0, 45.0, 10.0)["detour_cost_eur"]
    overall = balance["overall"]
    assert overall["saved_eur"] == 8.0
    assert overall["saved_net_eur"] == round(8.0 - cost, 2)
    # Je Zeile dieselben beiden Zahlen — nicht nur in der Summe.
    months = {row["key"]: row for row in balance["months"]}
    current = months["2026-09"]
    assert current["saved_net_eur"] == round(4.0 - cost, 2)
    assert current["n_detour_fills"] == 1
    previous = months["2026-08"]
    assert previous["saved_net_eur"] == previous["saved_eur"] == 4.0
    assert previous["n_detour_fills"] == 0


def test_tatsaechliche_kilometer_zaehlen_als_gemessen():
    actual = dict(PROVENANCE, distance_source="actual_receipt", detour_km_total=6.0)
    stats = compute_wallet_stats(
        store(fill("a", elsewhere_net_provenance=actual)), now=NOW
    )
    cost = net_economics(1.7, 1.6, 40.0, 6.0, 7.0, 45.0, 10.0)["detour_cost_eur"]
    assert stats["saved_net_eur"] == round(4.0 - cost, 2)
    assert stats["n_detour_fills"] == 1
    assert stats["n_detour_estimated"] == 0
