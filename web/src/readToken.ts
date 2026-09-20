// O39 — Lese-Token für den persönlichen Datenbestand.
//
// Der Server bindet 0.0.0.0: Ohne Secret kann jeder Rechner im LAN die
// eigenen Belege lesen (docs/betrieb/BETRIEB.md#zugriff-im-lan-was-lesbar-ist-o39-seit-0500).
// Wer `TANKAPP_READ_TOKEN` setzt, bekommt die persönlichen Routen nur noch
// mit `Authorization: Bearer <Secret>`; die GUI braucht dasselbe Secret.
//
// Bewusst **kein** Login: ein Shared Secret, gerätelokal im localStorage
// (wie jede andere Einstellung), nie in einer URL — also auch nicht in
// Server- oder Proxy-Logs. Ohne Token bleibt alles beim Alten; die
// persönlichen Bereiche zeigen dann „Zugang gesperrt …“, wenn der Server
// eines verlangt.

const STORAGE_KEY = "tankapp.readToken";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readStored(): string {
  try {
    return storage()?.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

let token = readStored();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of [...listeners]) listener();
}

/** Aktuelles Secret ("" = keins gesetzt). */
export function readToken(): string {
  return token;
}

/**
 * Secret setzen oder löschen (leer/null = löschen). Gibt `true` zurück, wenn
 * sich etwas geändert hat — die Ansicht lädt danach neu.
 */
export function setReadToken(next: string | null | undefined): boolean {
  const value = (next ?? "").trim();
  if (value === token) return false;
  token = value;
  try {
    if (value) storage()?.setItem(STORAGE_KEY, value);
    else storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* Storage disabled (privater Modus): das Secret gilt für diese Sitzung. */
  }
  notify();
  return true;
}

/** `Authorization`-Header, wenn ein Secret gesetzt ist — sonst leer. */
export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Änderung abonnieren — `useResource` lädt nach einem neuen Secret neu. */
export function onReadTokenChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
