#!/usr/bin/env python3
"""
TankApp – Regime-Check: Wie stark und wie schnell reicht der Bestand eine
Steuer-/Preisregime-Änderung durch?

Anlass ist die Einigung auf einen Tankrabatt (−17 ct/L ab 01.10.2026, befristet
bis 31.12.2026) und einen Spritpreisdeckel (spätestens 01.01.2027). Der Befund
[docs/BEFUND-UX-MATH-2026-09-19.md] **Teil 5** misst die Folgen für die
Prognose-Kette; dieses Werkzeug liefert die **Echtzahlen**, die dort fehlen:
Es läuft auf dem eigenen Archivbestand, der mit dem Mai-Juni-Tankrabatt 2026
bereits zwei Kanten enthält (Start 01.05. Senkung, Ende 01.07. Erhöhung). Das
Rabatt-**Ende** ist derselbe Schock in derselben Richtung wie das
Rabatt-Ende am 01.01.2027 — wer den Januar vorbereiten will, misst den Juli.

Zwei Betriebsarten:

  1. **Messung auf echten Daten** (nur numpy/pandas, wie
     ``noon_rule_check.py`` — läuft auf dem Daten-Host ohne Engine):
     je Station und Sorte werden geschätzt

       * ``t_hat`` — der Tag der Kante (Zweiteilungs-Argument auf
         Tages-Median-Preisen: kleinste absolute Binnen-Streuung),
       * ``delta_ct`` — der Betrag (slot-gematchte robuste Differenz: Median je
         5-Minuten-Slot nach minus vor, dann Median über die Slots; das
         entfernt die Tagesform, weil je Slot verglichen wird),
       * ``verzoegerung_tage`` und ``durchgabe_pct`` gegen einen angekündigten
         Termin/Betrag (``--break``/``--announced-ct``),
       * ``se_ct`` — Tagesblock-Standardfehler von ``delta_ct``.

     Ohne ``--break`` wird die Kante je Station gesucht (``--detect``): Damit
     findet der Lauf beide Rabatt-Kanten im Bestand, ohne dass man sie kennt.

  2. **Simulation** (``--simulate``, braucht die Engine): reproduziert die
     Messtabellen des Befunds (§5.10) — Rolling-Origin-Läufe der echten
     ``engine.models.fit``/``predict``-Kette über einen Bruch, für Status quo,
     hartkodierten Daten-Abzug, Schritt-Dummy und geschätzte Kante, plus die
     Projektions-Lemmata (12-Uhr-PAVA gegen Regime-Sprung, Deckel-Clip vor/nach
     der Projektion). **Synthetische Reihen**, auf die Live-Messwerte aus
     docs/archiv/BEFUND-12-UHR-REGEL-2026-09-18.md §2.1 kalibriert: Sie
     belegen Mechanismen und Vorzeichen, keine Beträge für den Echtbestand.

Aufruf (auf dem Daten-Host, Influx-Lesezugang aus ``data/influx.env``)::

    python data-tools/export_influx.py --fuel e10 --env-file data/influx.env \
        --since 2026-06-15 --until 2026-07-15 --out data/export_e10_juli.csv
    python analysis/regime_check.py --data data/export_e10_juli.csv \
        --fuel E10 --break 2026-07-01 --announced-ct 17.0   # Rabatt-ENDE: Erhoehung

    # Befund-Zahlen nachrechnen (braucht numpy/pandas/holidays + engine):
    python analysis/regime_check.py --simulate

Ausgabe: Konsole + Markdown-Bericht (Default ``data/analysis/report_regime.md``).
Kein Modell, keine Empfehlung — nur Messen. Die Schätzer nutzen ausschließlich
Daten vor dem angegebenen Cutoff; ``--cutoff`` begrenzt sie zusätzlich.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    import numpy as np
    import pandas as pd
except ImportError as exc:  # Analyse-Pakete fehlen (z. B. nackte NAS-Box)
    raise SystemExit(
        f"Analyse-Abhängigkeit fehlt: {exc.name}. Einmalig installieren:\n"
        "  python3 -m venv .venv-analysis\n"
        "  .venv-analysis/bin/pip install -r analysis/requirements.txt\n"
        "Danach das Skript mit .venv-analysis/bin/python starten."
    ) from exc

BERLIN = ZoneInfo("Europe/Berlin")
# ``--simulate`` rechnet mit der Engine aus der Repo-Wurzel; der Messpfad auf
# echten Daten bleibt bewusst engine-frei (wie noon_rule_check.py).
ROOT = Path(__file__).resolve().parents[1]


def _engine_on_path() -> None:
    import sys

    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))


STEP_MINUTES = 5
SLOTS_PER_DAY = 24 * 60 // STEP_MINUTES
# Mindestsubstanz, bevor eine Schätzung etwas behauptet. Ohne sie wäre ein
# einzelner Tag mit zwei Beobachtungen eine „Kante“.
MIN_STATION_OBS = 200
MIN_SLOTS = 24
MIN_SEGMENT_DAYS = 3
# Ab dieser Abweichung der Binnen-Streuung gilt eine Kante als gefunden.
# Der Wert ist eine Anzeigeschwelle, keine Signifikanz: Der Bericht nennt
# Stichprobe und Standardfehler dazu, damit niemand die Flagge allein liest.
MIN_STEP_CT = 2.0


def load_prices(paths: list[Path], fuel: str) -> pd.DataFrame:
    """CSVs (auch ``.csv.gz``) lesen, Pflichtspalten prüfen, auf Sorte filtern.

    Bewusst ein kleinerer Pflichtsatz als ``noon_rule_check.py``
    (ohne ``brand``/``lat``/``lon``): Dieser Check zählt Preise je Station und
    Zeit, nicht je Marke oder Ort — ein Influx-Export ohne Koordinaten ist
    gültiger Input, kein Fehler.
    """
    frames = []
    for path in paths:
        df = pd.read_csv(path)
        missing = {"timestamp", "station_id", "city", "fuel", "price"} - set(df.columns)
        if missing:
            raise SystemExit(f"{path}: fehlende Spalten {sorted(missing)}")
        frames.append(df)
    df = pd.concat(frames, ignore_index=True)
    df = df[df.fuel.astype(str).str.upper() == fuel.upper()]
    if df.empty:
        raise SystemExit(f"Keine Zeilen für fuel={fuel}")
    return df


def prepare(paths: list[Path], fuel: str) -> pd.DataFrame:
    """Beobachtungen laden und auf echte Preise filtern (wie ``noon_rule_check``).

    Statuszeilen ohne gültigen Preis müssen raus, sonst ziehen sie als NaN in
    die Tages-Mediane und die Slot-Differenzen. Ehrliche Lücken werden nicht
    gefüllt: Eine Kante, die aus zu wenigen Tagen geschätzt würde, ist keine.
    """
    df = load_prices(paths, fuel).copy()
    if "valid" in df.columns:
        df = df[df["valid"].astype(str).str.lower() == "true"]
    price = pd.to_numeric(df["price"], errors="coerce")
    df = df[np.isfinite(price.to_numpy(dtype=float))].copy()
    df["price"] = pd.to_numeric(df["price"], errors="coerce").astype(float)
    df = df[df["price"].between(0.4, 5.0)]
    if df.empty:
        raise SystemExit(
            "Keine gültigen Beobachtungen (valid/endlicher Preis 0,40–5,00 €/L) "
            "im Bestand. Export-Modus und --since/--until prüfen."
        )
    df["ts"] = pd.to_datetime(df["timestamp"], utc=True, format="mixed")
    df = df[df["ts"].notna()]
    df["local"] = df["ts"].dt.tz_convert(BERLIN)
    # tz-naive Berliner Kalendertage: die Kantensuche vergleicht Tage, keine
    # Instanzen — und mischt sonst aware/naive in einem Vergleich.
    df["day"] = df["local"].dt.tz_localize(None).dt.normalize()
    df["slot"] = (df["local"].dt.hour * 60 + df["local"].dt.minute) // STEP_MINUTES
    return df.sort_values(["station_id", "ts"], kind="stable").reset_index(drop=True)


def daily_medians(
    prices: np.ndarray, days: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Tages-Median-Preise in chronologischer Reihenfolge (ältester zuerst).

    Der Tages-Median ist die robeste Zusammenfassung eines Stationstags: Er
    entfernt die Tagesform (Tief am Vormittag, Hoch nach der Mittagserhöhung)
    und lässt Betreiber-Sprünge stehen — genau die beiden Eigenschaften, die
    eine Kantensuche auf Niveau-Änderungen braucht.
    """
    keys, values = [], []
    for day in np.unique(days):
        sample = prices[days == day]
        sample = sample[np.isfinite(sample)]
        if len(sample):
            keys.append(day)
            values.append(float(np.median(sample)))
    return np.asarray(keys), np.asarray(values, dtype=float)


