"use client";

import { useEffect, useMemo, useState } from "react";
import type { LabData } from "@/lib/types";
import { pairEval, fmtEur, fmtCt, fmtP, niceDay, type EcoParams } from "@/lib/lab";
import { haversineKm } from "@/lib/engine/sim";
import { PROFILE_LABEL } from "@/lib/engine/config";
import { DeltaBars } from "./charts";

const REF_PRICE_EUR = 1.7;

export function PairPanel({
  data,
  stationA,
  litersDefault,
}: {
  data: LabData;
  stationA: string;
  litersDefault: number;
}) {
  const self = data.stations.find((s) => s.id === stationA) ?? data.stations[0];
  const sameCity = data.stations.filter((s) => s.citySlug === self.citySlug && s.id !== self.id);
  const [altId, setAltId] = useState<string>(sameCity[0]?.id ?? "");

  useEffect(() => {
    if (!sameCity.some((s) => s.id === altId)) setAltId(sameCity[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationA]);

  const alt = data.stations.find((s) => s.id === altId);

  const distKm = self && alt ? haversineKm(self.lat, self.lon, alt.lat, alt.lon) : 0;

  const [liters, setLiters] = useState(litersDefault);
  const [detourKm, setDetourKm] = useState(2.5);
  const [consumption, setConsumption] = useState(7);
  const [speed, setSpeed] = useState(50);
  const [z, setZ] = useState(12);
  const [peak, setPeak] = useState(true);

  useEffect(() => {
    if (distKm > 0) setDetourKm(Math.round(Math.max(1, distKm * 0.9) * 10) / 10);
  }, [distKm]);

  const eco: EcoParams = useMemo(
    () => ({
      liters,
      detourKm,
      consumption,
      refPriceEur: REF_PRICE_EUR,
      speedKmh: speed,
      valueOfTime: z,
    }),
    [liters, detourKm, consumption, speed, z],
  );

  const evalRes = useMemo(() => {
    if (!self || !alt) return null;
    const s8 = data.p8Series[self.id];
    const a8 = data.p8Series[alt.id];
    if (!s8 || !a8) return null;
    return pairEval(s8, a8, data.meta.daysTrain, data.meta.daysEval, eco);
  }, [self, alt, data, eco]);

  if (!self || !alt || !evalRes) {
    return (
      <section className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-500">
        Keine Vergleichsstation in derselben Stadt.
      </section>
    );
  }

  const deltaStar = evalRes.deltaStarCt;
  const selfCity = data.cities.find((c) => c.slug === self.citySlug)!;

  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-400">
        Dritte Entscheidung: Andere Station — Umweg-Ökonomie
      </p>
      <h2 className="mt-1 text-xl font-bold text-white">Lohnt der Umweg? Netto = Δp · L − K(Umweg)</h2>
      <p className="mt-1.5 max-w-4xl text-sm leading-relaxed text-slate-400">
        K = d·(c/100)·p + (d/v)·z — Spritkosten des Umwegs plus Zeitkosten. Kritische Preisdifferenz Δp* = K/L:
        Die Alternative lohnt erst, wenn ihr Preisvorteil (morgens um 08:00, gemessen an der Trainings-Historie) diese
        Schwelle übersteigt. Der Zeitwert z ist <em>zeitabhängig</em>: Feierabend (17–20 Uhr) teurer als „bin eh unterwegs".
      </p>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        {/* Auswahl */}
        <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-sm">
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-slate-500">Heimat-Station (jetzt)</span>
            <select
              value={self.id}
              disabled
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-white outline-none"
            >
              <option>{self.name} · {selfCity.name}</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-slate-500">Alternative (gleiche Stadt)</span>
            <select
              value={altId}
              onChange={(e) => setAltId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-white outline-none focus:border-emerald-400"
            >
              {sameCity.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({PROFILE_LABEL[s.profile]})
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-slate-900/70 p-2">
              <p className="text-slate-500">δ̂ {self.name.split(" ")[0]}</p>
              <p className={`font-bold ${self.deltaCt <= 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtCt(self.deltaCt)}</p>
            </div>
            <div className="rounded-lg bg-slate-900/70 p-2">
              <p className="text-slate-500">δ̂ {alt.name.split(" ")[0]}</p>
              <p className={`font-bold ${alt.deltaCt <= 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtCt(alt.deltaCt)}</p>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            Luftlinie {distKm.toFixed(1)} km · Vorteil der Alternative aus dem Training:{" "}
            <strong className="text-slate-300">{fmtCt(evalRes.trainMuCt)}</strong> (P billiger: {fmtP(evalRes.trainPCheaper)})
          </p>

          <div className="space-y-2 border-t border-slate-800 pt-3">
            <RangeRow label="Tankmenge L" value={liters} unit="L" min={10} max={60} step={5} onChange={setLiters} />
            <RangeRow label="Umweg gesamt d" value={detourKm} unit="km" min={0} max={10} step={0.5} onChange={setDetourKm} />
            <RangeRow label="Verbrauch c" value={consumption} unit="L/100km" min={4} max={12} step={0.5} onChange={setConsumption} />
            <RangeRow label="Ø Geschwindigkeit v" value={speed} unit="km/h" min={20} max={100} step={5} onChange={setSpeed} />
            <div>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Zeitwert z</span>
                <button
                  onClick={() => setPeak(!peak)}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${peak ? "bg-amber-500/15 text-amber-300" : "bg-slate-800 text-slate-400"}`}
                  title="17–20 Uhr (Feierabend) vs. übrige Zeit"
                >
                  {peak ? "Feierabend 17–20 Uhr" : "unterwegs (off-peak)"}
                </button>
              </div>
              <input
                type="range"
                min={0}
                max={30}
                step={1}
                value={z}
                onChange={(e) => setZ(Number(e.target.value))}
                className="mt-1 w-full accent-emerald-400"
              />
              <p className="text-right text-xs text-slate-400">
                z<sub>used</sub> = {z} €/h{peak ? " (Profil: peak)" : " (Profil: off-peak)"}
              </p>
            </div>
          </div>
        </div>

        {/* Kennzahlen */}
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <p className="text-[11px] text-slate-500">Umweg-Kosten K</p>
              <p className="mt-0.5 text-xl font-bold text-rose-300">{fmtEur(evalRes.detourEur)}</p>
              <p className="text-[10px] text-slate-600">
                {fmtEur((detourKm * consumption * REF_PRICE_EUR) / 100)} Sprit +{" "}
                {fmtEur((detourKm / Math.max(speed, 1)) * z)} Zeit
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <p className="text-[11px] text-slate-500">Kritische Differenz Δp* = K/L</p>
              <p className="mt-0.5 text-xl font-bold text-amber-300">{deltaStar.toFixed(1).replace(".", ",")} ct/L</p>
              <p className="text-[10px] text-slate-600">Vorteil muss größer sein als dieser Wert</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <p className="text-[11px] text-slate-500">Ø Vorteil der Alternative (08:00, Training)</p>
              <p className={`mt-0.5 text-xl font-bold ${evalRes.trainMuCt > 0 ? "text-emerald-300" : "text-slate-300"}`}>
                {fmtCt(evalRes.trainMuCt)}
              </p>
              <p className="text-[10px] text-slate-600">P(alt billiger) = {fmtP(evalRes.trainPCheaper)}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <p className="text-[11px] text-slate-500">Realisierte Netto-Ersparnis (14 Tage)</p>
              <p className={`mt-0.5 text-xl font-bold ${evalRes.meanNetEur >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                {fmtEur(evalRes.meanNetEur)} / Füllung
              </p>
              <p className="text-[10px] text-slate-600">
                {fmtP(evalRes.sharePositive)} der Tage positiv · Brutto-Vorteil Ø {fmtEur(evalRes.grossMeanEur)}
              </p>
            </div>
          </div>
          <div
            className={`rounded-2xl border p-4 ${
              evalRes.worthIt ? "border-emerald-500/40 bg-emerald-500/10" : "border-slate-700 bg-slate-900/60"
            }`}
          >
            <p className="text-sm font-semibold text-white">
              {evalRes.worthIt ? "✓ Wechsel zur Alternative lohnt (Trainings-Erwartung)" : "✗ Umweg lohnt nicht"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              {evalRes.worthIt
                ? `E[Δp] = ${fmtCt(evalRes.trainMuCt)} ≥ Δp* = ${deltaStar.toFixed(1)} ct/L. Bei ${liters} L entspricht das
                  erwarteten ${fmtEur(evalRes.grossMeanEur)} brutto minus ${fmtEur(evalRes.detourEur)} Umwegkosten.`
                : `E[Δp] = ${fmtCt(evalRes.trainMuCt)} < Δp* = ${deltaStar.toFixed(1)} ct/L. Der Preisvorteil deckt die
                  Umwegkosten (${fmtEur(evalRes.detourEur)}) nicht — die Ersparnis bliebe unter ${fmtEur(Math.max((deltaStar / 100) * liters, 0))} netto.`}
            </p>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Ökonomie-Modell aus Konzept v4 §7: Tankvolumen skaliert linear, Zeitwert zeitabhängig (z-Profil), die Selektion
            rechnet konservativ mit dem Durchschnittswert. Hier im Labor stellst du z selbst ein — der API-Endpunkt
            <code className="text-slate-400"> /v1/route/evaluate</code> würde <code className="text-slate-400">z_used</code> zurückschicken.
          </p>
        </div>

        {/* Tagesnetto */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
          <p className="px-1 text-xs font-medium text-slate-400">
            Realisierte Netto-Ergebnisse je Out-of-Sample-Tag (€ pro {liters} L)
          </p>
          <DeltaBars
            values={evalRes.evalNetsEur}
            labels={data.days.slice(data.meta.daysTrain).map((d) => niceDay(d).slice(0, 2))}
            height={210}
          />
          <p className="mt-1 px-1 text-[11px] text-slate-500">
            Positive Balken: die Alternative war an diesem Tag nach Abzug aller Kosten wirklich günstiger. Das ist die
            ehrliche Antwort auf „andere Station oder nicht?“ — nicht die Preisdifferenz allein.
          </p>
        </div>
      </div>
    </section>
  );
}

function RangeRow({
  label,
  value,
  unit,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span className="font-semibold text-slate-200">
          {value} {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-emerald-400"
      />
    </div>
  );
}
