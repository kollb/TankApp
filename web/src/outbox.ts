// I1: Outbox — die Schreib-Warteschlange des Browsers, persistent in IndexedDB.
//
// B10 hat die Queue in localStorage gelegt: flüchtig genug, dass ein
// Tab-Neustart zwischen „vormerken“ und „nachreichen“ den Eintrag fraß, und
// kein gemeinsames Objekt, das mehrere Tabs gleichzeitig sehen — zwei
// Geräte an derselben Säule konnten denselben Beleg doppelt nachreichen.
//
// Die Outbox jetzt:
//
// * Ablage in IndexedDB (`tankapp.outbox.v1`), Store `entries` (offene und
//   sichtbare Einträge) und `history` (quittierte/entfernte, nachweisbar).
// * Jeder Eintrag hat einen Zustand: `pending` → `sending` → (quittiert |
//   `retry` → … | `rejected` | `expired`). Jeder Eintrag endet sichtbar —
//   nichts wird still verworfen.
// * Mehrere Tabs koordinieren sich über Leases (30 s): Ein Tab arbeitet an
//   einem Eintrag, andere Tabs sehen die Leasing-Markierung und überspringen
//   ihn; abgelaufene Leases werden zurückerobert (der Tab ist weg, der
//   Eintrag wartet weiter).
// * 429 bleibt wiederholbar: `Retry-After` des Servers wird respektiert,
//   sonst exponentiell mit Cap. 4xx (außer 429) ist eine Entscheidung des
//   Servers — `rejected`, sichtbar, exportierbar, vom Nutzer entfernbar.
// * Älter als eine Woche (`QUEUE_MAX_AGE_MS`): `expired` — ebenfalls
//   sichtbar statt still (der Datenstand wäre unklar).
// * BroadcastChannel (`tankapp.outbox`) verkündet Änderungen an andere
//   Tabs (feature-detected — ohne Channel greift das eigene Emit).
//
// Nur Belege und Vorsätze landen hier (wie bei B10): Profile, Storno und
// Jobstart bleiben sofort-schreibend, weil sie Entscheidungen sind und keine
// Datenerfassung im Funkloch.

export const OUTBOX_DB_NAME = "tankapp.outbox.v1";
export const OUTBOX_DB_VERSION = 1;

/** Mehr als das ist kein Funkloch mehr — dann lieber ehrlich ablehnen. */
export const OUTBOX_MAX_ENTRIES = 50;
/** Älteres als eine Woche wird nicht mehr nachgereicht (Datenstand unklar). */
export const OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Lease eines arbeitenden Tabs — andere Tabs überspringen den Eintrag. */
export const OUTBOX_LEASE_MS = 30_000;
/** Basis der exponentiellen Wiederholung (Transportfehler ohne Hinweis). */
export const OUTBOX_BACKOFF_BASE_MS = 30_000;
/** Cap der Wiederholung — danach wartet der Eintrag den 7-Tage-Horizont ab. */
export const OUTBOX_BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;
export const OUTBOX_CHANNEL = "tankapp.outbox";

const STORE_ENTRIES = "entries";
const STORE_HISTORY = "history";

export type OutboxKind = "fill" | "intent";
export type OutboxState = "pending" | "sending" | "retry" | "rejected" | "expired";
export type OutboxOutcome = "sent" | "rejected" | "expired" | "cleared";

/**
 * Ist der Fehler ein Verbindungsproblem (nachreichen) oder eine Entscheidung?
 *
 * „Niemand da“ (502/503/504) und „zu schnell“ (429, `Retry-After`) werden
 * nachgereicht. `status === 0`/`undefined` heißt: die Anfrage kam gar nicht
 * an (offline, CORS, Timeout). Ein 500 ist ein Programmfehler und ein 4xx
 * (außer 429) eine Entscheidung — die endet den Eintrag als `rejected`,
 * statt endlos wiederholt zu werden.
 */
export function isTransportError(status?: number): boolean {
  if (typeof status === "number" && status > 0) {
    return status === 429 || status === 502 || status === 503 || status === 504;
  }
  return true;
}