def estimate_break_day(
    daily: np.ndarray, days: np.ndarray, min_segment_days: int = MIN_SEGMENT_DAYS
) -> tuple[object, float]:
    """Kanten-Tag über das Zweiteilungs-Argument: kleinste absolute
    Binnen-Streuung über alle Kandidaten-Schnitte.

    Der klassische CUSUM-``argmax`` (wie in ``engine/selection.py::cusum_break``
    als **Teststatistik** genutzt) lokalisiert keine Kante: Die kumulierte
    Abweichung wächst nach einem Schritt weiter und ihr Maximum liegt am
    Fensterende, nicht am Sprung. Als Lokalisator wird hier deshalb die
    SSE-Variante minimiert — robust über absolute Abweichungen vom
    Segment-Median statt über Quadrate vom Mittel.

    Rückgabe ``(Tag, Kontrast in ct)``; ``(None, 0.0)`` bei zu wenig Substanz.
    """
    n = len(daily)
    if n < 2 * min_segment_days + 2:
        return None, 0.0
    best_cost, best_k = None, None
    for k in range(min_segment_days, n - min_segment_days):
        left, right = daily[:k], daily[k:]
        cost = float(np.abs(left - np.median(left)).sum()) + float(
            np.abs(right - np.median(right)).sum()
        )
        if best_cost is None or cost < best_cost:
            best_cost, best_k = cost, k
    if best_k is None:
        return None, 0.0
    contrast = float(np.median(daily[best_k:]) - np.median(daily[:best_k])) * 100.0
    return days[best_k], contrast


def _slot_matrix(
    prices: np.ndarray,
    slots: np.ndarray,
    days: np.ndarray,
    mask: np.ndarray,
    day_list: np.ndarray,
) -> np.ndarray:
    """Preise als (Slot × Tag)-Matrix; fehlende Beobachtungen bleiben ``nan``."""
    mat = np.full((SLOTS_PER_DAY, len(day_list)), np.nan)
    position = {day: j for j, day in enumerate(day_list)}
    for price, slot, day in zip(prices[mask], slots[mask], days[mask]):
        j = position.get(day)
        if j is not None:
            mat[int(slot), j] = float(price)
    return mat


