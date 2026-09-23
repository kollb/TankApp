// B5 Sub-Tab: Daten & Rohdaten — CSV-Export, API-Explorer, M8 Hinweis, Diagramm/Rohdaten-Trennung
import { useMemo, useState } from "react";
import { Empty } from "../../components/ui";
import { DataReachNote } from "../../components/DataReach";
import { LoadError } from "../../components/LoadError";
import { SkeletonPanel } from "../../components/Skeleton";
import {
  MASE_24H,
  countLabel,
  dataReachLabel,
  deNumber,
  euro,
  lawFloorNote,
  percentLabel,
  timeLabel,
  type Point,
} from "../../data";
import { useOverview } from "../../state/overview";
import { ForTheCurious, ReadingAid, SketchNote } from "./components";

export function DatenView() {
  const ov = useOverview();
  const {
    activeCity,
    diary,
    forecast,
    history,
    heatmap,
    selection,
    statsSummaryRes,
    stations,
    data,
    refreshNow,
  } = ov;

  const selLaw = lawFloorNote(selection.data);
  const forecastLaw = lawFloorNote(forecast.data as any);
  const heatmapLaw = lawFloorNote(heatmap.data as any);

  const diaryEntries = diary.data?.entries ?? [];

  const [apiPath, setApiPath] = useState("/api/v1/heatmap?city=Berlin&fuel=e10&kind=level&weeks=6");
  const [csvPreview, setCsvPreview] = useState<string | null>(null);

  const forecastPoints = forecast.data?.points ?? [];
  const historyPoints = history.data?.points ?? [];

  const rawTable = useMemo(() => {
    const pts = historyPoints.slice(0, 20);
    return pts.map((p: Point) => ({
      timestamp: p.timestamp,
      price: p.price,
      status: p.status,
    }));
  }, [historyPoints]);

  const exportDiaryCsv = () => {
    const rows: string[] = [
      "ausgesprochen_am;aktion;station;stadt;fenster_start;fenster_ende;preis_damals;preis_fenster;ergebnis;verlust_eur",
      ...diaryEntries.map((entry) =>
        [
          entry.emitted_at ?? "",
          entry.action ?? "",
          entry.station_id ?? "",
          entry.city ?? "",
          entry.window_start ?? "",
          entry.window_end ?? "",
          entry.price_then ?? "",
          entry.price_window ?? "",
          entry.outcome ?? "",
          entry.regret_eur ?? "",
        ].join(";"),
      ),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "tankapp-tagebuch.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportHistoryCsv = () => {
    const rows = [
      "timestamp;price;status",
      ...historyPoints.map((p: Point) => `${p.timestamp};${p.price ?? ""};${p.status}`),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tankapp-preise-${activeCity ?? "unbekannt"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportSelectionCsv = () => {
    const rows = selection.data?.stations ?? [];
    const header = "station_id;name;city;fuel;delta_ct;ci_lo;ci_hi;significant;rank;brand";
    const lines = [
      header,
      ...rows.map(
        (r) =>
          `${r.station_id};${r.name};${r.city};${r.fuel};${r.delta_ct ?? ""};${r.ci_lo ?? ""};${r.ci_hi ?? ""};${r.significant ?? ""};${r.rank ?? ""};${r.brand}`,
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tankapp-selektion-${activeCity ?? "stadt"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportForecastCsv = () => {
    const rows = forecastPoints;
    const header = "timestamp;q50;q10;q90;q025;q975;support_days;supported";
    const lines = [
      header,
      ...rows.map(
        (p: any) =>
          `${p.timestamp};${p.q50 ?? ""};${p.q10 ?? ""};${p.q90 ?? ""};${p.q025 ?? ""};${p.q975 ?? ""};${p.support_days ?? ""};${p.supported ?? ""}`,
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tankapp-forecast-${activeCity ?? "stadt"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid grid-cols-1 gap-4" data-testid="daten-tab">
      {/* M8 Hinweis */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
        <h2 className="text-sm font-semibold text-amber-200">Erster Winter nach der 12-Uhr-Regel (M8)</h2>
        <p className="mt-1 text-xs leading-relaxed text-amber-100/80">
          Seit 01.04.2026, 12:00 Uhr gilt: Ein Preis darf zur Tagesmitte nur einmal steigen und danach bis zum nächsten
          Mittag nur noch fallen. Davor galt der alte Rhythmus mit Hoch am Abend. Der erste Winter nach der Regel ist
          die erste Heizperiode unter neuem Rhythmus — Tagesmuster aus Beständen, die beide Welten mischen, gelten für
          keine der beiden Regeln. Die Panels zählen nur Beobachtungen ab der Kante (Bodenkante der 12-Uhr-Regel).
        </p>
        {selLaw && (
          <p className={`mt-2 text-xs leading-relaxed ${selLaw.tone === "warn" ? "text-amber-200" : "text-amber-100/70"}`}>
            {selLaw.text}
          </p>
        )}
        {forecastLaw && forecastLaw !== selLaw && (
          <p className={`mt-1 text-xs ${forecastLaw.tone === "warn" ? "text-amber-200" : "text-amber-100/70"}`}>
            Forecast: {forecastLaw.text}
          </p>
        )}
        <p className="mt-2 text-xs leading-relaxed text-amber-100/60">
          Regime-Hinweis: Deklarierte Kanten (Config.regimes) → Kalender → δ̂/t̂-Schätzer → Dummy → Projektions-Kante →
          Deckel → Zensierung (at_cap_points, p_at_cap). Siehe Karte 8 „Regime & Rechtslagen“.
        </p>
      </div>

      {/* Datenreichweite */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-sm font-semibold text-white">Datenreichweite & Herkunft</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 text-xs leading-relaxed text-slate-400 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="font-semibold text-slate-200">Preise (Live)</p>
            <p className="mt-1 text-xs text-slate-400">Datenreichweite: {data ? `${countLabel(data.stations.length)} Stationen · ${countLabel(data.fresh_prices)} frisch` : "—"} · {data?.generated_at ? dataReachLabel({ range_from: null, range_to: data.generated_at, n_points: data.fresh_prices } as any, "Preise") ?? "live" : "—"}</p>
            <p className="mt-1">Quelle: MTS-K über tankerkoenig.de · Polling 06–24 Uhr, alle 5 min</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="font-semibold text-slate-200">Forecast (Modell)</p>
            <DataReachNote reach={forecast.data} noun="Preise im Training" />
            <p className="mt-1">
              Modell: { (forecast.data as any)?.model_kind ?? "—"} · Training:{" "}
              {(forecast.data as any)?.training_days ?? "—"} Tage · Punkte:{" "}
              {(forecast.data as any)?.training_points ?? "—"} · Kalibriert:{" "}
              {forecast.data?.calibrated ? "ja" : "nein"}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="font-semibold text-slate-200">Selektion (Ranking)</p>
            <DataReachNote reach={selection.data as any} noun="Stationen" />
            <p className="mt-1">
              Stationen: {selection.data?.stations?.length ?? "—"} · Law floor:{" "}
              {selection.data?.law_floor ?? (forecast.data as any)?.law_floor ?? "—"}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="font-semibold text-slate-200">Heatmap (Wochenrhythmus)</p>
            <DataReachNote reach={heatmap.data as any} noun="Preise" />
            <p className="mt-1">
              Kind: {heatmap.data?.kind ?? "—"} · Basis: {(heatmap.data as any)?.basis ?? "—"} · Wochen:{" "}
              {heatmap.data?.weeks ?? "—"} · Punkte: {heatmap.data?.points ?? "—"} · Stationen:{" "}
              {heatmap.data?.stations ?? "—"}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="font-semibold text-slate-200">Stats Summary</p>
            <p className="mt-1">
              Generated: {statsSummaryRes.data?.generated_at ? timeLabel(statsSummaryRes.data.generated_at) : "—"} ·
              City: {statsSummaryRes.data?.city ?? "—"} · Fuel: {statsSummaryRes.data?.fuel ?? "—"} · Backtest-Tage:{" "}
              {statsSummaryRes.data?.backtest?.daysEval ?? "—"} · Live-Advice: {statsSummaryRes.data?.live_advice?.n ?? "—"}
            </p>
            {statsSummaryRes.data?.live_phase && (
              <p className="mt-1">
                Live-Phase: {statsSummaryRes.data.live_phase.good_complete_days}/
                {statsSummaryRes.data.live_phase.required_complete_days} Tage · komplett:{" "}
                {statsSummaryRes.data.live_phase.complete ? "ja" : "nein"}
              </p>
            )}
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="font-semibold text-slate-200">Qualität</p>
            {/* R3: „PICP95: 95,0%“ und „Top3: 0.7“ waren Rohwerte ohne
                Formatter — Prozent laufen über `percentLabel` (eine Quelle,
                §3). Die MASE-Zeile nennt ihre Variante beim Namen: Was hier
                steht, wäre die sprungfreie MASE, und die Engine veröffentlicht
                sie bewusst nicht. */}
            <p className="mt-1">
              MASE an sprungfreien Tagen (nicht die {MASE_24H.label}):{" "}
              {statsSummaryRes.data?.quality_metrics?.mase_sprungfrei != null
                ? deNumber(statsSummaryRes.data.quality_metrics.mase_sprungfrei, 3)
                : "—"}{" "}
              · PICP 95:{" "}
              {percentLabel(statsSummaryRes.data?.quality_metrics?.picp_95, 1)} ·
              Top-3-Trefferquote:{" "}
              {statsSummaryRes.data?.quality_metrics?.top3_hit_rate != null
                ? percentLabel(
                    statsSummaryRes.data.quality_metrics.top3_hit_rate * 100,
                  )
                : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Rohdaten-Tabellen — Diagramm/Rohdaten-Trennung Ratchet: data-testid */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4" data-testid="rohdaten-section">
        <h3 className="text-sm font-semibold text-white">Rohdaten — Tabellen (keine Diagramme)</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Diese Sektion enthält ausschließlich Tabellen und Zahlen — keine LineChart, kein HeatmapGrid. Diagramme
          wohnen in den anderen Sub-Tabs (Überblick, Modell, Güte). Das ist das Diagramm/Rohdaten-Trennungs-Ratchet.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs font-semibold text-slate-200">
              Letzte Preise (Roh) — {activeCity || "Stadt"} · {historyPoints.length} Punkte im Fenster
            </p>
            {history.error || history.data?.error_code ? (
              <LoadError
                errorCode={history.data?.error_code || history.errorCode}
                fallback="Preis-Reihe konnte nicht geladen werden."
                onRetry={refreshNow}
                compact
              />
            ) : rawTable.length ? (
              <div className="mt-2 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="px-2 py-1 text-left">Zeit</th>
                      <th className="px-2 py-1 text-left">Preis €/L</th>
                      <th className="px-2 py-1 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {rawTable.map((row, i) => (
                      <tr key={i} className="text-slate-300">
                        <td className="px-2 py-1 font-mono">{timeLabel(row.timestamp)}</td>
                        <td className="px-2 py-1 font-mono">{row.price != null ? euro(row.price, 3) : "—"}</td>
                        <td className="px-2 py-1">{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-slate-500">
                  Zeige 20 von {historyPoints.length} Punkten. Vollständig via CSV-Export.
                </p>
              </div>
            ) : (
              <Empty>Keine Preise im aktuellen Fenster.</Empty>
            )}
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs font-semibold text-slate-200">Selektion — Roh (δ̂ je Station)</p>
            {selection.data?.stations?.length ? (
              <div className="mt-2 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="px-2 py-1 text-left">Station</th>
                      <th className="px-2 py-1 text-left">δ̂ ct/L</th>
                      <th className="px-2 py-1 text-left">CI lo</th>
                      <th className="px-2 py-1 text-left">CI hi</th>
                      <th className="px-2 py-1 text-left">q</th>
                      <th className="px-2 py-1 text-left">Rank</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {selection.data.stations.slice(0, 30).map((r) => (
                      <tr key={r.station_id} className="text-slate-300">
                        <td className="px-2 py-1">{r.name}</td>
                        <td className="px-2 py-1 font-mono">{r.delta_ct != null ? deNumber(r.delta_ct, 2) : "—"}</td>
                        <td className="px-2 py-1 font-mono">{r.ci_lo != null ? deNumber(r.ci_lo, 2) : "—"}</td>
                        <td className="px-2 py-1 font-mono">{r.ci_hi != null ? deNumber(r.ci_hi, 2) : "—"}</td>
                        <td className="px-2 py-1 font-mono">{r.q_value != null ? deNumber(r.q_value, 4) : "—"}</td>
                        <td className="px-2 py-1">{r.rank ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>Noch keine Selektion geladen.</Empty>
            )}
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs font-semibold text-slate-200">Forecast-Punkte — Roh</p>
            {forecastPoints.length ? (
              <div className="mt-2 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="px-2 py-1 text-left">Zeit</th>
                      <th className="px-2 py-1 text-left">q50</th>
                      <th className="px-2 py-1 text-left">q10–q90</th>
                      <th className="px-2 py-1 text-left">q025–q975</th>
                      <th className="px-2 py-1 text-left">Support</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {forecastPoints.slice(0, 30).map((p: any, i: number) => (
                      <tr key={i} className="text-slate-300">
                        <td className="px-2 py-1 font-mono">{timeLabel(p.timestamp)}</td>
                        <td className="px-2 py-1 font-mono">{p.q50 != null ? euro(p.q50, 3) : "—"}</td>
                        <td className="px-2 py-1 font-mono">
                          {p.q10 != null ? euro(p.q10, 3) : "—"}–{p.q90 != null ? euro(p.q90, 3) : "—"}
                        </td>
                        <td className="px-2 py-1 font-mono">
                          {p.q025 != null ? euro(p.q025, 3) : "—"}–{p.q975 != null ? euro(p.q975, 3) : "—"}
                        </td>
                        <td className="px-2 py-1">{p.support_days ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>Noch keine Forecast-Punkte.</Empty>
            )}
          </div>
        </div>
      </div>

      {/* CSV-Export */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4" data-testid="csv-export-section">
        <h3 className="text-sm font-semibold text-white">CSV-Export</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Export enthält nur abgerechnete Empfehlungen und echte Beobachtungen — keine Schätzungen. Dateiformat: UTF-8,
          Semikolon-getrennt, deutsches Zahlenformat im Export per Punkt (maschinenlesbar).
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={exportDiaryCsv}
            className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-500/20"
          >
            Tagebuch als CSV ({diaryEntries.length} Einträge)
          </button>
          <button
            onClick={exportHistoryCsv}
            className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-violet-500/30"
          >
            Preisverlauf als CSV ({historyPoints.length} Punkte)
          </button>
          <button
            onClick={exportSelectionCsv}
            className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-violet-500/30"
          >
            Selektion als CSV ({selection.data?.stations?.length ?? 0} Stationen)
          </button>
          <button
            onClick={exportForecastCsv}
            className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-violet-500/30"
          >
            Forecast als CSV ({forecastPoints.length} Punkte)
          </button>
        </div>
      </div>

      {/* API-Explorer */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4" data-testid="api-explorer-section">
        <h3 className="text-sm font-semibold text-white">API-Explorer (Rohdaten-Tab)</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Direkte API-Pfade — gleiche URLs, die die GUI nutzt. Kopieren, im Browser öffnen oder mit curl abfragen.
          Persönliche Daten brauchen ein Lese-Token (System-Tab → Persönliche Daten).
        </p>
        <div className="mt-3">
          <label className="text-xs text-slate-400" htmlFor="api-path-input">
            API-Pfad
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="api-path-input"
              value={apiPath}
              onChange={(e) => setApiPath(e.target.value)}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200"
              placeholder="/api/v1/heatmap?city=Berlin&fuel=e10&kind=level&weeks=6"
            />
            <button
              onClick={() => {
                navigator.clipboard?.writeText(window.location.origin + apiPath);
              }}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-violet-500/30"
            >
              URL kopieren
            </button>
            <a
              href={apiPath}
              target="_blank"
              rel="noreferrer"
              className="tap-44 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-200 hover:bg-violet-500/20"
            >
              Öffnen
            </a>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 text-xs lg:grid-cols-2">
          {[
            `/api/v1/stations?city=${encodeURIComponent(activeCity || "Berlin")}&fuel=e10`,
            `/api/v1/forecast?city=${encodeURIComponent(activeCity || "Berlin")}&fuel=e10&station_id=${stations[0]?.station_id ?? "ID"}`,
            `/api/v1/selection?city=${encodeURIComponent(activeCity || "Berlin")}&fuel=e10`,
            `/api/v1/heatmap?city=${encodeURIComponent(activeCity || "Berlin")}&fuel=e10&kind=probability&weeks=6&basis=hour`,
            `/api/v1/stats/summary?city=${encodeURIComponent(activeCity || "Berlin")}&fuel=e10`,
            `/api/v1/advice/diary?city=${encodeURIComponent(activeCity || "Berlin")}&fuel=e10`,
            `/api/v1/health`,
          ].map((path) => (
            <button
              key={path}
              onClick={() => setApiPath(path)}
              className="truncate rounded border border-slate-800 bg-slate-950/40 px-2 py-1.5 text-left font-mono text-slate-400 hover:text-slate-200"
              title={path}
            >
              {path}
            </button>
          ))}
        </div>
        <ForTheCurious>
          <p>
            Alle Pfade liefern JSON. Große Antworten (forecast, heatmap) haben ETag — 304 wenn unverändert. Preise
            enthalten law_floor, points_before_law — nur Punkte ab Kante zählen für δ̂, Coverage, billigste Stunde.
          </p>
          <div className="rounded bg-slate-950/70 p-2 font-mono text-xs">
            curl -H "X-Read-Token: $TOKEN" {typeof window !== "undefined" ? window.location.origin : ""}/api/v1/...
          </div>
        </ForTheCurious>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
        <p className="text-xs font-semibold text-slate-200">Diagramm/Rohdaten-Trennung — Test-Ratchet</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Dieser Tab (Daten) enthält <strong className="text-slate-300">keine</strong> LineChart, DeltaBars,
          CalibChart, HeatmapGrid. Jene wohnen in Überblick (Fan-Chart), Modell (δ̂-Bars), Güte (CalibChart, Heatmap).
          Der Ratchet-Test prüft: Daten-Tab darf keine Diagramm-Komponenten importieren — nur Tabellen und
          CSV-Export.
        </p>
      </div>
    </div>
  );
}
