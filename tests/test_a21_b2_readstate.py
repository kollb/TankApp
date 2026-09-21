"""A21-B2.2 (#203) — ein Lesezustand je Ledger-Revision.

Der Audit maß auf dem NAS-Pfad: ``/overview`` las den Ledger zweimal (decide
und stats_summary), rechnete Advice- und Wallet-Statistik zweimal (1,82 s bei
1 600 Settlements, davon 1,79 s doppelt), parste den Store für den
Snapshot-Vorblick ein drittes Mal und lieferte keine Revisionsangabe —
``error_code=null`` außen verbarg ``influx_read_failed`` im Tagesblock.

Dieser Test hält die Gegenprobe fest:

* eine Ledger-/Archiv-/Statistikrechnung je Revision (Zählung der Aufrufe),
* Decide und Stats-Summary lesen **dieselben** Zahlen und Schwellen,
* ein neuer Beleg, ein neuer Tag oder ein neues Uhrfenster invalidieren,
* parallele Anfragen derselben Revision rechnen genau einmal (Singleflight),
  Fehler werden nicht gespeichert, die Ablage bleibt begrenzt,
* der Snapshot-Vorblick liest den Store nicht erneut,
* die Antwort nennt Revision und Teilfehler explizit.

Die Zählungen sind deterministisch; absolute Laufzeiten werden nicht geprüft
(langsame CI). Die Statistikzahlen selbst müssen identisch zu einer direkten
Rechnung bleiben — der Test vergleicht sie mit ``compute_advice_stats`` auf
demselben Store.
"""

from __future__ import annotations

import datetime as dt
import json
import threading
import time

import pytest

import app.feedback as feedback_module
import app.read_state as read_state
from app.config import Settings
from app.data import LiveData, data_version
from app.decide import evaluate_decide
from app.stats_summary import evaluate_stats_summary
from test_rp2_fallback import default_poll_lines  # noqa: F401  (Muster)

UID = "00000000-0000-0000-0000-000000000001"
# Der Revisionsschlüssel trägt ein epoch-aligned 5-Minuten-Fenster. Die
# Testuhr startet bewusst **in** einem Fenster (2 min nach dessen Beginn),
# damit „+1 Minute" dasselbe und „+4 Minuten" ein neues Fenster ist.
_BASE = dt.datetime(2026, 9, 18, 12, 0, tzinfo=dt.timezone.utc)
NOW = dt.datetime.fromtimestamp(
    (int(_BASE.timestamp()) // read_state.CLOCK_BUCKET_SECONDS)
    * read_state.CLOCK_BUCKET_SECONDS
    + 120,
    tz=dt.timezone.utc,
)


@pytest.fixture
def settings(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    polling = data / "polling.json"
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
        ),
        encoding="utf-8",
    )
    env = data / "influx.env"
    env.write_text(
        "TANKAPP_INFLUX_URL=http://nas:8086\nTANKAPP_INFLUX_ORG=local\n"
        "TANKAPP_INFLUX_BUCKET=tankapp\nTANKAPP_INFLUX_TOKEN=dummy\n",
        encoding="utf-8",
    )
    static = data / "web"
    static.mkdir()
    return Settings(
        data=data,
        archive=data / "archive",
        polling=polling,
        influx_env=env,
        netrc=data / "_netrc",
        static=static,
    )


class Clock:
    """Verstellbare Uhr — Tageswechsel und Uhrfenster sind prüfbar."""

    def __init__(self, now: dt.datetime = NOW):
        self.now = now

    def __call__(self) -> dt.datetime:
        return self.now


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def live(settings, clock):
    return LiveData(settings, query=lambda *a, **k: iter([]), clock=clock)


PARAMS = {
    "city": "Frankfurt",
    "fuel": "e10",
    "station_id": UID,
    "liters": "40",
    "consumption": "7",
    "speed_kmh": "40",
    "mode": "onroute",
}


def _count_calls(monkeypatch, name: str, counter: dict[str, int]):
    """Zählt Aufrufe einer Feedback-Funktion, ohne ihr Verhalten zu ändern.

    Immer **als letztes** patchen: Ein späteres ``setattr`` ersetzt den
    Zähler wieder (der Wrapper ruft das beim Anlegen gemerkte Original).
    """
    original = getattr(feedback_module, name)

    def wrapper(*args, **kwargs):
        counter[name] = counter.get(name, 0) + 1
        return original(*args, **kwargs)

    monkeypatch.setattr(feedback_module, name, wrapper)
    return wrapper


# ---------------------------------------------------------------------------
# Eine Rechnung je Revision
# ---------------------------------------------------------------------------


