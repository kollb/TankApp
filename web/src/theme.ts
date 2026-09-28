// Theme-Wahl: „System“ ist die Voreinstellung, Dunkel der Rückfall.
//
// Die App kannte bis 0.72.0 genau zwei Zustände (hell/dunkel) und startete
// immer hell. Dieser Baustein trennt die **Wahl** von der **Anzeige**:
//
//   * `choice = "system"` (Voreinstellung, nichts gespeichert): die Anzeige
//     folgt dem Betriebssystem und wechselt mit ihm — live.
//   * `choice = "dark" | "light"`: eine ausdrückliche Wahl, gerätelokal
//     gespeichert (Schlüssel `tankapp.theme`, wie bisher).
//
// Sagt das Betriebssystem nichts (oder ist `prefers-color-scheme` nicht
// abfragbar: alter Browser, Test-Harness), gilt **dunkel**. Das ist der
// Rückfall, nicht die Vorliebe: Wer „Hell“ will, sagt es ausdrücklich.
//
// `web/public/theme-boot.js` liest dieselben Regeln vor dem ersten Paint,
// damit kein Thema-Wechsel sichtbar wird. Geprüft von `theme.test.ts` und
// `theme-boot.test.ts`.

import { useCallback, useEffect, useState } from "react";
import { applyAppTheme, type AppTheme } from "./data";

/** Was gespeichert sein darf: System folgt, Dunkel/Hell entscheiden. */
export type ThemeChoice = "system" | "dark" | "light";

/** Reihenfolge der Auswahl in den Einstellungen (System zuerst). */
export const THEME_CHOICES: readonly ThemeChoice[] = [
  "system",
  "dark",
  "light",
];

/** Derselbe Schlüssel wie im Bootstrap und in den Einstellungen (C4). */
export const THEME_STORAGE_KEY = "tankapp.theme";

/** Beschriftung je Wahl — eine Stelle statt drei Kopien im Markup. */
export const THEME_CHOICE_LABEL: Record<ThemeChoice, string> = {
  system: "System",
  dark: "Dunkel",
  light: "Hell",
};

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "system" || value === "dark" || value === "light";
}

/**
 * Das Thema des Betriebssystems. Nur ein ausdrückliches „hell“ kippt die
 * Anzeige; alles andere (dunkel, unbekannt, nicht abfragbar) bleibt dunkel.
 */
export function systemTheme(): AppTheme {
  try {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    return media.matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Wahl + Systemzustand → tatsächlich angezeigtes Thema. */
export function resolveTheme(choice: ThemeChoice, system: AppTheme): AppTheme {
  return choice === "system" ? system : choice;
}

/** Gespeicherte Wahl lesen; alles Unbekannte heißt „System“. */
export function readThemeChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === null) return "system";
    const parsed: unknown = JSON.parse(raw);
    return isThemeChoice(parsed) ? parsed : "system";
  } catch {
    return "system";
  }
}

/**
 * Wahl speichern. „System“ **entfernt** den Schlüssel: Nur so bleibt der
 * Unterschied zwischen „nie entschieden“ und „ausdrücklich dem System
 * gefolgt“ erhalten — und der Bootstrap weiß, dass er fragen muss.
 */
export function storeThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(choice));
  } catch {
    /* Speicher gesperrt (privater Modus): die Sitzung behält die Wahl. */
  }
}

/**
 * Der Theme-Zustand der App: angezeigtes Thema, Wahl und ein Setter.
 *
 * `applyAppTheme` läuft bei jeder Änderung — auch, wenn nur das System
 * umschaltet, während „System“ gewählt ist.
 */
export function useAppTheme() {
  const [choice, setChoiceState] = useState<ThemeChoice>(readThemeChoice);
  const [system, setSystem] = useState<AppTheme>(systemTheme);

  useEffect(() => {
    let media: MediaQueryList | null = null;
    try {
      media = window.matchMedia("(prefers-color-scheme: light)");
    } catch {
      media = null;
    }
    if (!media) return;
    const sync = () => setSystem(media && media.matches ? "light" : "dark");
    sync();
    // `addEventListener` fehlt in älteren Umgebungen (und in happy-dom):
    // ohne Listener gilt weiter der beim Start gelesene Systemstand.
    media.addEventListener?.("change", sync);
    return () => media.removeEventListener?.("change", sync);
  }, []);

  const theme = resolveTheme(choice, system);
  useEffect(() => {
    applyAppTheme(theme);
  }, [theme]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    storeThemeChoice(next);
  }, []);

  return { choice, theme, setChoice } as const;
}