def day_block_se(
    prices: np.ndarray,
    slots: np.ndarray,
    days: np.ndarray,
    pre: np.ndarray,
    post: np.ndarray,
    draws: int = 200,
    seed: int = 20260919,
):
    """Tagesblock-Standardfehler **desselben** Schätzers wie ``delta_ct``.

    Tage ziehen statt Beobachtungen: Preise innerhalb eines Tages sind klebrig
    (AR(1)-Rauschen plus Mittagssprung), ein Punkt-SE wäre zu klein. Gezogen
    wird **innerhalb jeder Seite getrennt**. Ein gemeinsamer Topf aus Vor- und
    Nach-Tagen mischt die beiden Niveaus in eine Median-Statistik und liefert
    einen SE, der die Regime-Differenz selbst enthält — gemessen auf dem
    Juli-Testbestand 6,6 ct statt 0,2 ct bei einem klaren 17-ct-Schritt.
    """
    pre_days, post_days = np.unique(days[pre]), np.unique(days[post])
    if len(pre_days) < MIN_SEGMENT_DAYS or len(post_days) < MIN_SEGMENT_DAYS:
        return None
    pre_mat = _slot_matrix(prices, slots, days, pre, pre_days)
    post_mat = _slot_matrix(prices, slots, days, post, post_days)
    enough = np.isfinite(pre_mat).sum(axis=1) >= MIN_SEGMENT_DAYS
    enough &= np.isfinite(post_mat).sum(axis=1) >= MIN_SEGMENT_DAYS
    if int(enough.sum()) < MIN_SLOTS:
        return None
    before, after = pre_mat[enough], post_mat[enough]
    rng = np.random.default_rng(seed)
    boots = np.empty(draws)
    for i in range(draws):
        take_pre = rng.integers(0, len(pre_days), size=len(pre_days))
        take_post = rng.integers(0, len(post_days), size=len(post_days))
        boots[i] = float(
            np.median(
                np.nanmedian(after[:, take_post], axis=1)
                - np.nanmedian(before[:, take_pre], axis=1)
            )
        )
    return float(np.std(boots))


def estimate_step(
    prices: np.ndarray,
    slots: np.ndarray,
    days: np.ndarray,
    cut_day,
    pre_days: int,
    post_days: int,
    cutoff=None,
) -> dict:
    """Betrag der Kante als slot-gematchte robuste Differenz (nach − vor).

    Je 5-Minuten-Slot wird der Median vor der Kante gegen den Median nach der
    Kante verglichen, dann der Median über die Slots. Der Vergleich **je Slot**
    ist der Punkt: Ein einfacher Vorher/Nachher-Median würde die Tagesform
    (17 ct Spanne) in den Betrag mischen, sobald Vor- und Nach-Fenster
    unterschiedliche Wochentags-Mischungen tragen.

    ``cutoff`` begrenzt das Nach-Fenster — die Schätzung darf niemals Daten
    nutzen, die zum Prognosezeitpunkt noch nicht existieren (derselbe
    Zukunftsleck-Schutz wie ``engine/models.py::fit``).
    """
    cut = pd.Timestamp(cut_day)
    pre_from = cut - pd.Timedelta(days=pre_days)
    post_to = cut + pd.Timedelta(days=post_days)
    if cutoff is not None:
        post_to = min(post_to, pd.Timestamp(cutoff))
    pre = (days >= pre_from) & (days < cut)
    post = (days >= cut) & (days < post_to)
    diffs, matched = [], 0
    for slot in range(SLOTS_PER_DAY):
        at = slots == slot
        before, after = prices[pre & at], prices[post & at]
        before = before[np.isfinite(before)]
        after = after[np.isfinite(after)]
        if len(before) >= MIN_SEGMENT_DAYS and len(after) >= MIN_SEGMENT_DAYS:
            diffs.append(float(np.median(after)) - float(np.median(before)))
            matched += 1
    if matched < MIN_SLOTS:
        return {
            "delta_ct": None,
            "n_slots": matched,
            "se_ct": None,
            "pre_days": int(len(np.unique(days[pre]))),
            "post_days": int(len(np.unique(days[post]))),
        }
    delta = float(np.median(diffs))
    se = day_block_se(prices, slots, days, pre, post)
    return {
        "delta_ct": delta,
        "n_slots": matched,
        "se_ct": se,
        "pre_days": int(len(np.unique(days[pre]))),
        "post_days": int(len(np.unique(days[post]))),
    }


