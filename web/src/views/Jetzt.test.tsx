// @vitest-environment happy-dom
// Jetzt: Render-Tests der ersten Ansicht (UX-NEUENTWURF §3).
//
// Geprüft wird, was der Nutzer tatsächlich bekommt: ein Kopf mit Ort und
// Frische-Chip, höchstens ein Banner, die Antwortkarte (eine Zahl, eine
// Handlung) und die Tageszeile — sowie alles, was **nicht** mehr auf dem
// Schirm steht (Was-wäre-wenn, Intents, nächste Schritte, drei Fakten,
// 19-Zellen-Raster, zweite Stationsliste, Fällig-Prompt, Frische-Fußzeile).
// Die Fachlogik selbst steht in `now.test.ts`.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Level1Sheet } from "../components/Level1Sheet";
import type { DecideResult, Station } from "../data";
import { JetztView, type JetztViewProps } from "./Jetzt";

const NOW = Date.parse("2026-09-14T12:00:00+02:00");
const minutesAgo = (m: number) => new Date(NOW - m * 60000).toISOString();

function station(id: string, overrides: Partial<Station> = {}): Station {
  return {
    station_id: id,
    city: "Frankfurt",
    name: `Station ${id}`,
    brand: "ARAL",
    fuel: "e10",
    maps_url: `https://maps.example/${id}`,
    dist_km: 1.2,
    dist_mode: "road",
    price: 1.749,
    last_price: 1.749,
    status: "open",
    fresh: true,
    observed_at: minutesAgo(4),
    age_minutes: 4,
    ...overrides,
  };
}

function decide(
  action: DecideResult["primary"]["action"],
  calibrated = true,
): DecideResult {
  return {
    primary: {
      action,
      station: {
        id: "aral",
        name: "Aral Mitte",
        price_now: 1.749,
        maps_url: "https://maps.example/aral",
      },
      recommended_window: {
        start: "2026-09-14T18:00:00+02:00",
        end: "2026-09-14T20:00:00+02:00",
        expected_price: 1.709,
      },
      expected_saving_eur: 1.6,
      p_correct: 0.82,
      confidence_badge: "high",
      reason_short: "Der Preis fällt hier abends meist.",
    },
    alternatives_nearby: [],
    windows_today: [
      {
        start: "2026-09-14T18:00:00+02:00",
        end: "2026-09-14T20:00:00+02:00",
        expected_price: 1.709,
        expected_saving_eur: 1.6,
        p: 0.82,
      },
    ],
    windows_week: [],
    episode: { id: "e1", status: "open", intent: "none" },
    personal_stats: {
      advice: {
        last_30d_hits: 42,
        last_30d_total: 120,
        hit_rate: 0.78,
        brier_30d: 0.2,
      },
      wallet: { fills_30d: 4, followed: 3, saved_eur_30d: 12.4 },
    },
    calibrated,
    decision_ready: true,
    tank: null,
  };
}

const idle = (data: DecideResult | null) => ({
  data,
  error: false,
  errorCode: null,
  pending: false,
  receivedAt: 0,
});

const baseProps: JetztViewProps = {
  activeCity: "Frankfurt",
  fuel: "e10",
  liters: 40,
  decideRes: idle(decide("wait")),
  stations: [station("aral")],
  selectedId: "aral",
  stripCells: [
    { hour: 6, value: 1.789, latest: 1.789, tone: "pricey", current: false },
    { hour: 12, value: 1.749, latest: 1.749, tone: "cheap", current: true },
    { hour: 18, value: 1.709, latest: 1.709, tone: "cheap", current: false },
  ],
  pricesAt: minutesAgo(4),
  forecastAt: minutesAgo(35),
  onNavigate: () => {},
  onDeepen: () => {},
  onRetry: () => {},
  now: NOW,
};

function render(overrides: Partial<JetztViewProps> = {}) {
  const props = { ...baseProps, ...overrides } as JetztViewProps;
  return renderToStaticMarkup(<JetztView {...props} />);
}

