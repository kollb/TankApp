import { useEffect, useId, useRef, type ReactNode } from "react";
import { dialog as dialogStyle } from "./ui";
import { X } from "lucide-react";

/** Native modal: focus containment, Escape and focus restoration in one place. */
export function BottomSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    dialog.showModal();
    return () => dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onCancel={onClose}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        // Native dialogs make the page inert, but some Chromium builds
        // still allow Tab to enter browser chrome at the boundary.
        const focusable = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          ),
        ].filter((element) => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={`${dialogStyle} m-auto mb-0 max-h-[85dvh] w-full max-w-2xl overflow-y-auto p-5 text-slate-100 backdrop:bg-slate-950/80 sm:mb-auto`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id={id} className="text-lg font-bold">
          {title}
        </h2>
        <button
          autoFocus
          onClick={onClose}
          aria-label={`${title} schließen`}
          className="rounded-lg border border-slate-700 p-3"
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
