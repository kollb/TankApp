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
    <div role="status" className="update-banner">
      <RefreshCw size={18} aria-hidden="true" />
      <div className="update-banner-copy">
        <p className="update-banner-title">{notice.text}</p>
        <p className="update-banner-note">{notice.note}</p>
      </div>
      <button type="button" onClick={onReload} className="update-banner-action">
        {notice.action}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={notice.dismiss}
        className="update-banner-dismiss"
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
