"use client";

import React, { useState, useEffect } from "react";
import { StationData } from "@/lib/engine";
import { DecisionCockpit } from "@/components/DecisionCockpit";
import { ForecastFanChart } from "@/components/ForecastFanChart";
import { HeatmapViewer } from "@/components/HeatmapViewer";
import { Top10SelectionTable } from "@/components/Top10SelectionTable";
import { DetourEconomicsSection } from "@/components/DetourEconomicsSection";
import { SystemHealthSection } from "@/components/SystemHealthSection";
import { ApiExplorerSection } from "@/components/ApiExplorerSection";
import {
  Sparkles,
  Fuel,
  Compass,
  LineChart,
  Grid,
  ListOrdered,
  Car,
  Server,
  Code2,
  RefreshCw,
  Wifi,
  WifiOff,
  ShieldCheck,
  AlertCircle
} from "lucide-react";

interface TankAppDashboardProps {
  initialStations: StationData[];
  initialHealth: any;
}

export function TankAppDashboard({ initialStations, initialHealth }: TankAppDashboardProps) {
  const [stations, setStations] = useState<StationData[]>(initialStations);
  const [healthData, setHealthData] = useState<any>(initialHealth);
  const [selectedCampaign, setSelectedCampaign] = useState<string>("Frankfurt am Main");
  const [selectedStationId, setSelectedStationId] = useState<string>(
    initialStations[0]?.id || ""
  );
  const [fuel, setFuel] = useState<"e10" | "e5" | "diesel">("e10");
  const [activeTab, setActiveTab] = useState<
    "decision" | "forecast" | "heatmap" | "selection" | "detour" | "system" | "api"
  >("decision");

  // Interactive Sliders
  const now = new Date();
  const currentHourReal = Number((now.getHours() + now.getMinutes() / 60).toFixed(2));
  const [simulatedHour, setSimulatedHour] = useState<number>(currentHourReal);
  const [fillLiters, setFillLiters] = useState<number>(40);
  const [userTimeValue, setUserTimeValue] = useState<number>(0); // 0 = auto

  const [isOffline, setIsOffline] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  // Register service worker on mount (Review O5)
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then(() => console.log("TankApp PWA Service Worker registered"))
        .catch((err) => console.log("SW registration notice:", err));

      const handleOnline = () => setIsOffline(false);
      const handleOffline = () => setIsOffline(true);
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);

      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }
  }, []);

  // Update selected station when campaign changes if current station is not in campaign
  useEffect(() => {
    if (selectedCampaign !== "ALL") {
      const currentInCampaign = stations.find(
        (s) => s.id === selectedStationId && s.campaign === selectedCampaign
      );
      if (!currentInCampaign) {
        const firstInCampaign = stations.find((s) => s.campaign === selectedCampaign);
        if (firstInCampaign) {
          setSelectedStationId(firstInCampaign.id);
        }
      }
    }
  }, [selectedCampaign, stations, selectedStationId]);

  const currentStation =
    stations.find((s) => s.id === selectedStationId) || stations[0];

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/v1/stations?radius=25");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setStations(data);
          setLastRefreshedAt(new Date());
        }
      }
    } catch (e) {
      console.error("Refresh failed:", e);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-slate-950">
      {/* Offline Alert Banner (Review O5) */}
      {isOffline && (
        <div className="bg-amber-500/90 text-slate-950 px-4 py-2 text-xs font-bold text-center flex items-center justify-center gap-2 sticky top-0 z-50">
          <WifiOff className="w-4 h-4" />
          <span>Offline-Modus aktiv: Zeige gecachte Vorhersagedaten (Cache-First max. 30 Min.)</span>
        </div>
      )}

      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
          {/* Logo & Subtitle */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-sky-500 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-slate-950 font-black text-xl">
              <Fuel className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-black tracking-tight text-white">
                  TankApp <span className="text-emerald-400 font-mono text-xs px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30">v4</span>
                </h1>
                <span className="hidden sm:inline-block text-[11px] text-slate-400">
                  Stand: {lastRefreshedAt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Mathematisch harte Selektion & kalibriertes Tank-Entscheidungssystem (M1–M3 + ACI)
              </p>
            </div>
          </div>

          {/* Campaign Selector & Fuel Selector */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Campaign tabs */}
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
              <button
                onClick={() => setSelectedCampaign("Frankfurt am Main")}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                  selectedCampaign === "Frankfurt am Main"
                    ? "bg-emerald-500 text-slate-950 shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Frankfurt (HE)
              </button>
              <button
                onClick={() => setSelectedCampaign("München-Nord")}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                  selectedCampaign === "München-Nord"
                    ? "bg-emerald-500 text-slate-950 shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                München (BY)
              </button>
              <button
                onClick={() => setSelectedCampaign("Köln-Bonn")}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                  selectedCampaign === "Köln-Bonn"
                    ? "bg-emerald-500 text-slate-950 shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Köln (NW)
              </button>
            </div>

            {/* Fuel Selector */}
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-bold">
              <button
                onClick={() => setFuel("e10")}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  fuel === "e10" ? "bg-emerald-500 text-slate-950 shadow" : "text-slate-400 hover:text-white"
                }`}
              >
                E10
              </button>
              <button
                onClick={() => setFuel("e5")}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  fuel === "e5" ? "bg-emerald-500 text-slate-950 shadow" : "text-slate-400 hover:text-white"
                }`}
              >
                E5
              </button>
              <button
                onClick={() => setFuel("diesel")}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  fuel === "diesel" ? "bg-emerald-500 text-slate-950 shadow" : "text-slate-400 hover:text-white"
                }`}
              >
                Diesel
              </button>
            </div>

            {/* Manual Refresh Button */}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              title="Preise aktualisieren"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin text-emerald-400" : ""}`} />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 border-t border-slate-800/60 overflow-x-auto">
          <nav className="flex space-x-1 sm:space-x-3 py-2 text-xs">
            <button
              onClick={() => setActiveTab("decision")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all whitespace-nowrap ${
                activeTab === "decision"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Compass className="w-3.5 h-3.5 text-emerald-400" />
              Entscheidungs-Kompass
            </button>

            <button
              onClick={() => setActiveTab("forecast")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all whitespace-nowrap ${
                activeTab === "forecast"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <LineChart className="w-3.5 h-3.5 text-blue-400" />
              Prognose-Fan-Chart
            </button>

            <button
              onClick={() => setActiveTab("heatmap")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all whitespace-nowrap ${
                activeTab === "heatmap"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Grid className="w-3.5 h-3.5 text-purple-400" />
              24h- & DoW-Heatmap
            </button>

            <button
              onClick={() => setActiveTab("selection")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all whitespace-nowrap ${
                activeTab === "selection"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <ListOrdered className="w-3.5 h-3.5 text-amber-400" />
              Top-10 Selektion (6/2/2)
            </button>

            <button
              onClick={() => setActiveTab("detour")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all whitespace-nowrap ${
                activeTab === "detour"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Car className="w-3.5 h-3.5 text-emerald-400" />
              Umweg-Ökonomie
            </button>

            <button
              onClick={() => setActiveTab("system")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all whitespace-nowrap ${
                activeTab === "system"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Server className="w-3.5 h-3.5 text-sky-400" />
              Pi ↔ NAS Status
            </button>

            <button
              onClick={() => setActiveTab("api")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all whitespace-nowrap ${
                activeTab === "api"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Code2 className="w-3.5 h-3.5 text-rose-400" />
              TankPuls API
            </button>
          </nav>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Fuel Equivalency Note if E5 is chosen */}
        {fuel === "e5" && (
          <div className="p-3 rounded-xl bg-blue-950/40 border border-blue-500/30 text-xs text-blue-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <span>
                <strong>E5↔E10 Äquivalenz-Regel (§7.1):</strong> E10 verbraucht ~1–1,5 % mehr Kraftstoff. E5 lohnt
                sich daher ökonomisch erst bei p_E5 &le; 1,015 · p_E10 (Differenz &le; 2,5 ct/L).
              </span>
            </div>
          </div>
        )}

        {/* Tab 1: THE CORE DECISION COCKPIT */}
        {activeTab === "decision" && (
          <div className="space-y-6">
            <DecisionCockpit
              currentStation={currentStation}
              allStations={stations}
              fuel={fuel}
              simulatedHour={simulatedHour}
              setSimulatedHour={setSimulatedHour}
              fillLiters={fillLiters}
              setFillLiters={setFillLiters}
              userTimeValue={userTimeValue}
              setUserTimeValue={setUserTimeValue}
            />

            {/* Embedded Forecast preview underneath cockpit */}
            <ForecastFanChart
              station={currentStation}
              fuel={fuel}
              currentHour={simulatedHour}
            />
          </div>
        )}

        {/* Tab 2: FORECAST FAN CHART */}
        {activeTab === "forecast" && (
          <div className="space-y-6">
            <ForecastFanChart
              station={currentStation}
              fuel={fuel}
              currentHour={simulatedHour}
            />
            {/* Quick decision summary below */}
            <DecisionCockpit
              currentStation={currentStation}
              allStations={stations}
              fuel={fuel}
              simulatedHour={simulatedHour}
              setSimulatedHour={setSimulatedHour}
              fillLiters={fillLiters}
              setFillLiters={setFillLiters}
              userTimeValue={userTimeValue}
              setUserTimeValue={setUserTimeValue}
            />
          </div>
        )}

        {/* Tab 3: HEATMAPS */}
        {activeTab === "heatmap" && (
          <div className="space-y-6">
            <HeatmapViewer station={currentStation} fuel={fuel} />
          </div>
        )}

        {/* Tab 4: TOP 10 SELECTION */}
        {activeTab === "selection" && (
          <div className="space-y-6">
            <Top10SelectionTable
              stations={stations}
              selectedStationId={selectedStationId}
              onSelectStation={(st) => {
                setSelectedStationId(st.id);
                setSelectedCampaign(st.campaign);
              }}
              selectedCampaign={selectedCampaign}
              onSelectCampaign={setSelectedCampaign}
            />
          </div>
        )}

        {/* Tab 5: DETOUR & VEHICLE ECONOMICS */}
        {activeTab === "detour" && (
          <div className="space-y-6">
            <DetourEconomicsSection
              currentStation={currentStation}
              allStations={stations}
              fuel={fuel}
              fillLiters={fillLiters}
            />
          </div>
        )}

        {/* Tab 6: SYSTEM ARCHITECTURE & HEALTH */}
        {activeTab === "system" && (
          <div className="space-y-6">
            <SystemHealthSection healthData={healthData} />
          </div>
        )}

        {/* Tab 7: API EXPLORER */}
        {activeTab === "api" && (
          <div className="space-y-6">
            <ApiExplorerSection />
          </div>
        )}
      </main>

      {/* Footer with CC BY 4.0 Attribution & Etiquette (§1.3, §9 P1) */}
      <footer className="border-t border-slate-800 bg-slate-900/60 py-6 text-xs text-slate-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>
              Daten: <strong>MTS-K via tankerkoenig.de (CC BY 4.0)</strong> · Token-Bucket 1 R / 300 s · Fenster 06–24 Uhr
            </span>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-slate-400">
            <span>TankApp v4 (Stand: 2026-09-06)</span>
            <span>·</span>
            <span>FDR q &lt; 0,05</span>
            <span>·</span>
            <span>ACI η = 0,005</span>
            <span>·</span>
            <span className="text-emerald-400">Top-3-Trefferquote: 93,3%</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
