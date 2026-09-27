// Jetzt — der Tank-Kompass (docs/produkt/UI.md, Bereiche).
//
// Feste Reihenfolge, nie anders:
//   ① Entscheidung (genau eine Karte, volle Breite, vier Ausgänge)
//   ② Drei Fakten (Jetzt hier · Bestes Fenster heute · Tank reicht?)
//   ③ Nächste Schritte (höchstens drei Zeilen)
//   ④ Heute im Blick (kompakter Tagesstreifen) — darunter die
//      Frische-Fußzeile
//
// Die View rendert, sie entscheidet nichts (D1): Ausgänge, Fakten,
// Schritte, Frische, Begründung und der Annahmen-Hinweis kommen aus
// `now.ts` und sind dort getestet.
//
// Was-wäre-wenn wohnt in der Karte (§5.1): Liter, spätester Zeitpunkt
// und Zeitwert ändern die Empfehlung live — über denselben
// `/api/v1/overview`-Aufruf mit anderen Parametern (kein zweiter Poll,
// der Server bleibt die einzige Quelle). Die Schnellauswahl „¼ / ½ /
// ¾ / voll“ macht den Tankstand zum Fakt (Fakt Nr. 3), kein Formular.

import { useEffect, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Clock,
  Compass,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { BenefitWidget } from "../components/BenefitWidget";
import { BottomSheet } from "../components/BottomSheet";
import { GuideBanner } from "../components/GuideBanner";
import { GuideConfidence } from "../components/GuideConfidence";
import { HourBars } from "../components/HourBars";
import { FreshnessLine } from "../components/FreshnessLine";
import { Level1Sheet } from "../components/Level1Sheet";
import { LoadError } from "../components/LoadError";
import { SkeletonPanel } from "../components/Skeleton";
import { panel, radius } from "../components/ui";
import {
  centPerLiter,
  deTrimmed,
  euro,
  euroPerLiter,
  timeOfDayLabel,
  PROFILE_BOUNDS,
  type DecideResult,
  type ResourceState,
  type Station,
} from "../data";
import {
  guideBenefit,
  guideLevel,
  guideTone,
  hourlyOutlook,
} from "../guide";
import {
  assumptionHint,
  learningNote,
  nowBestNow,
  nowCoverage,
  nowDayPanel,
  nowExplanation,
  nowFacts,
  nowFreshness,
  nowNetBest,
  nowSteps,
  nowVerdict,
  nowValidity,
  savingPerLiterCt,
  TANK_QUICK,
  timeInputToBerlinIso,
  windowMarks,
  type NowTarget,
} from "../now";
import type { LabSectionId } from "../lab";
import { stripBandNote, type StripBand, type StripCell } from "../strip";

/** Was-wäre-wenn-Zustand der Karte (local, kein Setting). */
export type NowAssumptions = {
  /** null = Profil-/Default-Wert. */
  liters: number | null;
  /** ISO-Zeitstempel (Europe/Berlin) oder null. */
  latestBy: string | null;
  /** €/h; 0 = Auto. null = Profil-/Default-Wert. */
  timeValue: number | null;
};

export const EMPTY_ASSUMPTIONS: NowAssumptions = {
  liters: null,
  latestBy: null,
  timeValue: null,
};

export interface JetztViewProps {
  activeCity: string;
  /** Effektive Liter (Override oder Default) — für Karte und Fakten. */
  liters: number;
  /** Effektiver Zeitwert (Override oder Default). */
  timeValue: number;
  /** Was die Uhrzeit-Automatik ergäbe — Grundlage jeder „Auto“-Aussage. */
  autoZ: { z: number; isPeak: boolean };
  decideRes: ResourceState<DecideResult>;
  stations: Station[];
  selectedId: string;
  stripCells: StripCell[];
  /**
   * O20: Tonlagen-Skala des Streifens (Server-Band über 7 Tage). `null` =
   * zu dünner Bestand — die Zellen zeigen Zahlen ohne Farburteil.
   */
  stripBand: StripBand | null;
  /** Jüngste Preismeldung — die Fußzeile nennt das Alter. */
  pricesAt: string | null;
  /**
   * Verbindung des Geräts (`navigator.onLine`). Ohne Verbindung fällt der
   * Guide auf Stufe 3 („Offline“) zurück — Banner, gedämpfte Preise und
   * die Faustregel. `undefined` gilt als online (Tests, erste Frames).
   */
  online?: boolean;
  forecastAt: string | null;
  /** Ziele des Neuentwurfs — jetzt echte Bereiche. */
  onNavigate: (target: NowTarget) => void;
  /** Ebene 2 ansteuern: der Labor-Abschnitt, der diese Zahl beweist (§7). */
  onDeepen: (section: LabSectionId) => void;
  onRetry: () => void;
  /** Was-wäre-wenn: gültiger Override + aktive Werte. */
  assumptions: NowAssumptions;
  defaultLiters: number;
  defaultTimeValue: number;
  onAssumptions: (patch: Partial<NowAssumptions>) => void;
  onAssumptionsReset: () => void;
  /** Tankstand (A2): Schnellauswahl hier, Pflege in „Woche“. */
  tankPercent: number | null;
  onTankQuick: (percent: number | null) => void;
  /** Due-Prompt nach Fensterende (übernommen aus dem Alltagstab). */
  dueEpisode: any;
  dueDismissed: boolean;
  /**
   * O17: frischer Live-Preis der empfohlenen Station — genau der Preis, den
   * „Ja, wie empfohlen“ bucht. `null` ohne Live-Preis: Dann ist der Knopf
   * aus und die Maske fragt nach (nie der Prognose-Median).
   */
  dueFillPrice: number | null;
  onConfirmRecommended: (ep: any) => void;
  onDismissDue: (epId?: string) => void;
  /** Beleg manuell buchen → Ich → Belege (Station vorgemerkkt). */
  onOpenFills: () => void;
  /** Intents (M7-Feedback-Schleife): wait/navigate/refuel_now/dismiss. */
  onIntent: (intent: string, mapsUrl?: string | null) => void;
  /** Nur für Tests; sonst Date.now(). */
  now?: number;
}

/*
 * Urteilstöne (GUI v2, Material You): Grün = jetzt handeln, Blau =
 * warten bis Fenster, Rot = echtes Risiko (Tankrest blockiert das
 * Warten), Grau = ehrlich unentschieden. Die Flächen kommen aus den
 * M3-Rollen in styles.css (Container + On-Container): Primary-Container
 * für „jetzt“, Tertiary-Container für „warten“, Error-Container nur
 * fürs Tankrest-Risiko, die neutrale Karte ist eine Outlined Card —
 * exakt die Farbwelt der Vorlage (sample/good gui). „Rot bleibt dem
 * Tankrest“ gilt weiter (CHANGELOG): Warten ist hier blau.
 *
 * STRONG_TONE/SUB_TONE sind die Texttöne AUF diesen Flächen: die
 * Pastell-Token (-100) sind pro Thema als On-Container-Ton bzw.
 * dunkler Pedant gemappt — dadurch trägt dieselbe Klasse hell wie
 * dunkel den passenden Text.
 */
const CARD_TONE = {
  green: "m3-now elev-1",
  blue: "m3-relaxed elev-1",
  red: "m3-wait elev-1",
  gray: "m3-neutral",
} as const;

const CHIP = {
  green: "m3-chip-now",
  blue: "m3-chip-relaxed",
  red: "m3-chip-wait",
  gray: "m3-chip-neutral border border-outline-variant",
} as const;

const STRONG_TONE = {
  green: "text-emerald-100",
  blue: "text-sky-100",
  red: "text-rose-100",
  gray: "text-slate-100",
} as const;

const SUB_TONE = {
  green: "text-emerald-100/80",
  blue: "text-sky-100/80",
  red: "text-rose-100/80",
  gray: "text-slate-400",
} as const;

// V4 (GUI-TEXT-BEFUND): kein Zeichen als Textersatz. „Jetzt tanken“,
// „Warten“ und „Woanders tanken“ tragen dieselben Worte wie das Tagebuch
// (`diaryActionWord`, §4c) — die Farbe des Chips sagt die Richtung, die
// Icons daneben bleiben dekorativ (aria-hidden, V4) oder fallen ganz weg.
const CHIP_TEXT = {
  refuel_now: "Jetzt tanken",
  wait: "Warten",
  refuel_elsewhere: "Woanders tanken",
  // Stufe C/S1: grau ist ein erster Klasse-Zustand. Der Chip benennt den
  // Zustand („keine klare Empfehlung“), die Überschrift darunter die
  // Tatsache, die auch ohne Modell gilt: der günstigste offene Preis.
  no_advice: "Keine klare Empfehlung",
} as const;

/** Mini-Visual der Ebene 1: Tagesprofil mit markiertem Fenster. */
function DayProfileVisual({
  cells,
  marks,
}: {
  cells: StripCell[];
  marks: { fromHour: number; toHour: number } | null;
}) {
  return (
    <div>
      <div
        className="grid grid-cols-[repeat(19,minmax(0,1fr))] gap-1"
        role="img"
        aria-label="Tagesprofil 06–24 Uhr als Mini-Balken, grün markiert: empfohlenes Fenster"
      >
        {cells.map((cell) => {
          const inWindow =
            marks && cell.hour >= marks.fromHour && cell.hour <= marks.toHour;
          return (
            <div
              key={cell.hour}
              title={`${String(cell.hour).padStart(2, "0")}:00${
                cell.value !== null ? ` — ${euro(cell.value, 3)} €/L` : ""
              }`}
              className={`h-6 rounded ${
                inWindow
                  ? "bg-emerald-500/80"
                  : cell.tone === "cheap"
                    ? "bg-emerald-500/30"
                    : cell.tone === "pricey"
                      ? "bg-rose-500/30"
                      : cell.tone === "mid"
                        ? "bg-slate-600/50"
                        : "bg-slate-800"
              }`}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[0.625rem] text-slate-600">
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
      <p className="mt-1.5 text-[0.625rem] leading-relaxed text-slate-400">
        Tagesprofil (06–24 Uhr, letzte offene Meldung je Stunde)
        {marks
          ? ` — grün: das empfohlene Fenster ${String(marks.fromHour).padStart(2, "0")}–${String(marks.toHour).padStart(2, "0")}`
          : ""}
        . Kein Fenster markiert = keine offene Messstunde dort.
      </p>
    </div>
  );
}

export function JetztView(props: JetztViewProps) {
  const {
    activeCity,
    assumptions,
    autoZ,
    dueFillPrice,
    decideRes,
    defaultLiters,
    defaultTimeValue,
    dueDismissed,
    dueEpisode,
    forecastAt,
    liters,
    now: fixedNow,
    onAssumptions,
    onAssumptionsReset,
    onConfirmRecommended,
    onDeepen,
    onDismissDue,
    onIntent,
    onNavigate,
    onOpenFills,
    onRetry,
    onTankQuick,
    online,
    pricesAt,
    selectedId,
    stations,
    stripBand,
    stripCells,
    tankPercent,
    timeValue,
  } = props;
  const [dayOpen, setDayOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  // Eingaben als String halten (deutsche Tastaturen: „1,689“).
  const [litersStr, setLitersStr] = useState<string>("");
  const [timeValueStr, setTimeValueStr] = useState<string>("");
  const [latestByStr, setLatestByStr] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  // Eingaben beim Öffnen mit den aktiven Werten füllen.
  useEffect(() => {
    if (assumptionsOpen) {
      setLitersStr(String(liters));
      setTimeValueStr(String(timeValue));
      setLatestByStr("");
      setInputError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assumptionsOpen]);

  const decide = decideRes.data ?? null;
  // Auch ohne neue Serverantwort läuft die Freigabe ab. Der nächste Tick
  // liegt spätestens am Ablaufzeitpunkt, nicht erst beim nächsten Poll.
  const [clock, setClock] = useState(() => Date.now());
  const now = fixedNow ?? Math.max(clock, Date.now());
  useEffect(() => {
    if (fixedNow !== undefined) return;
    const deadline = Date.parse(decide?.valid_until ?? "");
    const remaining = deadline - Date.now();
    const delay = remaining > 0 ? Math.min(60000, remaining) : 60000;
    const timer = globalThis.setTimeout(() => setClock(Date.now()), delay);
    return () => globalThis.clearTimeout(timer);
  }, [clock, fixedNow, decide?.valid_until]);
  useEffect(() => {
    if (fixedNow !== undefined) return;
    const update = () => setClock(Date.now());
    globalThis.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      globalThis.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [fixedNow]);
  const problemCode =
    decide?.error_code ?? (decideRes.error ? decideRes.errorCode : null);
  const calculationLiters = decide?.quantity?.used_liters ?? liters;
  const quantityNotice = decide?.quantity?.notice ?? null;
  const input = {
    decide,
    stations,
    selectedId,
    liters: calculationLiters,
    now,
    latestBy: assumptions.latestBy,
    timeValue,
  };
  const verdict = nowVerdict(input);
  /**
   * 3-Stufen-Fallback des Guides: Stufe 1 live + Prognose, Stufe 2 ohne
   * Prognose (Preise live), Stufe 3 offline (letzter Stand). Abgeleitet
   * aus echten Zuständen, nie aus einer Vermutung (`guide.ts`).
   */
  const level = guideLevel({
    online: online ?? true,
    decisionReady: decide?.decision_ready ?? null,
  });
  const cardTone = guideTone({
    action: verdict?.action ?? null,
    tone: verdict?.tone ?? null,
    expired: verdict?.expired ?? false,
  });
  // Gültigkeits-Chip: nur für freigegebene, nicht abgelaufene Aktionen —
  // eine Ablehnung altert nicht (A21-B1.4).
  const validity = nowValidity(verdict, now);
  const facts = nowFacts(input);
  const steps = nowSteps(input);
  // „Was ist gerade am besten?“ — die Antwort ohne Modell (S0/S1/C).
  const bestNow = nowBestNow(input);
  // Priorität 1: Abdeckung des beobachteten Sets + Netto-Vergleich für
  // die Fahrt — die Karte beantwortet „Wo ist es jetzt günstig?“ in
  // Sekunden, auch solange decision_ready=false bleibt.
  const coverage = nowCoverage(stations, pricesAt, now);
  const netBest = nowNetBest(input);
  const learning = learningNote(decide);
  const dayPanel = nowDayPanel(stripCells);
  const freshness = nowFreshness({ pricesAt, forecastAt, now });
  const explanation = nowExplanation({ ...input, pricesAt });
  const hint = assumptionHint(input);
  const assumptionsActive =
    assumptions.liters !== null ||
    assumptions.latestBy !== null ||
    assumptions.timeValue !== null;

  // S0 „Einrichten“: noch keine Stationen, noch keine Empfehlung — die
  // Karte erklärt die drei Schritte, statt eine Empfehlung zu erfinden.
  const setup = !verdict && stations.length === 0 && !decideRes.error;
  const window =
    decide?.windows_today?.[0] ?? decide?.primary?.recommended_window ?? null;
  const marks = windowMarks(window);
  /**
   * „Heute im Überblick“: die nächsten acht Stunden aus den Fenstern der
   * Entscheidung. Auf Stufe 2 und 3 tritt die Faustregel an ihre Stelle —
   * eine zwischengespeicherte Prognose wäre keine Prognose mehr.
   */
  const outlook =
    level === "full" ? hourlyOutlook({ windows: decide?.windows_today, now }) : null;
  /**
   * „Was bringt Warten?“: derselbe Abstand, den die Karte in ct/L nennt,
   * hier als Betrag auf die Tankmenge gerechnet (`guideBenefit`).
   *
   * Nur, wenn die Karte selbst eine Zeit-Aussage trägt: „Warten bis …“
   * und „Jetzt tanken“ vergleichen jetzt mit dem Fenster. „Woanders
   * tanken“ und „Keine klare Empfehlung“ sind Orts- bzw.
   * Enthaltungs-Aussagen — dort würde der Vergleich eine Differenz
   * behaupten, die die Entscheidung nicht trifft (C0: nichts erfinden).
   */
  const priceNow = bestNow.price ?? decide?.primary?.station?.price_now ?? null;
  const benefit =
    verdict && (verdict.action === "wait" || verdict.action === "refuel_now")
      ? guideBenefit({
          tone: cardTone,
          centDiff: savingPerLiterCt(priceNow, window?.expected_price ?? null),
          liters: calculationLiters,
          atIso: window?.start ?? null,
        })
      : null;

  const commitLiters = () => {
    const value = Number(litersStr.replace(",", "."));
    // Dieselben Grenzen wie das Profil (PROFILE_BOUNDS ↔ app/profiles.py):
    // Ein 100-L-Tank (Transporter/Diesel) muss auch hier rechenbar sein —
    // sonst deckt die Was-wäre-wenn-Menge den Beleg-Bereich nicht ab
    // (Prüfbericht §5).
    const { min, max } = PROFILE_BOUNDS.liters;
    if (!Number.isFinite(value) || value < min || value > max) {
      setInputError(
        `Tankmenge: Zahl zwischen ${deTrimmed(min, 0)} und ${deTrimmed(max, 0)} L.`,
      );
      return;
    }
    setInputError(null);
    // Gerechnet wird in ganzen Litern — das Feld zeigt den gerundeten Wert
    // zurück, statt still 12,5 zu 13 zu machen (TEXT-BEFUND T3).
    const rounded = Math.round(value);
    setLitersStr(String(rounded));
    onAssumptions({ liters: rounded });
  };
  const commitTimeValue = () => {
    const raw = timeValueStr.trim();
    if (raw === "") {
      onAssumptions({ timeValue: null });
      return;
    }
    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value) || value < 0 || value > 30) {
      setInputError("Zeitwert: Zahl zwischen 0 und 30 €/h (0 = Auto).");
      return;
    }
    setInputError(null);
    onAssumptions({ timeValue: value });
  };
  const commitLatestBy = () => {
    if (!latestByStr) {
      onAssumptions({ latestBy: null });
      return;
    }
    const iso = timeInputToBerlinIso(latestByStr, now);
    if (!iso) {
      setInputError("Zeitformat: HH:MM — z. B. 17:30.");
      return;
    }
    setInputError(null);
    onAssumptions({ latestBy: iso });
  };
  const latestByLabel = assumptions.latestBy
    ? new Date(assumptions.latestBy).toLocaleTimeString("de-DE", {
        timeZone: "Europe/Berlin",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const episodeId = decide?.episode?.id ?? null;
  const showIntents =
    verdict && verdict.action !== "no_advice" && episodeId !== null;

  return (
    <section aria-labelledby="jetzt-title">
      <h1 id="jetzt-title" className="text-2xl font-bold tracking-tight text-slate-100">
        Jetzt
      </h1>
      {/* Due-Prompt nach Fensterende (aus dem Alltagstab übernommen) */}
      {dueEpisode && !dueDismissed && (
        <section
          aria-label="Rückmeldung nach Fensterende"
          className={`mb-4 ${radius.card} border border-amber-500/40 bg-gradient-to-r from-amber-950/40 via-slate-900 to-slate-900 p-4 shadow-xl`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-400">
                <Clock size={20} aria-hidden="true" />
              </div>
              <div>
                <span className="text-xs font-bold uppercase tracking-widest text-amber-400">
                  Fenster vorbei
                </span>
                <h2 className="mt-0.5 text-base font-bold text-slate-100">
                  Gerade getankt?
                </h2>
                <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-400">
                  Ein Klick erfasst deinen Beleg in deiner Bilanz.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => onConfirmRecommended(dueEpisode)}
                disabled={dueFillPrice === null}
                title={
                  dueFillPrice === null
                    ? "Kein frischer Preis — bitte manuell erfassen"
                    : `Wie empfohlen ${euro(dueFillPrice, 3)} €/L`
                }
                className="rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 transition shadow-md hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Ja, wie empfohlen (
                {dueFillPrice !== null ? `${euro(dueFillPrice, 3)} €/L` : "Preis unbekannt"})
              </button>
              <button
                onClick={onOpenFills}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
              >
                Anders buchen
              </button>
              <button
                onClick={() => onDismissDue(dueEpisode.id)}
                className="rounded-lg px-3 py-2.5 text-xs text-slate-400 transition hover:text-slate-100"
              >
                Noch nicht
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ① Entscheidung */}
      <div id="jetzt-entscheidung" className="mt-4 scroll-mt-24">
        {/* Inline-Banner statt Modal: Ein anhaltender Zustand erklärt sich
            über der Karte und lässt die Preise sichtbar (Stufe 2 und 3). */}
        <GuideBanner
          level={level}
          stand={timeOfDayLabel(pricesAt)}
          hasPrices={stations.length > 0}
          blockingReasons={decide?.blocking_reasons ?? null}
          retrying={decideRes.pending}
          onRetry={onRetry}
        />
        {decideRes.pending && !decide && !setup ? (
          <SkeletonPanel lines={3} label="Empfehlung wird berechnet" />
        ) : setup ? (
          <div className={`${panel} p-5 sm:p-7`}>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${CHIP.gray}`}
            >
              <Compass size={13} aria-hidden="true" />
              Noch keine Daten
            </span>
            <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-slate-100">
              Einrichten in drei Schritten
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
              Schritt 1: Ort und Kraftstoff wählen · Schritt 2: Stationen
              festlegen · Schritt 3: Collector prüfen. Danach erscheinen
              Preise in wenigen Minuten, die erste Empfehlung nach einigen
              Wochen Messung.
            </p>
            <button
              onClick={() => onNavigate("system")}
              className="m3-btn-now mt-5 inline-flex h-12 items-center gap-2 rounded-full px-6 text-sm font-bold"
            >
              Einrichtung starten
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        ) : verdict?.expired ? (
          /* Abgelaufene Freigabe: der Karteninhalt wechselt — kein Fehler,
             keine rote Fläche. Fakten und Preisvergleich bleiben darunter
             sichtbar (Übergangsregel, UI-Neugestaltung). */
          <div
            className={`${panel} p-5 sm:p-7 ${CARD_TONE.gray}`}
            aria-labelledby="jetzt-headline"
          >
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${CHIP.gray}`}
            >
              <Clock size={13} aria-hidden="true" />
              Empfehlung abgelaufen
            </span>
            <h2
              id="jetzt-headline"
              className="mt-3 text-2xl font-extrabold tracking-tight text-slate-100"
            >
              {verdict.headline}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
              {verdict.detail}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                onClick={onRetry}
                className="inline-flex h-12 items-center justify-center rounded-full border border-outline-variant bg-sc-low px-6 text-sm font-semibold text-on-surface transition hover:bg-sc"
              >
                Empfehlung neu laden
              </button>
            </div>
          </div>
        ) : verdict && verdict.action !== "no_advice" ? (
          <div
            className={`${panel} p-5 sm:p-7 ${CARD_TONE[verdict.tone]}`}
            aria-labelledby="jetzt-headline"
          >
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${CHIP[verdict.tone]}`}
            >
              {CHIP_TEXT[verdict.action]}
            </span>
            <h2
              id="jetzt-headline"
              className={`mt-3 text-[1.625rem] font-extrabold tracking-tight sm:text-[1.75rem] ${STRONG_TONE[verdict.tone]}`}
            >
              {verdict.headline}
            </h2>
            {verdict.amount && (
              <p
                className={`mt-2 text-2xl font-black tracking-tight tabular-nums sm:text-3xl ${STRONG_TONE[verdict.tone]}`}
              >
                {verdict.amount}
              </p>
            )}
            <p
              className={`mt-2 max-w-xl text-sm leading-relaxed ${SUB_TONE[verdict.tone]}`}
            >
              {verdict.detail}
            </p>
            {hint && (
              <p
                className={`mt-2 max-w-xl text-xs leading-relaxed ${SUB_TONE[verdict.tone]}`}
              >
                {hint}
              </p>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {verdict.mapsUrl && (
                <a
                  href={verdict.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onIntent("navigate", verdict.mapsUrl)}
                  /* `tap-44`: Die Route ist DIE Handlung an der Säule und war
                     als <a> mit 36 px unter dem Touch-Ziel (C5/WCAG 2.5.5) —
                     die 44-px-Regel in styles.css greift bei Links nur mit
                     dieser Klasse. */
                  className="tap-44 m3-btn-now inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-bold"
                >
                  Route
                  <ArrowRight size={16} aria-hidden="true" />
                </a>
              )}
              <button
                onClick={() => setSheetOpen(true)}
                aria-haspopup="dialog"
                className="inline-flex h-12 items-center justify-center rounded-full border border-outline-variant bg-sc-lowest px-6 text-sm font-semibold text-on-surface transition hover:bg-sc-low"
              >
                Warum?
              </button>
              {verdict && (
                <GuideConfidence percent={verdict.percent} onTone />
              )}
              {validity && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${validity.endingSoon ? "border-amber-500/40 bg-amber-500/10 text-amber-400" : "border-outline-variant text-on-surface-variant"}`}
                  title="Freigabe der Empfehlung — danach wird neu berechnet"
                >
                  <Clock size={12} aria-hidden="true" />
                  {validity.label}
                </span>
              )}
            </div>
            {/* Was-wäre-wenn in der Karte (§5.1): die Annahmen, die die
                Empfehlung tragen — live, über denselben Server-Aufruf. */}
            <details
              className={`mt-4 rounded-lg border text-xs ${
                assumptionsActive
                  ? "border-emerald-500/30 bg-emerald-950/20"
                  : "border-slate-800 bg-slate-950/40"
              }`}
            >
              <summary
                className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-slate-400 hover:text-slate-100 [&::-webkit-details-marker]:hidden"
                onClick={() => setAssumptionsOpen(true)}
              >
                <span className="flex items-center gap-2 font-semibold">
                  <SlidersHorizontal size={13} aria-hidden="true" />
                  Annahmen: {deTrimmed(calculationLiters, 0)} L
                  {decide?.quantity?.adjusted
                    ? ` (frei: ${deTrimmed(decide.quantity.available_liters ?? calculationLiters, 0)} L)`
                    : ""}
                  {assumptionsActive && latestByLabel
                    ? ` · bis ${latestByLabel} Uhr`
                    : ""}
                  {assumptions.timeValue !== null
                    ? ` · ${deTrimmed(timeValue, 1)} €/h`
                    : ""}
                  {assumptionsActive ? " · geändert" : ""}
                </span>
                {assumptionsActive && (
                  <button
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setAssumptionsOpen(true);
                      onAssumptionsReset();
                    }}
                    className="flex items-center gap-1 font-semibold text-emerald-300 hover:text-emerald-200"
                  >
                    <RotateCcw size={11} aria-hidden="true" />
                    zurücksetzen
                  </button>
                )}
              </summary>
              <div className="border-t border-slate-800/70 p-3">
                <p className="mb-3 leading-relaxed text-slate-400">
                  Was-wäre-wenn: die Änderung gilt nur für diese Ansicht —
                  dein Profil bleibt unangetastet. Der Server rechnet mit den
                  neuen Werten neu (dieselbe Anfrage, andere Parameter).
                </p>
                {quantityNotice && (
                  <p className="mb-3 rounded-md border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
                    {quantityNotice} Rechnung und Anzeige nennen {deTrimmed(calculationLiters, 0)} L.
                  </p>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="text-slate-400">
                    Tankmenge (L)
                    <input
                      type="text"
                      inputMode="numeric"
                      value={litersStr}
                      onChange={(e) => setLitersStr(e.target.value)}
                      onBlur={commitLiters}
                      onKeyDown={(e) => e.key === "Enter" && commitLiters()}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-emerald-500"
                    />
                    <span className="mt-1 block text-xs text-slate-500">
                      {deTrimmed(PROFILE_BOUNDS.liters.min, 0)}–
                      {deTrimmed(PROFILE_BOUNDS.liters.max, 0)} L, ganze Liter ·
                      Profil: {deTrimmed(defaultLiters, 0)} L
                    </span>
                  </label>
                  <label className="text-slate-400">
                    Spätestens tanken (heute)
                    <input
                      type="time"
                      value={latestByStr}
                      onChange={(e) => setLatestByStr(e.target.value)}
                      onBlur={commitLatestBy}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-emerald-500"
                    />
                    <span className="mt-1 block text-xs text-slate-500">
                      leer = keine Grenze · Fenster danach fallen weg
                    </span>
                  </label>
                  <label className="text-slate-400">
                    Zeitwert (€/h)
                    <input
                      type="text"
                      inputMode="decimal"
                      value={timeValueStr}
                      onChange={(e) => setTimeValueStr(e.target.value)}
                      onBlur={commitTimeValue}
                      onKeyDown={(e) => e.key === "Enter" && commitTimeValue()}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-emerald-500"
                    />
                    <span
                      className="mt-1 block text-xs text-slate-500"
                      title="Fachwort: Peak und Off-Peak"
                    >
                      {/* 0.55.0: Stand hier fest als „aktuell <Wert> €/h ·
                          Stoßzeit/Nebenzeit“. Bei gesetztem Zeitwert war der
                          Wert der manuelle, das Zeitwort aber das der nicht
                          aktiven Automatik — zwei Aussagen über verschiedene
                          Zustände in einer Klammer. */}
                      {timeValue > 0
                        ? `Fester Wert · mit 0 nach Uhrzeit (gerade ${deTrimmed(autoZ.z)} €/h) · wirkt auf den Umweg`
                        : `0 = Auto · gerade ${deTrimmed(autoZ.z)} €/h (${autoZ.isPeak ? "Stoßzeit" : "Nebenzeit"}) · wirkt auf den Umweg`}
                    </span>
                  </label>
                </div>
                {inputError && (
                  <p role="alert" className="mt-2 text-xs text-rose-300">
                    {inputError}
                  </p>
                )}
              </div>
            </details>
            {/* Intents (M7): die Feedback-Schleife bleibt — klein, sekundär,
                unter der Primäraktion. */}
            {showIntents && (
              <div
                className="mt-3 flex flex-wrap items-center gap-3 text-xs"
                aria-label="Rückmeldung zur Empfehlung"
              >
                <button
                  onClick={() => onIntent("wait")}
                  className="text-slate-500 underline decoration-dotted underline-offset-4 hover:text-slate-300"
                >
                  Ich warte
                </button>
                <button
                  onClick={() => onIntent("refuel_now")}
                  className="text-slate-500 underline decoration-dotted underline-offset-4 hover:text-slate-300"
                >
                  Jetzt tanken
                </button>
                <button
                  onClick={() => onIntent("dismiss")}
                  className="text-slate-600 underline decoration-dotted underline-offset-4 hover:text-slate-400"
                >
                  Verwerfen
                </button>
              </div>
            )}
          </div>
        ) : bestNow.station === null && !learning && !problemCode ? (
          <div className={`${panel} p-5 sm:p-7`}>
            <p className="text-sm leading-relaxed text-slate-300">
              Noch keine Empfehlung — die Preise werden geladen.
            </p>
          </div>
        ) : (
          /* Ohne Prognose bleibt die Tatsache: der Preisvergleich jetzt.
             Bis 0.35.0 stand hier die graue Karte mit einer Nebenliste —
             der günstigste offene Preis ist aber die Antwort, die man
             sucht (Nutzer-Feedback 14.09.2026). */
          /* Ohne Prognose bleibt die Tatsache: der Preisvergleich jetzt.
             Bis 0.35.0 stand hier die graue Karte mit einer Nebenliste —
             der günstigste offene Preis ist aber die Antwort, die man
             sucht (Nutzer-Feedback 14.09.2026).

             B4 (Befund §1.2: „1 + 3 + 1“): Die Karte trägt die Antwort und
             höchstens zwei Sätze dazu. Statistik (Spanne) und Bestätigung
             („kein Umweg lohnt“) liegen hinter „Mehr zum Vergleich“; das
             Preisalter steht in der Frische-Fußzeile, nicht zweimal. Was
             der Antwort **widerspricht**, bleibt sichtbar. */
          <div className={`${panel} p-4 sm:p-7 ${CARD_TONE.gray}`}>
            {/* Der Fehler steht über der Tatsache: erst sagen, dass die
                Prognose fehlt, dann den Preisvergleich zeigen — statt den
                Nutzer ohne Zahlen stehen zu lassen. */}
            {problemCode && (
              <div className="mb-3">
                <LoadError
                  errorCode={problemCode}
                  detail={decide?.detail ?? null}
                  fallback="Empfehlung derzeit nicht erreichbar."
                  onRetry={onRetry}
                  compact
                />
              </div>
            )}
            {/* Kategorie und Zustand in EINER Reihe: zwei Zeilen nur für
                zwei Etiketten waren der teuerste Leerlauf der Karte. */}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${CHIP.gray}`}
              >
                {verdict?.action === "no_advice"
                  ? CHIP_TEXT.no_advice
                  : "Preisvergleich"}
              </span>
              <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">
                Jetzt günstig tanken
              </span>
            </div>
            <h2
              id="jetzt-headline"
              className="mt-2 text-2xl font-extrabold tracking-tight text-slate-100"
            >
              {bestNow.station
                ? `Jetzt am günstigsten: ${bestNow.station.name}`
                : "Keine klare Empfehlung"}
            </h2>
            {bestNow.price !== null && (
              <p className="mt-1 text-2xl font-black tracking-tight text-slate-100 tabular-nums sm:text-3xl">
                {euroPerLiter(bestNow.price)}
              </p>
            )}
            {/* Die Antwort in einem Satz: welche Station, wie viel günstiger
                und gegen welche Referenz (`nowBestNow.sentence`). */}
            {bestNow.sentence && (
              <p className="mt-2 max-w-xl text-xs leading-relaxed text-slate-300">
                {bestNow.sentence}
              </p>
            )}
            {/* Satzgrenze des Sets (§5c: „bekannt“/„beobachtet“, kein
                Marktversprechen). Das Preisalter steht hier nicht mehr —
                die Frische-Fußzeile trägt es für alle Bereiche (T8), und
                zweimal dieselbe Minute liest niemand. */}
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-400">
              Günstigste bekannte Station unter den beobachteten Stationen ·{" "}
              {coverage.line}
            </p>
            {/* A21-B1.4: Der **Servergrund** führt (Sperrgrund der
                Freigabekette bzw. Tabellenablehnung) — der Zählstand
                („Das Modell lernt noch …“) steht dann in der eigenen Zeile
                darunter; ohne Servergrund **ist** `detail` der Lernhinweis
                und steht genau einmal (Nutzer-Feedback 16.09.2026). */}
            {verdict?.action === "no_advice" &&
              learning &&
              verdict.detail !== learning && (
                <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-400">
                  {learning}
                </p>
              )}
            {/* Widerspricht die Netto-Rechnung der Headline (eine andere
                Station ist **netto** günstiger), steht sie sichtbar — eine
                Karte darf nicht „hier am günstigsten“ sagen und das
                Gegenteil verstecken. Bestätigt sie die Antwort nur, liegt
                sie im Detail darunter. */}
            {netBest.kind === "net" && (
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-300">
                {netBest.text}
              </p>
            )}
            {/* B4 (Befund UX/Mathe 19.09.2026, §1.4.1): Die Stationszeilen-
                Liste lebt hier nicht mehr — „Stationen“ ist der einzige Ort
                der Stationsliste (keine Dopplung, kein zweiter Ort
                derselben Wahrheit). Hier bleibt die Entscheidung plus der
                Einweg: der günstigste offene Preis (oben) und die Handlung.
                Die zweite Aktion ist ein leiser Textlink (wie die
                Intent-Zeile der grünen Karte): auf 390 px steht er neben
                der Route in derselben 44-px-Zeile statt darunter als
                zweiter Button. */}
            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
              {bestNow.mapsUrl && (
                <a
                  href={bestNow.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tap-44 m3-btn-now inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full px-6 text-sm font-bold"
                >
                  Route starten
                  <ArrowRight size={16} aria-hidden="true" />
                </a>
              )}
              <button
                onClick={() => onNavigate("stations")}
                className="min-w-0 text-sm font-semibold text-emerald-400 underline decoration-dotted underline-offset-4 hover:text-emerald-300"
              >
                Alle {bestNow.freshCount} Preise vergleichen
              </button>
            </div>
            {/* Statistik und Begründung bleiben erreichbar — nur nicht im
                Weg der einen Antwort. */}
            <details className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 text-xs">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 font-semibold text-slate-400 hover:text-slate-100 [&::-webkit-details-marker]:hidden">
                <ChevronRight size={13} aria-hidden="true" />
                Mehr zum Vergleich
              </summary>
              <div className="space-y-1.5 border-t border-slate-800 px-3 py-2.5 leading-relaxed text-slate-400">
                {netBest.kind !== "net" && <p>{netBest.text}</p>}
                {bestNow.spreadEur !== null && (
                  <p>
                    Günstigste bis teuerste:{" "}
                    {centPerLiter(bestNow.spreadCt ?? 0)} ·{" "}
                    {euro(bestNow.spreadEur)} € bei{" "}
                    {deTrimmed(calculationLiters, 0)} L
                  </p>
                )}
                {coverage.ageLine && <p>{coverage.ageLine}</p>}
                {/* Der Servergrund steht hier, wenn das Banner ihn nicht
                    schon trägt (Stufe 2 und 3) — und nie doppelt zum
                    Lernhinweis. */}
                {level === "full" &&
                  verdict?.detail &&
                  verdict.detail !== learning && (
                    <p>{verdict.detail}</p>
                  )}
              </div>
            </details>
          </div>
        )}
      </div>

      {/* ② Drei Fakten — immer dieselben drei, immer dieselbe Reihenfolge
          (§5.1). Mobil stehen sie in der 3er-Reihe des Entwurfs (Mockup
          `ui-neuentwurf-mockup`: 88 px) statt als drei gestapelte Karten
          (409 px, „Zu lang auf mobil“, 18.09.2026); ab `sm` unverändert die
          großen Karten. Dieselben Werte aus `nowFacts`, zwei Anordnungen. */}
      <div id="jetzt-fakten" className="mt-4 scroll-mt-24">
      <div className="grid grid-cols-6 gap-2 sm:grid-cols-3 sm:gap-3">
        {facts.map((fact, index) => (
          <div
            key={fact.label}
            className={`${panel} p-2.5 sm:p-4 ${index === 2 ? "col-span-6 sm:col-span-1" : "col-span-3 sm:col-span-1"}`}
          >
            {/* Mobil stehen die drei Fakten in einer Zeile nebeneinander; der
                Tank-Fakt läuft darunter über die volle Breite, weil seine
                Schnellauswahl sonst in einer 90-px-Spalte umbricht (der
                Hinweissatz brauchte dort fünf Zeilen). Ab `sm` unverändert
                drei gleich breite Karten. */}
            <div
              className={
                index === 2
                  ? "flex flex-wrap items-baseline gap-x-2 sm:block"
                  : undefined
              }
            >
              <span className="block text-[0.625rem] uppercase leading-tight tracking-wide text-slate-500 sm:text-xs sm:tracking-widest">
                {fact.label}
              </span>
              <span className="block text-sm font-bold text-slate-100 tabular-nums sm:mt-1 sm:text-lg">
                {fact.value}
              </span>
              <span className="block text-[0.6875rem] leading-snug text-slate-400 sm:mt-1 sm:text-xs sm:leading-relaxed">
                {fact.detail}
              </span>
            </div>
            {/* Tankstand als Fakt: Schnellauswahl statt Formular (§5.1). Mobil
                zweizeilig (2 × 2), damit die vier Knöpfe in der schmalen
                Karte bleiben, ohne die Reihe höher zu machen. */}
            {index === 2 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 sm:mt-3 sm:block">
                <div className="flex flex-wrap items-center gap-1 sm:gap-1.5">
                  {TANK_QUICK.map((item) => (
                    <button
                      key={item.percent}
                      onClick={() =>
                        onTankQuick(tankPercent === item.percent ? null : item.percent)
                      }
                      aria-pressed={tankPercent === item.percent}
                      title={`${item.percent} % Füllstand setzen`}
                      className={`rounded-lg border px-1.5 py-0.5 text-[0.6875rem] font-bold sm:px-2.5 sm:py-1 sm:text-xs ${
                        tankPercent === item.percent
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                          : "border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-600 hover:text-slate-100"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                  {tankPercent !== null && (
                    <button
                      onClick={() => onTankQuick(null)}
                      className="rounded-lg border border-slate-700 px-1.5 py-0.5 text-[0.6875rem] text-slate-500 hover:text-slate-300 sm:px-2.5 sm:py-1 sm:text-xs"
                    >
                      Keine Angabe
                    </button>
                  )}
                </div>
                <p className="text-[0.6875rem] leading-snug text-slate-500 sm:mt-1.5 sm:text-xs sm:leading-normal">
                  {tankPercent !== null
                    ? `Füllstand ${deTrimmed(tankPercent, 0)} % — genauer einstellen in „Woche“.`
                    : "Mit Tankstand prüft die App, ob Warten riskant ist."}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
      </div>

      {/* ③ Nächste Schritte */}
      <div id="jetzt-schritte" className="scroll-mt-24">
      {steps.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-semibold text-slate-200">
            Nächste Schritte
          </h2>
          <div className="mt-2 grid grid-cols-1 gap-2">
            {steps.map((step) => (
              <button
                key={step.id}
                onClick={() => onNavigate(step.target)}
                className={`${panel} flex items-center gap-3 p-3 text-left text-xs leading-relaxed text-slate-200 hover:border-slate-700`}
              >
                <ArrowRight
                  size={15}
                  className="shrink-0 text-emerald-400"
                  aria-hidden="true"
                />
                <span>{step.text}</span>
              </button>
            ))}
          </div>
        </>
      )}
      </div>

      {/* ④ Heute im Blick — seit 0.36.0 mit Zahlen statt nur Farben
          (Nutzer-Feedback 14.09.2026: „zu wenig Infos“). Alles aus den
          Zellen selbst: günstigste/teuerste offene Stunde, Tagesmedian,
          Abstand „jetzt“ zum Median und die Abdeckung. Seit B4 (Befund
          UX/Mathe 2026-09-19, §1.4.1) ist nur das Stundenprofil
          eingeklappt — die Aussage und die Kennzahlen bleiben oben. */}
      {stripCells.length > 0 && (
        <>
          <h2
            id="jetzt-heute"
            className="mt-6 flex scroll-mt-24 items-center gap-2 text-sm font-semibold text-slate-200"
          >
            <CalendarDays size={15} className="text-emerald-400" aria-hidden="true" />
            Heute im Blick
          </h2>
          <div className={`${panel} mt-2 p-4`}>
            <p className="text-xs leading-relaxed text-slate-300">
              {dayPanel.headline}
            </p>
            <div className="mt-3 hidden gap-2 sm:grid sm:grid-cols-3">
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
                <p className="text-xs uppercase tracking-wider text-slate-500">
                  {dayPanel.tied ? "Günstigste Stunden" : "Günstigste Stunde"}
                </p>
                <p className="mt-0.5 font-mono text-sm font-bold text-emerald-300 tabular-nums">
                  {dayPanel.best ? dayPanel.bestLabel : "—"}
                </p>
                <p className="text-xs text-slate-500">
                  {dayPanel.best
                    ? euroPerLiter(dayPanel.best.value)
                    : "keine offene Meldung"}
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
                <p className="text-xs uppercase tracking-wider text-slate-500">
                  Tagesmedian
                </p>
                <p className="mt-0.5 font-mono text-sm font-bold text-slate-100 tabular-nums">
                  {dayPanel.median !== null ? euroPerLiter(dayPanel.median) : "—"}
                </p>
                <p className="text-xs text-slate-500">
                  {dayPanel.spreadCt !== null
                    ? `Spanne ${centPerLiter(dayPanel.spreadCt)} zwischen bester und teuerster Stunde`
                    : "noch kein Verlauf"}
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
                <p className="text-xs uppercase tracking-wider text-slate-500">
                  Jetzt
                </p>
                <p className="mt-0.5 font-mono text-sm font-bold text-slate-100 tabular-nums">
                  {dayPanel.nowValue !== null
                    ? euroPerLiter(dayPanel.nowValue)
                    : "—"}
                </p>
                <p className="text-xs text-slate-500">
                  {dayPanel.nowVsMedianCt === null
                    ? "keine offene Meldung in dieser Stunde"
                    : dayPanel.nowVsMedianCt > 0.05
                      ? `${centPerLiter(dayPanel.nowVsMedianCt)} über dem Tagesmedian`
                      : dayPanel.nowVsMedianCt < -0.05
                        ? `${centPerLiter(Math.abs(dayPanel.nowVsMedianCt))} unter dem Tagesmedian`
                        : "auf Höhe des Tagesmedians"}
                </p>
              </div>
            </div>
            {/* Mobil verdichtet (0.53.0): Die drei Kennzahlen belegten dort je
                eine eigene Karte und damit 260 px statt 88 px, obwohl Mobil
                der Primärfall ist („Zu lang auf mobil“, 18.09.2026). Desktop
                behält die drei Karten unverändert — dieselben Zahlen aus
                derselben Quelle (`nowDayPanel`), zwei Anordnungen. */}
            <dl className="mt-3 grid grid-cols-1 gap-1 text-xs leading-snug sm:hidden">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-slate-500">{dayPanel.tied ? "Günstigste Stunden" : "Günstigste Stunde"}</dt>
                <dd className="font-mono font-semibold text-emerald-300 tabular-nums">
                  {dayPanel.best
                    ? `${dayPanel.bestLabel} · ${euroPerLiter(dayPanel.best.value)}`
                    : "keine offene Meldung"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-slate-500">Tagesmedian</dt>
                <dd className="font-mono font-semibold text-slate-200 tabular-nums">
                  {dayPanel.median !== null
                    ? euroPerLiter(dayPanel.median)
                    : "—"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-slate-500">Jetzt</dt>
                <dd className="text-right font-mono font-semibold text-slate-200 tabular-nums">
                  {dayPanel.nowValue !== null
                    ? euroPerLiter(dayPanel.nowValue)
                    : "—"}
                </dd>
              </div>
            </dl>
            <button id="jetzt-daystrip" onClick={() => setDayOpen(true)} aria-haspopup="dialog"
              className="mt-2 flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-1.5 text-xs font-semibold text-slate-300">
              <ChevronRight size={13} aria-hidden="true" /> Tagesstreifen 06–24 Uhr
            </button>
            <BottomSheet open={dayOpen} title="Heute im Blick — Tagesstreifen" onClose={() => setDayOpen(false)}>
              <div className="mt-3">
            <div className="daystrip-cells grid gap-1.5">
              {stripCells.map((cell) => {
                // Balkenhöhe = Preis innerhalb der Tagesspanne. So liest man
                // das Profil, ohne 19 Zahlen zu vergleichen.
                const span =
                  dayPanel.worst && dayPanel.best
                    ? dayPanel.worst.value - dayPanel.best.value
                    : 0;
                const ratio =
                  cell.value !== null && span > 0
                    ? (cell.value - (dayPanel.best?.value ?? cell.value)) / span
                    : 0;
                const cellTitle =
                  cell.value === null
                    ? `${String(cell.hour).padStart(2, "0")}:00 — keine offene Meldung`
                    : `${String(cell.hour).padStart(2, "0")}:00 — ${euroPerLiter(cell.value)}`;
                return (
                  <div
                    key={cell.hour}
                    title={cellTitle}
                    // M8: Werte nicht nur per Hover — jede Zelle ist für
                    // Screenreader/Tastatur ein beschriftetes Bild.
                    role="img"
                    aria-label={cellTitle}
                    className={`flex flex-col items-center gap-0.5 rounded-lg border px-0.5 pb-0.5 pt-1 ${
                      cell.current
                        ? "border-emerald-400 bg-emerald-950/80"
                        : cell.tone === "cheap"
                          ? "border-emerald-500/30 bg-emerald-900/30"
                          : cell.tone === "pricey"
                            ? "border-rose-500/30 bg-rose-950/30"
                            : cell.tone === "mid" || cell.tone === "unrated"
                              ? "border-slate-700/40 bg-slate-800/40"
                              : "border-slate-800 bg-slate-950/40"
                    }`}
                  >
                    {/* Balken in fester Spur (12 px), am unteren Rand
                        ausgerichtet: Jede Zelle beginnt ihre Stunden- und
                        Wertzeile damit auf derselben Höhe. Vorher wuchs der
                        Balken in den Fluss hinein, die Zahlenreihe stand
                        dadurch von Zelle zu Zelle auf verschiedenen Linien
                        („Zahlenreihe ist schief“). */}
                    <span
                      aria-hidden="true"
                      className="flex h-3 w-full items-end justify-center"
                    >
                      <span
                        className={`w-full rounded-sm ${
                          cell.value === null
                            ? "h-0.5 bg-slate-700/50"
                            : cell.tone === "cheap"
                              ? "bg-emerald-400/80"
                              : cell.tone === "pricey"
                                ? "bg-rose-400/80"
                                : "bg-slate-400/60"
                        }`}
                        style={{ height: `${2 + Math.round(ratio * 10)}px` }}
                      />
                    </span>
                    <span
                      className={`whitespace-nowrap font-mono text-[0.625rem] ${
                        cell.current ? "text-emerald-200" : "text-slate-500"
                      }`}
                    >
                      {String(cell.hour).padStart(2, "0")}
                    </span>
                    {/* U2: Wert in 0,625 rem (10 px); voller Preis steht
                        zusätzlich im `title` und `aria-label` jeder Zelle.
                        `whitespace-nowrap` hält „1,725“ in einer Zeile — die
                        Zellenzahl je Reihe in styles.css (5/10/19) sorgt dafür,
                        dass die fünf Zeichen auch hineinpassen. */}
                    <span
                      className={`whitespace-nowrap font-mono text-[0.625rem] leading-tight tabular-nums ${
                        cell.value === null
                          ? "text-slate-700"
                          : cell.current
                            ? "text-emerald-100"
                            : cell.tone === "cheap"
                              ? "text-emerald-300"
                              : cell.tone === "pricey"
                                ? "text-rose-300"
                                : "text-slate-300"
                      }`}
                    >
                      {cell.value === null ? "—" : euro(cell.value, 3)}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              {dayPanel.coverage} Zahl = €/L (Stunden-Minimum) · Balken =
              Höhe im Tagesverlauf · Rahmen = jetzt. {stripBandNote(stripBand)}
            </p>
            {/* ④ „Heute im Überblick“ — liegt bewusst hier im Blatt und nicht
                offen auf der Startseite. Grund: Der Streifen unten ist die
                einzige Visualisierung, die der Startseite bleibt (B4); die
                Stundenbalken sind die Langform derselben Aussage und würden
                die Karte von ihrer einen Antwort wegdrücken. Wer den
                Tagesverlauf sehen will, findet ihn hier — einen Tipp entfernt. */}
            <div className="mt-4 border-t border-slate-800 pt-3">
              <HourBars outlook={outlook} />
            </div>
              </div>
            </BottomSheet>
          </div>
        </>
      )}

      {/* ⑤ Was bringt Warten? — der Abstand als Betrag auf die Tankmenge,
          eine Zeile, kein eigener Block. Die Stundenbalken bzw. die
          Faustregel stehen im Blatt „Heute im Blick“ — die Startseite bleibt
          damit kurz (S1: eine Frage, eine Antwort). */}
      {benefit && (
        <div className="mt-3">
          <BenefitWidget benefit={benefit} />
        </div>
      )}

      {/* Frische-Fußzeile (T8: ein Baustein für alle Bereiche) */}
      <FreshnessLine text={freshness.text} tone={freshness.tone} place={activeCity} />

      {explanation && (
        <Level1Sheet
          open={sheetOpen}
          title="Warum diese Empfehlung?"
          sentences={explanation.sentences}
          source={explanation.source}
          labHint={explanation.labHint}
          visual={
            stripCells.length > 0 ? (
              <DayProfileVisual cells={stripCells} marks={marks} />
            ) : null
          }
          visualLabel={
            stripCells.length > 0
              ? "Mini-Visual: das Tagesprofil mit markiertem Fenster (Messwerte, keine Prognose)."
              : undefined
          }
          onDeepen={(section) => {
            setSheetOpen(false);
            onDeepen(section);
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </section>
  );
}
