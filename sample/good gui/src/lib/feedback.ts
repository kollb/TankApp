/**
 * Asynchrones Feedback: Episode (Tank-Folge) statt einzelner /v1/decide-Aufrufe.
 *
 * Drei Uhren, die man nicht in einen Button zwingen darf:
 *   1. Advice  — jede eindeutige Empfehlung, auto-settlement aus Preisen (Brier)
 *   2. Intent  — Nutzer sagt „ich warte“ / „ich fahre“ (kein Tank)
 *   3. Fill    — echter Tankvorgang, oft Stunden später (persönliche €-Bilanz)
 *
 * Persönliche Euro und Modell-Trefferquote dürfen nie dieselbe Zahl sein.
 */

export type AdviceAction = "refuel_now" | "wait" | "refuel_elsewhere" | "no_advice";
export type EpisodeStatus = "open" | "waiting" | "due" | "resolved" | "expired";
export type Intent = "none" | "wait" | "navigate" | "refuel_now" | "dismiss";
export type Compliance = "followed" | "partial" | "ignored" | "unrelated";
export type AdviceOutcome = "win" | "loss" | "tie" | "pending";
export type FillSource = "explicit_now" | "prompt" | "manual";

export interface Snapshot {
  id: string;
  emittedAt: string;
  clockHour: number;
  action: AdviceAction;
  stationId: string;
  stationName: string;
  altStationId?: string;
  altStationName?: string;
  priceNow: number;
  windowStartHour?: number;
  windowEndHour?: number;
  expectedPrice?: number;
  expectedSavingEur: number;
  pCorrect: number | null;
  litersAssumed: number;
  fuel: string;
}

export interface Episode {
  id: string;
  openedAt: string;
  closedAt?: string;
  status: EpisodeStatus;
  intent: Intent;
  firstSnapshot: Snapshot;
  lastSnapshot: Snapshot;
  snapshots: Snapshot[];
}

export interface FillEvent {
  id: string;
  episodeId: string | null;
  stationId: string;
  stationName: string;
  tankedAt: string;
  clockHour: number;
  liters: number;
  pricePaid: number;
  fuel: string;
  source: FillSource;
  compliance: Compliance;
  savedVsAlwaysNowEur: number;
}

export interface AdviceSettlement {
  snapshotId: string;
  episodeId: string;
  settledAt: string;
  pEmit: number;
  pWindow: number;
  outcome: AdviceOutcome;
  regretEur: number;
}

export interface FeedbackStore {
  episodes: Episode[];
  fills: FillEvent[];
  settlements: AdviceSettlement[];
}

export interface DecisionInput {
  verdict: "NOW" | "WAIT" | "SWITCH_STATION";
  stationId: string;
  stationName: string;
  altStationId?: string;
  altStationName?: string;
  priceNow: number;
  expectedPriceLater: number;
  expectedSavingEur: number;
  windowStartHour: number;
  windowEndHour: number;
  liters: number;
  fuel: string;
  clockHour: number;
}

const STORAGE_KEY = "tankapp.feedback.v1";
const SNAPSHOT_COLLAPSE_H = 0.5; // 30 min
const EPISODE_MAX_H = 72;
const NOW_GRACE_H = 0.75;
const WAIT_GRACE_AFTER_H = 1;
const THETA = 0.01; // 1 ct

const emptyStore = (): FeedbackStore => ({
  episodes: [],
  fills: [],
  settlements: [],
});

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function subscribeFeedback(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadStore(): FeedbackStore {
  if (!canUseStorage()) return emptyStore();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as FeedbackStore;
    return {
      episodes: parsed.episodes ?? [],
      fills: parsed.fills ?? [],
      settlements: parsed.settlements ?? [],
    };
  } catch {
    return emptyStore();
  }
}

function saveStore(store: FeedbackStore) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  notify();
}

