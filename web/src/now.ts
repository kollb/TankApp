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
  deTrimmed,
  euro,
  euroPerLiter,
  freshness,
  hourRangeLabel,
  hourRunsLabel,
  hourRunsOf,
  kilometersLabel,
  M7_MIN_RECOMMENDATIONS,
  percentLabel,
  type AdviceAction,
  type DecideResult,
  type Station,
} from "./data";
import { labHint, type LabHint } from "./lab";
import type { StripCell } from "./strip";

/** Wohin ein nächster Schritt führt — Ziele, nicht Tabs (Phase 1–4). */
export type NowTarget = "stations" | "week" | "tank" | "system" | "ich";

/**
 * Schnellauswahl „¼ / ½ / ¾ / voll“ (UI-NEUENTWURF §5.1): Tankstand ist kein
 * Formular, sondern ein Fakt — die vier üblichen Stände in einem Tap.
 * „voll“ = 100 % Füllstand, nicht „Tank vollgefahren“.
 */
export const TANK_QUICK: Array<{ label: string; percent: number }> = [
  { label: "¼", percent: 25 },
  { label: "½", percent: 50 },
  { label: "¾", percent: 75 },
  { label: "voll", percent: 100 },
];

/** Umgekehrte Karte: Füllstand → Kürzel (nur exakte Schnellauswahl-Werte). */
export function tankQuickLabel(percent: number | null): string | null {
  if (percent == null) return null;
  return TANK_QUICK.find((item) => item.percent === percent)?.label ?? null;
}

/**
 * „HH:MM“ aus `<input type="time">` → ISO-Zeitstempel heute in
 * Europe/Berlin (für den Decide-Parameter `latest_by`).
 *
 * `null` heißt: ungültige Eingabe. Ein Zeitpunkt, der in Berlin bereits
 * vergangen ist, bleibt ein gültiger Stempel — der Server schneidet dann
 * ehrlich alle Fenster ab („Kein Fenster mehr vor deinem spätesten
 * Tankzeitpunkt“), die GUI rät nichts um.
 */
export function timeInputToBerlinIso(
  hhmm: string,
  now = Date.now(),
): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const part = (type: string) =>
    formatter
      .formatToParts(new Date(now))
      .find((item) => item.type === type)?.value ?? "";
  const anchorUtc = Date.parse(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
  if (!Number.isFinite(anchorUtc)) return null;
  // UTC-Zeit, die dem Berliner Kalenderdatum + Uhrzeit *als UTC* entspricht —
  // daraus folgt das Berlin-Offset an diesem Tag (Sommertime-sicher).
  const wallAsUtc =
    anchorUtc + hour * 3600000 + minute * 60000;
  const probe = formatter.formatToParts(new Date(wallAsUtc));
  const probePart = (type: string) =>
    probe.find((item) => item.type === type)?.value ?? "0";
  const berlinHour =
    probePart("hour") === "24" ? 0 : Number(probePart("hour"));
  const berlinMinute = Number(probePart("minute"));
  // offsetMs = Berlin − UTC an diesem Tag (z. B. +2 h CEST). Berlin ist
  // VORRAUS — die Wall-Clock-Zeit liegt offsetMs NACH dem UTC-Stempel,
  // der UTC-Instanz „Berlin zeigt hh:mm“ ist also wallAsUtc − offsetMs.
  // (Mit +offsetMs wäre das Ergebnis um 2× das Offset verschoben, B2.)
  // Prüft die Probe über Mitternacht (Eingabe 23:59 → Probe 01:59),
  // fällt die Tageszeit-Differenz auf −22 h statt +2 h — in den
  // gültigen Offset-Bereich (±12 h) normalisieren.
  let offsetMs =
    (berlinHour * 60 + berlinMinute - (hour * 60 + minute)) * 60000;
  const DAY_MS = 24 * 3600000;
  if (offsetMs <= -DAY_MS / 2) offsetMs += DAY_MS;
  if (offsetMs > DAY_MS / 2) offsetMs -= DAY_MS;
  return new Date(wallAsUtc - offsetMs).toISOString();
}

/**
 * Markierung des Tagesprofils im Begründungs-Sheet (Ebene 1, §7):
 * das Fenster als Stundenbereich — `null` ohne Fenster (dann fehlt auch
 * ehrlich das Mini-Visual).
 */
export function windowMarks(window: {
  start: string;
  end: string;
} | null | undefined): { fromHour: number; toHour: number } | null {
  if (!window) return null;
  const from = berlinHour(new Date(window.start));
  const to = berlinHour(new Date(window.end));
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return { fromHour: Math.floor(from), toHour: Math.floor(to) };
}

