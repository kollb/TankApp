// V1 (GUI-TEXT-BEFUND): Diagramm- und Kartenfarben kennen beide Themen.
//
// Die Fläche war bis 0.41.1 dunkel verdrahtet: 64 feste Hex-Werte in
// StationMap, LabCharts, LineChart, Labor und Stationen, kein einziger
// `var(--color…)`-Zugriff. `html.light` biegt nur die Tailwind-Token um
// (styles.css) — die SVGs blieben dunkel. Sichtbare Folge: Achsentext
// `#94a3b8` auf weißer Karte ≈ 2,4:1 (AA verlangt 4,5:1), die Fadenkreuze
// `#1e293b` verschwinden auf heller Fläche.
//
// SVG-Presentations-Attribute können keine `var()`-Werte tragen, deshalb
// steht hier keine CSS-Variable, sondern **zwei Paletten** und ein Hook, der
// die aktuelle Wahl liest (dieselbe Quelle wie `applyAppTheme`: die Klasse am
// <html>-Element). Die Rollen sind benannt, nicht hexadizmal — wer eine neue
// Linie zeichnet, nimmt eine Rolle.
//
// Geprüft von `a11y.test.ts`: Jeder Textton beider Paletten hält 4,5:1 auf der
// jeweiligen Kartenfläche.

import { useEffect, useState } from "react";
import type { AppTheme } from "./data";

export type ChartPalette = {
  /** Achsen und Rahmen. */
  axis: string;
  /** Hilfslinien im Plot (Fadenkreuz, Raster). */
  grid: string;
  /** Achsenbeschriftung und Legendentext. */
  text: string;
  /** Wert im Diagramm, der hervorstechen soll (z. B. „jetzt“). */
  textStrong: string;
  /** Achsen-Ticks. */
  tick: string;
  /** Primär-Linie/-Fläche. */
  accent: string;
  /** Kontur des Akzent-Markers. */
  accentEdge: string;
  /** Günstig / erfüllt / Treffer. */
  positive: string;
  /** Ungünstig / verfehlt. */
  negative: string;
  /** Achtung / Live-Schicht / grenzwertig. */
  warn: string;
  warnSoft: string;
  /** Zweite Datenreihe (Vergleich). */
  violet: string;
  /** Fläche hinter dem Plot (Karte). */
  surface: string;
  /** Kontrastton auf `surface` (Punkt-Umrandung). */
  onSurface: string;
  /** Rahmen gedämpfter Flächen. */
  border: string;
  /** Vergleichskurve, die hinter der Hauptkurve zurücktritt. */
  marker: string;
  /** Neutrale Datenpunkte. */
  muted: string;
};

export const DARK_CHART: ChartPalette = {
  axis: "#334155",
  grid: "#1e293b",
  text: "#94a3b8",
  textStrong: "#f1f5f9",
  // #475569 wäre auf der Diagrammfläche nur 2,4:1 — auch für einen Strich
  // zu wenig (WCAG 1.4.11 verlangt 3:1). slate-500 hält 3,75:1.
  tick: "#64748b",
  accent: "#38bdf8",
  accentEdge: "#0284c7",
  positive: "#34d399",
  negative: "#fb7185",
  warn: "#f59e0b",
  warnSoft: "#fbbf24",
  violet: "#a78bfa",
  surface: "#0f172a",
  onSurface: "#ffffff",
  border: "#cbd5e1",
  marker: "#e2e8f0",
  muted: "#64748b",
};

/**
 * Helle Palette: dieselben Rollen, dunklere Töne. Jeder Textton hält ≥ 4,5:1
 * auf der hellen Kartenfläche (#ffffff) — `a11y.test.ts` prüft genau das.
 */
export const LIGHT_CHART: ChartPalette = {
  axis: "#94a3b8",
  grid: "#e2e8f0",
  text: "#475569",
  textStrong: "#0f172a",
  tick: "#64748b",
  accent: "#0369a1",
  accentEdge: "#075985",
  positive: "#047857",
  negative: "#be123c",
  warn: "#b45309",
  warnSoft: "#92400e",
  violet: "#6d28d9",
  surface: "#ffffff",
  onSurface: "#0f172a",
  border: "#334155",
  marker: "#475569",
  muted: "#475569",
};

export function chartPalette(theme: AppTheme): ChartPalette {
  return theme === "light" ? LIGHT_CHART : DARK_CHART;
}

function currentTheme(): AppTheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

/**
 * Palette der aktuellen Themen-Wahl. Hört auf denselben Umschalter wie die
 * Tailwind-Klassen (`applyAppTheme` setzt die Klasse, hier liest ein
 * MutationObserver) — Diagramm und Fläche wechseln damit im selben Frame.
 */
export function useChartPalette(): ChartPalette {
  const [theme, setTheme] = useState<AppTheme>(currentTheme);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(currentTheme());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return chartPalette(theme);
}
