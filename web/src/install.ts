// C8: „Zum Homescreen“-Hinweis — die Entscheidung als reine Funktionen,
// damit sie ohne Browser prüfbar bleibt (src/a11y.test.ts).
//
// Die App ist als PWA gebaut (manifest.json + Service Worker), aber ohne
// Hinweis findet sie niemand. Zwei Wege:
//   * Chromium/Android meldet `beforeinstallprompt` — dann gibt es einen
//     echten Installationsknopf.
//   * iOS/Safari kennt dieses Ereignis nicht — dort hilft nur der kurze
//     Handgriff „Teilen → Zum Home-Bildschirm“.
// Alles andere (Firefox-Desktop, ältere Browser) bekommt bewusst keinen
// Hinweis: wir versprechen keinen Knopf, den der Browser nicht hat.

export const INSTALL_SNOOZE_DAYS = 30;
export const INSTALL_SNOOZE_KEY = "tankapp.install.snoozed_until";

export type InstallHintKind = "hidden" | "native" | "manual";

export interface InstallHintInput {
  /** Läuft die App bereits als installierte App (display-mode standalone)? */
  standalone: boolean;
  /** Liegt ein `beforeinstallprompt`-Ereignis vor? */
  hasPrompt: boolean;
  /** iOS-Safari ohne Ereignis: Handgriff über das Teilen-Menü. */
  manualPossible: boolean;
  /** Zeitpunkt, bis zu dem der Hinweis weggedrückt ist (0 = nie). */
  snoozedUntil: number;
  now: number;
}

export function installHintKind(input: InstallHintInput): InstallHintKind {
  if (input.standalone) return "hidden";
  if (input.snoozedUntil > input.now) return "hidden";
  if (input.hasPrompt) return "native";
  if (input.manualPossible) return "manual";
  return "hidden";
}

/** Zeitpunkt, bis zu dem „Nicht jetzt“ gilt. */
export function snoozeUntil(now: number, days = INSTALL_SNOOZE_DAYS): number {
  return now + days * 24 * 60 * 60 * 1000;
}

export function readSnooze(storage: Pick<Storage, "getItem"> | null): number {
  if (!storage) return 0;
  try {
    const raw = storage.getItem(INSTALL_SNOOZE_KEY);
    if (!raw) return 0;
    const value = JSON.parse(raw);
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function writeSnooze(
  storage: Pick<Storage, "setItem"> | null,
  until: number,
): void {
  if (!storage) return;
  try {
    storage.setItem(INSTALL_SNOOZE_KEY, JSON.stringify(until));
  } catch {
    // Storage gesperrt (Privatmodus): Der Hinweis darf dann wieder kommen.
  }
}

/** Erkennt iOS-Safari: dort gibt es kein `beforeinstallprompt`. */
export function iosSafari(userAgent: string): boolean {
  const isIos = /iPhone|iPad|iPod/.test(userAgent);
  const isWebKit = /Safari/.test(userAgent) && !/Chrome|CriOS|EdgiOS|FxiOS/.test(userAgent);
  return isIos && isWebKit;
}

export function installHintText(kind: InstallHintKind): {
  title: string;
  body: string;
  action: string | null;
} | null {
  if (kind === "native") {
    return {
      title: "TankApp aufs Handy?",
      body: "Als App auf dem Homescreen startet sie ohne Adresszeile und lädt die letzte Ansicht auch bei schlechtem Netz.",
      action: "Installieren",
    };
  }
  if (kind === "manual") {
    return {
      title: "TankApp aufs Handy?",
      body: "In Safari unten auf „Teilen“ tippen und „Zum Home-Bildschirm“ wählen — danach liegt die App wie jede andere auf dem Homescreen.",
      action: null,
    };
  }
  return null;
}

export const INSTALL_DISMISS_LABEL = "Nicht jetzt";
export const INSTALL_DONE_LABEL = "TankApp liegt jetzt auf dem Homescreen.";
