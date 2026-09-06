"use client";

import React, { useState } from "react";
import { StationData } from "@/lib/engine";
import { Navigation, CheckCircle2, ShieldCheck, Star, ExternalLink, MapPin, Fuel } from "lucide-react";

interface Top10SelectionTableProps {
  stations: StationData[];
  selectedStationId: string;
  onSelectStation: (station: StationData) => void;
  selectedCampaign: string;
  onSelectCampaign: (campaign: string) => void;
}

export function Top10SelectionTable({
  stations,
  selectedStationId,
  onSelectStation,
  selectedCampaign,
  onSelectCampaign,
}: Top10SelectionTableProps) {
  const [filterTop10Only, setFilterTop10Only] = useState(false);

  // Group by campaigns to show quota
  const top10 = stations.filter((s) => s.isTop10);
  const countHe = top10.filter((s) => s.subdiv === "HE").length;
  const countBy = top10.filter((s) => s.subdiv === "BY").length;
  const countNw = top10.filter((s) => s.subdiv === "NW").length;

  const filteredStations = stations.filter((s) => {
    if (filterTop10Only && !s.isTop10) return false;
    if (selectedCampaign !== "ALL" && s.campaign !== selectedCampaign) return false;
    return true;
  });

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 md:p-6 shadow-xl">
      {/* Header and Quota Monitor */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              §2 Mathematische Selektion
            </span>
            <span className="text-xs text-slate-400">
              Benjamini-Hochberg FDR (q &lt; 0,05) + Tages-Block-Bootstrap (B = 2000)
            </span>
          </div>
          <h3 className="text-lg md:text-xl font-bold text-white mt-1">
            Top-10 Quotierte Stationsauswahl (6 / 2 / 2)
          </h3>
          <p className="text-xs text-slate-400">
            Die 10 mathematisch lohnendsten Stationen decken alle drei Kampagnen im 5-Minuten-API-Raster ab
          </p>
        </div>

        {/* Campaign Filter Buttons */}
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => onSelectCampaign("Frankfurt am Main")}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
              selectedCampaign === "Frankfurt am Main"
                ? "bg-emerald-500 text-slate-950 font-bold shadow"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Frankfurt/HE ({countHe}/6)
          </button>
          <button
            onClick={() => onSelectCampaign("München-Nord")}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
              selectedCampaign === "München-Nord"
                ? "bg-emerald-500 text-slate-950 font-bold shadow"
                : "text-slate-400 hover:text-white"
            }`}
          >
            München/BY ({countBy}/2)
          </button>
          <button
            onClick={() => onSelectCampaign("Köln-Bonn")}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
              selectedCampaign === "Köln-Bonn"
                ? "bg-emerald-500 text-slate-950 font-bold shadow"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Köln-Bonn/NW ({countNw}/2)
          </button>
          <button
            onClick={() => onSelectCampaign("ALL")}
            className={`px-2.5 py-1.5 rounded-lg font-medium transition-all ${
              selectedCampaign === "ALL"
                ? "bg-slate-700 text-white font-bold"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Alle 10
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 font-medium">
              <th className="pb-3 pl-2">Rang / Station</th>
              <th className="pb-3 text-center">Kampagne</th>
              <th className="pb-3 text-right">E10 Preis</th>
              <th className="pb-3 text-center">δ̂ (vs. Stadtmedian)</th>
              <th className="pb-3 text-center">95%-Bootstrap KI</th>
              <th className="pb-3 text-center">Signifikanz</th>
              <th className="pb-3 text-center">AV-Score</th>
              <th className="pb-3 text-center">Beste Zeit</th>
              <th className="pb-3 text-right pr-2">Aktion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {filteredStations.map((station) => {
              const isSelected = station.id === selectedStationId;
              const formatHour = (h: number | null) => {
                if (!h) return "18:30";
                const hh = Math.floor(h);
                const mm = Math.round((h % 1) * 60);
                return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
              };

              return (
                <tr
                  key={station.id}
                  onClick={() => onSelectStation(station)}
                  className={`cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-emerald-950/40 border-l-2 border-emerald-400"
                      : "hover:bg-slate-800/40"
                  }`}
                >
                  {/* Station Name & Brand */}
                  <td className="py-3 pl-2">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-6 h-6 rounded-md flex items-center justify-center font-bold text-[11px] ${
                          station.isTop10
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {station.quotaRank ?? "–"}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                          {station.name}
                          {isSelected && (
                            <span className="text-[10px] bg-emerald-500 text-slate-950 px-1.5 py-0.2 rounded font-bold">
                              FOKUS
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-slate-500" />
                          {station.street} {station.houseNumber}, {station.place} · {station.distHome} km
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Campaign */}
                  <td className="py-3 text-center">
                    <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 text-slate-300">
                      {station.campaign} ({station.subdiv})
                    </span>
                  </td>

                  {/* Current E10 Price */}
                  <td className="py-3 text-right font-mono font-bold text-slate-100 text-sm">
                    {station.lastPriceE10?.toFixed(3) ?? "1.709"} €
                  </td>

                  {/* Relative Delta Hat */}
                  <td className="py-3 text-center">
                    <span
                      className={`font-mono font-bold px-2 py-0.5 rounded text-xs ${
                        (station.deltaHat ?? 0) < 0
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                      }`}
                    >
                      {(station.deltaHat ?? 0) > 0 ? `+${station.deltaHat?.toFixed(2)}` : station.deltaHat?.toFixed(2)}{" "}
                      ct/L
                    </span>
                  </td>

                  {/* 95% Bootstrap CI */}
                  <td className="py-3 text-center font-mono text-[11px] text-slate-400">
                    [{station.ciLo?.toFixed(2)} … {station.ciHi?.toFixed(2)}]
                  </td>

                  {/* FDR Significance */}
                  <td className="py-3 text-center">
                    {(station.qValue ?? 1) < 0.05 ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                        <CheckCircle2 className="w-3 h-3" /> q &lt; 0,05
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-500">n.s.</span>
                    )}
                  </td>

                  {/* Commuter Availability Score */}
                  <td className="py-3 text-center font-mono text-slate-300">
                    {station.avScore ? `${Math.round(station.avScore * 100)}%` : "–"}
                  </td>

                  {/* Cheapest Typical Hour */}
                  <td className="py-3 text-center font-mono text-emerald-400 font-medium">
                    ~{formatHour(station.cheapestHour)}
                  </td>

                  {/* Google Maps Action */}
                  <td className="py-3 text-right pr-2" onClick={(e) => e.stopPropagation()}>
                    <a
                      href={station.mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors text-[11px] font-medium"
                      title="Google Maps Navigation öffnen (kostenlos)"
                    >
                      <Navigation className="w-3.5 h-3.5 text-emerald-400" />
                      Maps
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Quota Explainer Footer */}
      <div className="mt-4 pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-400 gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>
            Aus 54 historischen Stationen mathematisch gefiltert: FDR-Gate q &lt; 0,05 + Coverage &ge; 85 % +
            Tagesform-Stabilität.
          </span>
        </div>
        <div className="text-slate-300 font-mono text-[11px]">
          Live-Polling: 1 Req / 5 min (10 IDs gebündelt)
        </div>
      </div>
    </div>
  );
}
