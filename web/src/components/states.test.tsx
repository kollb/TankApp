// C6 (Rest): Render-Tests für die drei neuen Zustands-Bausteine.
//
// Geprüft wird, was der Nutzer bzw. der Screenreader tatsächlich bekommt:
// ein Skelett meldet sich als „busy“, das Datenstand-Banner schweigt bei
// frischen Daten, und die Tabellen-Variante des Fehlers unterscheidet
// „noch nichts da“ von „Abruf fehlgeschlagen“.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CellError } from "./CellError";
import { DataAgeBanner } from "./DataAge";
import { SkeletonChart, SkeletonPanel, SkeletonRows } from "./Skeleton";
import { messages } from "../data";

const NOW = Date.parse("2026-09-12T12:00:00+02:00");
const minutesAgo = (m: number) => new Date(NOW - m * 60000).toISOString();

describe("Skeleton (C6: Ladezustand hält den Platz)", () => {
  it("meldet sich als busy und nennt, was lädt", () => {
    const html = renderToStaticMarkup(
      <SkeletonPanel lines={3} label="Empfehlung wird berechnet" />,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Empfehlung wird berechnet");
  });

  it("zeichnet so viele Zeilen wie angefragt", () => {
    const two = renderToStaticMarkup(<SkeletonPanel lines={2} title={false} />);
    const five = renderToStaticMarkup(<SkeletonPanel lines={5} title={false} />);
    const count = (html: string) => (html.match(/animate-pulse/g) ?? []).length;
    expect(count(two)).toBe(2);
    expect(count(five)).toBe(5);
  });

  it("Diagramm-Skelett behält eine feste Höhe (kein Layout-Sprung)", () => {
    expect(renderToStaticMarkup(<SkeletonChart height="h-56" />)).toContain("h-56");
  });

  it("Tabellen-Skelett füllt genau die Spaltenzahl", () => {
    const html = renderToStaticMarkup(
      <table>
        <tbody>
          <SkeletonRows rows={2} cols={4} />
        </tbody>
      </table>,
    );
    expect((html.match(/<td/g) ?? []).length).toBe(8);
  });
});

describe("DataAgeBanner (C6: Datenstand älter als X)", () => {
  it("schweigt bei frischen Daten", () => {
    expect(
      renderToStaticMarkup(
        <DataAgeBanner stamp={minutesAgo(5)} kind="prices" now={NOW} />,
      ),
    ).toBe("");
  });

  it("schweigt, wenn gar kein Stand bekannt ist", () => {
    // Nichts zu wissen ist kein Grund, etwas zu behaupten.
    expect(
      renderToStaticMarkup(<DataAgeBanner stamp={null} kind="prices" now={NOW} />),
    ).toBe("");
  });

  it("nennt Alter und Folge, sobald der Stand kippt", () => {
    const html = renderToStaticMarkup(
      <DataAgeBanner stamp={minutesAgo(45)} kind="prices" now={NOW} />,
    );
    expect(html).toContain("vor 45 Minuten");
    expect(html).toContain("eingefroren");
    // `status`, nicht `alert` — kein Unterbrechen mitten im Satz.
    expect(html).toContain('role="status"');
  });

  it("verschärft die Farbe erst bei doppelter Schwelle", () => {
    const warn = renderToStaticMarkup(
      <DataAgeBanner stamp={minutesAgo(45)} kind="prices" now={NOW} />,
    );
    const error = renderToStaticMarkup(
      <DataAgeBanner stamp={minutesAgo(120)} kind="prices" now={NOW} />,
    );
    expect(warn).toContain("amber");
    expect(error).toContain("rose");
  });
});

describe("CellError (C6: Fehler in Tabellenzellen)", () => {
  it("übersetzt den Code und zeigt ihn trotzdem roh", () => {
    const html = renderToStaticMarkup(
      <table>
        <tbody>
          <CellError
            colSpan={9}
            errorCode="influx_read_failed"
            fallback="Noch keine Entscheidungszeilen."
            onRetry={() => {}}
          />
        </tbody>
      </table>,
    );
    expect(html).toContain(messages.influx_read_failed);
    expect(html).toContain("Code: influx_read_failed");
    expect(html).toMatch(/colspan="9"/i);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Erneut laden");
  });

  it("Leerstand ist kein Fehler: kein Alarm-Ton, kein Knopf", () => {
    const html = renderToStaticMarkup(
      <table>
        <tbody>
          <CellError
            colSpan={9}
            empty
            fallback="Noch keine Entscheidungszeilen."
            onRetry={() => {}}
          />
        </tbody>
      </table>,
    );
    expect(html).toContain("Noch keine Entscheidungszeilen.");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("Erneut laden");
  });

  it("empty mit Code bleibt ein Fehler — der Code gewinnt", () => {
    const html = renderToStaticMarkup(
      <table>
        <tbody>
          <CellError
            colSpan={4}
            empty
            errorCode="stats_summary_failed"
            fallback="Noch keine Zeilen."
            onRetry={() => {}}
          />
        </tbody>
      </table>,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain(messages.stats_summary_failed);
  });
});
