// T8 (GUI-TEXT-BEFUND): **eine** Frische-Zeile für alle Bereiche.
//
// §4b verspricht `Preise vor 4 Minuten · Prognose vor 35 Minuten · <Ort>`.
// Fünf Ansichten bauten sich die Zeile selbst — vier davon mit eigener
// Ton-Tabelle, alle mit demselben angehängten `· kein Ort gewählt`. Wer die
// Wortform ändert, vergisst sonst vier Stellen; der Ton war schon
// auseinandergerutscht (zwei Tabellen nannten „bad“, eine „error“).
//
// Der Text kommt weiterhin aus den Frische-Funktionen (`nowFreshness`,
// `stationsFreshness`, `systemFreshness`) — die Schwellen bleiben dort, wo sie
// getestet sind (`data-age.test.ts`). Hier steht nur die eine Zeile.

import type { ReactNode } from "react";

/** Ton der Zeile — dieselben drei Stufen wie `freshness()`/`dataAgeNote`. */
export type FreshnessTone = "ok" | "warn" | "bad";

const TONE: Record<FreshnessTone, string> = {
  ok: "text-slate-500",
  warn: "text-amber-300",
  bad: "text-rose-300",
};

/** Platzhalter, wenn kein Ort gewählt ist — Satzteil, deshalb klein. */
export const NO_PLACE_LABEL = "kein Ort gewählt";

export function FreshnessLine({
  text,
  tone,
  place,
  extra,
  className = "mt-4",
}: {
  /** Der Frische-Text aus `nowFreshness`/`stationsFreshness`/`systemFreshness`. */
  text: string;
  tone: FreshnessTone;
  /** Gewählter Ort — fehlt er, steht der Platzhalter. */
  place?: string | null;
  /** Weitere Angaben derselben Zeile (z. B. Vergleichsanker im Labor). */
  extra?: ReactNode;
  className?: string;
}) {
  return (
    <p
      role="status"
      className={`text-xs leading-relaxed ${TONE[tone]} ${className}`}
    >
      {text} · {place || NO_PLACE_LABEL}
      {extra}
    </p>
  );
}
