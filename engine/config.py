from dataclasses import asdict, dataclass, field
from zoneinfo import ZoneInfo

import pandas as pd


@dataclass(frozen=True)
class Config:
    timezone: str = "Europe/Berlin"
    step_minutes: int = 5
    ffill_minutes: int = 30
    train_days: int = 42
    min_train_days: int = 28
    min_slot_days: int = 7
    bootstrap_samples: int = 2000
    seed: int = 42
    # Gepoolter Feiertags-Dummy je Bundesland (Konzept §3.2): Stadt-Label ->
    # ISO-3166-2:DE-Subdiv (z. B. {"Frankfurt": "HE", "Gütersloh": "NW"}).
    # Ohne Eintrag (oder ohne Paket `holidays`) trägt der Dummy null —
    # der Effekt wird dann nicht modelliert, nicht geraten.
    city_subdivs: dict[str, str] = field(default_factory=dict)
    # Fenster, über das der Feiertagseffekt gepoolt geschätzt wird (Konzept
    # §3.2: „0–1 Feiertage je 6-Wochen-Fenster wären unidentifizierbar“ —
    # deshalb nicht das 42-Tage-Trainingsfenster, sondern bis zu einem Jahr).
    holiday_pool_days: int = 365
    # Exponentiell gewichteter Tagesblock-Bootstrap (Issue 46): neuere
    # Tagesblöcke werden mit höherer Wahrscheinlichkeit gezogen.
    # Halbwertszeit in Tagen (Gewicht halbiert sich je Halbwertszeit);
    # None = uniform (alle Tage gleich). Default 14: ein 5 Wochen alter
    # Block wiegt noch ~18 % eines aktuellen Blocks — Abdeckung bleibt
    # erhalten, Reaktion auf Preiswechsel wird schneller, ohne das
    # 42-Tage-Fenster pauschal auf 84 Tage zu verdoppeln.
    bootstrap_ew_half_life_days: float | None = 14.0
    poll_start: int = 6
    poll_end: int = 24
    # Schicht-A-Anker (Konzept §5.5): Tagesstunde des hypothetischen
    # Backtest-Entscheids („warten oder jetzt?“). Default 12: Anhebungen gibt
    # es nur mittags (12-Uhr-Regel) — um 12 Uhr weiß der hypothetische
    # Entscheid, ob es heute teurer wurde; um 8 Uhr fehlt ihm genau diese
    # Information. Über TANKAPP_DECISION_HOUR / --decision-hour verstellbar.
    decision_hour: int = 12
    # Seit diesem lokalen Zeitpunkt dürfen Tankstellen in Deutschland den
    # Preis nur noch um 12:00 Uhr erhöhen (Senkungen jederzeit).
    price_law_local: str = "2026-04-01T12:00"
    # B0 (Befund Teil 5, §5.7/§5.4.3): deklarierte Regime-Kanten — Steuer-
    # schritte und Deckel, die ein Preisniveau brechen. Je Eintrag ein
    # Wörterbuch mit den Feldern des R1-Kalenders, soweit B0 sie kennt:
    #   announced_local  ISO-Zeitpunkt (Ortszeit, Pflicht)
    #   kind             "tax_step" | "price_cap"
    #   fuel             "E5" | "E10" | "DIESEL" | None (= alle Sorten)
    #   announced_value  angekündigter Betrag in ct/L (Vorzeichen = Richtung)
    #                    oder None
    #   status           "announced" | "detected" | "in_force" | "unknown"
    #   source           Deklaration (Gesetz/Presse) oder Beleg der Schätzung
    # In 0.56.0 wirkt kein Eintrag auf Fit oder Prognose — die Engine
    # **markiert und zählt** nur (PIT-Paare, Backtest-Folds,
    # ``regime_breaks_in_window``). Das Rechenwerk (Dummy, Kante, Warmstart)
    # ist R1–R3 und kommt mit eigenem Schalter. Leer = keine Kante bekannt.
    regimes: tuple[dict, ...] = ()

    def __hash__(self):
        # Das Dict bleibt unhashbar — über den sortierten Inhalt hashen,
        # damit Config wieder als Schlüssel nutzbar ist (wie vor dem
        # city_subdivs-Feld).
        return hash(
            (
                self.timezone,
                self.step_minutes,
                self.ffill_minutes,
                self.train_days,
                self.min_train_days,
                self.min_slot_days,
                self.bootstrap_samples,
                self.seed,
                tuple(sorted(self.city_subdivs.items())),
                self.holiday_pool_days,
                self.bootstrap_ew_half_life_days,
                self.poll_start,
                self.poll_end,
                self.decision_hour,
                self.price_law_local,
                tuple(
                    tuple(sorted(entry.items(), key=lambda item: item[0]))
                    for entry in self.regimes
                ),
            )
        )

    def __post_init__(self):
        ZoneInfo(self.timezone)
        for name, sub in self.city_subdivs.items():
            if not name.strip():
                raise ValueError("city_subdivs: Stadt-Label darf nicht leer sein.")
            if not (isinstance(sub, str) and len(sub.strip().upper()) == 2):
                raise ValueError(
                    f"city_subdivs: '{name}' -> '{sub}' ist kein "
                    "zweistelliges Bundesland-Kürzel (z. B. HE, BY, NW)."
                )
        if not 7 <= self.holiday_pool_days <= 730:
            raise ValueError("holiday_pool_days muss zwischen 7 und 730 Tagen liegen.")
        parsed = pd.Timestamp(self.price_law_local).tz_localize(self.timezone)
        if pd.isna(parsed):
            raise ValueError(
                "price_law_local muss ein gültiger lokaler Zeitpunkt sein, "
                f"erhalten {self.price_law_local!r}."
            )
        if self.step_minutes != 5:
            raise ValueError("Die erste Engine-Version verwendet ein 5-Minuten-Raster.")
        if not 0 <= self.ffill_minutes <= 30:
            raise ValueError("Forward-Fill muss zwischen 0 und 30 Minuten liegen.")
        if not 7 <= self.min_train_days <= self.train_days <= 366:
            raise ValueError("7 <= min_train_days <= train_days <= 366 erforderlich.")
        if not 2 <= self.min_slot_days <= self.min_train_days:
            raise ValueError("min_slot_days muss zwischen 2 und min_train_days liegen.")
        if not 100 <= self.bootstrap_samples <= 10000:
            raise ValueError("100 bis 10000 Bootstrap-Ziehungen erforderlich.")
        if self.seed < 0:
            raise ValueError("seed muss nichtnegativ sein.")
        half_life = self.bootstrap_ew_half_life_days
        if half_life is not None and not 1 <= float(half_life) <= 366:
            raise ValueError(
                "bootstrap_ew_half_life_days muss zwischen 1 und 366 liegen "
                "(oder None für uniform)."
            )
        if not 0 <= self.poll_start < self.poll_end <= 24:
            raise ValueError("Polling-Fenster muss innerhalb 00–24 Uhr liegen.")
        if not 0 <= self.decision_hour <= 23:
            raise ValueError("decision_hour muss eine Tagesstunde 0–23 sein.")
        # B0: Regime-Kanten normalisieren (Liste aus JSON → Tupel, feste
        # Feldmenge, chronologisch) — frozen, deshalb über object.__setattr__.
        object.__setattr__(
            self, "regimes", normalize_regimes(self.regimes, self.timezone)
        )

    def to_dict(self):
        return asdict(self)


