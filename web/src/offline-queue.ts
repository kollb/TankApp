// B10: Offline-Queue für Belege und Vorsätze (Konzept §5.4).
//
// An der Säule reißt das Netz ab, das NAS startet neu, die Pi-GUI steht ohne
// Rückweg da: Bisher sagte die App nur „Speichern fehlgeschlagen – bitte erneut
// versuchen“ und der Nutzer stand mit nassen Händen da. Jetzt wird der Schreib-
// vorgang vorgemerkt und beim nächsten Kontakt nachgereicht — mit sichtbarem
// Zustand („wird gesendet, sobald die Verbindung steht“), nicht still.
//
// Ablage: localStorage statt IndexedDB. Belege und Vorsätze sind winzige
// JSON-Objekte ohne Binärdaten; IndexedDB brächte nur asynchrone Komplexität
// (und wäre in Tests/Tailwind-Umgebungen schlechter prüfbar). Die Größe ist
// gedeckelt — was nicht passt, wird ehrlich abgelehnt statt verworfen.
//
// Nur Belege und Vorsätze landen hier. Profile, Storno und Jobstart bleiben
// sofort-schreibend: Sie sind Entscheidungen, keine Datenerfassung im Funkloch.

import { ageWord } from "./data";

export const QUEUE_KEY = "tankapp.offline.queue.v1";
/** Mehr als das ist kein Funkloch mehr — dann lieber ehrlich ablehnen. */
export const QUEUE_MAX_ENTRIES = 50;
/** Älteres als eine Woche wird nicht mehr nachgereicht (Datenstand unklar). */
export const QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type QueuedKind = "fill" | "intent";

export interface QueuedWrite {
  /** Stabile ID — verhindert Doppelabschicken desselben Eintrags. */
  id: string;
  kind: QueuedKind;
  /** Ziel relativ zur App, z. B. "/api/v1/fills". */
  path: string;
  /** Der fertige JSON-Body (unverändert, wie ihn der Server erwartet). */
  body: string;
  created_at: number;
  attempts: number;
  last_error: string | null;
}

/**
 * Ist der Fehler ein Verbindungsproblem (nachreichen) oder eine Ablehnung?
 *
 * Nur „niemand da“ wird nachgereicht: Der Server (oder der Pi, der an den NAS
 * weiterleitet) meldet 502/503/504, oder die Anfrage kommt gar nicht an. Ein
 * 500 ist ein Programmfehler — der gehört gemeldet, nicht wiederholt; ein 4xx
 * ist eine Entscheidung (ungültige Liter, fremde Station) und bleibt eine.
 */
export function isTransportError(status?: number): boolean {
  if (typeof status === "number" && status > 0) {
    return status === 502 || status === 503 || status === 504;
  }
  return true;
}

export function queueLabel(count: number): string {
  if (count <= 0) return "Keine offenen Einträge.";
  if (count === 1) return "Ein Eintrag liegt lokal.";
  return `${count} Einträge liegen lokal.`;
}

/** Statuszeile in Nutzersprache — ehrlich, ohne Schuld oder Befehl (MICROCOPY §5). */
export function queueStatusText(
  count: number,
  oldestAgeMs: number | null = null,
): { tone: "warn"; text: string; note: string } | null {
  if (count <= 0) return null;
  const which =
    count === 1 ? "Ein Eintrag ist" : `${count} Einträge sind`;
  const age =
    oldestAgeMs != null && oldestAgeMs >= 60 * 60 * 1000
      ? ` Der älteste wartet seit ${ageWord(Math.floor(oldestAgeMs / 60000))}.`
      : "";
  return {
    tone: "warn",
    text: `${which} lokal vorgemerkt und gehen raus, sobald die Verbindung steht.`,
    note: `Nichts ist verloren; die Liste steht im Rechner.${age}`,
  };
}

function newId(now: number): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `q_${now.toString(36)}_${random}`;
}

