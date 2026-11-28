# GUI-Vorlagen: gestalterische Leitplanken

> Stand: 28.11.2026 · App-Version 0.78.0. `sample/good gui` und der frühere
> Prototyp `web/src/concept/` sind entfernt (UI-Konsolidierung, 0.78.0). Die
> übernommenen Leitplanken stehen hier; der ausführbare Stand ist die Live-App
> unter `/` mit den Bereichen aus [UI](UI.md).

## Inhaltsverzeichnis

- [Herkunft und Übernahme](#herkunft-und-übernahme)
- [Visuelle Leitplanken](#visuelle-leitplanken)
- [Design und Daten getrennt](#design-und-daten-getrennt)
- [Prüfung](#prüfung)

## Herkunft und Übernahme

Die Vorlagen `sample/good gui` (Smartphone-Mockup mit UX-Panel) und der daraus
abgeleitete Prototyp `web/src/concept/` waren die gestalterische Basis der
Material-You-Oberfläche. Mit der UI-Konsolidierung (0.78.0) gibt es **eine**
Oberfläche: Der `?konzept=1`-Einstieg, der Prototyp-Chunk und die Demo-Daten
sind entfernt. Die übernommenen Regeln sind in `web/src/styles.css` (M3-Token
`m3-now`, `m3-relaxed`, `m3-wait`, `m3-neutral`, `m3-chip-*`), in
`web/src/components/ui.tsx` und in den Views umgesetzt.

Die ältere Referenz `sample/good statistic gui` lag nie in einem Commit dieses
Repositories ([LUECKEN](../planung/LUECKEN.md#bewusste-grenzen)).

## Visuelle Leitplanken

- Helles Material You: Primary `#006c4c`, Mint `#89f8c7`, Error `#ba1a1a`,
  Rosa `#ffdad6`, Tertiary `#3d6373`, Eisblau `#c1e8fb`, Warnung `#7c5800`
  auf `#ffdea3`. Surface-Rampe Weiß bis `#e4eae3`.
- Material-3-Karten, Filter-Chips, Segmented Buttons, Navigation Bar, Bottom
  Sheet und Extended FAB. SVG-Diagramme bleiben ohne externe Chart-Runtime —
  `web/src/components/LineChart.tsx` und `DayCurve.tsx` zeichnen selbst.
- Tailwind und Lucide für Komponenten; Framer Motion für Übergänge. Reduzierte
  Bewegung wird respektiert (`prefers-reduced-motion`).
- Signalfarben tragen Bedeutung, nicht Dekoration: `emerald` = günstig/handeln,
  `sky` = warten, `rose` = Tankrest-Risiko. Neutrale Metadaten bleiben gedämpft.

## Design und Daten getrennt

- Keine Demo-Preise, keine erfundenen Entscheidungen, keine Seeds: Jede Ansicht
  liest die API-Antworten aus `web/src/state/overview.tsx`.
- Fehlt eine Zahl, steht „—“ mit Grund — nicht 0 und nicht geschätzt
  ([MICROCOPY](MICROCOPY.md) §3).
- Die Tageskurve zeigt gemessene Stunden; leere Stunden bleiben Lücken.

## Prüfung

- `web/src/a11y.test.ts`, `web/src/microcopy.test.ts` und die View-Tests halten
  die Leitplanken (Kontraste, Anführungszeichen, Formatter, Streichlisten).
- `web/e2e/app.spec.ts`, `decision.spec.ts`, `horizons.spec.ts` und
  `mobile.spec.ts` prüfen Navigation, Zustände und Layout im echten Browser.
- Lokaler Browser benötigt die üblichen Systembibliotheken und Schriften.
  Fehlt die in `styles.css` bevorzugte Roboto-Schrift, kann die abweichende
  Fallback-Metrik den bestehenden Scrollhöhenratchet verändern. Keine Grenzwerte
  lockern, um eine abweichende Testumgebung zu kaschieren.
