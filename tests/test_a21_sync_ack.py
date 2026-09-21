"""A21-B1.1/A21-B1.2 — lückenloser Upload-ACK und isolierte beschädigte Zeilen.

Gegenproben des A21-Audits 21.09.2026 (Issue #198/#199), dauerhaft als
Regressionstests:

- #198: ``read_unsynced`` sortierte nach Ereigniszeit, ``advance_ack``
  bestätigte den größten Dateioffset des Batches — ein Uhr-Rücksprung konnte
  noch ungeschriebene Zeilen überspringen. Invariante jetzt: nur
  zusammenhängend bestätigte Dateibereiche, in Datei-/Offsetordnung.
- #198: ``ring_prune`` löschte nach ``fetched_at_max``-Datum statt nach
  Dateibestätigung — Cursor 0 plus neuerer globaler Zeitstempel löschte eine
  zwei Tage alte, unbestätigte Datei.
- #199: ``raw.decode('utf-8')`` stand außerhalb der Fehlerbehandlung; eine
  einzige beschädigte Zeile brach den Uploaderlauf ab. Jetzt: isolieren
  (Quarantäne mit Datei/Offset), zählen, weiterarbeiten; ein teilweise
  geschriebener Dateischwanz bleibt unbestätigt.
"""

import datetime as dt
import importlib.util
import json
import sys
import urllib.error
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
UID = "00000000-0000-0000-0000-000000000001"


