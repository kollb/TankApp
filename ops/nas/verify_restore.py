#!/usr/bin/env python3
"""Fachliche Verifikation eines wiederhergestellten Laufzeitstands (A21-B3.2).

Restore-Nachweis: Ein Tar, das gzip-mäßig in Ordnung ist, ist noch keine
wiederherstellbare Tank-Bilanz. Dieses Werkzeug lädt den wiederhergestellten
Bestand mit denselben strengen Lesern wie die App (``app/feedback.py``:
``load_store`` + ``load_archive_records`` fail-closed) und prüft die Größen,
die der Audit (#197 §1.5) genannt hat:

- **Belegzahlen**: Episoden, Füllungen, Settlements — heiß und archiviert,
- **Geldsummen**: Liter und Euro der nicht stornierten Belege,
- **Stornos**: voided-Belege bleiben Belege (Retention ist keine Löschung),
- **Archiv**: parsebar, Zeilenzahl, höchster Schema-Stempel,
- **Revisionen**: Store-Schema ≤ Code-Version, Identitäten eindeutig.

Mit ``--compare <Quell-runtime>`` werden die Größen zusätzlich gegen den
Quellbestand verglichen — gleiche Belegzahlen, Summen, Stornos und derselbe
kanonische Fingerabdruck. Ohne Quelle prüft das Werkzeug nur die
Selbstkonsistenz (die Gegenprobe läuft in tests/test_a21_b3_backup.py).

Aufruf (Repository-Root, App-Abhängigkeiten installiert — z. B. im
App-Container oder in der Entwicklungsumgebung):

    python3 ops/nas/verify_restore.py --runtime <wiederhergestelltes runtime/> \
        [--compare <Quell-runtime/>] [--json]

Exit-Code: 0 = verifiziert, 1 = Fehler (mit benannter Ursache).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
for entry in (str(ROOT), str(ROOT / "data-tools")):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from app.feedback import (  # noqa: E402
    FEEDBACK_SCHEMA_VERSION,
    load_archive_records,
    load_store,
)


def _safe_float(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None  # NaN bleibt None


def fingerprint(runtime_dir: Path) -> dict:
    """Fachlicher Fingerabdruck eines Laufzeitstands — oder benannter Fehler.

    Die Größen rechnen über den **gemergten** Ledger (heiß + archiviert,
    heiß gewinnt) — genau das, was Decide/Summary sehen. Die Verteilung auf
    Store und Archiv ist zusätzliche Information: Ein Beleg darf in beiden
    liegen (Überlappung am Handover ist erlaubt und geht in der Merge-Sicht
    nicht doppelt ein), nie aber doppelt in der Merge-Sicht selbst.
    """
    from app.feedback import ledger_from_store

    settings = SimpleNamespace(runtime=runtime_dir)
    store = load_store(settings)
    archived = load_archive_records(settings)
    ledger = ledger_from_store(store, settings)

    fills = [item for item in ledger.get("fills") or [] if isinstance(item, dict)]
    episodes = [item for item in ledger.get("episodes") or [] if isinstance(item, dict)]
    settlements = [
        item for item in ledger.get("settlements") or [] if isinstance(item, dict)
    ]

    active = [fill for fill in fills if not fill.get("voided")]
    liters = sum(
        value
        for fill in active
        if (value := _safe_float(fill.get("liters"))) is not None
    )
    euro = sum(
        liters_ * price
        for fill in active
        if (liters_ := _safe_float(fill.get("liters"))) is not None
        and (price := _safe_float(fill.get("price_paid"))) is not None
    )

    # Kanonischer Fingerabdruck über alle Beleg-Identitäten samt Storno-Status:
    # Zwei Stände mit denselben Belegen (egal wie verteilt Store/Archiv sie
    # liegen) liefern denselben Wert.
    def _ids(items: list[dict], key: str) -> list[str]:
        return sorted(str(item.get(key)) for item in items if item.get(key))

    canon = {
        "fills": sorted(
            [str(fill.get("id")), bool(fill.get("voided"))] for fill in fills
        ),
        "episodes": _ids(episodes, "id"),
        "settlements": _ids(settlements, "snapshot_id"),
    }
    digest = hashlib.sha256(
        json.dumps(canon, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()

    archive_path = runtime_dir / "feedback" / "archive.jsonl"
    archive_lines = 0
    archive_schema_max = 0
    if archive_path.is_file():
        for line in archive_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            archive_lines += 1
            try:
                stamp = json.loads(line).get("schema_version")
                archive_schema_max = max(archive_schema_max, int(stamp or 0))
            except (ValueError, TypeError, AttributeError):
                pass  # der strenge Leser hätte den Defekt schon benannt

    return {
        "schema_version": store.get("schema_version"),
        "ledger": {
            "episodes": len(episodes),
            "fills": len(fills),
            "settlements": len(settlements),
        },
        "hot": {
            "episodes": len(store.get("episodes") or []),
            "fills": len(store.get("fills") or []),
            "settlements": len(store.get("settlements") or []),
        },
        "archived": {
            "episodes": len(archived.get("episodes") or []),
            "fills": len(archived.get("fills") or []),
            "settlements": len(archived.get("settlements") or []),
        },
        "voided_fills": sum(1 for fill in fills if fill.get("voided")),
        "liters_total": round(liters, 2),
        "eur_total": round(euro, 2),
        "archive_lines": archive_lines,
        "archive_schema_max": archive_schema_max,
        "ledger_sha256": digest,
    }


def _check(metrics: dict) -> list[str]:
    """Selbstkonsistenz des wiederhergestellten Stands."""
    problems: list[str] = []
    version = metrics.get("schema_version")
    if not isinstance(version, int) or version < 1:
        problems.append(f"Store ohne gültige schema_version: {version!r}")
    elif version > FEEDBACK_SCHEMA_VERSION:
        problems.append(
            f"Store-Schema {version} ist neuer als der Code "
            f"({FEEDBACK_SCHEMA_VERSION}) — erst die App aktualisieren."
        )
    if metrics.get("archive_schema_max", 0) > FEEDBACK_SCHEMA_VERSION:
        problems.append(
            f"Archiv-Stempel {metrics['archive_schema_max']} ist neuer als der "
            f"Code ({FEEDBACK_SCHEMA_VERSION})."
        )
    return problems


def _dupes(runtime_dir: Path) -> list[str]:
    """Gegenprobe des Merge-Vertrags: keine Identität doppelt in der Merge-Sicht.

    Ein Beleg darf im heißen Store UND im Archiv liegen (Überlappung am
    Handover, heiß gewinnt) — aber die gemergte Sicht darf jede Identität
    nur einmal enthalten, sonst zählte die Bilanz doppelt.
    """
    from app.feedback import ledger_from_store

    settings = SimpleNamespace(runtime=runtime_dir)
    ledger = ledger_from_store(load_store(settings), settings)
    problems: list[str] = []
    for key, id_key in (
        ("fills", "id"),
        ("episodes", "id"),
        ("settlements", "snapshot_id"),
    ):
        idents = [
            str(item.get(id_key))
            for item in ledger.get(key) or []
            if isinstance(item, dict) and item.get(id_key)
        ]
        twice = sorted({name for name in idents if idents.count(name) > 1})
        if twice:
            problems.append(f"{key}: Identität in der Merge-Sicht doppelt: {twice[:5]}")
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", required=True, type=Path)
    parser.add_argument("--compare", type=Path, default=None)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    runtime = args.runtime
    if not runtime.is_dir():
        print(f"verify_restore: {runtime} ist kein Verzeichnis.", file=sys.stderr)
        return 1

    try:
        metrics = fingerprint(runtime)
    except Exception as exc:  # noqa: BLE001 — benannter Bericht statt Stacktrace
        print(
            f"verify_restore: Bestand nicht lesbar — {type(exc).__name__}: {exc}",
            file=sys.stderr,
        )
        return 1

    problems = _check(metrics) + _dupes(runtime)
    report: dict = {"runtime": str(runtime), "ok": not problems, **metrics}
    compared: dict | None = None
    if args.compare is not None:
        if not args.compare.is_dir():
            print(
                f"verify_restore: Quelle {args.compare} ist kein Verzeichnis.",
                file=sys.stderr,
            )
            return 1
        try:
            source = fingerprint(args.compare)
        except Exception as exc:  # noqa: BLE001
            print(
                f"verify_restore: Quelle nicht lesbar — {type(exc).__name__}: {exc}",
                file=sys.stderr,
            )
            return 1
        for key in (
            "schema_version",
            "voided_fills",
            "liters_total",
            "eur_total",
            "ledger_sha256",
        ):
            if metrics.get(key) != source.get(key):
                problems.append(
                    f"{key}: wiederhergestellt {metrics.get(key)!r} ≠ Quelle {source.get(key)!r}"
                )
        report["source_ok"] = not [p for p in problems if "≠" in p]
        compared = source

    report["problems"] = problems
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        merged = metrics["ledger"]
        hot = metrics["hot"]
        archived = metrics["archived"]
        print(
            f"Bestand (gemergt): {merged['fills']} Belege "
            f"({metrics['voided_fills']} storniert), {merged['episodes']} "
            f"Episoden, {merged['settlements']} Settlements — davon heiß "
            f"{hot['fills']}/{hot['episodes']}/{hot['settlements']}, archiviert "
            f"{archived['fills']}/{archived['episodes']}/{archived['settlements']}; "
            f"{metrics['liters_total']:.1f} L / {metrics['eur_total']:.2f} € "
            f"(nicht storniert); Archiv {metrics['archive_lines']} Zeilen "
            f"(Stempel ≤ {metrics['archive_schema_max']}); "
            f"Store-Schema {metrics['schema_version']}."
        )
        if compared is not None:
            print(
                "Vergleich mit Quelle: "
                + (
                    "identisch (Belege, Summen, Stornos, Fingerabdruck)."
                    if report.get("source_ok")
                    else "Abweichungen siehe problems."
                )
            )
        for problem in problems:
            print(f"  Problem: {problem}", file=sys.stderr)
        print("Verifikation: " + ("OK" if not problems else "FEHLGESCHLAGEN"))
    return 0 if not problems else 1


if __name__ == "__main__":
    raise SystemExit(main())