/**
 * Sicherheits-Stufe der Aussage (UI-NEUENTWURF §10):
 * A „Nachgewiesen“ — Worte + Prozent · B „Lernend“ — Worte + Fortschritt ·
 * C „Zurückhaltend“ — grau, keine Empfehlung.
 */
export type NowStage = "A" | "B" | "C";

export function nowStage(decide: DecideResult | null): NowStage {
  // Achtung: Der Server liefert bei einem Fehler ein Objekt ohne `primary`
  // (z. B. `{"error_code": "polling_missing"}`) — und zwar mit HTTP 200 im
  // Overview-Aggregat. Ein ungeprüfter Zugriff hier hat die ganze App
  // abstürzen lassen (leere Seite). Deshalb durchgehend optional.
  if (!decide?.primary || decide.primary.action === "no_advice") return "C";
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

/**
 * Dasselbe Wort, abgeleitet aus der gemessenen Wahrscheinlichkeit.
 *
 * Auf Stufe A zählt die Zahl: Der Server-Badge beschreibt die Streuung der
 * Empfehlungslage, nicht die Trefferwahrscheinlichkeit — beides zusammen
 * ergäbe Sätze wie „unsicher (99 %)“. Auf Stufe A kommt das Wort deshalb aus
 * dem Prozentwert, auf Stufe B (ohne Prozent) weiter aus dem Badge.
 */
export function wordFromPercent(percent: number): string {
  if (percent >= 75) return "ziemlich sicher";
  if (percent >= 55) return "eher sicher";
  return "unsicher";
}

/** Fortschritt bis zur Prozent-Anzeige (nur Stufe B, nie ein Countdown). */
export function stageProgressNote(decide: DecideResult | null): string | null {
  if (nowStage(decide) !== "B" || !decide) return null;
  const done = decide?.personal_stats?.advice?.last_30d_total ?? 0;
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
  // Nur mit echter Antwort: Ein Fehlerpayload sagt nichts über den Lernstand.
  if (!decide?.primary || decide.calibrated) return null;
  const done = decide?.personal_stats?.advice?.last_30d_total ?? 0;
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
  /** Was-wäre-wenn (§5.1): gültiger `latest_by` aus der Annahmen-Karte. */
  latestBy?: string | null;
  /** Zeitwert in €/h (0 = Auto) — wirkt nur auf den Umweg-Vergleich. */
  timeValue?: number;
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
  const badge = decide.primary?.confidence_badge;
  const percent =
    stage === "A" && decide.primary?.p_correct != null
      ? decide.primary.p_correct * 100
      : null;
  const word =
    percent != null ? wordFromPercent(percent) : confidenceWord(badge);
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
  // Ohne `primary` (Fehlerpayload) gibt es nichts zu empfehlen; die Ansicht
  // zeigt dann den Fehler- oder Einrichtungszustand.
  const p = decide?.primary;
  if (!decide || !p) return null;
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
  const window = decide?.windows_today?.[0] ?? decide?.primary?.recommended_window;
  // B7: primary.recommended_window kann auf morgen zeigen — dann heißt das
  // Label nicht „heute“, der Tag steht stattdessen im Wert.
  const windowDay = window ? dayLabel(window.start, input.now) : null;
  const windowRange = window
    ? hourRangeLabel(
        berlinHour(new Date(window.start)),
        berlinHour(new Date(window.end)),
      )
    : null;
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
          label: windowDay === "Heute" ? "Bestes Fenster heute" : "Bestes Fenster",
          // In diesem Ast existiert `window` — der Bereich ist also da.
          value:
            windowDay === "Heute"
              ? windowRange!
              : `${windowDay} · ${windowRange!}`,
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
            : `${kilometersLabel(tank.range_km)} Reichweite inkl. Reserve`,
      };

  return [here, best, reach];
}

/** Ein nächster Schritt: Satz plus Zielort — nie mehr als drei. */
export type NowStep = { id: string; text: string; target: NowTarget };

