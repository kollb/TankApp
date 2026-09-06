/**
 * Deterministische Simulation des Entscheidungs-Labors.
 * Erzeugt realistische 5-min-Preisserien nach dem Strukturmodell des Konzepts:
 *   p(t) = Niveau + Tagesform(h) + Regime (Nachmittags-Sprung ⇒ Abendtief entfällt) + Rauschen
 * Aus dem Trainingsfenster (6 Wochen) werden je Station/Klasse geschätzt:
 *   μ = E[Ersparnis Warten], P = P(Ersparnis>0), billigste Stunde (12–23 Uhr)
 * Das Eval-Fenster (2 Wochen, out-of-sample) wird als Entscheidungs-Protokoll ausgegeben.
 * Alle Preise intern in ct/L (float), gespeichert wird €/L.
 */

import {
  CITIES,
  STATIONS,
  allDayStrings,
  classOf,
  isHoliday,
  DAYS_TRAIN,
  POINTS_PER_DAY,
  type CityDef,
  type StationDef,
  type ProfileKind,
} from "./config";

// ---------- Zufall (deterministisch) ----------
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  const u = Math.max(rng(), 1e-9);
  const v = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------- Tagesform-Templates (ct über Tagesniveau) ----------
type Kps = [number, number][];
interface Templates {
  y: Kps; // Normal
  nd: Kps; // ohne Abendtief (für Sprung-Tage)
}
type TplSet = Record<ProfileKind, { wk: Templates; we: Templates }>;

const T = {
  std: {
    wk: {
      y: [[6, 0.7], [7.5, 3.9], [8, 3.55], [9, 3.3], [12, 3.4], [15, 2.6], [17, 1.6], [19, -0.8], [20, -1.8], [21, -1.2], [22, -0.8], [24, -0.6]],
      nd: [[6, 0.7], [7.5, 3.9], [8, 3.55], [9, 3.3], [12, 3.4], [15, 2.6], [17, 2.3], [19, 2.1], [20, 2.0], [21, 1.9], [22, 1.8], [24, 1.6]],
    },
    we: {
      y: [[6, 0.4], [8, 2.0], [9, 2.9], [10, 3.1], [12, 2.9], [15, 2.2], [17, 1.3], [19, -0.4], [20, -1.0], [21, -1.4], [22, -0.8], [24, -0.5]],
      nd: [[6, 0.4], [8, 2.0], [9, 2.9], [10, 3.1], [12, 2.9], [15, 2.2], [17, 2.0], [19, 1.8], [20, 1.7], [21, 1.6], [22, 1.5], [24, 1.3]],
    },
  },
  disc: {
    wk: {
      y: [[6, 0.4], [7.5, 2.6], [8, 2.3], [9, 2.0], [12, 2.1], [15, 1.8], [17, 1.5], [19, 0.7], [20, 0.0], [21, 0.6], [22, 0.9], [24, 1.0]],
      nd: [[6, 0.4], [7.5, 2.6], [8, 2.3], [9, 2.0], [12, 2.1], [15, 1.8], [17, 1.8], [19, 1.8], [20, 1.8], [21, 1.8], [22, 1.8], [24, 1.8]],
    },
    we: {
      y: [[6, 0.2], [8, 1.7], [9, 1.9], [10, 2.0], [12, 1.9], [15, 1.6], [17, 1.3], [19, 0.5], [20, 0.1], [21, -0.2], [22, 0.4], [24, 0.6]],
      nd: [[6, 0.2], [8, 1.7], [9, 1.9], [10, 2.0], [12, 1.9], [15, 1.6], [17, 1.6], [19, 1.6], [20, 1.6], [21, 1.6], [22, 1.6], [24, 1.6]],
    },
  },
  flat: {
    wk: {
      y: [[6, 0.2], [8, 0.5], [9, 0.6], [12, 0.6], [15, 0.5], [17, 0.3], [19, 0.0], [20, -0.1], [21, -0.2], [22, 0.0], [24, 0.1]],
      nd: [[6, 0.2], [8, 0.5], [9, 0.6], [12, 0.6], [15, 0.6], [17, 0.55], [19, 0.5], [20, 0.45], [21, 0.4], [22, 0.4], [24, 0.4]],
    },
    we: {
      y: [[6, 0.1], [8, 0.4], [9, 0.5], [10, 0.5], [12, 0.5], [15, 0.4], [17, 0.2], [19, 0.0], [20, -0.1], [21, -0.1], [22, 0.0], [24, 0.0]],
      nd: [[6, 0.1], [8, 0.4], [9, 0.5], [10, 0.5], [12, 0.5], [15, 0.45], [17, 0.42], [19, 0.4], [20, 0.4], [21, 0.4], [22, 0.4], [24, 0.4]],
    },
  },
  riser: {
    wk: { y: [[6, 2.0], [8, 3.0], [9, 3.4], [10, 3.5], [12, 3.6], [13, 3.7], [15, 3.9], [17, 4.1], [19, 4.3], [20, 4.4], [22, 4.0], [24, 3.4]], nd: [[6, 2.0], [8, 3.0], [9, 3.4], [10, 3.5], [12, 3.6], [13, 3.7], [15, 3.9], [17, 4.1], [19, 4.3], [20, 4.4], [22, 4.0], [24, 3.4]] },
    we: { y: [[6, 1.6], [8, 2.3], [9, 2.7], [10, 2.9], [12, 3.0], [13, 3.1], [15, 3.3], [17, 3.5], [19, 3.7], [20, 3.8], [22, 3.4], [24, 2.9]], nd: [[6, 1.6], [8, 2.3], [9, 2.7], [10, 2.9], [12, 3.0], [13, 3.1], [15, 3.3], [17, 3.5], [19, 3.7], [20, 3.8], [22, 3.4], [24, 2.9]] },
  },
} as TplSet;

