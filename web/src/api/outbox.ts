import { api } from "./client";

export interface OutboxEntry {
  id: string;
  kind: "fill";
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

const DB_NAME = "tankapp-outbox-v2";
const STORE_NAME = "entries";
let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB ist nicht verfügbar"));
  if (database) return database;
  const pending: Promise<IDBDatabase> = new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(DB_NAME, 1);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error("Outbox konnte nicht geöffnet werden"));
    opening.onblocked = () => reject(new Error("Outbox-Datenbank ist blockiert"));
  });
  const cached = pending.catch((error: unknown) => { database = null; throw error; });
  database = cached;
  return cached;
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = run(tx.objectStore(STORE_NAME));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error ?? new Error("Outbox-Datenbankfehler"));
    tx.oncomplete = () => resolve(result!);
    tx.onerror = () => reject(tx.error ?? new Error("Outbox-Datenbankfehler"));
    tx.onabort = () => reject(tx.error ?? new Error("Outbox-Transaktion abgebrochen"));
  });
}

export async function enqueueFill(payload: Record<string, unknown>): Promise<OutboxEntry> {
  const entry: OutboxEntry = { id: crypto.randomUUID(), kind: "fill", payload, createdAt: new Date().toISOString(), attempts: 0 };
  await transaction("readwrite", (store) => store.add(entry));
  return entry;
}

export async function listOutbox(): Promise<OutboxEntry[]> {
  return transaction("readonly", (store) => store.getAll());
}

export async function removeOutboxEntry(id: string): Promise<void> {
  await transaction("readwrite", (store) => store.delete(id));
}

export async function clearOutbox(): Promise<void> {
  await transaction("readwrite", (store) => store.clear());
}

export interface SyncResult { sent: number; remaining: number; failed: number }

/** Sends queued receipts in order; the server's idempotency key keeps retries safe. */
export async function syncOutbox(): Promise<SyncResult> {
  const entries = (await listOutbox()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let sent = 0;
  let failed = 0;
  for (const entry of entries) {
    try {
      await api.post("fills", { ...entry.payload, id: entry.payload.id ?? entry.id });
      await removeOutboxEntry(entry.id);
      sent += 1;
    } catch (error) {
      failed += 1;
      const updated = { ...entry, attempts: entry.attempts + 1, lastError: error instanceof Error ? error.message : "Sync fehlgeschlagen" };
      await transaction("readwrite", (store) => store.put(updated));
      break;
    }
  }
  return { sent, remaining: (await listOutbox()).length, failed };
}
