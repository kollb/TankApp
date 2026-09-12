// D3: Property-Tests Umweg-Ökonomie — reine Tests, kein Produktcode.
//
// K = d·(c/100)·p + (d/v)·z, brutto = (p_ref − p_alt)·L, netto = brutto − K
// (Konzept §10). Die Beispielfälle in `data.test.ts` prüfen einzelne Zahlen;
// hier geht es um die Eigenschaften, die über den ganzen Eingaberaum gelten
// müssen: Monotonie, Grenzfälle (z = 0, d = 0, L → ∞), Break-even über
// `criticalCtPerL` und die Schwellen-Logik von `detourVerdict` (H1/B6: die
// Schwellen kommen vom Server, die Funktion darf keine eigenen erfinden).
//
// Eingaberaum = die Grenzen, die GUI und Server wirklich zulassen:
// Preis 0,40–5,00 €/L (FILL_LIMITS), 5–100 L, Umweg 0–100 km (`invalid_detour`
// darüber), Verbrauch 4–15 L/100 km, Zeitwert 0–50 €/h.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { detourEconomics, detourVerdict, type DetourMode } from "./data";

/**
 * Fester Seed: Property-Tests dürfen in CI nicht flackern. Wer den Eingaberaum
 * neu ausloten will, setzt `TANKAPP_FC_SEED=<zahl>` (oder `path` per
 * fast-check-Report) — gefundenen Gegenbeispiele werden als Beispiel-Fall in
 * `data.test.ts` nachgetragen.
 */
const SEED = Number(process.env.TANKAPP_FC_SEED ?? 20260912);
const RUNS = { numRuns: 300, seed: SEED };
const EPS = 1e-9;

const price = () => fc.double({ min: 0.4, max: 5, noNaN: true });
const liters = () => fc.double({ min: 5, max: 100, noNaN: true });
const km = () => fc.double({ min: 0, max: 100, noNaN: true });
const consumption = () => fc.double({ min: 4, max: 15, noNaN: true });
const speed = () => fc.double({ min: 1, max: 130, noNaN: true });
const timeValue = () => fc.double({ min: 0, max: 50, noNaN: true });
const mode = (): fc.Arbitrary<DetourMode> =>
  fc.constantFrom<DetourMode>("onroute", "dedicated");

/** Ein Satz Eingaben innerhalb der Produkt-Grenzen. */
const input = () =>
  fc.record({
    refPrice: price(),
    altPrice: price(),
    liters: liters(),
    km: km(),
    mode: mode(),
    consumption: consumption(),
    speedKmh: speed(),
    timeValueEurH: timeValue(),
  });

/** Schwellen, wie der Server sie liefert: worth ≥ borderline ≥ 0. */
const thresholds = () =>
  fc
    .tuple(
      fc.double({ min: 0, max: 10, noNaN: true }),
      fc.double({ min: 0, max: 10, noNaN: true }),
    )
    .map(([a, b]) => ({ worth: Math.max(a, b), borderline: Math.min(a, b) }));

const rank = { not_worth: 0, borderline: 1, worth: 2 } as const;

