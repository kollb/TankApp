// System — Rohdaten, Reichweite und Exporte (Betreiber-Sicht).
//
// Bis 0.73.0 wohnte dieser Block als Sub-Tab „Daten & Rohdaten“ im Labor.
// Batch 2 (UX-NEUENTWURF §5/§7) hat ihn hierher verlegt: Rohdaten, CSV und
// Endpunkt-Namen sind Werkzeug für den Betrieb, nicht für die Tankfrage.
// Deshalb ist hier auch die technische Sprache erlaubt (MICROCOPY §6, T9).
//
// Inhalt unverändert zum Umzug: Reichweite je Quelle, drei Roh-Tabellen,
// vier CSV-Exporte. Diagramme wohnen weiter in den Ansichten, nicht hier.

import { useMemo, useState } from "react";
import { DataReachNote } from "../components/DataReach";
import { Empty } from "../components/ui";
import { LoadError } from "../components/LoadError";
import { SkeletonPanel } from "../components/Skeleton";
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
} from "../data";
import { useOverview } from "../state/overview";

export function SystemRohdaten() {
  const ov = useOverview();
  const {
    activeCity,
    data,
    diary,
    forecast,
    heatmap,
    history,
    refreshNow,
    selection,
    statsSummaryRes,
  } = ov;
  // Der Betreiber-Bereich darf nie an einer fehlenden Ressource scheitern:
  // Jede Quelle wird defensiv gelesen, fehlt sie, steht „—“ statt eines
  // Absturzes (System ist die Diagnose-Fläche).
  const selectionRes = selection;
  const forecastRes = forecast;
  const historyRes = history;
  const heatmapRes = heatmap;
  const diaryRes = diary;

  const selLaw = lawFloorNote(selectionRes?.data);
  const forecastLaw = lawFloorNote(forecastRes?.data as any);

  const diaryEntries = diaryRes?.data?.entries ?? [];
  const forecastPoints = forecastRes?.data?.points ?? [];
  const historyPoints = historyRes?.data?.points ?? [];

  const rawTable = useMemo(() => {
    const pts = historyPoints.slice(0, 20);
    return pts.map((p: Point) => ({
      timestamp: p.timestamp,
      price: p.price,
      status: p.status,
    }));
  }, [historyPoints]);

  const [csvNote, setCsvNote] = useState<string | null>(null);

  const downloadCsv = (name: string, lines: string[]) => {
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    setCsvNote(name);
  };

  return (
    <div className="grid grid-cols-1 gap-3">
      {/* Regel-Hinweis: erste Heizperiode unter der 12-Uhr-Regel */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
        <h3 className="text-sm font-semibold text-amber-200">
          Erster Winter nach der 12-Uhr-Regel (M8)
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-amber-100/80">
          Seit 01.04.2026, 12:00 Uhr gilt: Ein Preis darf zur Tagesmitte nur
          einmal steigen und danach bis zum nächsten Mittag nur noch fallen.
          Davor galt der alte Rhythmus mit Hoch am Abend. Der erste Winter
          nach der Regel ist die erste Heizperiode unter neuem Rhythmus — die
          Panels zählen nur Beobachtungen ab der Kante.
        </p>
        {selLaw && (
          <p
            className={`mt-2 text-xs leading-relaxed ${
              selLaw.tone === "warn" ? "text-amber-200" : "text-amber-100/70"
            }`}
          >
            {selLaw.text}
          </p>
        )}
        {forecastLaw && forecastLaw !== selLaw && (
          <p
            className={`mt-1 text-xs ${
              forecastLaw.tone === "warn" ? "text-amber-200" : "text-amber-100/70"
            }`}
          >
            Forecast: {forecastLaw.text}
          </p>
        )}
      </div>

      {/* Datenreichweite & Herkunft */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-sm font-semibold text-slate-100">
          Datenreichweite &amp; Herkunft
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-3 text-xs leading-relaxed text-slate-400 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="font-semibold text-slate-200">Preise (Live)</p>
            <p className="mt-1 text-xs text-slate-400">
              {data
                ? `${countLabel(data.stations.length)} Stationen · ${countLabel(data.fresh_prices)} frisch`
                : "—"}{" "}
              ·{" "}
              {data?.generated_at
                ? (dataReachLabel(
                    { range_from: null, range_to: data.generated_at, n_points: data.fresh_prices } as any,
                    "Preise",
                  ) ?? "live")
                : "—"}
            </p>
            <p className="mt-1">
              Quelle: MTS-K über tankerkoenig.de · Polling 06–24 Uhr, alle 5 min
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="font-semibold text-slate-200">Forecast (Modell)</p>
            <DataReachNote reach={forecastRes?.data} noun="Preise im Training" />
            <p className="mt-1">
              Modell: {(forecastRes?.data as any)?.model_kind ?? "—"} · Training:{" "}
              {(forecastRes?.data as any)?.training_days ?? (forecastRes?.data as any)?.n_days ?? "—"}{" "}
              Tage · Punkte:{" "}
              {(forecastRes?.data as any)?.training_points ?? (forecastRes?.data as any)?.n_points ?? "—"} ·
              Kalibriert: {forecastRes?.data?.calibrated ? "ja" : "nein"}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="font-semibold text-slate-200">Selektion (Ranking)</p>
            <DataReachNote reach={selectionRes?.data as any} noun="Stationen" />
            <p className="mt-1">
              Stationen: {selectionRes?.data?.stations?.length ?? "—"} · Law floor:{" "}
              {selectionRes?.data?.law_floor ?? (forecastRes?.data as any)?.law_floor ?? "—"}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="font-semibold text-slate-200">Heatmap (Wochenrhythmus)</p>
            <DataReachNote reach={heatmapRes?.data as any} noun="Preise" />
            <p className="mt-1">
              Art: {heatmapRes?.data?.kind ?? "—"} · Basis: {(heatmapRes?.data as any)?.basis ?? "—"} ·
              Wochen: {heatmapRes?.data?.weeks ?? "—"} · Punkte: {heatmapRes?.data?.points ?? "—"} ·
              Stationen: {heatmapRes?.data?.stations ?? "—"}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="font-semibold text-slate-200">Stats Summary</p>
            <p className="mt-1">
              Stand:{" "}
              {statsSummaryRes.data?.generated_at
                ? timeLabel(statsSummaryRes.data.generated_at)
                : "—"}{" "}
              · Stadt: {statsSummaryRes.data?.city ?? "—"} · Kraftstoff:{" "}
              {statsSummaryRes.data?.fuel ?? "—"} · Backtest-Tage:{" "}
              {statsSummaryRes.data?.backtest?.daysEval ?? "—"} · Live-Advice:{" "}
              {statsSummaryRes.data?.live_advice?.n ?? "—"}
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
            <p className="mt-1">
              MASE an sprungfreien Tagen (nicht die {MASE_24H.label}):{" "}
              {statsSummaryRes.data?.quality_metrics?.mase_sprungfrei != null
                ? deNumber(statsSummaryRes.data.quality_metrics.mase_sprungfrei, 3)
                : "—"}{" "}
              · PICP 95: {percentLabel(statsSummaryRes.data?.quality_metrics?.picp_95, 1)} ·
              Top-3-Trefferquote:{" "}
              {statsSummaryRes.data?.quality_metrics?.top3_hit_rate != null
                ? percentLabel(statsSummaryRes.data.quality_metrics.top3_hit_rate * 100)
                : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Roh-Tabellen */}
      <div
        className="rounded-lg border border-slate-800 bg-slate-900/60 p-4"
        data-testid="rohdaten-section"
      >
        <h3 className="text-sm font-semibold text-slate-100">Rohdaten — Tabellen</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Ausschließlich Tabellen und Zahlen. Diagramme wohnen in den
          Ansichten, nicht im Betreiber-Bereich.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs font-semibold text-slate-200">
              Letzte Preise (Roh) — {activeCity || "Stadt"} · {historyPoints.length} Punkte im Fenster
            </p>
            {historyRes?.error || historyRes?.data?.error_code ? (
              <LoadError
                errorCode={historyRes?.data?.error_code || historyRes?.errorCode}
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
                    {rawTable.map((row, index) => (
                      <tr key={index} className="text-slate-300">
                        <td className="px-2 py-1 font-mono">{timeLabel(row.timestamp)}</td>
                        <td className="px-2 py-1 font-mono">
                          {row.price != null ? euro(row.price, 3) : "—"}
                        </td>
                        <td className="px-2 py-1">{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-slate-500">
                  Zeige 20 von {historyPoints.length} Punkten. Vollständig im CSV-Export.
                </p>
              </div>
            ) : (
              <Empty>Keine Preise im aktuellen Fenster.</Empty>
            )}
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs font-semibold text-slate-200">Selektion — Roh (δ̂ je Station)</p>
            {selectionRes?.data?.stations?.length ? (
              <div className="mt-2 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="px-2 py-1 text-left">Station</th>
                      <th className="px-2 py-1 text-left">δ̂ ct/L</th>
                      <th className="px-2 py-1 text-left">CI lo</th>
                      <th className="px-2 py-1 text-left">CI hi</th>
                      <th className="px-2 py-1 text-left">q</th>
                      <th className="px-2 py-1 text-left">Rang</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {selectionRes!.data!.stations.slice(0, 30).map((row) => (
                      <tr key={row.station_id} className="text-slate-300">
                        <td className="px-2 py-1">{row.name}</td>
                        <td className="px-2 py-1 font-mono">
                          {row.delta_ct != null ? deNumber(row.delta_ct, 2) : "—"}
                        </td>
                        <td className="px-2 py-1 font-mono">
                          {row.ci_lo != null ? deNumber(row.ci_lo, 2) : "—"}
                        </td>
                        <td className="px-2 py-1 font-mono">
                          {row.ci_hi != null ? deNumber(row.ci_hi, 2) : "—"}
                        </td>
                        <td className="px-2 py-1 font-mono">
                          {row.q_value != null ? deNumber(row.q_value, 4) : "—"}
                        </td>
                        <td className="px-2 py-1">{row.rank ?? "—"}</td>
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
                      <th className="px-2 py-1 text-left">Stützung</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {forecastPoints.slice(0, 30).map((p: any, index: number) => (
                      <tr key={index} className="text-slate-300">
                        <td className="px-2 py-1 font-mono">{timeLabel(p.timestamp)}</td>
                        <td className="px-2 py-1 font-mono">
                          {p.q50 != null ? euro(p.q50, 3) : "—"}
                        </td>
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

      {/* CSV-Exporte */}
      <div
        className="rounded-lg border border-slate-800 bg-slate-900/60 p-4"
        data-testid="csv-export-section"
      >
        <h3 className="text-sm font-semibold text-slate-100">CSV-Export</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Der Export enthält nur abgerechnete Empfehlungen und echte
          Beobachtungen — keine Schätzungen. UTF-8, Semikolon-getrennt,
          Zahlen mit Punkt (maschinenlesbar).
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() =>
              downloadCsv("tankapp-tagebuch.csv", [
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
              ])
            }
            className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-500/20"
          >
            Tagebuch als CSV ({diaryEntries.length} Einträge)
          </button>
          <button
            onClick={() =>
              downloadCsv(`tankapp-preise-${activeCity ?? "unbekannt"}.csv`, [
                "timestamp;price;status",
                ...historyPoints.map((p: Point) => `${p.timestamp};${p.price ?? ""};${p.status}`),
              ])
            }
            className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-violet-500/30"
          >
            Preisverlauf als CSV ({historyPoints.length} Punkte)
          </button>
          <button
            onClick={() =>
              downloadCsv(`tankapp-selektion-${activeCity ?? "stadt"}.csv`, [
                "station_id;name;city;fuel;delta_ct;ci_lo;ci_hi;significant;rank;brand",
                ...(selectionRes?.data?.stations ?? []).map(
                  (r) =>
                    `${r.station_id};${r.name};${r.city};${r.fuel};${r.delta_ct ?? ""};${r.ci_lo ?? ""};${r.ci_hi ?? ""};${r.significant ?? ""};${r.rank ?? ""};${r.brand}`,
                ),
              ])
            }
            className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-violet-500/30"
          >
            Selektion als CSV ({selectionRes?.data?.stations?.length ?? 0} Stationen)
          </button>
          <button
            onClick={() =>
              downloadCsv(`tankapp-forecast-${activeCity ?? "stadt"}.csv`, [
                "timestamp;q50;q10;q90;q025;q975;support_days;supported",
                ...forecastPoints.map(
                  (p: any) =>
                    `${p.timestamp};${p.q50 ?? ""};${p.q10 ?? ""};${p.q90 ?? ""};${p.q025 ?? ""};${p.q975 ?? ""};${p.support_days ?? ""};${p.supported ?? ""}`,
                ),
              ])
            }
            className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-violet-500/30"
          >
            Forecast als CSV ({forecastPoints.length} Punkte)
          </button>
        </div>
        {csvNote && (
          <p role="status" className="mt-2 text-xs text-slate-400">
            {csvNote} heruntergeladen.
          </p>
        )}
      </div>

      {diaryRes?.pending && !diaryRes?.data && (
        <SkeletonPanel lines={2} title={false} label="Tagebuch wird geladen" />
      )}
    </div>
  );
}
