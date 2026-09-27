// Was den Preis gerade bewegt (Fachwort: „Feature Importance“).
//
// Balken mit Richtung statt Shapley-Werten — und jeder Balken trägt nur,
// was die App messen kann. Faktoren ohne Datenpfad stehen **sichtbar**
// daneben, mit dem Grund und ohne Balken: Ein ausgedachter Balken wäre
// eine Erklärung, die keine ist (O18, §1).

import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import {
  DRIVER_DIRECTION_TEXT,
  type DriverDirection,
  type PriceDriver,
} from "../guide";
import { panel } from "./ui";

const ICON: Record<DriverDirection, typeof ArrowUp> = {
  down: ArrowDown,
  up: ArrowUp,
  flat: Minus,
};

const TONE: Record<DriverDirection, string> = {
  down: "text-emerald-300",
  up: "text-rose-300",
  flat: "text-slate-400",
};

const BAR: Record<DriverDirection, string> = {
  down: "bg-emerald-400/80",
  up: "bg-rose-400/80",
  flat: "bg-slate-500/70",
};

export interface PriceDriversProps {
  drivers: PriceDriver[];
  title?: string;
}

export function PriceDrivers({
  drivers,
  title = "Was den Preis gerade bewegt",
}: PriceDriversProps) {
  return (
    <section className={`${panel} p-4`} aria-labelledby="lab-drivers-title">
      <h2 id="lab-drivers-title" className="text-sm font-semibold text-slate-100">
        {title}
      </h2>
      <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
        Die stärksten Einflüsse der letzten Stunden — mit Richtung, ohne
        Fachwörter.
      </p>
      <ul className="mt-3 space-y-3">
        {drivers.map((driver) => {
          const Icon = ICON[driver.direction];
          return (
            <li key={driver.id}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-slate-200">
                  {driver.label}
                </span>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-semibold ${TONE[driver.direction]}`}
                >
                  <Icon size={13} aria-hidden="true" />
                  {DRIVER_DIRECTION_TEXT[driver.direction]}
                </span>
              </div>
              {/* Ohne Messwert kein Balken — die Fläche bleibt leer und der
                  Grund steht darunter. */}
              <div
                className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-800"
                role="presentation"
              >
                {driver.strength !== null && (
                  <div
                    className={`h-full rounded-full ${BAR[driver.direction]}`}
                    style={{ width: `${Math.round(driver.strength)}%` }}
                  />
                )}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                {driver.value ? `${driver.value}. ` : ""}
                {driver.note}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