describe("D3 · Umweg-Ökonomie: Zerlegung", () => {
  it("netto ist immer brutto minus Kosten, und alles bleibt endlich", () => {
    fc.assert(
      fc.property(input(), (i) => {
        const r = detourEconomics(i);
        expect(Number.isFinite(r.grossEur)).toBe(true);
        expect(Number.isFinite(r.fuelEur)).toBe(true);
        expect(Number.isFinite(r.timeEur)).toBe(true);
        expect(Number.isFinite(r.netEur)).toBe(true);
        expect(Number.isFinite(r.criticalCtPerL)).toBe(true);
        expect(r.netEur).toBeCloseTo(r.grossEur - r.fuelEur - r.timeEur, 9);
        expect(r.fuelEur).toBeGreaterThanOrEqual(0);
        expect(r.timeEur).toBeGreaterThanOrEqual(0);
        expect(r.km).toBe(i.km); // km wird durchgereicht, nicht umgerechnet
      }),
      RUNS,
    );
  });

  it("brutto hängt nur an Preisen und Litern, Kosten nur am Weg", () => {
    fc.assert(
      fc.property(input(), km(), (i, otherKm) => {
        const a = detourEconomics(i);
        const b = detourEconomics({ ...i, km: otherKm });
        // Gleiche Preise/Liter → gleiche Brutto-Ersparnis, egal wie weit der
        // Umweg ist; umgekehrt ändert ein anderer Preis nie die Fahrkosten.
        expect(b.grossEur).toBeCloseTo(a.grossEur, 9);
        const c = detourEconomics({ ...i, refPrice: i.refPrice + 0.5 });
        expect(c.fuelEur).toBeCloseTo(a.fuelEur, 9);
        expect(c.timeEur).toBeCloseTo(a.timeEur, 9);
        expect(c.grossEur).toBeCloseTo(a.grossEur + 0.5 * i.liters, 6);
      }),
      RUNS,
    );
  });

  it("dedicated ist genau der doppelte Weg (Hin und Rück)", () => {
    fc.assert(
      fc.property(input(), (i) => {
        const onroute = detourEconomics({ ...i, mode: "onroute" });
        const dedicated = detourEconomics({ ...i, mode: "dedicated" });
        expect(dedicated.grossEur).toBeCloseTo(onroute.grossEur, 9);
        expect(dedicated.fuelEur).toBeCloseTo(onroute.fuelEur * 2, 6);
        expect(dedicated.timeEur).toBeCloseTo(onroute.timeEur * 2, 6);
        expect(dedicated.criticalCtPerL).toBeCloseTo(
          onroute.criticalCtPerL * 2,
          6,
        );
        // Ein Umweg, der sich einfach lohnt, lohnt sich nicht automatisch
        // doppelt — die Kosten steigen, die Ersparnis nicht.
        expect(dedicated.netEur).toBeLessThanOrEqual(onroute.netEur + EPS);
      }),
      RUNS,
    );
  });

  it("Preise tauschen spiegelt die Ersparnis, nicht die Kosten", () => {
    fc.assert(
      fc.property(input(), (i) => {
        if (i.refPrice < i.altPrice) return; // „Alternative teurer“ ist kein Umweg-Fall
        const a = detourEconomics(i);
        const b = detourEconomics({ ...i, refPrice: i.altPrice, altPrice: i.refPrice });
        expect(b.grossEur).toBeCloseTo(-a.grossEur, 9);
        // fuelEur hängt am Preis der **Alternativ**-Station → nicht symmetrisch,
        // aber die Richtung stimmt: getauschte Preise lohnen sich nie.
        expect(b.netEur).toBeLessThanOrEqual(EPS);
      }),
      RUNS,
    );
  });
});

describe("D3 · Umweg-Ökonomie: Monotonie", () => {
  it("mehr Liter verstärken den Preisausschlag — in beide Richtungen", () => {
    fc.assert(
      fc.property(input(), liters(), (i, more) => {
        const small = Math.min(i.liters, more);
        const big = Math.max(i.liters, more);
        const lo = detourEconomics({ ...i, liters: small });
        const hi = detourEconomics({ ...i, liters: big });
        const delta = hi.netEur - lo.netEur;
        const priceGap = i.refPrice - i.altPrice;
        const expected = priceGap * (big - small);
        // Netto ist linear in Litern: Δnetto = Δp · ΔL (die Kosten hängen nicht
        // an L). Das Vorzeichen folgt daraus — außer Δ ist kleiner als das
        // Zahlenrauschen, dann ist keine Richtung behauptbar.
        expect(delta).toBeCloseTo(expected, 6);
        if (Math.abs(expected) > 1e-6) {
          expect(Math.sign(delta)).toBe(Math.sign(expected));
        }
        expect(hi.grossEur - lo.grossEur).toBeCloseTo(expected, 6);
      }),
      RUNS,
    );
  });

  it("criticalCtPerL fällt mit der Tankmenge (Fixkosten auf mehr Liter)", () => {
    fc.assert(
      fc.property(input(), liters(), (i, more) => {
        const small = Math.min(i.liters, more);
        const big = Math.max(i.liters, more);
        const lo = detourEconomics({ ...i, liters: small }).criticalCtPerL;
        const hi = detourEconomics({ ...i, liters: big }).criticalCtPerL;
        expect(hi).toBeLessThanOrEqual(lo + 1e-9);
      }),
      RUNS,
    );
  });

  it("weiter, durstiger, langsamer oder teurere Zeit macht den Umweg schlechter", () => {
    fc.assert(
      fc.property(input(), km(), consumption(), speed(), timeValue(), (i, k, c, v, z) => {
        const base = detourEconomics(i);
        const variants = [
          detourEconomics({ ...i, km: Math.max(i.km, k) }),
          detourEconomics({ ...i, consumption: Math.max(i.consumption, c) }),
          detourEconomics({ ...i, speedKmh: Math.min(i.speedKmh, v) }),
          detourEconomics({ ...i, timeValueEurH: Math.max(i.timeValueEurH, z) }),
        ];
        for (const worse of variants) {
          expect(worse.netEur).toBeLessThanOrEqual(base.netEur + 1e-9);
          expect(worse.criticalCtPerL).toBeGreaterThanOrEqual(
            base.criticalCtPerL - 1e-9,
          );
        }
      }),
      RUNS,
    );
  });

  it("ein teurerer Alternativ-Preis kippt die Ersparnis monoton", () => {
    fc.assert(
      fc.property(input(), price(), (i, other) => {
        const a = detourEconomics(i);
        const b = detourEconomics({ ...i, altPrice: other });
        if (other > i.altPrice) expect(b.netEur).toBeLessThanOrEqual(a.netEur + 1e-9);
        if (other < i.altPrice) expect(b.netEur).toBeGreaterThanOrEqual(a.netEur - 1e-9);
      }),
      RUNS,
    );
  });
});

