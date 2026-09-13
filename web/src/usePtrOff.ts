// C8-Rest: Hängt eine Fläche an die Pull-to-Refresh-Sperre (`ptr-off`).
// Die Sperre gilt nur zwischen pointerdown und pointerup/pointercancel —
// danach darf die Seite wieder normal overscrollen.
import { useEffect, useRef } from "react";
import { setPtrOff } from "./ptr";

export function usePtrOff<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let active = false;
    const engage = () => {
      active = true;
      setPtrOff(true);
    };
    const release = () => {
      if (!active) return;
      active = false;
      setPtrOff(false);
    };

    node.addEventListener("pointerdown", engage);
    node.addEventListener("touchstart", engage, { passive: true });
    node.addEventListener("pointerup", release);
    node.addEventListener("pointercancel", release);
    node.addEventListener("touchend", release);
    node.addEventListener("touchcancel", release);
    node.addEventListener("mouseleave", release);
    window.addEventListener("blur", release);

    return () => {
      node.removeEventListener("pointerdown", engage);
      node.removeEventListener("touchstart", engage);
      node.removeEventListener("pointerup", release);
      node.removeEventListener("pointercancel", release);
      node.removeEventListener("touchend", release);
      node.removeEventListener("touchcancel", release);
      node.removeEventListener("mouseleave", release);
      window.removeEventListener("blur", release);
      // Beim Verlassen der Ansicht darf die Sperre nicht hängen bleiben.
      release();
    };
  }, []);

  return ref;
}
