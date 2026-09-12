// C6 (kleinster Schnitt): Der gemeinsame Fehler-Zustand muss in jedem Panel
// gleich aussehen, den `error_code` in Klartext übersetzen **und** den Rohcode
// zeigen — sonst bleibt eine Meldung an den Betrieb ein Ratespiel. Render-Test
// gegen echtes Markup (react-dom/server), wie bei `HeatmapGrid.test.tsx`.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LoadError } from "./LoadError";
import { messages } from "../data";

function markup(props: Parameters<typeof LoadError>[0]) {
  return renderToStaticMarkup(<LoadError {...props} />);
}

describe("LoadError (C6: einheitlicher Fehler-Zustand)", () => {
  it("translates a known error_code and still shows the raw code", () => {
    const html = markup({
      errorCode: "influx_read_failed",
      fallback: "Der Preisverlauf konnte nicht geladen werden.",
      onRetry: () => {},
    });
    expect(html).toContain(messages.influx_read_failed);
    // Der Klartext ersetzt den Code nicht — beides steht da.
    expect(html).toContain("Code: influx_read_failed");
    // Die Panel-Floskel darf nicht zusätzlich erscheinen.
    expect(html).not.toContain("Der Preisverlauf konnte nicht geladen werden.");
  });

  it("falls back to a generic sentence for an unknown code", () => {
    const html = markup({
      errorCode: "brand_new_code",
      fallback: "Tankbelege konnten nicht geladen werden.",
    });
    expect(html).toContain("Daten konnten nicht vollständig geladen werden.");
    expect(html).toContain("Code: brand_new_code");
  });

  it("uses the panel text when there is no code at all (transport error)", () => {
    const html = markup({
      errorCode: null,
      fallback: "Der Tagesverlauf konnte nicht geladen werden.",
      onRetry: () => {},
    });
    expect(html).toContain("Der Tagesverlauf konnte nicht geladen werden.");
    expect(html).not.toContain("Code:");
  });

  it("offers exactly one retry button, and none without a handler", () => {
    const withRetry = markup({
      errorCode: "collector_check_failed",
      fallback: "—",
      onRetry: () => {},
    });
    expect(withRetry.match(/<button/g)?.length).toBe(1);
    expect(withRetry).toContain("Erneut laden");
    expect(withRetry).toContain('type="button"');

    const withoutRetry = markup({
      errorCode: "collector_check_failed",
      fallback: "—",
    });
    expect(withoutRetry).not.toContain("<button");
  });

  it("accepts a panel-specific retry label", () => {
    const html = markup({
      errorCode: null,
      fallback: "Der Modell-Ausblick konnte nicht geladen werden.",
      onRetry: () => {},
      retryLabel: "Ausblick neu laden",
    });
    expect(html).toContain("Ausblick neu laden");
    expect(html).not.toContain("Erneut laden");
  });

  it("is announced as an alert and keeps the compact variant visually distinct", () => {
    const box = markup({ errorCode: null, fallback: "Fehler", onRetry: () => {} });
    expect(box).toContain('role="alert"');
    expect(box).toContain("border-dashed");

    const inline = markup({
      errorCode: "model_not_available",
      fallback: "Fehler",
      onRetry: () => {},
      compact: true,
    });
    expect(inline).toContain('role="alert"');
    expect(inline).toContain("border-rose-500/25");
    expect(inline).not.toContain("border-dashed");
  });

  it("renders an extra hint below the message", () => {
    const html = markup({
      errorCode: "polling_missing",
      fallback: "—",
      onRetry: () => {},
      children: <p className="hint">Polling-Set vom Pi bereitstellen.</p>,
    });
    expect(html).toContain("Polling-Set vom Pi bereitstellen.");
    expect(html).toContain(messages.polling_missing);
  });
});
