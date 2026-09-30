// Preisniveau-Termine im Sichtfeld der Prognose (Tankrabatt, Rabatt-Ende).
//
// Die Engine rechnet nicht mit dem angekündigten Betrag — sie markiert die
// Kante nur (`engine/regimes.py`). Eine Prognose, die den Stichtag überspannt,
// trägt das alte Niveau weiter; „günstiger als jetzt“ über die Kante hinweg ist
// dann kein Modellurteil. Der Server meldet den nächsten Termin als
// `regime_notice` (`app/gate_context.py::regime_notice_for`), diese Datei macht
// daraus den Text. Reine Logik, ohne DOM (D1).

import { deTrimmed, type DecideResult } from "./data";

export type RegimeNotice = NonNullable<DecideResult["regime_notice"]>;

export type RegimeNoticeCopy = {
  title: string;
  body: string;
  /** Senkung (gut für den Tank) oder Anhebung (Warnung). */
  direction: "down" | "up";
};

/** „01.10.“ — Kalendertag der Kante in Berliner Zeit. */
export function regimeDateLabel(notice: Pick<RegimeNotice, "at">): string {
  const ms = Date.parse(notice.at);
  if (!Number.isFinite(ms)) return "—";
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(ms));
}

/**
 * Text des Hinweises — `null` ohne gültigen Termin. Drei ehrliche Aussagen:
 * was kommt, was die Prognose davon nicht weiß, was stattdessen zählt.
 */
export function regimeNoticeCopy(
  notice: RegimeNotice | null | undefined,
): RegimeNoticeCopy | null {
  if (!notice || !Number.isFinite(notice.announced_ct) || notice.announced_ct === 0)
    return null;
  if (notice.phase !== "upcoming" && notice.phase !== "recent") return null;
  const date = regimeDateLabel(notice);
  const amount = `${deTrimmed(Math.abs(notice.announced_ct), 0)} ct/L`;
  const down = notice.announced_ct < 0;

  if (notice.phase === "recent") {
    return {
      direction: down ? "down" : "up",
      title: down
        ? `Tankrabatt seit ${date}: bis zu ${amount} weniger`
        : `Preissprung seit ${date}: bis zu ${amount} mehr`,
      body:
        "Die Prognose lernt das neue Preisniveau erst aus neuen Daten — bis dahin können Fenster und Abstände danebenliegen. " +
        "Stationen geben den Schritt unterschiedlich schnell weiter: Verlass dich auf die aktuellen Preise in „Stationen“.",
    };
  }
  return {
    direction: down ? "down" : "up",
    title: down
      ? `Tankrabatt ab ${date}: bis zu ${amount} weniger`
      : `Preissprung ab ${date}: bis zu ${amount} mehr`,
    body: down
      ? "Die Prognose kennt den Rabatt noch nicht — Fenster ab dem Stichtag und „günstiger als jetzt“ rechnen mit dem alten Preisniveau. " +
        "Reicht der Tank, lohnt Warten bis nach dem Stichtag; nicht jede Station gibt den Rabatt sofort weiter, der Preis an der Säule entscheidet."
      : "Die Prognose kennt den Schritt noch nicht — Preise ab dem Stichtag liegen vermutlich höher als die Fenster zeigen. " +
        "Wenn es passt, lieber vorher tanken.",
  };
}

/**
 * Liegt (ein Teil von) einem Fenster hinter einer **bevorstehenden** Kante?
 * Dann vergleicht „günstiger als jetzt“ zwei Preisniveaus, die das Modell nicht
 * kennt — Abstand und Ersparnis stehen für so ein Fenster nicht als Zahl.
 * Nach der Kante (`recent`) liegen Fenster und aktueller Preis wieder auf
 * demselben Niveau; dort warnt nur der Banner.
 */
export function windowPastRegimeEdge(
  window: { end: string } | null | undefined,
  notice: RegimeNotice | null | undefined,
): boolean {
  if (!window || !notice || notice.phase !== "upcoming") return false;
  const edge = Date.parse(notice.at);
  const end = Date.parse(window.end);
  return Number.isFinite(edge) && Number.isFinite(end) && end >= edge;
}
