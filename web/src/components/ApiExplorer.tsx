// D1: Ausgelagerter Baustein aus Dashboard.tsx — der API-Explorer im
// System-Tab. Zeigt exakt die Anfragen, die die Tabs selbst stellen
// (heatmapPath teilt sich die Bauanleitung mit der Werkstatt).

import { useState } from "react";
import { heatmapPath, type Fuel } from "../data";

export function ApiExplorer({
  fuel,
  identity,
  activeCity,
  heatmapWeeks,
}: {
  fuel: Fuel;
  identity: string;
  activeCity: string;
  heatmapWeeks: number;
}) {
  const [path, setPath] = useState("/api/v1/health");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // E7: „day“ braucht eine Station. Ohne Auswahl wäre der Knopf nur ein
  // Aufruf ins Leere (leerer station_id → Fehleranzeige), deshalb grau.
  const stationId = identity
    ? new URLSearchParams(identity).get("station_id") || ""
    : "";
  const today = new Date().toISOString().slice(0, 10);
  // Identität und Heatmap-Pfad teilen sich mit den Tabs dieselbe Bauanleitung
  // (heatmapPath) — der Explorer zeigt damit exakt die Anfrage, die die GUI stellt.
  const dynamic = identity
    ? [
        {
          label: "Preisverlauf (24 h)",
          path: `/api/v1/series?${identity}`,
        },
        {
          label: "Modell-Ausblick",
          path: `/api/v1/forecast?${identity}`,
        },
        {
          label: `Heatmap Niveau (${heatmapWeeks} Wochen)`,
          path: heatmapPath({
            city: activeCity,
            fuel,
            kind: "level",
            weeks: heatmapWeeks,
            stationId,
          }),
        },
        {
          label: `Heatmap Cheap-Prob (${heatmapWeeks} Wochen)`,
          path: heatmapPath({
            city: activeCity,
            fuel,
            kind: "probability",
            weeks: heatmapWeeks,
            stationId,
          }),
        },
        {
          label: "day (Beispiel)",
          path: `/api/v1/day?station_id=${encodeURIComponent(stationId)}&day=${today}`,
        },
      ]
    : [];
  const endpoints = [
    { label: "health", path: "/api/v1/health", note: "" },
    {
      label: "decide",
      path: `/api/v1/decide?city=${encodeURIComponent(activeCity)}&fuel=${fuel}&liters=40`,
      note: "",
    },
    {
      label: "stats/summary",
      path: `/api/v1/stats/summary?city=${encodeURIComponent(activeCity)}&fuel=${fuel}`,
      note: "",
    },
    { label: "episodes?due", path: "/api/v1/episodes?status=due", note: "" },
    {
      label: `stations ${fuel}`,
      path: `/api/v1/stations?fuel=${fuel}`,
      note: "",
    },
    {
      label: `selection ${fuel}`,
      path: `/api/v1/selection?fuel=${fuel}`,
      note: "",
    },
    {
      label: "collector/status",
      path: "/api/v1/collector/status",
      note: "",
    },
    {
      label: "jobs/models/log",
      path: "/api/v1/jobs/models/log?lines=50",
      note: "",
    },
    { label: "last_forecasts", path: "/api/v1/last_forecasts", note: "" },
    {
      label: "day (Beispiel)",
      path: "",
      note: "erst Station wählen",
    },
    {
      label: "route/evaluate (deprecated)",
      path: `/api/v1/route/evaluate?city=${encodeURIComponent(activeCity)}&fuel=${fuel}&detour_km=3&liters=40`,
      note: "",
    },
    ...dynamic.map((entry) => ({ ...entry, note: "" })),
  ].filter((entry) => entry.label !== "day (Beispiel)" || !identity);
  const run = async (target: string) => {
    setPath(target);
    setLoading(true);
    setAnswer(null);
    try {
      const response = await fetch(target, { cache: "no-store" });
      const data: unknown = await response.json();
      const text = JSON.stringify(data, null, 2);
      setAnswer(text.length > 5000 ? `${text.slice(0, 5000)}\n… gekürzt` : text);
    } catch {
      setAnswer('{\n  "error_code": "request_failed"\n}');
    } finally {
      setLoading(false);
    }
  };
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {endpoints.map((entry) => {
          const blocked = entry.path === "";
          return (
            <button
              key={entry.label}
              onClick={() => (blocked ? undefined : void run(entry.path))}
              disabled={blocked}
              aria-disabled={blocked}
              title={
                blocked
                  ? entry.note
                  : `GET ${entry.path}${entry.note ? ` — ${entry.note}` : ""}`
              }
              aria-pressed={path === entry.path && answer !== null}
              className={`rounded-lg border px-3 py-1.5 font-mono text-[11px] transition-colors ${
                blocked
                  ? "cursor-not-allowed border-slate-800 bg-slate-950/50 text-slate-600"
                  : path === entry.path && answer !== null
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-slate-700 bg-slate-950 text-slate-400 hover:text-white"
              }`}
            >
              GET {entry.label}
              {blocked && entry.note ? (
                <span className="ml-1 text-[10px] text-slate-500">
                  · {entry.note}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {!identity && (
        <p className="mb-3 text-[11px] text-slate-500">
          Verlauf, Ausblick, Heatmaps und die Tageszeile („day“) erscheinen hier,
          sobald eine Station mit Stadt gewählt ist — die GUI fragt sie dann live
          ab, genau wie die Tabs.
        </p>
      )}
      <pre className="max-h-80 overflow-auto rounded-lg bg-slate-950/70 p-3 font-mono text-[11px] leading-relaxed text-emerald-300/90">
        {loading
          ? "// Rufe Endpunkt auf …"
          : answer || "// Oben einen Endpunkt wählen — nur lesend, kein Poll."}
      </pre>
    </div>
  );
}