def station_rows(
    df: pd.DataFrame,
    announced_day=None,
    announced_ct=None,
    pre_days=14,
    post_days=14,
    detect=True,
    cutoff=None,
) -> list[dict]:
    """Eine Zeile je Station: Kante, Betrag, Verzögerung, Durchgabe."""
    rows = []
    for station_id, group in df.groupby("station_id", sort=True):
        prices = group["price"].to_numpy(dtype=float)
        if len(prices) < MIN_STATION_OBS:
            continue
        slots = group["slot"].to_numpy()
        days = group["day"]
        day_keys, day_values = daily_medians(prices, days)
        if len(day_keys) < 2 * MIN_SEGMENT_DAYS + 2:
            continue
        row = {
            "station_id": station_id,
            "city": str(group["city"].iloc[-1]),
            "station_name": str(
                group.get("station_name", pd.Series([station_id])).iloc[-1]
            ),
            "obs": len(prices),
            "days": len(day_keys),
        }
        if announced_day is not None:
            cut = pd.Timestamp(announced_day)
            source = "angekuendigt"
        elif detect:
            found, contrast = estimate_break_day(day_values, day_keys)
            if found is None or abs(contrast) < MIN_STEP_CT:
                rows.append(
                    {
                        **row,
                        "t_hat": None,
                        "delta_ct": None,
                        "status": "keine Kante gefunden",
                    }
                )
                continue
            cut, source = pd.Timestamp(found), "detektiert"
        else:
            continue
        step = estimate_step(prices, slots, days, cut, pre_days, post_days, cutoff)
        if step["delta_ct"] is None:
            rows.append(
                {
                    **row,
                    "t_hat": cut.date().isoformat(),
                    "delta_ct": None,
                    "status": f"zu wenig Slots ({step['n_slots']})",
                }
            )
            continue
        delta_ct = round(step["delta_ct"] * 100.0, 2)
        row.update(
            {
                "t_hat": cut.date().isoformat(),
                "quelle": source,
                "delta_ct": delta_ct,
                "se_ct": None
                if step["se_ct"] is None
                else round(step["se_ct"] * 100.0, 2),
                "n_slots": step["n_slots"],
                "vor_tage": step["pre_days"],
                "nach_tage": step["post_days"],
                # Der Betrag steht im Bericht, auch wenn er die Schwelle nicht
                # trägt — eine Station, die nicht durchgibt, ist ein Befund und
                # kein Fehler. Wer korrigiert, prüft die Schwelle (siehe
                # ``estimate`` in der Simulation).
                "status": "geschätzt"
                if abs(delta_ct) >= MIN_STEP_CT
                else f"unter Schwelle ({MIN_STEP_CT:.1f} ct)",
            }
        )
        if announced_day is not None and detect:
            found, _contrast = estimate_break_day(day_values, day_keys)
            if found is not None:
                row["t_detektiert"] = pd.Timestamp(found).date().isoformat()
                row["verzoegerung_tage"] = int(
                    (pd.Timestamp(found) - pd.Timestamp(announced_day)).days
                )
        if announced_ct:
            # Vorzeichenbehaftet: --announced-ct -17 fuer eine Senkung, +17 fuer
            # eine Erhoehung. 100 % = vollstaendig durchgereicht.
            row["durchgabe_pct"] = round(100.0 * row["delta_ct"] / announced_ct, 1)
        rows.append(row)
    return rows


def summary(rows: list[dict]) -> dict:
    """Stadt-/Bestands-Sicht: Median und Streuung der Durchgabe."""
    deltas = [r["delta_ct"] for r in rows if r.get("delta_ct") is not None]
    delays = [
        r["verzoegerung_tage"] for r in rows if r.get("verzoegerung_tage") is not None
    ]
    shares = [r["durchgabe_pct"] for r in rows if r.get("durchgabe_pct") is not None]
    out = {"stationen_geschaetzt": len(deltas), "stationen_gesamt": len(rows)}
    if deltas:
        out.update(
            {
                "delta_median_ct": round(float(np.median(deltas)), 2),
                "delta_p10_ct": round(float(np.percentile(deltas, 10)), 2),
                "delta_p90_ct": round(float(np.percentile(deltas, 90)), 2),
                "delta_spread_ct": round(float(np.max(deltas) - np.min(deltas)), 2),
            }
        )
    if shares:
        out["durchgabe_median_pct"] = round(float(np.median(shares)), 1)
    if delays:
        out.update(
            {
                "verzoegerung_median_tage": float(np.median(delays)),
                "verzoegerung_max_tage": int(np.max(delays)),
            }
        )
    return out


def _md_table(headers: list[str], rows: list[list[str]]) -> str:
    head = "| " + " | ".join(headers) + " |"
    sep = "|" + "|".join(["---"] * len(headers)) + "|"
    body = ["| " + " | ".join(str(c) for c in row) + " |" for row in rows]
    return "\n".join([head, sep, *body])


def build_report(rows: list[dict], total: dict, args, fuel: str) -> str:
    """Markdown-Bericht — dieselbe Form wie ``noon_rule_check.py``."""
    lines = [
        "# Regime-Check — Durchgabe einer Preisregime-Änderung",
        "",
        f"Sorte **{fuel}** · {total.get('beobachtungen', 0)} gültige Beobachtungen · "
        f"{total.get('stationen', 0)} Stationen im Bestand.",
        "",
        "Geschätzt je Station: Kanten-Tag `t_hat` (Zweiteilung auf Tages-Medianen),",
        "Betrag `delta_ct` (slot-gematchte robuste Differenz, nach − vor),",
        "Tagesblock-Standardfehler `se_ct`, Verzögerung und Durchgabe gegen die",
        "Ankündigung. **Kein Modell, keine Empfehlung** — nur Messung.",
        "",
        "## Bestand",
        "",
        _md_table(
            ["Kennzahl", "Wert"],
            [[k.replace("_", " "), v] for k, v in summary(rows).items()],
        ),
        "",
        "## Je Station",
        "",
    ]
    headers = [
        "Station",
        "Name",
        "Stadt",
        "t_hat",
        "delta ct/L",
        "se ct",
        "Slots",
        "Verz. d",
        "Durchgabe %",
        "Status",
    ]
    table = []
    for row in rows:
        table.append(
            [
                row["station_id"][:12],
                row.get("station_name", "")[:18],
                row.get("city", "")[:12],
                row.get("t_hat", "—"),
                row.get("delta_ct", "—"),
                row.get("se_ct", "—"),
                row.get("n_slots", "—"),
                row.get("verzoegerung_tage", "—"),
                row.get("durchgabe_pct", "—"),
                row.get("status", ""),
            ]
        )
    lines.append(_md_table(headers, table))
    lines += [
        "",
        "## Lesart und Grenzen",
        "",
        "- `delta_ct` ist die **beobachtete** Brutto-Änderung je Station. Sie ist",
        "  nicht die Steueränderung: Margo-Entscheidungen der Stationen sind",
        "  eingemischt (2022 wie 2026 die eigentliche Frage).",
        "- `se_ct` ist ein Tagesblock-Standardfehler über die Vor-/Nach-Tage,",
        "  nicht über die Beobachtungen — Preise innerhalb eines Tages sind",
        "  klebrig, ein Punkt-SE wäre zu klein.",
        "- `verzoegerung_tage` > 0 heißt: Die Station hat später gesenkt/erhöht",
        "  als angekündigt. Genau diese Verteilung trägt die Szenario-Mischung",
        "  (Befund Teil 5, R5 Punkt 1); ein einzelner Mittelwert reicht nicht.",
        "- „keine Kante gefunden“ ist ein Ergebnis, kein Fehler: Eine Station",
        "  ohne ausreichenden Kontrast (≥ "
        f"{MIN_STEP_CT:.0f} ct) wird nicht auf einen Betrag festgenagelt.",
        "- Stationen mit < "
        f"{MIN_STATION_OBS} gültigen Beobachtungen oder < "
        f"{2 * MIN_SEGMENT_DAYS + 2} Tagen fallen aus und zählen in",
        "  `stationen_gesamt` mit.",
    ]
    if args.announced_ct:
        lines += [
            "",
            f"Ankündigung: {args.break_day or 'kein Tag angegeben (je Station gesucht)'}"
            f" · {args.announced_ct:+.1f} ct/L. "
            "`durchgabe_pct` = beobachtete Änderung ÷ angekündigte Änderung.",
        ]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Simulation: Reproduktion der Befund-Tabellen (braucht die Engine)
