// Labor: die freiwilligen Blöcke des „Tankklar“-Entwurfs.
//
// Vier Bausteine, die niemand braucht, um zu tanken — aber jeder, der
// wissen will, **warum** die App das sagt:
//
//   ① Was den Preis gerade bewegt   — Einflüsse mit Richtung
//   ② Treffsicherheit                — ein Punkt je Empfehlung
//   ③ Persönliches Tankprofil        — Tankmenge × Wartebereitschaft
//   ④ Experimente                    — Beta-Ideen, einzeln abschaltbar
//
// Sie stehen in einer eigenen Datei, weil der Labor-Überblick sonst zur
// Sammelakte würde: Diese Blöcke tragen ihren **eigenen** Zustand
// (lokale Voreinstellungen), der Überblick trägt den des Servers.
//
// Ehrlichkeitsregel: Jeder Balken braucht einen Messwert. Was die App
// nicht messen kann, steht sichtbar daneben — mit dem Grund, ohne Balken.

import { useEffect, useMemo, useState } from "react";
import { LabAccuracy } from "../../components/LabAccuracy";
import {
  LabExperiments,
  type ExperimentId,
} from "../../components/LabExperiments";
import {
  LabProfile,
  type WaitReadiness,
} from "../../components/LabProfile";
import { PriceDrivers } from "../../components/PriceDrivers";
import { priceDrivers } from "../../guide";
import { useOverview } from "../../state/overview";

/**
 * Lokale Voreinstellungen — bewusst ohne Server.
 *
 * Der Rechner und die Experimente sind Ansichtssache; sie wandern nicht ins
 * Profil und nicht in die API. `localStorage` kann in privaten Fenstern
 * fehlen (oder voll sein), deshalb ist jeder Zugriff abgesichert: Ein
 * fehlender Speicher darf das Labor nicht zum Absturz machen.
 */
function readValue(key: string, allowed: readonly string[]): string | null {
  try {
    const value = window.localStorage.getItem(key);
    return value !== null && allowed.includes(value) ? value : null;
  } catch {
    return null;
  }
}

function readNumber(key: string, fallback: number): number {
  try {
    const stored = window.localStorage.getItem(key);
    const value = stored === null ? Number.NaN : Number(stored);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Kein Speicher — die Einstellung gilt dann nur für diese Sitzung. */
  }
}

const READINESS_VALUES = ["never", "twoHours", "flexible"] as const;

export function LabBetaBlocks() {
  const ov = useOverview();
  const { best, browserOnline, decideRes, liters, span, stripCells } = ov;

  const [litersPref, setLitersPref] = useState(() =>
    readNumber("tankapp.lab.liters", 45),
  );
  const [readiness, setReadiness] = useState<WaitReadiness>(() => {
    const stored = readValue("tankapp.lab.readiness", READINESS_VALUES);
    return (stored as WaitReadiness | null) ?? "flexible";
  });
  const [experiments, setExperiments] = useState<Record<ExperimentId, boolean>>(
    () => ({
      weekOutlook: readValue("tankapp.lab.exp.weekOutlook", ["1"]) === "1",
      detourCalc: readValue("tankapp.lab.exp.detourCalc", ["1"]) === "1",
      smartAlarm: readValue("tankapp.lab.exp.smartAlarm", ["1"]) === "1",
    }),
  );

  useEffect(() => {
    writeValue("tankapp.lab.liters", String(litersPref));
  }, [litersPref]);
  useEffect(() => {
    writeValue("tankapp.lab.readiness", readiness);
  }, [readiness]);
  useEffect(() => {
    for (const [id, on] of Object.entries(experiments)) {
      writeValue(`tankapp.lab.exp.${id}`, on ? "1" : "0");
    }
  }, [experiments]);

  /**
   * „Was den Preis gerade bewegt“: nur mit echten Messwerten — der
   * Tagesspielraum kommt aus dem Tagesstreifen, die Spanne aus den
   * beobachteten Stationen. `decideRes` kann im Labor fehlen (eigener
   * Zweig im Überblick), deshalb defensiv gelesen.
   */
  const dayValues = (stripCells ?? [])
    .map((cell) => cell.value)
    .filter((value): value is number => value !== null);
  const drivers = useMemo(
    () =>
      priceDrivers({
        nowPrice: best ? ov.price(best) : null,
        dayMin: dayValues.length ? Math.min(...dayValues) : null,
        dayMax: dayValues.length ? Math.max(...dayValues) : null,
        // `span` ist der Abstand günstigste → teuerste Station als Betrag auf
        // die **Profilmenge** — zurückgerechnet in Cent je Liter.
        spreadCt: span !== null && liters > 0 ? (span / liters) * 100 : null,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [best, dayValues.length, span, liters],
  );
  const personal = decideRes?.data?.personal_stats ?? null;
  const windows = decideRes?.data?.windows_today ?? null;

  return (
    <>
      <div className="mt-4">
        <PriceDrivers drivers={drivers} />
      </div>
      <div className="mt-4">
        <LabAccuracy
          hits={personal?.advice?.last_30d_hits ?? null}
          ties={personal?.advice?.last_30d_ties ?? null}
          total={personal?.advice?.last_30d_total ?? null}
          savedEur30d={personal?.wallet?.saved_eur_30d ?? null}
          fills30d={personal?.wallet?.fills_30d ?? null}
        />
      </div>
      <div className="mt-4">
        <LabProfile
          liters={litersPref}
          onLiters={setLitersPref}
          readiness={readiness}
          onReadiness={setReadiness}
          windows={windows}
          priceNow={best ? ov.price(best) : null}
          now={Date.now()}
          fills30d={personal?.wallet?.fills_30d ?? null}
        />
      </div>
      <div className="mt-4">
        <LabExperiments
          active={experiments}
          online={browserOnline}
          onToggle={(id, next) =>
            setExperiments((current) => ({ ...current, [id]: next }))
          }
        />
      </div>
    </>
  );
}
