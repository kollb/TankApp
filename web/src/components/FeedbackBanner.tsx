// TEXT-BEFUND T2: Der Aktions-Kanal hatte **ein** Aussehen für alle Meldungen
// — grün mit Häkchen, auch wenn „Speichern fehlgeschlagen“ darin stand. Ein
// Fehler im Erfolgs-Gewand ist schlimmer als gar keine Rückmeldung.
//
// Deshalb trägt jede Meldung jetzt ihren Ton mit sich:
//   ok    — gespeichert/übertragen (grün, Häkchen, role="status")
//   warn  — vorgemerkt, aber noch nicht auf dem Server (amber, role="status")
//   error — fehlgeschlagen (rose, Warnzeichen, role="alert")
//
// Die Texte selbst tragen kein `✓`/`!` mehr: Das Icon sagt es bereits, eine
// dreifache Kodierung derselben Aussage liest niemand (MICROCOPY §1).

import { AlertTriangle, CheckCircle2 } from "lucide-react";

/** Ton der Rückmeldung — entscheidet Farbe, Icon und ARIA-Rolle. */
export type FeedbackTone = "ok" | "warn" | "error";

export type ActionFeedback = {
  tone: FeedbackTone;
  text: string;
};

const TONE = {
  ok: {
    box: "border-emerald-500/30 bg-emerald-500/15 text-emerald-200",
    icon: "text-emerald-400",
    role: "status" as const,
  },
  warn: {
    box: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    icon: "text-amber-400",
    role: "status" as const,
  },
  error: {
    box: "border-rose-500/30 bg-rose-500/10 text-rose-200",
    icon: "text-rose-400",
    role: "alert" as const,
  },
};

/**
 * Banner für die Rückmeldung einer Aktion (Beleg buchen, Auswahl speichern,
 * Intent, Storno, Queue-Flush). Ohne Meldung rendert es nichts.
 */
export function FeedbackBanner({
  feedback,
  className = "mb-6",
}: {
  feedback: ActionFeedback | null;
  className?: string;
}) {
  if (!feedback) return null;
  const tone = TONE[feedback.tone];
  const Icon = feedback.tone === "ok" ? CheckCircle2 : AlertTriangle;
  return (
    <div
      role={tone.role}
      className={`${className} flex items-start gap-3 rounded-xl border p-4 text-sm font-semibold shadow-lg ${tone.box}`}
    >
      <Icon size={18} className={`mt-0.5 shrink-0 ${tone.icon}`} />
      <p>{feedback.text}</p>
    </div>
  );
}
