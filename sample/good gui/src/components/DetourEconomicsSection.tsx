"use client";

import React, { useState } from "react";
import { StationData, evaluateDetourEconomics, computeValueOfTime } from "@/lib/engine";
import { Car, Clock, Navigation, CheckCircle2, XCircle, ArrowRight, Info, AlertTriangle } from "lucide-react";

interface DetourEconomicsSectionProps {
  currentStation: StationData;
  allStations: StationData[];
  fuel: "e10" | "e5" | "diesel";
  fillLiters: number;
}

export function DetourEconomicsSection({
  currentStation,
  allStations,
  fuel,
  fillLiters,
}: DetourEconomicsSectionProps) {
  const [detourKm, setDetourKm] = useState(4.0);
  const [consumption, setConsumption] = useState(7.0);
  const [tripMode, setTripMode] = useState<"onroute" | "dedicated">("onroute");
  const [userSpeed, setUserSpeed] = useState(45);
  const [targetStationId, setTargetStationId] = useState<string>(
    allStations.find((s) => s.id !== currentStation.id && s.campaign === currentStation.campaign)?.id ||
      allStations[0]?.id
  );

  const targetStation = allStations.find((s) => s.id === targetStationId) || allStations[0];

  const currentPrice =
    fuel === "diesel"
      ? (currentStation.lastPriceDiesel ?? 1.619)
      : fuel === "e5"
      ? (currentStation.lastPriceE5 ?? 1.769)
      : (currentStation.lastPriceE10 ?? 1.709);

  const targetPrice =
    fuel === "diesel"
      ? (targetStation?.lastPriceDiesel ?? 1.619)
      : fuel === "e5"
      ? (targetStation?.lastPriceE5 ?? 1.769)
      : (targetStation?.lastPriceE10 ?? 1.709);

  // Effective detour distance: in dedicated mode, you drive both ways from home (2x)!
  const effectiveDistance = tripMode === "dedicated" ? detourKm * 2 : detourKm;

  const result = evaluateDetourEconomics({
    liters: fillLiters,
    detourKm: effectiveDistance,
    consumptionPer100Km: consumption,
    currentStationPrice: currentPrice,
    targetStationPrice: targetPrice,
    when: 18.0, // standard commuter hour
    speedKmh: userSpeed,
  });

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 md:p-6 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
              §7 Umweg- & Fahrzeug-Ökonomie
            </span>
            <span className="text-xs text-slate-400">
              K = d · (c/100) · p + (d/v) · z
            </span>
          </div>
          <h3 className="text-lg md:text-xl font-bold text-white mt-1">
            Rechnet sich der Umweg zu einer anderen Station?
          </h3>
          <p className="text-xs text-slate-400">
            Kritische Preisdifferenz Δp* = K / L: Sprit sparen per Extrafahrt ist fast immer ein Verlustgeschäft.
          </p>
        </div>

        {/* Mode Selector */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => setTripMode("onroute")}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
              tripMode === "onroute"
                ? "bg-emerald-500 text-slate-950 font-bold shadow"
                : "text-slate-400 hover:text-white"
            }`}
          >
            On-Route (Mehrweg auf Pendelstrecke)
          </button>
          <button
            onClick={() => setTripMode("dedicated")}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
              tripMode === "dedicated"
                ? "bg-rose-500 text-white font-bold shadow"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Dedicated (Extrafahrt von zuhause)
          </button>
        </div>
      </div>

      {tripMode === "dedicated" && (
        <div className="mb-4 p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs text-rose-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span>
            <strong>Ehrliches Konzept-Ergebnis:</strong> Bei 12–16 €/h Zeitwert ist eine Extrafahrt von zuhause
            praktisch nie wirtschaftlich. Fahre nur hin, wenn du ohnehin an der Station vorbeikommst!
          </span>
        </div>
      )}

      {/* Main Grid: Parameters on Left, Economic Result on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Input Controls (5 cols) */}
        <div className="lg:col-span-5 space-y-4 bg-slate-950/60 p-4 rounded-xl border border-slate-800 text-xs">
          {/* Target Station dropdown */}
          <div>
            <label className="block text-slate-400 mb-1">Vergleiche mit Ziel-Station:</label>
            <select
              value={targetStationId}
              onChange={(e) => setTargetStationId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white font-medium focus:ring-1 focus:ring-emerald-400 outline-none"
            >
              {allStations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.lastPriceE10?.toFixed(3)} €)
                </option>
              ))}
            </select>
          </div>

          {/* Umweg Distanz Slider */}
          <div>
            <div className="flex justify-between text-slate-300 mb-1">
              <span>Umweg-Distanz {tripMode === "dedicated" ? "(einfach)" : ""}:</span>
              <span className="font-mono font-bold text-blue-400">{detourKm} km</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="15.0"
              step="0.5"
              value={detourKm}
              onChange={(e) => setDetourKm(parseFloat(e.target.value))}
              className="w-full accent-blue-500 cursor-pointer"
            />
            {tripMode === "dedicated" && (
              <div className="text-[10px] text-amber-400 mt-0.5">
                Hin- & Rückweg zusammen: {effectiveDistance} km
              </div>
            )}
          </div>

          {/* Verbrauch Slider */}
          <div>
            <div className="flex justify-between text-slate-300 mb-1">
              <span>Fahrzeug-Verbrauch c:</span>
              <span className="font-mono font-bold text-slate-200">{consumption} L/100 km</span>
            </div>
            <input
              type="range"
              min="4.0"
              max="12.0"
              step="0.5"
              value={consumption}
              onChange={(e) => setConsumption(parseFloat(e.target.value))}
              className="w-full accent-slate-400 cursor-pointer"
            />
          </div>

          {/* Durchschnittsgeschwindigkeit Slider */}
          <div>
            <div className="flex justify-between text-slate-300 mb-1">
              <span>Stadt-/Pendel-Tempo v:</span>
              <span className="font-mono font-bold text-slate-200">{userSpeed} km/h</span>
            </div>
            <input
              type="range"
              min="25"
              max="80"
              step="5"
              value={userSpeed}
              onChange={(e) => setUserSpeed(parseInt(e.target.value, 10))}
              className="w-full accent-slate-400 cursor-pointer"
            />
          </div>
        </div>

        {/* Right: Economic Verdict (7 cols) */}
        <div className="lg:col-span-7 flex flex-col justify-between bg-slate-950/80 p-5 rounded-xl border border-slate-800">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-300">Ökonomische Netto-Bilanz</span>
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1.5 ${
                  result.worthIt
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                }`}
              >
                {result.worthIt ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                {result.worthIt ? "UMWEG LOHNT SICH" : "UMWEG LOHNT NICHT"}
              </span>
            </div>

            {/* Calculations Breakdown */}
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between items-center py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Preisvorteil am Zapfhahn:</span>
                <span className="font-mono font-bold text-slate-200">
                  {result.priceDeltaCt > 0 ? `-${result.priceDeltaCt} ct/L billiger` : `+${Math.abs(result.priceDeltaCt)} ct/L teurer`}
                </span>
              </div>

              <div className="flex justify-between items-center py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Brutto-Ersparnis ({fillLiters} L Tankfüllung):</span>
                <span className="font-mono font-bold text-emerald-400">
                  +{result.grossSavingsEur.toFixed(2)} €
                </span>
              </div>

              <div className="flex justify-between items-center py-1.5 border-b border-slate-800">
                <span className="text-slate-400">
                  Spritkosten für Umweg ({effectiveDistance} km à {consumption} L):
                </span>
                <span className="font-mono text-rose-400">-{result.fuelCostEur.toFixed(2)} €</span>
              </div>

              <div className="flex justify-between items-center py-1.5 border-b border-slate-800">
                <span className="text-slate-400">
                  Zeitverlust ({result.timeMinutes} Min. bei {result.zUsed} €/h Zeitwert):
                </span>
                <span className="font-mono text-rose-400">-{result.timeCostEur.toFixed(2)} €</span>
              </div>

              <div className="flex justify-between items-center py-2 bg-slate-900 px-3 rounded-lg font-bold">
                <span className="text-white text-sm">Netto-Ersparnis nach Zeit & Sprit:</span>
                <span
                  className={`text-base font-mono ${
                    result.netBenefitEur > 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {result.netBenefitEur > 0 ? `+${result.netBenefitEur.toFixed(2)} €` : `${result.netBenefitEur.toFixed(2)} €`}
                </span>
              </div>
            </div>
          </div>

          {/* Critical Threshold Explainer */}
          <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-2">
            <div>
              Kritische Schwelle <span className="font-mono font-bold text-slate-200">Δp* = K / L</span>: Der Umweg
              lohnt erst ab mindestens{" "}
              <span className="font-bold text-amber-300 font-mono">
                {result.criticalDeltaCt.toFixed(1)} ct/L
              </span>{" "}
              Preisdifferenz!
            </div>
            {targetStation?.mapsUrl && (
              <a
                href={targetStation.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-semibold"
              >
                Zu {targetStation.brand} navigieren <ArrowRight className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
