// @vitest-environment happy-dom
// B7: useResource-Policy — ein fehlgeschlagener Poll zwischen zwei
// erfolgreichen darf die Ansicht nicht in den Fehlerzustand reißen,
// „Refresh“ darf ein laufendes Laden nicht abbrechen (sonst lädt eine
// langsame NAS endlos neu, statt fertig zu werden) — und ein Refresh bei
// unverändertem Datenstand revalidiert per ETag (304), statt die Antwort
// neu berechnen zu lassen.

import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { resourceErrorVisible, useResource } from "./data";

describe("B7: Fehler-Policy (ein Poll-Fehler ≠ Ausfall)", () => {
  it("zeigt den ersten Fehlversuch, wenn nichts anzuzeigen wäre", () => {
    expect(resourceErrorVisible(1, false)).toBe(true);
  });

  it("lässt die Daten bei einem einzelnen fehlgeschlagenen Poll stehen", () => {
    expect(resourceErrorVisible(1, true)).toBe(false);
  });

  it("macht den Fehler erst nach zwei aufeinanderfolgenden Fehlern sichtbar", () => {
    expect(resourceErrorVisible(2, true)).toBe(true);
    expect(resourceErrorVisible(3, true)).toBe(true);
  });
});

describe("B7: useResource-Startzustand (ohne URL)", () => {
  it("startet leer und ohne Fehler — inaktive Ressourcen bleiben stumm", () => {
    function Probe() {
      const r = useResource<string | null>(null, 30000, 0);
      return (
        <span>
          {String(r.error)}|{r.data ?? "null"}|{String(r.pending)}
        </span>
      );
    }
    expect(renderToStaticMarkup(<Probe />)).toBe(
      "<span>false|null|false</span>",
    );
  });
});

describe("B7-Revalidierung: ETag/304-Protokoll", () => {
  const url = "/api/v1/overview?fuel=e10&city=Frankfurt";
  const etagA = "etag-aaa";
  const etagB = "etag-bbb";

  it("schickt If-None-Match, behält die Daten bei 304 und nimmt neue ETags an", async () => {
    const originalFetch = globalThis.fetch;
    const calls: { ifNoneMatch: string | null }[] = [];
    // Server-Perspektive: aktueller Datenstand + ETag.
    let serverEtag = etagA;
    let serverPayload = { stand: "a", zähler: 1 };
    globalThis.fetch = (async (_input: unknown, init?: { headers?: Record<string, string> }) => {
      const ifNoneMatch = init?.headers?.["If-None-Match"] ?? null;
      calls.push({ ifNoneMatch });
      if (ifNoneMatch === serverEtag) {
        return new Response(null, {
          status: 304,
          headers: { ETag: serverEtag },
        });
      }
      return new Response(JSON.stringify(serverPayload), {
        status: 200,
        headers: { ETag: serverEtag, "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const view: { data: unknown; error: boolean; pending: boolean } = {
      data: null,
      error: false,
      pending: false,
    };
    function Probe({ refresh }: { refresh: number }) {
      const r = useResource<typeof serverPayload>(url, 600_000, refresh);
      view.data = r.data;
      view.error = r.error;
      view.pending = r.pending;
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      // 1) Erstes Laden: kein If-None-Match, 200 mit ETag A.
      await act(async () => {
        root.render(<Probe refresh={0} />);
      });
      expect(view.data).toEqual(serverPayload);
      expect(view.pending).toBe(false);
      expect(calls[0].ifNoneMatch).toBeNull();

      // 2) Refresh bei gleichem Datenstand: If-None-Match mit, 304 —
      //    Daten bleiben stehen, kein Fehler, kein „lädt …“ danach.
      await act(async () => {
        root.render(<Probe refresh={1} />);
      });
      expect(calls[1].ifNoneMatch).toBe(etagA);
      expect(view.data).toEqual(serverPayload);
      expect(view.error).toBe(false);
      expect(view.pending).toBe(false);

      // 3) Datenstand geändert (neuer Poll): Server-ETag B — der alte
      //    If-None-Match verfehlt, 200 mit neuem Payload + ETag B.
      serverEtag = etagB;
      serverPayload = { stand: "b", zähler: 2 };
      await act(async () => {
        root.render(<Probe refresh={2} />);
      });
      expect(calls[2].ifNoneMatch).toBe(etagA);
      expect(view.data).toEqual(serverPayload);

      // 4) Der neue ETag wird für den nächsten Refresh übernommen.
      await act(async () => {
        root.render(<Probe refresh={3} />);
      });
      expect(calls[3].ifNoneMatch).toBe(etagB);
      expect(view.data).toEqual(serverPayload);
    } finally {
      await act(async () => {
        root.unmount();
      });
      globalThis.fetch = originalFetch;
    }
  });
});
