// C6 (Rest): Skeletons statt Spinner/Text-Mix.
//
// Bisher hatte jedes Panel seinen eigenen Ladezustand: mal „… wird geladen“,
// mal gar nichts, mal ein Spinner. Das Ergebnis war ein springendes Layout —
// beim ersten Laden wächst die Seite unter dem Finger weg, gerade auf dem
// Handy an der Säule. Ein Skeleton hält den Platz, den der Inhalt gleich
// braucht, und sagt per `aria-busy`, dass hier noch etwas kommt.
//
// Regeln (docs/MICROCOPY.md, Abschnitt „Zustände“):
//   - Skeleton nur für das **erste** Laden. Ein Aktualisierungs-Poll über
//     vorhandenen Daten darf die Zahlen nicht wegnehmen — sonst flackert die
//     Ansicht alle 30 s.
//   - Ein Skeleton ist nie ein Ersatz für eine Fehlermeldung: fehlgeschlagen
//     heißt `LoadError`, leer heißt `Empty`, lädt heißt `Skeleton`.
//   - Keine Animation, die `prefers-reduced-motion` ignoriert — das `pulse`
//     wird in `styles.css` global entschärft.

import { panel } from "./ui";

/** Ein grauer Balken in Textzeilen-Höhe. `w` ist eine Tailwind-Breitenklasse. */
export function SkeletonLine({
  w = "w-full",
  h = "h-3",
  className = "",
}: {
  w?: string;
  h?: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded bg-slate-800 ${h} ${w} ${className}`}
    />
  );
}

/**
 * Platzhalter für eine ganze Karte.
 *
 * `lines` bestimmt, wie viele Textzeilen angedeutet werden, `title` blendet
 * die breitere Überschriften-Zeile ein. Der sichtbare Text („wird geladen“)
 * steht nur für Screenreader im DOM — optisch trägt das Skelett.
 */
export function SkeletonPanel({
  lines = 3,
  title = true,
  label = "Inhalt wird geladen",
  className = "",
}: {
  lines?: number;
  title?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={`${panel} p-5 ${className}`}
    >
      <span className="sr-only">{label} …</span>
      {title && <SkeletonLine w="w-2/5" h="h-4" className="mb-4" />}
      <div className="space-y-2.5">
        {Array.from({ length: lines }, (_, index) => (
          <SkeletonLine
            key={index}
            // Letzte Zeile kürzer: so sieht ein Absatz aus, nicht ein Block.
            w={index === lines - 1 ? "w-3/5" : "w-full"}
          />
        ))}
      </div>
    </div>
  );
}

/** Platzhalter für ein Diagramm — hält die Höhe, damit nichts springt. */
export function SkeletonChart({
  height = "h-48",
  label = "Diagramm wird berechnet",
  className = "",
}: {
  height?: string;
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={`animate-pulse rounded-xl border border-slate-800 bg-slate-900/60 ${height} ${className}`}
    >
      <span className="sr-only">{label} …</span>
    </div>
  );
}

/** Platzhalter-Zeilen für eine Tabelle (gleiche Spaltenzahl wie das Original). */
export function SkeletonRows({
  rows = 3,
  cols = 4,
  label = "Tabelle wird geladen",
}: {
  rows?: number;
  cols?: number;
  label?: string;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <tr key={rowIndex} aria-busy="true">
          {Array.from({ length: cols }, (_, colIndex) => (
            <td key={colIndex} className="px-3 py-2.5">
              {rowIndex === 0 && colIndex === 0 && (
                <span className="sr-only">{label} …</span>
              )}
              <SkeletonLine w={colIndex === 0 ? "w-2/3" : "w-12"} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