function uid(prefix: string) {
  const n =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${n}`;
}

function verdictToAction(v: DecisionInput["verdict"]): AdviceAction {
  if (v === "NOW") return "refuel_now";
  if (v === "WAIT") return "wait";
  return "refuel_elsewhere";
}

function parseHourLabel(label: string | undefined, fallback: number): number {
  if (!label) return fallback;
  const m = /^(\d{1,2})(?::(\d{2}))?/.exec(label);
  if (!m) return fallback;
  return Number(m[1]) + Number(m[2] ?? 0) / 60;
}

export function hourFromWindowLabel(start: string, end: string): { start: number; end: number } {
  return { start: parseHourLabel(start, 17.5), end: parseHourLabel(end, 20.5) };
}

function sameAdvice(a: Snapshot, b: Omit<Snapshot, "id" | "emittedAt">) {
  return (
    a.action === b.action &&
    a.stationId === b.stationId &&
    a.altStationId === b.altStationId &&
    a.fuel === b.fuel &&
    Math.abs(a.clockHour - b.clockHour) < SNAPSHOT_COLLAPSE_H
  );
}

function openEpisode(store: FeedbackStore): Episode | undefined {
  return store.episodes.find((e) => e.status === "open" || e.status === "waiting" || e.status === "due");
}

function snapshotFromDecision(d: DecisionInput): Omit<Snapshot, "id" | "emittedAt"> {
  return {
    clockHour: d.clockHour,
    action: verdictToAction(d.verdict),
    stationId: d.stationId,
    stationName: d.stationName,
    altStationId: d.altStationId,
    altStationName: d.altStationName,
    priceNow: d.priceNow,
    windowStartHour: d.windowStartHour,
    windowEndHour: d.windowEndHour,
    expectedPrice: d.expectedPriceLater,
    expectedSavingEur: d.expectedSavingEur,
    pCorrect: null,
    litersAssumed: d.liters,
    fuel: d.fuel,
  };
}

function maybeExpire(ep: Episode, clockHour: number, nowIso: string): Episode {
  const opened = new Date(ep.openedAt).getTime();
  const ageH = (Date.now() - opened) / 3600000;
  // Simulated-day expiry: if the clock wrapped past the window + 6 h without intent/fill
  const last = ep.lastSnapshot;
  const pastWindow =
    last.windowEndHour != null && clockHour > last.windowEndHour + 6 && ep.intent === "none";
  if (ageH > EPISODE_MAX_H || pastWindow) {
    return { ...ep, status: "expired", closedAt: nowIso };
  }
  return ep;
}

function settleSnapshot(ep: Episode, snap: Snapshot, nowIso: string): AdviceSettlement {
  const pEmit = snap.priceNow;
  const pWindow = snap.expectedPrice ?? snap.priceNow;
  const liters = snap.litersAssumed;
  let outcome: AdviceOutcome = "tie";
  if (snap.action === "wait") {
    if (pWindow <= pEmit - THETA) outcome = "win";
    else if (pWindow >= pEmit + THETA) outcome = "loss";
  } else if (snap.action === "refuel_now") {
    // NOW is right if waiting would not have beaten θ
    if (pWindow >= pEmit - THETA) outcome = "win";
    else outcome = "loss";
  } else {
    outcome = pWindow <= pEmit - THETA ? "win" : "tie";
  }
  const regretEur = Number((Math.max(0, pEmit - Math.min(pEmit, pWindow)) * liters).toFixed(2));
  return {
    snapshotId: snap.id,
    episodeId: ep.id,
    settledAt: nowIso,
    pEmit,
    pWindow,
    outcome,
    regretEur,
  };
}

function refreshDueStatus(ep: Episode, clockHour: number, nowIso: string, settlements: AdviceSettlement[]): Episode {
  if (ep.status === "resolved" || ep.status === "expired") return ep;
  const snap = ep.lastSnapshot;
  const windowEnd = snap.windowEndHour ?? 20.5;
  // Nur nach ausdrücklichem Intent nachfragen — bloßes Anschauen der Ampel ist kein Tankzyklus.
  const waiting = ep.intent === "wait" || ep.intent === "navigate";
  if (waiting && clockHour >= windowEnd + WAIT_GRACE_AFTER_H) {
    if (!settlements.some((s) => s.snapshotId === snap.id)) {
      settlements.push(settleSnapshot(ep, snap, nowIso));
    }
    return { ...ep, status: "due" };
  }
  if (ep.intent === "wait" || ep.intent === "navigate") {
    return { ...ep, status: "waiting" };
  }
  return ep;
}

export function syncFromDecision(d: DecisionInput): FeedbackStore {
  const store = loadStore();
  const nowIso = new Date().toISOString();
  const body = snapshotFromDecision(d);

  store.episodes = store.episodes.map((e) => maybeExpire(e, d.clockHour, nowIso));

  let ep = openEpisode(store);
  if (!ep) {
    const justClosed = store.episodes.find((e) => {
      if (e.status !== "resolved" || !e.closedAt) return false;
      return Date.now() - new Date(e.closedAt).getTime() < 8000;
    });
    if (justClosed) {
      saveStore(store);
      return store;
    }
    const snap: Snapshot = { ...body, id: uid("snap"), emittedAt: nowIso };
    ep = {
      id: uid("ep"),
      openedAt: nowIso,
      status: "open",
      intent: "none",
      firstSnapshot: snap,
      lastSnapshot: snap,
      snapshots: [snap],
    };
    store.episodes.unshift(ep);
  } else {
    const last = ep.lastSnapshot;
    if (sameAdvice(last, body)) {
      const updated: Snapshot = { ...last, ...body, id: last.id, emittedAt: last.emittedAt };
      ep = {
        ...ep,
        lastSnapshot: updated,
        snapshots: ep.snapshots.map((s) => (s.id === last.id ? updated : s)),
      };
    } else {
      const snap: Snapshot = { ...body, id: uid("snap"), emittedAt: nowIso };
      ep = {
        ...ep,
        lastSnapshot: snap,
        snapshots: [...ep.snapshots, snap],
      };
    }
    const idx = store.episodes.findIndex((e) => e.id === ep!.id);
    store.episodes[idx] = ep;
  }

  const idx = store.episodes.findIndex((e) => e.id === ep!.id);
  store.episodes[idx] = refreshDueStatus(store.episodes[idx], d.clockHour, nowIso, store.settlements);
  saveStore(store);
  return store;
}

export function setIntent(intent: Intent): FeedbackStore {
  const store = loadStore();
  const ep = openEpisode(store);
  if (!ep) return store;
  const next: Episode = {
    ...ep,
    intent,
    status: intent === "wait" || intent === "navigate" ? "waiting" : ep.status,
  };
  store.episodes = store.episodes.map((e) => (e.id === ep.id ? next : e));
  saveStore(store);
  return store;
}

export function classifyCompliance(ep: Episode | undefined, fillHour: number, stationId: string): Compliance {
  if (!ep) return "unrelated";
  const snap = ep.lastSnapshot;
  const sameStation = stationId === snap.stationId || stationId === snap.altStationId;
  if (snap.action === "refuel_now") {
    if (sameStation && Math.abs(fillHour - snap.clockHour) <= NOW_GRACE_H) return "followed";
    if (sameStation) return "partial";
    return "ignored";
  }
  if (snap.action === "wait") {
    const a = (snap.windowStartHour ?? 17.5) - 0.5;
    const b = (snap.windowEndHour ?? 20.5) + 1;
    const inWindow = fillHour >= a && fillHour <= b;
    if (sameStation && inWindow) return "followed";
    if (sameStation || inWindow) return "partial";
    return "ignored";
  }
  if (snap.action === "refuel_elsewhere") {
    if (stationId === snap.altStationId) return "followed";
    if (stationId === snap.stationId) return "ignored";
    return "partial";
  }
  return "unrelated";
}

export function recordFill(input: {
  stationId: string;
  stationName: string;
  liters: number;
  pricePaid: number;
  fuel: string;
  clockHour: number;
  source: FillSource;
  episodeId?: string | null;
}): FeedbackStore {
  const store = loadStore();
  const nowIso = new Date().toISOString();
  const ep =
    store.episodes.find((e) => e.id === input.episodeId) ??
    openEpisode(store);

  const compliance = classifyCompliance(ep, input.clockHour, input.stationId);
  const refPrice = ep ? ep.firstSnapshot.priceNow : input.pricePaid;
  const savedVsAlwaysNowEur = Number(((refPrice - input.pricePaid) * input.liters).toFixed(2));

  const fill: FillEvent = {
    id: uid("fill"),
    episodeId: ep?.id ?? null,
    stationId: input.stationId,
    stationName: input.stationName,
    tankedAt: nowIso,
    clockHour: input.clockHour,
    liters: input.liters,
    pricePaid: input.pricePaid,
    fuel: input.fuel,
    source: input.source,
    compliance,
    savedVsAlwaysNowEur,
  };
  store.fills.unshift(fill);

  if (ep && ep.status !== "expired") {
    if (!store.settlements.some((s) => s.snapshotId === ep.lastSnapshot.id)) {
      store.settlements.push(settleSnapshot(ep, ep.lastSnapshot, nowIso));
    }
    store.episodes = store.episodes.map((e) =>
      e.id === ep.id ? { ...e, status: "resolved" as const, closedAt: nowIso, intent: e.intent } : e,
    );
  }

  saveStore(store);
  return store;
}

export function dismissDue(): FeedbackStore {
  const store = loadStore();
  const ep = openEpisode(store);
  if (!ep || ep.status !== "due") return store;
  store.episodes = store.episodes.map((e) =>
    e.id === ep.id
      ? { ...e, status: "expired" as const, intent: "dismiss" as const, closedAt: new Date().toISOString() }
      : e,
  );
  saveStore(store);
  return store;
}

export function resetFeedbackDemo(): FeedbackStore {
  const store = emptyStore();
  saveStore(store);
  return store;
}

export interface Ledger {
  advice: {
    n: number;
    wins: number;
    losses: number;
    ties: number;
    hitRate: number | null;
    waitN: number;
    waitHits: number;
    nowN: number;
    nowHits: number;
  };
  wallet: {
    nFills: number;
    followed: number;
    partial: number;
    ignored: number;
    savedEur: number;
    lastFill?: FillEvent;
  };
  current?: Episode;
  due?: Episode;
}

export function computeLedger(store: FeedbackStore = loadStore()): Ledger {
  const current = openEpisode(store);
  const due = store.episodes.find((e) => e.status === "due");
  const wins = store.settlements.filter((s) => s.outcome === "win").length;
  const losses = store.settlements.filter((s) => s.outcome === "loss").length;
  const ties = store.settlements.filter((s) => s.outcome === "tie").length;
  const n = store.settlements.length;

  let waitN = 0,
    waitHits = 0,
    nowN = 0,
    nowHits = 0;
  for (const s of store.settlements) {
    const snap = store.episodes.flatMap((e) => e.snapshots).find((x) => x.id === s.snapshotId);
    if (!snap) continue;
    if (snap.action === "wait") {
      waitN++;
      if (s.outcome === "win") waitHits++;
    }
    if (snap.action === "refuel_now") {
      nowN++;
      if (s.outcome === "win") nowHits++;
    }
  }

  const followed = store.fills.filter((f) => f.compliance === "followed").length;
  const partial = store.fills.filter((f) => f.compliance === "partial").length;
  const ignored = store.fills.filter((f) => f.compliance === "ignored").length;
  const savedEur = Number(store.fills.reduce((a, f) => a + f.savedVsAlwaysNowEur, 0).toFixed(2));

  return {
    advice: {
      n,
      wins,
      losses,
      ties,
      hitRate: n ? (wins + ties * 0.5) / n : null,
      waitN,
      waitHits,
      nowN,
      nowHits,
    },
    wallet: {
      nFills: store.fills.length,
      followed,
      partial,
      ignored,
      savedEur,
      lastFill: store.fills[0],
    },
    current,
    due,
  };
}

export function formatHour(h: number): string {
  const hours = Math.floor(h);
  const minutes = Math.round((h % 1) * 60);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

export function actionLabel(a: AdviceAction): string {
  if (a === "wait") return "WARTEN";
  if (a === "refuel_elsewhere") return "WOANDERS";
  if (a === "no_advice") return "KEINE EMPFEHLUNG";
  return "JETZT";
}
