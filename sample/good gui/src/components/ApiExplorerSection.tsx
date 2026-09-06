"use client";

import React, { useState } from "react";
import { Terminal, Send, Copy, Check, Code, ExternalLink } from "lucide-react";

export function ApiExplorerSection() {
  const [activeEndpoint, setActiveEndpoint] = useState<string>("/v1/decision");
  const [responseJson, setResponseJson] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const endpoints = [
    {
      name: "GET /v1/decision",
      path: "/v1/decision?campaign=Frankfurt%20am%20Main&fuel=e10&liters=40",
      description: "Entscheidungs-Kompass: Jetzt tanken vs. Warten vs. Andere Station",
    },
    {
      name: "GET /v1/stations",
      path: "/v1/stations?lat=50.1109&lon=8.6821&radius=15&fuel=e10&sort=price",
      description: "MTS-K Umkreis-Suche sortiert nach Preis oder Distanz mit Google Maps Universal-Link",
    },
    {
      name: "GET /v1/stations/{id}/forecast",
      path: "/v1/stations/uuid-he-01-jet-hanauer/forecast?fuel=e10&horizon=0",
      description: "Zeitreihen-Prognose mit 80% & 95% ACI-Bändern und MASE-Güte",
    },
    {
      name: "GET /v1/heatmap",
      path: "/v1/heatmap?station_id=uuid-he-01-jet-hanauer&fuel=e10&kind=probability",
      description: "DoW x Hour Matrix (Preisniveau oder Cheap-Probability)",
    },
    {
      name: "GET /v1/route/evaluate",
      path: "/v1/route/evaluate?station_id=uuid-he-01-jet-hanauer&liters=40&detour_km=4&consumption=7.0",
      description: "Umweg-Ökonomie K = d*(c/100)*p + (d/v)*z und kritische Schwelle Δp*",
    },
    {
      name: "GET /v1/health",
      path: "/v1/health",
      description: "Collector-Status, tmpfs-Puffer, NAS-Erreichbarkeit und Quoten-Monitoring",
    },
  ];

  const handleExecute = async (path: string) => {
    setActiveEndpoint(path);
    setLoading(true);
    setResponseJson(null);
    try {
      const res = await fetch(path);
      const data = await res.json();
      setResponseJson(JSON.stringify(data, null, 2));
    } catch (err) {
      setResponseJson(JSON.stringify({ error: "Fehler beim Aufruf der API", details: String(err) }, null, 2));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (responseJson) {
      navigator.clipboard.writeText(responseJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 md:p-6 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
              §8 TankPuls API (FastAPI Spezifikation)
            </span>
            <span className="text-xs text-slate-400">
              5 öffentliche Endpunkte + Rate-Limits (60/min anonym, 300/min mit Key)
            </span>
          </div>
          <h3 className="text-lg md:text-xl font-bold text-white mt-1">
            Interaktiver TankPuls API Explorer
          </h3>
          <p className="text-xs text-slate-400">
            Teste die Live-REST-Endpunkte direkt im Browser. Antworten sind JSON/UTF-8, Zeiten Europe/Berlin.
          </p>
        </div>
      </div>

      {/* Endpoints List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 mb-4">
        {endpoints.map((ep) => (
          <button
            key={ep.path}
            onClick={() => handleExecute(ep.path)}
            className={`p-3 rounded-xl border text-left transition-all ${
              activeEndpoint === ep.path
                ? "bg-emerald-950/50 border-emerald-500/50 text-white"
                : "bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-300"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-emerald-400">{ep.name}</span>
              <Send className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <div className="text-[11px] text-slate-400 mt-1 line-clamp-2">{ep.description}</div>
          </button>
        ))}
      </div>

      {/* Response Viewer */}
      <div className="bg-slate-950 rounded-xl border border-slate-800 p-4">
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800 text-xs">
          <div className="flex items-center gap-2 text-slate-300 font-mono truncate">
            <Terminal className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span className="truncate">{activeEndpoint}</span>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {responseJson && (
              <button
                onClick={handleCopy}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copied ? "Kopiert" : "Kopieren"}
              </button>
            )}
            <button
              onClick={() => handleExecute(activeEndpoint)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-[11px] disabled:opacity-50"
            >
              <Send className="w-3 h-3" />
              {loading ? "Lädt..." : "Ausführen"}
            </button>
          </div>
        </div>

        <pre className="text-xs font-mono text-emerald-300/90 max-h-72 overflow-y-auto p-2 bg-slate-900/50 rounded-lg">
          {loading
            ? "// Rufe API-Endpunkt auf..."
            : responseJson ?? "// Klicke oben auf einen Endpunkt, um die Live-JSON-Antwort anzuzeigen"}
        </pre>
      </div>
    </div>
  );
}
