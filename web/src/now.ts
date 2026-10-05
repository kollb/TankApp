// Jetzt — die reine Logik des ersten Bereichs (docs/produkt/UI.md, Bereiche;
// docs/planung/UX-NEUENTWURF.md §3).
//
// Ein Bildschirm, **eine** Frage: „Soll ich jetzt tanken — und wenn ja, wo?“
// Die Antwortkarte trägt höchstens 25 Wörter, eine Zahl und genau eine
// Handlung. Alles andere liegt einen Tipp entfernt: das „Warum?“ -Blatt
// (höchstens fünf Zeilen) und die Tageszeile mit Kurve.
//
// Warum eine eigene Datei: Die Ansicht rendert, sie entscheidet nichts (D1).
// Alles hier ist aus Server-Zahlen ableitbar und ohne DOM prüfbar.
//
// Ehrlichkeits-Regeln, die hier durchgesetzt werden (docs/produkt/MICROCOPY.md):
//   * Prozent nur auf Stufe A (≥ 100 abgeschlossene Empfehlungen, Brier unter
//     der Schwelle). Sonst bleibt die Karte grau ohne Empfehlung — nie ein
//     Prozentwert, der nicht gemessen ist. Eine Stufe B („Worte ohne
//     Prozent, dazu Fortschritt“) gab es im Entwurf: sie war strukturell
//     unerreichbar, weil der Server ohne M7-Gate „no_advice“ erzwingt
//     (Befund A5, 23.09.2026) — Texte und Zweige dazu sind entfernt.
//   * Unsicherheit ist **ein Wort** (ziemlich/eher/kaum sicher), kein Prozent
//     und kein Balken. Wer „Warum?“ tippt, bekommt die Zählung
//     („an 26 von 30 Tagen richtig“).
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
  windowTimeRangeLabel,
  kilometersLabel,
  medianOf,
  NO_DATA_LINE,
  M7_MIN_RECOMMENDATIONS,
  percentLabel,
  timeOfDayLabel,
  type DecideResult,
  type Station,
} from "./data";
import { windowPastRegimeEdge } from "./regime";
import { labHint, type LabHint } from "./lab";
import type { StripCell } from "./strip";

/** Wohin eine Handlung der Karte führt — Ziele, nicht Tabs. */
export type NowTarget = "stations" | "week" | "tank" | "system" | "ich";

/**
 * Schnellauswahl „¼ / ½ / ¾ / voll“: Tankstand ist kein Formular, sondern
 * eine Angabe — die vier üblichen Stände in einem Tap. Gepflegt wird sie an
 * genau einem Ort („Ich“ → Fahrzeug, UX-NEUENTWURF §6); Jetzt und Woche
 * zeigen den Stand nur an.
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
 * Sicherheits-Stufe der Aussage:
 * A „Nachgewiesen“ — Worte + Prozent · C „Zurückhaltend“ — grau, keine
 * Empfehlung.
 */
export type NowStage = "A" | "C";