describe("D3 · Umweg-Ökonomie: Break-even", () => {
  it("criticalCtPerL ist genau die Differenz, bei der netto null wird", () => {
    fc.assert(
      fc.property(input(), (i) => {
        const r = detourEconomics(i);
        const gapCt = (i.refPrice - i.altPrice) * 100;
        // netto = L · (Δp − K/L) → Vorzeichen aus dem Abstand zur Break-even-Marke
        expect(r.netEur).toBeCloseTo(
          (i.liters * (gapCt - r.criticalCtPerL)) / 100,
          6,
        );
        if (gapCt > r.criticalCtPerL + 1e-9) expect(r.netEur).toBeGreaterThan(0);
        if (gapCt < r.criticalCtPerL - 1e-9) expect(r.netEur).toBeLessThan(0);
      }),
      RUNS,
    );
  });

  it("auf der Break-even-Marke ist netto null", () => {
    fc.assert(
      fc.property(input(), (i) => {
        const first = detourEconomics(i);
        if (i.liters <= 0) return;
        // Preis genau auf die kritische Marke setzen → netto ≈ 0
        const balanced = detourEconomics({
          ...i,
          refPrice: i.altPrice + first.criticalCtPerL / 100,
        });
        expect(Math.abs(balanced.netEur)).toBeLessThan(1e-6);
      }),
      RUNS,
    );
  });
});

describe("D3 · Umweg-Ökonomie: Grenzfälle", () => {
  it("z = 0 (Zeit ist gratis) lässt die Zeitkosten weg", () => {
    fc.assert(
      fc.property(input(), (i) => {
        const r = detourEconomics({ ...i, timeValueEurH: 0 });
        expect(r.timeEur).toBe(0);
        expect(r.netEur).toBeCloseTo(r.grossEur - r.fuelEur, 9);
      }),
      RUNS,
    );
  });

  it("d = 0 (kein Umweg) kostet nichts — netto ist brutto", () => {
    fc.assert(
      fc.property(input(), (i) => {
        const r = detourEconomics({ ...i, km: 0 });
        expect(r.fuelEur).toBe(0);
        expect(r.timeEur).toBe(0);
        expect(r.criticalCtPerL).toBe(0);
        expect(r.netEur).toBeCloseTo(r.grossEur, 9);
        // Ohne Umweg entscheidet nur noch der Preisabstand.
        expect(Math.sign(r.netEur)).toBe(Math.sign(i.refPrice - i.altPrice));
      }),
      RUNS,
    );
  });

  it("L → ∞ drückt die Break-even-Marke gegen null", () => {
    fc.assert(
      fc.property(input(), (i) => {
        const huge = detourEconomics({ ...i, liters: 1e9 });
        // K ist im Produkt-Raum gedeckelt (100 km × 2, 15 L/100 km, 5 €/L,
        // 1 km/h, 50 €/h → K ≤ 10.150 €), also muss K/L bei L = 10⁹ unter
        // zwei Tausendstel ct/L fallen.
        expect(huge.criticalCtPerL).toBeLessThan(2e-3);
        // Ab einem Cent Preisabstand trägt die Menge: netto wächst über alle
        // Grenzen (bei gleichem Preis bleibt netto bei −K).
        if (i.refPrice - i.altPrice >= 0.01) {
          expect(huge.netEur).toBeGreaterThan(1e5);
        }
        expect(Number.isFinite(huge.netEur)).toBe(true);
      }),
      RUNS,
    );
  });

  it("L = 0 erfindet keine Break-even-Marke", () => {
    fc.assert(
      fc.property(input(), (i) => {
        const r = detourEconomics({ ...i, liters: 0 });
        expect(r.grossEur).toBeCloseTo(0, 12); // Vorzeichen egal, Betrag null
        expect(r.criticalCtPerL).toBe(0); // 0/0 darf nie NaN oder Infinity werden
        expect(r.netEur).toBeCloseTo(-(r.fuelEur + r.timeEur), 9);
      }),
      RUNS,
    );
  });

  it("v ≤ 0 teilt nicht durch null — der Server-Boden von 1 km/h gilt auch hier", () => {
    fc.assert(
      fc.property(input(), fc.double({ min: -50, max: 0, noNaN: true }), (i, broken) => {
        const r = detourEconomics({ ...i, speedKmh: broken });
        const floor = detourEconomics({ ...i, speedKmh: 1 });
        expect(Number.isFinite(r.timeEur)).toBe(true);
        expect(r.timeEur).toBeCloseTo(floor.timeEur, 9);
      }),
      RUNS,
    );
  });

  it("Extremwerte bleiben endlich (kein Überlauf im realistischen Raum)", () => {
    fc.assert(
      fc.property(input(), (i) => {
        const extreme = detourEconomics({
          ...i,
          refPrice: 5,
          altPrice: 0.4,
          liters: 100,
          km: 100,
          mode: "dedicated",
          consumption: 15,
          speedKmh: 1,
          timeValueEurH: 50,
        });
        expect(Number.isFinite(extreme.netEur)).toBe(true);
        expect(extreme.grossEur).toBeCloseTo(460, 6);
        // 200 km bei 15 L/100 km und 0,40 €/L = 12 € Sprit, 200 h × 50 €/h = 10 000 € Zeit
        expect(extreme.fuelEur).toBeCloseTo(12, 6);
        expect(extreme.timeEur).toBeCloseTo(10_000, 6);
        expect(extreme.netEur).toBeLessThan(0);
        expect(detourVerdict(extreme.netEur, 1.5, 0.5)).toBe("not_worth");
      }),
      RUNS,
    );
  });
});

