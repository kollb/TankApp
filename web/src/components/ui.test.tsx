// D1 (zweiter Schnitt): Die geteilten Bausteine werden von drei künftigen
// Views benutzt — wenn sich `Metric` oder `Badge` still ändert, ändert sich
// die halbe App. Deshalb derselbe Schutz wie bei `HeatmapGrid`/`LoadError`:
// Render-Test gegen echtes Markup (react-dom/server).

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Badge, Empty, Metric, panel } from "./ui";

describe("UI-Bausteine (D1)", () => {
  it("renders a metric with label, value and a mandatory detail line", () => {
    const html = renderToStaticMarkup(
      <Metric
        label="Top-3-Trefferquote (30 Tage)"
        value={<span>62 %</span>}
        detail="Tagesminimum in einem der 3 empfohlenen Zeitfenster."
      />,
    );
    expect(html).toContain("Top-3-Trefferquote (30 Tage)");
    expect(html).toContain("62 %");
    expect(html).toContain("Tagesminimum in einem der 3 empfohlenen Zeitfenster.");
    // Ohne tip kein i-Symbol — kein leeres Bedienelement.
    expect(html).not.toContain("Erklärung zu");
  });

  it("explains a metric with a keyboard-reachable tooltip", () => {
    const html = renderToStaticMarkup(
      <Metric
        label="Sprungfreie Tage · MASE"
        value="0,74"
        detail="Skalierter Fehler an sprungfreien Tagen."
        tip="MASE: Backtest-Fehler geteilt durch den Fehler der saisonalen Naive."
      />,
    );
    expect(html).toContain('aria-label="Erklärung zu Sprungfreie Tage · MASE"');
    expect(html).toContain('title="MASE: Backtest-Fehler geteilt');
    // C5: per Tastatur erreichbar, nicht nur mit der Maus.
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="button"');
  });

  it("keeps the extra hint separate from the detail line", () => {
    const html = renderToStaticMarkup(
      <Metric
        label="M7-Kalibrierung"
        value="—"
        detail="Brier noch nicht messbar."
        hint={<strong>braucht bewertete Empfehlungen</strong>}
      />,
    );
    expect(html).toContain("Brier noch nicht messbar.");
    expect(html).toContain("<strong>braucht bewertete Empfehlungen</strong>");
  });

  it("shows amber for a warning badge and emerald otherwise", () => {
    const warning = renderToStaticMarkup(
      <Badge warning>Unkalibriert · keine Handlungsempfehlung</Badge>,
    );
    expect(warning).toContain("text-amber-300");
    expect(warning).toContain("Unkalibriert · keine Handlungsempfehlung");

    const ok = renderToStaticMarkup(<Badge>20 Stationen</Badge>);
    expect(ok).toContain("text-emerald-300");
    expect(ok).not.toContain("text-amber-300");
  });

  it("renders an empty state without alarm styling", () => {
    const html = renderToStaticMarkup(
      <Empty>Ranking wird geladen …</Empty>,
    );
    expect(html).toContain("Ranking wird geladen …");
    expect(html).toContain("border-dashed");
    expect(html).not.toContain('role="alert"');
  });

  it("shares one card class so views cannot drift apart", () => {
    expect(panel).toContain("rounded-2xl");
    expect(panel).toContain("border-slate-800");
    // Metric baut auf derselben Klasse auf — keine eigene Karten-Optik.
    const html = renderToStaticMarkup(
      <Metric label="x" value="1" detail="d" />,
    );
    expect(html).toContain(panel);
  });
});