export function nowStage(decide: DecideResult | null): NowStage {
  // Achtung: Der Server liefert bei einem Fehler ein Objekt ohne `primary`
  // (z. B. `{"error_code": "polling_missing"}`) — und zwar mit HTTP 200 im
  // Overview-Aggregat. Ein ungeprüfter Zugriff hier hat die ganze App
  // abstürzen lassen (leere Seite). Deshalb durchgehend optional.
  // Es gibt nur zwei erreichbare Stufen: A (M7-Gate überschritten, Empfehlung
  // mit Prozent) und C (grau, kein gemessener Prozentwert). Eine Stufe B ist
  // nicht möglich: ohne Gate erzwingt der Server `no_advice` (`m7_pending`).
  if (!decide?.primary || decide.primary.action === "no_advice") return "C";
  return decide.calibrated ? "A" : "C";
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
 * dem Prozentwert, ohne Prozent weiter aus dem Badge.
 */
export function wordFromPercent(percent: number): string {
  if (percent >= 75) return "ziemlich sicher";
  if (percent >= 55) return "eher sicher";
  return "unsicher";
}

/**
 * Der Fortschritt des M7-Zähl-Gates: abgeschlossene Empfehlungen im
 * Vertragsschnitt (gate_n) gegen die Schwelle — nie das 30-Tage-Fenster
 * (Befund A3, 23.09.2026): Beide Zähler waren in den Fortschrittstexten
 * vermischt, „von 100 abgeschlossenen Empfehlungen“ zählte so je nach
 * Verlauf zu niedrig oder sprang volatil. Fallback für Alt-Payloads:
 * 30-Tage-Fenster.
 */
function m7Progress(
  decide: DecideResult,
): { done: number; need: number } | null {
  const advice = decide.personal_stats?.advice;
  if (!advice) return null;
  return {
    done: advice.gate_n ?? advice.last_30d_total ?? 0,
    need: advice.min_recommendations ?? M7_MIN_RECOMMENDATIONS,
  };
}

/**
 * Der Satz für den grauen Zustand, wenn das Modell noch nicht so weit ist
 * (S1/S2): Grund plus Zählstand — ohne Countdown-Versprechen.
 */
export function learningNote(decide: DecideResult | null): string | null {
  // Nur mit echter Antwort: Ein Fehlerpayload sagt nichts über den Lernstand.
  if (!decide?.primary || decide.calibrated) return null;
  const progress = m7Progress(decide);
  if (!progress || progress.done >= progress.need) return null;
  // Die Lernphase ist keine tote Fläche — der Preisvergleich und die
  // Umweg-Rechnung tragen sich schon mit Live-Preisen. Der Satz benennt das,
  // statt nur zu zählen.
  return (
    `Das Modell lernt noch — ${countLabel(progress.done)} von ` +
    `${countLabel(progress.need)} abgeschlossenen Empfehlungen. ` +
    "Vergleich und Umweg-Rechnung funktionieren bereits."
  );
}

export type NowInput = {
  decide: DecideResult | null;
  stations: Station[];
  /** Ausgewählte Station („Jetzt hier“) — sonst die günstigste frische. */
  selectedId?: string;
  liters: number;
  now?: number;
  /** Verbindung des Geräts: ohne Netz trägt die Karte den letzten Stand. */
  online?: boolean;
  /** Jüngste Preismeldung — der Frische-Chip im Kopf nennt ihr Alter. */
  pricesAt?: string | null;
  /** Stand des Modell-Laufs (`forecastStamp`). */
  forecastAt?: string | null;
};

/**
 * Ab diesem Betrag unterscheidet die Karte „jetzt“ von „später“. Darunter
 * sind die Preise des Tages praktisch gleich — dann lautet die Antwort
 * „Tanken, wann’s passt“ statt einer Empfehlung, die niemand merkt
 * (UX-NEUENTWURF §3, Variante „Kaum Unterschied“).
 */
export const ANYTIME_SAVING_EUR = 0.5;

/** Die fünf Lagen der Antwortkarte (UX-NEUENTWURF §3). */
export type NowVariant =
  | "refuel_now"
  | "wait"
  | "anytime"
  | "no_forecast"
  | "offline";

/**
 * Die Antwortkarte: ein Wort, ein Satz, eine Zahl, eine Handlung.
 * Höchstens 25 Wörter insgesamt — was darüber hinausgeht, gehört in das
 * „Warum?“ -Blatt (Ebene 2).
 */
export type NowAnswer = {
  variant: NowVariant;
  /** Urteilston der Karte (UI.md: Grün = handeln, Blau = warten, Rot =
   *  Tankrest-Risiko, Grau = ehrlich unentschieden). */
  tone: "green" | "blue" | "red" | "gray";
  /** Ein Wort über der Headline. */
  chip: string;
  /** Die Antwort selbst — „Jetzt tanken“, „Warten bis ~19 Uhr“. */
  headline: string;
  /** Die eine Zahl der Karte: € (Ersparnis) oder €/L (Preis). */
  lead: string | null;
  /** Höchstens ein kurzer Zusatz unter der Zahl (Station, Stand). */
  subline: string | null;
  /** Genau eine primäre Handlung — sonst `null`. */
  action: { label: string; mapsUrl: string } | null;
  /** „bis 17:45“ in kleiner Schrift — nur bei freigegebener Aktion. */
  validUntil: string | null;
  /** `true`, wenn die Freigabe abgelaufen ist (offene Seite, gecachte
   *  Antwort): die Karte zeigt dann die Tatsache, nicht die alte Aktion. */
  expired: boolean;
};

/** „~19 Uhr“ — die genannte Stunde eines Fensterbeginns (Berlin). */
export function hourApproxLabel(stamp: string): string | null {
  const ms = Date.parse(stamp);
  if (!Number.isFinite(ms)) return null;
  const hour = Math.floor(berlinHour(new Date(ms)));
  if (!Number.isFinite(hour)) return null;
  return `~${String(hour).padStart(2, "0")} Uhr`;
}

/** „JET · 1,2 km“ — Station und Entfernung, beides nur wenn bekannt. */
function stationLine(station: Station | null): string | null {
  if (!station) return null;
  const parts: string[] = [station.name].filter(Boolean);
  const dist = station.dist_km;
  if (dist != null && Number.isFinite(dist)) {
    parts.push(kilometersLabel(dist, 1));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Die beste Alternative mit Umweg-Vorteil — sonst `null` (wie `nowNetBest`). */
function bestAlternative(decide: DecideResult | null) {
  return [...(decide?.alternatives_nearby ?? [])]
    .filter((alt) => alt.worth_it)
    .sort((a, b) => b.net_eur - a.net_eur)[0] ?? null;
}

/**
 * O45: Der UI-Betrag aus derselben Basis wie der Preis daneben — dem
 * Medianpreis des Fensters (`expected_saving_median_eur`). Fenster zeigen
 * `expected_price` €/L; das separate Draw-Potenzial aus den Fensterminima
 * (`expected_saving_eur`) ist keine arithmetische Erwartung und wird nur mit
 * seiner eigenen Bezeichnung gezeigt. Alte Antworten ohne das Feld fallen zurück.
 */
export function windowSavingEur(window: {
  expected_saving_eur: number | null;
  expected_saving_median_eur?: number | null;
}): number | null {
  return window.expected_saving_median_eur ?? window.expected_saving_eur;
}

/** Erwartete Ersparnis in ct/L, wenn beide Preise bekannt sind. */
export function savingPerLiterCt(
  priceNow: number | null | undefined,
  expected: number | null | undefined,
): number | null {
  if (priceNow == null || expected == null) return null;
  if (!Number.isFinite(priceNow) || !Number.isFinite(expected)) return null;
  return (priceNow - expected) * 100;
}

/**
 * Die Antwortkarte (UX-NEUENTWURF §3). `null` heißt: es gibt noch nichts zu
 * sagen (Lade-, Leer- oder Einrichtungszustand).
 *
 * Rangfolge der Lagen: offline schlägt alles — ohne Netz zählt der Preis an
 * der Säule, nicht die letzte Empfehlung. Danach entscheidet der Server:
 * eine freigegebene Aktion trägt die Karte, sonst trägt sie die Tatsache
 * („Günstigste gerade: …“).
 */
export function nowAnswer(input: NowInput): NowAnswer | null {
  const decide = input.decide;
  const p = decide?.primary ?? null;
  const best = nowBestNow(input);
  /** Die Station der Handlung: die günstigste offene, sonst die der Empfehlung. */
  const station = best.station;
  const stationName = station?.name ?? p?.station?.name ?? null;
  const mapsUrl = station?.maps_url ?? p?.station?.maps_url ?? null;
  const price = best.price ?? p?.station?.price_now ?? null;

  // ① Offline: der letzte bekannte Stand — die Säule entscheidet.
  if (input.online === false) {
    return {
      variant: "offline",
      tone: "gray",
      chip: "Offline",
      headline: stationName ? `Letzter Stand: ${stationName}` : "Letzter Stand",
      lead: price != null ? euroPerLiter(price) : null,
      subline: "Der Preis an der Säule zählt.",
      action: null,
      validUntil: null,
      expired: false,
    };
  }

  const nowMs = input.now ?? Date.now();
  const validUntil = decide?.valid_until ?? null;
  const expired =
    p !== null &&
    p.action !== "no_advice" &&
    validUntil !== null &&
    Number.isFinite(Date.parse(validUntil)) &&
    Date.parse(validUntil) <= nowMs;

  // ② Keine freigegebene Aktion: die Tatsache statt eines Urteils.
  if (!p || expired || p.action === "no_advice") {
    if (!stationName || price == null) return null;
    const stand = timeOfDayLabel(input.pricesAt ?? null);
    return {
      variant: "no_forecast",
      tone: "gray",
      chip: "Preisvergleich",
      headline: `Günstigste gerade: ${stationName}`,
      lead: euroPerLiter(price),
      subline: stand ? `Stand ${stand} Uhr` : null,
      action: mapsUrl ? { label: "Route", mapsUrl } : null,
      validUntil: null,
      expired,
    };
  }

  const window = p.recommended_window ?? null;
  /**
   * O45: Die Ersparnis kommt aus derselben Basis wie der angezeigte
   * Fensterpreis — aus dem Median der Primär-Antwort. Das Fensterobjekt
   * selbst trägt keine Ersparnis (`recommended_window`).
   */
  const saving = p.expected_saving_median_eur ?? p.expected_saving_eur;
  const litersText = deTrimmed(input.liters, 0);

  // ③ Warten — und nur, wenn der Vorsprung spürbar ist (sonst ④).
  if (p.action === "wait" && window) {
    const hour = hourApproxLabel(window.start);
    if (saving != null && saving > ANYTIME_SAVING_EUR) {
      return {
        variant: "wait",
        tone: "blue",
        chip: "Warten",
        headline: hour ? `Warten bis ${hour}` : "Warten lohnt sich",
        lead: `spart ca. ${euro(saving)} €`,
        subline: `bei ${litersText} L`,
        action: mapsUrl ? { label: "Route", mapsUrl } : null,
        validUntil: validUntil,
        expired: false,
      };
    }
    // Kaum Unterschied: die Preise des Tages liegen beieinander.
    return {
      variant: "anytime",
      tone: "gray",
      chip: "Kaum Unterschied",
      headline: "Tanken, wann’s passt",
      lead: price != null ? euroPerLiter(price) : null,
      subline: "Die Preise liegen heute fast gleichauf.",
      action: mapsUrl ? { label: "Route", mapsUrl } : null,
      validUntil: validUntil,
      expired: false,
    };
  }

  // ④ Jetzt tanken — an der empfohlenen oder der netto besseren Station.
  const alt = p.action === "refuel_elsewhere" ? bestAlternative(decide) : null;
  const targetStation =
    alt && alt.maps_url
      ? { name: alt.name, mapsUrl: alt.maps_url }
      : mapsUrl
        ? { name: stationName ?? "Station", mapsUrl }
        : null;
  const detourKm = alt ? (alt.detour_km_est ?? alt.detour_km ?? null) : null;
  return {
    variant: "refuel_now",
    // Rot bleibt dem einen echten Risiko vorbehalten: der Tankrest blockiert
    // das Warten. „Warten“ ist blau, „jetzt handeln“ grün (UI.md).
    tone: decide?.tank?.blocks_wait ? "red" : "green",
    chip: "Jetzt tanken",
    headline: "Jetzt tanken",
    lead: alt ? euroPerLiter(alt.price) : price != null ? euroPerLiter(price) : null,
    subline: alt
      ? [
          alt.name,
          detourKm != null ? `${kilometersLabel(detourKm, 1)} Umweg` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : stationLine(station),
    action: targetStation
      ? { label: "Route", mapsUrl: targetStation.mapsUrl }
      : null,
    validUntil,
    expired: false,
  };
}

/**
 * Gültigkeit in kleiner Schrift (`bis 17:45`), nie für Ablehnungen und nie
 * für eine abgelaufene Freigabe (A21-B1.4).
 */
export function nowValidity(
  answer: Pick<NowAnswer, "expired" | "validUntil" | "variant"> | null,
  now = Date.now(),
): { label: string; endingSoon: boolean } | null {
  if (!answer || answer.expired || !answer.validUntil) return null;
  const remaining = Date.parse(answer.validUntil) - now;
  const time = timeOfDayLabel(answer.validUntil);
  if (!Number.isFinite(remaining) || remaining <= 0 || !time) return null;
  const endingSoon = remaining <= 30 * 60000;
  return {
    label:
      `bis ${time}` +
      (endingSoon ? ` · noch ${countLabel(Math.ceil(remaining / 60000))} min` : ""),
    endingSoon,
  };
}

/**
 * Das „Warum?“ -Blatt (Ebene 2): höchstens fünf Zeilen, keine Formel, keine
 * Fachwörter. Der Beweis (Ebene 3) bleibt das Labor — der Weg dorthin steht
 * in `labHint`.
 */
export type NowWhy = {
  /** Höchstens fünf Zeilen: Fenster, Ersparnis, Sicherheit, Tank, Stand. */
  lines: string[];
  /** Herkunft der Zahlen — eine Zeile, keine Formel. */
  source: string;
  /** Weg in die Tiefe: der Labor-Abschnitt, der diese Zahl beweist (§7). */
  labHint: LabHint | null;
};

export function nowWhy(input: NowInput): NowWhy | null {
  const decide = input.decide;
  if (!decide?.primary) return null;
  const stage = nowStage(decide);
  const p = decide.primary;
  const window = decide.windows_today?.[0] ?? p.recommended_window ?? null;
  const lines: string[] = [];

  // 1 · Fenster
  lines.push(
    window
      ? `Fenster ${windowTimeRangeLabel(window.start, window.end)} — erwartet ${euroPerLiter(window.expected_price)}.`
      : "Für heute liegt kein Fenster mit Vorsprung vor — der Vergleich der aktuellen Preise bleibt.",
  );

  // 2 · Ersparnis (€, mit Liter; hinter einem Stichtag nicht belastbar)
  const pastEdge = window
    ? windowPastRegimeEdge(window, decide.regime_notice)
    : false;
  /** O45: dieselbe Basis wie die Karte — der Medianbetrag der Primär-Antwort. */
  const saving = p.expected_saving_median_eur ?? p.expected_saving_eur;
  const priceNow = p.station?.price_now ?? null;
  const deltaCt =
    window && priceNow != null
      ? savingPerLiterCt(priceNow, window.expected_price)
      : null;
  if (pastEdge) {
    lines.push(
      "Zwischen jetzt und dem Fenster liegt ein Preisniveau-Termin — ein Abstand wäre nicht belastbar.",
    );
  } else if (saving != null && saving > 0) {
    lines.push(
      `Bei ${deTrimmed(input.liters, 0)} L spart das ca. ${euro(saving)} €` +
        (deltaCt != null && deltaCt > 0
          ? ` (${centPerLiter(deltaCt)} je Liter).`
          : "."),
    );
  } else if (deltaCt != null && deltaCt < -0.05) {
    lines.push(
      `Der aktuelle Preis liegt ${centPerLiter(Math.abs(deltaCt))} unter dem Fensterpreis — Warten wäre teurer.`,
    );
  } else {
    lines.push("Das Fenster hat gegenüber dem aktuellen Preis keinen Vorsprung.");
  }

  // 3 · Sicherheit: ein Wort, dazu die Zählung (kein Prozent im Hauptsatz)
  const percent =
    stage === "A" && p.p_correct != null ? Math.round(p.p_correct * 100) : null;
  const word =
    percent != null ? wordFromPercent(percent) : confidenceWord(p.confidence_badge);
  const advice = decide.personal_stats?.advice;
  if (stage === "A" && advice?.last_30d_total) {
    // Befund A3 (23.09.2026): Trefferzahl mit halben Unentschieden — exakt
    // dieselbe Abrechnung wie die Prozentzahl im Labor (`hit_rate` zählt
    // „tie“ × 0,5). Sonst nannte der Satz Zähler und Quote zweier
    // verschieden gearteter Ereignisse.
    const hits = advice.last_30d_hits + (advice.last_30d_ties ?? 0) / 2;
    lines.push(
      `${word ?? "unsicher"} — an ${deTrimmed(hits, hits % 1 ? 1 : 0)} von ${countLabel(advice.last_30d_total)} Tagen richtig` +
        (percent != null ? ` (${percentLabel(percent, 0)})` : "") +
        ".",
    );
  } else {
    lines.push(
      word ??
        "Noch nicht messbar — die App sagt erst etwas zur Sicherheit, wenn sie abgerechnete Empfehlungen hat.",
    );
  }

  // 4 · Tank — nur, wenn er die Entscheidung wirklich trägt
  if (decide.tank?.blocks_wait) {
    lines.push(decide.tank.message ?? "Die Reserve reicht nicht bis zum Fenster.");
  }

  // 5 · Stand — was die Zahlen sind und wie alt sie sind
  const coverage = nowCoverage(input.stations, input.pricesAt, input.now);
  const age = input.pricesAt ? ageLabel(input.pricesAt, input.now) : null;
  lines.push(
    [coverage.line, age ? `Preise ${age}` : null].filter(Boolean).join(" · "),
  );

  return {
    lines: lines.slice(0, 5),
    source: input.pricesAt
      ? `Grundlage: die geladenen Preismeldungen der beobachteten Stationen, jüngste ${age}.`
      : "Grundlage: die geladenen Preismeldungen der beobachteten Stationen.",
    labHint: labHint("sicherheit"),
  };
}

/**
 * Die Tageszeile (UX-NEUENTWURF §3): eine Zeile mit Mini-Kurve und Tiefpunkt.
 * Wer tippt, bekommt die Kurve, den Tiefpunkt und den aktuellen Preis als
 * Zahlen — mehr steht auf der Startseite nicht.
 */
export type NowDayRow = {
  /** 06–24 Uhr; `value === null` = leere Stunde (nichts geschätzt). */
  cells: Array<{ hour: number; value: number | null; current: boolean }>;
  /** Tiefster Stundenwert des Tages (gemessen). */
  low: { hour: number; value: number } | null;
  /** Letzter Preis der aktuellen Stunde. */
  now: number | null;
  /** Tagesmedian der offenen Stunden — Vergleichslinie der Kurve. */
  median: number | null;
  /** Die Zeile selbst: „Tief ~19 Uhr“ — „—“ ohne Messwerte. */
  label: string;
  /** Ein Satz zur Kurve (Ebene 2). */
  sentence: string;
  /** Abdeckung: „12 von 19 Stunden mit offener Meldung“. */
  coverage: string;
};

export function nowDayRow(cells: StripCell[]): NowDayRow | null {
  const open = cells.filter(
    (cell): cell is StripCell & { value: number } => cell.value !== null,
  );
  // Ohne Messung keine Zeile: Eine leere Kurve behauptet einen Verlauf, den
  // es nicht gibt (§8: leere Stunden bleiben leer).
  if (open.length === 0) return null;
  const sorted = [...open].sort((a, b) => a.value - b.value);
  const low = sorted[0] ? { hour: sorted[0].hour, value: sorted[0].value } : null;
  const median = medianOf(open.map((cell) => cell.value));
  const nowCell = cells.find(
    (cell) => cell.current && (cell.latest !== null || cell.value !== null),
  );
  const now = nowCell?.latest ?? nowCell?.value ?? null;
  const lowHour = low
    ? `~${String(low.hour).padStart(2, "0")} Uhr`
    : null;

  const label = lowHour ? `Tief ${lowHour}` : "Noch keine Messung";
  const sentence = !low
    ? "Heute liegt noch keine offene Meldung vor — das Polling-Fenster ist 06–24 Uhr."
    : [
        `Tiefster Preis heute ${lowHour} mit ${euroPerLiter(low.value)}`,
        now != null ? `jetzt ${euroPerLiter(now)}` : null,
      ]
        .filter(Boolean)
        .join(" — ") + ".";
  const coverage = open.length
    ? `${countLabel(open.length)} von ${countLabel(cells.length)} Stunden mit offener Meldung — leere Stunden bleiben leer.`
    : "Noch keine offene Stunde — leere Stunden werden nicht geschätzt.";

  return {
    cells: cells.map((cell) => ({
      hour: cell.hour,
      value: cell.value,
      current: cell.current,
    })),
    low,
    now,
    median,
    label,
    sentence,
    coverage,
  };
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
 * „gerade eben“ bei jedem Refresh) und taugt nicht als Frische-Aussage. Der
 * Fit-Zeitpunkt der Veröffentlichung (`debug.fitted_at` = `origin` der
 * Publikation, siehe `app/refresh.py`) datiert den Lauf wirklich. Nur wenn
 * die Antwort ihn nicht mitliefert, bleibt der Stand des Rolling-Fensters
 * (`rolling_picp_7d_as_of`) — der ist ein reiner Kalendertag und las die
 * Fußzeile „Prognose vor 1 Tag“, obwohl der Lauf Minuten zurücklag
 * (Befund 25.09.2026, siehe `now.test.ts`).
 */
export function forecastStamp(decide: DecideResult | null): string | null {
  if (!decide) return null;
  return decide.debug?.fitted_at ?? decide.quality?.rolling_picp_7d_as_of ?? null;
}

export type NowFreshness = {
  /** Die Fußzeile: „Preise vor 4 Minuten · Prognose vor 35 Minuten“. */
  text: string;
  /** Der Chip im Kopf: „vor 4 Minuten“ — oder „alt“, wenn es zu lange her ist. */
  chip: string;
  tone: "ok" | "warn" | "bad";
};

/**
 * Die Frische: ein Chip im Kopf (`vor 4 Minuten` / `alt`), keine Fußzeile je
 * Bereich (UX-NEUENTWURF §6, „ein Ort pro Sache“). Dieselben Schwellen wie
 * `dataAgeNote`.
 */
export function nowFreshness(input: {
  pricesAt?: string | null;
  forecastAt?: string | null;
  now?: number;
}): NowFreshness {
  const now = input.now ?? Date.now();
  if (!input.pricesAt && !input.forecastAt) {
    return { text: NO_DATA_LINE, chip: "kein Stand", tone: "warn" };
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
      : "Preise ohne Stand",
  );
  parts.push(
    input.forecastAt
      ? `Prognose ${ageLabel(input.forecastAt, now)}`
      : "Prognose ohne Stand",
  );
  const chip =
    prices === "old"
      ? "alt"
      : input.pricesAt
        ? ageLabel(input.pricesAt, now)
        : "kein Stand";
  return { text: parts.join(" · "), chip, tone };
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
 *   * **O19 — die Ersparnis rechnet gegen die Entscheidung, nicht gegen die
 *     teuerste Station.** Bis 0.49.0 stand hier „X ct/L unter dem teuersten
 *     Preis im Set, das sind Y €“: wahr, aber gegen eine Referenz, die
 *     niemand wählt. Die persönliche Zahl rechnet gegen denselben Anker, den
 *     die Empfehlung selbst nutzt (`ref_nowcast` = Jetzt-Preis der
 *     Entscheidungs-Station, `app/pside.py::p_lohnt`), und die Referenz steht
 *     im Satz. Die Spanne „günstigste bis teuerste“ bleibt daneben stehen —
 *     als Spanne, benannt als solche, nie als Ersparnis.
 *   * Ohne zweiten Preis gibt es keinen Vergleich (Satz statt Zahl); ohne
 *     Entscheidungs-Anker gibt es keine persönliche Ersparnis, nur die Spanne.
 */
export type NowBestNow = {
  /** Günstigste Station mit offenem Preis — `null` ohne frische Meldung. */
  station: Station | null;
  price: number | null;
  /** Bis zu drei Stationen, günstigste zuerst (Gleichstand bleibt stabil). */
  ranking: Array<{ station: Station; price: number }>;
  /**
   * O19: Wogegen die Ersparnis gerechnet ist. `nowcast` = der Preis, den die
   * Empfehlung für „jetzt tanken“ ansetzt; `none` = keine Empfehlung, also
   * keine persönliche Zahl (die Spanne bleibt).
   */
  reference: {
    kind: "nowcast" | "none";
    station: string | null;
    price: number | null;
  };
  /** Ersparnis gegen die Referenz in ct/L — `null` ohne Referenz. */
  saveCt: number | null;
  /** Dieselbe Ersparnis auf die Tankmenge (€). */
  saveEur: number | null;
  /** Günstigster − teuerster Preis unter den Stationen mit offenem
   * Preis, in ct/L (eine Spanne). */
  spreadCt: number | null;
  /** Was die Preisspanne auf die Tankmenge bedeutet (€). */
  spreadEur: number | null;
  /** Anzahl Stationen mit offenem Preis. */
  freshCount: number;
  /**
   * Ein Satz, der ohne Modell gilt — nie „Erwartet“, Referenz benannt.
   * `null`, wenn die Karte dieselbe Information schon kompakter zeigt
   * (B4, Befund UX/Mathe 2026-09-19).
   */
  sentence: string | null;
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
  const spreadCt = best && worst ? (worst.price - best.price) * 100 : null;
  const spreadEur =
    spreadCt !== null ? (spreadCt / 100) * input.liters : null;

  // O19: Referenz = der Anker der Empfehlung („jetzt tanken“ an der
  // gewählten Station). Dieselbe Größe, gegen die `p_lohnt` rechnet — damit
  // neben einer netto gerechneten Entscheidung keine brutto gegen den
  // Maximalwert gerechnete Zahl steht.
  const anchor = input.decide?.primary?.station ?? null;
  const anchorPrice =
    anchor && Number.isFinite(anchor.price_now ?? Number.NaN)
      ? (anchor.price_now as number)
      : null;
  const reference: NowBestNow["reference"] =
    best && anchorPrice !== null
      ? { kind: "nowcast", station: anchor?.name || null, price: anchorPrice }
      : { kind: "none", station: null, price: null };
  const saveCt =
    best && anchorPrice !== null ? (anchorPrice - best.price) * 100 : null;
  const saveEur = saveCt !== null ? (saveCt / 100) * input.liters : null;

  const litersText = deTrimmed(input.liters, 0);
  // B4 (Befund UX/Mathe 2026-09-19, §1.4.1): Ohne Empfehlungs-Anker trägt der
  // Satz keine eigene Information mehr — „am günstigsten (Preis)“ steht in
  // Headline und Betrag. Solange die Empfehlung einen Anker setzt, bleibt der
  // Satz: Er benennt die Referenz und die persönliche Ersparnis (O19).
  const sentence: string | null = !best
    ? "Kein offener Preis in der Sicht — mit der nächsten Preismeldung füllt sich der Vergleich."
    : !worst
      ? `Nur ${best.station.name} meldet gerade einen Preis (${euroPerLiter(best.price)}) — für einen Vergleich fehlt eine zweite Station.`
      : saveCt === null
        ? null
        : saveCt <= 0.05
          ? anchor && best.station.station_id === anchor.id
            ? `${best.station.name} ist gerade am günstigsten (${euroPerLiter(best.price)}) — und zugleich der Preis, den die Empfehlung für „jetzt tanken“ ansetzt.`
            : `${best.station.name} ist gerade am günstigsten (${euroPerLiter(best.price)}) — aber nicht unter dem Preis, den die Empfehlung für „jetzt tanken“ ansetzt (${reference.station ?? "gewählte Station"}, ${euroPerLiter(anchorPrice)}).`
          : `${best.station.name} ist gerade am günstigsten: ${centPerLiter(saveCt)} unter dem Preis, den die Empfehlung für „jetzt tanken“ ansetzt (${reference.station ?? "gewählte Station"}, ${euroPerLiter(anchorPrice)}) — das sind ${euro(saveEur ?? 0)} € bei ${litersText} L.`;

  return {
    station: best?.station ?? null,
    price: best?.price ?? null,
    ranking,
    reference,
    saveCt,
    saveEur,
    spreadCt,
    spreadEur,
    freshCount: fresh.length,
    sentence,
    mapsUrl: best?.station.maps_url ?? null,
  };
}

/**
 * Abdeckung des Preisvergleichs: „12 von 15 beobachteten Stationen mit
 * frischem Preis“ — plus Preisalter der frischesten Meldung.
 * Die App hat bewusst keine freie Umgebungssuche; der Satz benennt das
 * beobachtete Set, nie eine vollständige Marktdeckung.
 */
export type NowCoverage = {
  total: number;
  fresh: number;
  /** „12 von 15 beobachteten Stationen mit frischem Preis“ (o.ä.). */
  line: string;
  /** Preisalter der entscheidenden Meldungen („Preise vor 4 Minuten“). */
  ageLine: string | null;
};

export function nowCoverage(
  stations: Station[],
  pricesAt: string | null | undefined,
  now: number = Date.now(),
): NowCoverage {
  const total = stations.length;
  const fresh = stations.filter(
    (station) => station.price != null && Number.isFinite(station.price),
  ).length;
  const line =
    total === 0
      ? "Noch keine Station eingerichtet"
      : fresh === 0
        ? `0 von ${countLabel(total)} beobachteten Stationen mit frischem Preis`
        : `${countLabel(fresh)} von ${countLabel(total)} beobachteten Stationen mit frischem Preis`;
  const ageLine = pricesAt ? `Preise ${ageLabel(pricesAt, now)}` : null;
  return { total, fresh, line, ageLine };
}

/**
 * Netto-Vergleich für die Fahrt (F2): günstigster Preis vs. netto günstigste
 * Wahl vs. nicht sinnvoll vergleichbar. Die Umweg-Ökonomie kommt vom Server
 * (`alternatives_nearby[].worth_it`, `net_eur`) — die GUI sortiert nur und
 * benennt das Ergebnis.
 *
 * Er steht **nicht** auf der Karte (Ebene 1 zeigt eine Antwort), sondern
 * dort, wo er die Antwort prüft: im „Warum?“ -Blatt. Was der Antwort
 * widerspricht, bleibt sichtbar — nur nicht im Weg.
 */
export type NowNetBest =
  | {
      kind: "net";
      name: string;
      netEur: number;
      detourKm: number | null;
      text: string;
    }
  | { kind: "same"; name: string; text: string }
  | { kind: "none_worth"; cheapestName: string | null; text: string }
  | { kind: "not_comparable"; text: string };

export function nowNetBest(input: NowInput): NowNetBest {
  const cheapest = [...input.stations]
    .filter((s) => s.price != null && Number.isFinite(s.price))
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0];
  const alternatives = input.decide?.alternatives_nearby ?? [];
  const best = [...alternatives]
    .filter((a) => a.worth_it)
    .sort((a, b) => b.net_eur - a.net_eur)[0];
  if (best) {
    if (cheapest && best.name === cheapest.name) {
      return {
        kind: "same",
        name: best.name,
        text: `${best.name} ist auch netto die günstigste Wahl.`,
      };
    }
    const detour = best.detour_km_est ?? best.detour_km ?? null;
    const detourText =
      detour !== null ? ` trotz ${kilometersLabel(detour, 1)} Umweg` : "";
    return {
      kind: "net",
      name: best.name,
      netEur: best.net_eur,
      detourKm: detour,
      text:
        `Für diese Fahrt am günstigsten: ${best.name}, netto ${euro(best.net_eur)} € ` +
        `günstiger${detourText}`,
    };
  }
  if (alternatives.length > 0) {
    return {
      kind: "none_worth",
      cheapestName: cheapest?.name ?? null,
      text: cheapest
        ? `Keine Alternative lohnt den Umweg — günstigste bekannte Station bleibt ${cheapest.name}.`
        : "Keine Alternative lohnt den Umweg.",
    };
  }
  return {
    kind: "not_comparable",
    text: "Nicht sinnvoll vergleichbar — Profil- oder Routendaten fehlen.",
  };
}
