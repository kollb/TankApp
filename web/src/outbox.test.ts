// I1: Outbox (IndexedDB) — Abnahme als Tests.
//
// Parallel-A send + B-enqueue verliert nichts; mehrere Tabs doppelten nicht
// (Lease); 429 bleibt wiederholbar (Retry-After); jeder Eintrag hat einen
// sichtbaren Endzustand (quittiert, abgelehnt, abgelaufen, entfernt) —
// nichts wird still verworfen.

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  OUTBOX_BACKOFF_BASE_MS,
  OUTBOX_LEASE_MS,
  OUTBOX_MAX_AGE_MS,
  OUTBOX_MAX_ENTRIES,
  clearTerminal,
  claimNext,
  enqueueWrite,
  exportCsv,
  exportSnapshot,
  flushQueue,
  isTransportError,
  listEntries,
  listHistory,
  resetOutboxForTests,
} from "./outbox";

const NOW = Date.parse("2026-09-18T10:00:00Z");
const MIN = 60_000;

beforeEach(async () => {
  await resetOutboxForTests();
});

describe("Einfacher Durchlauf", () => {
  it("vormerken, nachreichen, quittieren — mit Nachweis in der Historie", async () => {
    const result = await enqueueWrite(
      { kind: "fill", path: "/api/v1/fills", body: '{"id":"fill_1"}' },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.state).toBe("pending");

    const entries = await listEntries(NOW);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(result.entry.id);

    const flush = await flushQueue(async () => ({ ok: true }), NOW + MIN);
    expect(flush.sent).toBe(1);
    expect(await listEntries(NOW + MIN)).toHaveLength(0);

    const history = await listHistory();
    expect(history).toHaveLength(1);
    expect(history[0].outcome).toBe("sent");
    expect(history[0].id).toBe(`${result.entry.id}:sent`);
    expect(history[0].body).toBe('{"id":"fill_1"}');
  });

  it("Transportfehler: Backoff, dann nächster Versuch", async () => {
    const result = await enqueueWrite(
      { kind: "fill", path: "/api/v1/fills", body: "{}" },
      NOW,
    );
    if (!result.ok) throw new Error("enqueue fehlgeschlagen");

    let calls = 0;
    const first = await flushQueue(
      async () => {
        calls += 1;
        return { ok: false, error: "offline" };
      },
      NOW + MIN,
    );
    expect(first.failed).toBe(1);
    expect(calls).toBe(1);

    const entries = await listEntries(NOW + MIN);
    expect(entries[0].state).toBe("retry");
    expect(entries[0].attempts).toBe(1);
    expect(entries[0].next_attempt_at).toBe(NOW + MIN + OUTBOX_BACKOFF_BASE_MS);

    // Vor dem Backoff-Ende ist der Eintrag nicht dran.
    expect(await claimNext(NOW + MIN + OUTBOX_BACKOFF_BASE_MS - 1)).toBeNull();

    // Fällig: dieser Mal kommt er an.
    const second = await flushQueue(
      async () => ({ ok: true }),
      NOW + MIN + OUTBOX_BACKOFF_BASE_MS,
    );
    expect(second.sent).toBe(1);
    expect(await listEntries(NOW + MIN + OUTBOX_BACKOFF_BASE_MS)).toHaveLength(0);
  });
});

describe("429 bleibt wiederholbar", () => {
  it("Retry-After des Servers schlägt das eigene Backoff", async () => {
    await enqueueWrite({ kind: "fill", path: "/api/v1/fills", body: "{}" }, NOW);

    let calls = 0;
    const flush = await flushQueue(
      async () => {
        calls += 1;
        return { ok: false, error: "rate_limited", retryAfterSeconds: 60 };
      },
      NOW + MIN,
    );
    // Rate-Limit betrifft den Client — der Lauf stoppt nach dem ersten
    // Treffer, statt die Warteschlange durchzubrennen.
    expect(calls).toBe(1);
    expect(flush.failed).toBe(1);

    const entries = await listEntries(NOW + MIN);
    expect(entries[0].state).toBe("retry");
    expect(entries[0].next_attempt_at).toBe(NOW + MIN + 60_000);
  });

  it("Transport-Klassifikation: 429/502/503/504/0 sind Verbindungsprobleme", () => {
    for (const status of [429, 502, 503, 504, 0, undefined]) {
      expect(isTransportError(status)).toBe(true);
    }
    for (const status of [400, 404, 422, 500]) {
      expect(isTransportError(status)).toBe(false);
    }
  });
});

