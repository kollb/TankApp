"use client";

import { useMemo, useState } from "react";
import type { LabData } from "@/lib/types";
import {
  decide,
  scoreRows,
  fmtEur,
  fmtCt,
  fmtP,
  calibration,
  clsLabel,
  type Action,
} from "@/lib/lab";
import { PROFILE_LABEL } from "@/lib/engine/config";
import { StationPanel } from "./StationPanel";
import { PairPanel } from "./PairPanel";

export function DecisionLab({ data }: { data: LabData }) {
  const [eps, setEps] = useState(data.meta.defaultEps);
  const [sel, setSel] = useState<string>(data.stations[0]?.id ?? "");
  const liters = data.meta.defaultLiters;

  const stationById = useMemo(() => new Map(data.stations.map((s) => [s.id, s])), [data.stations]);

  const scores = useMemo(
    () =>
      data.stations.map((s) => ({
        s,
        sc: scoreRows(data.decisions[s.id] ?? [], eps, liters, s.id),
      })),
    [data, eps, liters],
  );

  const totals = useMemo(() => {
    let smart = 0,
      best = 0,
      always = 0,
      regretEur = 0,
      n = 0,
      sPos = 0,
      pSum = 0,
      commit = 0;
    for (const { sc } of scores) {
      smart += sc.sumSmartEur;
      commit += sc.sumCommitEur;
      best += sc.sumBestEur;
      always += sc.sumAlwaysWaitEur;
      regretEur += sc.avgRegretEur * sc.n;
      n += sc.n;
      sPos += sc.n * sc.hitFreq;
      pSum += sc.pAvg * sc.n;
    }
    return {
      smart,
      commit,
      best,
      always,
      regretEur: n ? regretEur / n : 0,
      n,
      hitFreq: n ? sPos / n : 0,
      pAvg: n ? pSum / n : 0,
      potShare: best > 0 ? smart / best : 0,
    };
  }, [scores]);

  const calib = useMemo(
    () => calibration(data.decisions, data.stations.map((s) => s.id)),
    [data],
  );

  const calibErr = useMemo(() => {
    if (!calib.length) return NaN;
    return calib.reduce((a, c) => a + Math.abs(c.hit - c.p), 0) / calib.length;
  }, [calib]);

  const minDelta = Math.min(...data.stations.map((s) => s.deltaCt));
  const maxDelta = Math.max(...data.stations.map((s) => s.deltaCt));
  const deltaSpan = Math.max(maxDelta - minDelta, 0.01);

  const sorted = [...scores].sort((a, b) => {
    const ca = stationById.get(a.s.id)!.citySlug;
    const cb = stationById.get(b.s.id)!.citySlug;
    return ca === cb ? a.s.deltaCt - b.s.deltaCt : ca.localeCompare(cb);
  });

  return (
    <div className="space-y-10">
      {/* ---------- Regel-Steuerung ---------- */}
      <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-white">Die Entscheidungs-Regel</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-400">
              Jeden Morgen um <span className="text-slate-200">{String(data.meta.decisionHour).padStart(2, "0")}:00</span>{" "}
              entscheidet die Station aus ihrem Training: <strong className="text-slate-200">Warten</strong> bis zur
              vorhergesagten billigsten Stunde ({`μ = E[Ersparnis] ≥ ε`}) — sonst <strong className="text-slate-200">jetzt tanken</strong>.
              μ ist der empirische Mittelwert der Trainings-Ersparnisse S = p(08:00) − p(billigste Stunde).{" "}
              <span className="text-slate-500">
                „Mit welcher Wahrscheinlichkeit der Abend wirklich billiger ist (P), wird separat ausgewiesen — entschieden
                wird über den Erwartungswert, nicht über die Bandbreite.
              </span>
            </p>
          </div>
          <div className="w-full max-w-xs shrink-0 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <label className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Handlungsschwelle ε · {eps.toFixed(2).replace(".", ",")} ct/L
            </label>
            <input
              type="range"
              min={0}
              max={3}
              step={0.05}
              value={eps}
              onChange={(e) => setEps(Number(e.target.value))}
              className="mt-2 w-full accent-emerald-400"
            />
            <p className="mt-1 text-[11px] leading-snug text-slate-500">
              Warten nur, wenn die Trainings-Ersparnis diese Schwelle verspricht (Tankmenge {liters} L).
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Regel-Ergebnis (14 Tage, out-of-sample)" value={fmtEur(totals.smart)} hint="vergleichender Wartender" accent="text-emerald-300" />
          <Metric label="Perfekte Sicht (Orakel)" value={fmtEur(totals.best)} hint="Minimum jedes Tages gekannt" />
          <Metric label="Baseline „immer warten“" value={fmtEur(totals.always)} hint="ohne Regel, ohne ε" />
          <Metric label="Geholtes Potenzial" value={fmtP(totals.potShare)} hint="Regel ÷ Orakel" accent="text-amber-300" />
          <Metric label="Ø Entscheidungsverlust" value={fmtEur(totals.regretEur)} hint="Regret pro Tag & Station" />
        </div>
      </section>

      {/* ---------- Scoreboard ---------- */}
      <section>
        <SectionTitle
          kicker="Entscheidungs-Scoreboard · Out-of-Sample (14 Tage)"
          title="Wurde die Empfehlung real belohnt?"
          text={`Behauptete P(S>0) im Mittel ${fmtP(totals.pAvg)} — real traf „Abend billiger“ in ${fmtP(totals.hitFreq)} der Tage ein.
          Wichtig: Die Trefferquote allein ist nicht das Ziel. Entscheidend ist der Regret in €: Eine „Jetzt“-Empfehlung an einer
          preisstabilen Station ist fast kostenlos, selbst wenn der Abend minimal billiger war.`}
        />
        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-slate-900 text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Station (Stadt)</th>
                <th className="px-3 py-3">δ̂ vs. Stadt</th>
                <th className="px-3 py-3">Profil</th>
                <th className="px-3 py-3 text-right">P behauptet</th>
                <th className="px-3 py-3 text-right">S&gt;0 real</th>
                <th className="px-3 py-3 text-right">„Warten“</th>
                <th className="px-3 py-3 text-right">„Jetzt“</th>
                <th className="px-3 py-3 text-right">Ø Regret</th>
                <th className="px-3 py-3 text-right">Regel-€</th>
                <th className="px-3 py-3 text-right">Orakel-€</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {sorted.map(({ s, sc }) => {
                const city = data.cities.find((c) => c.slug === s.citySlug)!;
                const active = s.id === sel;
                return (
                  <tr
                    key={s.id}
                    onClick={() => setSel(s.id)}
                    className={`cursor-pointer transition ${active ? "bg-emerald-500/10" : "hover:bg-slate-800/40"}`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-100">
                        {s.name} <span className="text-slate-500">· {city.name}</span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {s.brand} · {s.is24h ? "24 h" : "06–22 h"}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className={`h-full ${s.deltaCt <= 0 ? "bg-emerald-400" : "bg-rose-400"}`}
                            style={{ width: `${((s.deltaCt - minDelta) / deltaSpan) * 100}%` }}
                          />
                        </div>
                        <span className={`text-xs font-semibold ${s.deltaCt <= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                          {fmtCt(s.deltaCt)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-400">{PROFILE_LABEL[s.profile]}</td>
                    <td className="px-3 py-2.5 text-right text-slate-300">{fmtP(sc.pAvg)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-300">{fmtP(sc.hitFreq)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {sc.nWait > 0 ? (
                        <span className={sc.hitWait >= 0.7 ? "text-emerald-300" : "text-amber-300"}>
                          {sc.nWait} · {fmtP(sc.hitWait)}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {sc.nNow > 0 ? (
                        <span className="text-sky-300">
                          {sc.nNow} · {fmtP(sc.hitNow)}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-300">
                      {fmtCt(sc.avgRegretCt, 1)} <span className="text-slate-500">/ {fmtEur(sc.avgRegretEur)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-emerald-300">{fmtEur(sc.sumSmartEur)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-400">{fmtEur(sc.sumBestEur)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Klick auf eine Zeile öffnet das Entscheidungs-Labor der Station. „Warten/ Jetzt“ = Anzahl Tage mit dieser Empfehlung ·
          Anteil korrekt. Regret = verpasste Ersparnis gegenüber perfekter Sicht (Ø je Tag, ct/L und €/40 L).
        </p>
      </section>

      {/* ---------- Kalibrierung ---------- */}
      <section>
        <SectionTitle
          kicker="Kalibrierung der Entscheidungs-Wahrscheinlichkeit"
          title="Stimmt „mit x % ist der Abend billiger“ mit der Realität überein?"
          text="Jeder Punkt ist eine Stations-Klasse (Werktag/Wochenende): behauptetes P(S>0) aus dem Training gegen die
          tatsächliche Häufigkeit in den 14 Out-of-Sample-Tagen. Nur wenn die Punkte nahe der Diagonalen liegen, ist die
          Wahrscheinlichkeits-Aussage ehrlich und die ε-Regel darauf aufbaubar."
        />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 lg:col-span-2">
            <CalibChart points={calib} />
          </div>
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
              <p className="text-slate-400">Mittlere Kalibrier-Abweichung</p>
              <p className="mt-1 text-2xl font-bold text-white">
                {Number.isFinite(calibErr) ? (calibErr * 100).toFixed(1).replace(".", ",") + " pp" : "—"}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                Kleine Stichprobe (10–30 Tage je Klasse) — die Richtung zählt: systematisch überschätzte P-Werte würden als
                Punkte unterhalb der Diagonalen sichtbar.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
              <p className="mb-2 font-medium text-slate-200">Warum nicht einfach Varianz-Graphen?</p>
              <p className="text-xs leading-relaxed">
                Ein 95-%-Band sagt nicht, ob du tanken sollst. Handeln heißt: Aktion wählen, deren{" "}
                <em>erwarteter €-Nutzen</em> die Kosten übersteigt. Die hier gezeigte Kette — Verteilung → Erwartungswert →
                Schwelle ε → Out-of-Sample-Protokoll mit Regret — ist die Übersetzung von „Prognose“ in „Entscheidung“.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Stations-Labor ---------- */}
      <StationPanel data={data} stationId={sel} onStation={setSel} eps={eps} />

      {/* ---------- Andere Station ---------- */}
      <PairPanel data={data} stationA={sel} litersDefault={liters} />
    </div>
  );
}

function Metric({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3.5">
      <p className="text-[11px] leading-snug text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${accent ?? "text-slate-100"}`}>{value}</p>
      {hint && <p className="text-[10px] text-slate-600">{hint}</p>}
    </div>
  );
}

function SectionTitle({ kicker, title, text }: { kicker: string; title: string; text: string }) {
  return (
    <div className="mb-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-400">{kicker}</p>
      <h2 className="mt-1 text-xl font-bold text-white">{title}</h2>
      <p className="mt-1.5 max-w-4xl text-sm leading-relaxed text-slate-400">{text}</p>
    </div>
  );
}

function CalibChart({ points }: { points: { p: number; hit: number; n: number; cls: number }[] }) {
  const W = 720;
  const H = 300;
  const padL = 46;
  const padR = 16;
  const padT = 18;
  const padB = 30;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  const X = (v: number) => padL + v * iw;
  const Y = (v: number) => padT + ih - v * ih;
  const maxN = Math.max(...points.map((p) => p.n), 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Kalibrierung">
      {/* Diagonale */}
      <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} stroke="#475569" strokeWidth={1.4} strokeDasharray="6 4" />
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={X(0)} x2={X(1)} y1={Y(f)} y2={Y(f)} stroke="#1e293b" strokeWidth={0.6} />
          <line x1={X(f)} x2={X(f)} y1={Y(0)} y2={Y(1)} stroke="#1e293b" strokeWidth={0.6} />
          <text x={padL - 6} y={Y(f) + 3.5} textAnchor="end" fontSize={10.5} fill="#64748b">
            {Math.round(f * 100)}%
          </text>
          <text x={X(f)} y={H - 9} textAnchor="middle" fontSize={10.5} fill="#64748b">
            {Math.round(f * 100)}%
          </text>
        </g>
      ))}
      <text x={padL} y={H - 18} fontSize={10} fill="#64748b">behauptet P(S&gt;0)</text>
      <text x={W - padR} y={padT - 4} textAnchor="end" fontSize={10} fill="#64748b">real (S&gt;0)</text>
      {points.map((p, i) => {
        const color = p.cls === 0 ? "#34d399" : "#38bdf8";
        return (
          <g key={i}>
            <circle cx={X(p.p)} cy={Y(p.hit)} r={3.5 + (p.n / maxN) * 5} fill={color} opacity={0.9} />
            <title>{`P=${(p.p * 100).toFixed(0)}% real=${(p.hit * 100).toFixed(0)}% n=${p.n} ${clsLabel(p.cls)}`}</title>
          </g>
        );
      })}
      <g transform={`translate(${padL}, ${H - 14})`}>
        <circle cx={4} cy={0} r={4} fill="#34d399" />
        <text x={12} y={4} fontSize={10.5} fill="#94a3b8">Werktag</text>
        <circle cx={90} cy={0} r={4} fill="#38bdf8" />
        <text x={98} y={4} fontSize={10.5} fill="#94a3b8">Wochenende/Feiertag</text>
      </g>
    </svg>
  );
}

export type { Action };
export { decide };
