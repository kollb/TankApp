// Woche — der Zeit-Planer (docs/UI-NEUENTWURF.md §5.3).
//
// Reine Logik, ohne DOM (D1): das 7-Tage-Raster, die Sterne, die
// Horizont-Ehrlichkeit (Tage 5–7 „noch unsicher“), der Tank-Abgleich
// und die Auswahl-Zusammenfassung. Die Fenster kommen aus
// `decide.windows_week` (max. 3, Server-geordnet) — die App zeigt die
// ganze Woche, verspricht aber nur, was die Engine liefert.

import {
  berlinHour,
  centPerLiter,
  countLabel,
  deTrimmed,
  euro,
  euroPerLiter,
  hourRangeLabel,
  M7_MIN_RECOMMENDATIONS,
  percentLabel,
  type DecideResult,
  type TankInfo,
} from "./data";
import {
  dayLabel,
  nowStage,
  wordFromPercent,
  type NowStage,
} from "./now";

export type WeekWindow = DecideResult["windows_week"][number];

export type WeekDay = {
  /** Index 0 = heute … 6 (Berliner Kalendertag). */
  index: number;
  /** „Mo“ — Wochentag kurz. */
  shortDay: string;
  /** „15.09.“ — Kalenderdatum. */
  date: string;
  isToday: boolean;
  /** Das beste Fenster des Tages (lowest expected_price), sonst null. */
  window: WeekWindow | null;
  /** 0–3 Sterne aus der Fenster-Sicherheit; 0 ohne Fenster oder ohne P. */
  stars: number;
  /** true ab Tag 5 (Index 4) — entsättigte Darstellung + Fußnote. */
  uncertain: boolean;
};

/**
 * Sterne aus der Fenster-Sicherheit (UI-NEUENTWURF §5.3: „Sterne statt
 * Prozente“). Schwellen entsprechen den Wort-Stufen der Ampel-Karte
 * (wordFromPercent) — 3 = „ziemlich sicher“, 1 = „unsicher“, 0 = kein
 * messbares P. Ohne P steht ehrlich kein Stern, kein erfundener.
 */
export function windowStars(p: number | null | undefined): number {
  if (p == null || !Number.isFinite(p)) return 0;
  const percent = p * 100;
  if (percent >= 75) return 3;
  if (percent >= 55) return 2;
  if (percent >= 35) return 1;
  return 0;
}

/**
 * Die sieben Tage des Rasters (heute bis +6, Berlin). Je Tag das beste
 * verfügbare Fenster (günstigster Erwartungs-Preis). Der Server liefert
 * max. drei Fenster pro Woche — Tage ohne Fenster bleiben leer, keine
 * Erfindung.
 */
export function weekDays(
  windows: WeekWindow[] | null | undefined,
  now = Date.now(),
): WeekDay[] {
  const day = (value: number) =>
    new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(value));
  const startOfToday = day(now);
  const parsed = (windows ?? [])
    .map((window) => ({
      window,
      ms: Date.parse(window.start),
    }))
    .filter((entry) => Number.isFinite(entry.ms));

  return Array.from({ length: 7 }, (_, index) => {
    const ms = Date.parse(`${startOfToday}T12:00:00Z`) + index * 86400000;
    const dayKey = day(ms);
    const candidates = parsed.filter((entry) => day(entry.ms) === dayKey);
    const best =
      candidates.length > 0
        ? candidates.reduce((b, c) =>
            c.window.expected_price < b.window.expected_price
              ? c
              : b,
          ).window
        : null;
    return {
      index,
      shortDay: new Intl.DateTimeFormat("de-DE", {
        timeZone: "Europe/Berlin",
        weekday: "short",
      }).format(new Date(ms)),
      date: new Intl.DateTimeFormat("de-DE", {
        timeZone: "Europe/Berlin",
        day: "2-digit",
        month: "2-digit",
      }).format(new Date(ms)),
      isToday: index === 0,
      window: best,
      stars: best ? windowStars(best.p) : 0,
      // Horizont-Ehrlichkeit: Tage 5–7 (Index 4–6) tragen den Hinweis.
      uncertain: index >= 4,
    };
  });
}

export type WeekListEntry = {
  day: WeekDay;
  window: WeekWindow;
  /** Ersparnis in € ggü. dem aktuellen Preis (null = unbekannt). */
  savingEur: number | null;
};

