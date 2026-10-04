// Jetzt — die Antwort auf eine Frage (docs/produkt/UI.md, Bereiche;
// docs/planung/UX-NEUENTWURF.md §3).
//
// Frage: „Soll ich jetzt tanken — und wenn ja, wo?“
// Ebene 1 ist genau diese Karte: höchstens 25 Wörter, eine Zahl, eine
// Handlung. Ebene 2 liegt einen Tipp entfernt: das „Warum?“ -Blatt
// (höchstens fünf Zeilen) und die Tageskurve. Ebene 3 ist das Labor —
// erreichbar über denselben Weg wie überall („Im Labor vertiefen“).
//
// Die View rendert, sie entscheidet nichts (D1): Ausgänge, Zahlen,
// Begründung und Frische kommen aus `now.ts` und sind dort getestet.
//
// Was hier **nicht** mehr steht (Streichliste §7): Was-wäre-wenn-Annahmen,
// Feedback-Intents, nächste Schritte, drei Fakten-Karten mit Tankstands-
// Schnellauswahl, das 19-Zellen-Raster „Heute im Blick“, der Benefit-Block,
// der Sicherheits-Balken und die Frische-Fußzeile. Der Tankstand wird an
// genau einem Ort gepflegt („Ich“ → Fahrzeug), hier steht er nur im
// „Warum?“ -Blatt, wenn er die Entscheidung trägt.

import { useEffect, useState } from "react";
import { ArrowRight, ChevronRight, Compass } from "lucide-react";
import { BottomSheet } from "../components/BottomSheet";
import { DayCurve } from "../components/DayCurve";
import { FreshnessChip } from "../components/FreshnessChip";
import { GuideBanner } from "../components/GuideBanner";
import { Level1Sheet } from "../components/Level1Sheet";
import { LoadError } from "../components/LoadError";
import { RegimeNotice } from "../components/RegimeNotice";
import { SkeletonPanel } from "../components/Skeleton";
import { panel } from "../components/ui";
import {
  euroPerLiter,
  fuelLabel,
  timeOfDayLabel,
  type DecideResult,
  type Fuel,
  type ResourceState,
  type Station,
} from "../data";
import { guideLevel } from "../guide";
import type { LabSectionId } from "../lab";
import {
  nowAnswer,
  nowDayRow,
  nowFreshness,
  nowValidity,
  nowWhy,
  type NowTarget,
} from "../now";
import type { StripCell } from "../strip";

export interface JetztViewProps {
  activeCity: string;
  /** Kraftstoff der Sicht — der Kopf nennt ihn neben der Stadt. */
  fuel: Fuel | string | null;
  /** Effektive Liter (Profil, ggf. vom Server gekappt) — für die €-Zahlen. */
  liters: number;
  decideRes: ResourceState<DecideResult>;
  stations: Station[];
  selectedId: string;
  stripCells: StripCell[];
  /** Jüngste Preismeldung — der Frische-Chip im Kopf nennt ihr Alter. */
  pricesAt: string | null;
  /** Stand des Modell-Laufs (`forecastStamp`). */
  forecastAt: string | null;
  /**
   * Verbindung des Geräts (`navigator.onLine`). Ohne Verbindung trägt die
   * Karte den letzten Stand — offline schlägt alles. `undefined` gilt als
   * online (Tests, erste Frames).
   */
  online?: boolean;
  /** Ziele des Neuentwurfs — jetzt echte Bereiche. */
  onNavigate: (target: NowTarget) => void;
  /** Ebene 3 ansteuern: der Labor-Abschnitt, der diese Zahl beweist (§7). */
  onDeepen: (section: LabSectionId) => void;
  onRetry: () => void;
  /** Nur für Tests; sonst Date.now(). */
  now?: number;
}

