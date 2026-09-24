// @vitest-environment happy-dom
// Jetzt: Render-Tests der ersten Ansicht (UI-NEUENTWURF §5.1).
//
// Geprüft wird, was der Nutzer tatsächlich bekommt: die feste Reihenfolge
// ① Entscheidung → ② Drei Fakten → ③ Nächste Schritte → ④ Heute im Blick,
// die vier Ausgänge der Karte, die Frische-Fußzeile und das Begründungs-Sheet
// der Ebene 1. Die Fachlogik selbst steht in `now.test.ts`.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Level1Sheet } from "../components/Level1Sheet";
import { PROFILE_BOUNDS } from "../data";
import type { DecideResult, Station } from "../data";
import {
  EMPTY_ASSUMPTIONS,
  JetztView,
  type JetztViewProps,
} from "./Jetzt";

const NOW = Date.parse("2026-09-14T12:00:00+02:00");
const minutesAgo = (m: number) => new Date(NOW - m * 60000).toISOString();

function station(id: string, overrides: Partial<Station> = {}): Station {
  return {
    station_id: id,
    city: "Frankfurt",
    name: `Station ${id}`,
    brand: "ARAL",
    fuel: "e10",
    maps_url: null,
    dist_km: 1,
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
      station: { id: "aral", name: "Aral Mitte", price_now: 1.749, maps_url: null },
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

const baseProps: JetztViewProps = {
  activeCity: "Frankfurt",
  decideRes: {
    data: decide("wait"),
    error: false,
    errorCode: null,
    pending: false,
    receivedAt: 0,
  },
  liters: 40,
  timeValue: 12,
  autoZ: { z: 10, isPeak: false },
  selectedId: "aral",
  stations: [station("aral")],
  stripBand: null,
  stripCells: [
    { hour: 6, value: null, latest: null, tone: "empty", current: false },
    { hour: 12, value: 1.749, latest: 1.749, tone: "cheap", current: true },
  ],
  pricesAt: minutesAgo(4),
  forecastAt: minutesAgo(35),
  onNavigate: () => {},
  onDeepen: () => {},
  onRetry: () => {},
  assumptions: EMPTY_ASSUMPTIONS,
  defaultLiters: 40,
  defaultTimeValue: 12,
  onAssumptions: () => {},
  onAssumptionsReset: () => {},
  tankPercent: null,
  onTankQuick: () => {},
  dueEpisode: null,
  dueDismissed: false,
  dueFillPrice: 1.749,
  onConfirmRecommended: () => {},
  onDismissDue: () => {},
  onOpenFills: () => {},
  onIntent: () => {},
  now: NOW,
};

function render(overrides: Partial<JetztViewProps> = {}) {
  const props = { ...baseProps, ...overrides } as JetztViewProps;
  return renderToStaticMarkup(<JetztView {...props} />);
}

describe("Jetzt: Aufbau", () => {
  it("hält die feste Reihenfolge ein", () => {
    const html = render({
      decideRes: { data: decide("wait"), error: false, errorCode: null, pending: false, receivedAt: 0 },
    });
    const decision = html.indexOf("Warten bis 18–20 Uhr");
    const facts = html.indexOf("Bestes Fenster heute");
    const steps = html.indexOf("Nächste Schritte");
    const day = html.indexOf("Heute im Blick");
    const fresh = html.indexOf("Preise vor 4 Minuten");
    expect(decision).toBeGreaterThanOrEqual(0);
    expect(facts).toBeGreaterThan(decision);
    expect(steps === -1 || steps > facts).toBe(true);
    expect(day).toBeGreaterThan(facts);
    expect(fresh).toBeGreaterThan(day);
  });

  it("nennt für die Was-wäre-wenn-Tankmenge die Profil-Grenzen (10–100 L)", () => {
    // Prüfbericht §5: Beleg-Erfassung (5–100 L) und Profil (10–100 L)
    // reichen bis 100 L — die Annahmen-Zeile darf die Rechengröße nicht
    // bei 80 L kappen, sonst ist ein 100-L-Tank (Transporter/Diesel) trotz
    // buchbarer Belege nicht abbildbar.
    const html = render();
    expect(html).toContain(
      `${PROFILE_BOUNDS.liters.min}–${PROFILE_BOUNDS.liters.max} L, ganze Liter`,
    );
  });

  it("nennt genau drei Fakten in fester Reihenfolge", () => {
    const html = render({
      decideRes: { data: decide("wait"), error: false, errorCode: null, pending: false, receivedAt: 0 },
    });
    for (const label of ["Jetzt hier", "Bestes Fenster heute", "Tank reicht?"]) {
      expect(html).toContain(label);
    }
  });

  it("„Heute im Blick“: Balken in fester Spur — Zahlenreihe auf einer Linie", () => {
    // Nutzer-Feedback 16.09.2026: „Heute im Blick Zahlenreihe ist schief“.
    // Der Balken stand als Fluss-Element über Stunden- und Wertzeile: je
    // höher der Balken, desto tiefer rutschten beide Zeilen, und die Reihe
    // lief von Zelle zu Zelle auseinander. Jetzt wächst er in einer festen
    // 12-px-Spur von unten (`items-end`), alle Zellen haben dieselbe
    // Reihenfolge Balken → Stunde → Wert.
    const html = render({
      stripCells: [
        { hour: 6, value: 1.759, latest: 1.759, tone: "pricey", current: false },
        { hour: 12, value: 1.709, latest: 1.709, tone: "cheap", current: true },
        { hour: 18, value: null, latest: null, tone: "empty", current: false },
      ],
    });
    const cells = html.split('role="img"').slice(1);
    expect(cells).toHaveLength(3);
    for (const cell of cells) {
      expect(cell).toContain("h-3 w-full items-end");
      // Kein zweizeiliger Preis: „1,725“ bleibt in einer Zeile.
      expect(cell).toContain("whitespace-nowrap");
    }
    const first = cells[0].indexOf("h-3 w-full items-end");
    const hour = cells[0].indexOf(">06<");
    // Sichtbarer Text, nicht das `aria-label` („06:00 — 1,759 €/L“).
    const value = cells[0].indexOf(">1,759<");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(hour).toBeGreaterThan(first);
    expect(value).toBeGreaterThan(hour);
  });

  it("„Heute im Blick“: mobil dieselben drei Zahlen, nur gestapelt", () => {
    // Mobil-Verdichtung 0.53.0 („Zu lang auf mobil“, 18.09.2026): Die drei
    // Kennzahlen standen auf 390 px als drei eigene Karten (260 px statt der
    // 88 px des Entwurfs). Mobil ist der Primärfall — dort steht jetzt eine
    // Zeilenliste aus derselben Quelle (`nowDayPanel`), Desktop behält die
    // Karten. Geprüft wird, dass beide Anordnungen dieselben Werte tragen und
    // dass die Liste nicht selbst wieder versteckt wird (`hidden` ohne
    // `sm:`-Gegenstück) — die mobile Fassung darf nur den Desktop ausblenden.
    const html = render({
      stripCells: [
        { hour: 6, value: 1.759, latest: 1.759, tone: "pricey", current: false },
        { hour: 12, value: 1.709, latest: 1.709, tone: "cheap", current: true },
      ],
    });
    const list = html.slice(html.indexOf("<dl"));
    for (const label of ["Günstigste Stunde", "Tagesmedian", "Jetzt"]) {
      expect(list).toContain(label);
    }
    expect(list).toContain("12–13 Uhr · 1,709 €/L");
    // Die drei Desktop-Karten bleiben vollständig und stehen ab `sm`.
    expect(html).toContain(
      '<div class="mt-3 hidden gap-2 sm:grid sm:grid-cols-3">',
    );
    // Die Mobil-Liste ist nur unterhalb von `sm` verborgen, nie ganz.
    expect(list).toContain("sm:hidden");
  });

  it("drei Fakten bleiben drei Fakten — auch mobil keine Nullreihe", () => {
    // 0.53.0: Die Fakten-Reihe stand mobil als drei gestapelte Karten
    // (409 px). Sie ist jetzt die 3er-Reihe des Entwurfs
    // (ui-neuentwurf-mockup: 88 px), der Tank-Fakt darunter über zwei
    // Spalten — dieselben drei Fakten, zwei Anordnungen. Der Fehler, der
    // hier nicht passieren darf: einen Fakt per `hidden` weglassen, damit
    // es kürzer aussieht.
    const html = render({
      decideRes: { data: decide("wait"), error: false, errorCode: null, pending: false, receivedAt: 0 },
    });
    const grid = html.slice(html.indexOf("sm:grid-cols-3"), html.indexOf("Nächste Schritte"));
    expect(grid).toContain("Jetzt hier");
    expect(grid).toContain("Bestes Fenster heute");
    expect(grid).toContain("Tank reicht?");
    // Tank-Fakt mobil volle Breite, die beiden anderen je eine halbe.
    expect(grid).toContain("col-span-6 sm:col-span-1");
    expect(grid).toContain("col-span-3 sm:col-span-1");
    // Die Schnellauswahl bleibt erreichbar (kein Wischen nötig).
    for (const label of ["¼", "½", "¾", "voll"]) {
      expect(grid).toContain(`>${label}</button>`);
    }
  });

  it("B4: keine Stationszeilen-Liste mehr — die Liste lebt nur in „Stationen“", () => {
    // Befund UX/Mathe 2026-09-19, §1.4.1: „Die Stationszeilen-Liste entfällt
    // hier vollständig (sie lebt in ‚Stationen‘)“. Die graue Karte zeigt
    // weiterhin die Tatsache (günstigster offener Preis) und den Weg zur
    // vollständigen Liste — aber keine zweite Fassung derselben Wahrheit.
    const html = render({
      decideRes: {
        data: {
          ...decide("wait"),
          primary: { ...decide("wait").primary, action: "no_advice" },
        },
        error: false,
        errorCode: null,
        pending: false,
        receivedAt: 0,
      },
      stations: [
        station("nord", { name: "Demo-Tank Nord", price: 1.664 }),
        station("ost", { name: "Demo-Tank Ost", price: 1.671 }),
      ],
    });
    // Die Aufzählung der Preise ist weg — kein `<ol>` mehr in der Ansicht.
    expect(html).not.toContain("<ol");
    // Die Tatsache und der Weg bleiben: günstigster Preis plus Verweis.
    expect(html).toContain("Jetzt am günstigsten: Demo-Tank Nord");
    expect(html).toContain("Alle 2 Preise vergleichen");
  });

  it("B4: der Tagesstreifen ist default-eingeklappt, die Kennzahlen stehen darüber", () => {
    // Befund UX/Mathe 2026-09-19, §1.4.1: „Der Tagesstreifen ist die einzige
    // Visualisierung auf diesem Bildschirm und standardmäßig eingeklappt —
    // die Entscheidung braucht ihn nicht.“ Geprüft: `<details>` ohne
    // `open` (zu), der Auslöser trägt die Tagesfenster-Zeit, die Kennzahlen
    // (Tagesmedian …) stehen vor dem Detail, der Streifensatz dahinter.
    const html = render({
      stripCells: [
        { hour: 6, value: 1.759, latest: 1.759, tone: "pricey", current: false },
        { hour: 12, value: 1.709, latest: 1.709, tone: "cheap", current: true },
      ],
    });
    // Die Karte trägt selbst ein `<details>` (Annahmen) — der Streifen hat
    // deshalb ein eigenes `id`, damit der Ratchet den richtigen meint.
    const details = html.match(/<details[^>]*id="jetzt-daystrip"[^>]*>/);
    expect(details, "Der Streifen sitzt nicht hinter `<details>`").not.toBeNull();
    expect(details![0]).not.toContain("open");
    expect(html).toContain("Tagesstreifen 06–24 Uhr");
    // Reihenfolge: Kennzahlen (Zeilenliste) vor dem eingeklappten Detail.
    expect(html.indexOf("Tagesmedian")).toBeLessThan(
      html.indexOf('id="jetzt-daystrip"'),
    );
    // Der Streifensatz (Zellen + Abdeckung) ist im Detail — erreichbar, nur
    // nicht default-malend.
    const detail = html.slice(html.indexOf('id="jetzt-daystrip"'));
    expect(detail).toContain("daystrip-cells");
    expect(detail).toContain("Stunden mit offener Meldung");
  });

  it("„Heute im Blick“ nennt Zahlen, nicht nur Farben", () => {
    const html = render({
      stripCells: [
        { hour: 6, value: 1.759, latest: 1.759, tone: "pricey", current: false },
        { hour: 12, value: 1.709, latest: 1.709, tone: "cheap", current: true },
        { hour: 18, value: 1.729, latest: 1.729, tone: "mid", current: false },
      ],
    });
    expect(html).toContain("Günstigste Stunde");
    expect(html).toContain("12–13 Uhr");
    expect(html).toContain("Tagesmedian");
    expect(html).toContain("Spanne 5,0 ct/L");
    expect(html).toContain("3 von 3 Stunden mit offener Meldung");
    expect(html).toContain("1,709");
    expect(html).toContain("1,759");
  });

  it("Gleichstand über 06–12 nennt die Spanne, nicht nur 06–07", () => {
    const html = render({
      stripCells: [6, 7, 8, 9, 10, 11].map((hour) => ({
        hour,
        value: 2.289,
        latest: 2.289,
        tone: "cheap" as const,
        current: hour === 9,
      })),
    });
    expect(html).toContain("06–12 Uhr");
    expect(html).not.toContain(">06–07 Uhr<");
    expect(html).toContain("2,289");
  });

  it("zeigt die Frische-Fußzeile mit Ort und Alter", () => {
    const html = render({
      decideRes: { data: decide("wait"), error: false, errorCode: null, pending: false, receivedAt: 0 },
    });
    expect(html).toContain("Preise vor 4 Minuten · Prognose vor 35 Minuten");
    expect(html).toContain("Frankfurt");
  });
});

describe("Jetzt: Zustände", () => {
  it("S0: ohne Daten führt die Karte zur Einrichtung", () => {
    const html = render({
      decideRes: { data: null, error: false, errorCode: null, pending: false, receivedAt: 0 },
      stations: [],
      stripCells: [],
    });
    expect(html).toContain("Einrichten in drei Schritten");
    expect(html).toContain("Einrichtung starten");
  });

  it("S1: das lernende Modell bekommt die graue Karte mit Zählstand — genau einmal", () => {
    const learning = decide("no_advice", false);
    learning.personal_stats.advice.last_30d_total = 12;
    const html = render({
      decideRes: { data: learning, error: false, errorCode: null, pending: false, receivedAt: 0 },
    });
    expect(html).toContain("Keine klare Empfehlung");
    expect(html).toContain("Das Modell lernt noch");
    expect(html).not.toContain("% sicher");
    // Nutzer-Feedback 16.09.2026: „Das Modell lernt noch … ist doppelt“. Der
    // Satz kam zweimal, weil `nowVerdict.detail` ihn schon trug
    // (`learning ?? reason_short`) und die Karte ihn darunter noch einmal
    // renderte. A21-B1.4: Die Detailzeile führt jetzt den Servergrund
    // (`reason_short || learning`), der Zählstand steht in der eigenen
    // Zeile darunter — weiterhin genau einmal, nie doppelt.
    expect(html.split("Das Modell lernt noch").length - 1).toBe(1);
    expect(html.split("von 100 abgeschlossenen Empfehlungen").length - 1).toBe(
      1,
    );
  });

  it("S1 ohne Modell nennt trotzdem den günstigsten offenen Preis", () => {
    // Nutzer-Feedback 14.09.2026: Solange kein Modell bzw. keine Auswahl
    // steht, muss die Karte die Tatsache liefern, die auch ohne Prognose
    // gilt — der günstigste offene Preis, nicht nur „keine Empfehlung“.
    const learning = decide("no_advice", false);
    learning.personal_stats.advice.last_30d_total = 12;
    const html = render({
      decideRes: { data: learning, error: false, errorCode: null, pending: false, receivedAt: 0 },
      stations: [
        station("aral", { price: 1.759 }),
        station("shell", { price: 1.709, name: "Shell Nord" }),
        station("esso", { price: 1.729, name: "Esso West" }),
      ],
    });
    expect(html).toContain("Keine klare Empfehlung");
    expect(html).toContain("Jetzt am günstigsten: Shell Nord");
    expect(html).toContain("1,709 €/L");
    // O19: Die Ersparnis rechnet gegen den Anker der Empfehlung und benennt
    // ihn; die Set-Spanne steht daneben als Spanne.
    expect(html).toContain(
      "unter dem Preis, den die Empfehlung für „jetzt tanken“ ansetzt (Aral Mitte, 1,749 €/L)",
    );
    expect(html).toContain("Günstigste bis teuerste:");
    expect(html).toContain("Das Modell lernt noch");
  });

  it("ohne jede Prognose steht der Preisvergleich statt einer leeren Karte", () => {
    const broken = { error_code: "polling_missing" } as unknown as DecideResult;
    const html = render({
      decideRes: { data: broken, error: false, errorCode: null, pending: false, receivedAt: 0 },
      stations: [
        station("aral", { price: 1.759 }),
        station("shell", { price: 1.709, name: "Shell Nord" }),
      ],
    });
    expect(html).toContain("Preisvergleich");
    expect(html).toContain("Jetzt am günstigsten: Shell Nord");
    expect(html).toContain('role="alert"');
  });

  it("Fehler: Klartext-Karte mit erneutem Versuch", () => {
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
  const brokenRes = {
    data: broken,
    error: false,
    errorCode: null,
    pending: false,
    receivedAt: 0,
  };

  it("S0 gewinnt, wenn noch keine Stationen da sind", () => {
    const html = render({ decideRes: brokenRes, stations: [], stripCells: [] });
    expect(html).toContain("Einrichten in drei Schritten");
    expect(html).not.toContain('role="alert"');
  });

  it("unerreichbare Anlage ist ein Fehler, keine Einrichtungs-Aufforderung", () => {
    const html = render({
      decideRes: {
        data: null,
        error: true,
        errorCode: "request_failed",
        pending: false,
        receivedAt: 0,
      },
      stations: [],
      stripCells: [],
    });
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Einrichten in drei Schritten");
  });

  it("mit Stationen steht der Grund im Klartext, mit Rohcode", () => {
    const html = render({ decideRes: brokenRes });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Polling-Set fehlt");
    expect(html).toContain("polling_missing");
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

  it("zeigt höchstens drei Sätze, die Herkunft und den Weg in die Tiefe", () => {
    const html = renderToStaticMarkup(
      <Level1Sheet
        open
        title="Warum diese Empfehlung?"
        sentences={["eins", "zwei", "drei", "vier"]}
        source="Grundlage: die geladenen Preismeldungen."
        labHint={{ section: "prognose", label: "Im Labor vertiefen: Was die App vorhersagt" }}
        onDeepen={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Warum diese Empfehlung?");
    expect(html).toContain("eins");
    expect(html).toContain("drei");
    expect(html).not.toContain("vier");
    expect(html).toContain("Grundlage: die geladenen Preismeldungen.");
    expect(html).toContain("Im Labor vertiefen: Was die App vorhersagt");
  });
});

describe("Jetzt: Fällig-Prompt (O17)", () => {
  const due = {
    id: "ep_1",
    status: "due",
    last_snapshot: { station_id: "aral", expected_price: 1.559 },
  };

  it("nennt am Knopf den Live-Preis, der gebucht wird", () => {
    const html = render({ dueEpisode: due as any, dueFillPrice: 1.719 });
    expect(html).toContain("Ja, wie empfohlen (");
    expect(html).toContain("1,719 €/L");
  });

  it("schaltet ohne Live-Preis ab, statt den Median zu buchen", () => {
    const html = render({ dueEpisode: due as any, dueFillPrice: null });
    expect(html).toContain("Preis unbekannt");
    expect(html).toContain("disabled");
  });
});

describe("Jetzt: Preisvergleich trägt die Ansicht (A70, Priorität 1)", () => {
  it("nennt Titel, Abdeckung und ehrliche Vergleichsgrenze", () => {
    const html = render({
      decideRes: {
        data: decide("no_advice"),
        error: false,
        errorCode: null,
        pending: false,
        receivedAt: 0,
      },
      stations: [station("aral"), station("shell", { price: null, fresh: false })],
    });
    expect(html).toContain("Jetzt günstig tanken");
    expect(html).toContain("Jetzt am günstigsten: Station aral");
    expect(html).toContain("Günstigste bekannte Station unter den beobachteten Stationen");
    expect(html).toContain("1 von 2 eingerichteten Stationen mit frischem Preis");
  });
});