def test_lesezustand_liest_store_und_archiv_einmal(settings, clock, monkeypatch):
    """Batch-Check: ein Lesezustand — ein Store- und ein Archivlesevorgang."""
    counter: dict[str, int] = {}
    for name in ("load_store", "load_archive_records"):
        _count_calls(monkeypatch, name, counter)

    bundle = read_state.load_bundle(settings, clock())

    assert counter["load_store"] == 1, "der Store wurde mehrfach gelesen"
    assert counter["load_archive_records"] == 1, "das Archiv wurde mehrfach gelesen"
    assert bundle.ledger


def test_overview_rechnet_die_statistik_einmal(settings, live, clock, monkeypatch):
    """Eine Overview-Anfrage rechnet Advice und Wallet je einmal (B2.2)."""
    counter: dict[str, int] = {}
    _count_calls(monkeypatch, "compute_wallet_stats", counter)
    _count_calls(monkeypatch, "compute_advice_stats", counter)

    result = live.overview(PARAMS, live.overview_etag(PARAMS))

    assert counter["compute_advice_stats"] == 1, "Advice-Statistik mehrfach gerechnet"
    assert counter["compute_wallet_stats"] == 1, "Wallet-Statistik mehrfach gerechnet"

    # Decide und Stats-Summary sehen dieselben Zahlen (nicht nur gleiche Form).
    advice = result["stats_summary"]["live_advice"]
    wallet = result["stats_summary"]["wallet"]
    assert result["decide"]["personal_stats"]["advice"]["brier_30d"] == advice.get(
        "brier_30d"
    )
    assert result["decide"]["personal_stats"]["advice"]["last_30d_total"] == advice.get(
        "n"
    )
    assert result["decide"]["personal_stats"]["wallet"]["saved_eur_30d"] == wallet.get(
        "saved_eur"
    )
    assert (
        result["decide"]["thresholds"]["active"]
        == result["stats_summary"]["thresholds"]
    )


def test_statistik_bleibt_identisch_zur_direkten_rechnung(settings, live, clock):
    """Kein verkürzter Ledger: dieselben Zahlen wie ohne Lesezustand."""
    bundle = read_state.load_bundle(settings, clock())
    direct_advice = feedback_module.compute_advice_stats(bundle.ledger, now=clock())
    direct_wallet = feedback_module.compute_wallet_stats(bundle.ledger, now=clock())
    assert bundle.advice == direct_advice
    assert bundle.wallet == direct_wallet


def test_zweite_leseanfrage_nutzt_die_ablage(settings, live, clock, monkeypatch):
    """Nach der ersten Rechnung dient dieselbe Revision aus dem Speicher.

    Nur Lesepfade: ``/decide`` schreibt den ersten Snapshot und ist damit
    selbst eine neue Revision (das prüft der Beleg-Test unten).
    """
    counter: dict[str, int] = {}
    _count_calls(monkeypatch, "compute_advice_stats", counter)

    live.stats_summary({"fuel": "e10", "city": "Frankfurt"})
    live.stats_summary({"fuel": "e10"})
    live.overview(PARAMS, "etag-2")

    assert counter["compute_advice_stats"] == 1, (
        "zweite Anfrage derselben Revision hat neu gerechnet"
    )


def test_erster_snapshot_ist_eine_neue_revision(settings, live, clock, monkeypatch):
    """Der Snapshot-Log verändert den Store — die nächste Anfrage rechnet neu.

    Das ist die **richtige** Invalidierung: Ein neuer Snapshot ist neuer
    bewertungsrelevanter Inhalt (Audit §4.4), kein Cache-Zufall.
    """
    counter: dict[str, int] = {}
    _count_calls(monkeypatch, "compute_advice_stats", counter)

    live.decide(dict(PARAMS))  # legt Episode + Snapshot an (Schreibpfad)
    live.stats_summary({"fuel": "e10", "city": "Frankfurt"})

    assert counter["compute_advice_stats"] == 2


def test_neuer_beleg_invalidiert(settings, live, clock, monkeypatch):
    """Ein neuer Beleg ist eine neue Ledger-Revision."""
    counter: dict[str, int] = {}
    _count_calls(monkeypatch, "compute_advice_stats", counter)

    live.decide(dict(PARAMS))  # legt den Store an (Schreibpfad)
    live.stats_summary({"fuel": "e10", "city": "Frankfurt"})
    counter.clear()  # ab hier zählen: derselbe Stand darf nichts kosten
    live.stats_summary({"fuel": "e10", "city": "Frankfurt"})
    assert counter.get("compute_advice_stats", 0) == 0, "derselbe Stand rechnet neu"

    store_path = settings.runtime / "feedback" / "store.json"
    store = json.loads(store_path.read_text(encoding="utf-8"))
    store.setdefault("fills", []).append(
        {
            "id": "fill_b2",
            "station_id": UID,
            "fuel": "e10",
            "liters": 30.0,
            "price_eur": 1.7,
            "tanked_at": (clock() - dt.timedelta(hours=2)).isoformat(),
            "compliance": "now",
            "source": "manual",
        }
    )
    store_path.write_text(json.dumps(store), encoding="utf-8")

    live.stats_summary({"fuel": "e10", "city": "Frankfurt"})
    assert counter.get("compute_advice_stats", 0) == 1, (
        "neuer Beleg hat nicht invalidiert"
    )


