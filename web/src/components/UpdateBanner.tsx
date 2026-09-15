// B10: „Neue Version verfügbar“ — ein Banner, zwei Knöpfe, kein Dauerfeuer.
//
// Es erscheint nur, wenn ein Service Worker wartet (also wirklich eine neue
// Shell bereitsteht) und bleibt für die Sitzung still, wenn „Später“ gedrückt
// wurde. Die Version im Satz ist die der laufenden Ansicht — die Zahl im
// Footer bleibt die des Servers; genau dieser Unterschied ist die Meldung.
import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import {
  readDismissed,
  reloadWithUpdate,
  type UpdateNotice,
  UPDATE_EVENT,
  updateNotice,
  writeDismissed,
} from "../service-worker";
import { APP_VERSION } from "../version";

/**
 * Die Anzeige selbst — zustandsfrei, damit sie ohne Browser prüfbar ist
 * (`UpdateBanner.test.tsx` rendert statisch). Der Container darunter verdrahtet
 * nur Ereignis und „Später“.
 */
export function UpdateBannerView({
  notice,
  onReload,
  onDismiss,
}: {
  notice: UpdateNotice;
  onReload: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-sky-500/30 bg-sky-500/10 p-4 text-sm text-sky-100"
    >
      <RefreshCw size={18} className="shrink-0 text-sky-300" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{notice.text}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-sky-200/80">
          {notice.note}
        </p>
      </div>
      <button
        onClick={onReload}
        className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 transition hover:bg-sky-400"
      >
        {notice.action}
      </button>
      <button
        onClick={onDismiss}
        aria-label={notice.dismiss}
        className="rounded-lg px-2 py-2 text-sky-200/80 transition hover:text-white"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

export function UpdateBanner() {
  const [available, setAvailable] = useState(false);
  const notice = updateNotice(APP_VERSION);

  useEffect(() => {
    const onUpdate = () => {
      if (!readDismissed()) setAvailable(true);
    };
    window.addEventListener(UPDATE_EVENT, onUpdate);
    return () => window.removeEventListener(UPDATE_EVENT, onUpdate);
  }, []);

  if (!available) return null;

  return (
    <UpdateBannerView
      notice={notice}
      onReload={() => reloadWithUpdate()}
      onDismiss={() => {
        writeDismissed();
        setAvailable(false);
      }}
    />
  );
}