/** Erster Schritt: Eintrag vormerken (rein, ohne Storage). */
export function queueAdd(
  list: QueuedWrite[],
  entry: { kind: QueuedKind; path: string; body: string },
  now: number,
): { list: QueuedWrite[]; accepted: boolean } {
  if (list.length >= QUEUE_MAX_ENTRIES) return { list, accepted: false };
  const next: QueuedWrite[] = [
    ...list,
    {
      id: newId(now),
      kind: entry.kind,
      path: entry.path,
      body: entry.body,
      created_at: now,
      attempts: 0,
      last_error: null,
    },
  ];
  return { list: next, accepted: true };
}

export function queueDrop(list: QueuedWrite[], id: string): QueuedWrite[] {
  return list.filter((entry) => entry.id !== id);
}

/** Abgelaufene Einträge aussortieren — Altersgrenze, nicht Ausblenden. */
export function queuePrune(
  list: QueuedWrite[],
  now: number,
): { list: QueuedWrite[]; expired: QueuedWrite[] } {
  const fresh = list.filter((entry) => now - entry.created_at <= QUEUE_MAX_AGE_MS);
  return { list: fresh, expired: list.filter((e) => !fresh.includes(e)) };
}

export function queueOldestAgeMs(list: QueuedWrite[], now: number): number | null {
  if (list.length === 0) return null;
  return now - Math.min(...list.map((entry) => entry.created_at));
}

/** Speicher — ohne localStorage (privater Modus) bleibt es bei einer Liste im Speicher. */
export function readQueue(storage: Storage | null = safeStorage()): QueuedWrite[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isQueuedWrite);
  } catch {
    return [];
  }
}

export function writeQueue(
  list: QueuedWrite[],
  storage: Storage | null = safeStorage(),
): void {
  if (!storage) return;
  try {
    if (list.length === 0) storage.removeItem(QUEUE_KEY);
    else storage.setItem(QUEUE_KEY, JSON.stringify(list));
  } catch {
    /* Speicher voll oder gesperrt: die Anzeige bleibt dann leer und ehrlich. */
  }
}

function isQueuedWrite(value: unknown): value is QueuedWrite {
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

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Kurzform für die Aufrufer in `data.ts`: vormerken und die neue Liste zurückgeben. */
export function enqueueWrite(entry: {
  kind: QueuedKind;
  path: string;
  body: string;
}): QueuedWrite[] {
  const now = Date.now();
  const stored = readQueue();
  const { list } = queueAdd(stored, entry, now);
  writeQueue(list);
  return list;
}

export interface FlushResult {
  sent: number;
  failed: number;
  /** Vom Server endgültig abgelehnt (4xx) — nicht wiederholen, sondern sagen. */
  rejected: QueuedWrite[];
  list: QueuedWrite[];
}

/**
 * Nachreich-Versuch für alle Einträge, in Reihenfolge des Eingangs.
 *
 * `send` kommt von außen (in der App: `postQueued`), damit die Reihenfolge
 * und die Buchführung ohne Netz prüfbar bleiben. Ein Fehler stoppt den Lauf
 * nicht: Der nächste Eintrag kann einen anderen Serverpfad treffen, und der
 * nächste Versuch kommt ohnehin.
 */
export async function flushQueue(
  send: (
    entry: QueuedWrite,
  ) => Promise<{ ok: boolean; permanent?: boolean; error?: string | null }>,
  storage: Storage | null = safeStorage(),
  now: number = Date.now(),
): Promise<FlushResult> {
  let list = readQueue(storage);
  const pruned = queuePrune(list, now);
  list = pruned.list;
  let sent = 0;
  let failed = 0;
  const rejected: QueuedWrite[] = [];
  for (const entry of [...list]) {
    const result = await send(entry);
    if (result.ok) {
      sent += 1;
      list = queueDrop(list, entry.id);
    } else if (result.permanent) {
      rejected.push(entry);
      list = queueDrop(list, entry.id);
    } else {
      failed += 1;
      list = list.map((item) =>
        item.id === entry.id
          ? { ...item, attempts: item.attempts + 1, last_error: result.error ?? null }
          : item,
      );
    }
  }
  writeQueue(list, storage);
  return { sent, failed, rejected, list };
}