def test_zeitstand_und_tageswechsel_invalidieren(settings, live, clock, monkeypatch):
    """Der Revisionsschlüssel trägt Datenstand **und** Zeitstand.

    ``data_version`` fährt ein 60-s-Fenster (B7-Revalidierung), der Schlüssel
    zusätzlich ein 5-Minuten-Fenster. Innerhalb derselben Minute dient der
    Speicher; eine neue Minute rechnet neu — die bewusste Frischegrenze für
    zeitabhängige Fenster (Audit §4.4), ausgewiesen statt stillschweigend.
    """
    counter: dict[str, int] = {}
    _count_calls(monkeypatch, "compute_advice_stats", counter)

    live.stats_summary({"fuel": "e10", "city": "Frankfurt"})
    assert counter["compute_advice_stats"] == 1

    clock.now = clock.now + dt.timedelta(seconds=20)
    live.stats_summary({"fuel": "e10", "city": "Frankfurt"})
    assert counter["compute_advice_stats"] == 1, "derselbe Minutenstand rechnet neu"

    clock.now = clock.now + dt.timedelta(minutes=10)
    live.stats_summary({"fuel": "e10", "city": "Frankfurt"})
    assert counter["compute_advice_stats"] == 2, "neue Minute hat nicht invalidiert"
    assert read_state.clock_bucket(clock.now) != read_state.clock_bucket(NOW)

    clock.now = NOW + dt.timedelta(days=1)
    live.stats_summary({"fuel": "e10", "city": "Frankfurt"})
    assert counter["compute_advice_stats"] == 3, "Tageswechsel hat nicht invalidiert"


# ---------------------------------------------------------------------------
# Parallele Anfragen, Fehler, Ablage
# ---------------------------------------------------------------------------


def test_parallele_anfragen_rechnen_einmal(settings, clock, monkeypatch):
    """Singleflight: vier gleichzeitige Anfragen, eine Rechnung (B2.2)."""
    counter: dict[str, int] = {}
    original = feedback_module.compute_advice_stats

    def slow(*args, **kwargs):
        time.sleep(0.2)
        return original(*args, **kwargs)

    monkeypatch.setattr(feedback_module, "compute_advice_stats", slow)
    _count_calls(monkeypatch, "compute_advice_stats", counter)

    results = []
    errors = []
    start = threading.Barrier(4)

    def worker():
        start.wait(timeout=5)
        try:
            results.append(read_state.load_bundle(settings, clock()))
        except Exception as exc:  # pragma: no cover - Diagnose im Fehlerfall
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert not errors
    assert counter["compute_advice_stats"] == 1, "Bootstrap-Sturm statt Singleflight"
    assert len(results) == 4
    assert all(bundle is results[0] for bundle in results), "gemischte Zustände"


def test_fehler_wird_nicht_gespeichert(settings, live, clock, monkeypatch):
    """Ein Fehlschlag darf die Revision nicht dauerhaft blockieren."""
    counter: dict[str, int] = {}
    original = feedback_module.compute_advice_stats
    calls = {"fail": True}

    def flaky(*args, **kwargs):
        if calls["fail"]:
            calls["fail"] = False
            raise RuntimeError("kaputt")
        return original(*args, **kwargs)

    monkeypatch.setattr(feedback_module, "compute_advice_stats", flaky)
    _count_calls(monkeypatch, "compute_advice_stats", counter)

    with pytest.raises(RuntimeError):
        read_state.load_bundle(settings, clock())

    bundle = read_state.load_bundle(settings, clock())
    assert bundle.advice
    assert counter["compute_advice_stats"] == 2


def test_ablage_bleibt_begrenzt(settings, clock, monkeypatch):
    """Revisionen werden gezielt verdrängt, nie komplett geleert."""
    for minutes in range(0, 60, 6):
        read_state.load_bundle(settings, clock() + dt.timedelta(minutes=minutes))
    info = read_state.cache_info()
    assert info["entries"] <= read_state.MAX_ENTRIES
    assert info["entries"] > 0, "die Ablage wurde geleert statt verdrängt"
    assert read_state.clock_bucket(clock()) == read_state.clock_bucket(clock())


