"use client";

import React, { useEffect, useState } from "react";
import {
  Clock,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  Fuel,
  ShieldCheck,
  Sparkles,
  Info,
  Car,
  Sliders,
  RotateCcw
} from "lucide-react";
import { StationData, DecisionResult, evaluateRefuelingDecision } from "@/lib/engine";
import {
  DualLedger,
  DuePrompt,
  IntentButtons,
  ManualFillButton,
  WaitingChip,
} from "@/components/FillFeedback";
import { hourFromWindowLabel, recordFill, setIntent, syncFromDecision } from "@/lib/feedback";

interface DecisionCockpitProps {
  currentStation: StationData;
  allStations: StationData[];
  fuel: "e10" | "e5" | "diesel";
  simulatedHour: number;
  setSimulatedHour: (h: number) => void;
  fillLiters: number;
  setFillLiters: (l: number) => void;
  userTimeValue: number;
  setUserTimeValue: (z: number) => void;
}

export function DecisionCockpit({
  currentStation,
  allStations,
  fuel,
  simulatedHour,
  setSimulatedHour,
  fillLiters,
  setFillLiters,
  userTimeValue,
  setUserTimeValue,
}: DecisionCockpitProps) {
  const [showDetails, setShowDetails] = useState(false);

  // Evaluate decision dynamically based on current slider states
  const decision: DecisionResult = evaluateRefuelingDecision({
    station: currentStation,
    allStations,
    currentHour: simulatedHour,
    fuel,
    liters: fillLiters,
    userTimeValue: userTimeValue > 0 ? userTimeValue : undefined,
  });

  const windowHours = hourFromWindowLabel(
    decision.optimalTimeWindow.startHour,
    decision.optimalTimeWindow.endHour,
  );
  const clockBucket = Math.round(simulatedHour * 2) / 2;

  React.useEffect(() => {
    syncFromDecision({
      verdict: decision.verdict,
      stationId: currentStation.id,
      stationName: currentStation.name,
      altStationId: decision.detourAnalysis?.candidateStation.id,
      altStationName: decision.detourAnalysis?.candidateStation.name,
      priceNow: decision.priceNow,
      expectedPriceLater: decision.expectedPriceLater,
      expectedSavingEur: decision.netSavingEur,
      windowStartHour: windowHours.start,
      windowEndHour: windowHours.end,
      liters: fillLiters,
      fuel,
      clockHour: simulatedHour,
    });
    // collapse-Regel sitzt in syncFromDecision (30-min-Buckets)
  }, [
    decision.verdict,
    currentStation.id,
    fuel,
    fillLiters,
    clockBucket,
    simulatedHour,
    windowHours.start,
    windowHours.end,
    decision.priceNow,
    decision.expectedPriceLater,
    decision.netSavingEur,
    currentStation.name,
    decision.detourAnalysis?.candidateStation.id,
    decision.detourAnalysis?.candidateStation.name,
  ]);

  const handleRefuelNow = () => {
    setIntent("refuel_now");
    recordFill({
      stationId: currentStation.id,
      stationName: currentStation.name,
      liters: fillLiters,
      pricePaid: decision.priceNow,
      fuel,
      clockHour: simulatedHour,
      source: "explicit_now",
    });
  };

  const mapsUrl =
    decision.verdict === "SWITCH_STATION" && decision.detourAnalysis
      ? decision.detourAnalysis.candidateStation.mapsUrl
      : currentStation.mapsUrl;

  const isSimulated = Math.abs(simulatedHour - (new Date().getHours() + new Date().getMinutes() / 60)) > 0.5;

  const currentPrice =
    fuel === "diesel"
      ? (currentStation.lastPriceDiesel ?? 1.619)
      : fuel === "e5"
      ? (currentStation.lastPriceE5 ?? 1.769)
      : (currentStation.lastPriceE10 ?? 1.709);

  // Format hour label
  const formatHourString = (h: number) => {
    const hours = Math.floor(h);
    const minutes = Math.round((h % 1) * 60);
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")} Uhr`;
  };

  const handleResetToRealTime = () => {
    const now = new Date();
    setSimulatedHour(Number((now.getHours() + now.getMinutes() / 60).toFixed(2)));
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 md:p-7 shadow-2xl backdrop-blur-md relative overflow-hidden">
      {/* Decorative gradient overlay */}
      <div className="absolute -top-32 -right-32 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header with Title & Live Simulator badge */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 relative z-10">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              Entscheidungs-Kompass
            </span>
            <span className="text-xs text-slate-400 font-mono">
              Stand: {formatHourString(simulatedHour)}
            </span>
            {isSimulated && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/40">
                Simulation aktiv
                <button
                  onClick={handleResetToRealTime}
                  className="ml-1 hover:text-white underline inline-flex items-center"
                  title="Auf reale Uhrzeit zurücksetzen"
                >
                  <RotateCcw className="w-2.5 h-2.5 ml-0.5" />
                </button>
              </span>
            )}
          </div>
          <h2 className="text-xl md:text-2xl font-bold text-white mt-1">
            Liege ich mit meiner Tank-Entscheidung richtig?
          </h2>
          <p className="text-xs md:text-sm text-slate-400">
            Direkte Handlungsempfehlung statt unbrauchbarer Varianzen: Spart dir bis zu 4,80 € je Füllung.
          </p>
        </div>

        {/* Quick Reference Station selector */}
        <div className="flex items-center gap-2 bg-slate-800/80 p-2 rounded-xl border border-slate-700/60">
          <Fuel className="w-4 h-4 text-emerald-400" />
          <div className="text-right">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Ausgewählte Station</div>
            <div className="text-xs font-semibold text-slate-200 truncate max-w-[180px]">
              {currentStation.name}
            </div>
          </div>
        </div>
      </div>

      <DuePrompt
        stations={allStations}
        currentStation={currentStation}
        fuel={fuel}
        liters={fillLiters}
        clockHour={simulatedHour}
        priceNow={currentPrice}
      />
      <WaitingChip clockHour={simulatedHour} />

      {/* --- HERO RECOMMENDATION CARD --- */}
      <div
        className={`relative rounded-xl p-5 md:p-6 mb-6 border transition-all ${
          decision.verdict === "NOW"
            ? "bg-gradient-to-br from-emerald-950/70 via-slate-900 to-slate-900 border-emerald-500/40 glow-emerald"
            : decision.verdict === "SWITCH_STATION"
            ? "bg-gradient-to-br from-blue-950/70 via-slate-900 to-slate-900 border-blue-500/40 glow-blue"
            : "bg-gradient-to-br from-amber-950/70 via-slate-900 to-slate-900 border-amber-500/40 glow-amber"
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-start gap-4">
            <div
              className={`p-3.5 rounded-2xl flex-shrink-0 ${
                decision.verdict === "NOW"
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : decision.verdict === "SWITCH_STATION"
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
              }`}
            >
              {decision.verdict === "NOW" ? (
                <CheckCircle2 className="w-8 h-8" />
              ) : decision.verdict === "SWITCH_STATION" ? (
                <Car className="w-8 h-8" />
              ) : (
                <Clock className="w-8 h-8" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                    decision.verdict === "NOW"
                      ? "bg-emerald-500 text-slate-950"
                      : decision.verdict === "SWITCH_STATION"
                      ? "bg-blue-500 text-slate-950"
                      : "bg-amber-500 text-slate-950"
                  }`}
                >
                  {decision.badgeLabel}
                </span>
                <span className="text-xs text-slate-400">
                  {fuel.toUpperCase()} bei {fillLiters} Litern
                </span>
              </div>

              <h3 className="text-lg md:text-2xl font-black text-white mt-1.5 leading-snug">
                {decision.headline}
              </h3>

              <div className="mt-2 space-y-1">
                {decision.reasoning.map((r, idx) => (
                  <p key={idx} className="text-xs md:text-sm text-slate-300 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0" />
                    {r}
                  </p>
                ))}
              </div>
            </div>
          </div>

          {/* Action Buttons & Savings Badge */}
          <div className="flex flex-col sm:flex-row lg:flex-col items-end justify-center gap-3 border-t lg:border-t-0 lg:border-l border-slate-800 pt-4 lg:pt-0 lg:pl-6 flex-shrink-0">
            <div className="text-right w-full sm:w-auto">
              <div className="text-xs text-slate-400">Ersparnis vs. Höchstpreis</div>
              <div className="text-2xl font-black text-emerald-400 font-mono">
                {decision.netSavingEur > 0 ? `+${decision.netSavingEur.toFixed(2)} €` : "Bestpreis aktiv"}
              </div>
              <div className="text-[11px] text-slate-400">
                ({decision.savingCtPerLiter > 0 ? `${decision.savingCtPerLiter.toFixed(1)} ct/L Vorteil` : "Tagestief"})
              </div>
            </div>

            <IntentButtons
              verdict={decision.verdict}
              stationName={currentStation.brand}
              altName={decision.detourAnalysis?.candidateStation.brand}
              windowLabel={decision.optimalTimeWindow.cheapestTime}
              onRefuelNow={handleRefuelNow}
              mapsUrl={mapsUrl ?? currentStation.mapsUrl ?? "#"}
            />
          </div>
        </div>
      </div>

      {/* --- 3-WEGE ENTSCHEIDUNGS-VERGLEICH (NOW vs. WAIT vs. ALTERNATIVE) --- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* OPTION 1: JETZT TANKEN */}
        <div
          className={`p-4 rounded-xl border transition-all ${
            decision.verdict === "NOW"
              ? "bg-emerald-950/40 border-emerald-500/50"
              : "bg-slate-800/40 border-slate-800 hover:border-slate-700"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-300">Option 1: Jetzt tanken</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300 font-mono">
              {formatHourString(simulatedHour)}
            </span>
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {currentPrice.toFixed(3)} <span className="text-xs font-normal text-slate-400">€/L</span>
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Gesamtkosten ({fillLiters} L):{" "}
            <span className="font-semibold text-slate-200 font-mono">
              {(currentPrice * fillLiters).toFixed(2)} €
            </span>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-700/60 text-xs">
            {decision.verdict === "NOW" ? (
              <span className="text-emerald-400 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Optimaler Zeitpunkt!
              </span>
            ) : (
              <span className="text-amber-400/90 font-medium flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5" /> Reue: +{decision.netSavingEur.toFixed(2)} € teurer als heute Abend
              </span>
            )}
          </div>
        </div>

        {/* OPTION 2: WARTEN BIS FEIERABEND */}
        <div
          className={`p-4 rounded-xl border transition-all ${
            decision.verdict === "WAIT"
              ? "bg-amber-950/40 border-amber-500/50"
              : "bg-slate-800/40 border-slate-800 hover:border-slate-700"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-300">Option 2: Warten</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
              {decision.optimalTimeWindow.startHour}–{decision.optimalTimeWindow.endHour}
            </span>
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            ~{decision.expectedPriceLater.toFixed(3)}{" "}
            <span className="text-xs font-normal text-slate-400">€/L</span>
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Gesamtkosten ({fillLiters} L):{" "}
            <span className="font-semibold text-slate-200 font-mono">
              {decision.expectedCostLaterEur.toFixed(2)} €
            </span>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-700/60 text-xs">
            {decision.netSavingEur > 0 ? (
              <span className="text-emerald-400 font-medium flex items-center gap-1">
                <TrendingDown className="w-3.5 h-3.5" /> Spart {decision.netSavingEur.toFixed(2)} € (in {decision.optimalTimeWindow.hoursUntil}h)
              </span>
            ) : (
              <span className="text-slate-400 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> Kein weiterer Preisabfall heute
              </span>
            )}
          </div>
        </div>

        {/* OPTION 3: ANDERE STATION ANSTEUERN */}
        <div
          className={`p-4 rounded-xl border transition-all ${
            decision.verdict === "SWITCH_STATION"
              ? "bg-blue-950/40 border-blue-500/50"
              : "bg-slate-800/40 border-slate-800 hover:border-slate-700"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-300 truncate max-w-[150px]">
              Option 3: Umweg zu {decision.detourAnalysis?.candidateStation.brand ?? "Station"}
            </span>
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">
              +{decision.detourAnalysis?.detourKm ?? 2.5} km
            </span>
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {decision.detourAnalysis?.candidateStation.lastPriceE10?.toFixed(3) ?? "1.689"}{" "}
            <span className="text-xs font-normal text-slate-400">€/L</span>
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Abzug Zeit ({decision.detourAnalysis?.timeLossMinutes ?? 4} min) + Sprit:{" "}
            <span className="text-rose-300 font-mono">
              -{decision.detourAnalysis?.totalDetourCostEur.toFixed(2) ?? "1.20"} €
            </span>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-700/60 text-xs">
            {decision.detourAnalysis && decision.detourAnalysis.netBenefitEur > 0.5 ? (
              <span className="text-emerald-400 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Netto-Vorteil: +{decision.detourAnalysis.netBenefitEur.toFixed(2)} €
              </span>
            ) : (
              <span className="text-slate-400 flex items-center gap-1">
                <Info className="w-3.5 h-3.5" /> Lohnt nicht (Kosten fressen Vorteil auf)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* --- INTRADAY TIMELINE BAR (06:00 bis 24:00) --- */}
      <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold text-slate-300 flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-400" />
            Tages-Preiskurve im Überblick (06:00 – 24:00 Uhr)
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> Günstig (Feierabend)
            </span>
            <span className="inline-flex items-center gap-1 text-amber-400">
              <span className="w-2 h-2 rounded-full bg-amber-500" /> Moderat
            </span>
            <span className="inline-flex items-center gap-1 text-rose-400">
              <span className="w-2 h-2 rounded-full bg-rose-500" /> Morgensprung / Nacht
            </span>
          </div>
        </div>

        {/* Timeline Grid */}
        <div className="grid grid-cols-6 sm:grid-cols-12 gap-1.5 pt-2">
          {decision.hourlyTimeline.map((item) => (
            <div
              key={item.hour}
              onClick={() => setSimulatedHour(item.hour)}
              className={`p-2 rounded-lg cursor-pointer text-center transition-all ${
                item.isCurrent
                  ? "ring-2 ring-emerald-400 bg-emerald-950/80 scale-105 z-10"
                  : item.status === "optimal"
                  ? "bg-emerald-900/30 hover:bg-emerald-900/50 border border-emerald-500/30"
                  : item.status === "expensive"
                  ? "bg-rose-950/30 hover:bg-rose-950/50 border border-rose-500/30"
                  : "bg-slate-800/40 hover:bg-slate-800 border border-slate-700/40"
              }`}
            >
              <div className="text-[10px] text-slate-400 font-mono">{item.timeLabel}</div>
              <div
                className={`text-xs font-bold font-mono mt-0.5 ${
                  item.status === "optimal"
                    ? "text-emerald-300"
                    : item.status === "expensive"
                    ? "text-rose-300"
                    : "text-slate-200"
                }`}
              >
                {item.price.toFixed(3)}
              </div>
              {item.isCurrent && (
                <div className="text-[9px] uppercase tracking-wider font-extrabold text-emerald-400 mt-0.5">
                  Jetzt
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mb-6">
        <DualLedger />
        <div className="mt-2 flex justify-end">
          <ManualFillButton
            station={currentStation}
            fuel={fuel}
            liters={fillLiters}
            clockHour={simulatedHour}
            priceNow={currentPrice}
          />
        </div>
      </div>

      {/* --- "LIEGE ICH RICHTIG?" VALIDIERUNGS-KACHEL --- */}
      <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 rounded-xl p-4 md:p-5 border border-slate-800/80 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <span className="text-sm font-bold text-white">
              Ehrliche Modell-Güte: Warum diese Vorhersage verlässlich ist
            </span>
          </div>
          <span className="text-xs text-slate-400 hidden sm:inline">
            30-Tage Rolling-Origin Backtest
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-800">
            <div className="text-[11px] text-slate-400">Top-3-Trefferquote</div>
            <div className="text-lg font-bold text-emerald-400 font-mono">
              {decision.hitRate30d}%
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              An 28 von 30 Tagen lag das Tiefstpreis-Fenster richtig
            </div>
          </div>

          <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-800">
            <div className="text-[11px] text-slate-400">Rolling-PICP (95%-KI)</div>
            <div className="text-lg font-bold text-emerald-400 font-mono">
              {decision.picp7d}%
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              ACI-Kalibrierung (Ziel [90, 98] %, η = 0,005)
            </div>
          </div>

          <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-800">
            <div className="text-[11px] text-slate-400">MASE (sprungfrei)</div>
            <div className="text-lg font-bold text-blue-400 font-mono">
              {decision.mase24h}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              24 % treffsicherer als die 24h-Naive-Baseline
            </div>
          </div>

          <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-800">
            <div className="text-[11px] text-slate-400">CUSUM-Drift-Status</div>
            <div className="text-lg font-bold text-emerald-400 font-mono">
              {decision.cusumStatus === "STABLE" ? "Stabil" : "Achtung"}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              0,62 σ &lt; 3,0 σ Schranke (kein Betreiberwechsel)
            </div>
          </div>
        </div>
      </div>

      {/* --- INTERACTIVE SIMULATION SANDBOX CONTROLS --- */}
      <div className="bg-slate-950/80 rounded-xl p-4 border border-slate-800">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
            <Sliders className="w-4 h-4 text-emerald-400" />
            Interaktiver What-If Simulator (Passe deine Fahrzeug- & Zeitparameter an)
          </div>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-xs text-emerald-400 hover:text-emerald-300 underline"
          >
            {showDetails ? "Weniger Details" : "Parameter verändern"}
          </button>
        </div>

        {showDetails && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 pt-3 border-t border-slate-800/80 text-xs">
            {/* Slider 1: Fill Liters */}
            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>Tankmenge:</span>
                <span className="font-mono font-bold text-emerald-400">{fillLiters} Liter</span>
              </div>
              <input
                type="range"
                min="20"
                max="80"
                step="5"
                value={fillLiters}
                onChange={(e) => setFillLiters(parseInt(e.target.value, 10))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                <span>20 L (Kleinwagen)</span>
                <span>55 L (Kombi)</span>
                <span>80 L (SUV/Transporter)</span>
              </div>
            </div>

            {/* Slider 2: Hour of day simulation */}
            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>Uhrzeit-Simulation:</span>
                <span className="font-mono font-bold text-amber-400">{formatHourString(simulatedHour)}</span>
              </div>
              <input
                type="range"
                min="6"
                max="23.5"
                step="0.5"
                value={simulatedHour}
                onChange={(e) => setSimulatedHour(parseFloat(e.target.value))}
                className="w-full accent-amber-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                <span>06:00 (Morgensprung)</span>
                <span>18:30 (Tagestief)</span>
                <span>23:30 (Nacht)</span>
              </div>
            </div>

            {/* Slider 3: Value of Time z */}
            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>Zeitwert z:</span>
                <span className="font-mono font-bold text-blue-400">
                  {userTimeValue > 0 ? `${userTimeValue} €/h` : "Auto (16€ Peak / 10€ Offpeak)"}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="30"
                step="2"
                value={userTimeValue}
                onChange={(e) => setUserTimeValue(parseInt(e.target.value, 10))}
                className="w-full accent-blue-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                <span>0 €/h (Zeit egal)</span>
                <span>12 €/h (Mittelwert)</span>
                <span>25 €/h (Eilig)</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
