// B10: Service-Worker-Versionierung und Update-Anzeige.
//
// Vorher trugen die Cache-Namen eine feste Version (`…-v1`): Ein GUI-Update
// signalisierte dem Nutzer nichts, und ein installiertes Fenster konnte auf
// einer alten Shell sitzen bleiben, ohne dass es irgendwo stand. Jetzt trägt
// die Shell die App-Version (beim Build gestempelt), und ein wartender Worker
// meldet sich als Ereignis — die Ansicht sagt dann ehrlich, auf welchem Stand
// sie läuft, statt still veraltet zu bleiben.
//
// Die Entscheidungen liegen als reine Funktionen hier; das Registrieren und
// das Ereignis sind dünn (main.tsx → components/UpdateBanner.tsx).

export const UPDATE_EVENT = "tankapp:sw-update";
/** Wie oft im Hintergrund nach einer neuen Shell gefragt wird. */
export const UPDATE_CHECK_MS = 30 * 60 * 1000;
/** „Nicht jetzt“ gilt für die Sitzung — nach dem nächsten Laden fragt es wieder. */
export const UPDATE_DISMISS_KEY = "tankapp.sw.update.dismissed";

export type UpdateNotice = { text: string; action: string; dismiss: string; note: string };

/**
 * Satz für die Anzeige. Die Version ist die der **laufenden** Ansicht — die
 * Zahl, die der Nutzer im Footer sieht, ist die des Servers; genau dieser
 * Unterschied ist der Grund für die Meldung.
 */
export function updateNotice(runningVersion: string): UpdateNotice {
  const version = runningVersion && runningVersion !== "dev" ? runningVersion : "";
  return {
    text: version
      ? `Neue Version verfügbar — diese Ansicht läuft noch auf ${version}.`
      : "Neue Version verfügbar — diese Ansicht läuft noch auf einem alten Stand.",
    action: "Jetzt neu laden",
    dismiss: "Später",
    note: "Deine Eingaben bleiben gespeichert; die Ansicht wird nur neu geladen.",
  };
}

type ServiceWorkerLike = {
  register: (url: string) => Promise<ServiceWorkerRegistration>;
  getRegistration?: () => Promise<ServiceWorkerRegistration | undefined>;
  addEventListener?: (type: string, listener: () => void) => void;
  controller?: unknown;
};

async function registration(): Promise<ServiceWorkerRegistration | null> {
  const sw = (navigator as Navigator & { serviceWorker?: ServiceWorkerLike })
    .serviceWorker;
  if (!sw) return null;
  if (typeof sw.getRegistration === "function") {
    const existing = await sw.getRegistration().catch(() => undefined);
    if (existing) return existing;
  }
  return sw.register("/sw.js").catch(() => null);
}

/**
 * Registriert den Service Worker und meldet einen **wartenden** Nachfolger.
 *
 * Kein Banner beim ersten Besuch: Ohne laufenden Vorgänger ist der neue
 * Worker kein Update, sondern der Anfang. Gemeldet wird nur, was der Nutzer
 * entscheiden kann — und `webdriver` (automatisierte Tests) bleibt außen vor,
 * sonst cachet der Browser zwischen Test und Zusicherung.
 */
export function registerServiceWorker(): void {
  if (typeof navigator === "undefined") return;
  const sw = (navigator as Navigator & { serviceWorker?: ServiceWorkerLike })
    .serviceWorker;
  if (!sw || typeof sw.register !== "function") return;
  // Ein installierter Vorgänger steuert die Seite: ab jetzt ist ein neuer
  // Worker ein Update.
  const hadController = Boolean(sw.controller);

  void sw
    .register("/sw.js")
    .then((registration) => {
      const announce = () => window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
      if (registration.waiting && hadController) {
        announce();
        return;
      }
      registration.addEventListener("updatefound", () => {
        const next = registration.installing;
        if (!next) return;
        next.addEventListener("statechange", () => {
          if (next.state === "installed" && hadController) announce();
        });
      });
      window.setInterval(() => {
        void registration.update().catch(() => {
          /* Offline: der nächste Versuch kommt von selbst. */
        });
      }, UPDATE_CHECK_MS);
    })
    .catch(() => {
      /* Offline-Cache ist Bonus; die App läuft auch ohne. */
    });
}

/** Wartenden Worker übernehmen und die Seite neu laden (B10). */
export function reloadWithUpdate(): void {
  const sw = (navigator as Navigator & { serviceWorker?: ServiceWorkerLike })
    .serviceWorker;
  if (!sw) {
    window.location.reload();
    return;
  }
  void registration().then((reg) => {
    if (!reg) {
      window.location.reload();
      return;
    }
    const apply = () => window.location.reload();
    sw.addEventListener?.("controllerchange", apply);
    reg.waiting?.postMessage({ type: "SKIP_WAITING" });
    // Kein wartender Worker (z. B. schon aktiviert): einfach neu laden.
    if (!reg.waiting) apply();
  });
}

/** „Später“ gilt für diese Sitzung, nicht für immer. */
export function readDismissed(storage: Storage | null = safeSession()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(UPDATE_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDismissed(
  storage: Storage | null = safeSession(),
  value = true,
): void {
  if (!storage) return;
  try {
    if (value) storage.setItem(UPDATE_DISMISS_KEY, "1");
    else storage.removeItem(UPDATE_DISMISS_KEY);
  } catch {
    /* Privater Modus: dann bleibt der Hinweis eben stehen. */
  }
}

function safeSession(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}
