// Jetzt — die reine Logik des ersten Bereichs aus dem GUI-Neuentwurf
// (docs/UI-NEUENTWURF.md §5.1, §7, §10).
//
// Warum eine eigene Datei: Die Ansicht rendert, sie entscheidet nichts (D1).
// Alles hier ist aus Server-Zahlen ableitbar und ohne DOM prüfbar — die vier
// Ausgänge der Ampel-Karte 2.0, genau drei Fakten in fester Reihenfolge,
// höchstens drei nächste Schritte, die Frische-Fußzeile und die Begründung
// der Ebene 1.
//
// Ehrlichkeits-Regeln, die hier durchgesetzt werden (docs/MICROCOPY.md):
//   * Prozent nur auf Stufe A (≥ 100 abgeschlossene Empfehlungen, Brier unter
//     der Schwelle). Stufe B nennt Worte plus Fortschritt, Stufe C bleibt grau
//     ohne Empfehlung — nie ein Prozentwert, der nicht gemessen ist.
//   * „Bisher“ ist kein „Erwartet“: historische Sätze sind als Muster
//     beschriftet, nie als Prognose verkleidet.
//   * Fehlt eine Zahl, steht „—“ mit Grund — nicht 0 und nicht geschätzt.

import {
  ageLabel,
  berlinHour,
  centPerLiter,
  countLabel,
  euro,
  euroPerLiter,
  freshness,
  hourRangeLabel,
  M7_MIN_RECOMMENDATIONS,
  percentLabel,
  type AdviceAction,
  type DecideResult,
  type Station,
} from "./data";

/** Wohin ein nächster Schritt führt — Ziele, nicht Tabs (Phase 1–4). */
export type NowTarget = "stations" | "week" | "tank" | "system";

/**
 * Sicherheits-Stufe der Aussage (UI-NEUENTWURF §10):
 * A „Nachgewiesen“ — Worte + Prozent · B „Lernend“ — Worte + Fortschritt ·
 * C „Zurückhaltend“ — grau, keine Empfehlung.
 */
export type NowStage = "A" | "B" | "C";

export function nowStage(decide: DecideResult | null): NowStage {
  if (!decide || decide.primary.action === "no_advice") return "C";
  return decide.calibrated ? "A" : "B";
}

/** Wort zur Sicherheit — nie allein, immer zusätzlich zur Farbe. */
export function confidenceWord(
  badge: DecideResult["primary"]["confidence_badge"] | null | undefined,
): string | null {
  if (badge === "high") return "ziemlich sicher";
  if (badge === "medium") return "eher sicher";
  if (badge === "low") return "unsicher";
  return null;
}

/** Fortschritt bis zur Prozent-Anzeige (nur Stufe B, nie ein Countdown). */
export function stageProgressNote(decide: DecideResult | null): string | null {
  if (nowStage(decide) !== "B" || !decide) return null;
  const done = decide.personal_stats?.advice?.last_30d_total ?? 0;
  const missing = Math.max(0, M7_MIN_RECOMMENDATIONS - done);
  if (missing === 0) return null;
  return (
    `Noch ${missing} abgeschlossene Empfehlung${missing === 1 ? "" : "en"} ` +
    `bis zur Prozent-Anzeige.`
  );
}

/**
 * Der Satz für den grauen Zustand, wenn das Modell noch nicht so weit ist
 * (S1/S2 aus §10): Grund plus Zählstand — ohne Countdown-Versprechen.
 */
export function learningNote(decide: DecideResult | null): string | null {
  if (!decide || decide.calibrated) return null;
  const done = decide.personal_stats?.advice?.last_30d_total ?? 0;
  if (done >= M7_MIN_RECOMMENDATIONS) return null;
  return (
    `Das Modell lernt noch — ${countLabel(done)} von ` +
    `${countLabel(M7_MIN_RECOMMENDATIONS)} abgeschlossenen Empfehlungen. ` +
    "Die Preise unten sind live."
  );
}

export type NowInput = {
  decide: DecideResult | null;
  stations: Station[];
  /** Ausgewählte Station („Jetzt hier“) — sonst die günstigste frische. */
  selectedId?: string;
  liters: number;
  now?: number;
};

export type NowVerdict = {
  action: AdviceAction;
  /** Grün = Handlung, Blau = Vergleich, Grau = ehrlich unentschieden. */
  tone: "green" | "blue" | "gray";
  headline: string;
  amount: string | null;
  detail: string;
  stationName: string | null;
  mapsUrl: string | null;
  /** Nur auf Stufe A gefüllt. */
  percent: number | null;
  word: string | null;
  stageNote: string | null;
};

