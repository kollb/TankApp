// Übersicht — die Antwort auf eine Frage (docs/produkt/UI.md, Bereiche;
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
// genau einem Ort gepflegt („Einstellungen“ → Fahrzeug), hier steht er nur im
// „Warum?“ -Blatt, wenn er die Entscheidung trägt.

import { useEffect, useState } from "react";
import { ArrowRight, ChevronRight, Compass } from "lucide-react";
import { BottomSheet } from "../components/BottomSheet";
import { DayCurve } from "../components/DayCurve";
import { FreshnessChip } from "../components/FreshnessChip";
import { GuideBanner } from "../components/GuideBanner";
import { LineChart } from "../components/LineChart";
import { useChartPalette } from "../chartTheme";
import { calendarHintLines, weekRanking } from "../week";
import { atlasRows } from "../stations";
import { Level1Sheet } from "../components/Level1Sheet";
import { LoadError } from "../components/LoadError";
import { RegimeNotice } from "../components/RegimeNotice";
import { SkeletonPanel } from "../components/Skeleton";
import { panel } from "../components/ui";
import {
  autoTimeTicks,
  centPerLiter,
  currentPrice,
  kilometersLabel,
  segments,
  euro,
  euroPerLiter,
  windowTimeRangeLabel,
  type Point,
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
  nowBestNow,
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
  priceOf?: (station: Station) => number | null;
  selectedId: string;
  stripCells: StripCell[];
  series7d?: ResourceState<{ points: Point[]; error_code: string | null } | null>;
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
 * exakt die Farbwelt der Vorlage (docs/produkt/GUI-VORLAGEN.md). „Rot bleibt dem
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
    priceOf,
    selectedId,
    stations,
    stripCells,
    series7d,
  } = props;
  const [timeView, setTimeView] = useState<"history" | "today" | "week">("today");
  const colors = useChartPalette();
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
  const reasonLines = (decide?.reason_codes ?? []).map((reason) => reason.text);
  const calendarLines = calendarHintLines(decide?.calendar_hints, now);
  const day = nowDayRow(stripCells);
  const freshness = nowFreshness({ pricesAt, forecastAt, now });
  const validity = nowValidity(answer, now);
  const best = nowBestNow(input);
  // Top-5 nach **effektivem Gesamtpreis** für die Tankmenge — dieselbe Zahl,
  // gegen die Zeile 1 (Bestpreis) gemessen wird. Reine Regalpreise würden die
  // Umwegkosten verschweigen (UI-Neuentwurf, Übersicht Ebene 3).
  const allRows = atlasRows({
    stations, priceOf: priceOf ?? ((station) => currentPrice(station, online ?? true, 0)),
    selectedId, pinnedIds: [], liters: calculationLiters,
    serverReferenceId: decide?.primary?.station?.id ?? null,
    serverAlts: decide?.alternatives_nearby ?? [], worthThreshold: null, borderlineThreshold: null,
  });
  const totalEur = (row: (typeof allRows)[number]) => {
    const net = row.netEur !== null && row.serverPriceFresh !== false;
    if (net) return row.netEur as number;
    return row.price === null ? null : row.price * calculationLiters;
  };
  const sortedRows = allRows
    .filter((row) => row.price !== null)
    .sort(
      (a, b) =>
        (totalEur(a) ?? Infinity) - (totalEur(b) ?? Infinity) ||
        (a.price ?? Infinity) - (b.price ?? Infinity),
    );
  const rows = sortedRows.slice(0, 5);

  const week = weekRanking({ windows: decide?.windows_week, notice: decide?.regime_notice, decide, referencePrice: best.price, liters: calculationLiters, now });
  const historyPoints = (series7d?.data?.points ?? [])
    .filter((point) => Number.isFinite(Date.parse(point.timestamp)) && Date.parse(point.timestamp) >= now - 72 * 3600000 && Date.parse(point.timestamp) <= now)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const historySeries = segments(historyPoints).map((series) => ({ ...series, color: colors.accent }));
  const points = historyPoints
    .filter((point) => point.status === "open" && point.price !== null && Number.isFinite(point.price))
    .map((point) => ({ x: Date.parse(point.timestamp), y: point.price as number }));
  const weekPoints = week.map((entry) => ({ x: Date.parse(entry.start), y: entry.expectedPrice })).sort((a, b) => a.x - b.x);

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
          Übersicht
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
                className={`mt-2 max-w-xl text-xs leading-relaxed ${SUB_TONE[answer.tone]}`}
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

      <div id="jetzt-tag" className={`${panel} mt-3 scroll-mt-24 p-4`}>
        <div role="tablist" aria-label="Zeitraum" onKeyDown={(event) => {
          const ids = ["history", "today", "week"] as const;
          const current = ids.indexOf(timeView);
          const next = event.key === "ArrowRight" ? (current + 1) % ids.length : event.key === "ArrowLeft" ? (current + ids.length - 1) % ids.length : event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1 : -1;
          if (next < 0) return;
          event.preventDefault();
          setTimeView(ids[next]);
          (event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus();
        }} className="flex flex-wrap gap-1 rounded-lg bg-sc-low p-1">
          {([["history", "3 Tage zurück"], ["today", "Heute"], ["week", "Woche"]] as const).map(([id, label]) => (
            <button id={`zeitraum-tab-${id}`} key={id} role="tab" aria-selected={timeView === id} tabIndex={timeView === id ? 0 : -1} aria-controls="zeitraum-chart" onClick={() => setTimeView(id)} className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold ${timeView === id ? "bg-sc-lowest text-on-surface" : "text-slate-400"}`}>
              {label}
            </button>
          ))}
        </div>
        <div id="zeitraum-chart" role="tabpanel" aria-labelledby={`zeitraum-tab-${timeView}`} className="mt-4">
          {timeView === "today" && (day ? <>
            <DayCurve cells={day.cells} label={`Tagesverlauf 06–24 Uhr — ${day.sentence}`} />
            <button id="jetzt-tagzeile" onClick={() => setDayOpen(true)} aria-haspopup="dialog" className="mt-2 text-sm text-slate-300">Heute: {day.label} <ChevronRight size={16} className="inline" aria-hidden="true" /></button>
          </> : <p className="text-sm text-slate-400">Noch kein Tagesverlauf vorhanden.</p>)}
          {timeView === "history" && (points.length >= 2 ? <>
            <LineChart series={[
              ...historySeries,
              ...(best.price === null ? [] : [{ name: "Aktueller Bestpreis", color: colors.text, dash: "4 3", pts: [{ x: points[0].x, y: best.price }, { x: points[points.length - 1].x, y: best.price }] }]),
            ]} xTicks={autoTimeTicks(points[0].x, points[points.length - 1].x)} yFmt={(value) => euro(value, 3)} ariaLabel="Preisverlauf der gewählten Station" />
            {best.price !== null && <p className="mt-2 text-xs text-slate-400">Gestrichelt: aktueller Bestpreis {euroPerLiter(best.price)}</p>}
          </> : <p className="text-sm text-slate-400">{series7d?.pending ? "Verlauf wird geladen." : "Noch nicht genügend Preismeldungen für den Verlauf."}</p>)}
          {timeView === "week" && calendarLines.length > 0 && (
            <ul className="mb-3 space-y-1 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs leading-relaxed text-slate-300" aria-label="Feiertage und Brückentage">
              {calendarLines.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
          {timeView === "week" && (week.length ? <>
            <LineChart series={[{ name: "Erwarteter Preis", color: colors.accent, pts: weekPoints }]} yFmt={(value) => euro(value, 3)} ariaLabel="Beste Zeitfenster der Woche" />
            <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {week.map((entry) => <li key={entry.id} className="rounded-lg bg-sc-low p-3 text-sm"><span className="font-semibold">{entry.dayLabel}</span><br />{windowTimeRangeLabel(entry.start, entry.end, true)}<br /><span className="text-xs text-slate-400">{entry.priceLabel}{entry.savingLabel ? ` · ${entry.savingLabel}` : ""}</span></li>)}
            </ol>
          </> : <p className="text-sm text-slate-400">Noch keine Zeitfenster für die Woche vorhanden.</p>)}
        </div>
      </div>

      {rows.length > 0 && !problem && (
        <section className={`${panel} mt-3 p-4`} aria-labelledby="jetzt-stationen-title">
          <h2 id="jetzt-stationen-title" className="text-sm font-semibold text-slate-100">Stationen im Vergleich</h2>
          <table className="mt-3 w-full table-fixed text-left text-xs text-slate-300">
            <thead className="text-slate-500"><tr><th className="w-[30%] pb-2 font-medium">Station</th><th className="w-[24%] pb-2 font-medium">Preis &amp; Diff.</th><th className="w-[29%] pb-2 font-medium">Umweg &amp; Netto</th><th className="pb-2 font-medium">Route</th></tr></thead>
            <tbody className="divide-y divide-outline-variant/40">{rows.map((row) => {
              const difference = row.price !== null && best.price !== null ? (row.price - best.price) * 100 : null;
              const net = row.netEur !== null && row.serverPriceFresh !== false;
              return <tr key={row.station.station_id}><td className="break-words py-3 pr-2">{row.station.name}</td><td className="py-3 pr-2 tabular-nums">{euroPerLiter(row.price)}<br /><span className="text-slate-500">{difference !== null ? centPerLiter(difference) : "—"}</span></td><td className="py-3 pr-2 tabular-nums">{net && row.detourKm !== null ? kilometersLabel(row.detourKm, 1) : "—"}<br />{net ? `${euro(row.netEur!)} €` : "—"}</td><td className="py-3">{row.station.maps_url ? <a href={row.station.maps_url} target="_blank" rel="noopener noreferrer" aria-label={`Route zu ${row.station.name}`} className="underline">Route</a> : "—"}</td></tr>;
            })}</tbody>
          </table>
          <details className="mt-2 text-xs text-slate-400"><summary className="cursor-pointer">Warum &amp; Rechenweg</summary><p>Sortiert nach dem, was die Tankmenge real kostet: Regalpreis mal Liter plus Umwegkosten. Die Spalte „Diff.“ misst jede Zeile am Bestpreis der ersten Zeile; Netto und Umweg stammen aus dem Vergleich des Servers mit der gewählten Referenzstation — ohne passende frische Angaben bleiben sie leer.</p></details>
          <button
            type="button"
            onClick={() => onNavigate("stations")}
            className="tap-44 mt-3 inline-flex items-center gap-1 text-xs font-semibold text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
          >
            {sortedRows.length === 0
              ? "Alle Stationen & Karte anzeigen"
              : `Alle ${sortedRows.length} Stationen & Karte anzeigen`}
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </section>
      )}

      {why && (
        <Level1Sheet
          open={sheetOpen}
          title="Warum diese Empfehlung?"
          sentences={why.lines}
          source={why.source}
          labHint={why.labHint}
          visual={reasonLines.length ? (
            <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-300">
              {reasonLines.map((line) => <li key={line}>{line}</li>)}
            </ul>
          ) : null}
          visualLabel={reasonLines.length ? "Dazu zählt in dieser Entscheidung:" : undefined}
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
