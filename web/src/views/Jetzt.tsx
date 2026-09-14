// Jetzt — der erste Bereich des GUI-Neuentwurfs (docs/UI-NEUENTWURF.md §5.1).
//
// Feste Reihenfolge, nie anders:
//   ① Entscheidung (genau eine Karte, volle Breite, vier Ausgänge)
//   ② Drei Fakten (Jetzt hier · Bestes Fenster heute · Tank reicht?)
//   ③ Nächste Schritte (höchstens drei Zeilen)
//   ④ Heute im Blick (kompakter Tagesstreifen) — darunter die Frische-Fußzeile
//
// Die View rendert, sie entscheidet nichts (D1): Ausgänge, Fakten, Schritte,
// Frische und Begründung kommen aus `now.ts` und sind dort getestet. Der
// graue Ausgang ist ein erster Klasse-Zustand (S0/S1/S2/S3, §10) — kein
// Fehler, keine leere Fläche.
//
// Bewusster Stand des Schnitts: „Stationen“ und „Woche“ gibt es als Bereiche
// noch nicht; die Schritte nennen ihr Ziel und die Dashboard-Root übersetzt
// es vorläufig auf den bestehenden Alltagstab. Die Checkliste
// (docs/UMSETZUNG-GUI-NEUENTWURF.md) führt diese Übergänge auf.

import { useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Compass,
  Settings2,
} from "lucide-react";
import { Level1Sheet } from "../components/Level1Sheet";
import { LoadError } from "../components/LoadError";
import { SkeletonPanel } from "../components/Skeleton";
import { panel } from "../components/ui";
import {
  euro,
  euroPerLiter,
  type DecideResult,
  type ResourceState,
  type Station,
} from "../data";
import {
  nowExplanation,
  nowFacts,
  nowFreshness,
  nowSteps,
  nowVerdict,
  type NowTarget,
} from "../now";
import type { StripCell } from "./Daily";

