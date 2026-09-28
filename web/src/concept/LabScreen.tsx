import { radius } from "../components/ui";
import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  FlaskConical,
  Info,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  WifiOff,
} from "lucide-react";
import { euro, euroPerLiter, countLabel } from "../data";
import {
  curves,
  fuelOffset,
  hours,
  type Level,
  type Fuel,
  type Verdict,
} from "./data";
import { Anno, SectionTitle } from "./ui";
import {
  experiments,
  profileSavings,
  usePrototypeState,
  type Toast,
} from "./state";

type Props = {
  level: Level;
  verdict: Verdict;
  fuel: Fuel;
  annotate: boolean;
  onToast: (toast: Toast) => void;
  retry: () => void;
  retrying: boolean;
};
export default function LabScreen({
  level,
  verdict,
  fuel,
  annotate,
  onToast,
  retry,
  retrying,
}: Props) {
  const [liters, setLiters] = usePrototypeState(
    "liters",
    45,
    (x): x is number => typeof x === "number" && x >= 20 && x <= 80,
  );
  const [patience, setPatience] = usePrototypeState(
    "patience",
    2,
    (x): x is number => typeof x === "number" && [0, 1, 2].includes(x),
  );
  const [enabled, setEnabled] = usePrototypeState<boolean[]>(
    "experiments",
    [false, false, false],
    (x): x is boolean[] =>
      Array.isArray(x) &&
      x.length === 3 &&
      x.every((v) => typeof v === "boolean"),
  );
  const [point, setPoint] = useState<number | null>(null);
  const offline = level === "offline";
  const full = level === "full";
  const curve = (level === "noForecast" ? curves.wait : curves[verdict]).map(
    (v) => v + fuelOffset[fuel],
  );
  const min = Math.min(...curve),
    max = Math.max(...curve);
  const best = curve.indexOf(min);
  const selected = point ?? best;
  const x = (i: number) => 34 + i * 33;
  const y = (p: number) => 125 - ((p - min) / Math.max(0.1, max - min)) * 65;
  const path = curve.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p)}`).join(" ");
  const area = `${curve.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p) - 7 - i * 2.5}`).join(" ")} ${[
    ...curve,
  ]
    .reverse()
    .map((p, j) => {
      const i = curve.length - 1 - j;
      return `L${x(i)},${y(p) + 7 + i * 2.5}`;
    })
    .join(" ")} Z`;
  const saving = profileSavings(liters, patience);
  const color = offline ? "#707973" : "#006c4c";
  return (
    <div className="space-y-4 px-4 pb-4 pt-3">
      <header className="relative pb-1">
        <Anno n={1} show={annotate} />
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-medium text-primary">
            <FlaskConical size={18} /> Ein Blick unter die Haube
          </span>
          <span className="rounded-lg bg-tertiary-container px-2 py-1 text-xs font-bold tracking-wider text-tertiary">
            BETA
          </span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Labor</h1>
        <p className="mt-2 text-sm leading-5 text-on-surface-variant">
          Kein blindes Vertrauen. Entdecke, wie unsere Empfehlung entsteht.
        </p>
      </header>
      {!full && (
        <section
          className={`${radius.card} p-3 text-sm ${offline ? "bg-warn-container text-on-warn-container" : "bg-sc-high text-on-surface"}`}
        >
          <p className="flex items-center gap-2 font-semibold">
            {offline ? <WifiOff size={16} /> : <Info size={16} />}
            {offline
              ? "Du bist offline. Stand: 14:32 Uhr."
              : "Die Prognose macht gerade Pause."}
          </p>
          <p className="mt-1">
            {offline
              ? "Gespeicherte Beispielwerte, keine aktuelle Prognose."
              : "Du siehst einen typischen Verlauf, keine Vorhersage."}
          </p>
          <button
            disabled={retrying}
            onClick={retry}
            className="mt-2 flex items-center gap-2 rounded-full px-2 py-2 font-semibold"
          >
            {retrying ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            {retrying ? "Verbinde …" : "Erneut versuchen"}
          </button>
        </section>
      )}
      <section className="relative rounded-3xl bg-sc-lowest p-4 elev-1">
        <Anno n={2} show={annotate} />
        <SectionTitle
          title={
            full
              ? "Prognose mit Spielraum"
              : offline
                ? "Letzte Prognose · 14:32 Uhr"
                : "Typischer Verlauf"
          }
          sub={
            full
              ? "Ein Tipp, kein Versprechen."
              : "Orientierung statt Live-Vorhersage"
          }
        />
        <div
          className={`${radius.inset} bg-sc-low px-3 py-2 text-xs`}
          aria-live="polite"
        >
          {hours[selected]}
          {selected > 0 ? " Uhr" : ""} ·{" "}
          <strong>{euroPerLiter(curve[selected])}</strong>
          {selected === best ? " · Tiefpunkt" : ""}
        </div>
        <svg
          viewBox="0 0 332 192"
          className="mt-2 w-full"
          role="group"
          aria-label="Preisverlauf: Zeitpunkt auswählen"
        >
          <title>
            Preisverlauf mit 80-%-Wahrscheinlichkeitsbereich P10–P90
          </title>
          {[55, 90, 125, 160].map((pos) => (
            <line
              key={pos}
              x1="26"
              x2="310"
              y1={pos}
              y2={pos}
              stroke="#dfe7df"
              strokeDasharray="3 4"
            />
          ))}
          <path d={area} fill={color} opacity={full ? 0.14 : 0.07} />
          <path
            d={path}
            fill="none"
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={!full && !offline ? "6 5" : undefined}
          />
          <g
            aria-hidden="true"
            pointerEvents="none"
            transform={`translate(${Math.max(71, Math.min(261, x(best)))},${y(min) - 27})`}
          >
            <rect x="-52" y="-14" width="104" height="23" rx="8" fill={color} />
            <text x="0" y="1" textAnchor="middle" fill="#ffffff" fontSize="12">
              Tief · {euro(min, 3)} €
            </text>
          </g>
          {curve.map((p, i) => (
            <g
              key={i}
              role="button"
              tabIndex={0}
              aria-label={`${hours[i]}${i ? " Uhr" : ""}: ${euroPerLiter(p)}`}
              onClick={() => setPoint(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setPoint(i);
                }
              }}
              style={{ cursor: "pointer" }}
            >
              <rect
                x={x(i) - 16}
                y="20"
                width="32"
                height="172"
                fill="transparent"
              />
              <circle
                cx={x(i)}
                cy={y(p)}
                r={selected === i ? 5 : 2.5}
                fill={color}
                stroke="white"
                strokeWidth="2"
              />
              <text
                x={x(i)}
                y="186"
                textAnchor="middle"
                fontSize="10"
                fill="#404943"
              >
                {hours[i]}
              </text>
            </g>
          ))}
        </svg>
        <div className="flex flex-wrap gap-3 text-xs text-on-surface-variant">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-primary" />
            {full ? "Unser bester Tipp" : "Typischer Verlauf"}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded bg-primary/15" />
            80 % Spielraum
          </span>
        </div>
        <p className="mt-3 text-xs leading-4 text-on-surface-variant">
          Je weiter wir vorausblicken, desto größer der Spielraum. Tippe auf
          einen Zeitpunkt.
        </p>
      </section>
      <section className="relative rounded-3xl bg-sc-low p-4">
        <Anno n={3} show={annotate} />
        <SectionTitle
          title="Was den Preis gerade bewegt"
          sub={
            full
              ? "Fünf Einflüsse. Ein Gesamtbild."
              : "Typische Einflüsse · nicht live berechnet"
          }
        />
        <div className="space-y-3">
          {[
            { name: "Tageszeit", value: 86, down: true },
            { name: "Ölpreis", value: 55, down: false },
            { name: "Konkurrenz", value: 69, down: true },
            { name: "Wochentag", value: 36, down: true },
            { name: "Ferien", value: 25, down: false },
          ].map((f) => (
            <div key={f.name}>
              <div className="mb-1.5 flex justify-between text-xs">
                <strong>{f.name}</strong>
                <span
                  className={`flex items-center gap-1 ${offline ? "text-outline" : f.down ? "text-primary" : "text-error"}`}
                >
                  {f.down ? (
                    <ArrowDownRight size={13} />
                  ) : (
                    <ArrowUpRight size={13} />
                  )}
                  {f.down ? "drückt den Preis" : "treibt den Preis"}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-outline-variant/35">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${f.value}%` }}
                  transition={{ duration: 0.6 }}
                  className={`h-full rounded-full ${offline ? "bg-outline" : f.down ? "bg-primary" : "bg-error"}`}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="relative rounded-3xl bg-sc-lowest p-4 elev-1">
        <Anno n={4} show={annotate} />
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">
          Rückblick · Beispielmonat
        </p>
        <h2 className="text-xl font-semibold leading-6">
          An 26 von 30 Tagen lagen wir richtig
        </h2>
        <div
          className="my-4 grid grid-cols-10 gap-2"
          role="img"
          aria-label="26 Treffer und 4 Fehltreffer"
        >
          {Array.from({ length: 30 }, (_, i) => (
            <span
              key={i}
              className={`grid grid-cols-1 aspect-square place-items-center rounded-full ${[4, 12, 19, 27].includes(i) ? "bg-sc-highest" : "bg-primary-container text-primary"}`}
            >
              {![4, 12, 19, 27].includes(i) && <Check size={12} />}
            </span>
          ))}
        </div>
        <p className="text-sm text-on-surface-variant">
          Im Beispiel <strong className="text-primary">{euro(18.4)} €</strong>{" "}
          gespart. Keine nachgewiesene Modellgüte.
        </p>
      </section>
      <section className="relative rounded-3xl border border-primary/20 bg-primary-container/25 p-4">
        <Anno n={5} show={annotate} />
        <SectionTitle
          title="Dein Tankprofil"
          action={<SlidersHorizontal size={19} className="text-primary" />}
          sub="So viel könnte Warten dir bringen."
        />
        <label
          htmlFor="tank-liters"
          className="flex justify-between text-sm font-medium"
        >
          Tankmenge{" "}
          <strong className="text-primary">{countLabel(liters)} Liter</strong>
        </label>
        <input
          id="tank-liters"
          className="my-4 w-full accent-[#006c4c]"
          type="range"
          min="20"
          max="80"
          step="1"
          value={liters}
          onChange={(e) => setLiters(Number(e.target.value))}
        />
        <p className="mb-2 text-xs text-on-surface-variant">
          Wie lange kannst du warten?
        </p>
        <div
          className="flex overflow-hidden rounded-full border border-outline"
          role="group"
          aria-label="Wartebereitschaft"
        >
          {["Nie", "Bis 2 Std.", "Flexibel"].map((label, i) => (
            <button
              key={label}
              aria-pressed={patience === i}
              onClick={() => setPatience(i)}
              className={`flex-1 px-1 py-2.5 text-xs font-medium ${patience === i ? "bg-primary text-white" : "hover:bg-sc"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2" aria-live="polite">
          <div>
            <p className="text-2xl font-semibold text-primary">
              {euro(saving.filling)} €
            </p>
            <p className="text-xs text-on-surface-variant">pro Füllung</p>
          </div>
          <div className="border-l border-primary/20 pl-4">
            <p className="text-2xl font-semibold text-primary">
              {euro(saving.annual, 0)} €
            </p>
            <p className="text-xs text-on-surface-variant">
              hochgerechnet pro Jahr
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-4 text-on-surface-variant">
          Beispielrechnung: 24 Füllungen/Jahr; je nach Wartezeit 0, 3,5 oder 8
          ct/L. Keine Spargarantie. Nur lokal gespeichert.
        </p>
      </section>
      <section className="relative rounded-3xl bg-sc-lowest p-4 elev-1">
        <Anno n={6} show={annotate} />
        <SectionTitle
          title="Experimente"
          sub="Neugierig? Probier etwas Neues."
          action={<Sparkles size={19} className="text-tertiary" />}
        />
        {offline && (
          <p
            className={`mb-3 ${radius.inset} bg-warn-container p-2 text-xs text-warn`}
          >
            Zum Ändern brauchst du eine Verbindung.
          </p>
        )}
        <div className="divide-y divide-outline-variant/50">
          {experiments.map((name, i) => (
            <div
              key={name}
              className={`flex items-center justify-between gap-2 py-3 ${offline ? "opacity-45" : ""}`}
            >
              <span>
                <span className="block text-sm font-medium">{name}</span>
                <span className="text-xs text-on-surface-variant">
                  {
                    [
                      "Die nächsten 7 Tage im Blick",
                      "Lohnt sich der zusätzliche Weg?",
                      "Der richtige Preis, zur richtigen Zeit",
                    ][i]
                  }
                </span>
              </span>
              <button
                role="switch"
                aria-label={name}
                aria-checked={enabled[i]}
                disabled={offline}
                onClick={() => {
                  const previous = enabled;
                  setEnabled(enabled.map((v, j) => (j === i ? !v : v)));
                  onToast({
                    text: `${name} ${enabled[i] ? "deaktiviert" : "aktiviert"}. Nur im Prototyp.`,
                    undo: () => setEnabled(previous),
                  });
                }}
                className={`relative h-8 w-[52px] shrink-0 rounded-full border-2 ${enabled[i] ? "border-primary bg-primary" : "border-outline bg-sc-highest"}`}
              >
                <span
                  className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full transition-all ${enabled[i] ? "left-6 bg-white" : "left-1 bg-outline"}`}
                />
              </button>
            </div>
          ))}
        </div>
      </section>
      <details className="relative rounded-3xl border border-outline-variant p-4">
        <Anno n={7} show={annotate} />
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">
          Für Technik-Fans
          <ChevronDown size={18} />
        </summary>
        <dl className="mt-4 space-y-3 text-xs">
          {[
            ["Modell (Konzept)", "Gradient Boosting"],
            ["MAE (Beispiel)", "± 1,1 ct/L"],
            [
              "Datenbasis (geplant)",
              "MTS-K · Markttransparenzstelle für Kraftstoffe",
            ],
            ["Unsicherheit", "P10–P90 · 80-%-Wahrscheinlichkeitsbereich"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-on-surface-variant">{k}</dt>
              <dd className="mt-1 font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <a
          href="/?tab=labor"
          className="tap-44 mt-4 inline-block text-xs font-semibold text-primary underline"
        >
          Echte Modellparameter im Live-Labor →
        </a>
      </details>
    </div>
  );
}