/** Erwartete Ersparnis in ct/L, wenn beide Preise bekannt sind. */
export function savingPerLiterCt(
  priceNow: number | null | undefined,
  expected: number | null | undefined,
): number | null {
  if (priceNow == null || expected == null) return null;
  if (!Number.isFinite(priceNow) || !Number.isFinite(expected)) return null;
  return (priceNow - expected) * 100;
}

function confidenceDetail(
  decide: DecideResult,
  liters: number,
): { detail: string; percent: number | null; word: string | null } {
  const stage = nowStage(decide);
  const badge = decide.primary.confidence_badge;
  const word = confidenceWord(badge);
  const percent =
    stage === "A" && decide.primary.p_correct != null
      ? decide.primary.p_correct * 100
      : null;
  const parts = [`bei ${liters} L`];
  const security =
    percent != null
      ? `${word ?? "sicher"} (${percentLabel(percent, 0)})`
      : word;
  if (security) parts.push(security);
  return {
    detail: parts.join(" · "),
    percent: percent == null ? null : Math.round(percent),
    word,
  };
}

/**
 * Die Ampel-Karte 2.0 — vier Ausgänge (`refuel_now`, `wait`,
 * `refuel_elsewhere`, `no_advice`), jeweils mit Menge, Sicherheit und
 * Handlung. `null` heißt: es gibt noch nichts zu sagen (Lade-/Leerzustand).
 */
export function nowVerdict(input: NowInput): NowVerdict | null {
  const decide = input.decide;
  if (!decide) return null;
  const p = decide.primary;
  const { detail, percent, word } = confidenceDetail(decide, input.liters);
  const stageNote = stageProgressNote(decide);
  const reason = p.reason_short ? [p.reason_short, detail].join(" · ") : detail;

  if (p.action === "wait") {
    const window = p.recommended_window;
    const range = window
      ? hourRangeLabel(
          berlinHour(new Date(window.start)),
          berlinHour(new Date(window.end)),
        )
      : null;
    const deltaCt = window
      ? savingPerLiterCt(p.station.price_now, window.expected_price)
      : null;
    const saving = p.expected_saving_eur;
    let amount: string | null = null;
    if (deltaCt != null && deltaCt > 0) {
      amount =
        `Erwartet ${centPerLiter(deltaCt)} günstiger` +
        (saving != null ? ` ≈ ${euro(saving)} €` : "");
    } else if (saving != null && saving > 0) {
      amount = `Erwartet ≈ ${euro(saving)} € günstiger`;
    }
    return {
      action: p.action,
      tone: "green",
      headline: range ? `Warten bis ${range}` : "Warten lohnt sich",
      amount,
      detail: reason,
      stationName: p.station.name || null,
      mapsUrl: p.station.maps_url ?? null,
      percent,
      word,
      stageNote,
    };
  }

  if (p.action === "refuel_now") {
    return {
      action: p.action,
      tone: "green",
      headline: "Jetzt tanken",
      amount:
        p.station.price_now != null
          ? euroPerLiter(p.station.price_now)
          : null,
      detail: reason,
      stationName: p.station.name || null,
      mapsUrl: p.station.maps_url ?? null,
      percent,
      word,
      stageNote,
    };
  }

  if (p.action === "refuel_elsewhere") {
    const alt = [...decide.alternatives_nearby]
      .filter((a) => a.worth_it)
      .sort((a, b) => b.net_eur - a.net_eur)[0];
    return {
      action: p.action,
      tone: "blue",
      headline: alt ? `Woanders tanken · ${alt.name}` : "Woanders tanken",
      amount: alt
        ? `${euroPerLiter(alt.price)} · netto ${euro(alt.net_eur)} € günstiger`
        : null,
      detail: reason,
      stationName: alt?.name ?? p.station.name ?? null,
      mapsUrl: alt?.maps_url ?? p.station.maps_url ?? null,
      percent,
      word,
      stageNote,
    };
  }

  // no_advice: grau ist ein erster Klasse-Zustand mit Begründung, kein Fehler.
  const learning = learningNote(decide);
  return {
    action: p.action,
    tone: "gray",
    headline: "Keine klare Empfehlung",
    amount: null,
    detail:
      learning ??
      p.reason_short ??
      "Die Preise springen — die App rät nicht.",
    stationName: null,
    mapsUrl: null,
    percent: null,
    word: null,
    stageNote: null,
  };
}