describe("Endzustände sind sichtbar", () => {
  it("4xx (ohne 429) ist eine Entscheidung — abgelehnt, sichtbar, weiter geht's", async () => {
    const a = await enqueueWrite({ kind: "fill", path: "/api/v1/fills", body: "{}" }, NOW);
    const b = await enqueueWrite({ kind: "intent", path: "/api/v1/episodes/e/intent", body: "{}" }, NOW + 1);
    if (!a.ok || !b.ok) throw new Error("enqueue fehlgeschlagen");

    const seen: string[] = [];
    const flush = await flushQueue(
      async (entry) => {
        seen.push(entry.id);
        if (entry.id === a.entry.id) {
          return { ok: false, permanent: true, error: "http_400" };
        }
        return { ok: true };
      },
      NOW + MIN,
    );
    expect(flush.rejected).toHaveLength(1);
    expect(flush.rejected[0].id).toBe(a.entry.id);
    expect(flush.sent).toBe(1);

    // Der abgelehnte Eintrag bleibt stehen (nicht still verworfen), der
    // zweite ging raus.
    const entries = await listEntries(NOW + MIN);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(a.entry.id);
    expect(entries[0].state).toBe("rejected");
    expect(entries[0].last_error).toBe("http_400");

    const outcomes = (await listHistory()).map((item) => item.id).sort();
    expect(outcomes).toEqual([`${a.entry.id}:rejected`, `${b.entry.id}:sent`].sort());
  });

  it("älter als eine Woche: abgelaufen — sichtbar statt still", async () => {
    await enqueueWrite({ kind: "fill", path: "/api/v1/fills", body: "{}" }, NOW);
    const late = NOW + OUTBOX_MAX_AGE_MS + MIN;
    await flushQueue(async () => ({ ok: true }), late);

    const entries = await listEntries(late);
    expect(entries).toHaveLength(1);
    expect(entries[0].state).toBe("expired");
    const history = await listHistory();
    expect(history[0].outcome).toBe("expired");
  });

  it("Nutzer-Entfernung: ab nachweisbar in die Historie (cleared)", async () => {
    const a = await enqueueWrite({ kind: "fill", path: "/api/v1/fills", body: "{}" }, NOW);
    if (!a.ok) throw new Error("enqueue fehlgeschlagen");
    await flushQueue(
      async () => ({ ok: false, permanent: true, error: "http_400" }),
      NOW + MIN,
    );
    const removed = await clearTerminal(NOW + 2 * MIN);
    expect(removed).toBe(1);
    expect(await listEntries(NOW + 2 * MIN)).toHaveLength(0);
    // Zwei Nachweise: die Ablehnung und die Entfernung — beide zitierbar.
    const history = await listHistory();
    expect(history.map((item) => item.outcome).sort()).toEqual([
      "cleared",
      "rejected",
    ]);
    expect(history.some((item) => item.id === `${a.entry.id}:cleared`)).toBe(true);
  });
});

