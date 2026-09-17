// O21 — Eine Quelle für die Score-Formel.
//
// `scoreRows` (hier) und `app/stats_summary.py::_score_rows` (Server) sind
// zwei Implementierungen derselben Formel. Sie sind bereits auseinander-
// gelaufen: die GUI rechnete `pot_share` als `sum_smart_eur / sum_best`,
// also Euro durch Cent — um den Faktor Liter/100 falsch.
//
// Beide Suiten lesen deshalb **dieselbe** Fixture
// (`tests/fixtures/score_parity.json`, geschrieben aus der Python-Seite).
// Wer die Formel ändert, muss beide Seiten ändern — sonst fällt eine Suite.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scoreRows, type EvalRowDto } from "./data";

type Case = {
  eps: number;
  liters: number;
  expected: Record<string, number | null>;
};

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../tests/fixtures/score_parity.json", import.meta.url)),
    "utf8",
  ),
) as { rows: EvalRowDto[]; cases: Case[] };

// Felder, die nur eine der beiden Seiten kennt: `station_id`/`name`/`brand`/
// `city` sind GUI-Kontext, `p_known` ist die GUI-Auskunft darüber, ob `p_avg`
// trägt (der Server liefert dort `null`).
const SHARED_FIELDS = [
  "eps",
  "liters",
  "n",
  "n_wait",
  "hit_wait",
  "n_now",
  "hit_now",
  "sum_smart_eur",
  "sum_commit_eur",
  "sum_best_eur",
  "avg_regret_ct",
  "avg_regret_eur",
  "p_avg",
  "hit_freq",
  "pot_share",
] as const;

describe("O21: scoreRows liefert dieselben Werte wie der Server", () => {
  it.each(FIXTURE.cases.map((c, i) => [i, c] as const))(
    "Fall %i (ε, Liter) stimmt mit der geteilten Fixture überein",
    (_index, testCase) => {
      const score = scoreRows(
        FIXTURE.rows,
        testCase.eps,
        testCase.liters,
        "s1",
      ) as unknown as Record<string, number | null>;
      for (const field of SHARED_FIELDS) {
        expect(score[field], field).toBe(testCase.expected[field]);
      }
    },
  );

  it("die Fixture deckt beide Tankmengen und beide Schwellen ab", () => {
    const combos = FIXTURE.cases.map((c) => `${c.eps}/${c.liters}`).sort();
    expect(combos).toEqual(["1/40", "1/60", "2.5/40", "2.5/60"]);
  });

  it("Euro-Kennzahlen skalieren mit der Tankmenge, ct-Kennzahlen nicht", () => {
    const at = (liters: number) =>
      FIXTURE.cases.find((c) => c.eps === 1 && c.liters === liters)!.expected;
    expect(at(60).sum_smart_eur).toBeCloseTo((at(40).sum_smart_eur as number) * 1.5, 6);
    expect(at(60).avg_regret_ct).toBe(at(40).avg_regret_ct);
  });

  it("pot_share ist ein Verhältnis gleicher Einheiten ( Regression des €-durch-ct-Fehlers)", () => {
    const score = scoreRows(FIXTURE.rows, 1, 60, "s1");
    const rows40 = scoreRows(FIXTURE.rows, 1, 40, "s1");
    // Ein Anteil darf nicht von der Tankmenge abhängen — genau das tat der
    // Einheitenfehler (60 L lieferten den 1,5-fachen „Anteil“).
    expect(score.pot_share).toBe(rows40.pot_share);
    expect(score.pot_share).toBeLessThanOrEqual(1);
  });

  it("der Score-Block nennt seine Parameter", () => {
    const score = scoreRows(FIXTURE.rows, 2.5, 60, "s1");
    expect(score.eps).toBe(2.5);
    expect(score.liters).toBe(60);
  });
});