REGIME_KINDS = ("tax_step", "price_cap")
REGIME_FUELS = ("E5", "E10", "DIESEL")
REGIME_STATUS = ("announced", "detected", "in_force", "unknown")
REGIME_FIELDS = (
    "announced_local",
    "kind",
    "fuel",
    "announced_value",
    "status",
    "source",
)


def normalize_regimes(raw, timezone: str) -> tuple[dict, ...]:
    """Regime-Kanten prüfen und in eine feste Form bringen (B0).

    Akzeptiert Wörterbücher (volle Form) oder nackte ISO-Zeitpunkte
    (Kurzform: Steuerschritt, alle Sorten, Betrag unbekannt). Mehrdeutige
    oder nicht existente Wanduhrzeiten werden abgelehnt, nicht verschoben —
    dieselbe Regel wie ``price_law_local``. Doppelte Einträge (gleicher
    Zeitpunkt, gleiche Sorte, gleiche Art) fallen zusammen; Ausgabe
    chronologisch. Die Ausgabe ist idempotent: ``normalize_regimes(
    normalize_regimes(x))`` ist ``normalize_regimes(x)`` — Artefakte
    (``Config(**model["config"])``) kommen unverändert zurück.
    """
    if raw is None:
        return ()
    if isinstance(raw, (str, dict)):
        raw = (raw,)
    entries: list[tuple[pd.Timestamp, dict]] = []
    seen: set[tuple] = set()
    for item in raw:
        if isinstance(item, str):
            item = {"announced_local": item}
        if not isinstance(item, dict):
            raise ValueError(
                "regimes: Eintrag muss ein Wörterbuch oder ISO-Zeitpunkt sein, "
                f"erhalten {item!r}."
            )
        unknown = set(item) - set(REGIME_FIELDS)
        if unknown:
            raise ValueError(
                f"regimes: unbekannte Felder {sorted(unknown)} — erlaubt sind "
                f"{list(REGIME_FIELDS)}."
            )
        local = str(item.get("announced_local") or "").strip()
        if not local:
            raise ValueError("regimes: 'announced_local' (Ortszeit) ist Pflicht.")
        try:
            parsed = pd.Timestamp(local)
            if parsed.tzinfo is None:
                parsed = parsed.tz_localize(
                    timezone, ambiguous="NaT", nonexistent="NaT"
                )
        except (ValueError, TypeError) as exc:
            raise ValueError(
                f"regimes: {local!r} ist kein gültiger Zeitpunkt."
            ) from exc
        if pd.isna(parsed):
            raise ValueError(
                f"regimes: {local!r} ist keine eindeutige Wanduhrzeit "
                "(Zeitumstellung) — UTC-Offset explizit angeben."
            )
        kind = str(item.get("kind") or "tax_step").strip().lower()
        if kind not in REGIME_KINDS:
            raise ValueError(f"regimes: kind muss eines von {REGIME_KINDS} sein.")
        fuel = item.get("fuel")
        if fuel is not None:
            fuel = str(fuel).strip().upper()
            if fuel in ("", "*", "ALL", "ALLE"):
                fuel = None
            elif fuel not in REGIME_FUELS:
                raise ValueError(
                    f"regimes: fuel muss eines von {REGIME_FUELS} oder None sein."
                )
        value = item.get("announced_value")
        if value is not None:
            try:
                value = float(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(
                    "regimes: announced_value muss eine Zahl (ct/L) oder None sein."
                ) from exc
            if value != value or value in (float("inf"), float("-inf")):
                raise ValueError("regimes: announced_value muss endlich sein.")
        status = str(item.get("status") or "announced").strip().lower()
        if status not in REGIME_STATUS:
            raise ValueError(f"regimes: status muss eines von {REGIME_STATUS} sein.")
        source = str(item.get("source") or "").strip()
        key = (parsed.value, kind, fuel)
        if key in seen:
            continue
        seen.add(key)
        entries.append(
            (
                parsed,
                {
                    "announced_local": local,
                    "kind": kind,
                    "fuel": fuel,
                    "announced_value": value,
                    "status": status,
                    "source": source,
                },
            )
        )
    # B1-Fix Regime-Dedup: fuel=None bedeutet „alle Sorten“. Wenn für denselben
    # Zeitpunkt und dieselbe Art sowohl None als auch spezifische Sorten
    # vorliegen, ist None das Superset – spezifische Einträge fallen weg.
    # Vorher erlaubte der Key (parsed.value, kind, fuel) beides nebeneinander.
    by_time_kind: dict[tuple, list[tuple[pd.Timestamp, dict]]] = {}
    for ts, entry in entries:
        gkey = (ts.value, entry["kind"])
        by_time_kind.setdefault(gkey, []).append((ts, entry))
    filtered: list[tuple[pd.Timestamp, dict]] = []
    for group in by_time_kind.values():
        has_none = any(e["fuel"] is None for _, e in group)
        if has_none:
            # Behalte nur die None-Einträge (es gibt höchstens einen je Gruppe
            # wegen seen, aber defensiv alle Nones).
            for ts, e in group:
                if e["fuel"] is None:
                    filtered.append((ts, e))
        else:
            filtered.extend(group)
    filtered.sort(
        key=lambda pair: (pair[0].value, pair[1]["kind"], pair[1]["fuel"] or "")
    )
    return tuple(entry for _stamp, entry in filtered)
