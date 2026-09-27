// Persönliches Tankprofil — der Rechner im Labor.
//
// Tankmenge und Wartebereitschaft steuern die Rechnung, nicht das Modell:
// sie verändern, **welche** Fenster überhaupt in Frage kommen. „Nie“ lässt
// nur den Preis jetzt gelten, „Bis 2 Std.“ nur die Fenster der nächsten
// zwei Stunden, „Flexibel“ den ganzen Tag. Das Ergebnis steht als Betrag
// pro Tankfüllung darunter — dieselbe Rechnung wie im Guide.
//
// Der Slider ist eine **Vorschau**: Das echte Profil mit Tankgröße und
// Verbrauch liegt in „Ich → Profil“ und bleibt von diesem Rechner
// unangetastet. Beides zu vermischen hätte zwei Wahrheiten für eine Zahl
// bedeutet.

import { useMemo } from "react";
import { fillAmount, perFillText } from "../guide";
import { deTrimmed, euro, timeOfDayLabel } from "../data";
import { savingPerLiterCt } from "../now";
import { panel, radius } from "./ui";

export type WaitReadiness = "never" | "twoHours" | "flexible";

export const READINESS_OPTIONS: ReadonlyArray<{
  id: WaitReadiness;
  label: string;
}> = [
  { id: "never", label: "Nie" },
  { id: "twoHours", label: "Bis 2 Std." },
  { id: "flexible", label: "Flexibel" },
];

export interface LabProfileProps {
  liters: number;
  onLiters: (liters: number) => void;
  readiness: WaitReadiness;
  onReadiness: (value: WaitReadiness) => void;
  /** Fenster des Tages (`windows_today`) — die echte Prognose. */
  windows: Array<{ start: string; expected_price: number | null }> | null;
  /** Preis an der empfohlenen Station jetzt. */
  priceNow: number | null;
  /** Jetzt (ms) — für das 2-Stunden-Fenster. */
  now: number;
  /** Belege der letzten 30 Tage (echte Zahl) für die Hochrechnung. */
  fills30d?: number | null;
  min?: number;
  max?: number;
}

/** Welche Fenster die eingestellte Wartebereitschaft überhaupt zulässt. */
export function eligibleWindows(
  windows: LabProfileProps["windows"],
  readiness: WaitReadiness,
  now: number,
): Array<{ start: string; expected_price: number }> {
  const usable = (windows ?? []).filter(
    (w): w is { start: string; expected_price: number } =>
      w.expected_price !== null && Number.isFinite(w.expected_price),
  );
  if (readiness === "never") return [];
  const until =
    readiness === "twoHours" ? now + 2 * 60 * 60 * 1000 : Number.POSITIVE_INFINITY;
  return usable.filter((w) => {
    const start = Date.parse(w.start);
    return Number.isFinite(start) && start >= now && start <= until;
  });
}

export function LabProfile({
  liters,
  onLiters,
  readiness,
  onReadiness,
  windows,
  priceNow,
  now,
  fills30d = null,
  min = 10,
  max = 100,
}: LabProfileProps) {
  const result = useMemo(() => {
    const options = eligibleWindows(windows, readiness, now);
    if (options.length === 0 || priceNow === null) return null;
    const best = options.reduce((acc, w) =>
      w.expected_price < acc.expected_price ? w : acc,
    );
    const centDiff = savingPerLiterCt(priceNow, best.expected_price);
    if (centDiff === null) return null;
    const amount = fillAmount(centDiff, liters);
    return {
      at: timeOfDayLabel(best.start),
      amount,
      perFill: perFillText(amount),
    };
  }, [windows, readiness, now, priceNow, liters]);

  return (
    <section className={`${panel} p-4`} aria-labelledby="lab-profile-title">
      <h2 id="lab-profile-title" className="text-sm font-semibold text-slate-100">
        Persönliches Tankprofil
      </h2>
      <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
        Tankmenge und Wartebereitschaft ändern die Rechnung — nicht das Modell.
      </p>

      <label className="mt-3 block">
        <span className="flex items-baseline justify-between text-xs text-slate-400">
          <span>Tankmenge</span>
          <span className="font-semibold text-slate-100 tabular-nums">
            {deTrimmed(liters, 0)} Liter
          </span>
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={liters}
          onChange={(event) => onLiters(Number(event.target.value))}
          aria-valuetext={`${deTrimmed(liters, 0)} Liter`}
          className="mt-1.5 w-full accent-emerald-400"
        />
      </label>

      <div
        className="mt-3 grid grid-cols-3 gap-1 rounded-lg border border-slate-800 bg-slate-950/40 p-1"
        role="radiogroup"
        aria-label="Wartebereitschaft"
      >
        {READINESS_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={readiness === option.id}
            onClick={() => onReadiness(option.id)}
            className={`${radius.control} px-2 py-1.5 text-xs font-semibold transition-colors ${
              readiness === option.id
                ? "bg-slate-800 text-emerald-300"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <p className="mt-3 text-sm leading-relaxed text-slate-200">
        {result === null || result.amount === null
          ? readiness === "never"
            ? "Ohne Warten keine Ersparnis — dann zählt der günstigste Preis in der Nähe."
            : "Kein passendes Fenster für diese Einstellung — der Guide bleibt bei „jetzt“."
          : result.perFill
            ? `${result.at ? `Bis ${result.at} Uhr: ` : ""}${result.perFill}.`
            : "Keine belastbare Differenz für diese Einstellung."}
      </p>
      {result && result.amount !== null && fills30d !== null && fills30d > 0 && (
        <p className="mt-1 text-xs text-slate-400">
          Hochgerechnet aus {fills30d}{" "}
          {fills30d === 1 ? "Beleg" : "Belegen"} in 30 Tagen: ca.{" "}
          {euro(result.amount * fills30d * 12)} € im Jahr.
        </p>
      )}
      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        Vorschau für diesen Rechner. Das echte Profil mit Tankgröße und
        Verbrauch liegt in „Ich → Profil“.
      </p>
    </section>
  );
}
