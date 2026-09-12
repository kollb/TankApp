// C11: „Datenreichweite: …“ — worauf beruht das, was hier steht?
//
// Die Heatmap beantwortet diese Frage seit 0.14.0 (Fenster ≠ Bestand). Für
// Preisverlauf, Modell-Ausblick und Ranking fehlte sie: Eine 24-Stunden-Achse
// mit vier Punkten sieht genauso aus wie eine mit 288, und „Rang 1“ aus zehn
// Tagen genauso belastbar wie „Rang 1“ aus drei Monaten. Diese Zeile nennt
// Bestand, Tage und echte Spanne in Berliner Zeit — in derselben Form und mit
// derselben Beschriftung wie in der Heatmap, damit der Nutzer sie überall
// wiedererkennt.
//
// Rendert nichts, wenn der Payload keine Reichweite hergibt (Altbestand, leeres
// Ergebnis): keine Zeile ist ehrlicher als eine erfundene Spanne.

import { dataReachLabel, type DataReach } from "../data";

export function DataReachNote({
  reach,
  noun = "Preise",
  hint,
  className = "",
}: {
  reach: DataReach | null | undefined;
  /** Was gezählt wird — „Preise“, „Beobachtungen“, „5-Minuten-Preise“. */
  noun?: string;
  /** Optionaler Zusatz, z. B. woher die Zahlen stammen. */
  hint?: string;
  className?: string;
}) {
  const label = reach ? dataReachLabel(reach, noun) : null;
  if (!label) return null;
  return (
    <p
      className={`mt-3 text-[11px] leading-relaxed text-slate-400 ${className}`}
    >
      <span className="font-semibold text-slate-300">Datenreichweite:</span>{" "}
      {label}
      {hint ? <span className="block text-slate-500">{hint}</span> : null}
    </p>
  );
}