@pytest.fixture
def uploader():
    tools = str(ROOT / "data-tools")
    if tools not in sys.path:
        sys.path.insert(0, tools)
    path = ROOT / "data-tools/upload_influx.py"
    spec = importlib.util.spec_from_file_location("test_a21_uploader", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def collector():
    tools = str(ROOT / "data-tools")
    if tools not in sys.path:
        sys.path.insert(0, tools)
    path = ROOT / "data-tools/collect_prices.py"
    spec = importlib.util.spec_from_file_location("test_a21_collector", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _snap(stamp: dt.datetime) -> dict:
    return {
        "fetched_at": stamp.isoformat(),
        "city": "Frankfurt",
        "prices": {UID: {"status": "open", "e10": 1.7}},
    }


def _write_events(poll: Path, stamps: "list[dt.datetime]") -> None:
    for stamp in stamps:
        path = poll / f"{stamp.date().isoformat()}.jsonl"
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(_snap(stamp)) + "\n")


def _audit_stamps(n: int = 1001) -> "list[dt.datetime]":
    """1.001 Meldungen in fünf Tagesdateien, die letzten beiden vertauscht.

    Der Fünf-Minuten-Uhrrücksprung tauscht die Ereigniszeiten der letzten
    beiden physischen Zeilen — die Reihenfolge, die den alten ACK tödlich
    machte.
    """
    stamps: "list[dt.datetime]" = []
    offset = dt.timezone(dt.timedelta(hours=2))
    for day in range(5):
        start = dt.datetime(2026, 9, 15 + day, 6, tzinfo=offset)
        stamps.extend(start + dt.timedelta(minutes=5 * k) for k in range(216))
    stamps = stamps[:n]
    stamps[-2], stamps[-1] = stamps[-1], stamps[-2]
    return stamps


def _cfg(uploader, poll: Path, tmp_path: Path):
    return uploader.Cfg(
        "http://unused.invalid",
        "org",
        "bucket",
        "not-a-secret",
        poll,
        tmp_path / "missing-polling.json",
    )


# ---------------------------------------------------------------------------
# A21-B1.1: lückenlose ACKs
# ---------------------------------------------------------------------------


def test_clock_rollback_batch_failure_loses_nothing_and_retry_adds_no_points(
    uploader, tmp_path, monkeypatch
):
    """Audit-Gegenprobe #198: 1.001 Meldungen, Write-Fehler am zweiten Batch.

    Vor dem Fix: 1.000 übertragen, **0 ausstehend**, Retry meldet Erfolg —
    die ungeschriebene Meldung war still übersprungen. Danach: 1 ausstehend,
    alle 1.001 kommen an, der Retry ergänzt genau die fehlende.
    """
    poll = tmp_path / "poll"
    poll.mkdir()
    _write_events(poll, _audit_stamps())
    cfg = _cfg(uploader, poll, tmp_path)
    accepted: "list[str]" = []
    calls = [0]

    def writer(_cfg, lines):
        calls[0] += 1
        if calls[0] == 2:
            raise urllib.error.URLError("simulated batch failure")
        accepted.extend(lines)

    monkeypatch.setattr(uploader, "influx_write", writer)
    monkeypatch.setattr(uploader, "UPLOAD_BATCH_POINTS", 1000)
    assert uploader.run_upload(cfg, uploader.State()) == 1
    pending = uploader.read_unsynced(poll, uploader.read_ack(cfg.meta_dir))
    assert len(pending) == 1, "fehlgeschlagener Batch darf nichts überspringen"
    assert uploader.run_upload(cfg, uploader.State()) == 0
    assert uploader.read_unsynced(poll, uploader.read_ack(cfg.meta_dir)) == []
    assert len(accepted) == 1001, "alle fachlichen Meldungen, ohne Duplikate"


@pytest.mark.parametrize("fail_at", [0, 1, 2, 3, 4, 5])
def test_failure_at_every_batch_boundary_still_delivers_all_events(
    uploader, tmp_path, monkeypatch, fail_at
):
    """#198 Abnahme: Fehler vor/nach jedem Batch + Retry → alle 1.001 Meldungen."""
    poll = tmp_path / "poll"
    poll.mkdir()
    _write_events(poll, _audit_stamps())
    cfg = _cfg(uploader, poll, tmp_path)
    accepted: "list[str]" = []
    calls = [0]

    def writer(_cfg, lines):
        if calls[0] == fail_at:
            calls[0] += 1
            raise urllib.error.URLError("batch boundary failure")
        calls[0] += 1
        accepted.extend(lines)

    monkeypatch.setattr(uploader, "influx_write", writer)
    monkeypatch.setattr(uploader, "UPLOAD_BATCH_POINTS", 200)
    # Erster Versuch scheitert an der gewählten Grenze, alle Folgenden laufen.
    assert uploader.run_upload(cfg, uploader.State()) == 1
    assert uploader.run_upload(cfg, uploader.State()) == 0
    assert uploader.read_unsynced(poll, uploader.read_ack(cfg.meta_dir)) == []
    assert len(accepted) == 1001


def test_same_timestamps_and_late_append_and_restart(uploader, tmp_path, monkeypatch):
    """#198 Abnahme: gleiche Zeitstempel, nachgetragene Zeile, Neustart."""
    poll = tmp_path / "poll"
    poll.mkdir()
    offset = dt.timezone.utc
    base = dt.datetime(2026, 9, 20, 6, 0, tzinfo=offset)
    _write_events(poll, [base, base, base + dt.timedelta(minutes=5)])
    cfg = _cfg(uploader, poll, tmp_path)
    received: "list[str]" = []
    monkeypatch.setattr(
        uploader, "influx_write", lambda _c, lines: received.extend(lines)
    )
    assert uploader.run_upload(cfg, uploader.State()) == 0
    assert len(received) == 3
    # Nachgetragene ältere Zeile (Ereigniszeit vor dem ACK-Stand) ist erreichbar.
    _write_events(poll, [base - dt.timedelta(minutes=30)])
    received.clear()
    assert uploader.run_upload(cfg, uploader.State()) == 0
    assert len(received) == 1
    # Neustart: frische State-Instanz, dasselbe Ack — kein Rücklauf, kein Verlust.
    received.clear()
    assert uploader.run_upload(cfg, uploader.State()) == 0
    assert received == []


def test_truncation_resends_from_zero_instead_of_skipping(
    uploader, tmp_path, monkeypatch
):
    """Rotation/Truncation: Cursor hinter EOF → Neubeginn, erneutes Senden."""
    poll = tmp_path / "poll"
    poll.mkdir()
    day = poll / "2026-09-20.jsonl"
    day.write_text(
        json.dumps(_snap(dt.datetime(2026, 9, 20, 6, tzinfo=dt.timezone.utc))) + "\n"
    )
    cfg = _cfg(uploader, poll, tmp_path)
    received: "list[str]" = []
    monkeypatch.setattr(
        uploader, "influx_write", lambda _c, lines: received.extend(lines)
    )
    assert uploader.run_upload(cfg, uploader.State()) == 0
    assert len(received) == 1
    # Datei wird kleiner als der Cursor (Rotation) und wächst mit neuem Inhalt neu.
    day.write_text(
        json.dumps(_snap(dt.datetime(2026, 9, 20, 7, tzinfo=dt.timezone.utc))) + "\n"
    )
    received.clear()
    assert uploader.run_upload(cfg, uploader.State()) == 0
    assert len(received) == 1, (
        "Neubeginn nach Verkürzung sendet erneut statt zu überspringen"
    )


def test_advance_ack_refuses_gaps_in_the_chain(uploader):
    """Defensiver Kettencheck: Lücken im Batch werden nie übersprungen."""
    t = uploader.SyncTile
    stamp = dt.datetime(2026, 9, 20, 6, tzinfo=dt.timezone.utc)
    row1 = t("row", "f.jsonl", 0, 100, stamp, {}, b"{}", None)
    gap = t("row", "f.jsonl", 200, 300, stamp, {}, b"{}", None)
    ack = uploader.advance_ack(uploader.empty_ack(), [row1, gap])
    assert ack["cursors"]["f.jsonl"] == 100, (
        "Lücke (100–200) darf nicht bestätigt werden"
    )
    # Erneutes Senden des Rests beginnt bei 100, nicht bei 300.
    again = t("row", "f.jsonl", 100, 200, stamp, {}, b"{}", None)
    tail = t("row", "f.jsonl", 200, 300, stamp, {}, b"{}", None)
    ack = uploader.advance_ack(ack, [again, tail])
    assert ack["cursors"]["f.jsonl"] == 300


def test_collector_prune_never_deletes_unconfirmed_despite_newer_timestamp(
    collector, tmp_path
):
    """Audit-Gegenprobe #198: v2-ACK, Cursor 0, neuerer ``fetched_at_max``.

    Vor dem Fix löschte ``ring_prune`` die zwei Tage alte Datei innerhalb der
    Sieben-Tage-Retention. Danach bleibt sie liegen.
    """
    out = tmp_path / "poll"
    (out / "meta").mkdir(parents=True)
    old = dt.date.today() - dt.timedelta(days=2)
    day = out / f"{old.isoformat()}.jsonl"
    day.write_text('{"unacknowledged": true}\n')
    (out / "meta" / "synced_until").write_text(
        json.dumps(
            {
                "v": 2,
                "fetched_at_max": dt.datetime.now(dt.timezone.utc).isoformat(),
                "cursors": {day.name: 0},
            }
        )
    )
    result = collector.ring_prune(out)
    assert day.exists(), "unbestätigte Datei innerhalb der Retention bleibt liegen"
    assert day.name not in result["removed_synced"]
    assert day.name not in result["removed_fifo"]


def test_collector_prune_deletes_only_fully_confirmed_files_early(collector, tmp_path):
    out = tmp_path / "poll"
    (out / "meta").mkdir(parents=True)
    old = dt.date.today() - dt.timedelta(days=2)
    full = out / f"{old.isoformat()}.jsonl"
    full.write_text('{"acked": true}\n')
    partial = out / f"{(old - dt.timedelta(days=1)).isoformat()}.jsonl"
    partial.write_text('{"partial": true}\n')
    (out / "meta" / "synced_until").write_text(
        json.dumps(
            {
                "v": 2,
                "fetched_at_max": dt.datetime.now(dt.timezone.utc).isoformat(),
                "cursors": {
                    full.name: full.stat().st_size,
                    partial.name: max(0, partial.stat().st_size - 2),
                },
            }
        )
    )
    result = collector.ring_prune(out)
    assert full.name in result["removed_synced"]
    assert not full.exists()
    assert partial.exists(), "Teilcursor ist keine Dateibestätigung"
    # Späterer Append schützt eine bestätigte Datei wieder (Cursor < Größe).
    regrown = out / f"{(old - dt.timedelta(days=2)).isoformat()}.jsonl"
    regrown.write_text('{"first": true}\n')
    (out / "meta" / "synced_until").write_text(
        json.dumps(
            {
                "v": 2,
                "fetched_at_max": None,
                "cursors": {regrown.name: regrown.stat().st_size},
            }
        )
    )
    with regrown.open("a", encoding="utf-8") as handle:
        handle.write('{"late": true}\n')
    collector.ring_prune(out)
    assert regrown.exists(), "nachgetragene Zeilen heben die Bestätigung auf"


def test_v1_ack_is_no_file_confirmation(collector, tmp_path):
    """Alte ACK-Version: kein Cursor-Nachweis → kein vorzeitiges Löschen."""
    out = tmp_path / "poll"
    (out / "meta").mkdir(parents=True)
    old = dt.date.today() - dt.timedelta(days=2)
    day = out / f"{old.isoformat()}.jsonl"
    day.write_text('{"v1": true}\n')
    (out / "meta" / "synced_until").write_text("2026-09-20T00:00:00+00:00\n")
    result = collector.ring_prune(out)
    assert day.exists()
    assert day.name not in result["removed_synced"] + result["removed_fifo"]


def test_fifo_loss_is_counted_and_logged_separately(collector, tmp_path):
    """Bewusster FIFO-Verlust nach Retention: getrennt gezählt und protokolliert."""
    out = tmp_path / "poll"
    (out / "meta").mkdir(parents=True)
    ancient = dt.date.today() - dt.timedelta(days=10)
    day = out / f"{ancient.isoformat()}.jsonl"
    day.write_text('{"lost": 1}\n{"lost": 2}\n')
    result = collector.ring_prune(out)
    assert result["removed_fifo"] == [day.name]
    assert result["fifo_unacked"] == [day.name]
    assert result["removed_synced"] == []
    totals = collector.fifo_loss_totals(out / "meta")
    assert totals == {"files": 1, "lines": 2}
    summary = collector.unacked_summary(out)
    assert summary["fifo_dropped_files"] == 1
    assert summary["fifo_dropped_lines"] == 2
    assert summary["unacked_files"] == 0


# ---------------------------------------------------------------------------
# A21-B1.2: beschädigte Zeilen isolieren statt blockieren
# ---------------------------------------------------------------------------


GOOD = (
    json.dumps(
        {
            "fetched_at": "2026-09-21T06:00:00+00:00",
            "city": "Frankfurt",
            "prices": {UID: {"status": "open", "e10": 1.7}},
        }
    ).encode()
    + b"\n"
)
GOOD_LATER = GOOD.replace(b"06:00:00", b"06:05:00")


def test_invalid_utf8_never_aborts_and_is_quarantined(uploader, tmp_path, monkeypatch):
    """Minimalrepro #199: ``b'\\xff\\n'`` brach den ganzen Uploaderlauf.

    Gültig – ungültiges UTF-8 – gültig: kein Abbruch, die beschädigte Zeile
    wird mit Datei/Offset isoliert, die zweite gültige Meldung ist erreichbar.
    """
    poll = tmp_path / "poll"
    poll.mkdir()
    day = poll / "2026-09-21.jsonl"
    day.write_bytes(GOOD + b"\xff\n" + GOOD_LATER)
    cfg = _cfg(uploader, poll, tmp_path)
    scan = uploader.scan_unsynced(poll, uploader.empty_ack())
    assert len(scan.rows) == 2
    assert [t.reason for t in scan.damaged] == ["utf8"]
    damaged = scan.damaged[0]
    assert damaged.start_offset < damaged.end_offset
    received: "list[str]" = []
    monkeypatch.setattr(
        uploader, "influx_write", lambda _c, lines: received.extend(lines)
    )
    assert uploader.run_upload(cfg, uploader.State()) == 0
    assert len(received) == 2
    quarantined = sorted((poll / "meta" / "quarantine").glob("*.json"))
    assert len(quarantined) == 1
    record = json.loads(quarantined[0].read_text(encoding="utf-8"))
    assert record["file"] == day.name
    assert record["start_offset"] == damaged.start_offset
    assert record["end_offset"] == damaged.end_offset
    assert record["reason"] == "utf8"
    assert record["raw_base64"] and record["sha256"]
    # Dateiname trägt Datei/Offset — Diagnose ohne Rohinhalte.
    assert (
        f"{day.name}.{damaged.start_offset}-{damaged.end_offset}" in quarantined[0].name
    )


def test_broken_json_and_wrong_schema_are_isolated_not_dropped_silently(
    uploader, tmp_path
):
    poll = tmp_path / "poll"
    poll.mkdir()
    day = poll / "2026-09-21.jsonl"
    day.write_bytes(
        GOOD + b"{not json}\n" + b'{"fetched_at": 42}\n' + b"[]\n" + GOOD_LATER
    )
    scan = uploader.scan_unsynced(poll, uploader.empty_ack())
    assert len(scan.rows) == 2
    assert [t.reason for t in scan.damaged] == ["json", "schema", "schema"]


def test_partial_tail_is_not_confirmed_and_not_damaged(uploader, tmp_path, monkeypatch):
    """#199: laufender Append vs. endgültig beschädigte Zeile.

    Ein Dateischwanz ohne Zeilenumbruch wird weder bestätigt noch als
    beschädigt isoliert; nach Abschluss erscheint er als gültige Zeile. Ein
    vorheriger Teilwrite plus defekte Zeile überspringt dabei keinen
    ungeschriebenen gültigen Datensatz über den ACK.
    """
    poll = tmp_path / "poll"
    poll.mkdir()
    day = poll / "2026-09-21.jsonl"
    day.write_bytes(GOOD + b"\xff\n" + GOOD_LATER[:20])  # Teilwrite am Ende
    cfg = _cfg(uploader, poll, tmp_path)
    received: "list[str]" = []
    monkeypatch.setattr(
        uploader, "influx_write", lambda _c, lines: received.extend(lines)
    )
    assert uploader.run_upload(cfg, uploader.State()) == 0
    assert len(received) == 1, "nur die vollständige Zeile ist bestätigt"
    scan = uploader.scan_unsynced(poll, uploader.read_ack(cfg.meta_dir))
    assert scan.rows == [] and scan.damaged == []
    assert scan.tail_files == [day.name], "Schwanz bleibt unbestätigt liegen"
    # Der Append schließt die Zeile ab — jetzt ist sie eine gültige Meldung.
    with day.open("ab") as handle:
        handle.write(GOOD_LATER[20:])
    received.clear()
    assert uploader.run_upload(cfg, uploader.State()) == 0
    assert len(received) == 1, "kein Verlust über den ACK: die Zeile kommt an"
    ack = uploader.read_ack(cfg.meta_dir)
    assert ack["cursors"][day.name] == day.stat().st_size


def test_quarantine_is_idempotent_and_diagnosis_has_no_payload_or_secrets(
    uploader, tmp_path, monkeypatch, capsys
):
    """Retry ist stabil; Diagnose nennt Datei/Offset/Zähler, nie Zugangsdaten."""
    poll = tmp_path / "poll"
    poll.mkdir()
    day = poll / "2026-09-21.jsonl"
    day.write_bytes(b"\xff\n" + GOOD)
    cfg = _cfg(uploader, poll, tmp_path)
    cfg.token = "super-secret-influx-token"

    def fail_write(_c, lines):
        raise urllib.error.URLError("offline")

    monkeypatch.setattr(uploader, "influx_write", fail_write)
    assert uploader.run_upload(cfg, uploader.State()) == 1
    quarantined = sorted((poll / "meta" / "quarantine").glob("*.json"))
    assert len(quarantined) == 1
    received: "list[str]" = []
    monkeypatch.setattr(
        uploader, "influx_write", lambda _c, lines: received.extend(lines)
    )
    assert uploader.run_upload(cfg, uploader.State()) == 0
    assert len(received) == 1
    # Keine zweite Quarantäne-Datei, kein Doppelpunkt im Zähler.
    assert sorted((poll / "meta" / "quarantine").glob("*.json")) == quarantined
    out = capsys.readouterr().out
    assert "super-secret-influx-token" not in out
    assert "beschädigte Zeile(n) isoliert" in out
    assert str(quarantined[0]).split("quarantine/")[-1][: len(day.name)] == day.name


def test_run_summary_never_reports_damaged_as_plain_success(uploader, tmp_path, capsys):
    """Keine stillen Auslassungen als erfolgreicher Sync."""
    poll = tmp_path / "poll"
    poll.mkdir()
    (poll / "2026-09-21.jsonl").write_bytes(GOOD + b"\xff\n")
    cfg = _cfg(uploader, poll, tmp_path)
    received: "list[str]" = []
    import unittest.mock as mock

    with mock.patch.object(
        uploader, "influx_write", lambda _c, lines: received.extend(lines)
    ):
        assert uploader.run_upload(cfg, uploader.State()) == 0
    out = capsys.readouterr().out
    assert "beschädigte" in out and "isoliert" in out
    assert "1 beschädigte" in out