/**
 * „Alle Fenster nach Ersparnis“ — die sortierte Liste unter dem Raster
 * (§5.3). Ersparnis = (aktuell − erwartet) × …; der Server liefert
 * `expected_saving_eur` vor, sonst null (keine Rechnung ohne Liter).
 */
export function weekWindowList(
  days: WeekDay[],
): WeekListEntry[] {
  const entries: WeekListEntry[] = [];
  for (const day of days) {
    if (!day.window) continue;
    entries.push({
      day,
      window: day.window,
      savingEur: day.window.expected_saving_eur,
    });
  }
  entries.sort((a, b) => {
    // Unbekannte Ersparnis nach hinten, dann mehr Ersparnis zuerst.
    const sa = a.savingEur;
    const sb = b.savingEur;
    if (sa == null && sb == null)
      return a.day.index - b.day.index;
    if (sa == null) return 1;
    if (sb == null) return -1;
    if (sb !== sa) return sb - sa;
    return a.day.index - b.day.index;
  });
  return entries;
}

export type TankReach = {
  tone: "ok" | "warn" | "bad" | "neutral";
  text: string;
};

/**
 * Tank-Abgleich (UI-NEUENTWURF §5.3: „Physik schlägt Statistik“).
 *
 * Ehrlichkeits-Grenze: Der Server prüft den Tank nur gegen das
 * *heutige* Fenster (`tank.blocks_wait`). Für kommende Fenster gibt es
 * keine Routen-Daten — da steht die Reichweite, nicht ein „reicht bis
 * Do“, den die App nicht belegen könnte.
 */
export function tankReach(
  tank: TankInfo | null,
  dayIndex: number,
  window: WeekWindow | null,
): TankReach | null {
  if (!tank) {
    return dayIndex === 0 && window
      ? { tone: "neutral", text: "Tankstand nicht gepflegt — ohne Angabe prüft die App nicht." }
      : null;
  }
  if (tank.state === "empty") {
    return { tone: "bad", text: tank.message ?? "Tank leer — vor der Fahrt tanken." };
  }
  if (dayIndex === 0) {
    if (tank.blocks_wait) {
      return {
        tone: "bad",
        text: tank.message ?? "Tank reicht nicht bis zum Fenster — Warten ist riskant.",
      };
    }
    return {
      tone: "ok",
      text: `Reicht bis zum Fenster — Restreichweite ≈ ${countLabel(tank.range_km)} km.`,
    };
  }
  if (tank.state === "low") {
    return {
      tone: "warn",
      text: tank.message ?? "Tank ist knapp — bis zum Wochenende eher riskant.",
    };
  }
  return {
    tone: "neutral",
    text: `Restreichweite ≈ ${countLabel(tank.range_km)} km — ob das bis dahin reicht, hängt von deiner Strecke ab.`,
  };
}

export type WeekSummary = {
  headline: string;
  /** „≈ 2,10 € unter jetzt“ — nur wenn beide Preise bekannt. */
  savingLine: string | null;
  security: string;
  tank: TankReach | null;
};

/**
 * Das Auswahl-Detail (§5.3 „AUSGEWÄHLT: Montag 19–21 Uhr“): erwarteter
 * Preis, Abstand zu jetzt, Sicherheit in Worten (+ Prozent nur auf
 * Stufe A) und der Tank-Abgleich.
 */
export function weekWindowSummary(
  day: WeekDay,
  decide: DecideResult | null,
  priceNow: number | null,
): WeekSummary | null {
  const window = day.window;
  if (!window) return null;
  const stage = nowStage(decide);
  const range = hourRangeLabel(
    Math.floor(berlinHour(new Date(window.start))),
    Math.floor(berlinHour(new Date(window.end))),
  );
  const saving =
    priceNow !== null
      ? (priceNow - window.expected_price) * 100
      : null;
  const savingLine =
    saving !== null
      ? saving >= 0.05
        ? `${centPerLiter(saving)} günstiger erwartet ≈ ${
            window.expected_saving_eur !== null
              ? `${euro(window.expected_saving_eur)} €`
              : "Betrag folgt mit der Tankmenge"
          }`
        : "Kein klarer Vorsprung gegenüber dem aktuellen Preis"
      : null;

  const percent =
    stage === "A" && window.p !== null && window.p !== undefined
      ? Math.round(window.p * 100)
      : null;
  const word =
    percent !== null
      ? wordFromPercent(percent)
      : stage === "C"
        ? "noch nicht messbar"
        : "wird noch gemessen";
  const security =
    percent !== null
      ? `${word} (${percentLabel(percent, 0)})`
      : stage === "B"
        ? `${word} — Prozent ab ${countLabel(M7_MIN_RECOMMENDATIONS)} Empfehlungen`
        : word;

  return {
    headline: `${dayLabel(window.start)} ${range}`,
    savingLine,
    security,
    tank: tankReach(decide?.tank ?? null, day.index, window),
  };
}