export interface OutboxEntry {
  /** Stabile ID — verhindert Doppelabschicken desselben Eintrags. */
  id: string;
  kind: OutboxKind;
  /** Ziel relativ zur App, z. B. "/api/v1/fills". */
  path: string;
  /** Der fertige JSON-Body (unverändert, wie ihn der Server erwartet). */
  body: string;
  created_at: number;
  state: OutboxState;
  state_at: number;
  attempts: number;
  /** Frühester nächster Versuch — `next_attempt_at` ist kein Versprechen. */
  next_attempt_at: number;
  /** Tab, das gerade an dem Eintrag arbeitet (Lease). */
  lease_owner: string | null;
  lease_expires_at: number | null;
  last_error: string | null;
}

export interface OutboxHistoryItem {
  /** `/<Eintrags-ID>:<outcome>` — der Eintrag selbst bleibt zitierbar. */
  id: string;
  kind: OutboxKind;
  path: string;
  body: string;
  created_at: number;
  ended_at: number;
  outcome: OutboxOutcome;
  attempts: number;
  last_error: string | null;
}

export type EnqueueResult =
  | { ok: true; entry: OutboxEntry; open: number }
  | { ok: false; error: "queue_full" | "storage_failed" };

/**
 * Ergebnis eines Nachreich-Versuchs. `permanent`: der Server hat eine
 * Entscheidung getroffen (4xx ohne 429) — nicht wiederholen, sichtbar
 * ablegen. `retryAfterSeconds`: serverseitiges `Retry-After` (429) —
 * respektieren statt raten.
 */
export interface OutboxSendResult {
  ok: boolean;
  permanent?: boolean;
  retryAfterSeconds?: number | null;
  error?: string | null;
}

/** Zählt gegen die Obergrenze — `rejected`/`expired` sind sichtbar, aber
 *  kein aktiver Druck mehr (sonst blockierte alte Abfälle neue Belege). */
export const OPEN_STATES: readonly OutboxState[] = ["pending", "sending", "retry"];
export const TERMINAL_STATES: readonly OutboxState[] = ["rejected", "expired"];

function newId(now: number): string {
  let random: string;
  try {
    random = crypto.getRandomValues(new Uint32Array(2)).join("");
  } catch {
    random = Math.random().toString(36).slice(2);
  }
  return `q_${now.toString(36)}_${random}`;
}