function TplOf(k: ProfileKind, c: "wk" | "we"): Templates {
  return { y: T[k][c].y.map((p) => [...p] as Kps[number]), nd: T[k][c].nd.map((p) => [...p] as Kps[number]) };
}

// Aggr nutzt std-Formen — nachträglich zuweisen (Objektliteral wäre sonst TDZ-Problem):
T.aggr = { wk: TplOf("std", "wk"), we: TplOf("std", "we") };

/** Sprung-Targets: realisierte Ersparnis S an Sprung-Tagen (ct/L) */
const SUPP_TARGET: Record<ProfileKind, { wk: number; we: number }> = {
  std: { wk: -1.3, we: -1.0 },
  aggr: { wk: -2.2, we: -1.6 },
  disc: { wk: -0.9, we: -0.6 },
  flat: { wk: -1.4, we: -1.0 },
  riser: { wk: 0, we: 0 },
};
/** Stunde, an der das Abendtief verankert ist (für die Sprung-Amplitude) */
const DIP_HOUR: Record<ProfileKind, { wk: number; we: number }> = {
  std: { wk: 20, we: 21 },
  aggr: { wk: 20, we: 21 },
  disc: { wk: 20, we: 21 },
  flat: { wk: 21, we: 21 },
  riser: { wk: 20, we: 21 },
};

function interp(kps: Kps, h: number): number {
  if (h <= kps[0][0]) return kps[0][1];
  for (let i = 1; i < kps.length; i++) {
    const [h0, v0] = kps[i - 1];
    const [h1, v1] = kps[i];
    if (h <= h1) {
      const f = (h - h0) / (h1 - h0);
      return v0 + f * (v1 - v0);
    }
  }
  return kps[kps.length - 1][1];
}

// ---------- Datentypen ----------
export interface DaySeries {
  date: string;
  dow: number;
  cls: number;
  holiday: boolean;
  p8: number; // ct/L, 08:00
  bestCt: number; // p8 − min(offen, nach 08:00)
  minHour: number;
  mean: number; // Mittel offener Punkte
  pts: number[]; // ct/L, 216 Punkte
  open: number[]; // 0/1
}

export interface StationResult {
  def: StationDef;
  city: CityDef;
  deltaCt: number;
  days: DaySeries[];
}

export interface ModelEst {
  predWk: number;
  predWe: number;
  shapeWk: number[]; // 18 Werte (Stunde 6..23), ct um Tagesmittel
  shapeWe: number[];
  savesWk: number[];
  savesWe: number[];
  muWk: number;
  muWe: number;
  pWk: number;
  pWe: number;
}

export interface EvalRow {
  day: string;
  cls: number;
  mu: number;
  p: number;
  s: number; // realisierte Ersparnis „Warten bis Fenster" ct/L
  best: number; // perfekte Sicht ct/L
  predHour: number;
}

