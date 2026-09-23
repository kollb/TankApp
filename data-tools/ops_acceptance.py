#!/usr/bin/env python3
"""
TankApp – A21-B5.4 (#214): NAS/Pi-Betriebsabnahme — Messrezept und Tooling.

Misst, was sich ohne Handgriff am Gerät ehrlich messen lässt, und schreibt
ein maschinenlesbares Abnahmeprotokoll (JSON + Markdown):

* **Latenz** je Kern-Endpunkt (p50/p95/p99) gegen die LAN-Messlatte
  ``p95 ≤ 300 ms`` (`ACCEPTANCE_TARGETS`).
* **Pollkadenz** des Sammlers aus Zeitstempel-Exporten (Soll-Abstand je
  Stadtset, Fenster 06:00–24:00, Toleranz).
* **Recovery/Restore (RPO/RTO)**: Das Werkzeug wertet **manuell gestoppte**
  Zeiten aus (``--rpo-minutes``/``--rto-minutes``) und prüft sie gegen die
  Ziele — die Stopuhr am Gerät bleibt Handarbeit (docs/betrieb/BETRIEBSABNAHME.md).

**Blocker-Regel:** Eine fehlende Messung (kein NAS/Pi-Zugang, kein
Restore-Versuch) ist ein **Blocker, kein erfolgreicher Test**. Der
Gesamturteil des Protokolls ist deshalb so lange ``"offen"``, bis alle
Pflichtstrecken gemessen sind — nie still „bestanden“.

Aufruf (LAN, z. B. vom Arbeitsrechner oder NAS-Host):

    .venv/bin/python data-tools/ops_acceptance.py \\
        --base-url http://tankapp.nas:8080 --samples 30 \\
        --poll-log data/poll-log.csv --out results/ops-acceptance

    # Restore-Zeiten nach Handstopuhr nachtragen (Blocker sonst offen):
    .venv/bin/python data-tools/ops_acceptance.py ... \\
        --rpo-minutes 12 --rto-minutes 35 --restore-verified

Nur Standardbibliothek — läuft mit dem python3 des NAS-Hosts.
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

# A21-B5.4: Messlatte — vor dem Lauf festgelegt (Issue 214 / Audit M3.8).
ACCEPTANCE_TARGETS = {
    "latency_p95_ms": 300.0,
    "latency_endpoints": (
        "/api/v1/health",
        "/api/v1/overview",
        "/api/v1/decide",
    ),
    "poll_target_seconds": 300.0,
    "poll_tolerance": 0.2,
    "poll_window": ("06:00", "24:00"),
    "rpo_minutes_max": 30.0,
    "rto_minutes_max": 240.0,
}
BLOCKER_NOTE = (
    "Fehlender Zugang ist ein Blocker, kein erfolgreicher Test — "
    "diese Strecke ist nicht abgenommen."
)


def _percentile(sorted_values: list[float], q: float) -> float:
    if not sorted_values:
        raise ValueError("Keine Werte für das Perzentil.")
    index = min(
        len(sorted_values) - 1, max(0, int(round(q * (len(sorted_values) - 1))))
    )
    return float(sorted_values[index])


def measure_latency(
    base_url: str,
    endpoints: tuple[str, ...] = ACCEPTANCE_TARGETS["latency_endpoints"],
    *,
    samples: int = 30,
    warmup: int = 3,
    timeout: float = 10.0,
    method: str = "GET",
) -> dict:
    """Antwortzeiten je Endpunkt (ms) — p50/p95/p99, Fehler zählen ehrlich."""
    results: dict[str, dict] = {}
    for endpoint in endpoints:
        url = base_url.rstrip("/") + endpoint
        timings: list[float] = []
        errors = 0
        for i in range(samples + warmup):
            request = urllib.request.Request(url, method=method)
            started = time.perf_counter()
            try:
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    response.read()
                    if response.status >= 400:
                        errors += 1
                        continue
            except (urllib.error.URLError, OSError, TimeoutError):
                errors += 1
                continue
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            if i >= warmup:
                timings.append(elapsed_ms)
        if timings:
            ordered = sorted(timings)
            entry = {
                "n": len(timings),
                "errors": errors,
                "p50_ms": round(_percentile(ordered, 0.50), 2),
                "p95_ms": round(_percentile(ordered, 0.95), 2),
                "p99_ms": round(_percentile(ordered, 0.99), 2),
                "max_ms": round(ordered[-1], 2),
            }
            entry["ok"] = entry["p95_ms"] <= ACCEPTANCE_TARGETS["latency_p95_ms"]
        else:
            entry = {"n": 0, "errors": errors, "ok": False, "note": BLOCKER_NOTE}
        results[endpoint] = entry
    return results


def parse_poll_stamps(path: Path) -> list[datetime]:
    """Zeitstempel aus CSV (``timestamp``/``fetched_at``) oder JSONL lesen."""
    stamps: list[datetime] = []
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".jsonl":
        for line in text.splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            raw = row.get("fetched_at") or row.get("timestamp")
            if raw:
                stamps.append(datetime.fromisoformat(str(raw)))
        return stamps
    reader = csv.DictReader(text.splitlines())
    for row in reader:
        raw = row.get("timestamp") or row.get("fetched_at")
        if raw:
            stamps.append(datetime.fromisoformat(str(raw)))
    return sorted(stamps)


def check_poll_cadence(
    stamps: list[datetime],
    *,
    target_seconds: float = ACCEPTANCE_TARGETS["poll_target_seconds"],
    tolerance: float = ACCEPTANCE_TARGETS["poll_tolerance"],
    window: tuple[str, str] = ACCEPTANCE_TARGETS["poll_window"],
) -> dict:
    """Pollkadenz prüfen: Lücken im Fenster gegen Soll-Abstand + Toleranz.

    Lücken über Nacht (Fenster ``06:00–24:00`` Ortszeit der Zeitstempel) sind
    Betriebskonzept, keine Verstöße — sie werden getrennt gezählt.
    """
    if len(stamps) < 2:
        return {
            "n_stamps": len(stamps),
            "ok": False,
            "note": BLOCKER_NOTE,
        }
    stamps = sorted(stamps)
    start_h, end_h = (int(part.split(":")[0]) for part in window)
    limit = target_seconds * (1.0 + tolerance)
    gaps, night_gaps = [], []
    for earlier, later in zip(stamps[:-1], stamps[1:]):
        gap = (later - earlier).total_seconds()
        hour = earlier.hour
        # Nachtlücke: Start außerhalb des Fensters ODER die Lücke kreuzt
        # Mitternacht (23:55 → 06:05 ist die planmäßige Nächtliche Schließung).
        if hour < start_h or hour >= end_h or later.date() > earlier.date():
            night_gaps.append(gap)
            continue
        gaps.append(gap)
    if not gaps:
        return {
            "n_stamps": len(stamps),
            "n_gaps": 0,
            "ok": False,
            "note": BLOCKER_NOTE,
        }
    gaps_sorted = sorted(gaps)
    violations = [gap for gap in gaps if gap > limit]
    return {
        "n_stamps": len(stamps),
        "n_gaps": len(gaps),
        "n_night_gaps": len(night_gaps),
        "median_s": round(statistics.median(gaps), 1),
        "p95_s": round(_percentile(gaps_sorted, 0.95), 1),
        "max_s": round(gaps_sorted[-1], 1),
        "target_s": target_seconds,
        "limit_s": round(limit, 1),
        "violations": len(violations),
        "worst_gap_s": round(max(violations), 1) if violations else None,
        "ok": not violations,
    }


def restore_measurement(
    *,
    rpo_minutes: float | None,
    rto_minutes: float | None,
    verified: bool,
) -> dict:
    """RPO/RTO gegen die Ziele werten — nicht gemessen = Blocker, nie bestanden."""
    targets = ACCEPTANCE_TARGETS
    if rpo_minutes is None or rto_minutes is None:
        return {
            "rpo_minutes": rpo_minutes,
            "rto_minutes": rto_minutes,
            "verified": verified,
            "ok": False,
            "note": (
                "Restore nicht gestoppt/verifiziert — "
                "manuelle Strecke (docs/betrieb/BETRIEBSABNAHME.md). " + BLOCKER_NOTE
            ),
        }
    return {
        "rpo_minutes": rpo_minutes,
        "rto_minutes": rto_minutes,
        "verified": verified,
        "rpo_ok": rpo_minutes <= targets["rpo_minutes_max"],
        "rto_ok": rto_minutes <= targets["rto_minutes_max"],
        "ok": bool(
            verified
            and rpo_minutes <= targets["rpo_minutes_max"]
            and rto_minutes <= targets["rto_minutes_max"]
        ),
    }


def build_report(
    *,
    latency: dict,
    cadence: dict | None,
    restore: dict,
    base_url: str,
) -> dict:
    """Protokoll zusammenstellen — Gesamturteil nur „bestanden“ wenn alles misst."""
    checks = {
        "latency": all(entry.get("ok") for entry in latency.values())
        if latency
        else False,
        "poll_cadence": bool(cadence and cadence.get("ok")),
        "restore": bool(restore.get("ok")),
    }
    complete = all(
        (
            latency and all(entry.get("n", 0) > 0 for entry in latency.values()),
            bool(cadence and cadence.get("n_gaps", 0) > 0),
            restore.get("rpo_minutes") is not None
            and restore.get("rto_minutes") is not None,
        )
    )
    if not complete:
        overall = "offen"
    else:
        overall = "bestanden" if all(checks.values()) else "nicht bestanden"
    return {
        "schema_version": 1,
        "measured_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "base_url": base_url,
        "targets": {
            key: value
            for key, value in ACCEPTANCE_TARGETS.items()
            if isinstance(value, (int, float, list, tuple))
        },
        "latency": latency,
        "poll_cadence": cadence,
        "restore": restore,
        "checks": checks,
        "complete": complete,
        "overall": overall,
        "blocker_note": BLOCKER_NOTE,
    }


def write_report(report: dict, out_dir: Path) -> tuple[Path, Path]:
    """``report.json`` + ``report.md`` schreiben (reproduzierbares Messartefakt)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "report.json"
    json_path.write_text(
        json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    def _fmt(value, digits=1) -> str:
        return "—" if value is None else f"{value:.{digits}f}".replace(".", ",")

    lines = [
        "# Betriebsabnahme NAS/Pi (A21-B5.4, #214)",
        "",
        f"- Stand: {report['measured_at']} · Ziel-Host {report['base_url']}",
        f"- Gesamturteil: **{report['overall']}**",
        f"- Regel: {report['blocker_note']}",
        "",
        "## Latenz (LAN, p95 ≤ 300 ms)",
        "",
        "| Endpunkt | n | p50 ms | p95 ms | p99 ms | max ms | Urteil |",
        "|---|---|---|---|---|---|---|",
    ]
    for endpoint, entry in report["latency"].items():
        lines.append(
            "| {ep} | {n} | {p50} | {p95} | {p99} | {mx} | {urteil} |".format(
                ep=endpoint,
                n=entry.get("n", 0),
                p50=_fmt(entry.get("p50_ms"), 2),
                p95=_fmt(entry.get("p95_ms"), 2),
                p99=_fmt(entry.get("p99_ms"), 2),
                mx=_fmt(entry.get("max_ms"), 2),
                urteil="erfüllt" if entry.get("ok") else "NICHT erfüllt",
            ),
        )
    cadence = report.get("poll_cadence") or {}
    lines += [
        "",
        "## Pollkadenz (Soll 300 s je Set, Fenster 06:00–24:00)",
        "",
        f"- Stempel {cadence.get('n_stamps', 0)} · Lücken {cadence.get('n_gaps', 0)}"
        f" · Nachtlücken {cadence.get('n_night_gaps', 0)}",
        f"- Median {_fmt(cadence.get('median_s'))} s · p95 {_fmt(cadence.get('p95_s'))} s"
        f" · max {_fmt(cadence.get('max_s'))} s · Grenze {_fmt(cadence.get('limit_s'))} s",
        f"- Verstöße {cadence.get('violations', '—')} · Urteil "
        f"**{'erfüllt' if cadence.get('ok') else 'NICHT erfüllt/offen'}**",
    ]
    restore = report.get("restore") or {}
    lines += [
        "",
        "## Recovery/Restore (RPO ≤ 30 min, RTO ≤ 240 min)",
        "",
        f"- RPO {_fmt(restore.get('rpo_minutes'))} min · RTO "
        f"{_fmt(restore.get('rto_minutes'))} min · fachlich verifiziert "
        f"(ops/nas/verify_restore.py): {restore.get('verified')}",
        f"- Urteil **{'erfüllt' if restore.get('ok') else 'NICHT erfüllt/offen'}**"
        + (f" — {restore.get('note')}" if restore.get("note") else ""),
        "",
    ]
    md_path = out_dir / "report.md"
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return json_path, md_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[2])
    parser.add_argument("--base-url", default="http://tankapp.nas:8080")
    parser.add_argument("--samples", type=int, default=30)
    parser.add_argument("--warmup", type=int, default=3)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument(
        "--endpoint",
        action="append",
        default=None,
        help="Kern-Endpunkt (mehrfach; Default siehe ACCEPTANCE_TARGETS)",
    )
    parser.add_argument(
        "--poll-log",
        type=Path,
        default=None,
        help="CSV/JSONL mit timestamp/fetched_at für die Pollkadenz",
    )
    parser.add_argument("--rpo-minutes", type=float, default=None)
    parser.add_argument("--rto-minutes", type=float, default=None)
    parser.add_argument("--restore-verified", action="store_true")
    parser.add_argument("--out", type=Path, default=Path("results/ops-acceptance"))
    args = parser.parse_args(argv)

    endpoints = (
        tuple(args.endpoint)
        if args.endpoint
        else ACCEPTANCE_TARGETS["latency_endpoints"]
    )
    latency = measure_latency(
        args.base_url,
        endpoints,
        samples=args.samples,
        warmup=args.warmup,
        timeout=args.timeout,
    )
    cadence = (
        check_poll_cadence(parse_poll_stamps(args.poll_log)) if args.poll_log else None
    )
    restore = restore_measurement(
        rpo_minutes=args.rpo_minutes,
        rto_minutes=args.rto_minutes,
        verified=args.restore_verified,
    )
    report = build_report(
        latency=latency,
        cadence=cadence,
        restore=restore,
        base_url=args.base_url,
    )
    json_path, md_path = write_report(report, args.out)
    print(f"Betriebsabnahme: {json_path} und {md_path} — Urteil {report['overall']}.")
    return 0 if report["overall"] == "bestanden" else 2


if __name__ == "__main__":
    raise SystemExit(main())