export interface JetztViewProps {
  activeCity: string;
  liters: number;
  decideRes: ResourceState<DecideResult>;
  stations: Station[];
  selectedId: string;
  stripCells: StripCell[];
  /** Jüngste Preismeldung — die Fußzeile nennt das Alter, nicht „gerade eben“. */
  pricesAt: string | null;
  forecastAt: string | null;
  /** Ziele des Neuentwurfs; die Root übersetzt sie bis Phase 1/2 auf Tabs. */
  onNavigate: (target: NowTarget) => void;
  /** Ebene 2 ansteuern (bis Phase 3: die Werkstatt). */
  onDeepen: () => void;
  onOpenSettings: () => void;
  onRetry: () => void;
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

const CHIP_TEXT = {
  refuel_now: "● Jetzt tanken",
  wait: "▼ Warten",
  refuel_elsewhere: "→ Woanders tanken",
  no_advice: "– Keine Empfehlung",
} as const;

const FRESHNESS_TONE = {
  ok: "text-slate-500",
  warn: "text-amber-300",
  bad: "text-rose-300",
} as const;

export function JetztView(props: JetztViewProps) {
  const {
    activeCity,
    decideRes,
    forecastAt,
    liters,
    now,
    onDeepen,
    onNavigate,
    onOpenSettings,
    onRetry,
    pricesAt,
    selectedId,
    stations,
    stripCells,
  } = props;
  const [sheetOpen, setSheetOpen] = useState(false);
  const decide = decideRes.data ?? null;
  const input = { decide, stations, selectedId, liters, now };
  const verdict = nowVerdict(input);
  const facts = nowFacts(input);
  const steps = nowSteps(input);
  const freshness = nowFreshness({ pricesAt, forecastAt, now });
  const explanation = nowExplanation({ ...input, pricesAt });

  // S0 „Einrichten“: noch keine Stationen, noch keine Preise — die Karte
  // erklärt die drei Schritte, statt eine Empfehlung zu erfinden.
  const setup = !decide && stations.length === 0;

  return (
    <section aria-labelledby="jetzt-title">
      <h1 id="jetzt-title" className="text-2xl font-bold tracking-tight text-white">
        Jetzt
      </h1>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">
        Eine Entscheidung, drei Fakten, nächste Schritte.
      </p>

      {/* ① Entscheidung */}
      <div className="mt-4">
        {decideRes.pending && !decide && !setup ? (
          <SkeletonPanel lines={3} label="Empfehlung wird berechnet" />
        ) : decideRes.error && !decide ? (
          <LoadError
            errorCode={decideRes.errorCode}
            fallback="Empfehlung derzeit nicht erreichbar."
            onRetry={onRetry}
            compact
          />
        ) : setup ? (
          <div className={`${panel} p-5 sm:p-7`}>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${CHIP.gray}`}
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
        ) : verdict ? (
          <>
            <div
              className={`${panel} p-5 sm:p-7 ${CARD_TONE[verdict.tone]}`}
              aria-labelledby="jetzt-headline"
            >
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${CHIP[verdict.tone]}`}
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
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  {verdict.stageNote}
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
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"
                  >
                    Route
                    <ArrowRight size={15} aria-hidden="true" />
                  </a>
                )}
              </div>
              {/* Gray ist ein erster Klasse-Zustand: die Aktualpreise stehen
                  darunter, statt den Nutzer ohne Zahlen zu lassen. */}
              {verdict.action === "no_advice" && stations.length > 0 && (
                <ul className="mt-4 grid gap-1 font-mono text-[11px] text-slate-300">
                  {[...stations]
                    .filter((s) => s.price != null)
                    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
                    .slice(0, 3)
                    .map((s) => (
                      <li key={s.station_id} className="flex justify-between gap-3">
                        <span className="truncate" title={s.name}>
                          {s.name}
                        </span>
                        <span className="shrink-0">{euroPerLiter(s.price)}</span>
                      </li>
                    ))}
                </ul>
              )}
              <details className="mt-4 text-[11px] text-slate-400">
                <summary className="cursor-pointer">
                  Annahmen: {liters} L Tankmenge
                </summary>
                <p className="mt-2 leading-relaxed">
                  Liter, Zeitwert und Umweg-Modus wirken auf die Rechnung. Sie
                  stehen in den Einstellungen, damit dieselben Werte in jeder
                  Ansicht gelten.
                </p>
                <button
                  onClick={onOpenSettings}
                  className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-sky-300 hover:text-sky-200"
                >
                  <Settings2 size={13} aria-hidden="true" />
                  Annahmen ändern
                </button>
              </details>
            </div>
          </>
        ) : (
          <div className={`${panel} p-5 sm:p-7`}>
            <p className="text-sm leading-relaxed text-slate-300">
              Noch keine Empfehlung — die Preise werden geladen.
            </p>
          </div>
        )}
      </div>

      {/* ② Drei Fakten */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {facts.map((fact) => (
          <div key={fact.label} className={`${panel} p-4`}>
            <div className="text-[11px] uppercase tracking-widest text-slate-500">
              {fact.label}
            </div>
            <div className="mt-1 text-lg font-bold text-white tabular-nums">
              {fact.value}
            </div>
            <div className="mt-1 text-[11px] leading-relaxed text-slate-400">
              {fact.detail}
            </div>
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

      {/* ④ Heute im Blick */}
      {stripCells.length > 0 && (
        <>
          <h2 className="mt-6 flex items-center gap-2 text-sm font-semibold text-slate-200">
            <CalendarDays size={15} className="text-emerald-400" aria-hidden="true" />
            Heute im Blick
          </h2>
          <div className={`${panel} mt-2 p-4`}>
            <div className="daystrip-cells grid grid-cols-6 gap-1.5 sm:grid-cols-12">
              {stripCells.map((cell) => (
                <div
                  key={cell.hour}
                  title={
                    cell.value === null
                      ? `${String(cell.hour).padStart(2, "0")}:00 — keine offene Meldung`
                      : `${String(cell.hour).padStart(2, "0")}:00 — ${euro(cell.value, 3)} €/L`
                  }
                  className={`rounded-lg border py-1 text-center font-mono text-[10px] ${
                    cell.current
                      ? "border-emerald-400 bg-emerald-950/80 text-emerald-200"
                      : cell.tone === "cheap"
                        ? "border-emerald-500/30 bg-emerald-900/30 text-emerald-200/90"
                        : cell.tone === "pricey"
                          ? "border-rose-500/30 bg-rose-950/30 text-rose-200/90"
                          : cell.tone === "mid"
                            ? "border-slate-700/40 bg-slate-800/40 text-slate-300"
                            : "border-slate-800 bg-slate-950/40 text-slate-500"
                  }`}
                >
                  {String(cell.hour).padStart(2, "0")}
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Farbig = eher günstig · rot = eher teuer · leer = keine offene
              Meldung · Rahmen = jetzt
            </p>
          </div>
        </>
      )}

      {/* Frische-Fußzeile */}
      <p
        role="status"
        className={`mt-4 text-[11px] leading-relaxed ${FRESHNESS_TONE[freshness.tone]}`}
      >
        {freshness.text} · {activeCity || "kein Ort gewählt"}
      </p>

      {explanation && (
        <Level1Sheet
          open={sheetOpen}
          title="Warum diese Empfehlung?"
          sentences={explanation.sentences}
          source={explanation.source}
          labHint={explanation.labHint}
          onDeepen={() => {
            setSheetOpen(false);
            onDeepen();
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </section>
  );
}