export interface SimResult {
  cities: CityDef[];
  stations: StationResult[];
  models: Map<string, ModelEst>;
  evals: Map<string, EvalRow[]>;
  dayStrings: string[];
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// ---------- Hauptlauf ----------
export function runSimulation(): SimResult {
  const days = allDayStrings();
  const cities = CITIES;
  const cityBySlug = new Map(cities.map((c) => [c.slug, c]));
  const dayNum = days.length;

  const results: StationResult[] = [];
  for (const def of STATIONS) {
    const city = cityBySlug.get(def.city)!;
    results.push(buildStation(def, city, days));
  }

  // δ̂: Median über t von (p_i(t) − Median_{j≠i} p_j(t)) im Trainingsfenster
  computeDelta(results);

  const models = new Map<string, ModelEst>();
  const evals = new Map<string, EvalRow[]>();
  for (const r of results) {
    const est = estimateModel(r);
    models.set(r.def.id, est);
    evals.set(r.def.id, buildEvals(r, est));
  }

  return { cities, stations: results, models, evals, dayStrings: days };
}

function buildStation(def: StationDef, city: CityDef, days: string[]): StationResult {
  const rng = mulberry32(hashStr(def.id + "::" + city.slug));
  const tplWk = T[def.profile].wk;
  const tplWe = T[def.profile].we;
  const out: DaySeries[] = [];

  for (let k = 0; k < days.length; k++) {
    const date = days[k];
    const dow = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))).getUTCDay();
    const holiday = isHoliday(date, city.state);
    const cls = classOf(date, dow, city.state);
    const tpl = cls === 0 ? tplWk : tplWe;
    const y8 = interp(tpl.y, 8);

    // Sprung-Regime
    const pbEff = cls === 0 ? def.pb : def.pb * 0.5;
    const supp = def.profile !== "riser" && rng() < pbEff;
    let amp = 0;
    let J = 24;
    if (supp) {
      const dh = DIP_HOUR[def.profile][cls === 0 ? "wk" : "we"];
      const target = SUPP_TARGET[def.profile][cls === 0 ? "wk" : "we"];
      const ndAtDip = interp(tpl.nd, dh);
      const u = gauss(rng) * 0.45;
      amp = y8 - ndAtDip - target - u;
      J = 11.5 + rng() * 4; // Sprung zwischen 11:30 und 15:30
    }

    const level = city.baseCt + def.baseOffsetCt + gauss(rng) * 0.35;
    const pts: number[] = new Array(POINTS_PER_DAY);
    const open: number[] = new Array(POINTS_PER_DAY);
    let lastOpen = level + y8;

    for (let i = 0; i < POINTS_PER_DAY; i++) {
      const h = 6 + i / 12;
      let v: number;
      if (supp && h >= J) {
        v = level + interp(tpl.nd, h) + amp;
      } else {
        v = level + interp(tpl.y, h);
      }
      v += gauss(rng) * 0.32;
      const isOpen = !(def.close22 && h >= 22);
      if (!isOpen) v = lastOpen; // geschlossen: Preis eingefroren (Zapfhahn-Realität)
      else lastOpen = v;
      pts[i] = v;
      open[i] = isOpen ? 1 : 0;
    }

    const p8 = pts[24]; // 08:00
    // Minimum nach 08:00 über offene Punkte
    let minV = Infinity;
    let minI = 24;
    let sum = 0;
    let n = 0;
    for (let i = 25; i < POINTS_PER_DAY; i++) {
      if (open[i]) {
        sum += pts[i];
        n++;
        if (pts[i] < minV) {
          minV = pts[i];
          minI = i;
        }
      }
    }
    if (!isFinite(minV)) {
      minV = p8;
      minI = 24;
    }
    out.push({
      date,
      dow,
      cls,
      holiday,
      p8,
      bestCt: p8 - minV,
      minHour: 6 + minI / 12,
      mean: n > 0 ? sum / n : p8,
      pts,
      open,
    });
  }
  return { def, city, deltaCt: 0, days: out };
}

function computeDelta(results: StationResult[]): void {
  const byCity = new Map<string, StationResult[]>();
  for (const r of results) {
    const arr = byCity.get(r.city.slug) ?? [];
    arr.push(r);
    byCity.set(r.city.slug, arr);
  }
  for (const group of byCity.values()) {
    const devs: number[][] = group.map(() => []);
    const nSt = group.length;
    for (let k = 0; k < DAYS_TRAIN; k++) {
      for (let i = 0; i < POINTS_PER_DAY; i++) {
        const prices = group.map((r) => r.days[k].pts[i]);
        for (let s = 0; s < nSt; s++) {
          const others = prices.filter((_, j) => j !== s);
          devs[s].push(prices[s] - median(others));
        }
      }
    }
    group.forEach((r, s) => {
      r.deltaCt = median(devs[s]);
    });
  }
}

