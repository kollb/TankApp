"""M7 als formalen Release-Blocker führen (A5).

Regeln (verbindlich, siehe docs/produkt/KONZEPT.md und
docs/planung/LUECKEN.md):

* Keine Freigabe von „Empfehlung“ im produktiven Wording vor M7.
* Kein Ausweichen auf Prozentwerte aus Modell- oder Backtestmetriken.
* Jede Vertragskohorte separat auswerten (``app/gate_context.py``).
* Ergebnisse samt Konfidenzintervallen, Referenzmodellen und
  Ausschlussgründen archivieren (dieses Modul).
* Bei Vertragswechseln bewusst einen Neustart der
  Evidenzkommunikation vornehmen (neue Kohorte, Zähler ab Null).

Das Archiv ist eine JSONL-Datei unter ``runtime/m7/archive.jsonl`` —
eine Zeile je Gate-Urteil, anhängbar, ohne Datenbank. Jede Zeile trägt
den Kohortenkontext, das Urteil, Fallzahlen, Brier mit Intervall,
beide Leave-One-Out-Referenzen, Reliability-Steigung mit Intervall,
Block-Bootstrap/Kish-ESS-Angaben und die Ausschlussgründe. Leere
Archive sind kein Urteil — sie bedeuten „noch keine Evidenz“.

Nur Standardbibliothek.
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

ARCHIVE_RELATIVE = Path("m7") / "archive.jsonl"

# M7-Mindestfallzahl je Vertragskohorte (A5): mindestens 100
# abgeschlossene Empfehlungen mit Verteilungs-P.
MIN_RECOMMENDATIONS_PER_COHORT = 100


def archive_path(settings) -> Path:
    """Pfad des M7-Evidenzarchivs (privat, gitignored)."""
    runtime = getattr(settings, "runtime", None)
    if runtime is None:
        runtime = Path(getattr(settings, "data", ".")) / "runtime"
    return Path(runtime) / ARCHIVE_RELATIVE


def build_entry(
    *,
    gate_context: dict[str, Any] | None,
    verdict: str,
    gate_n: int,
    advice_stats: dict[str, Any] | None = None,
    calibration_mode: str | None = None,
    references: dict[str, Any] | None = None,
    reliability: dict[str, Any] | None = None,
    bootstrap: dict[str, Any] | None = None,
    exclusions: list[str] | None = None,
    at: dt.datetime | None = None,
) -> dict[str, Any]:
    """Eine Archivzeile bauen — JSON-serialisierbar, ohne Geheimnisse."""
    stamp = at or dt.datetime.now(dt.timezone.utc)
    return {
        "at": stamp.isoformat(),
        "gate_context": dict(gate_context or {}),
        "verdict": str(verdict),
        "gate_n": int(gate_n),
        "min_recommendations": MIN_RECOMMENDATIONS_PER_COHORT,
        "calibration_mode": calibration_mode,
        "advice": _advice_numbers(advice_stats),
        "references": dict(references or {}),
        "reliability": dict(reliability or {}),
        "bootstrap": dict(bootstrap or {}),
        "exclusions": [str(item) for item in (exclusions or [])],
    }


def _advice_numbers(advice_stats: Any) -> dict[str, Any]:
    if not isinstance(advice_stats, dict):
        return {}
    advice = advice_stats.get("advice") if isinstance(advice_stats, dict) else None
    source = advice if isinstance(advice, dict) else advice_stats
    keys = (
        "gate_n",
        "brier",
        "brier_ci_low",
        "brier_ci_high",
        "brier_ref_a",
        "brier_ref_b",
        "reliability_slope",
        "reliability_slope_ci_low",
        "reliability_slope_ci_high",
        "kish_ess",
        "hit_rate",
        "last_30d_total",
    )
    return {key: source.get(key) for key in keys if key in source}


def append_entry(settings, entry: dict[str, Any]) -> Path:
    """Eine Zeile anhängen (legt Verzeichnisse an, nie überschreiben)."""
    path = archive_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False, sort_keys=True) + "\n")
    return path


def read_entries(settings, *, limit: int = 200) -> list[dict[str, Any]]:
    """Die jüngsten Archivzeilen lesen (neueste zuerst, kaputte überspringen)."""
    path = archive_path(settings)
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, ValueError):
        return []
    entries: list[dict[str, Any]] = []
    for line in reversed(lines):
        if len(entries) >= max(1, int(limit)):
            break
        text = line.strip()
        if not text:
            continue
        try:
            parsed = json.loads(text)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(parsed, dict):
            entries.append(parsed)
    return entries


def release_blocked_reason(
    *,
    calibrated: bool,
    gate_n: int | None,
    min_recommendations: int | None = None,
) -> str | None:
    """Release-Blocker als Satz — ``None`` heißt freigegeben.

    Reine Entscheidungsregel für GUI/API-Texte: Solange das M7-Gate
    nicht bestanden ist, bleibt die Kernfunktion eine
    Preisbeobachtungs- und Modelllernplattform (A5), kein
    Entscheidungssystem.
    """
    need = int(min_recommendations or MIN_RECOMMENDATIONS_PER_COHORT)
    done = int(gate_n or 0)
    if bool(calibrated) and done >= need:
        return None
    if done < need:
        return (
            f"Keine klare Empfehlung — das Modell lernt noch ({done} von "
            f"{need} abgeschlossenen Empfehlungen). Die Preise sind gemessen."
        )
    return (
        "Keine klare Empfehlung — die Gütehürden (Brier gegen beide "
        "Referenzen, Reliability-Steigung) sind noch nicht bestanden."
    )