describe("D3 · Schwellen-Logik worth_it (H1/B6)", () => {
  it("liefert immer genau ein Verdict und kennt keine eigenen Konstanten", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -20, max: 20, noNaN: true }),
        thresholds(),
        (net, th) => {
          const verdict = detourVerdict(net, th.worth, th.borderline);
          expect(["worth", "borderline", "not_worth"]).toContain(verdict);
          // Äquivalent zur Server-Form: worth_it = net ≥ worth_th,
          // borderline = borderline_th ≤ net < worth_th.
          expect(verdict === "worth").toBe(net >= th.worth);
          expect(verdict === "borderline").toBe(
            net >= th.borderline && net < th.worth,
          );
          expect(verdict === "not_worth").toBe(net < th.borderline);
        },
      ),
      RUNS,
    );
  });

  it("ist monoton im Netto-Vorteil", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -20, max: 20, noNaN: true }),
        fc.double({ min: -20, max: 20, noNaN: true }),
        thresholds(),
        (a, b, th) => {
          const lo = detourVerdict(Math.min(a, b), th.worth, th.borderline);
          const hi = detourVerdict(Math.max(a, b), th.worth, th.borderline);
          expect(rank[hi]).toBeGreaterThanOrEqual(rank[lo]);
        },
      ),
      RUNS,
    );
  });

  it("trifft die Ränder exakt (≥, nicht >)", () => {
    fc.assert(
      fc.property(thresholds(), (th) => {
        expect(detourVerdict(th.worth, th.worth, th.borderline)).toBe("worth");
        expect(detourVerdict(th.borderline, th.worth, th.borderline)).toBe(
          th.worth > th.borderline ? "borderline" : "worth",
        );
        // Knapp unter der Borderline-Schwelle ist nie „borderline“.
        expect(
          detourVerdict(th.borderline - 1e-6, th.worth, th.borderline),
        ).toBe("not_worth");
      }),
      RUNS,
    );
  });

  it("gleiche Schwellen kennen nur worth oder not_worth", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 10, noNaN: true }),
        fc.double({ min: -20, max: 20, noNaN: true }),
        (threshold, net) => {
          const verdict = detourVerdict(net, threshold, threshold);
          expect(verdict).not.toBe("borderline");
          expect(verdict === "worth").toBe(net >= threshold);
        },
      ),
      RUNS,
    );
  });

  it("verschiebt die Grenze mit den Schwellen, nicht mit der Rechnung", () => {
    fc.assert(
      fc.property(input(), thresholds(), (i, th) => {
        const net = detourEconomics(i).netEur;
        const verdict = detourVerdict(net, th.worth, th.borderline);
        // Derselbe Umweg ist mit strengerer Schwelle nie besser eingestuft.
        const stricter = detourVerdict(net, th.worth + 1, th.borderline + 1);
        expect(rank[stricter]).toBeLessThanOrEqual(rank[verdict]);
      }),
      RUNS,
    );
  });
});
