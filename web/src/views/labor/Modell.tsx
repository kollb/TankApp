// B5 Sub-Tab: Modell & Parameter — 8 Karten in Kettenreihenfolge (safe JSX)
import { useEffect, useMemo, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Empty } from "../../components/ui";
import { LoadError } from "../../components/LoadError";
import { SkeletonChart } from "../../components/Skeleton";
import { LineChart } from "../../components/LineChart";
import { DeltaBars } from "../../components/LabCharts";
import { useChartPalette } from "../../chartTheme";
import { lineChartAlt, deltaBarsAlt } from "../../chartAlt";
import {
  MASE_24H,
  MASE_ONE_STEP,
  autoTimeTicks,
  centPerLiter,
  dataReachLabel,
  deNumber,
  deTrimmed,
  euro,
  euroPerLiter,
  formatHour,
  lawFloorNote,
  timeLabel,
  timeSpanLabel,
  rowOutcome,
  type Point,
} from "../../data";
import { labSection, type LabSectionId, PARAM_CARDS, betaCredibleInterval } from "../../lab";
import { useOverview } from "../../state/overview";
import { useLaborModel } from "../laborModel";
import { ForTheCurious, LabBlock, ReadingAid, SelfCheck, ThreeSentences, ParamCardShell } from "./components";

/** R3/F3 + MICROCOPY T5: Diese Lesehilfe stand zweimal im Text — dieselbe
 *  Aussage, ein Baustein. */
const DELTA_BARS_AID = {
  headline: "Links heißt günstiger als der Stadt-Median, rechts heißt teurer.",
  text:
    "Werte aus der Stations-Auswahl: δ̂ mit Bootstrap-Konfidenzintervall (senkrechter Strich) und " +
    "Signifikanz nach Benjamini-Hochberg — blasse Balken sind nicht signifikant. Der Strich in der " +
    "Mitte ist der Stadt-Median.",
};