/** Ein Fakt der Dreier-Reihe — immer Label, Wert, Erklärzeile. */
export type NowFact = { label: string; value: string; detail: string };

/**
 * Genau drei Fakten in fester Reihenfolge (UI-NEUENTWURF §5.1):
 * Jetzt hier · Bestes Fenster heute · Tank reicht?
 */
export function nowFacts(input: NowInput): NowFact[] {
  const decide = input.decide;
  const stage = nowStage(decide);

  // 1 · Jetzt hier
  const chosen =
    input.stations.find((s) => s.station_id === input.selectedId) ??
    [...input.stations]
      .filter((s) => s.price != null)
      .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0];
  const here: NowFact = chosen
    ? {
        label: "Jetzt hier",
        value: euroPerLiter(chosen.price),
        detail: chosen.brand
          ? `${chosen.name} · ${chosen.brand}`
          : chosen.name,
      }
    : {
        label: "Jetzt hier",
        value: "—",
        detail: "Kein bestätigter Preis in der Sicht",
      };

  // 2 · Bestes Fenster heute
  const window = decide?.windows_today?.[0] ?? decide?.primary.recommended_window;
  const best: NowFact =
    stage === "C" || !window
      ? {
          label: "Bestes Fenster heute",
          value: "—",
          detail:
            stage === "C"
              ? "Keine Prognose — Preise vergleichen"
              : "Heute kein Fenster mit Vorsprung",
        }
      : {
          label: "Bestes Fenster heute",
          value: hourRangeLabel(
            berlinHour(new Date(window.start)),
            berlinHour(new Date(window.end)),
          ),
          detail: `Erwartet ${euroPerLiter(window.expected_price)}`,
        };

  // 3 · Tank reicht?
  const tank = decide?.tank ?? null;
  const reach: NowFact = !tank
    ? {
        label: "Tank reicht?",
        value: "—",
        detail: "Tankstand nicht gepflegt",
      }
    : {
        label: "Tank reicht?",
        value: tank.blocks_wait ? "Nein" : "Ja",
        detail:
          tank.state === "empty"
            ? "Tank leer — vor der Fahrt tanken"
            : `${countLabel(tank.range_km)} km Reichweite inkl. Reserve`,
      };

  return [here, best, reach];
}

/** Ein nächster Schritt: Satz plus Zielort — nie mehr als drei. */
export type NowStep = { id: string; text: string; target: NowTarget };

export function nowSteps(input: NowInput): NowStep[] {
  const decide = input.decide;
  if (!decide) return [];
  const steps: NowStep[] = [];

  const alt = [...decide.alternatives_nearby]
    .filter((a) => a.worth_it)
    .sort((a, b) => b.net_eur - a.net_eur)[0];
  if (alt) {
    steps.push({
      id: "alternative",
      text:
        `Günstigste Alternative: ${alt.name}, ` +
        `${euroPerLiter(alt.price)} — netto ${euro(alt.net_eur)} € nach ` +
        `${euro(alt.detour_km, 1)} km Umweg`,
      target: "stations",
    });
  }

  const later = decide.windows_week?.[0];
  if (later && later.expected_saving_eur != null && later.expected_saving_eur > 0) {
    steps.push({
      id: "later-window",
      text:
        `${dayLabel(later.start, input.now)} ` +
        `${hourRangeLabel(
          berlinHour(new Date(later.start)),
          berlinHour(new Date(later.end)),
        )} wäre noch besser (${euro(later.expected_saving_eur)} € weniger)`,
      target: "week",
    });
  }

  if (decide.tank?.blocks_wait) {
    steps.push({
      id: "tank",
      text: "Tank reicht nicht bis zum Fenster — jetzt tanken oder Tankstand prüfen",
      target: "tank",
    });
  }

  return steps.slice(0, 3);
}

/** „Heute“ / „Morgen“ / Wochentag — Berliner Kalendertag, nie relativ geraten. */
export function dayLabel(stamp: string | null | undefined, now = Date.now()) {
  if (!stamp) return "Später";
  const ms = Date.parse(stamp);
  if (!Number.isFinite(ms)) return "Später";
  const day = (value: number) =>
    new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(value));
  const target = day(ms);
  if (target === day(now)) return "Heute";
  if (target === day(now + 24 * 60 * 60 * 1000)) return "Morgen";
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "long",
  }).format(new Date(ms));
}

export type NowFreshness = { text: string; tone: "ok" | "warn" | "bad" };

