// @vitest-environment happy-dom
// B10: Die Offline-Queue für Belege/Vorsätze (§5.4) — Entscheidungen ohne
// Netz, Speicherverhalten und die Anbindung an die Schreibfunktionen.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueWrite,
  flushQueue,
  isTransportError,
  QUEUE_KEY,
  QUEUE_MAX_ENTRIES,
  queueAdd,
  queueOldestAgeMs,
  queuePrune,
  queueStatusText,
  readQueue,
  writeQueue,
  type QueuedWrite,
} from "./offline-queue";

const NOW = Date.parse("2026-09-15T08:00:00+02:00");

function entry(overrides: Partial<QueuedWrite> = {}): QueuedWrite {
  return {
    id: "q_1",
    kind: "fill",
    path: "/api/v1/fills",
    body: JSON.stringify({ liters: 40 }),
    created_at: NOW,
    attempts: 0,
    last_error: null,
    ...overrides,
  };
}

describe("Offline-Queue: Entschieden", () => {
  it("reicht nur Verbindungsprobleme nach", () => {
    expect(isTransportError(503)).toBe(true);
    expect(isTransportError(502)).toBe(true);
    expect(isTransportError(504)).toBe(true);
    expect(isTransportError(400)).toBe(false);
    expect(isTransportError(422)).toBe(false);
    expect(isTransportError(500)).toBe(false);
    expect(isTransportError(undefined)).toBe(true);
  });

  it("merkt vor und deckelt — was nicht passt, wird ehrlich abgelehnt", () => {
    let list: QueuedWrite[] = [];
    for (let i = 0; i < QUEUE_MAX_ENTRIES; i += 1) {
      const result = queueAdd(list, { kind: "fill", path: "/x", body: "{}" }, NOW);
      expect(result.accepted).toBe(true);
      list = result.list;
    }
    const over = queueAdd(list, { kind: "fill", path: "/x", body: "{}" }, NOW);
    expect(over.accepted).toBe(false);
    expect(over.list).toHaveLength(QUEUE_MAX_ENTRIES);
  });

  it("sortiert Abgelaufenes aus, statt es stillschweigend zu verschweigen", () => {
    const old = entry({ id: "q_old", created_at: NOW - 8 * 24 * 60 * 60 * 1000 });
    const fresh = entry({ id: "q_fresh" });
    const { list, expired } = queuePrune([old, fresh], NOW);
    expect(list.map((e) => e.id)).toEqual(["q_fresh"]);
    expect(expired.map((e) => e.id)).toEqual(["q_old"]);
  });

  it("spricht in Nutzersprache: eine Warteschlange ist kein Fehler", () => {
    expect(queueStatusText(0)).toBeNull();
    expect(queueStatusText(1)?.text).toContain("Ein Eintrag ist");
    expect(queueStatusText(3)?.text).toContain("3 Einträge sind");
    expect(queueStatusText(3)?.note).toContain("Nichts ist verloren");
    const aged = queueStatusText(1, 2.5 * 60 * 60 * 1000);
    expect(aged?.note).toContain("2 h");
    expect(queueOldestAgeMs([entry({ created_at: NOW - 3600_000 })], NOW)).toBe(3600_000);
    expect(queueOldestAgeMs([], NOW)).toBeNull();
  });
});

describe("Offline-Queue: Speicher und Nachreichen", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("überlebt einen Reload und wirft Müll weg", () => {
    writeQueue([entry()]);
    expect(readQueue()).toHaveLength(1);
    localStorage.setItem(QUEUE_KEY, "{kaputt");
    expect(readQueue()).toEqual([]);
    localStorage.setItem(QUEUE_KEY, JSON.stringify([{ nope: true }]));
    expect(readQueue()).toEqual([]);
  });

  it("reicht in Eingangsreihenfolge nach und vergisst Erfolgreiches", async () => {
    enqueueWrite({ kind: "fill", path: "/api/v1/fills", body: "{}" });
    enqueueWrite({ kind: "intent", path: "/api/v1/episodes/e1/intent", body: "{}" });
    const seen: string[] = [];
    const result = await flushQueue(async (e) => {
      seen.push(e.kind);
      return { ok: true };
    }, localStorage, NOW);
    expect(seen).toEqual(["fill", "intent"]);
    expect(result.sent).toBe(2);
    expect(result.list).toEqual([]);
    expect(readQueue()).toEqual([]);
  });

  it("behält Verbindungsfehler mit Versuchszähler vor", async () => {
    enqueueWrite({ kind: "fill", path: "/api/v1/fills", body: "{}" });
    const result = await flushQueue(
      async () => ({ ok: false, error: "offline" }),
      localStorage,
      NOW,
    );
    expect(result.failed).toBe(1);
    expect(result.list[0].attempts).toBe(1);
    expect(result.list[0].last_error).toBe("offline");
    expect(readQueue()[0].attempts).toBe(1);
  });

  it("wirft endgültig Abgelehntes aus der Queue und meldet es zurück", async () => {
    enqueueWrite({ kind: "fill", path: "/api/v1/fills", body: "{}" });
    const result = await flushQueue(
      async () => ({ ok: false, permanent: true, error: "http_400" }),
      localStorage,
      NOW,
    );
    expect(result.rejected).toHaveLength(1);
    expect(result.list).toEqual([]);
    expect(readQueue()).toEqual([]);
  });
});

describe("Offline-Queue: an den Schreibfunktionen (B10)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("postFill merkt einen Beleg ohne Verbindung vor — mit id und Tankzeit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const { postFill } = await import("./data");
    const res = await postFill({
      station_id: "s1",
      station_name: "Demo-Tank Nord",
      liters: 40,
      price_paid: 1.725,
      fuel: "e10",
      source: "manual",
    });
    expect(res.queued).toBe(true);
    const stored = readQueue();
    expect(stored).toHaveLength(1);
    const body = JSON.parse(stored[0].body);
    expect(body.id).toMatch(/^fill_/);
    expect(body.tanked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(stored[0].kind).toBe("fill");
  });

  it("postFill merkt einen NAS-Ausfall (503) vor, aber keinen Nutzerfehler (400)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error_code: "unavailable" }), { status: 503 }),
      ),
    );
    const { postFill } = await import("./data");
    await postFill({
      station_id: "s1",
      station_name: "X",
      liters: 40,
      price_paid: 1.7,
      fuel: "e10",
      source: "manual",
    });
    expect(readQueue()).toHaveLength(1);

    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error_code: "invalid_liters" }), { status: 400 }),
      ),
    );
    const res = await postFill({
      station_id: "s1",
      station_name: "X",
      liters: 900,
      price_paid: 1.7,
      fuel: "e10",
      source: "manual",
    });
    expect(res.error_code).toBe("invalid_liters");
    expect(readQueue()).toEqual([]);
  });

  it("postIntent merkt einen Vorsatz vor und nutzt den Episodenpfad", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const { postIntent } = await import("./data");
    const res = await postIntent("ep-7", "accept");
    expect(res.queued).toBe(true);
    const stored = readQueue();
    expect(stored[0].path).toBe("/api/v1/episodes/ep-7/intent");
    expect(JSON.parse(stored[0].body)).toEqual({ intent: "accept" });
  });
});