function estimateModel(r: StationResult): ModelEst {
  // Stunden-Bucket-Mittel (offene Punkte) je Klasse über das Trainingsfenster.
  // Leere Buckets (geschlossene Stunden) werden übersprungen — nie mit 0 gefüllt!
  const buckets: Record<number, number[][]> = { 0: [], 1: [] };
  const saves: Record<number, number[]> = { 0: [], 1: [] };

  // 1) Bucket-Mittel
  for (let k = 0; k < DAYS_TRAIN; k++) {
    const d = r.days[k];
    const acc = buckets[d.cls];
    for (let h = 6; h <= 23; h++) {
      const arr: number[] = [];
      for (let m = 0; m < 12; m++) {
        const idx = (h - 6) * 12 + m;
        if (d.open[idx]) arr.push(d.pts[idx]);
      }
      if (arr.length > 0) {
        acc[h - 6] = acc[h - 6] ?? [];
        acc[h - 6].push(mean(arr));
      }
    }
  }
  const hourlyMean: Record<number, number[]> = { 0: [], 1: [] };
  for (const cls of [0, 1]) {
    for (let h = 6; h <= 23; h++) {
      const list = buckets[cls][h - 6] ?? [];
      hourlyMean[cls][h - 6] = list.length > 0 ? mean(list) : NaN;
    }
  }
  const predHour = (cls: number): number => {
    let best = -1;
    let bv = Infinity;
    for (let h = 12; h <= 23; h++) {
      const v = hourlyMean[cls][h - 6];
      if (Number.isFinite(v) && v < bv) {
        bv = v;
        best = h;
      }
    }
    return best >= 0 ? best : 20;
  };
  const predWk = predHour(0);
  const predWe = predHour(1);

  // 2) Trainings-Ersparnisse S = p8 − p(vorhergesagte Stunde, 30 min nach)
  const sOf = (d: DaySeries, h: number): number => {
    const idx = (h - 6) * 12 + 6;
    if (d.open[idx]) return d.p8 - d.pts[idx];
    // Fallback: nächster offener Punkt
    for (let m = 0; m < 12; m++) {
      const i2 = idx + m;
      if (i2 < POINTS_PER_DAY && d.open[i2]) return d.p8 - d.pts[i2];
      const i3 = idx - m;
      if (i3 >= 0 && d.open[i3]) return d.p8 - d.pts[i3];
    }
    return 0;
  };
  for (let k = 0; k < DAYS_TRAIN; k++) {
    const d = r.days[k];
    const h = d.cls === 0 ? predWk : predWe;
    saves[d.cls].push(sOf(d, h));
  }
  // 3) Form für die Anzeige (Abweichung vom Tagesmittel, ct)
  const shape = (cls: number): number[] => {
    const hm = hourlyMean[cls];
    const base = mean(hm);
    return hm.map((v) => Math.round((v - base) * 100) / 100);
  };

  const stat = (cls: number) => {
    const sv = saves[cls];
    const mu = mean(sv);
    const p = sv.length ? sv.filter((s) => s > 0).length / sv.length : 0;
    return { mu, p, sv: sv.map((x) => Math.round(x * 100) / 100) };
  };
  const a = stat(0);
  const b = stat(1);

  return {
    predWk,
    predWe,
    shapeWk: shape(0),
    shapeWe: shape(1),
    savesWk: a.sv,
    savesWe: b.sv,
    muWk: Math.round(a.mu * 100) / 100,
    muWe: Math.round(b.mu * 100) / 100,
    pWk: Math.round(a.p * 1000) / 1000,
    pWe: Math.round(b.p * 1000) / 1000,
  };
}

function buildEvals(r: StationResult, est: ModelEst): EvalRow[] {
  const rows: EvalRow[] = [];
  for (let k = DAYS_TRAIN; k < r.days.length; k++) {
    const d = r.days[k];
    const h = d.cls === 0 ? est.predWk : est.predWe;
    const mu = d.cls === 0 ? est.muWk : est.muWe;
    const p = d.cls === 0 ? est.pWk : est.pWe;
    const idx = (h - 6) * 12 + 6;
    let s = 0;
    if (d.open[idx]) s = d.p8 - d.pts[idx];
    else {
      for (let m = 0; m < 12; m++) {
        if (idx + m < POINTS_PER_DAY && d.open[idx + m]) {
          s = d.p8 - d.pts[idx + m];
          break;
        }
        if (idx - m >= 0 && d.open[idx - m]) {
          s = d.p8 - d.pts[idx - m];
          break;
        }
      }
    }
    rows.push({
      day: d.date,
      cls: d.cls,
      mu: Math.round(mu * 100) / 100,
      p: Math.round(p * 1000) / 1000,
      s: Math.round(s * 100) / 100,
      best: Math.round(d.bestCt * 100) / 100,
      predHour: h,
    });
  }
  return rows;
}

/** Großkreis-Distanz in km (für Umweg-Ökonomie) */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
