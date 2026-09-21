"""A21-B2.3 (#204) — Ablagen an der echten Datenabhängigkeit.

Der Audit (Issue #197, §3.5) maß zwei Fehlverhalten:

* Ein Literwechsel (55 → 41,25) löste eine neue Influx-Query und eine neue
  Statistikrechnung aus (3,76 s) — obwohl der Verlauf an Litern nicht hängt.
* Der Dateistempel ``int(mtime):Größe`` kollidierte, wenn sich zwei Stände in
  derselben Sekunde bei gleicher Größe änderten („Beleg storniert, gleich
  langer Ersatzbeleg“) → 304 auf einen veralteten Stand.

Dieser Test hält die Gegenprobe fest (deterministisch, ohne absolute
Laufzeitvergleiche):

* Liter-, Tank- und Zeitwertwechsel kosten keine neue History-Query und keine
  neue Statistikrechnung;
* neue Preise, neue Uhrfenster und Profiländerungen invalidieren die
  abhängigen Teile — ein Profilwechsel aber **nicht** die Preishistorie;
* zwei gleich große Änderungen in derselben Sekunde ergeben zwei Datenstände;
* parallele identische Misses erzeugen eine Query (Singleflight), Fehler
  verfallen nach kurzer Frist, die Ablagen bleiben begrenzt und verdrängen
  gezielt statt alles zu leeren;
* eine warme Ablage umgeht den Lese-Schutz (O39) nicht.

Geprüft werden Aufrufzahlen und Ergebnisidentität, keine Millisekunden.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import json
import os
import threading
import time
import urllib.error
import urllib.request

import pytest

import app.data as data_module
import app.read_state as read_state
from app.data import LiveData, data_version, prices_version
from app.server import make_server

import test_a21_b2_readstate as b2_case
from test_a21_b2_readstate import NOW, PARAMS, UID


# Dieselben Fixtures wie im B2.2-Test (synthetischer Bestand, feste Uhr),
# hier direkt aus dem Modul geholt: `pytest.fixture(name=...)` vermeidet die
# Namensdopplung, die Ruff sonst als F811 meldet.
@pytest.fixture(name="settings")
def _settings_fixture(tmp_path):
    """Synthetischer Bestand (Polling-Set, Influx-Env) wie im B2.2-Test."""
    return b2_case.settings.__wrapped__(tmp_path)


@pytest.fixture(name="clock")
def _clock_fixture():
    """Feste, verstellbare Uhr wie im B2.2-Test."""
    return b2_case.Clock()


# ---------------------------------------------------------------------------
# Helfer
# ---------------------------------------------------------------------------


class CountingQuery:
    """Influx-Ersatz: zählt Reads, kann scheitern oder langsam sein."""

    def __init__(self, delay_s: float = 0.0):
        self.calls = 0
        self.delay_s = delay_s
        self.fail = False

    def __call__(self, cfg, flux, *args, **kwargs):
        self.calls += 1
        if self.delay_s:
            time.sleep(self.delay_s)
        if self.fail:
            raise OSError("influx nicht erreichbar")
        return iter([])


def _count_read_state(monkeypatch, counter: dict[str, int]) -> None:
    """Zählt die eine schwere Rechnung des Lesezustands (B2.2)."""
    original = read_state._compute

    def wrapper(*args, **kwargs):
        counter["compute"] = counter.get("compute", 0) + 1
        return original(*args, **kwargs)

    monkeypatch.setattr(read_state, "_compute", wrapper)


def _warm(live_data: LiveData, params: dict) -> dict:
    """Ein Aufwärm-Aufruf: der erste Snapshot schreibt den Store (neue Revision)."""
    return live_data.overview(params, live_data.overview_etag(params))


# ---------------------------------------------------------------------------
# Ablage an der Datenabhängigkeit, nicht an den Parametern
# ---------------------------------------------------------------------------


def test_liter_tank_und_zeitwert_kosten_keine_historie(settings, clock, monkeypatch):
    """Nur irrelevanten Parameter geändert → keine Query, keine Rechnung."""
    query = CountingQuery()
    live_data = LiveData(settings, query=query, clock=clock)
    read_state.clear_cache()
    computed: dict[str, int] = {}
    _count_read_state(monkeypatch, computed)

    base = dict(PARAMS)
    _warm(live_data, base)
    first = live_data.overview(base, live_data.overview_etag(base))
    query.calls = 0
    computed.clear()

    changed = {
        **base,
        "liters": "41.25",
        "tank_percent": "60",
        "tank_capacity_l": "60",
        "value_of_time": "12",
    }
    second = live_data.overview(changed, live_data.overview_etag(changed))

    assert query.calls == 0, "Parameterwechsel hat eine neue History-Query ausgelöst"
    assert computed.get("compute", 0) == 0, "Parameterwechsel hat neu gerechnet"
    assert second["data_version"] == first["data_version"]
    assert second["day"] == first["day"]


def test_neuer_preisstand_invalidiert_den_verlauf(settings, clock):
    """Neuer Collector-Heartbeat = neue Preise → neue Query, neues Band."""
    query = CountingQuery()
    live_data = LiveData(settings, query=query, clock=clock)
    heartbeat = settings.runtime / "collector" / "heartbeat.json"
    heartbeat.parent.mkdir(parents=True, exist_ok=True)
    heartbeat.write_text(
        json.dumps({"timestamp": "2026-09-18T12:00:00+00:00"}), encoding="utf-8"
    )

    before = prices_version(settings, clock)
    live_data.series(UID, "Frankfurt", "e10", 168)
    assert query.calls == 1
    live_data.series(UID, "Frankfurt", "e10", 168)
    assert query.calls == 1, "derselbe Preisstand liest erneut"

    heartbeat.write_text(
        json.dumps({"timestamp": "2026-09-18T12:05:00+00:00"}), encoding="utf-8"
    )
    assert prices_version(settings, clock) != before
    live_data.series(UID, "Frankfurt", "e10", 168)
    assert query.calls == 2, "neuer Preisstand hat die Ablage nicht verworfen"


def test_neues_uhrfenster_invalidiert_den_verlauf(settings, clock):
    """Das Zeitfenster gehört zum Schlüssel: nach einer Minute neue Query."""
    query = CountingQuery()
    live_data = LiveData(settings, query=query, clock=clock)
    live_data.series(UID, "Frankfurt", "e10", 24)
    live_data.series(UID, "Frankfurt", "e10", 24)
    assert query.calls == 1

    clock.now = NOW + dt.timedelta(seconds=int(data_module.OVERVIEW_REVALIDATE_SECONDS))
    live_data.series(UID, "Frankfurt", "e10", 24)
    assert query.calls == 2


def test_profilaenderung_invalidiert_etag_aber_nicht_die_preishistorie(
    settings, clock, monkeypatch
):
    """Das Profil ist Datenstand für ETag/Lesezustand, nicht für Influx-Preise."""
    query = CountingQuery()
    live_data = LiveData(settings, query=query, clock=clock)
    profiles = settings.runtime / "profiles" / "profiles.json"
    profiles.parent.mkdir(parents=True, exist_ok=True)
    profiles.write_text(
        json.dumps({"schema_version": 1, "profiles": [], "active": None}),
        encoding="utf-8",
    )
    before_version = data_version(settings, clock)
    live_data.series(UID, "Frankfurt", "e10", 168)
    assert query.calls == 1

    profiles.write_text(
        json.dumps({"schema_version": 1, "profiles": [{"id": "p1"}], "active": "p1"}),
        encoding="utf-8",
    )

    assert data_version(settings, clock) != before_version, (
        "Profiländerung hat den Datenstand (ETag, Lesezustand) nicht geändert"
    )
    live_data.series(UID, "Frankfurt", "e10", 168)
    assert query.calls == 1, "Profiländerung hat die Preishistorie verworfen"


def test_policywechsel_ist_eine_neue_revision(settings, clock):
    """M7-Auto-Apply wirkt auf Schwellen/Freigaben → eigener Revisionsanteil."""
    before = read_state.revision_key(settings, clock())
    assert read_state.revision_key(settings, clock()) == before
    assert "|0" in before  # Schalter aus (Standardeinstellung)
    enabled = dataclasses.replace(settings, m7_auto_apply=True)
    after = read_state.revision_key(enabled, clock())
    assert after != before
    assert after.endswith("|1")


# ---------------------------------------------------------------------------
# Dateistempel: gleiche Sekunde, gleiche Größe
# ---------------------------------------------------------------------------


def test_gleiche_groesse_gleiche_sekunde_ergibt_neuen_datenstand(settings, clock):
    """Die Reproduktion aus dem Audit: ``int(mtime):Größe`` Kollision."""
    target = settings.runtime / "engine" / "current.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    first_text = json.dumps(
        {"published_at": "2026-09-18T12:00:00+00:00", "mark": "aaaa"}
    )
    second_text = json.dumps(
        {"published_at": "2026-09-18T12:00:00+00:00", "mark": "bbbb"}
    )
    assert len(first_text) == len(second_text)

    target.write_text(first_text, encoding="utf-8")
    stat = os.stat(target)
    before_stamp = data_module._file_stamp(target)
    before_version = data_version(settings, clock)

    # Zweiter Stand, gleiche Größe, **gleiche** mtime (Sekunde):
    # mit dem alten Stempel hätte das dieselbe data_version ergeben.
    target.write_text(second_text, encoding="utf-8")
    os.utime(target, ns=(stat.st_atime_ns, stat.st_mtime_ns))

    assert data_module._file_stamp(target) != before_stamp
    assert data_version(settings, clock) != before_version, (
        "gleich große Änderung in derselben Sekunde blieb unsichtbar"
    )


def test_atomarer_ersatz_aendert_den_stempel(settings, clock):
    """Alle App-Schreibpfade ersetzen atomar — der neue Inode zählt mit."""
    target = settings.runtime / "engine" / "current.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps({"published_at": "2026-09-18T12:00:00+00:00", "mark": "aaaa"})
    target.write_text(content, encoding="utf-8")
    stat = os.stat(target)
    before = data_module._file_stamp(target)

    # Gleicher Inhalt, gleiche Größe, gleiche (zurückgesetzte) Zeit — nur
    # der Inode ist neu (tempfile + os.replace wie ``write_json``).
    replacement = target.with_name("current.json.tmp")
    replacement.write_text(content, encoding="utf-8")
    os.utime(replacement, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    os.replace(replacement, target)

    assert data_module._file_stamp(target) != before


def test_grossdatei_grenze_ist_offengelegt(settings, clock):
    """Bound statt Schweigen: jenseits der Lesegrenze zählen Kopf und Ende.

    Der Stempel liest höchstens ``_STAMP_FULL_DIGEST_BYTES``; größere
    Bestände (Archiv) werden über Kopf/Ende plus Inode/mtime/Size
    erkannt. Die App ersetzt sie atomar (neuer Inode), der Fall „gleiche
    Größe, gleiche mtime, geänderte Mitte“ tritt dort nicht auf — dieser
    Test hält die Grenze fest, statt sie zu verschweigen.
    """
    target = settings.runtime / "feedback" / "archive.jsonl"
    target.parent.mkdir(parents=True, exist_ok=True)
    filler = "x" * (data_module._STAMP_FULL_DIGEST_BYTES + 1000)
    target.write_text("A" + filler + "Z", encoding="utf-8")
    stat = os.stat(target)
    before = data_module._file_stamp(target)

    with target.open("r+", encoding="utf-8") as handle:
        handle.seek(stat.st_size // 2)
        handle.write("Y")
    os.utime(target, ns=(stat.st_atime_ns, stat.st_mtime_ns))

    assert data_module._file_stamp(target) == before, (
        "die dokumentierte Grenze (Kopf/Ende) hat sich verschoben"
    )


# ---------------------------------------------------------------------------
# Singleflight, Fehler, begrenzte Ablage
# ---------------------------------------------------------------------------


def test_paralleler_identischer_miss_erzeugt_eine_query(settings, clock):
    """Zwei gleichzeitige Misses → eine Influx-Query, gleiches Ergebnis."""
    query = CountingQuery(delay_s=0.3)
    live_data = LiveData(settings, query=query, clock=clock)
    results: list[dict] = []
    errors: list[BaseException] = []

    def worker():
        try:
            results.append(live_data.series(UID, "Frankfurt", "e10", 168))
        except BaseException as exc:  # pragma: no cover - Diagnose im Fehlerfall
            errors.append(exc)

    owner = threading.Thread(target=worker)
    owner.start()
    # Warten, bis der Eigentümer in der Query hängt; erst dann startet der
    # Mitläufer, damit er den Singleflight wirklich findet.
    deadline = time.monotonic() + 5
    while query.calls != 1 and time.monotonic() < deadline:
        time.sleep(0.01)
    assert query.calls == 1, "Eigentümer hat die Query nicht erreicht"
    follower = threading.Thread(target=worker)
    follower.start()
    time.sleep(0.1)  # dem Mitläufer Zeit geben, selbst zu rechnen (falls kaputt)
    assert query.calls == 1, "Mitläufer hat parallel gerechnet"
    owner.join(timeout=10)
    follower.join(timeout=10)

    assert not errors
    assert query.calls == 1, "zweiter Miss hat eine zweite Query ausgelöst"
    assert len(results) == 2
    assert results[0] == results[1]


def test_fehler_verfaellt_statt_dauerhaft_gecacht(settings, clock, monkeypatch):
    """Ein kaputter Read ist kein Datenstand: nach kurzer Frist neuer Versuch."""
    query = CountingQuery()
    query.fail = True
    live_data = LiveData(settings, query=query, clock=clock)

    first = live_data.series(UID, "Frankfurt", "e10", 168)
    assert first["error_code"] == "influx_read_failed"
    second = live_data.series(UID, "Frankfurt", "e10", 168)
    assert second["error_code"] == "influx_read_failed"
    assert query.calls == 1, "Fehler wurde nicht (kurz) abgelegt"

    # Frist abgelaufen (Test setzt sie auf null) und der Read geht wieder:
    # der nächste Request muss es erneut versuchen.
    monkeypatch.setattr(LiveData, "SERIES_ERROR_TTL_S", 0.0)
    query.fail = False
    third = live_data.series(UID, "Frankfurt", "e10", 168)
    assert third["error_code"] is None
    assert query.calls == 2, "Fehler blieb dauerhaft gespeichert"


def test_ablagen_bleiben_begrenzt_und_verdraengen_gezielt(settings, clock, monkeypatch):
    """LRU statt clear(): die Obergrenze wirft nur den ältesten Stand weg."""
    query = CountingQuery()
    live_data = LiveData(settings, query=query, clock=clock)
    revision = live_data._series_revision()

    for hours in range(1, live_data.SERIES_MAX_ENTRIES + 4):
        live_data.series(UID, "Frankfurt", "e10", hours)
    assert len(live_data.series_cache) == live_data.SERIES_MAX_ENTRIES
    newest = (UID, "Frankfurt", "e10", live_data.SERIES_MAX_ENTRIES + 3, revision)
    oldest = (UID, "Frankfurt", "e10", 1, revision)
    assert newest in live_data.series_cache, "neuester Stand wurde verdrängt"
    assert oldest not in live_data.series_cache, "ältester Stand blieb liegen"

    # Antwort-Ablage: verkleinerte Grenze, vier verschiedene Parameter.
    monkeypatch.setattr(LiveData, "OVERVIEW_MAX_ENTRIES", 2)
    read_state.clear_cache()
    etags = []
    for index in range(4):
        params = {**PARAMS, "liters": str(40 + index)}
        etag = live_data.overview_etag(params)
        etags.append(etag)
        live_data.overview(params, etag)
    assert len(live_data.overview_cache) == 2, "Ablage wuchs über die Grenze"
    assert etags[-1] in live_data.overview_cache
    assert etags[-2] in live_data.overview_cache, (
        "jüngerer Eintrag fehlt — die Ablage wurde geleert statt verdrängt"
    )
    assert etags[0] not in live_data.overview_cache


# ---------------------------------------------------------------------------
# Warme Ablage und Lese-Schutz (O39)
# ---------------------------------------------------------------------------


def test_warmer_overview_cache_umgeht_den_leseschutz_nicht(settings, clock):
    """Persönliche Daten bleiben hinter dem Token — auch als Cache-Treffer."""
    guarded = dataclasses.replace(settings, read_token="geheim")
    live_data = LiveData(guarded, query=CountingQuery(), clock=clock)
    server = make_server(guarded, "127.0.0.1", 0, live_data)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    path = "/api/v1/overview?fuel=e10&city=Frankfurt&station_id=" + UID
    try:
        authorized = urllib.request.Request(
            base + path, headers={"Authorization": "Bearer geheim"}
        )
        with urllib.request.urlopen(authorized, timeout=10) as response:
            assert response.status == 200
            etag = response.headers.get("ETag")
        assert etag, "ETag fehlt — ohne ihn prüft der Test nicht die Ablage"

        for headers in ({"If-None-Match": etag}, {}):
            request = urllib.request.Request(base + path, headers=headers)
            with pytest.raises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request, timeout=10)
            assert error.value.code == 401, (
                "eine warme Ablage hat den Lese-Schutz umgangen"
            )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