# ---------------------------------------------------------------------------


def daily_shape(hour: np.ndarray) -> np.ndarray:
    """Nach-Gesetz-Tagesform: Hoch kurz nach 12 Uhr, Tief um ~7 Uhr, 17 ct
    Spanne — die Live-Messwerte aus dem 12-Uhr-Befund §2.1 als Kurve."""
    since_noon = (hour - 12.0) % 24.0
    x = np.minimum(since_noon / 19.0, 1.0)
    return -0.17 * (1.0 - np.cos(np.pi * x)) / 2.0


def make_prices(
    start: str,
    days: int,
    *,
    step: float,
    break_at,
    delay_days=0.0,
    passthrough=1.0,
    seed=7,
    station="station-1",
) -> pd.DataFrame:
    """Synthetischer Bestand im Schema der Export-Werkzeuge."""
    index = pd.date_range(start, periods=days * SLOTS_PER_DAY, freq="5min", tz=BERLIN)
    local = index.tz_convert(BERLIN)
    hour = np.asarray(local.hour + local.minute / 60.0)
    rng = np.random.default_rng(seed)
    t = np.arange(len(index)) / SLOTS_PER_DAY
    level = (
        1.72
        + 0.010 * np.sin(2 * np.pi * t / 23.0)
        + 0.006 * np.sin(2 * np.pi * t / 7.0)
        + 0.004 * (np.asarray(local.dayofweek, dtype=float) >= 5)
    )
    day_key = local.normalize()
    jump = {
        d: (rng.uniform(0.02, 0.08) if rng.random() < 0.44 else 0.0)
        for d in np.unique(day_key)
    }
    shape = daily_shape(hour) + np.array([jump[d] for d in day_key]) * (hour >= 12)
    noise = np.zeros(len(index))
    innovation = rng.normal(0, 0.0035, len(index))
    for i in range(1, len(index)):
        noise[i] = 0.95 * noise[i - 1] + innovation[i]
    shifted = index >= (pd.Timestamp(break_at) + pd.Timedelta(days=delay_days))
    price = level + shape + noise + np.where(shifted, step * passthrough, 0.0)
    return pd.DataFrame(
        {
            "timestamp": index.astype(str),
            "city": "Testmarkt",
            "station_id": station,
            "station_name": "Teststation",
            "fuel": "E10",
            "price": np.round(price, 3),
            "status": "open",
            "source": "influxdb",
        }
    )