export function nowSteps(input: NowInput): NowStep[] {
  const decide = input.decide;
  if (!decide) return [];
  const steps: NowStep[] = [];

  const alt = [...(decide.alternatives_nearby ?? [])]
    .filter((a) => a.worth_it)
    .sort((a, b) => b.net_eur - a.net_eur)[0];
  if (alt) {
    steps.push({
      id: "alternative",
      text:
        `Günstigste Alternative: ${alt.name}, ` +
        `${euroPerLiter(alt.price)} — netto ${euro(alt.net_eur)} € nach ` +
        `${kilometersLabel(alt.detour_km, 1)} Umweg`,
      target: "stations",
    });
  }

  const later = decide.windows_week?.[0] ?? null;
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

/**
 * Wann der Modell-Lauf war — NICHT der Zeitpunkt dieser Antwort.
 *
 * `stats_summary.generated_at` ist die Berechnungszeit des Servers (also
 * „gerade eben“ bei jedem Refresh) und taugt nicht als Frische-Aussage. Die
 * Publikation der Engine (`rolling_picp_7d_as_of`) bzw. der Fit-Zeitpunkt
 * (`debug.fitted_at`) datieren den Lauf wirklich.
 */
export function forecastStamp(decide: DecideResult | null): string | null {
  if (!decide) return null;
  return (
    decide.quality?.rolling_picp_7d_as_of ?? decide.debug?.fitted_at ?? null
  );
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
      : "Preise — kein Stand",
  );
  parts.push(
    input.forecastAt
      ? `Prognose ${ageLabel(input.forecastAt, now)}`
      : "Prognose — kein Stand",
  );
  return { text: parts.join(" · "), tone };
}

export type NowExplanation = {
  /** Ebene 1: höchstens drei Sätze, immer Alltagssprache. */
  sentences: string[];
  /** Herkunft der Zahlen — eine Zeile, keine Formel. */
  source: string;
  /** Weg in die Tiefe: der Labor-Abschnitt, der diese Zahl beweist (§7). */
  labHint: LabHint;
};

/**
 * Ebene 1 der Erklär-Treppe (UI-NEUENTWURF §7): max. 3 Sätze, keine Formel,
 * mit Frische. Der Beweis (Ebene 2) bleibt ausdrücklich woanders.
 */
export function nowExplanation(
  input: NowInput & { pricesAt?: string | null },
): NowExplanation | null {
  const decide = input.decide;
  if (!decide?.primary) return null;
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
    ? savingPerLiterCt(decide.primary.station?.price_now, window.expected_price)
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
    labHint: labHint("sicherheit"),
  };
}

/** „18:00 Uhr“ — eine einzelne Stunde aus einem Zeitstempel (Berlin). */
function hourOnlyLabel(stamp: string): string {
  const hour = Math.floor(berlinHour(new Date(stamp)));
  return `${String(hour).padStart(2, "0")}:00 Uhr`;
}

/**
 * Der Annahmen-Hinweis der Was-wäre-wenn-Karte (§5.1): welcher Parameter
 * gibt gerade den Ausschlag, und wann kippt die Empfehlung.
 *
 * Ehrlichkeits-Grenze: Der Hinweis liest nur Server-Werte (Fenster,
 * Tank-Bewertung, Umweg-Zahlen) und benennt, was in der Antwort
 * entscheidend war — er rechnet keine eigene Physik. `null` heißt:
 * gerade gibt es nichts zu sagen (grauer Zustand ohne Empfehlung wird
 * von der Karte selbst erklärt).
 */
export function assumptionHint(input: NowInput): string | null {
  const decide = input.decide;
  const p = decide?.primary;
  if (!decide || !p) return null;

  // 1. Tankstand blockiert das Warten (A2: Physik vor Fenster) — die
  //    Server-Nachricht trägt den Grund, der Hinweis nur den Zeigefinger.
  if (decide.tank?.blocks_wait) {
    return (
      "Entscheidend ist der Tankstand: " +
      (decide.tank.message ?? "die Reserve blockiert das Warten.")
    );
  }

  // 2. Spätester Zeitpunkt gesetzt, aber kein Fenster mehr übrig — der
  //    Server hat den Horizont abgeschnitten (Konzept §4.3).
  if (input.latestBy && p.action !== "wait") {
    return (
      "Entscheidend ist der späteste Zeitpunkt — vor ihm endet kein " +
      "Fenster mehr. Später einstellen oder jetzt nach Bedarf tanken."
    );
  }

  if (p.action === "wait" && p.recommended_window) {
    // 3. Warten: der Kipp-Punkt ist der Zeitpunkt, bis zu dem man tanken
    //    MUSS — der Server zählt ein Fenster nur, wenn es vor latest_by
    //    ENDET.
    return (
      `Kippt zu „Jetzt“, wenn das Tanken vor ${hourOnlyLabel(
        p.recommended_window.end,
      )} fällig wird.`
    );
  }

  if (p.action === "refuel_now") {
    // 4. Jetzt: entweder kein günstigeres Fenster heute oder das Fenster
    //    hat keinen klaren Vorsprung — beides steht in der Antwort.
    return p.recommended_window
      ? "Entscheidend ist der Preis: das Fenster hat gegenüber dem aktuellen Preis keinen klaren Vorsprung."
      : "Entscheidend ist der Preis: heute ist kein günstigeres Fenster dabei.";
  }

  if (p.action === "refuel_elsewhere") {
    // 5. Woanders: die Umweg-Ökonomie (Server-Zahlen: Strecke, Zeitwert).
    const alt = [...(decide.alternatives_nearby ?? [])]
      .filter((a) => a.worth_it)
      .sort((a, b) => b.net_eur - a.net_eur)[0];
    if (alt) {
      const z =
        input.timeValue != null && input.timeValue > 0
          ? `${euro(input.timeValue, input.timeValue % 1 ? 1 : 0)} €/h`
          : "Automatik-Zeitwert";
      return (
        `Entscheidend ist der Umweg: ${kilometersLabel(alt.detour_km, 1)} extra, ` +
        `Zeitwert ${z} — berechnet vom Server.`
      );
    }
  }

  // 6. Grau: die Karte selbst erklärt den Zustand; der Hinweis bleibt aus.
  return null;
}

