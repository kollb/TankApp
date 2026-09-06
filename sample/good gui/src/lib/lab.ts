/**
 * Reine Auswertungs-Logik des Entscheidungs-Labors (läuft client- & serverseitig).
 * Kernidee: Entscheidungen sind Aktionen mit €-Ergebnissen, keine Vorhersagebänder.
 *
 * Aktionen (morgens 08:00):
 *   WAIT — „Ich fahre zur vorhergesagten billigsten Stunde hin und tanke."
 *           Realisierte Ersparnis S = p(08:00) − p(Fenster) in ct/L. S kann negativ sein
 *           (Nachmittags-Sprung-Tage). Ein „vergLEICHENDER" Wartender tankt nur, wenn
 *           der Preis nicht höher ist ⇒ realisiert max(S, 0).
 *   NOW  — „Ich tanke jetzt." Realisiert 0; verpasst die Ersparnis, wenn S > 0.
 *
 * Regel: WARTEN genau dann, wenn E[S | Training] ≥ ε (Handlungsschwelle).
 * Güte:  Trefferquote (Vorzeichen von S richtig), Entscheidungsverlust
 *        Regret = max(perfekte Sicht − realisiert, 0) in ct/L und € pro Füllung.
 */
import type { EvalRowDto } from "@/lib/types";

export type Action = "wait" | "now";

export function decide(mu: number, eps: number): Action {
  return mu >= eps ? "wait" : "now";
}

export function clsLabel(c: number): string {
  return c === 0 ? "Werktag" : "WE/Feiertag";
}

export function fmtCt(v: number, digits = 1): string {
  const s = v.toFixed(digits);
  return (v > 0 ? "+" : "") + s.replace(".", ",") + " ct";
}

export function fmtEur(v: number): string {
  const neg = v < 0;
  const s = Math.abs(v).toFixed(2).replace(".", ",");
  return (neg ? "−" : "") + s + " €";
}

export function fmtP(v: number): string {
  return Math.round(v * 100) + " %";
}

export interface RowOutcome {
  wait: boolean;
  hit: boolean; // Vorzeichen von S richtig vorhergesagt
  smartCt: number; // vergleichender Wartender
  committedCt: number; // kompromissloser Wartender
  regretCt: number; // Entscheidungsverlust vs. perfekte Sicht
  regretEur: number;
}

export function rowOutcome(r: EvalRowDto, eps: number, liters = 40): RowOutcome {
  const wait = decide(r.mu, eps) === "wait";
  const s = r.s;
  const hit = wait ? s > 0 : s <= 0;
  const smartCt = wait ? Math.max(s, 0) : 0;
  const committedCt = wait ? s : 0;
  const regretCt = Math.max(r.best - smartCt, 0);
  return {
    wait,
    hit,
    smartCt,
    committedCt,
    regretCt,
    regretEur: (regretCt / 100) * liters,
  };
}

export interface StationScore {
  stationId: string;
  n: number;
  nWait: number;
  hitWait: number; // Anteil korrekt unter „Warten"
  nNow: number;
  hitNow: number;
  sumSmartEur: number; // Regel-Ergebnis (vergleichend)
  sumCommitEur: number; // Regel-Ergebnis (kompromisslos)
  sumBestEur: number; // perfekte Sicht
  sumAlwaysWaitEur: number; // Baseline „immer warten" (vergleichend)
  avgRegretCt: number;
  avgRegretEur: number;
  pAvg: number; // mittlere behauptete P(S>0)
  hitFreq: number; // empirische Häufigkeit S>0
  potShare: number; // Anteil des machbaren Potenzials, das die Regel holt
}

export function scoreRows(rows: EvalRowDto[], eps: number, liters = 40, stationId = ""): StationScore {
  let nWait = 0,
    hitWait = 0,
    nNow = 0,
    hitNow = 0,
    sumSmart = 0,
    sumCommit = 0,
    sumBest = 0,
    sumAlways = 0,
    sumRegretCt = 0,
    sumP = 0,
    sPos = 0;
  for (const r of rows) {
    const o = rowOutcome(r, eps, liters);
    if (o.wait) {
      nWait++;
      if (o.hit) hitWait++;
    } else {
      nNow++;
      if (o.hit) hitNow++;
    }
    sumSmart += o.smartCt;
    sumCommit += o.committedCt;
    sumBest += Math.max(r.best, 0);
    sumAlways += Math.max(r.s, 0);
    sumRegretCt += o.regretCt;
    sumP += r.p;
    if (r.s > 0) sPos++;
  }
  const n = rows.length;
  const toEur = (ct: number) => (ct / 100) * liters;
  const sumSmartEur = toEur(sumSmart);
  const pot = Math.max(sumBest, 1e-9);
  return {
    stationId,
    n,
    nWait,
    hitWait: nWait ? hitWait / nWait : NaN,
    nNow,
    hitNow: nNow ? hitNow / nNow : NaN,
    sumSmartEur,
    sumCommitEur: toEur(sumCommit),
    sumBestEur: toEur(sumBest),
    sumAlwaysWaitEur: toEur(sumAlways),
    avgRegretCt: n ? sumRegretCt / n : NaN,
    avgRegretEur: n ? toEur(sumRegretCt) / n : NaN,
    pAvg: n ? sumP / n : NaN,
    hitFreq: n ? sPos / n : NaN,
    potShare: sumSmartEur / pot,
  };
}