def projection_lemmata() -> None:
    """Befund §5.3.3/§5.3.4: Regime-Sprung gegen 12-Uhr-Projektion, Deckel-Clip
    vor/nach der Projektion."""
    _engine_on_path()
    from engine.config import Config
    from engine.models import noon_law_projection

    cfg = Config()

    def hour_of(index):
        local = index.tz_convert(BERLIN)
        return np.asarray(local.hour + local.minute / 60.0)

    print("\n=== Projektions-Lemmata (Befund §5.3.3, §5.3.4) ===")
    for label, step, start, cut in (
        (
            "Anstieg +17 ct (Rabatt-Ende 01.01.)",
            +0.17,
            "2026-12-31T12:00",
            "2027-01-01T00:00",
        ),
        (
            "Senkung -17 ct (Rabatt-Start 01.10.)",
            -0.17,
            "2026-09-30T12:00",
            "2026-10-01T00:00",
        ),
    ):
        index = pd.date_range(start, periods=SLOTS_PER_DAY, freq="5min", tz=BERLIN)
        edge = pd.Timestamp(cut, tz=BERLIN)
        raw = 1.72 + daily_shape(hour_of(index)) + np.where(index >= edge, step, 0.0)
        projected = noon_law_projection(raw, index, cfg)
        k = int(np.argmax(np.asarray(index >= edge)))
        error = (projected - raw) * 100.0
        print(f"  {label}")
        print(
            f"    Sprung roh {((raw[k] - raw[k - 1]) * 100):+6.2f} ct -> "
            f"projiziert {((projected[k] - projected[k - 1]) * 100):+6.2f} ct | "
            f"verbogen {int((np.abs(error) > 0.5).sum())}/{SLOTS_PER_DAY} Punkte | "
            f"Fehler min {error.min():+5.2f} / max {error.max():+5.2f} ct"
        )
        # Kante als zusaetzliche Segmentgrenze: zwei Teilsegmente
        at = int(np.argmax(np.asarray(index >= edge)))
        fix = np.concatenate(
            [
                noon_law_projection(raw[:at], index[:at], cfg),
                noon_law_projection(raw[at:], index[at:], cfg),
            ]
        )
        print(
            f"    mit Kante als Segmentgrenze: Sprung {((fix[k] - fix[k - 1]) * 100):+6.2f} ct | "
            f"verbogen {int((np.abs(fix - raw) > 0.005).sum())}/{SLOTS_PER_DAY} Punkte"
        )
    # Deckel-Reihenfolge
    index = pd.date_range(
        "2027-01-05T12:00", periods=SLOTS_PER_DAY, freq="5min", tz=BERLIN
    )
    path = np.full(SLOTS_PER_DAY, 1.80)
    cap = np.where(index.hour < 12, 1.85, 1.75)  # Formeldeckel steigt um Mitternacht
    after = np.minimum(noon_law_projection(path, index, cfg), cap)
    before = noon_law_projection(np.minimum(path, cap), index, cfg)
    print("  Bewegter Deckel (1,75 bis 24:00, 1,85 ab 00:00):")
    print(
        f"    Clip NACH Projektion: max Anstieg {float(np.max(np.diff(after))) * 100:+5.2f} ct"
        f"  -> 12-Uhr-Regel verletzt: {bool(np.any(np.diff(after) > 1e-12))}"
    )
    print(
        f"    Clip VOR  Projektion: max Anstieg {float(np.max(np.diff(before))) * 100:+5.2f} ct"
        f"  -> verletzt: {bool(np.any(np.diff(before) > 1e-12))}"
    )


