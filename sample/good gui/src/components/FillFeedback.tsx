"use client";

import React, { useEffect, useState } from "react";
import {
  Bell,
  CheckCircle2,
  Clock,
  Fuel,
  History,
  Scale,
  Undo2,
  X,
} from "lucide-react";
import { StationData } from "@/lib/engine";
import {
  computeLedger,
  dismissDue,
  formatHour,
  actionLabel,
  recordFill,
  resetFeedbackDemo,
  setIntent,
  subscribeFeedback,
  type FillSource,
  type Ledger,
} from "@/lib/feedback";

interface FillFeedbackProps {
  stations: StationData[];
  currentStation: StationData;
  fuel: "e10" | "e5" | "diesel";
  liters: number;
  clockHour: number;
  priceNow: number;
}

export function useLedger(): Ledger {
  const [ledger, setLedger] = useState<Ledger>(() => computeLedger());
  useEffect(() => {
    const refresh = () => setLedger(computeLedger());
    refresh();
    return subscribeFeedback(refresh);
  }, []);
  return ledger;
}

export function DuePrompt({
  stations,
  currentStation,
  fuel,
  liters,
  clockHour,
}: FillFeedbackProps) {
  const ledger = useLedger();
  const due = ledger.due;
  const [other, setOther] = useState(false);
  const [stationId, setStationId] = useState(currentStation.id);
  const [hour, setHour] = useState(clockHour);
  const [lit, setLit] = useState(liters);

  useEffect(() => {
    if (due) {
      setStationId(due.lastSnapshot.stationId);
      setHour(due.lastSnapshot.windowStartHour ?? clockHour);
      setLit(due.lastSnapshot.litersAssumed);
    }
  }, [due?.id, clockHour]);

  if (!due) return null;
  const snap = due.lastSnapshot;
  const station = stations.find((s) => s.id === stationId) ?? currentStation;
  const price =
    fuel === "diesel"
      ? (station.lastPriceDiesel ?? snap.priceNow)
      : fuel === "e5"
        ? (station.lastPriceE5 ?? snap.priceNow)
        : (station.lastPriceE10 ?? snap.priceNow);

  const confirm = (source: FillSource, sid = snap.stationId, sname = snap.stationName, p = snap.expectedPrice ?? snap.priceNow) => {
    recordFill({
      stationId: sid,
      stationName: sname,
      liters: lit,
      pricePaid: p,
      fuel: snap.fuel,
      clockHour: hour,
      source,
      episodeId: due.id,
    });
    setOther(false);
  };

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-950/40 p-4 mb-6 relative overflow-hidden">
      <div className="absolute -right-8 -top-8 w-28 h-28 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />
      <div className="flex items-start justify-between gap-3 relative z-10">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-amber-300">
              Offene Folge — nicht an der Säule fragen
            </div>
            <h3 className="text-sm md:text-base font-bold text-white mt-0.5">
              Hast du getankt?
            </h3>
            <p className="text-xs text-slate-300 mt-1">
              Wir sagten <strong>{actionLabel(snap.action)}</strong>
              {snap.action === "wait" && snap.windowStartHour != null
                ? ` bis ${formatHour(snap.windowStartHour)}–${formatHour(snap.windowEndHour ?? snap.windowStartHour)}`
                : ""}{" "}
              bei {snap.stationName}
              {snap.action === "refuel_elsewhere" && snap.altStationName ? ` → ${snap.altStationName}` : ""}.
              Preis damals {snap.priceNow.toFixed(3)} €/L.
            </p>
          </div>
        </div>
        <button
          onClick={() => dismissDue()}
          className="text-slate-400 hover:text-white p-1"
          title="Später / nicht getankt"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {!other ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() =>
              confirm(
                "prompt",
                snap.action === "refuel_elsewhere" ? snap.altStationId ?? snap.stationId : snap.stationId,
                snap.action === "refuel_elsewhere" ? snap.altStationName ?? snap.stationName : snap.stationName,
                snap.expectedPrice ?? snap.priceNow,
              )
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-500 text-slate-950 hover:bg-emerald-400"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Ja, wie empfohlen
          </button>
          <button
            onClick={() => setOther(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-100 border border-slate-700 hover:border-slate-500"
          >
            Anders getankt
          </button>
          <button
            onClick={() => dismissDue()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white"
          >
            Noch nicht / später
          </button>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <label className="space-y-1">
            <span className="text-slate-400">Station</span>
            <select
              value={stationId}
              onChange={(e) => setStationId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-100"
            >
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.brand} · {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-slate-400">Uhrzeit</span>
            <input
              type="range"
              min={6}
              max={23.5}
              step={0.5}
              value={hour}
              onChange={(e) => setHour(parseFloat(e.target.value))}
              className="w-full accent-amber-500"
            />
            <div className="font-mono text-amber-300">{formatHour(hour)} Uhr</div>
          </label>
          <label className="space-y-1">
            <span className="text-slate-400">Liter</span>
            <input
              type="number"
              min={10}
              max={90}
              value={lit}
              onChange={(e) => setLit(parseFloat(e.target.value) || liters)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 font-mono"
            />
          </label>
          <div className="sm:col-span-3 flex gap-2">
            <button
              onClick={() => confirm("prompt", station.id, station.name, price)}
              className="px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-500 text-slate-950"
            >
              Speichern ({price.toFixed(3)} €/L aus Historie)
            </button>
            <button onClick={() => setOther(false)} className="px-3 py-2 text-xs text-slate-400">
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function WaitingChip({ clockHour }: { clockHour: number }) {
  const ledger = useLedger();
  const ep = ledger.current;
  if (!ep || (ep.status !== "waiting" && ep.intent !== "wait")) return null;
  const snap = ep.lastSnapshot;
  const end = snap.windowEndHour ?? 20.5;
  const remain = Math.max(0, end - clockHour);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-200 border border-amber-500/30">
        <Clock className="w-3.5 h-3.5" />
        Folge offen: {actionLabel(snap.action)}
        {snap.windowStartHour != null ? ` ${formatHour(snap.windowStartHour)}–${formatHour(end)}` : ""} · noch {remain.toFixed(1)} h
      </span>
      <span className="text-slate-400">
        Schiebe die Uhrzeit über das Fenster — die App fragt danach, nicht an der Säule.
      </span>
    </div>
  );
}

export function DualLedger() {
  const ledger = useLedger();
  const a = ledger.advice;
  const w = ledger.wallet;
  return (
    <div className="bg-slate-950/60 rounded-xl border border-slate-800 p-4 md:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Scale className="w-5 h-5 text-emerald-400" />
          <div>
            <div className="text-sm font-bold text-white">Zwei getrennte Bilanzen</div>
            <div className="text-[11px] text-slate-400">
              Modell-Treffer brauchen keinen Tankbeleg. Deine €-Bilanz schon — und nur die.
            </div>
          </div>
        </div>
        <button
          onClick={() => resetFeedbackDemo()}
          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"
          title="Demo zurücksetzen"
        >
          <Undo2 className="w-3 h-3" /> Reset
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
            Advice-Ledger (auto, 24 h später)
          </div>
          {a.n === 0 ? (
            <p className="text-xs text-slate-400 mt-2">
              Noch keine abgeschlossene Empfehlung. Warten-Folgen werden nach Fensterende ohne dein Zutun bewertet.
            </p>
          ) : (
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-lg font-mono font-bold text-emerald-400">
                  {a.hitRate != null ? `${Math.round(a.hitRate * 100)}%` : "—"}
                </div>
                <div className="text-[10px] text-slate-400">Treffer</div>
              </div>
              <div>
                <div className="text-lg font-mono font-bold text-slate-100">
                  {a.waitHits}/{a.waitN || "–"}
                </div>
                <div className="text-[10px] text-slate-400">WARTEN richtig</div>
              </div>
              <div>
                <div className="text-lg font-mono font-bold text-slate-100">
                  {a.nowHits}/{a.nowN || "–"}
                </div>
                <div className="text-[10px] text-slate-400">JETZT richtig</div>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
            Wallet-Ledger (nur gemeldete Füllungen)
          </div>
          {w.nFills === 0 ? (
            <p className="text-xs text-slate-400 mt-2">
              0 Füllungen. Solange du nicht bestätigst, behauptet die App keine persönlichen Euros.
            </p>
          ) : (
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div>
                <div className={`text-lg font-mono font-bold ${w.savedEur >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {w.savedEur >= 0 ? "+" : ""}
                  {w.savedEur.toFixed(2)} €
                </div>
                <div className="text-[10px] text-slate-400">vs. immer sofort</div>
              </div>
              <div>
                <div className="text-lg font-mono font-bold text-slate-100">
                  {w.followed}/{w.nFills}
                </div>
                <div className="text-[10px] text-slate-400">befolgt</div>
              </div>
              <div>
                <div className="text-lg font-mono font-bold text-slate-100">{w.ignored}</div>
                <div className="text-[10px] text-slate-400">gegen Rat</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {w.lastFill && (
        <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-400">
          <History className="w-3.5 h-3.5" />
          Letzte Füllung: {w.lastFill.stationName} · {w.lastFill.liters} L · {w.lastFill.pricePaid.toFixed(3)} €/L ·{" "}
          {w.lastFill.compliance === "followed"
            ? "Empfehlung befolgt"
            : w.lastFill.compliance === "ignored"
              ? "anders als empfohlen"
              : w.lastFill.compliance === "partial"
                ? "teilweise"
                : "ohne Folge"}
          {w.lastFill.savedVsAlwaysNowEur !== 0 && (
            <span className={w.lastFill.savedVsAlwaysNowEur > 0 ? "text-emerald-400" : "text-rose-400"}>
              ({w.lastFill.savedVsAlwaysNowEur > 0 ? "+" : ""}
              {w.lastFill.savedVsAlwaysNowEur.toFixed(2)} €)
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function IntentButtons({
  verdict,
  stationName,
  altName,
  windowLabel,
  onRefuelNow,
  mapsUrl,
}: {
  verdict: "NOW" | "WAIT" | "SWITCH_STATION";
  stationName: string;
  altName?: string;
  windowLabel: string;
  onRefuelNow: () => void;
  mapsUrl: string;
}) {
  return (
    <div className="flex flex-col gap-2 w-full sm:w-auto">
      {verdict === "NOW" && (
        <button
          onClick={onRefuelNow}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-xs bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20"
        >
          <Fuel className="w-4 h-4" />
          Ich tanke jetzt
        </button>
      )}
      {verdict === "WAIT" && (
        <>
          <button
            onClick={() => setIntent("wait")}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-xs bg-amber-500 hover:bg-amber-400 text-slate-950"
          >
            <Clock className="w-4 h-4" />
            Ich warte bis {windowLabel}
          </button>
          <button
            onClick={onRefuelNow}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-medium text-xs bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700"
          >
            Doch jetzt tanken
          </button>
        </>
      )}
      {verdict === "SWITCH_STATION" && (
        <>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setIntent("navigate")}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-xs bg-blue-500 hover:bg-blue-400 text-slate-950"
          >
            Navigation zu {altName ?? "Station"}
          </a>
          <button
            onClick={onRefuelNow}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-medium text-xs bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700"
          >
            Ich tanke hier ({stationName})
          </button>
        </>
      )}
      {verdict !== "SWITCH_STATION" && (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setIntent("navigate")}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-medium text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
        >
          Google Maps
        </a>
      )}
    </div>
  );
}

export function ManualFillButton({
  station,
  fuel,
  liters,
  clockHour,
  priceNow,
}: {
  station: StationData;
  fuel: string;
  liters: number;
  clockHour: number;
  priceNow: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-[11px] text-slate-400 hover:text-emerald-300 underline"
      >
        Tank nachtragen
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 w-full max-w-md">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white">Tank nachtragen</h3>
              <button onClick={() => setOpen(false)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Für Füllungen ohne offene Folge. Preis vorausgefüllt aus Nowcast — du bestätigst nur.
            </p>
            <p className="text-sm text-slate-200 mb-4">
              {station.name} · {liters} L · {priceNow.toFixed(3)} €/L · {formatHour(clockHour)} Uhr
            </p>
            <button
              onClick={() => {
                recordFill({
                  stationId: station.id,
                  stationName: station.name,
                  liters,
                  pricePaid: priceNow,
                  fuel,
                  clockHour,
                  source: "manual",
                });
                setOpen(false);
              }}
              className="w-full py-2.5 rounded-xl bg-emerald-500 text-slate-950 text-xs font-semibold"
            >
              Speichern
            </button>
          </div>
        </div>
      )}
    </>
  );
}
