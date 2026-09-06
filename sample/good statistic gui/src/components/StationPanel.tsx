"use client";

import { useEffect, useMemo, useState } from "react";
import type { LabData } from "@/lib/types";
import {
  rowOutcome,
  scoreRows,
  scanEps,
  fmtCt,
  fmtEur,
  fmtP,
  clsLabel,
  niceDay,
} from "@/lib/lab";
import { PROFILE_LABEL } from "@/lib/engine/config";
import { LineChart, HistogramBars, type Mark } from "./charts";

export function StationPanel({
  data,
  stationId,
  onStation,
  eps,
}: {
  data: LabData;
  stationId: string;
  onStation: (id: string) => void;
  eps: number;
}) {
  const meta = data.meta;
  const station = data.stations.find((s) => s.id === stationId);
  const model = data.models[stationId];
  const rows = data.decisions[stationId] ?? [];
  const city = data.cities.find((c) => c.slug === station?.citySlug);

  const [dayIdx, setDayIdx] = useState(rows.length - 1);
  const [curve, setCurve] = useState<{ h: number; ct: number; open: boolean }[] | null>(null);
  const [loadingCurve, setLoadingCurve] = useState(false);

  useEffect(() => {
    setDayIdx(rows.length - 1);
  }, [stationId, rows.length]);

  useEffect(() => {
    if (!station || rows.length === 0) return;
    const row = rows[Math.min(Math.max(dayIdx, 0), rows.length - 1)];
    if (!row) return;
    let alive = true;
    setLoadingCurve(true);
    fetch(`/api/day?station=${station.id}&day=${row.day}`)
      .then((r) => r.json())
      .then((j) => {
        if (alive) setCurve(j.ok ? j.points : null);
      })
      .catch(() => alive && setCurve(null))
      .finally(() => alive && setLoadingCurve(false));
    return () => {
      alive = false;
    };
  }, [station, rows, dayIdx]);

  const dayRow = rows[Math.min(Math.max(dayIdx, 0), rows.length - 1)];
  const selDay = dayRow ? data.days.indexOf(dayRow.day) : -1;

  const score = useMemo(() => scoreRows(rows, eps, meta.defaultLiters, stationId), [rows, eps, meta.defaultLiters, stationId]);
  const scan = useMemo(() => scanEps(rows, meta.defaultLiters), [rows, meta.defaultLiters]);

  if (!station || !model || !city || rows.length === 0) {
    return (
      <section className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-500">
        Wähle eine Station aus dem Scoreboard.
      </section>
    );
  }

  const dayClass = dayRow?.cls ?? 0;
  const saves = dayClass === 0 ? model.savesWk : model.savesWe;
  const predHour = dayClass === 0 ? model.predWk : model.predWe;
  const shape = dayClass === 0 ? model.shapeWk : model.shapeWe;
  const mu = dayClass === 0 ? model.muWk : model.muWe;
  const p = dayClass === 0 ? model.pWk : model.pWe;

  const outcome = dayRow ? rowOutcome(dayRow, eps, meta.defaultLiters) : null;
  const curvePts = useMemo(() => {
    if (!curve) return [];
    return curve
      .filter((pt) => pt.open)
      .map((pt) => ({ x: pt.h, y: Math.round(pt.ct * 100) / 100 }));
  }, [curve]);

  const marks: Mark[] = [];
  if (curvePts.length) {
    marks.push({ x: meta.decisionHour, color: "#38bdf8", label: "Entscheidung 08:00" });
    marks.push({ x: predHour, color: "#34d399", label: `Fenster ~${String(predHour).padStart(2, "0")}:00` });
  }

  const histValues = saves.map((v) => v);
  const histThresholds = [
    { x: eps, color: "#fbbf24", label: `ε ${eps.toFixed(1)} ct` },
    { x: mu, color: "#38bdf8", label: "μ" },
  ];

  const shapePts = shape.map((v, i) => ({ x: i + 6, y: v }));
  const shapePtsWe = (dayClass === 0 ? model.shapeWk : model.shapeWe).map((v, i) => ({ x: i + 6, y: v }));
  const predHourSeries = model.predWk === model.predWe ? model.predWk : predHour;

  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-400">Stations-Labor</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <select
              value={stationId}
              onChange={(e) => onStation(e.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-white outline-none focus:border-emerald-400"
            >
              {data.stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {data.cities.find((c) => c.slug === s.citySlug)?.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-400">
              {station.brand} · {PROFILE_LABEL[station.profile]} · {station.is24h ? "24 h" : "06–22 h"} ·{" "}
              {city.name} ({city.state})
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Chip label="δ̂ vs. Stadt" value={fmtCt(station.deltaCt)} tone={station.deltaCt <= 0 ? "good" : "bad"} />
          <Chip label="Billigste Stunde (Tr.)" value={`${String(predHourSeries).padStart(2, "0")}:00`} />
          <Chip label="Regel-Ergebnis 14 d" value={fmtEur(score.sumSmartEur)} tone="good" />
          <Chip label="Ø Regret" value={fmtEur(score.avgRegretEur)} />
        </div>
      </div>

      {/* Tages-Auswahl */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-slate-500">Tag im Prüfstand:</span>
        {rows.map((r, i) => {
          const o = rowOutcome(r, eps, meta.defaultLiters);
          const active = i === dayIdx;
          return (
            <button
              key={r.day}
              onClick={() => setDayIdx(i)}
              title={`${niceDay(r.day)} · ${clsLabel(r.cls)} · Empfehlung ${o.wait ? "WARTEN" : "JETZT"} · S=${fmtCt(r.s)}`}
              className={`rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                active
                  ? "bg-slate-200 text-slate-900"
                  : o.hit
                    ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                    : "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
              }`}
            >
              {niceDay(r.day).slice(0, 8)}
            </button>
          );
        })}
      </div>

      {/* Urteilskarte */}
      {dayRow && outcome && (
        <div className="mt-5 grid gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <p className="text-xs uppercase tracking-wider text-slate-500">Regel am Morgen ({clsLabel(dayRow.cls)})</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-300">
              Aus dem Training: <strong className="text-white">μ = {fmtCt(mu)}</strong> erwartete Ersparnis,{" "}
              <strong className="text-white">P(S&gt;0) = {fmtP(p)}</strong>. Regel (ε = {eps.toFixed(1)} ct):{" "}
              <strong className={outcome.wait ? "text-emerald-300" : "text-sky-300"}>
                {outcome.wait ? `WARTEN bis ~${String(dayRow.predHour).padStart(2, "0")}:00` : "JETZT tanken"}
              </strong>
              .
            </p>
          </div>
          <div className="rounded-xl bg-slate-900/80 p-3">
            <p className="text-xs text-slate-500">Realisierte Ersparnis S (Fenster vs. 08:00)</p>
            <p className={`text-2xl font-bold ${dayRow.s > 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtCt(dayRow.s)}</p>
            <p className="text-[11px] text-slate-500">kompromissloser Wartender · bestmögliche Sicht: {fmtCt(dayRow.best)}</p>
          </div>
          <div className="rounded-xl bg-slate-900/80 p-3">
            <p className="text-xs text-slate-500">Urteil</p>
            <p className={`mt-1 text-lg font-bold ${outcome.hit ? "text-emerald-300" : "text-rose-300"}`}>
              {outcome.hit ? "✓ Richtig entschieden" : "✗ Falsch entschieden"}
            </p>
            <p className="text-[11px] text-slate-500">
              {outcome.wait
                ? dayRow.s > 0
                  ? `Fenster war ${fmtCt(dayRow.s)} billiger.`
                  : "Preis war am Fenster höher (Sprungtag)."
                : dayRow.s > 0
                  ? `Abend wurde ${fmtCt(dayRow.s)} billiger — verpasst.`
                  : "Abend wurde nicht billiger — gut so."}
            </p>
          </div>
        </div>
      )}

      {/* Kurve + Verteilung */}
      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 xl:col-span-3">
          <p className="px-1 text-xs font-medium text-slate-400">
            Tageskurve {dayRow ? niceDay(dayRow.day) : ""} (ct/L) · offene Punkte{loadingCurve ? " · lädt …" : ""}
          </p>
          {curvePts.length ? (
            <LineChart
              height={230}
              series={[{ name: "Preis", color: "#e2e8f0", pts: curvePts }]}
              marks={marks}
              xTicks={[
                { x: 6, label: "06" },
                { x: 9, label: "09" },
                { x: 12, label: "12" },
                { x: 15, label: "15" },
                { x: 18, label: "18" },
                { x: 21, label: "21" },
                { x: 23, label: "23" },
              ]}
            />
          ) : (
            <div className="grid h-[230px] place-items-center text-xs text-slate-600">
              {loadingCurve ? "…" : "keine Punkte"}
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 xl:col-span-2">
          <p className="px-1 text-xs font-medium text-slate-400">
            Trainings-Verteilung S ({clsLabel(dayClass)} · n={saves.length}) — „Warten"-Ersparnis
          </p>
          <HistogramBars values={histValues} color="#34d399" thresholds={histThresholds} height={230} />
          <p className="mt-1 px-1 text-[11px] leading-snug text-slate-500">
            μ = {fmtCt(mu)} · P(S&gt;0) = {fmtP(p)}. Negative Werte = Tage, an denen der Abend trotzdem teurer war
            (Nachmittags-Sprung). Die Regel handelt erst, wenn μ die Schwelle ε überschreitet.
          </p>
        </div>
      </div>

      {/* Profil */}
      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
        <p className="px-1 text-xs font-medium text-slate-400">Geschätzte Tagesform (Training, ct um Tagesmittel)</p>
        <LineChart
          height={170}
          series={[
            { name: "Werktag", color: "#34d399", pts: shapePts },
            { name: "Wochenende", color: "#38bdf8", pts: shapePtsWe, dash: "5 4" },
          ]}
          marks={[{ x: predHour, color: "#fbbf24", label: `Fenster ${String(predHour).padStart(2, "0")}:00` }]}
          xTicks={[
            { x: 6, label: "06" },
            { x: 12, label: "12" },
            { x: 18, label: "18" },
            { x: 23, label: "23" },
          ]}
        />
      </div>

      {/* 14-Tage-Protokoll */}
      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800">
        <table className="w-full min-w-[860px] text-left text-xs">
          <thead className="bg-slate-900 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2">Tag</th>
              <th className="px-3 py-2">Klasse</th>
              <th className="px-3 py-2 text-right">μ (Training)</th>
              <th className="px-3 py-2 text-right">P(S&gt;0)</th>
              <th className="px-3 py-2">Empfehlung</th>
              <th className="px-3 py-2 text-right">S real</th>
              <th className="px-3 py-2 text-right">Beste Sicht</th>
              <th className="px-3 py-2 text-right">Regret (€/40 L)</th>
              <th className="px-3 py-2">Urteil</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {rows.map((r, i) => {
              const o = rowOutcome(r, eps, meta.defaultLiters);
              return (
                <tr key={r.day} onClick={() => setDayIdx(i)} className="cursor-pointer hover:bg-slate-800/40">
                  <td className="px-3 py-1.5 text-slate-300">{niceDay(r.day)}</td>
                  <td className="px-3 py-1.5 text-slate-500">{clsLabel(r.cls)}</td>
                  <td className="px-3 py-1.5 text-right text-slate-400">{fmtCt(r.mu)}</td>
                  <td className="px-3 py-1.5 text-right text-slate-400">{fmtP(r.p)}</td>
                  <td className="px-3 py-1.5">
                    {o.wait ? (
                      <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-300">
                        Warten ~{String(r.predHour).padStart(2, "0")}:00
                      </span>
                    ) : (
                      <span className="rounded-md bg-sky-500/15 px-1.5 py-0.5 font-semibold text-sky-300">Jetzt</span>
                    )}
                  </td>
                  <td className={`px-3 py-1.5 text-right font-semibold ${r.s > 0 ? "text-emerald-300" : "text-rose-300"}`}>
                    {fmtCt(r.s)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-500">{fmtCt(r.best)}</td>
                  <td className="px-3 py-1.5 text-right text-slate-400">{fmtEur(o.regretEur)}</td>
                  <td className="px-3 py-1.5">
                    <span className={o.hit ? "text-emerald-400" : "text-rose-400"}>{o.hit ? "✓" : "✗"}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Policy-Scanner */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 lg:col-span-2">
          <p className="px-1 text-xs font-medium text-slate-400">
            Policy-Scan: Gesamtergebnis der Regel (14 Tage, {meta.defaultLiters} L) als Funktion der Schwelle ε
          </p>
          <LineChart
            height={210}
            series={[
              { name: "kompromisslos (S)", color: "#fb7185", pts: scan.eps.map((e, i) => ({ x: e, y: Math.round(scan.commitEur[i] * 100) / 100 })) },
              { name: "vergleichend max(S,0)", color: "#34d399", pts: scan.eps.map((e, i) => ({ x: e, y: Math.round(scan.smartEur[i] * 100) / 100 })) },
            ]}
            marks={[{ x: eps, color: "#fbbf24", label: `ε = ${eps.toFixed(1)}` }]}
            xTicks={[
              { x: 0, label: "0" },
              { x: 1, label: "1" },
              { x: 2, label: "2" },
              { x: 3, label: "3" },
              { x: 4, label: "4 ct" },
            ]}
            yFmt={(v) => fmtEur(v)}
          />
        </div>
        <div className="space-y-2 text-sm">
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs text-slate-500">Ergebnis bei ε = {eps.toFixed(1)} ct</p>
            <p className="mt-0.5 text-lg font-bold text-emerald-300">{fmtEur(score.sumSmartEur)}</p>
            <p className="text-[11px] text-slate-500">vs. Orakel {fmtEur(score.sumBestEur)} · Potenzial {fmtP(score.potShare)}</p>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Der kompromisslose Wartende fährt zum Fenster und tankt <em>immer</em> (S kann negativ sein). Der
            vergleichende Wartende tankt nur, wenn der Preis nicht höher liegt → realisiert max(S, 0). ε schützt vor
            sinnlosen Warte-Aktionen an preisstabilen Stationen — sichtbar am Abfall der Kurve.
          </p>
        </div>
      </div>
    </section>
  );
}

function Chip({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <span className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1">
      <span className="text-slate-500">{label}: </span>
      <span className={tone === "good" ? "font-semibold text-emerald-300" : tone === "bad" ? "font-semibold text-rose-300" : "font-semibold text-slate-200"}>
        {value}
      </span>
    </span>
  );
}