/**
 * Die Frische-Fußzeile: was die Zahlen sind und wie alt sie sind. Sie steht
 * unter jeder Ansicht gleich — dieselben Schwellen wie `dataAgeNote`.
 */
export function nowFreshness(input: {
  pricesAt?: string | null;
  forecastAt?: string | null;
  now?: number;
}): NowFreshness {
  const now = input.now ?? Date.now();
  if (!input.pricesAt && !input.forecastAt) {
    return { text: "Kein Datenstand — noch nichts gemeldet", tone: "warn" };
  }
  const prices = freshness(input.pricesAt, "prices", now);
  const model = freshness(input.forecastAt, "model", now);
  const tone =
    prices === "old" || model === "old"
      ? "bad"
      : prices === "stale" || model === "stale"
        ? "warn"
        : "ok";
  const parts: string[] = [];
  parts.push(
    input.pricesAt
      ? `Preise ${ageLabel(input.pricesAt, now)}`
      : "Preise kein Stand",
  );
  parts.push(
    input.forecastAt
      ? `Prognose ${ageLabel(input.forecastAt, now)}`
      : "Prognose kein Stand",
  );
  return { text: parts.join(" · "), tone };
}

export type NowExplanation = {
  /** Ebene 1: höchstens drei Sätze, immer Alltagssprache. */
  sentences: string[];
  /** Herkunft der Zahlen — eine Zeile, keine Formel. */
  source: string;
  /** Weg in die Tiefe; im Labor-Zeitalter zeigt er auf den Abschnitt. */
  labHint: string;
};

/**
 * Ebene 1 der Erklär-Treppe (UI-NEUENTWURF §7): max. 3 Sätze, keine Formel,
 * mit Frische. Der Beweis (Ebene 2) bleibt ausdrücklich woanders.
 */
export function nowExplanation(
  input: NowInput & { pricesAt?: string | null },
): NowExplanation | null {
  const decide = input.decide;
  if (!decide) return null;
  const stage = nowStage(decide);
  const window = decide.windows_today?.[0] ?? decide.primary.recommended_window;
  const sentences: string[] = [];

  if (window) {
    sentences.push(
      `Um ${hourRangeLabel(
        berlinHour(new Date(window.start)),
        berlinHour(new Date(window.end)),
      )} war der Preis an dieser Station bisher am niedrigsten.`,
    );
  } else {
    sentences.push(
      "Für heute liegt kein Preisfenster mit Vorsprung vor — der Vergleich der aktuellen Preise bleibt.",
    );
  }

  const deltaCt = window
    ? savingPerLiterCt(decide.primary.station.price_now, window.expected_price)
    : null;
  if (deltaCt != null && deltaCt > 0) {
    sentences.push(
      `Der aktuelle Preis liegt ${centPerLiter(deltaCt)} über dem erwarteten Fensterpreis.`,
    );
  } else if (deltaCt != null && deltaCt < 0) {
    sentences.push(
      `Der aktuelle Preis liegt ${centPerLiter(Math.abs(deltaCt))} unter dem erwarteten Fensterpreis — viel Luft nach unten bleibt nicht.`,
    );
  } else {
    sentences.push(
      "Ein Vergleichspreis für das Fenster fehlt, deshalb steht hier kein Abstand.",
    );
  }

  const advice = decide.personal_stats?.advice;
  if (stage === "A" && advice?.last_30d_total) {
    sentences.push(
      `Von ${countLabel(advice.last_30d_total)} abgeschlossenen Empfehlungen ` +
        `trafen ${countLabel(advice.last_30d_hits)} zu ` +
        `(${percentLabel(advice.hit_rate == null ? null : advice.hit_rate * 100, 0)}).`,
    );
  } else if (stage === "B") {
    sentences.push(
      `Die Trefferquote wird noch gemessen — ${countLabel(
        advice?.last_30d_total ?? 0,
      )} von ${countLabel(M7_MIN_RECOMMENDATIONS)} abgeschlossenen Empfehlungen.`,
    );
  } else {
    sentences.push(
      decide.primary.reason_short ||
        "Die Preise springen zu stark — für heute gibt es keine belastbare Empfehlung.",
    );
  }

  return {
    sentences: sentences.slice(0, 3),
    source: input.pricesAt
      ? `Grundlage: die geladenen Preismeldungen dieser Station, jüngste ${ageLabel(input.pricesAt, input.now)}.`
      : "Grundlage: die geladenen Preismeldungen dieser Station.",
    labHint: "In der Werkstatt vertiefen",
  };
}