describe("Jetzt: Aufbau (§3 — eine Frage, eine Antwort)", () => {
  it("hält die feste Reihenfolge ein: Kopf → Banner → Antwort → Tageszeile", () => {
    const html = render();
    const head = html.indexOf('id="jetzt-title"');
    const answer = html.indexOf('id="jetzt-antwort"');
    const day = html.indexOf('id="jetzt-tag"');
    expect(head).toBeGreaterThanOrEqual(0);
    expect(answer).toBeGreaterThan(head);
    expect(day).toBeGreaterThan(answer);
  });

  it("nennt im Kopf Ort, Kraftstoff und das Alter als Chip", () => {
    const html = render();
    expect(html).toContain("Frankfurt");
    expect(html).toContain("E10");
    expect(html).toContain("vor 4 Minuten");
    // Der Chip steht im Kopf, nicht als Fußzeile unter der Ansicht.
    expect(html.indexOf("vor 4 Minuten")).toBeLessThan(
      html.indexOf('id="jetzt-antwort"'),
    );
  });

  it("die Antwortkarte trägt genau eine Zahl und genau eine Handlung", () => {
    const html = render();
    expect(html).toContain("Warten bis ~18 Uhr");
    expect(html).toContain("spart ca. 1,60 €");
    // Genau ein Route-Link, genau ein „Warum?“.
    expect((html.match(/https:\/\/maps\.example\//g) ?? []).length).toBe(1);
    expect((html.match(/Warum\?/g) ?? []).length).toBe(1);
  });

  it("Tageszeile: eine Zeile, die Kurve hat eine Textalternative", () => {
    const html = render();
    expect(html).toContain('id="jetzt-tagzeile"');
    expect(html).toContain("Heute: Tief ~18 Uhr");
    // M8: kein Bild ohne Text — die Kurve ist beschriftet.
    expect(html).toMatch(/aria-label="Tagesverlauf[^"]*1,709 €\/L/);
    // Das Detailblatt ist zu (kein offener Dialog im Markup).
    expect(html).not.toMatch(/<dialog[^>]* open/);
  });

  it("ohne Messwerte gibt es keine Tageszeile", () => {
    const html = render({ stripCells: [] });
    expect(html).not.toContain('id="jetzt-tag"');
    expect(html).toContain('id="jetzt-antwort"');
  });
});

describe("Jetzt: Streichliste (§7)", () => {
  const html = render();

  it("keine Was-wäre-wenn-Annahmen mehr", () => {
    expect(html).not.toContain("Was-wäre-wenn");
    expect(html).not.toContain("Annahmen:");
    expect(html).not.toContain("Tankmenge (L)");
    expect(html).not.toContain("Spätestens tanken");
  });

  it("keine Intents, keine nächsten Schritte, keine drei Fakten", () => {
    expect(html).not.toContain("Ich warte");
    expect(html).not.toContain("Verwerfen");
    expect(html).not.toContain("Nächste Schritte");
    expect(html).not.toContain("Jetzt hier");
    expect(html).not.toContain("Bestes Fenster heute");
    expect(html).not.toContain("Tank reicht?");
  });

  it("kein 19-Zellen-Raster, keine zweite Stationsliste", () => {
    expect(html).not.toContain("Heute im Blick");
    expect(html).not.toContain("Tagesstreifen");
    expect(html).not.toContain("daystrip-cells");
    expect(html).not.toContain("<ol");
  });

  it("keine Tankstands-Pflege — die gehört an genau einen Ort („Ich“)", () => {
    expect(html).not.toContain("Schnellauswahl");
    expect(html).not.toContain(">¼<");
    expect(html).not.toContain("Keine Angabe");
  });

  it("kein Fällig-Prompt mehr (Entscheidung 04.10.2026)", () => {
    expect(html).not.toContain("Rückmeldung nach Fensterende");
    expect(html).not.toContain("Gerade getankt?");
    expect(html).not.toContain("wie empfohlen");
  });

  it("keine Frische-Fußzeile unter der Ansicht", () => {
    expect(html).not.toContain("Preise vor 4 Minuten · Prognose vor 35 Minuten");
  });
});

describe("Jetzt: Zustände", () => {
  it("S0: ohne Daten führt die Karte zur Einrichtung", () => {
    const html = render({
      decideRes: idle(null),
      stations: [],
      stripCells: [],
    });
    expect(html).toContain("Einrichten in drei Schritten");
    expect(html).toContain("Einrichtung starten");
  });

  it("ohne Prognose trägt die Karte die Tatsache: der günstigste Preis jetzt", () => {
    const html = render({
      decideRes: idle(decide("no_advice")),
      stations: [
        station("aral", { price: 1.759 }),
        station("shell", { price: 1.709, name: "Shell Nord" }),
      ],
    });
    expect(html).toContain("Günstigste gerade: Shell Nord");
    expect(html).toContain("1,709 €/L");
    expect(html).toContain("Stand 11:56 Uhr");
  });

  it("offline: letzter Stand, und der Preis an der Säule zählt", () => {
    const html = render({ online: false });
    expect(html).toContain("Letzter Stand: Station aral");
    expect(html).toContain("Der Preis an der Säule zählt.");
  });

  it("Fehler: Klartext mit erneutem Versuch", () => {
    const html = render({
      decideRes: {
        data: null,
        error: true,
        errorCode: "influx_read_failed",
        pending: false,
        receivedAt: 0,
      },
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("InfluxDB konnte nicht gelesen werden");
  });

  it("Laden: Skelett meldet sich als beschäftigt", () => {
    const html = render({
      decideRes: { data: null, error: false, errorCode: null, pending: true, receivedAt: 0 },
    });
    expect(html).toContain('aria-busy="true"');
  });
});

describe("Jetzt: Server-Fehlerpayload (Regression: keine leere Seite)", () => {
  // Vorher stürzte die Ansicht hier ab (`decide.primary.action` ohne `primary`)
  // und die App blieb weiß. Beide Wege müssen stehen: Einrichtung als
  // nächster Schritt, wenn nichts da ist — und ein benannter Fehler, wenn es
  // Stationen gibt, die Empfehlung aber nicht berechnet werden konnte.
  const broken = { error_code: "polling_missing" } as unknown as DecideResult;

  it("S0 gewinnt, wenn noch keine Stationen da sind", () => {
    const html = render({
      decideRes: idle(broken),
      stations: [],
      stripCells: [],
    });
    expect(html).toContain("Einrichten in drei Schritten");
    expect(html).not.toContain('role="alert"');
  });

  it("mit Stationen steht der Grund im Klartext, mit Rohcode", () => {
    const html = render({ decideRes: idle(broken) });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Polling-Set fehlt");
    expect(html).toContain("polling_missing");
  });
});

describe("Jetzt: genau ein Banner (§3, Rangfolge offline → keine Prognose → Hinweis)", () => {
  it("volle Ansicht: kein Banner", () => {
    const html = render();
    expect(html).not.toContain("m3-banner-warn");
    expect(html).not.toContain("Die Prognose macht gerade Pause");
  });

  it("keine Prognose: ein Banner, Preise bleiben live", () => {
    const html = render({
      decideRes: idle({ ...decide("wait"), decision_ready: false }),
    });
    expect(html).toContain("Die Prognose macht gerade Pause");
    expect(html).toContain("Alle Preise sind trotzdem live");
    expect(html).toContain("Erneut versuchen");
  });

  it("offline schlägt „keine Prognose“ — genau ein Banner", () => {
    const html = render({
      online: false,
      decideRes: idle({ ...decide("wait"), decision_ready: false }),
    });
    expect((html.match(/m3-banner-warn/g) ?? []).length).toBe(1);
    expect(html).not.toContain("Die Prognose macht gerade Pause");
  });

  it("jede Stufe bietet genau eine Handlung zum Wiederverbinden", () => {
    const html = render({ online: false });
    expect((html.match(/Erneut versuchen/g) ?? []).length).toBe(1);
  });
});

describe("Ebene 1: Begründungs-Sheet", () => {
  it("ist geschlossen nicht im Dokument", () => {
    const html = renderToStaticMarkup(
      <Level1Sheet
        open={false}
        title="Warum?"
        sentences={["eins"]}
        source="Quelle"
        labHint={{ section: "sicherheit", label: "Weiter" }}
        onDeepen={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toBe("");
  });

  it("zeigt höchstens fünf Zeilen, die Herkunft und den Weg in die Tiefe", () => {
    // UX-NEUENTWURF §3: Das „Warum?“ -Blatt trägt maximal fünf Zeilen
    // (Fenster, Ersparnis, Sicherheit, Tank, Stand).
    const html = renderToStaticMarkup(
      <Level1Sheet
        open
        title="Warum diese Empfehlung?"
        sentences={["eins", "zwei", "drei", "vier", "fünf", "sechs"]}
        source="Grundlage: die geladenen Preismeldungen."
        labHint={{ section: "prognose", label: "Im Labor vertiefen: Was die App vorhersagt" }}
        onDeepen={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Warum diese Empfehlung?");
    expect(html).toContain("fünf");
    expect(html).not.toContain("sechs");
    expect(html).toContain("Grundlage: die geladenen Preismeldungen.");
    expect(html).toContain("Im Labor vertiefen: Was die App vorhersagt");
  });
});
