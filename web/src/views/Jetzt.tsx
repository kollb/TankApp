// Jetzt — der Tank-Kompass (docs/UI-NEUENTWURF.md §5.1).
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
  Clock,
  Compass,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
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
  type DecideResult,
  type ResourceState,
  type Station,
} from "../data";
import {
  assumptionHint,
  learningNote,
  nowBestNow,
  nowDayPanel,
  nowExplanation,
  nowFacts,
  nowFreshness,
  nowSteps,
  nowVerdict,
  TANK_QUICK,
  timeInputToBerlinIso,
  windowMarks,
  type NowTarget,
} from "../now";
import type { LabSectionId } from "../lab";
import type { StripCell } from "../strip";

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
  timeValueUsed: number;
  autoZ: { z: number; isPeak: boolean };
  decideRes: ResourceState<DecideResult>;
  stations: Station[];
  selectedId: string;
  stripCells: StripCell[];
  /** Jüngste Preismeldung — die Fußzeile nennt das Alter. */
  pricesAt: string | null;
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
  bestPrice: number | null;
  onConfirmRecommended: (ep: any) => void;
  onDismissDue: (epId?: string) => void;
  /** Beleg manuell buchen → Ich → Belege (Station vorgemerkkt). */
  onOpenFills: () => void;
  /** Intents (M7-Feedback-Schleife): wait/navigate/refuel_now/dismiss. */
  onIntent: (intent: string, mapsUrl?: string | null) => void;
  /** Nur für Tests; sonst Date.now(). */
  now?: number;
}

const CARD_TONE = {
  green:
    "border-emerald-500/30 bg-gradient-to-br from-emerald-950/70 via-slate-900 to-slate-900",
  blue: "border-sky-500/30 bg-gradient-to-br from-sky-950/60 via-slate-900 to-slate-900",
  gray: "border-slate-700 bg-slate-900/80",
} as const;