/**
 * „Was ist gerade am besten?“ — die Antwort, die auch ohne Modell trägt.
 *
 * Warum das eigener Code ist (Nutzer-Feedback 14.09.2026): In S0/S1 und in
 * jeder Stufe C stand „Jetzt“ bis dahin grau da, während die einzige sichere
 * Aussage des Tages — *welcher offene Preis gerade der günstigste ist* — nur
 * als Nebenliste im grauen Zustand auftauchte. Der Vergleich aktueller
 * Preise braucht kein Modell; er ist eine Tatsache aus dem Set.
 *
 * Ehrlichkeits-Grenzen:
 *   * Nur Stationen mit wirklich gemeldetem Preis (`price != null`).
 *   * „ct/L unter dem teuersten“ ist ein Abstand im Set, keine Prognose —
 *     deshalb heißt er auch so und wird nie „Ersparnis“ genannt.
 *   * Ohne zweiten Preis gibt es keinen Vergleich (Satz statt Zahl).
 */
export type NowBestNow = {
  /** Günstigste Station mit offenem Preis — `null` ohne frische Meldung. */
  station: Station | null;
  price: number | null;
  /** Bis zu drei Stationen, günstigste zuerst (Gleichstand bleibt stabil). */
  ranking: Array<{ station: Station; price: number }>;
  /** Teuerster − günstigster Preis im Set, in ct/L. */
  spreadCt: number | null;
  /** Was die Preisspanne auf die Tankmenge bedeutet (€). */
  spreadEur: number | null;
  /** Anzahl Stationen mit offenem Preis. */
  freshCount: number;
  /** Ein Satz, der ohne Modell gilt — nie „Ersparnis“, nie „Erwartet“. */
  sentence: string;
  mapsUrl: string | null;
};

export function nowBestNow(input: NowInput): NowBestNow {
  const fresh = input.stations
    .filter(
      (station) => station.price != null && Number.isFinite(station.price),
    )
    .map((station) => ({ station, price: station.price as number }))
    .sort((a, b) => a.price - b.price);
  const ranking = fresh.slice(0, 3);
  const best = fresh[0] ?? null;
  const worst = fresh.length > 1 ? fresh[fresh.length - 1] : null;
  const spreadCt =
    best && worst ? (worst.price - best.price) * 100 : null;
  const spreadEur =
    spreadCt !== null ? (spreadCt / 100) * input.liters : null;

  const sentence = !best
    ? "Kein offener Preis in der Sicht — mit der nächsten Preismeldung füllt sich der Vergleich."
    : !worst
      ? `Nur ${best.station.name} meldet gerade einen Preis (${euroPerLiter(best.price)}) — für einen Vergleich fehlt eine zweite Station.`
      : `${best.station.name} ist gerade am günstigsten: ${centPerLiter(spreadCt ?? 0)} unter dem teuersten Preis im Set, das sind ${euro(spreadEur ?? 0)} € bei ${deTrimmed(input.liters, 0)} L.`;

  return {
    station: best?.station ?? null,
    price: best?.price ?? null,
    ranking,
    spreadCt,
    spreadEur,
    freshCount: fresh.length,
    sentence,
    mapsUrl: best?.station.maps_url ?? null,
  };
}