/** Policy-Scan: Gesamtergebnis (€) der Regel als Funktion der Schwelle ε (ct/L). */
export function scanEps(
  rows: EvalRowDto[],
  liters = 40,
  step = 0.1,
  max = 4,
): { eps: number[]; commitEur: number[]; smartEur: number[]; waits: number[] } {
  const eps: number[] = [];
  const commitEur: number[] = [];
  const smartEur: number[] = [];
  const waits: number[] = [];
  for (let e = 0; e <= max + 1e-9; e += step) {
    let c = 0,
      s = 0,
      w = 0;
    for (const r of rows) {
      const o = rowOutcome(r, e, liters);
      c += o.committedCt;
      s += o.smartCt;
      if (o.wait) w++;
    }
    eps.push(Math.round(e * 100) / 100);
    commitEur.push((c / 100) * liters);
    smartEur.push((s / 100) * liters);
    waits.push(w);
  }
  return { eps, commitEur, smartEur, waits };
}

/** Kalibrierung der Entscheidungs-Wahrscheinlichkeit: behauptetes P(S>0) vs. beobachtete Häufigkeit. */
export interface CalibPoint {
  p: number; // behauptet (Trainings-Klasse)
  hit: number; // beobachtet (Eval)
  n: number;
  stationId: string;
  cls: number;
}

export function calibration(decisions: Record<string, EvalRowDto[]>, stationIds: string[]): CalibPoint[] {
  const out: CalibPoint[] = [];
  for (const sid of stationIds) {
    const rows = decisions[sid] ?? [];
    const byCls = new Map<number, EvalRowDto[]>();
    for (const r of rows) {
      const arr = byCls.get(r.cls) ?? [];
      arr.push(r);
      byCls.set(r.cls, arr);
    }
    for (const [cls, arr] of byCls) {
      const pos = arr.filter((r) => r.s > 0).length;
      out.push({
        p: arr[0].p,
        hit: arr.length ? pos / arr.length : NaN,
        n: arr.length,
        stationId: sid,
        cls,
      });
    }
  }
  return out;
}

/** Ökonomie „andere Station": K = d·c/100·p + (d/v)·z ; Δp* = K/L. */
export interface EcoParams {
  liters: number;
  detourKm: number;
  consumption: number; // L/100km
  refPriceEur: number; // €/L
  speedKmh: number;
  valueOfTime: number; // €/h
}

export function detourCostEur(p: EcoParams): number {
  const d = Math.max(p.detourKm, 0);
  return (d * p.consumption * p.refPriceEur) / 100 + (d / Math.max(p.speedKmh, 1)) * p.valueOfTime;
}

export function deltaStarCt(p: EcoParams): number {
  return (detourCostEur(p) / Math.max(p.liters, 1)) * 100;
}

export interface PairEval {
  trainMuCt: number; // E[self08 − alt08] Training
  trainPCheaper: number; // P(alt billiger um 08:00)
  evalNetsEur: number[]; // realisierte Netto-Ersparnis je Eval-Tag
  sharePositive: number;
  meanNetEur: number;
  worthIt: boolean;
  deltaStarCt: number;
  detourEur: number;
  grossMeanEur: number;
}

export function pairEval(
  selfP8: number[],
  altP8: number[],
  daysTrain: number,
  daysEval: number,
  eco: EcoParams,
): PairEval {
  const deltasTrain: number[] = [];
  const evalNetsEur: number[] = [];
  for (let i = 0; i < selfP8.length; i++) {
    const d = selfP8[i] - altP8[i]; // ct/L: positiv ⇒ andere Station billiger
    if (!Number.isFinite(d)) continue;
    if (i < daysTrain) deltasTrain.push(d);
    else if (i < daysTrain + daysEval) evalNetsEur.push(((d - deltaStarCt(eco)) / 100) * eco.liters);
  }
  const trainMu = deltasTrain.length ? deltasTrain.reduce((a, b) => a + b, 0) / deltasTrain.length : 0;
  const trainP = deltasTrain.length ? deltasTrain.filter((d) => d > 0).length / deltasTrain.length : 0;
  const meanNet = evalNetsEur.length ? evalNetsEur.reduce((a, b) => a + b, 0) / evalNetsEur.length : 0;
  return {
    trainMuCt: trainMu,
    trainPCheaper: trainP,
    evalNetsEur,
    sharePositive: evalNetsEur.length ? evalNetsEur.filter((n) => n > 0).length / evalNetsEur.length : NaN,
    meanNetEur: meanNet,
    worthIt: trainMu >= deltaStarCt(eco),
    deltaStarCt: deltaStarCt(eco),
    detourEur: detourCostEur(eco),
    grossMeanEur: (trainMu / 100) * eco.liters,
  };
}

export function niceDay(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  const wd = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][dt.getUTCDay()];
  return `${wd} ${day}.${String(m).padStart(2, "0")}.`;
}