const CHIP = {
  green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  blue: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  gray: "border-slate-700 bg-slate-800/60 text-slate-300",
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
    bestPrice,
    decideRes,
    defaultLiters,
    defaultTimeValue,
    dueDismissed,
    dueEpisode,
    forecastAt,
    liters,
    now,
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
    pricesAt,
    selectedId,
    stations,
    stripCells,
    tankPercent,
    timeValue,
    timeValueUsed,
  } = props;
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
  const problemCode =
    decide?.error_code ?? (decideRes.error ? decideRes.errorCode : null);
  const input = {
    decide,
    stations,
    selectedId,
    liters,
    now,
    latestBy: assumptions.latestBy,
    timeValue,
  };
  const verdict = nowVerdict(input);
  const facts = nowFacts(input);
  const steps = nowSteps(input);
  // „Was ist gerade am besten?“ — die Antwort ohne Modell (S0/S1/C).
  const bestNow = nowBestNow(input);
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

  const commitLiters = () => {
    const value = Number(litersStr.replace(",", "."));
    if (!Number.isFinite(value) || value < 10 || value > 80) {
      setInputError("Tankmenge: Zahl zwischen 10 und 80 L.");
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
      <h1 id="jetzt-title" className="text-2xl font-bold tracking-tight text-white">
        Jetzt
      </h1>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">
        Eine Entscheidung, drei Fakten, nächste Schritte.
      </p>

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
                <h2 className="mt-0.5 text-base font-bold text-white">
                  Gerade getankt?
                </h2>
                <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-400">
                  Ein kurzer Tap erfasst deinen Beleg in deiner Bilanz.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => onConfirmRecommended(dueEpisode)}
                disabled={bestPrice === null}
                title={
                  bestPrice === null
                    ? "Kein frischer Preis — bitte manuell erfassen"
                    : `Wie empfohlen ${euro(bestPrice, 3)} €/L`
                }
                className="rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 transition shadow-md hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Ja, wie empfohlen (
                {bestPrice !== null ? `${euro(bestPrice, 3)} €/L` : "Preis unbekannt"})
              </button>
              <button
                onClick={onOpenFills}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
              >
                Anders buchen
              </button>
              <button
                onClick={() => onDismissDue(dueEpisode.id)}
                className="rounded-lg px-3 py-2.5 text-xs text-slate-400 transition hover:text-white"
              >
                Noch nicht
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ① Entscheidung */}
      <div className="mt-4">
        {decideRes.pending && !decide && !setup ? (
          <SkeletonPanel lines={3} label="Empfehlung wird berechnet" />
        ) : setup ? (
          <div className={`${panel} p-5 sm:p-7`}>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${CHIP.gray}`}
            >
              <Compass size={13} aria-hidden="true" />
              Noch keine Daten
            </span>
            <h2 className="mt-3 text-xl font-bold text-white sm:text-2xl">
              Einrichten in drei Schritten
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300">
              Schritt 1: Ort und Kraftstoff wählen · Schritt 2: Stationen
              festlegen · Schritt 3: Collector prüfen. Danach erscheinen
              Preise in wenigen Minuten, die erste Empfehlung nach einigen
              Wochen Messung.
            </p>
            <button
              onClick={() => onNavigate("system")}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"
            >
              Einrichtung starten
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        ) : verdict && verdict.action !== "no_advice" ? (
          <div
            className={`${panel} p-5 sm:p-7 ${CARD_TONE[verdict.tone]}`}
            aria-labelledby="jetzt-headline"
          >
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${CHIP[verdict.tone]}`}
            >
              {CHIP_TEXT[verdict.action]}
            </span>
            <h2
              id="jetzt-headline"
              className="mt-3 text-xl font-bold text-white sm:text-2xl"
            >
              {verdict.headline}
            </h2>
            {verdict.amount && (
              <p className="mt-2 text-2xl font-black tracking-tight text-white tabular-nums sm:text-3xl">
                {verdict.amount}
              </p>
            )}
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-slate-300">
              {verdict.detail}
            </p>
            {verdict.stageNote && (
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                {verdict.stageNote}
              </p>
            )}
            {hint && (
              <p className="mt-2 max-w-xl text-xs leading-relaxed text-slate-400">
                {hint}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setSheetOpen(true)}
                aria-haspopup="dialog"
                className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-2.5 text-xs font-semibold text-slate-200 hover:border-slate-600"
              >
                Warum?
              </button>
              {verdict.mapsUrl && (
                <a
                  href={verdict.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onIntent("navigate", verdict.mapsUrl)}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"
                >
                  Route
                  <ArrowRight size={15} aria-hidden="true" />
                </a>
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
                className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-slate-400 hover:text-slate-200 [&::-webkit-details-marker]:hidden"
                onClick={() => setAssumptionsOpen(true)}
              >
                <span className="flex items-center gap-2 font-semibold">
                  <SlidersHorizontal size={13} aria-hidden="true" />
                  Annahmen: {deTrimmed(liters, 0)} L
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
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-slate-400">
                    Tankmenge (L)
                    <input
                      type="text"
                      inputMode="numeric"
                      value={litersStr}
                      onChange={(e) => setLitersStr(e.target.value)}
                      onBlur={commitLiters}
                      onKeyDown={(e) => e.key === "Enter" && commitLiters()}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white focus:border-emerald-500"
                    />
                    <span className="mt-1 block text-xs text-slate-500">
                      10–80 L, ganze Liter · Profil:{" "}
                      {deTrimmed(defaultLiters, 0)} L
                    </span>
                  </label>
                  <label className="text-slate-400">
                    Spätestens tanken (heute)
                    <input
                      type="time"
                      value={latestByStr}
                      onChange={(e) => setLatestByStr(e.target.value)}
                      onBlur={commitLatestBy}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white focus:border-emerald-500"
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
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white focus:border-emerald-500"
                    />
                    <span
                      className="mt-1 block text-xs text-slate-500"
                      title="Fachwort: Peak und Off-Peak"
                    >
                      0 = Auto (aktuell {deTrimmed(timeValueUsed)} €/h ·{" "}
                      {autoZ.isPeak ? "Stoßzeit" : "Nebenzeit"}) · wirkt auf den
                      Umweg
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
          <div className={`${panel} p-5 sm:p-7 ${CARD_TONE.gray}`}>
            {/* Der Fehler steht über der Tatsache: erst sagen, dass die
                Prognose fehlt, dann den Preisvergleich zeigen — statt den
                Nutzer ohne Zahlen stehen zu lassen. */}
            {problemCode && (
              <div className="mb-3">
                <LoadError
                  errorCode={problemCode}
                  fallback="Empfehlung derzeit nicht erreichbar."
                  onRetry={onRetry}
                  compact
                />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${CHIP.gray}`}
              >
                {verdict?.action === "no_advice"
                  ? CHIP_TEXT.no_advice
                  : "Preisvergleich"}
              </span>
              {bestNow.spreadEur !== null && (
                <span className="text-xs text-slate-400">
                  Spanne im Set: {centPerLiter(bestNow.spreadCt ?? 0)} ·
                  {" "}
                  {euro(bestNow.spreadEur)} € bei {deTrimmed(liters, 0)} L
                </span>
              )}
            </div>
            <h2
              id="jetzt-headline"
              className="mt-3 text-xl font-bold text-white sm:text-2xl"
            >
              {bestNow.station
                ? `Jetzt am günstigsten: ${bestNow.station.name}`
                : "Keine klare Empfehlung"}
            </h2>
            {bestNow.price !== null && (
              <p className="mt-2 text-2xl font-black tracking-tight text-white tabular-nums sm:text-3xl">
                {euroPerLiter(bestNow.price)}
              </p>
            )}
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-slate-300">
              {bestNow.sentence}
            </p>
            {verdict?.detail && verdict.action === "no_advice" && (
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-400">
                {verdict.detail}
              </p>
            )}
            {learning && (
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-400">
                {learning}
              </p>
            )}
            {bestNow.ranking.length > 1 && (
              <ol className="mt-4 grid gap-1.5">
                {bestNow.ranking.map((entry, index) => (
                  <li
                    key={entry.station.station_id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="w-4 shrink-0 font-mono text-slate-500">
                        {index + 1}.
                      </span>
                      <span className="truncate text-slate-200">
                        {entry.station.name}
                      </span>
                      {entry.station.brand && (
                        <span className="shrink-0 text-slate-500">
                          {entry.station.brand}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="font-mono font-bold text-slate-100 tabular-nums">
                        {euroPerLiter(entry.price)}
                      </span>
                      {bestNow.price !== null && index > 0 && (
                        <span className="ml-2 font-mono text-slate-500 tabular-nums">
                          +{centPerLiter((entry.price - bestNow.price) * 100)}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {bestNow.mapsUrl && (
                <a
                  href={bestNow.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"
                >
                  Route zur günstigsten
                  <ArrowRight size={15} aria-hidden="true" />
                </a>
              )}
              <button
                onClick={() => onNavigate("stations")}
                className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-2.5 text-xs font-semibold text-slate-200 hover:border-slate-600"
              >
                Alle {bestNow.freshCount} Preise vergleichen
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ② Drei Fakten */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {facts.map((fact, index) => (
          <div key={fact.label} className={`${panel} p-4`}>
            <div className="text-xs uppercase tracking-widest text-slate-500">
              {fact.label}
            </div>
            <div className="mt-1 text-lg font-bold text-white tabular-nums">
              {fact.value}
            </div>
            <div className="mt-1 text-xs leading-relaxed text-slate-400">
              {fact.detail}
            </div>
            {/* Tankstand als Fakt: Schnellauswahl statt Formular (§5.1). */}
            {index === 2 && (
              <div className="mt-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {TANK_QUICK.map((item) => (
                    <button
                      key={item.percent}
                      onClick={() =>
                        onTankQuick(tankPercent === item.percent ? null : item.percent)
                      }
                      aria-pressed={tankPercent === item.percent}
                      title={`${item.percent} % Füllstand setzen`}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-bold ${
                        tankPercent === item.percent
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                          : "border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                  {tankPercent !== null && (
                    <button
                      onClick={() => onTankQuick(null)}
                      className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-500 hover:text-slate-300"
                    >
                      Keine Angabe
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  {tankPercent !== null
                    ? `Füllstand ${deTrimmed(tankPercent, 0)} % — Pflege in „Woche“.`
                    : "Ein Tap, dann prüft die App, ob Warten riskant ist."}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ③ Nächste Schritte */}
      {steps.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-semibold text-slate-200">
            Nächste Schritte
          </h2>
          <div className="mt-2 grid gap-2">
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

      {/* ④ Heute im Blick — seit 0.36.0 mit Zahlen statt nur Farben
          (Nutzer-Feedback 14.09.2026: „zu wenig Infos“). Alles aus den
          Zellen selbst: günstigste/teuerste offene Stunde, Tagesmedian,
          Abstand „jetzt“ zum Median und die Abdeckung. */}
      {stripCells.length > 0 && (
        <>
          <h2 className="mt-6 flex items-center gap-2 text-sm font-semibold text-slate-200">
            <CalendarDays size={15} className="text-emerald-400" aria-hidden="true" />
            Heute im Blick
          </h2>
          <div className={`${panel} mt-2 p-4`}>
            <p className="text-xs leading-relaxed text-slate-300">
              {dayPanel.headline}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
                <p className="text-xs uppercase tracking-wider text-slate-500">
                  Günstigste Stunde
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
            <div className="daystrip-cells mt-3 grid gap-1.5">
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
                            : cell.tone === "mid"
                              ? "border-slate-700/40 bg-slate-800/40"
                              : "border-slate-800 bg-slate-950/40"
                    }`}
                  >
                    <span
                      aria-hidden="true"
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
                    <span
                      className={`font-mono text-[0.625rem] ${
                        cell.current ? "text-emerald-200" : "text-slate-500"
                      }`}
                    >
                      {String(cell.hour).padStart(2, "0")}
                    </span>
                    {/* U2: Wert in 0,625 rem (10 px) — die Mobil-Zelle ist
                        ~34 px schmal; voller Preis steht zusätzlich im
                        `title` und `aria-label` jeder Zelle. */}
                    <span
                      className={`font-mono text-[0.625rem] leading-tight tabular-nums ${
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
              {dayPanel.coverage} Zahl = €/L · Balken = Höhe im Tagesverlauf ·
              grün = unteres Drittel · rot = oberes Drittel · Rahmen = jetzt.
            </p>
          </div>
        </>
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