/*
 * Urteilstöne (GUI v2, Material You): Grün = jetzt handeln, Blau =
 * warten bis Fenster, Rot = echtes Risiko (Tankrest blockiert das
 * Warten), Grau = ehrlich unentschieden. Die Flächen kommen aus den
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

export function JetztView(props: JetztViewProps) {
  const {
    activeCity,
    decideRes,
    fuel,
    forecastAt,
    liters,
    now: fixedNow,
    onDeepen,
    onNavigate,
    onRetry,
    online,
    pricesAt,
    selectedId,
    stations,
    stripCells,
  } = props;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dayOpen, setDayOpen] = useState(false);

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
  const input = {
    decide,
    stations,
    selectedId,
    liters: calculationLiters,
    now,
    online: online ?? true,
    pricesAt,
    forecastAt,
  };
  const answer = nowAnswer(input);
  const why = nowWhy(input);
  const day = nowDayRow(stripCells);
  const freshness = nowFreshness({ pricesAt, forecastAt, now });
  const validity = nowValidity(answer, now);
  /**
   * 3-Stufen-Fallback des Guides: Stufe 1 live + Prognose, Stufe 2 ohne
   * Prognose (Preise live), Stufe 3 offline (letzter Stand). Abgeleitet
   * aus echten Zuständen, nie aus einer Vermutung (`guide.ts`).
   */
  const level = guideLevel({
    online: online ?? true,
    decisionReady: decide?.decision_ready ?? null,
  });

  // S0 „Einrichten“: noch keine Stationen, noch keine Antwort — die Karte
  // erklärt die drei Schritte, statt eine Empfehlung zu erfinden.
  const setup = !answer && stations.length === 0 && !decideRes.error;
  /**
   * Ein benannter Fehler (Server-`error_code` oder fehlgeschlagener Abruf)
   * gewinnt vor der Tatsachenkarte: „Günstigste gerade: …“ aus einem alten
   * Stand würde Frische behaupten, die nicht gilt (§3: eine Antwort, die
   * stimmt — oder der Fehler im Klartext).
   */
  const problem = !setup && Boolean(problemCode);

  return (
    <section aria-labelledby="jetzt-title">
      {/* Kopf: Frage, Ort und der Frische-Chip — ein Ort für das Alter (§6). */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h1
          id="jetzt-title"
          className="text-2xl font-bold tracking-tight text-slate-100"
        >
          Jetzt
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          {activeCity ? <span>{activeCity}</span> : null}
          {fuel ? <span>· {fuelLabel(fuel)}</span> : null}
          <FreshnessChip label={freshness.chip} tone={freshness.tone} />
        </p>
      </div>

      {/* Genau ein Banner (§3): offline schlägt „keine Prognose“, diese
          schlägt den Hinweis. Wer morgens an der Säule steht, liest einen
          Grund, nicht drei. */}
      <div className="mt-3">
        {level !== "full" ? (
          <GuideBanner
            level={level}
            stand={timeOfDayLabel(pricesAt)}
            hasPrices={stations.length > 0}
            blockingReasons={decide?.blocking_reasons ?? null}
            retrying={decideRes.pending}
            onRetry={onRetry}
          />
        ) : (
          <RegimeNotice notice={decide?.regime_notice} />
        )}
      </div>

      {/* ① Die Antwortkarte — eine Frage, eine Antwort, eine Handlung. */}
      <div id="jetzt-antwort" className="mt-3 scroll-mt-24">
        {decideRes.pending && !decide && !setup && !problem ? (
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
        ) : problem ? (
          <div className={`${panel} p-5 sm:p-7`}>
            <LoadError
              errorCode={problemCode}
              detail={decide?.detail ?? null}
              fallback="Empfehlung derzeit nicht erreichbar."
              onRetry={onRetry}
            />
          </div>
        ) : answer ? (
          <div
            className={`${panel} p-5 sm:p-7 ${CARD_TONE[answer.tone]}`}
            aria-labelledby="jetzt-headline"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${CHIP[answer.tone]}`}
              >
                {answer.chip}
              </span>
              {validity && (
                <span
                  className={`text-xs tabular-nums ${SUB_TONE[answer.tone]}`}
                  title="Freigabe der Empfehlung — danach wird neu berechnet"
                >
                  {validity.label}
                </span>
              )}
            </div>
            <h2
              id="jetzt-headline"
              className={`mt-3 text-[1.625rem] font-extrabold tracking-tight sm:text-[1.75rem] ${STRONG_TONE[answer.tone]}`}
            >
              {answer.headline}
            </h2>
            {answer.lead && (
              <p
                className={`mt-2 text-2xl font-black tracking-tight tabular-nums sm:text-3xl ${STRONG_TONE[answer.tone]}`}
              >
                {answer.lead}
              </p>
            )}
            {answer.subline && (
              <p
                className={`mt-2 max-w-xl text-sm leading-relaxed ${SUB_TONE[answer.tone]}`}
              >
                {answer.subline}
              </p>
            )}
            {/* Genau eine primäre Handlung — „Warum?“ ist der Weg in die
                Tiefe, kein zweiter Knopf. */}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {answer.action && (
                <a
                  href={answer.action.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  /* `tap-44`: Die Route ist DIE Handlung an der Säule und war
                     als <a> mit 36 px unter dem Touch-Ziel (C5/WCAG 2.5.5). */
                  className="tap-44 m3-btn-now inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-bold"
                >
                  {answer.action.label}
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
            </div>
          </div>
        ) : (
          <div className={`${panel} p-5 sm:p-7`}>
            <p className="text-sm leading-relaxed text-slate-300">
              Noch keine Antwort — die Preise werden geladen.
            </p>
          </div>
        )}
      </div>

      {/* ② Die Tageszeile: eine Zeile, ein Tipp entfernt liegt die Kurve. */}
      {day && (
        <div id="jetzt-tag" className="mt-3 scroll-mt-24">
          <button
            id="jetzt-tagzeile"
            onClick={() => setDayOpen(true)}
            aria-haspopup="dialog"
            className={`${panel} flex w-full items-center gap-3 p-3 text-left transition hover:border-slate-700`}
          >
            <span className="min-w-0 flex-1 text-emerald-400">
              <DayCurve
                cells={day.cells}
                label={`Tagesverlauf 06–24 Uhr — ${day.sentence}`}
                compact
              />
            </span>
            <span className="shrink-0 text-sm font-semibold text-slate-200">
              Heute: {day.label}
            </span>
            <ChevronRight
              size={16}
              className="shrink-0 text-slate-500"
              aria-hidden="true"
            />
          </button>
        </div>
      )}

      {why && (
        <Level1Sheet
          open={sheetOpen}
          title="Warum diese Empfehlung?"
          sentences={why.lines}
          source={why.source}
          labHint={why.labHint}
          onDeepen={(section) => {
            setSheetOpen(false);
            onDeepen(section);
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {day && (
        <BottomSheet
          open={dayOpen}
          title="Heute — Tagesverlauf"
          onClose={() => setDayOpen(false)}
        >
          <div className="mt-3">
            <DayCurve
              cells={day.cells}
              label={`Tagesverlauf 06–24 Uhr — ${day.sentence}`}
            />
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              {day.sentence}
            </p>
            <dl className="mt-3 grid grid-cols-1 gap-1 text-xs leading-snug">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-slate-500">Tiefster Preis</dt>
                <dd className="font-mono font-semibold text-emerald-300 tabular-nums">
                  {day.low
                    ? `${euroPerLiter(day.low.value)} · ${String(day.low.hour).padStart(2, "0")} Uhr`
                    : "—"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-slate-500">Jetzt</dt>
                <dd className="font-mono font-semibold text-slate-200 tabular-nums">
                  {day.now !== null ? euroPerLiter(day.now) : "—"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-slate-500">Tagesmedian</dt>
                <dd className="font-mono font-semibold text-slate-200 tabular-nums">
                  {day.median !== null ? euroPerLiter(day.median) : "—"}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              {day.coverage} Höhe = Preis, oben teurer — leere Stunden bleiben
              Lücken, sie werden nicht geschätzt.
            </p>
          </div>
        </BottomSheet>
      )}
    </section>
  );
}
