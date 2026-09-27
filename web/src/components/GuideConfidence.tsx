// Sicherheit als drei Balken (M3) statt einer Prozentzahl.
//
// „Prognose-Konfidenz: 87 %“ behauptet eine Genauigkeit, die niemand
// nachprüft, und liest sich wie eine Messung. Drei Balken mit einem Wort
// sind in derselben Sekunde erfasst — und die Feinheit, die das Modell
// nicht hat, wird gar nicht erst behauptet. Der Begleitsatz nennt die
// gemessene Trefferzahl; ohne Messung steht der Lernstand (`guide.ts`).

import { CONFIDENCE_TEXT, confidenceStage, type ConfidenceStage } from "../guide";

export interface GuideConfidenceProps {
  /** Gemessene Sicherheit in Prozent (Server) — `null` = nicht gemessen. */
  percent: number | null;
  /** Zusätzlicher Satz mit der Zählung (z. B. „An 26 von 30 Tagen …“). */
  sentence?: string | null;
  /** Auf dunkler Fläche (Urteilskarte) bleiben die leeren Balken sichtbar. */
  onTone?: boolean;
  className?: string;
}

export function GuideConfidence({
  percent,
  sentence = null,
  onTone = false,
  className = "",
}: GuideConfidenceProps) {
  const stage: ConfidenceStage = confidenceStage(percent);
  const word = CONFIDENCE_TEXT[stage];
  return (
    <span
      className={`inline-flex items-center gap-2 text-xs font-semibold ${className}`}
      title="So sicher ist die Empfehlung"
    >
      {/* Drei Balken steigender Höhe: gefüllt = Stufe. Dekorativ, weil das
          Wort daneben dieselbe Aussage trägt (V4: kein Zeichen als Text). */}
      <span className="flex items-end gap-[2px]" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={`w-[4px] rounded-full ${
              i <= stage
                ? "bg-current"
                : onTone
                  ? "bg-current opacity-30"
                  : "bg-slate-600"
            }`}
            style={{ height: 5 + i * 3 }}
          />
        ))}
      </span>
      <span>
        {word}
        {sentence ? <span className="font-normal opacity-80"> · {sentence}</span> : null}
      </span>
    </span>
  );
}