/** Tab-Kennung für Leases — pro Tab stabil, zwischen Tabs verschieden. */
let TAB_ID: string | null = null;
export function tabId(): string {
  if (!TAB_ID) {
    try {
      TAB_ID = `tab_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    } catch {
      TAB_ID = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }
  }
  return TAB_ID;
}

let dbPromise: Promise<IDBDatabase> | null = null;
/**
 * Test-Hook: die Outbox zurücksetzen (leere Stores, frische Tab-Kennung).
 * Die offene Verbindung wird geschlossen und neu geöffnet — ``deleteDatabase``
 * würde hier nur Timing-Kanten in die Tests bringen. Wenn ``indexedDB``
 * nicht verfügbar ist (storage_failed-Test), bleibt die DB zu.
 */
export async function resetOutboxForTests(): Promise<void> {
  if (dbPromise) {
    try {
      (await dbPromise).close();
    } catch {
      /* Verbindung war schon weg — dann ist nichts zu schließen. */
    }
    dbPromise = null;
  }
  TAB_ID = null;
  if (channel) {
    try {
      channel.close();
    } catch {
      /* Channel ohne Implementation (private Umgebungen) — egal. */
    }
    channel = null;
  }
  if (typeof indexedDB === "undefined") return;
  const db = await openOutbox();
  const t = db.transaction([STORE_ENTRIES, STORE_HISTORY], "readwrite");
  t.objectStore(STORE_ENTRIES).clear();
  t.objectStore(STORE_HISTORY).clear();
  await txDone(t);
}

function openOutbox(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB fehlt"));
      return;
    }
    const request = indexedDB.open(OUTBOX_DB_NAME, OUTBOX_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
        db.createObjectStore(STORE_ENTRIES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        db.createObjectStore(STORE_HISTORY, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Outbox nicht verfügbar"));
    request.onblocked = () => reject(new Error("Outbox-Verbindung blockiert"));
  });
  return dbPromise;
}

function tx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  ...stores: string[]
): IDBTransaction {
  return db.transaction(stores, mode);
}

/** Promise-Wrapper um eine IDB-Operation (resolve bei success, reject bei error). */
function idbDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Outbox-Operation fehlgeschlagen"));
  });
}

function entryRecord(value: unknown): value is OutboxEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    (entry.kind === "fill" || entry.kind === "intent") &&
    typeof entry.path === "string" &&
    typeof entry.body === "string" &&
    typeof entry.created_at === "number"
  );
}

function sortEntries(entries: OutboxEntry[]): OutboxEntry[] {
  return [...entries].sort((a, b) =>
    a.created_at === b.created_at ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.created_at - b.created_at,
  );
}

/**
 * Ist der Eintrag jetzt dran?
 *
 * Endzustände (`rejected`/`expired`) sind nie dran — sie sind sichtbar
 * abgelegt, kein wiederholbarer Auftrag. Ein `sending`-Eintrag ist nur
 * reclaimbar, wenn seine Lease abgelaufen ist (oder seinem eigenen Tab
 * gehört) — das sendende Tab ist weg, der Eintrag darf die Reihe nicht
 * blockieren.
 */
function isClaimable(entry: OutboxEntry, now: number, owner: string): boolean {
  if (entry.state === "rejected" || entry.state === "expired") return false;
  if (entry.next_attempt_at > now) return false;
  if (entry.lease_owner != null && entry.lease_owner !== owner) {
    // Fremde Lease: solange sie lebt, arbeitet ein anderes Tab daran.
    if (entry.lease_expires_at == null || entry.lease_expires_at > now) return false;
  }
  return entry.state === "pending" || entry.state === "retry" || entry.state === "sending";
}

/**
 * Abgelaufene offene Einträge nach `expired` sortieren — sichtbar, nicht
 * still. Der Übergang bleibt in der Historie nachweisbar wie jeder andere
 * Endzustand.
 */
async function expireStale(now: number): Promise<OutboxEntry[]> {
  const db = await openOutbox();
  const t = tx(db, "readwrite", STORE_ENTRIES, STORE_HISTORY);
  const store = t.objectStore(STORE_ENTRIES);
  const history = t.objectStore(STORE_HISTORY);
  const all = await idbDone(store.getAll() as IDBRequest<OutboxEntry[]>);
  const valid = all.filter(entryRecord);
  let changed = false;
  for (const entry of valid) {
    if (
      (entry.state === "pending" || entry.state === "retry") &&
      now - entry.created_at > OUTBOX_MAX_AGE_MS
    ) {
      store.put({
        ...entry,
        state: "expired",
        state_at: now,
        lease_owner: null,
        lease_expires_at: null,
      });
      history.put({
        id: `${entry.id}:expired`,
        kind: entry.kind,
        path: entry.path,
        body: entry.body,
        created_at: entry.created_at,
        ended_at: now,
        outcome: "expired",
        attempts: entry.attempts,
        last_error: entry.last_error,
      });
      changed = true;
    }
  }
  await txDone(t);
  if (changed) emit();
  return valid;
}

function txDone(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error("Outbox-Transaktion fehlgeschlagen"));
    t.onabort = () => reject(t.error ?? new Error("Outbox-Transaktion abgebrochen"));
  });
}

/**
 * Eintrag vormerken. `queue_full`: der offene Puffer ist voll — ehrlich
 * abgelehnt, nichts wird über die Obergrenze geschoben. `storage_failed`:
 * IndexedDB hat nicht angenommen (Quota, privater Modus, kaputte DB).
 */
export async function enqueueWrite(
  entry: { kind: OutboxKind; path: string; body: string },
  now: number = Date.now(),
): Promise<EnqueueResult> {
  try {
    const db = await openOutbox();
    const expired = await expireStale(now);
    const open = expired.filter((item) => OPEN_STATES.includes(item.state)).length;
    if (open >= OUTBOX_MAX_ENTRIES) {
      return { ok: false, error: "queue_full" };
    }
    const record: OutboxEntry = {
      id: newId(now),
      kind: entry.kind,
      path: entry.path,
      body: entry.body,
      created_at: now,
      state: "pending",
      state_at: now,
      attempts: 0,
      next_attempt_at: 0,
      lease_owner: null,
      lease_expires_at: null,
      last_error: null,
    };
    const t = tx(db, "readwrite", STORE_ENTRIES);
    t.objectStore(STORE_ENTRIES).put(record);
    await txDone(t);
    emit();
    return { ok: true, entry: record, open: open + 1 };
  } catch {
    return { ok: false, error: "storage_failed" };
  }
}

/** Alle Einträge (offene + sichtbare Endzustände), nach Eingangsreihenfolge. */
export async function listEntries(now: number = Date.now()): Promise<OutboxEntry[]> {
  try {
    const valid = await expireStale(now);
    return sortEntries(valid);
  } catch {
    return [];
  }
}

export async function listHistory(): Promise<OutboxHistoryItem[]> {
  try {
    const db = await openOutbox();
    const t = tx(db, "readonly", STORE_HISTORY);
    const all = await idbDone(
      t.objectStore(STORE_HISTORY).getAll() as IDBRequest<OutboxHistoryItem[]>,
    );
    await txDone(t);
    return [...all].sort((a, b) => a.ended_at - b.ended_at);
  } catch {
    return [];
  }
}

/**
 * Nächsten fälligen Eintrag beanspruchen (Lease auf dieses Tab). Ein Tab
 * überspringt Einträge mit gültiger fremder Lease; abgelaufene Leases
 * erobert es zurück. `null`: nichts Fälliges.
 */
export async function claimNext(
  now: number = Date.now(),
  owner: string = tabId(),
): Promise<OutboxEntry | null> {
  const db = await openOutbox();
  const t = tx(db, "readwrite", STORE_ENTRIES);
  const store = t.objectStore(STORE_ENTRIES);
  const all = (await idbDone(store.getAll() as IDBRequest<OutboxEntry[]>)).filter(entryRecord);
  const candidate = sortEntries(all).find((entry) => isClaimable(entry, now, owner));
  if (!candidate) {
    await txDone(t);
    return null;
  }
  const claimed: OutboxEntry = {
    ...candidate,
    state: "sending",
    state_at: now,
    lease_owner: owner,
    lease_expires_at: now + OUTBOX_LEASE_MS,
  };
  store.put(claimed);
  await txDone(t);
  emit();
  return claimed;
}

/**
 * Quittieren: aus `entries` weg, in `history` nachweisbar. `rejected` und
 * `expired` bleiben in `entries` (sichtbar, exportierbar, entfernbar) —
 * sie landen zusätzlich in der Historie, damit der Nachweis komplett ist.
 */
/**
 * `cleared` ist kein Eintrags-Zustand (er existiert nur in der Historie) —
 * die Entfernt-Aktion läuft über `clearTerminal`.
 */
export async function recordOutcome(
  id: string,
  outcome: Exclude<OutboxOutcome, "cleared">,
  lastError: string | null,
  now: number = Date.now(),
): Promise<void> {
  const db = await openOutbox();
  const t = tx(db, "readwrite", STORE_ENTRIES, STORE_HISTORY);
  const entries = t.objectStore(STORE_ENTRIES);
  const history = t.objectStore(STORE_HISTORY);
  const existing = (await idbDone(entries.get(id) as IDBRequest<OutboxEntry | undefined>)) ?? null;
  if (existing) {
    if (outcome === "sent") {
      entries.delete(id);
    } else {
      const updated: OutboxEntry = {
        ...existing,
        state: outcome,
        state_at: now,
        lease_owner: null,
        lease_expires_at: null,
        last_error: lastError,
      };
      entries.put(updated);
    }
    const record: OutboxHistoryItem = {
      id: `${id}:${outcome}`,
      kind: existing.kind,
      path: existing.path,
      body: existing.body,
      created_at: existing.created_at,
      ended_at: now,
      outcome,
      attempts: existing.attempts,
      last_error: lastError,
    };
    history.put(record);
  }
  await txDone(t);
  emit();
}

/** Wiederholung: Versuche hochzählen, Backoff setzen, Lease lösen. */
export async function markRetry(
  id: string,
  error: string | null,
  now: number = Date.now(),
  retryAfterSeconds?: number | null,
): Promise<void> {
  const db = await openOutbox();
  const t = tx(db, "readwrite", STORE_ENTRIES);
  const store = t.objectStore(STORE_ENTRIES);
  const existing = await idbDone(store.get(id) as IDBRequest<OutboxEntry | undefined>);
  if (!existing) return;
  const attempts = existing.attempts + 1;
  let waitMs: number;
  if (retryAfterSeconds != null && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    waitMs = Math.min(retryAfterSeconds * 1000, OUTBOX_MAX_AGE_MS);
  } else {
    waitMs = Math.min(
      OUTBOX_BACKOFF_BASE_MS * 2 ** (attempts - 1),
      OUTBOX_BACKOFF_CAP_MS,
    );
  }
  const updated: OutboxEntry = {
    ...existing,
    state: "retry",
    state_at: now,
    attempts,
    next_attempt_at: now + waitMs,
    lease_owner: null,
    lease_expires_at: null,
    last_error: error,
  };
  store.put(updated);
  await txDone(t);
  emit();
}

/**
 * Nachreich-Versuch für die offenen Einträge, in Reihenfolge des Eingangs.
 *
 * `send` kommt von außen (in der App: `postQueued`), damit die Buchführung
 * ohne Netz prüfbar bleibt. Jeder Übergang ist eine eigene Transaktion —
 * einparalleles `enqueueWrite` überlebt den Lauf. Stopp-Regeln: permanente
 * Ablehnung (4xx) endet den Eintrag, der nächste darf weiter; Rate-Limit
 * (429) und Transportfehler (niemand da) stoppen den Lauf — die anderen
 * Einträge würden denselben Treffer nehmen, und der nächste Tick kommt.
 */
export interface FlushResult {
  sent: number;
  failed: number;
  rejected: OutboxEntry[];
}

export async function flushQueue(
  send: (entry: OutboxEntry) => Promise<OutboxSendResult>,
  now: number = Date.now(),
): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, failed: 0, rejected: [] };
  // Zu alte offene Einträge enden jetzt als `expired` — sichtbar, nicht
  // still, und sie blockieren nicht mehr den Rest.
  try {
    await expireStale(now);
  } catch {
    /* Speicher nicht verfügbar — claim unten scheitert dann ehrlich. */
  }
  let guard = 0;
  for (;;) {
    if (++guard > OUTBOX_MAX_ENTRIES + 10) break;
    let entry: OutboxEntry | null;
    try {
      entry = await claimNext(now);
    } catch {
      break;
    }
    if (!entry) break;
    let sendResult: OutboxSendResult;
    try {
      sendResult = await send(entry);
    } catch {
      sendResult = { ok: false, error: "send_failed" };
    }
    if (sendResult.ok) {
      await recordOutcome(entry.id, "sent", null, now);
      result.sent += 1;
    } else if (sendResult.permanent) {
      await recordOutcome(entry.id, "rejected", sendResult.error ?? "http_error", now);
      result.rejected.push(entry);
    } else {
      result.failed += 1;
      await markRetry(
        entry.id,
        sendResult.error ?? "error",
        now,
        sendResult.retryAfterSeconds ?? null,
      );
      // Rate-Limit betrifft den Client, Transportfehler den ganzen Weg —
      // der nächste Eintrag würde denselben Fehler liefern.
      if (sendResult.error === "rate_limited" || sendResult.error === "offline") break;
      if (sendResult.error === "http_5xx") break;
    }
  }
  return result;
}

/** Sichtbare Endzustände entfernen (Nutzeraktion) — in die Historie gehen. */
export async function clearTerminal(now: number = Date.now()): Promise<number> {
  const db = await openOutbox();
  const t = tx(db, "readwrite", STORE_ENTRIES, STORE_HISTORY);
  const entries = t.objectStore(STORE_ENTRIES);
  const history = t.objectStore(STORE_HISTORY);
  const all = (await idbDone(entries.getAll() as IDBRequest<OutboxEntry[]>)).filter(entryRecord);
  let count = 0;
  for (const entry of all) {
    if (!TERMINAL_STATES.includes(entry.state)) continue;
    entries.delete(entry.id);
    history.put({
      id: `${entry.id}:cleared`,
      kind: entry.kind,
      path: entry.path,
      body: entry.body,
      created_at: entry.created_at,
      ended_at: now,
      outcome: "cleared",
      attempts: entry.attempts,
      last_error: entry.last_error,
    });
    count += 1;
  }
  await txDone(t);
  if (count > 0) emit();
  return count;
}

/** Export: alle Einträge + Historie — der komplette Nachweis. */
export interface OutboxExport {
  app: "tankapp";
  artifact: "outbox";
  generated_at: string;
  entries: OutboxEntry[];
  history: OutboxHistoryItem[];
}

export async function exportSnapshot(now: number = Date.now()): Promise<OutboxExport> {
  const [entries, history] = await Promise.all([listEntries(now), listHistory()]);
  return {
    app: "tankapp",
    artifact: "outbox",
    generated_at: new Date(now).toISOString(),
    entries,
    history,
  };
}

function csvCell(value: string | number | null): string {
  const text = value == null ? "" : String(value);
  if (/[",\n;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** CSV-Zeilen (Kopf + Zeilen) — dieselbe Wahrheit wie der JSON-Export,
 *  inkl. Body (was der Server bekommen hätte). */
export function exportCsv(snapshot: OutboxExport): string {
  const head =
    "artifact,id,kind,path,state_or_outcome,created_at,ended_at,attempts,last_error,body";
  const iso = (ts: number | null | undefined) =>
    ts == null ? "" : new Date(ts).toISOString();
  const lines: string[] = [head];
  for (const entry of snapshot.entries) {
    lines.push(
      [
        "entry",
        entry.id,
        entry.kind,
        entry.path,
        entry.state,
        iso(entry.created_at),
        "",
        entry.attempts,
        entry.last_error,
        entry.body,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  for (const item of snapshot.history) {
    lines.push(
      [
        "history",
        item.id,
        item.kind,
        item.path,
        item.outcome,
        iso(item.created_at),
        iso(item.ended_at),
        item.attempts,
        item.last_error,
        item.body,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Benachrichtigung zwischen Tabs (feature-detected) und innerhalb des Tabs.
// ---------------------------------------------------------------------------

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    channel = new BroadcastChannel(OUTBOX_CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { tab?: string } | null;
      if (data && data.tab === tabId()) return;
      emit();
    };
  } catch {
    channel = null;
  }
  return channel;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      /* Ein defekter Listener darf die Buchhaltung nicht sprengen. */
    }
  }
  try {
    getChannel()?.postMessage({ tab: tabId() });
  } catch {
    /* Channel geschlossen (Tab-Ende) — die eigene DB ist die Wahrheit. */
  }
}

/** Änderungen abonnieren (eigene + fremde Tabs). Rückgabe: Abmelden. */
export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  getChannel();
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Zähler für die Statuszeile: offene Einträge und das Alter des ältesten.
 * `terminal`: sichtbar abgeschlossene Einträge (abgelehnt/abgelaufen) —
 * sie sind weg aus dem Puffer, aber noch sichtbar (System → Diagnose).
 */
export function outboxSummary(
  entries: OutboxEntry[],
  now: number = Date.now(),
): { open: number; terminal: number; oldestOpenMs: number | null } {
  const openEntries = entries.filter((entry) => OPEN_STATES.includes(entry.state));
  const terminal = entries.filter((entry) =>
    TERMINAL_STATES.includes(entry.state),
  ).length;
  if (openEntries.length === 0) return { open: 0, terminal, oldestOpenMs: null };
  return {
    open: openEntries.length,
    terminal,
    oldestOpenMs: now - Math.min(...openEntries.map((entry) => entry.created_at)),
  };
}