describe("Mehrere Tabs", () => {
  it("gültige fremde Lease wird übersprungen, abgelaufene zurückerobert", async () => {
    const a = await enqueueWrite({ kind: "fill", path: "/api/v1/fills", body: "{}" }, NOW);
    if (!a.ok) throw new Error("enqueue fehlgeschlagen");

    const claimedA = await claimNext(NOW, "tab_a");
    expect(claimedA?.id).toBe(a.entry.id);
    expect(claimedA?.lease_owner).toBe("tab_a");

    // Solange die Lease lebt (30 s), arbeitet kein zweites Tab daran.
    expect(await claimNext(NOW + 10_000, "tab_b")).toBeNull();

    // Lease abgelaufen (Tab ist weg) — das zweite Tab übernimmt.
    const claimedB = await claimNext(NOW + OUTBOX_LEASE_MS + 10_000, "tab_b");
    expect(claimedB?.id).toBe(a.entry.id);
    expect(claimedB?.lease_owner).toBe("tab_b");
  });

  it("Parallel: A sendet, B merkt vor — beide bleiben erhalten", async () => {
    const a = await enqueueWrite({ kind: "fill", path: "/api/v1/fills", body: "{}" }, NOW);
    if (!a.ok) throw new Error("enqueue fehlgeschlagen");

    let release!: (result: { ok: boolean; error?: string | null }) => void;
    const pending = new Promise<{ ok: boolean; error?: string | null }>(
      (resolve) => {
        release = resolve;
      },
    );
    const flushPromise = flushQueue(async () => pending, NOW + MIN);

    // B wandert ein, während A in der Leitung ist.
    const b = await enqueueWrite({ kind: "fill", path: "/api/v1/fills", body: "{}" }, NOW + 1);
    if (!b.ok) throw new Error("enqueue fehlgeschlagen");

    release({ ok: false, error: "offline" });
    const flush = await flushPromise;
    expect(flush.failed).toBe(1);

    const entries = await listEntries(NOW + MIN);
    expect(entries.map((entry) => entry.id).sort()).toEqual(
      [a.entry.id, b.entry.id].sort(),
    );
    expect(entries.filter((entry) => entry.state === "retry")).toHaveLength(1);
    expect(entries.filter((entry) => entry.state === "pending")).toHaveLength(1);
  });
});

describe("Grenzen und Fehler", () => {
  it("volle offene Kapazität: ehrlich abgelehnt (queue_full)", async () => {
    for (let i = 0; i < OUTBOX_MAX_ENTRIES; i += 1) {
      const result = await enqueueWrite(
        { kind: "fill", path: "/api/v1/fills", body: "{}" },
        NOW + i,
      );
      expect(result.ok).toBe(true);
    }
    const over = await enqueueWrite({ kind: "fill", path: "/api/v1/fills", body: "{}" }, NOW + 999);
    expect(over).toEqual({ ok: false, error: "queue_full" });

    // Sichtbare Endzustände drücken nicht auf die Kapazität: Nach dem
    // Ablegen eines abgelehnten Eintrags passt wieder etwas hinein.
    await flushQueue(
      async () => ({ ok: false, permanent: true, error: "http_400" }),
      NOW + 2000,
    );
    const fit = await enqueueWrite({ kind: "fill", path: "/api/v1/fills", body: "{}" }, NOW + 3000);
    expect(fit.ok).toBe(true);
  });

  it("IndexedDB nicht verfügbar: storage_failed statt stiller Verlust", async () => {
    const real = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", {
      value: undefined,
      configurable: true,
    });
    await resetOutboxForTests();
    const result = await enqueueWrite(
      { kind: "fill", path: "/api/v1/fills", body: "{}" },
      NOW,
    );
    expect(result).toEqual({ ok: false, error: "storage_failed" });
    Object.defineProperty(globalThis, "indexedDB", {
      value: real,
      configurable: true,
    });
  });
});

describe("Export", () => {
  it("JSON- und CSV-Export tragen Einträge und Historie", async () => {
    const a = await enqueueWrite(
      { kind: "fill", path: "/api/v1/fills", body: '{"name":"A, B"}' },
      NOW,
    );
    if (!a.ok) throw new Error("enqueue fehlgeschlagen");
    await flushQueue(async () => ({ ok: true }), NOW + MIN);

    const snapshot = await exportSnapshot(NOW + MIN);
    expect(snapshot.artifact).toBe("outbox");
    expect(snapshot.entries).toHaveLength(0);
    expect(snapshot.history).toHaveLength(1);

    const csv = exportCsv(snapshot);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      "artifact,id,kind,path,state_or_outcome,created_at,ended_at,attempts,last_error,body",
    );
    // Der Body (``{"name":"A, B"}``) bleibt trotz Komma und Anführungszeichen
    // eine Zelle: eingeclampst, interne Anführungszeichen verdoppelt.
    expect(lines[1]).toContain('"{""name"":""A, B""}"');
    expect(lines[1]).toContain("history");
    expect(lines[1]).toContain("sent");
  });
});