# ---------------------------------------------------------------------------
# Antwortvertrag: Revision und Teilfehler
# ---------------------------------------------------------------------------


def test_antwort_nennt_revision_und_teilfehler(settings, live, clock):
    """``error_code=null`` außen ist kein Vollständigkeitsnachweis (Audit §4.3).

    Ohne Influx-Konfiguration schlägt nur der Tagesblock fehl; die Antwort
    nennt den Teilfehler und bleibt sonst gültig.
    """
    (settings.influx_env).write_text("TANKAPP_INFLUX_URL=http://nas:8086\n")
    before = data_version(settings, clock)
    result = live.overview(PARAMS, live.overview_etag(PARAMS))

    assert result["error_code"] is None
    assert result["partial_errors"] == [
        {"component": "day", "error_code": "influx_read_failed"}
    ]
    # Die Revision ist die des **gelesenen** Stands (der Snapshot dieses
    # Requests schreibt den Store erst danach).
    assert result["data_version"] == before
    assert result["day"]["error_code"] == "influx_read_failed"
    # Der Vertrag bleibt JSON-serialisierbar (Serverpfad, GUI liest die Felder).
    assert json.loads(json.dumps(result))["partial_errors"] == result["partial_errors"]


def test_ohne_teilfehler_ist_die_liste_leer(settings, live, clock):
    """Vollständige Antwort: ``partial_errors`` ist explizit leer."""
    result = live.overview(PARAMS, live.overview_etag(PARAMS))
    assert result["partial_errors"] == []
    assert result["day"] is not None


def test_teilfehler_deckt_auch_fills_und_episoden_ab(settings, live, clock):
    """Jeder Teil mit Fehlercode erscheint in der Liste — nicht nur der Tag.

    ``fills`` und ``episodes`` tragen ebenfalls ``error_code`` (Store zu groß,
    Lesefehler); ohne sie bliebe genau der Audit-Fall verdeckt, dass außen
    ``null`` steht, während innen etwas fehlt.
    """
    live.fills = lambda: {
        "error_code": "fills_read_failed",
        "fills": [],
        "count": 0,
    }
    result = live.overview(PARAMS, live.overview_etag(PARAMS))
    assert result["error_code"] is None
    assert {"component": "fills", "error_code": "fills_read_failed"} in result[
        "partial_errors"
    ]


def test_snapshot_vorblick_liest_den_store_nicht_erneut(
    settings, live, clock, monkeypatch
):
    """Der Snapshot-Log hängt nicht mehr am zweiten Store-Parse (B2.2)."""
    live.decide(dict(PARAMS))  # erster Snapshot: Schreibpfad

    store = feedback_module.load_store(settings)
    episode = feedback_module._open_episode(store)
    assert episode and episode.get("last_snapshot")
    probe = dict(episode["last_snapshot"])

    counter: dict[str, int] = {}
    _count_calls(monkeypatch, "load_store", counter)
    confirmed_store, confirmed_episode = feedback_module.record_snapshot(
        settings, probe, clock=clock, store=store
    )

    assert counter.get("load_store", 0) == 0, (
        "der Vorblick liest den Store erneut, obwohl der Lesezustand ihn hat"
    )
    assert confirmed_episode is episode
    assert confirmed_store is store


def test_gleiche_revision_wie_direkter_aufruf(settings, clock):
    """Der Lesezustand rechnet auf demselben Ledger wie ``load_ledger``."""
    bundle = read_state.load_bundle(settings, clock())
    assert bundle.ledger == feedback_module.load_ledger(settings)
    assert bundle.data_version == data_version(settings, clock)
    assert read_state.revision_key(settings, clock()).startswith(bundle.data_version)


def test_decide_und_summary_ohne_serverpfad_teilen_sich_den_zustand(
    settings, live, clock
):
    """Auch außerhalb von ``/overview`` arbeiten beide auf einem Zustand."""
    bundle = read_state.load_bundle(settings, clock())
    decide = evaluate_decide(live, dict(PARAMS), read=bundle)
    summary = evaluate_stats_summary(
        live, {"fuel": "e10", "city": "Frankfurt"}, read=bundle
    )
    assert summary["live_advice"] is bundle.advice
    assert summary["wallet"] is bundle.wallet
    assert summary["thresholds"] is bundle.thresholds
    assert decide["personal_stats"]["advice"]["last_30d_total"] == bundle.advice["n"]
    # Dieselben Schwellen-Objekte, nicht nur gleiche Zahlen (B2.2).
    assert decide["thresholds"]["active"] is bundle.thresholds
