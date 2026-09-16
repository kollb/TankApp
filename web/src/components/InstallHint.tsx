// C8-Rest: Install-/„Zum Homescreen“-Hinweis. Kein Dauerbanner: Der Hinweis
// erscheint nur, wenn der Browser wirklich installieren kann (oder iOS den
// Handgriff braucht) und ist nach „Nicht jetzt“ 30 Tage still.
import { useEffect, useState } from "react";
import { Download, Share2, X } from "lucide-react";
import {
  INSTALL_DISMISS_LABEL,
  INSTALL_DONE_LABEL,
  type InstallHintKind,
  installHintKind,
  installHintText,
  iosSafari,
  readSnooze,
  snoozeUntil,
  writeSnooze,
} from "../install";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function storage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

export function InstallHint({ onNote }: { onNote?: (message: string) => void }) {
  const [promptEvent, setPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [kind, setKind] = useState<InstallHintKind>("hidden");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      // Der Browser würde sein eigenes Mini-Banner zeigen; wir entscheiden
      // selbst, wann und ob — erst dann ist der Knopf wirklich nutzbar.
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setPromptEvent(null);
      setKind("hidden");
      onNote?.(INSTALL_DONE_LABEL);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [onNote]);

  useEffect(() => {
    const standalone =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches;
    setKind(
      installHintKind({
        standalone,
        hasPrompt: promptEvent !== null,
        manualPossible:
          typeof navigator !== "undefined" && iosSafari(navigator.userAgent),
        snoozedUntil: readSnooze(storage()),
        now: Date.now(),
      }),
    );
  }, [promptEvent]);

  const text = installHintText(kind);
  if (kind === "hidden" || !text) return null;

  const dismiss = () => {
    writeSnooze(storage(), snoozeUntil(Date.now()));
    setKind("hidden");
  };

  const install = async () => {
    if (!promptEvent) return;
    setBusy(true);
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice?.outcome === "dismissed") dismiss();
    } catch {
      // Abbruch oder nicht mehr verfügbar: Der Hinweis darf wiederkommen.
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Installationshinweis"
      className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm text-emerald-100"
    >
      {promptEvent ? (
        <Download
          size={18}
          className="shrink-0 text-emerald-300"
          aria-hidden="true"
        />
      ) : (
        <Share2
          size={18}
          className="shrink-0 text-emerald-300"
          aria-hidden="true"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-emerald-200">{text.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-emerald-100/90">
          {text.body}
        </p>
      </div>
      {text.action && (
        <button
          type="button"
          onClick={() => void install()}
          disabled={busy}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {text.action}
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/10"
      >
        <X size={13} aria-hidden="true" />
        {INSTALL_DISMISS_LABEL}
      </button>
    </section>
  );
}