/**
 * Ebene 1 für ein Fenster (§7): max. drei Sätze, Alltagssprache,
 * mit Frische. Gleiche Mechanik wie die Jetzt-Begründung.
 */
export function weekExplanation(
  day: WeekDay,
  decide: DecideResult | null,
  priceNow: number | null,
  now = Date.now(),
): { sentences: string[]; source: string; labHint: string } | null {
  const window = day.window;
  if (!window) return null;
  const stage = nowStage(decide);
  const sentences: string[] = [];
  sentences.push(
    `Um ${hourRangeLabel(
      Math.floor(berlinHour(new Date(window.start))),
      Math.floor(berlinHour(new Date(window.end))),
    )} erwartet das Modell ${euroPerLiter(window.expected_price)} — das günstigste Fenster dieses Tages.`,
  );
  if (priceNow !== null) {
    const deltaCt = (priceNow - window.expected_price) * 100;
    sentences.push(
      deltaCt >= 0.05
        ? `Der aktuelle Preis liegt ${centPerLiter(deltaCt)} darüber — warten wäre der Vorsprung.`
        : `Der aktuelle Preis liegt nahe am Fensterpreis — der Vorsprung ist klein.`,
    );
  } else {
    sentences.push("Der aktuelle Preis fehlt, deshalb steht kein Abstand.");
  }
  if (day.uncertain) {
    sentences.push(
      "So weit voraus wird die Prognose breiter — der Tag trägt deshalb den Hinweis „noch unsicher“.",
    );
  } else if (stage === "A" && decide?.personal_stats?.advice) {
    const advice = decide.personal_stats.advice;
    if (advice.last_30d_total > 0) {
      sentences.push(
        `Von ${countLabel(advice.last_30d_total)} abgeschlossenen Empfehlungen traf ${countLabel(advice.last_30d_hits)} zu ${
          advice.hit_rate == null ? "" : `(${percentLabel(advice.hit_rate * 100, 0)})`
        }.`,
      );
    }
  } else if (stage === "B") {
    sentences.push(
      `Die Trefferquote wird noch gemessen — ${countLabel(
        decide?.personal_stats?.advice?.last_30d_total ?? 0,
      )} von ${countLabel(M7_MIN_RECOMMENDATIONS)} abgeschlossenen Empfehlungen.`,
    );
  }
  return {
    sentences: sentences.slice(0, 3),
    source: "Grundlage: der Modell-Lauf der Engine (Fenster und Erwartungs-Preise).",
    labHint: "In der Werkstatt vertiefen",
  };
}

/**
 * Wochenlinie (§5.3): der beste Erwartungs-Preis je Tag als Punkte-Reihe
 * (null = kein Fenster). Die Ansicht rendert daraus eine kleine
 * Balken-/Punktlinie — kein Chart-Labor.
 */
export function weekLine(
  days: WeekDay[],
): Array<{ label: string; value: number | null }> {
  return days.map((day) => ({
    label: day.shortDay,
    value: day.window ? day.window.expected_price : null,
  }));
}

/** Tank-Zeile des Wochen-Kopfs: „Tank: ¼ · ≈ 120 km · [Ändern]“. */
export function weekTankLine(
  tank: TankInfo | null,
  tankPercent: number | null,
  tankCapacity: number,
): { text: string; detail: string } {
  if (tankPercent == null && !tank) {
    return {
      text: "Tankstand nicht gepflegt",
      detail: "Ohne Angabe sagt die App nichts zur Reichweite — „Ändern“ setzt den Füllstand.",
    };
  }
  const percentLabelPart =
    tankPercent !== null ? `${deTrimmed(tankPercent, 0)} %` : "—";
  const range = tank
    ? `Restreichweite ≈ ${countLabel(tank.range_km)} km`
    : `≈ ${deTrimmed(tankCapacity, 0)} L Tank`;
  return {
    text: `Tank: ${percentLabelPart} · ${range}`,
    detail: tank
      ? `inkl. Reserve ≈ ${countLabel(tank.reserve_range_km)} km`
      : "Bewertung folgt mit der nächsten Empfehlung-Antwort.",
  };
}