/**
 * „Heute im Blick“ 2.0 (Nutzer-Feedback 14.09.2026: „zu wenig Infos“).
 *
 * Der Tagesstreifen bleibt das Bild, bekommt aber die Zahlen, die man sonst
 * im Kopf aus 18 Kästchen liest: günstigste und teuerste offene Stunde, den
 * Tagesmedian, die Spanne und die Abdeckung („x von 18 Stunden mit offener
 * Meldung“). Alles aus den Zellen selbst — keine Prognose, keine Lücke
 * geschätzt.
 */
export type NowDayPanel = {
  /** Günstigste offene Stunde (niedrigster letzter Preis des Tages). */
  best: { hour: number; value: number } | null;
  worst: { hour: number; value: number } | null;
  median: number | null;
  spreadCt: number | null;
  /** Wert der aktuellen Stunde, sonst `null`. */
  nowValue: number | null;
  /** Jetzt gegenüber dem Tagesmedian (ct/L, positiv = teurer). */
  nowVsMedianCt: number | null;
  openHours: number;
  totalHours: number;
  /** Alle offenen Stunden, die gleichauf am günstigsten sind. */
  bestHours: number[];
  worstHours: number[];
  /** „06–12 Uhr“ bei Gleichstand, sonst „06–07 Uhr“. */
  bestLabel: string;
  worstLabel: string;
  /** Mehr als eine Stunde teilt sich den Bestwert. */
  tied: boolean;
  /** Aussage-Zeile über dem Streifen. */
  headline: string;
  /** Abdeckungs-Zeile unter dem Streifen („8 von 18 Stunden mit offener Meldung“). */
  coverage: string;
};

/** Gleichstand wie bei der Heatmap-Level-Karte — 0,05 ct/L. */
const DAY_TIE_EPS = 0.0005;

function hoursTiedTo(
  open: Array<{ hour: number; value: number }>,
  target: number,
): number[] {
  return open
    .filter((cell) => Math.abs(cell.value - target) <= DAY_TIE_EPS)
    .map((cell) => cell.hour);
}

export function nowDayPanel(cells: StripCell[]): NowDayPanel {
  const open = cells.filter(
    (cell): cell is StripCell & { value: number } => cell.value !== null,
  );
  const sorted = [...open].sort((a, b) => a.value - b.value);
  const best = sorted[0]
    ? { hour: sorted[0].hour, value: sorted[0].value }
    : null;
  const worst = sorted.length > 1
    ? {
        hour: sorted[sorted.length - 1].hour,
        value: sorted[sorted.length - 1].value,
      }
    : null;
  const median = open.length
    ? [...open.map((cell) => cell.value)].sort((a, b) => a - b)[
        Math.floor(open.length / 2)
      ]
    : null;
  const nowCell = cells.find((cell) => cell.current && cell.value !== null);
  const nowValue = nowCell?.value ?? null;
  const spreadCt = best && worst ? (worst.value - best.value) * 100 : null;
  const nowVsMedianCt =
    nowValue !== null && median !== null ? (nowValue - median) * 100 : null;

  const bestHours = best ? hoursTiedTo(open, best.value) : [];
  const worstHours = worst ? hoursTiedTo(open, worst.value) : [];
  const bestLabel = hourRunsLabel(hourRunsOf(bestHours));
  const worstLabel = hourRunsLabel(hourRunsOf(worstHours));
  const tied = bestHours.length > 1;

  const headline = !best
    ? "Heute liegt noch keine offene Meldung vor."
    : worst
      ? `Am günstigsten ist es ${bestLabel} (${euroPerLiter(best.value)}) — ${centPerLiter(spreadCt ?? 0)} unter der teuersten Stunde (${worstLabel}).`
      : `Bisher nur eine offene Stunde: ${bestLabel} (${euroPerLiter(best.value)}) — für einen Tagesverlauf fehlen Messwerte.`;

  const coverage = open.length
    ? `${countLabel(open.length)} von ${countLabel(cells.length)} Stunden mit offener Meldung — leere Stunden werden nicht geschätzt.`
    : "Keine offene Meldung — das Polling-Fenster ist 06–24 Uhr.";

  return {
    best,
    worst,
    median,
    spreadCt,
    nowValue,
    nowVsMedianCt,
    openHours: open.length,
    totalHours: cells.length,
    bestHours,
    worstHours,
    bestLabel,
    worstLabel,
    tied,
    headline,
    coverage,
  };
}
