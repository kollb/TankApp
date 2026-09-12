// C6 (Rest): „Datenstand älter als X“ — konsistent statt panelweise erfunden.
//
// Die Ehrlichkeits-Regel (Konzept §0.4) verlangt, dass die App nicht so tut,
// als wäre eine alte Zahl aktuell. Bisher stand der Stand nur an zwei Stellen
// (Header-Zeile, Collector-Kachel); Prognose, Heatmap und Ranking zeigten ihr
// Alter gar nicht. Dieser Baustein setzt denselben Satz überall hin — die
// Schwellen und der Text kommen aus `dataAgeNote` in `data.ts` und sind dort
// getestet, damit der Ton nicht je Panel abweicht.
//
// Kein Banner bei frischen Daten: eine Zeile „alles in Ordnung“ über jedem
// Panel wäre Lärm und würde die echten Warnungen entwerten.

import { Clock } from "lucide-react";
import { dataAgeNote, type DataKind } from "../data";

export function DataAgeBanner({
  stamp,
  kind,
  now,
  className = "",
}: {
  stamp?: string | null;
  kind: DataKind;
  /** Nur für Tests / bewusst eingefrorene Uhr; sonst Date.now(). */
  now?: number;
  className?: string;
}) {
  const note = dataAgeNote(stamp, kind, now);
  if (!note) return null;
  const tone =
    note.tone === "error"
      ? "border-rose-500/25 bg-rose-950/20 text-rose-200"
      : "border-amber-500/25 bg-amber-500/10 text-amber-200";
  return (
    <p
      // `status`, nicht `alert`: Die Information ist wichtig, soll aber den
      // Screenreader nicht mitten im Satz unterbrechen.
      role="status"
      className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${tone} ${className}`}
    >
      <Clock size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{note.text}</span>
    </p>
  );
}