export function ModellView({
  focusSection,
  onFocusHandled,
}: {
  focusSection: LabSectionId | null;
  onFocusHandled: () => void;
}) {
  const c = useChartPalette();
  const ov = useOverview();
  const {
    activeCity,
    forecast,
    history,
    observations,
    selection,
    selected,
    setSelectedId,
    setSpanHours,
    spanHours,
    spanLabel,
    statsSummaryRes,
    liters,
    refreshNow,
  } = ov;

  const [eps, setEps] = useState(1.0);
  const [labDayIdx, setLabDayIdx] = useState(13);
  const {
    activeLabDayRow,
    activeLabOutcome,
    anchorHour,
    anchorLabel,
    labData,
    labDayClass,
    labModel,
    labMu,
    labPredHour,
    labRows,
    labSaves,
  } = useLaborModel(ov, eps, labDayIdx);

  const [open, setOpen] = useState<Record<LabSectionId, boolean>>({
    prognose: false,
    sicherheit: false,
    stationen: true,
    lernen: false,
    glossar: false,
    spielplatz: true,
  });
  const blockRefs = useRef<Record<string, HTMLElement | null>>({});

  const toggle = (id: LabSectionId) => setOpen((cur) => ({ ...cur, [id]: !cur[id] }));
  const jumpTo = (id: LabSectionId) => {
    setOpen((cur) => ({ ...cur, [id]: true }));
    blockRefs.current[id]?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (!focusSection) return;
    if (focusSection === "stationen" || focusSection === "spielplatz") {
      jumpTo(focusSection);
      onFocusHandled();
    }
    if (typeof focusSection === "string" && (focusSection as string).startsWith("karte-")) {
      const el = document.getElementById(focusSection);
      el?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      onFocusHandled();
    }
  }, [focusSection, onFocusHandled]);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    if (hash.startsWith("karte-")) {
      setTimeout(() => {
        document.getElementById(hash)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, []);

  const selLaw = lawFloorNote(selection.data);
  /** R3/F3: Das Selektionsfenster steht im Payload (`Selection` extends
   *  `DataReach`) — die Werkstatt nennt es, statt Wochen zu behaupten. */
  const selReach = useMemo(() => dataReachLabel(selection.data ?? {}), [selection]);
  const stationDeltas = useMemo(() => {
    const rows = selection.data?.stations ?? [];
    return rows
      .filter((row) => Number.isFinite(row.delta_ct ?? Number.NaN))
      .map((row) => ({
        id: row.station_id,
        label: row.name || row.station_id,
        deltaCt: row.delta_ct as number,
        ciLo: Number.isFinite(row.ci_lo ?? Number.NaN) ? (row.ci_lo as number) : null,
        ciHi: Number.isFinite(row.ci_hi ?? Number.NaN) ? (row.ci_hi as number) : null,
        significant: row.significant === true,
      }));
  }, [selection]);

  const f: any = forecast.data ?? null;
  const beta = f?.beta as number[] | null;
  const arPhi = f?.ar_phi as number[] | null;
  // Befund N1c (23.09.2026, Runde 2): ``ar_detail`` ist je Kern
  // verschachtelt (``harmonic_ar2``/``profile_ar2``) und trägt
  // ``root_radius``/``root_radius_raw`` — nicht ``root_modulus``/``stable``
  // auf Top-Level. Gewählt wird der Kern, den die Veröffentlichung fährt
  // (``model_kind``), Rückfall der Hauptkern.
  const arDetailAll = f?.ar_detail as Record<string, any> | null | undefined;
  const arDetail = arDetailAll
    ? (arDetailAll[f?.model_kind] ?? arDetailAll.harmonic_ar2 ?? null)
    : null;
  const arRootRadius =
    typeof arDetail?.root_radius === "number" ? (arDetail.root_radius as number) : null;
  const arStable = arRootRadius != null ? arRootRadius < 1 : null;
  const ensemble = f?.ensemble as any;
  const dayPair = ((f?.day_pair ?? f?.backtest_day_pair) ?? null) as boolean | null;
  // Produktion publiziert den Ziehungsmodus des Laufs (``shared_draws``)
  // und den des Backtests (``backtest_shared_draws``); Alt-Payloads nur
  // den zweiten.
  const sharedDraws = ((f?.shared_draws ?? f?.backtest_shared_draws) ?? null) as
    | boolean
    | null;
  const bootstrapSamples = f?.bootstrap_samples as number | null;
  const pavaStats = f?.pava_pool_stats as any;
  // PAVA-Summen des veröffentlichten Kerns (Rückfall Hauptkern) — die
  // Statistik lebt je Kern unter ``totals``.
  const pavaTotals =
    (pavaStats?.totals?.[f?.model_kind] ??
      pavaStats?.totals?.harmonic_ar2 ??
      null) as
    | { pools?: number; pooled_points?: number; max_pool_size?: number }
    | null;
  // PIT-Zahl der Station: Der Payload verschachtelt je Horizont
  // (``pit.horizons["24h"].all.n``) — ``pit.n`` gab es nie.
  const pitN =
    typeof f?.pit?.horizons?.["24h"]?.all?.n === "number"
      ? (f.pit.horizons["24h"].all.n as number)
      : null;

  const dayCurve: Array<{ x: number; y: number }> =
    activeLabDayRow?.curve && activeLabDayRow.curve.length ? activeLabDayRow.curve : [];

  const scenario = useMemo(() => {
    if (!labRows.length) return null;
    const outcomes = labRows.map((row: any) => ({ outcome: rowOutcome(row, eps, liters) }));
    const wait = outcomes.filter((o) => o.outcome.wait).length;
    const hits = outcomes.filter((o) => o.outcome.hit).length;
    const regret = outcomes.reduce((sum, o) => sum + (o.outcome.wait && !o.outcome.hit ? (o.outcome.regretEur ?? 0) : 0), 0);
    return { days: outcomes.length, wait, hits, regret };
  }, [labRows, eps, liters]);

  const advice = statsSummaryRes.data?.live_advice ?? null;
  const thresholds = statsSummaryRes.data?.thresholds ?? null;
  const waitN = advice?.wait_n ?? 0;
  const waitHits = advice?.wait_hits ?? 0;
  const betaCI = waitN > 0 ? betaCredibleInterval(waitHits, waitN, 5, 5) : null;

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="rounded-lg border border-violet-500/20 bg-slate-900/60 p-4">
        <h2 className="text-sm font-semibold text-white">Parameterschrank — 8 Karten in Kette</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Struktur, AR(2), Bootstrap, 12-Uhr-Projektion, Ensemble, Selektion, Schwellen, Regime. Jede Karte: Satz,
          Diagramm, Parameter, Formel. B2/B3 Größen bei ihrer Karte, Beta(5,5)-CI auf Karte 7.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {PARAM_CARDS.map((card) => (
            <a
              key={card.id}
              href={`#${card.anchor}`}
              className="tap-44 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-400 hover:text-violet-200"
            >
              {card.number} · {card.title}
            </a>
          ))}
        </div>
      </div>

      <LabBlock id="stationen" open={open.stationen} onToggle={() => toggle("stationen")} headline="3 · Stationen" question={labSection("stationen").question} blockRef={(node) => { blockRefs.current.stationen = node; }}>
        <ThreeSentences
          sentences={[
            "Jede Station wird mit dem Stadt-Üblichen verglichen — mit dem Median derselben Stunde, nicht mit dem Durchschnitt.",
            "Der Abstand wird über Wochen gemittelt; Zufall mittelt sich heraus, ein System bleibt stehen.",
            "Was übrig bleibt, ist der Preis-Abstand: meist einige Cent unter dem Üblichen — oft günstig, nicht immer.",
          ]}
        />
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-xs font-semibold text-slate-200">Preis-Abstand je Station · {activeCity || "Stadt"}</p>
          {stationDeltas.length ? (
            <>
              <DeltaBars values={stationDeltas.map((r) => r.deltaCt)} labels={stationDeltas.map((r) => r.label)} whiskers={stationDeltas.map((r) => (r.ciLo != null && r.ciHi != null ? { lo: r.ciLo, hi: r.ciHi } : null))} muted={stationDeltas.map((r) => !r.significant)} fmt={centPerLiter} ariaLabel={`Preis-Abstand je Station, ${activeCity}`} ariaDescription={deltaBarsAlt({ values: stationDeltas.map((r) => r.deltaCt), labels: stationDeltas.map((r) => r.label), fmt: (v) => centPerLiter(v), muted: stationDeltas.map((r) => !r.significant) })} />
              <ReadingAid {...DELTA_BARS_AID} />
            </>
          ) : (
            <Empty>Noch kein delta_hat - braucht 1 Woche Preise je Station.</Empty>
          )}
          {selLaw && <p className={`mt-2 text-xs ${selLaw.tone === "warn" ? "text-amber-300/90" : "text-slate-500"}`}>{selLaw.text}</p>}
        </div>
      </LabBlock>

      <ParamCardShell anchor={PARAM_CARDS[0].anchor} number={PARAM_CARDS[0].number} title={PARAM_CARDS[0].title} chain={PARAM_CARDS[0].chain} sentence={PARAM_CARDS[0].sentence}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs font-semibold text-slate-200">Diagramm: Huber-Gewichte über der Tagesform</p>
            {beta && beta.length ? (
              <div className="mt-2">
                <div className="h-24 rounded bg-slate-900/60 p-2">
                  <div className="flex h-full items-end gap-px">
                    {/* Befund N1c (23.09.2026, Runde 2): relative Höhe zum
                        größten gezeigten Betrag — vorher skalierte
                        ``|v|·10`` jeden Koeffizienten ab 0,1 €/L auf 100 %
                        und alle Balken wirkten gleich hoch.
                    */}
                    {(() => {
                      const shown = beta.slice(0, 48);
                      const maxAbs = Math.max(...shown.map((v) => Math.abs(v)), 1e-9);
                      return shown.map((v, i) => (
                        <div key={i} className="flex-1 bg-violet-400/70" style={{ height: `${Math.max(2, (Math.abs(v) / maxAbs) * 100)}%` }} title={`beta[${i}]=${deNumber(v, 3)}`} />
                      ));
                    })()}
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-500">Beta-Vektor ({beta.length} Koeff.) robust per Huber-IRLS. Erste {Math.min(beta.length, 48)} gezeigt, Höhe relativ zum größten Betrag.</p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">Kein Beta-Vektor im Forecast-Payload.</p>
            )}
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <ForTheCurious>
              <p>Huber-Verlust: quadratisch nahe 0, linear fern — Ausreißer verbiegen die Tagesform nicht, IRLS
                  iteriert die Gewichte. holiday_beta gehört zur Struktur (Feiertags-Dummy in X), nicht zu AR(2).</p>
              <div className="rounded bg-slate-950/70 p-2 font-mono text-xs">{"L(beta)=Sum rho((y-Xbeta)/sigma) Huber k=1.345 IRLS"}</div>
              <p>B3 Struktur-Größe: holiday_beta={f?.holiday_beta != null ? deNumber(f.holiday_beta, 3) : "-"} Quelle: {f?.holiday_source ?? "-"} · Beta-Länge {beta?.length ?? "-"} (ones + 4 harmonic + 6 dow + after_law + jump_age = 13).</p>
            </ForTheCurious>
          </div>
        </div>
      </ParamCardShell>

      <ParamCardShell anchor={PARAM_CARDS[1].anchor} number={PARAM_CARDS[1].number} title={PARAM_CARDS[1].title} chain={PARAM_CARDS[1].chain} sentence={PARAM_CARDS[1].sentence}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs font-semibold text-slate-200">Diagramm: phi1/phi2 und Stabilität</p>
            {arPhi && arPhi.length >= 2 ? (
              <div className="mt-2 text-xs text-slate-300">
                <p>phi1={deNumber(arPhi[0], 3)} phi2={deNumber(arPhi[1], 3)} Wurzel-Radius {arRootRadius != null ? deNumber(arRootRadius, 3) : "-"} stabil {arStable === null ? "-" : arStable ? "ja" : "nein"}</p>
                <p className="mt-1 text-slate-500">shrink_events: {f?.ar_shrink_events ?? "-"} state_reset: {f?.ar_state_reset ? "ja" : "nein"} training: {f?.n_days ?? "-"} Tage, {f?.n_points ?? "-"} Punkte</p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">Kein AR(2) im Payload.</p>
            )}
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <ForTheCurious>
              <p>AR(2): Residuen mit phi1 und phi2. Stationär heißt: Beide Wurzeln liegen außerhalb des
                  Einheitskreises — sonst staucht der Fit mit 0,9. Stabilität (Wurzel-Radius unter 1)
                  sagt nichts über einen Level-Bruch: CUSUM kann Brüche melden, obwohl der Radius ruhig
                  wirkt. Beide Zeilen zusammen lesen, keine allein.</p>
              <div className="rounded bg-slate-950/70 p-2 font-mono text-xs">{"phi_hat Yule-Walker Check |lambda| kleiner 1 sonst phi mal 0.9"}</div>
              <p>AR-Größe: shrink_events={f?.ar_shrink_events ?? "-"} state_reset={f?.ar_state_reset ? "ja" : "nein"} — holiday_beta gehört zu Karte 1.</p>
            </ForTheCurious>
          </div>
        </div>
      </ParamCardShell>

      <ParamCardShell anchor={PARAM_CARDS[2].anchor} number={PARAM_CARDS[2].number} title={PARAM_CARDS[2].title} chain={PARAM_CARDS[2].chain} sentence={PARAM_CARDS[2].sentence}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs font-semibold text-slate-200">Diagramm: Tagesblock-Gewichte EW-HWZ</p>
            <p className="mt-2 text-xs text-slate-400">shared_draws={sharedDraws === null ? "-" : sharedDraws ? "ja" : "nein"} day_pair={dayPair === null ? "-" : dayPair ? "ja" : "nein"} B={bootstrapSamples != null ? deTrimmed(bootstrapSamples, 0) : "-"} Ziehungen (Samples, nicht Blöcke)</p>
            <p className="mt-1 text-xs text-slate-500">EW-Halbwertszeit: neuere Tage zählen mehr; Tagesblöcke erhalten die Tagesform.</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <ForTheCurious>
              <p>Block-Bootstrap: ganze Tage mit EW-Gewichten ziehen. shared_draws: gleiche Tages-Indizes für
                  alle Stationen, day_pair: Paare zusammen. B ist die Zahl der Ziehungen (Samples) —
                  Blöcke sind die Tage des Fensters, nicht die Ziehungen.</p>
              <div className="rounded bg-slate-950/70 p-2 font-mono text-xs">{"w_t = 2^(-age/HWZ) / Summe Block b zu day_t shared gleich"}</div>
              <p>Die PIT-Größe n_pit gehört zu Karte 5/7 (Kalibrierung), nicht zum Bootstrap — hier steht nur
                  der Ziehungsmodus.</p>
            </ForTheCurious>
          </div>
        </div>
      </ParamCardShell>

      <ParamCardShell anchor={PARAM_CARDS[3].anchor} number={PARAM_CARDS[3].number} title={PARAM_CARDS[3].title} chain={PARAM_CARDS[3].chain} sentence={PARAM_CARDS[3].sentence}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs font-semibold text-slate-200">Diagramm: PAVA-Pooling einer Rohkurve</p>
            {pavaStats ? (
              <div className="mt-2 text-xs text-slate-300">
                {/* Befund N1c (23.09.2026, Runde 2): Die Statistik lebt in
                    ``totals`` je Kern (``pools``, ``pooled_points``,
                    ``max_pool_size``, ``max_shift_ct``) plus
                    ``law_segments`` — ``n_pools``/``pooled_steps`` auf
                    Top-Level gab es nie. Gezeigt wird der Hauptkern.
                */}
                <p>Segmente ab Bodenkante: {pavaStats.law_segments ?? "-"} · Pools: {pavaTotals?.pools ?? "-"}</p>
                <p>gepoolte Punkte: {pavaTotals?.pooled_points ?? "-"} · max Pool: {pavaTotals?.max_pool_size ?? "-"}</p>
                <p className="mt-1 text-slate-500">Projektion pro [12:00-12:00)-Segment: Rohpfad zu PAVA nicht-steigend ausser 12:00 Sprung erlaubt.</p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">Keine pava_pool_stats im Forecast.</p>
            )}
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <ForTheCurious>
              <p>PAVA: Wo die Kurve steigt statt fällt, werden beide Punkte zum Mittelwert gepoolt — und das
                  wiederholt, bis die Kurve monoton fällt. Erlaubte Anstiegsstellen sind die
                  12-Uhr-Kante (12:00 Uhr Berlin) plus die Regime-Kanten; „nur an 12:00 darf er
                  steigen“ ist deshalb zu kurz gegriffen.</p>
              <div className="rounded bg-slate-950/70 p-2 font-mono text-xs">{"Segment s=[12:00_d,12:00_d+1) oder [Regime-Kante, nächste Kante) y_hat=PAVA(y) rise frei bei Kanten"}</div>
              <p>B3: law_floor={f?.law_floor ?? "-"} active={f?.law_floor_active ? "ja" : "nein"} pre_law_excluded={f?.pre_law_points_excluded ?? "-"} rise_outside_noon={f?.law_rise_outside_noon ?? "-"} (sollte 0 sein){pavaStats ? ` pava: Segmente ${pavaStats.law_segments ?? "-"}, Pools ${pavaTotals?.pools ?? "-"}, gepoolte Punkte ${pavaTotals?.pooled_points ?? "-"}` : " pava: -"}</p>
            </ForTheCurious>
          </div>
        </div>
      </ParamCardShell>

      <ParamCardShell anchor={PARAM_CARDS[4].anchor} number={PARAM_CARDS[4].number} title={PARAM_CARDS[4].title} chain={PARAM_CARDS[4].chain} sentence={PARAM_CARDS[4].sentence}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            {/* R3/F7: Der Titel hieß „Gewichte je Horizont“, obwohl der Fit
                nur globale Gewichte kennt (`horizon_weights.status =
                not_estimated`) — die Zeile darunter zeigte drei Mal „-“. */}
            <p className="text-xs font-semibold text-slate-200">Diagramm: Ensemble-Gewichte (global)</p>
            {/* Befund N1e (23.09.2026, Runde 2): Mit gefülltem Payload stehen
                hier lange Fach-Token (``inverse_mase_one_step_validation``) —
                ohne ``overflow-wrap:anywhere`` malen sie über die eigene Box
                (Mobil-Ratchet, 320/390 px). */}
            {ensemble ? (
              <div className="mt-2 text-xs text-slate-300 [overflow-wrap:anywhere]">
                <p>method={ensemble.method ?? "-"} n_eval={ensemble.n_eval ?? "-"} window={ensemble.window_days ?? "-"}d</p>
                <p className="mt-1">Gewichte: {ensemble.weights ? Object.entries(ensemble.weights).map(([k, v]) => `${k}: ${deNumber(v as number, 2)}`).join(" · ") : "-"}</p>
                {/* R3/F8: Diese MASE ist die Eine-Schritt-Validierung des Fits —
                    nicht die 24-h-MASE der Güte. Beide tragen ihren Namen. */}
                <p className="mt-1" title={`Fachwort: ${MASE_ONE_STEP.code}`}>
                  {MASE_ONE_STEP.label} je Kern: {ensemble.mase ? Object.entries(ensemble.mase).map(([k, v]) => `${k}: ${v == null ? "-" : deNumber(v as number, 3)}`).join(" · ") : "-"}
                </p>
                {ensemble.weight_spread && (
                  <p className="mt-1 text-slate-500">spread blocks={ensemble.weight_spread.blocks ?? "-"} std={ensemble.weight_spread.std != null ? deNumber(ensemble.weight_spread.std, 3) : "-"} range=[{ensemble.weight_spread.min != null ? deNumber(ensemble.weight_spread.min, 3) : "-"} bis {ensemble.weight_spread.max != null ? deNumber(ensemble.weight_spread.max, 3) : "-"}]</p>
                )}
                {ensemble.horizon_weights && (
                  <p className="mt-1 text-slate-500">Gewichte je Horizont: 24h={ensemble.horizon_weights["24h"] ?? "-"} 72h={ensemble.horizon_weights["72h"] ?? "-"} 168h={ensemble.horizon_weights["168h"] ?? "-"} ({ensemble.horizon_weights.status ?? "-"})</p>
                )}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">Kein Ensemble im Payload.</p>
            )}
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <ForTheCurious>
              <p>
                Zwei Kerne — harmonisch plus Tagesprofil — werden über das Validierungsfenster des Fits
                gemischt{ensemble?.window_days != null ? ` (${deTrimmed(ensemble.window_days, 0)} Tage)` : ""}:
                je Kern {MASE_ONE_STEP.label} (Eine-Schritt-Prognose, eine Rasterstufe voraus), Gewicht
                proportional zu 1/{MASE_ONE_STEP.label}. Gewichte je Horizont schätzt der Fit nicht — sie
                gehören in den Roll-Backtest, deshalb steht dort „not_estimated“.
              </p>
              <p className="mt-2">
                Diese {MASE_ONE_STEP.label} ist nicht die {MASE_24H.label} der Güte: Dort wird die Prognose
                auf das 24-Stunden-Fenster außerhalb der Stichprobe gemessen, hier der nächste Schritt im
                Fit. Beide Werte unter 1,0 sind gut — vergleichbar miteinander sind sie nicht.
              </p>
              <div className="rounded bg-slate-950/70 p-2 font-mono text-xs">{"w_k = (1/MASE_k)/Sum(1/MASE) w_spread = std(w)"}</div>
              <p>B2 Kalibrierung: PIT-Kurve aus Backtest-PITs; Status: {f?.calibrated ? "aktiv" : (f?.calibration?.status ?? "-")} n_pit je Horizont: {f?.calibration?.by_horizon ? Object.entries(f.calibration.by_horizon).map(([h, v]: any) => `${h}:${v?.n_pit ?? "-"}`).join(" ") : "-"} · PIT-Größe dieser Station n_pit={pitN ?? "-"} (24h-Fenster).</p>
            </ForTheCurious>
          </div>
        </div>
      </ParamCardShell>

      <ParamCardShell anchor={PARAM_CARDS[5].anchor} number={PARAM_CARDS[5].number} title={PARAM_CARDS[5].title} chain={PARAM_CARDS[5].chain} sentence={PARAM_CARDS[5].sentence}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs font-semibold text-slate-200">Diagramm: delta_hat je Station · {activeCity || "Stadt"}</p>
            {stationDeltas.length ? (
              <>
                <DeltaBars values={stationDeltas.map((r) => r.deltaCt)} labels={stationDeltas.map((r) => r.label)} whiskers={stationDeltas.map((r) => (r.ciLo != null && r.ciHi != null ? { lo: r.ciLo, hi: r.ciHi } : null))} muted={stationDeltas.map((r) => !r.significant)} fmt={centPerLiter} ariaLabel={`Preis-Abstand je Station, ${activeCity}`} ariaDescription={deltaBarsAlt({ values: stationDeltas.map((r) => r.deltaCt), labels: stationDeltas.map((r) => r.label), fmt: (v) => centPerLiter(v), muted: stationDeltas.map((r) => !r.significant) })} />
                <ReadingAid {...DELTA_BARS_AID} />
              </>
            ) : (
              <Empty>Noch kein delta_hat - braucht 1 Woche Preise je Station.</Empty>
            )}
            {selLaw && <p className={`mt-2 text-xs ${selLaw.tone === "warn" ? "text-amber-300/90" : "text-slate-500"}`}>{selLaw.text}</p>}
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <ForTheCurious>
              <p>delta_hat(s) = Mittelwert(p(s,t) - median_ohne_s(t)) über das Fenster der Selektion, nur Punkte
                  ab law_floor. CI aus Tages-Block-Bootstrap mit 95 % Konfidenz, q-Wert über
                  Benjamini-Hochberg. Die Ziehungszahl trägt der Payload nicht: Gerechnet wird mit
                  mindestens 1.000 Ziehungen — darunter ist über das Stations-Set keine Signifikanz
                  erreichbar; ein Override steht im Job-Log.
                  {selReach ? ` Fenster: ${selReach}.` : ""}</p>
              <div className="rounded bg-slate-950/70 p-2 font-mono text-xs">{"delta_hat = mean(p-median) CI bootstrap q_BH"}</div>
              <p>B3: Punkte vor law_floor zählen nicht.</p>
            </ForTheCurious>
          </div>
        </div>
      </ParamCardShell>

      <ParamCardShell anchor={PARAM_CARDS[6].anchor} number={PARAM_CARDS[6].number} title={PARAM_CARDS[6].title} chain={PARAM_CARDS[6].chain} sentence={PARAM_CARDS[6].sentence}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs font-semibold text-slate-200">Diagramm: Trefferquote mit Beta(5,5)-CI</p>
            {betaCI ? (
              <div className="mt-2 text-xs leading-relaxed text-slate-300">
                <p>Warten: {betaCI.hits}/{betaCI.n} p_hat={deNumber(betaCI.hits / betaCI.n, 3)} Beta(5,5)-Posterior mean={deNumber(betaCI.mean, 3)} 95 Prozent CI [{deNumber(betaCI.lo, 3)} bis {deNumber(betaCI.hi, 3)}]</p>
                <p className="mt-1 text-slate-500">Normal-Approx: [{betaCI.loNormal != null ? deNumber(betaCI.loNormal, 3) : "-"} bis {betaCI.hiNormal != null ? deNumber(betaCI.hiNormal, 3) : "-"}] se={betaCI.seNormal != null ? deNumber(betaCI.seNormal, 3) : "-"} Beta ehrlich bei kleinem n.</p>
                <div className="mt-2 h-2 w-full rounded bg-slate-800">
                  <div className="h-2 rounded bg-violet-400/70" style={{ marginLeft: `${betaCI.lo * 100}%`, width: `${Math.max(1, (betaCI.hi - betaCI.lo) * 100)}%` }} />
                </div>
                <p className="mt-2">Schwellen aktiv: {thresholds ? Object.entries(thresholds).map(([k, v]) => `${k}:${typeof v === "number" ? deNumber(v, 2) : String(v)}`).join(" ") : "- (keine Schwellen publiziert)"}</p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">Noch keine Trefferquote - braucht abgerechnete Empfehlungen. Beta(5,5)-Prior: 5 Erfolge plus 5 Misserfolge als Skepsis.</p>
            )}
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <ForTheCurious>
              <p>Neun Schwellen: wait_eur_high/low, wait_p_high/mid, elsewhere_net_eur/p/borderline, now_eur/p. Tuning via Advice-Ledger.</p>
              <div className="rounded bg-slate-950/70 p-2 font-mono text-xs">{"p Beta(alpha=hits+5,beta=n-hits+5) CI Q0.025 Q0.975 mean alpha/(alpha+beta)"}</div>
              <p>M6b: Beta-CI statt Normal-Approx - bei n=5 ist Normal [-0.1,1.1] Unsinn, Beta bleibt in [0,1]. Prior (5,5) zentriert bei 0.5.</p>
            </ForTheCurious>
          </div>
        </div>
      </ParamCardShell>

      <ParamCardShell anchor={PARAM_CARDS[7].anchor} number={PARAM_CARDS[7].number} title={PARAM_CARDS[7].title} chain={PARAM_CARDS[7].chain} sentence={PARAM_CARDS[7].sentence}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs font-semibold text-slate-200">Diagramm: Regime-Kanten im Kalender</p>
            <p className="mt-2 text-xs text-slate-400">Config.regimes: deklarierte Kanten Datum Quelle Betrag je Sorte zu Engine schaetzt delta_hat t_hat slot-gematcht zu Dummy in features zu Projektions-Kante zu Deckel cap(t) zu Zensierung.</p>
            <p className="mt-2 text-xs text-slate-500">Status: announced detected in_force. Quelle: Gesetzesblatt. Betrag: ct/L je Sorte.</p>
            <p className="mt-2 text-xs text-slate-500">Zensierung: at_cap_points Punkte am Deckel, p_at_cap Anteil. Liegt der Anteil am Deckel über 20 Prozent, ist der Deckel bindend.</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <ForTheCurious>
              <p>Regime-Schätzung: Für jede Kante wird der Median der Differenzen vor und nach der Kante
                  verglichen, gematcht auf Wochentag und Stunde.</p>
              <div className="rounded bg-slate-950/70 p-2 font-mono text-xs">{"delta_reg = median(t in match)(p_post-p_pre) t_hat via CUSUM Dummy 1(t>=kante) in X"}</div>
              <p>Projektions-Kante: _segment_bounds setzt bei Regime-Kante neue Segment-Grenze wie 12:00. Deckel: cap(t)=base+delta_regime, Zensierung: p_capped = clip(p, cap), at_cap = p ge cap minus epsilon.</p>
              <p className="mt-2 text-amber-300/80">Hinweis M8: Erster Winter nach der 12-Uhr-Regel - Deckel bindend? Siehe Daten-Tab.</p>
            </ForTheCurious>
          </div>
        </div>
      </ParamCardShell>

      <LabBlock id="spielplatz" open={open.spielplatz} onToggle={() => toggle("spielplatz")} headline="Spielplatz" question={labSection("spielplatz").question} blockRef={(node) => { blockRefs.current.spielplatz = node; }}>
        <p className="text-xs leading-relaxed text-slate-400">Freies Pruefen auf echten Vergangenheits-Preisen - nicht auf Prognosen, deshalb ehrlich vergleichbar.</p>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={14} className="text-violet-300" aria-hidden="true" />
              <p className="text-xs font-semibold text-slate-100">Vorsicht-Regler epsilon</p>
            </div>
            <label className="mt-3 block text-xs text-slate-400" htmlFor="labor-eps">Handlungsschwelle: <span className="font-mono font-bold text-violet-200">{centPerLiter(eps, 2)}</span></label>
            <input id="labor-eps" type="range" min={0} max={4} step={0.05} value={eps} aria-valuetext={`${euro(eps, 2)} Cent pro Liter`} onChange={(event) => setEps(Number(event.target.value))} className="mt-2 w-full accent-violet-400" />
            {scenario ? (
              <ul className="mt-2 space-y-1 text-xs leading-relaxed text-slate-300">
                <li>Station im Blick: <strong className="text-slate-100">{selected?.name ?? "-"}</strong></li>
                <li>Gewartet haette sie an <strong className="text-slate-100">{scenario.wait} von {scenario.days}</strong> Tagen.</li>
                <li>Richtig entschieden: <strong className="text-slate-100">{scenario.hits} von {scenario.days}</strong> Tagen.</li>
                <li>Verlust aus falschem Warten: <strong className="text-slate-100">{euro(scenario.regret)} €</strong> bei {deTrimmed(liters, 0)} L.</li>
                {labMu != null ? <li>Trainings-Erwartung: <strong className="text-slate-100">mu = {centPerLiter(labMu)}</strong> ({labDayClass === 0 ? "Werktag" : "Wochenende"}), {labSaves.length} Trainings-Tage.</li> : activeLabDayRow ? <li>Backtest-Erwartung (kein publiziertes Form-Modell): <strong className="text-slate-100">mu = {centPerLiter(activeLabDayRow.mu)}</strong> ({labDayClass === 0 ? "Werktag" : "Wochenende"}) — das Trainings-Form-Modell fehlt (models dict leer), die Backtest-Zeile liefert mu.</li> : <li className="text-slate-500">Werkstück Modellvergleich: Die Engine veröffentlicht kein Form-Modell je Station.</li>}
              </ul>
            ) : <p className="mt-2 text-xs leading-relaxed text-slate-400">Der Regler wirkt, sobald ein Backtest vorliegt.</p>}
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs font-semibold text-slate-200">Eine Station sezieren</p>
            {labData?.stations?.length ? (
              <label className="mt-2 block text-xs text-slate-400">Station<select aria-label="Station für die Detail-Analyse" value={labData.stations.some((s) => s.id === selected?.station_id) ? selected?.station_id : labData.stations[0].id} onChange={(event) => setSelectedId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100">{labData.stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}</select></label>
            ) : <p className="mt-2 text-xs leading-relaxed text-slate-500">Keine Station im Backtest.</p>}
            {labRows.length ? (
              <>
                <div className="mt-3 flex flex-wrap gap-1">{labRows.map((row: any, index: number) => { const outcome = rowOutcome(row, eps, liters); return <button key={row.day} aria-pressed={index === labDayIdx} onClick={() => setLabDayIdx(index)} className={`rounded-md px-2 py-1 text-xs font-semibold ${index === labDayIdx ? "bg-violet-400/20 text-violet-100" : outcome.hit ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>{row.day.slice(5)}</button>; })}</div>
                {activeLabDayRow && activeLabOutcome && (
                  <>
                    <ul className="mt-3 space-y-1 text-xs leading-relaxed text-slate-300">
                      <li>Erwartung mu = <strong className="text-slate-100">{centPerLiter(activeLabDayRow.mu)}</strong> Regel: <strong className={activeLabDayRow.s > 0 ? "text-emerald-300" : "text-rose-300"}>{activeLabOutcome.wait ? `warten bis ~${formatHour(activeLabDayRow.predHour)}` : "sofort tanken"}</strong></li>
                      <li>Realisierte Ersparnis S = <strong className={activeLabDayRow.s > 0 ? "text-emerald-300" : "text-rose-300"}>{centPerLiter(Math.abs(activeLabDayRow.s))} {activeLabDayRow.s >= 0 ? "günstiger" : "teurer"}</strong> Urteil: <strong className={activeLabOutcome.hit ? "text-emerald-300" : "text-rose-300"}>{activeLabOutcome.hit ? "richtig" : "daneben"}</strong></li>
                    </ul>
                    {dayCurve.length > 0 && <div className="mt-3"><LineChart height={190} series={[{ name: `Erwartung vs. ${anchorLabel}`, color: c.marker, pts: dayCurve }]} marks={[{ x: anchorHour, color: c.accent, label: anchorLabel }, ...(activeLabDayRow.predHour != null ? [{ x: activeLabDayRow.predHour, color: c.positive, label: "prognostizierte Tiefstphase" }] : [])]} xTicks={autoTimeTicks(0, 24)} yFmt={(value) => `${deTrimmed(value, 1)} ct`} ariaLabel="Tageskurve der Backtest-Zeile" ariaDescription={`Tageskurve: erwartete Preisdifferenz je Stunde gegenüber ${anchorLabel}. ${lineChartAlt({ series: [{ pts: dayCurve }], fmtY: (v) => centPerLiter(v), fmtX: (x) => `${deTrimmed(x, 0)} Uhr` })}`} /></div>}
                  </>
                )}
              </>
            ) : <p className="mt-2 text-xs leading-relaxed text-slate-500">Für diese Station liegt noch kein Backtest-Tag vor.</p>}
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-xs font-semibold text-slate-200">Echte Preise im Zeitraum</p>
          <div className="mt-2 flex flex-wrap gap-1 text-xs">{[{ hours: 24, label: timeSpanLabel(24) }, { hours: 72, label: timeSpanLabel(72) }, { hours: 168, label: timeSpanLabel(168) }].map((option) => <button key={option.hours} aria-pressed={spanHours === option.hours} onClick={() => setSpanHours(option.hours)} className={`rounded-md border px-2 py-1 font-semibold ${spanHours === option.hours ? "border-violet-500/40 bg-violet-500/10 text-violet-200" : "border-slate-800 text-slate-500 hover:text-slate-300"}`}>{option.label}</button>)}<span className="self-center text-slate-500">· {spanLabel}</span></div>
          {history.error || history.data?.error_code ? <div className="mt-3"><LoadError errorCode={history.data?.error_code || history.errorCode} fallback="Die Preis-Reihe konnte nicht geladen werden." onRetry={refreshNow} compact /></div> : observations.length ? <div className="mt-3"><LineChart height={200} series={observations} gapMinutes={30} xTicks={autoTimeTicks(Date.now() - spanHours * 3600000, Date.now())} yFmt={(value) => euro(value, 3)} ariaLabel="Beobachtete Preise der gewaehlten Station" ariaDescription={`Beobachtete Preise, ${spanLabel}. ${lineChartAlt({ series: observations, fmtY: (v) => euroPerLiter(v), fmtX: (x) => `${timeLabel(new Date(x).toISOString())} Uhr` })}`} /><ReadingAid headline={`Gemessene Preise: ${spanLabel}.`} text="Luecken sind ehrlich: Wo keine offene Meldung vorliegt, steht keine Linie." /></div> : history.pending && !history.data ? <div className="mt-3"><SkeletonChart height="h-48" label="Preis-Reihe wird geladen" /></div> : <div className="mt-3"><Empty>Keine Preise in diesem Zeitraum - Meldungen entstehen nur 06-24 Uhr.</Empty></div>}
        </div>
        <SelfCheck
          question="Ist ein höheres ε automatisch sicherer?"
          answer="Nein. Ein höheres ε lässt die App seltener warten — sicherer wird die Aussage dadurch nicht, nur seltener."
        />
      </LabBlock>
    </div>
  );
}