def simulate(scenarios: tuple[str, ...] = ("A", "B", "C")) -> None:
    """Rolling-Origin-Läufe der echten Engine-Kette über einen Bruch.

    Vier Behandlungsvarianten, dieselben Cutoffs, dieselbe Wahrheit:

      ``status-quo``         keine Regime-Behandlung (Auslieferungszustand 0.55.1),
      ``hartkodiert``        der Entwurfsvorschlag: Vor-Kante-Trainingsdaten um den
                             angekündigten Betrag verschieben, Prognose unangetastet,
      ``dummy``              Schritt-Dummy-Äquivalent: Nach-Kante-Preise auf das
                             alte Niveau ziehen **und** die Prognose im neuen Regime
                             zurückschieben — Betrag und Termin angekündigt,
      ``dummy-geschaetzt``   wie ``dummy``, aber Kante und Betrag aus den Daten
                             (nur Beobachtungen strikt vor dem Cutoff).

    Gemeldet werden Bias des Medians, Breite q975−q025, ``P_besser`` (gerechnet
    wie ``app/pside.py::p_better`` mit θ = 1 ct gegen den live beobachteten
    Anker) und die Wahrheit: Abstand des echten Fensterminimums zum Anker.
    """
    _engine_on_path()
    from engine.config import Config
    from engine.data import PriceSeries, normalize_observations, prepare_series
    from engine.models import fit, predict
    from engine.probabilities import BLOCK_MINUTES, block_ids, block_minima

    def prepare(raw, cfg):
        normalized, _ = normalize_observations(raw, cfg)
        return prepare_series(normalized, cfg)[0]

    def _rebuild(series, frame):
        return PriceSeries(
            series.city,
            series.station_id,
            series.station_name,
            series.fuel,
            frame,
            series.hampel_removed,
        )

    def shifted(series, cut_utc, amount):
        """Nach-Kante-Preise um ``amount`` anheben (Referenz = altes Niveau).

        Zusammen mit der Rückverschiebung der Prognose um denselben Betrag ist
        das exakt ein Schritt-Dummy: Training und Prognose bleiben konsistent.
        """
        frame = series.frame.copy()
        frame.loc[frame.index >= cut_utc, "price"] += amount
        return _rebuild(series, frame)

    def shifted_pre(series, cut_utc, amount):
        """Vor-Kante-Preise um ``amount`` verschieben, Prognose unangetastet.

        Das ist der Entwurfsvorschlag wörtlich („17 Cent von den
        September-Trainingsdaten abziehen"): Die Korrektur gilt nur auf der
        Datenseite, also nur für die Seite, an die gedacht wurde.
        """
        frame = series.frame.copy()
        frame.loc[frame.index < cut_utc, "price"] += amount
        return _rebuild(series, frame)

    def estimate(series, origin, fallback_cut, fallback_delta, look_days=21):
        """(Kante, Betrag) aus Daten vor dem Cutoff; sonst die Ankündigung.

        Das Suchfenster ist bewusst begrenzt (``look_days``): Eine Kante, die
        älter ist als das halbe Trainingsfenster, ist für den Fit keine Kante
        mehr. Der Preis dafür ist messbar — altert der Bruch aus dem Fenster,
        fällt die Schätzung auf die Ankündigung zurück (Befund §5.3.2, letzter
        Absatz). Die Antwort darauf ist Persistenz (R2.4), nicht ein
        unbegrenztes Suchfenster: unbegrenzt findet die Suche stattdessen
        irgendwann einen fremden, älteren Bruch.
        """
        price = series.frame.loc[series.frame.index < origin, "price"].dropna()
        if price.empty:
            return fallback_cut, fallback_delta, None
        # Suche lokal (letztes Suchfenster), Schätzung breit (volle Vorgeschichte):
        # Würde auch δ̂ auf das Suchfenster gekürzt, fehlten ihm bei einer Kante
        # am Fensteranfang Vor-Tage — und ein 12-Tage-Vor-Fenster liefert einen
        # anderen Betrag als das vorgesehene 14-Tage-Fenster.
        search = price.loc[price.index >= origin - pd.Timedelta(days=look_days)]
        local = search.index.tz_convert(BERLIN).tz_localize(None)
        days = local.normalize()
        day_keys, day_values = daily_medians(search.to_numpy(dtype=float), days)
        found, contrast = estimate_break_day(day_values, day_keys)
        if found is None or abs(contrast) < MIN_STEP_CT:
            return fallback_cut, fallback_delta, None
        cut_local = pd.Timestamp(found)
        wide_local = price.index.tz_convert(BERLIN).tz_localize(None)
        step = estimate_step(
            price.to_numpy(dtype=float),
            np.asarray((wide_local.hour * 60 + wide_local.minute) // STEP_MINUTES),
            wide_local.normalize(),
            cut_local,
            14,
            14,
        )
        # Zwei unabhängige Statistiken müssen tragen: der Tageskontrast (oben)
        # UND der slot-gematchte Betrag, der tatsächlich korrigiert. Nur auf den
        # Kontrast zu prüfen lässt falsch-positive Kanten durch — gemessen am
        # 31.12.2026 (δ̂ = +1,2 ct aus Weihnachts-Rauschen) kippte das den
        # 02.01. auf −14,9 ct Bias.
        if step["delta_ct"] is None or abs(step["delta_ct"]) * 100.0 < MIN_STEP_CT:
            return fallback_cut, fallback_delta, None
        return (
            cut_local.tz_localize(BERLIN),
            step["delta_ct"],
            {
                "t_hat": str(cut_local.date()),
                "delta_ct": round(step["delta_ct"] * 100.0, 1),
            },
        )

    def run(origin, series, truth, cfg, variante, cut, announced):
        o = pd.Timestamp(origin, tz=BERLIN)
        effective_cut, delta = cut, announced
        if variante == "hartkodiert":
            train = shifted_pre(series, cut, announced) if o >= cut else series
            forecast_shift, effective_cut = 0.0, cut
        elif variante == "dummy":
            train, forecast_shift = shifted(series, cut, -announced), announced
        elif variante == "dummy-geschaetzt":
            if o > cut - pd.Timedelta(days=3):
                effective_cut, delta, extra = estimate(series, o, cut, announced)
            else:
                extra = None
            train = shifted(series, effective_cut, -delta)
            forecast_shift = delta
        else:
            train, forecast_shift = series, 0.0
        try:
            model = fit(train, o, cfg)
            result, paths = predict(model, 24, return_paths=True)
        except Exception as exc:  # noqa: BLE001 - ein Fit-Ausfall ist ein Messwert
            return {
                "cutoff": str(o.date()),
                "variante": variante,
                "fehler": str(exc)[:48],
            }
        index = result.index
        offset = np.where(index >= effective_cut, forecast_shift, 0.0)
        q = result[["q025", "q50", "q975"]].to_numpy(dtype=float) + offset[:, None]
        paths = paths + offset[None, :]
        actual = truth.reindex(index).to_numpy(dtype=float)
        usable = np.isfinite(q[:, 1]) & np.isfinite(actual)
        if not usable.any():
            return {
                "cutoff": str(o.date()),
                "variante": variante,
                "fehler": "keine auswertbaren Punkte",
            }
        anchor = float(truth.asof(o - pd.Timedelta(minutes=5)))
        ids = block_ids(index, str(BERLIN), BLOCK_MINUTES)
        minima = block_minima(paths[:500], ids)
        first = [row[0] for row in minima]
        first = [v for v in first if v is not None and v == v]
        p_better = (
            float(np.mean([1.0 if (anchor - v) > 0.01 else 0.0 for v in first]))
            if first
            else float("nan")
        )
        row = {
            "cutoff": str(o.date()),
            "variante": variante,
            "bias_ct": round(float(np.mean(q[usable, 1] - actual[usable])) * 100, 2),
            "breite_ct": round(float(np.mean(q[usable, 2] - q[usable, 0])) * 100, 1),
            "p_besser": round(p_better, 3),
            "wahr_ct": round((float(np.nanmin(actual)) - anchor) * 100, 1),
        }
        if variante == "dummy-geschaetzt" and extra:
            row.update(extra)
        return row

    cfg = Config(bootstrap_samples=500, city_subdivs={"Testmarkt": "NW"})
    setups = {
        "A": (
            "A) -17,0 ct am 01.10.2026, sofort und vollstaendig",
            dict(
                start="2026-08-01", days=105, step=-0.17, cut="2026-10-01T00:00", seed=7
            ),
            [
                "2026-09-25",
                "2026-09-30",
                "2026-10-01",
                "2026-10-02",
                "2026-10-03",
                "2026-10-05",
                "2026-10-08",
                "2026-10-12",
                "2026-10-16",
                "2026-10-22",
                "2026-10-29",
                "2026-11-08",
            ],
        ),
        "B": (
            "B) -14,5 ct ab 03.10.2026 (2 Tage spaeter, 85 % Durchgabe)",
            dict(
                start="2026-08-01",
                days=105,
                step=-0.17,
                cut="2026-10-01T00:00",
                delay_days=2.0,
                passthrough=0.85,
                seed=11,
            ),
            [
                "2026-09-30",
                "2026-10-01",
                "2026-10-02",
                "2026-10-03",
                "2026-10-05",
                "2026-10-08",
                "2026-10-12",
                "2026-10-16",
                "2026-10-22",
                "2026-10-29",
                "2026-11-08",
            ],
        ),
        "C": (
            "C) +17,0 ct am 01.01.2027 (Rabatt-Ende, gefaehrliche Richtung)",
            dict(
                start="2026-11-01", days=90, step=+0.17, cut="2027-01-01T00:00", seed=23
            ),
            [
                "2026-12-28",
                "2026-12-31",
                "2027-01-01",
                "2027-01-02",
                "2027-01-04",
                "2027-01-06",
                "2027-01-10",
                "2027-01-15",
            ],
        ),
    }
    print("=" * 78)
    print("Simulation — synthetische Reihen, kalibriert auf die Live-Messwerte aus")
    print("docs/archiv/BEFUND-12-UHR-REGEL-2026-09-18.md §2.1. Belegt Mechanismen")
    print("und Vorzeichen, keine Betraege fuer den Echtbestand.")
    print("=" * 78)
    pd.set_option("display.width", 200)
    for key in scenarios:
        label, kwargs, origins = setups[key]
        announced = kwargs["step"]
        raw = make_prices(
            kwargs.pop("start"),
            kwargs.pop("days"),
            break_at=pd.Timestamp(kwargs.pop("cut"), tz=BERLIN),
            **kwargs,
        )
        cut = pd.Timestamp(
            {"A": "2026-10-01", "B": "2026-10-01", "C": "2027-01-01"}[key], tz=BERLIN
        )
        base = prepare(raw, cfg)
        truth = base.frame["price"]
        print(f"\n=== Szenario {label} ===")
        for variante in ("status-quo", "hartkodiert", "dummy", "dummy-geschaetzt"):
            rows = [run(o, base, truth, cfg, variante, cut, announced) for o in origins]
            print(f"\n-- {variante}")
            print(pd.DataFrame(rows).drop(columns=["variante"]).to_string(index=False))
    projection_lemmata()


def main() -> None:
    ap = argparse.ArgumentParser(
        description="TankApp – Regime-Check: Durchgabe einer Preisregime-Änderung "
        "messen (oder die Befund-Simulation nachrechnen)"
    )
    ap.add_argument(
        "--data",
        nargs="*",
        type=Path,
        default=[],
        help="Export-CSVs im Schema von data-tools/export_influx.py",
    )
    ap.add_argument("--fuel", default="E10")
    ap.add_argument(
        "--break",
        dest="break_day",
        default=None,
        help="angekündigter Kanten-Tag (lokal), z. B. 2026-07-01; "
        "ohne Angabe wird je Station gesucht (--detect)",
    )
    ap.add_argument(
        "--announced-ct",
        type=float,
        default=None,
        help="angekündigte Änderung in ct/L, **vorzeichenbehaftet** "
        "(-17 für eine Senkung, +17 für eine Erhöhung); "
        "durchgabe_pct = 100 bei vollständiger Durchgabe",
    )
    ap.add_argument("--pre-days", type=int, default=14)
    ap.add_argument("--post-days", type=int, default=14)
    ap.add_argument(
        "--cutoff",
        default=None,
        help="ISO-Zeitpunkt: keine Daten danach nutzen (Zukunftsleck-Schutz)",
    )
    ap.add_argument(
        "--detect",
        action="store_true",
        default=True,
        help="Kante je Station zusätzlich suchen (Default: an)",
    )
    ap.add_argument("--no-detect", dest="detect", action="store_false")
    ap.add_argument(
        "--report", type=Path, default=Path("data/analysis/report_regime.md")
    )
    ap.add_argument(
        "--simulate",
        action="store_true",
        help="Befund-Tabellen nachrechnen (braucht die Engine)",
    )
    ap.add_argument(
        "--scenarios",
        default="A,B,C",
        help="Simulationsszenarien, Kommaliste aus A,B,C. Default: %(default)s",
    )
    args = ap.parse_args()

    if args.simulate:
        try:
            simulate(
                tuple(s.strip().upper() for s in args.scenarios.split(",") if s.strip())
            )
        except ImportError as exc:
            raise SystemExit(
                f"--simulate braucht die Engine-Abhängigkeiten: {exc.name}. "
                "Einmalig: python3 -m pip install -r engine/requirements.txt"
            ) from exc
        return

    if not args.data:
        raise SystemExit("Entweder --data <csv> … für die Messung oder --simulate.")
    df = prepare(list(args.data), args.fuel)
    cutoff = (
        pd.Timestamp(args.cutoff, tz=BERLIN).tz_localize(None) if args.cutoff else None
    )
    rows = station_rows(
        df,
        args.break_day,
        args.announced_ct,
        args.pre_days,
        args.post_days,
        args.detect,
        cutoff,
    )
    if not rows:
        raise SystemExit("Keine Station mit ausreichend Substanz für eine Schätzung.")
    total = {
        "beobachtungen": int(len(df)),
        "stationen": int(df["station_id"].nunique()),
    }
    print(
        f"Sorte {args.fuel}: {total['beobachtungen']} gültige Beobachtungen, "
        f"{total['stationen']} Stationen."
    )
    print()
    for key, value in summary(rows).items():
        print(f"  {key.replace('_', ' '):28s} {value}")
    print()
    for row in rows:
        print(
            f"  {row['station_id'][:16]:18s} t_hat={row.get('t_hat', '—')} "
            f"delta={row.get('delta_ct', '—')} ct  se={row.get('se_ct', '—')} "
            f"Verz={row.get('verzoegerung_tage', '—')} d  "
            f"Durchgabe={row.get('durchgabe_pct', '—')} %  {row.get('status', '')}"
        )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(build_report(rows, total, args, args.fuel), encoding="utf-8")
    print(f"\nBericht: {args.report}")


if __name__ == "__main__":
    main()
