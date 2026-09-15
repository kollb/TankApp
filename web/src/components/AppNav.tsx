// U3 (GUI-UX-BEFUND) — die zwei Geräte-Raster des Entwurfs (UI-NEUENTWURF
// §13): mobil eine Bottom-Navigation mit sechs Punkten und 44-px-Zielen,
// desktop eine Seitenleiste links mit farblich abgesetztem Labor. Vorher gab
// es **einen** umbrechenden Pillen-Streifen für alle Viewports, mit sieben
// Punkten inklusive „Glossar“ als Haupttab.
//
// Das Glossar ist kein Aufgaben-Bereich und steht deshalb nicht mehr hier —
// seinen Eingang hat es im Labor-Kopf (und weiter im Fußzeilen-Link und in
// den Einstellungen).
//
// Beide Raster sind dieselbe Liste (`NAV_ITEMS`); gerendert wird genau eine
// Variante (matchMedia), damit jede Schaltfläche nur einmal im DOM steht —
// wichtig für Tastatur-Reihenfolge, Screenreader und strenge Test-Selektoren.

import { useEffect, useState } from "react";
import {
  Compass,
  FlaskConical,
  Gauge,
  MapPin,
  Server,
  User,
  type LucideIcon,
} from "lucide-react";
import type { TabId } from "../routing";

export interface NavItem {
  id: TabId;
  label: string;
  icon: LucideIcon;
}

/** Die sechs Aufgaben-Bereiche (UI-NEUENTWURF §4.1). */
export const NAV_ITEMS: NavItem[] = [
  { id: "jetzt", label: "Jetzt", icon: Compass },
  { id: "stations", label: "Stationen", icon: MapPin },
  { id: "week", label: "Woche", icon: Gauge },
  { id: "ich", label: "Ich", icon: User },
  { id: "labor", label: "Labor", icon: FlaskConical },
  { id: "system", label: "System", icon: Server },
];

const DESKTOP_QUERY = "(min-width: 1024px)";

/** true ab Desktop-Breite — das Raster wechselt mit dem Viewport. */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== "undefined" && "matchMedia" in window
      ? window.matchMedia(DESKTOP_QUERY).matches
      : true,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !("matchMedia" in window)) return;
    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    setIsDesktop(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

function activeClasses(id: TabId, active: boolean): string {
  if (id === "labor") {
    return active
      ? "bg-violet-500/15 text-violet-300"
      : "text-slate-500 hover:bg-slate-900 hover:text-violet-300";
  }
  return active
    ? "bg-emerald-500/10 text-emerald-400"
    : "text-slate-500 hover:bg-slate-900 hover:text-slate-200";
}

/**
 * Die Bereichs-Navigation: auf dem Desktop die linke Seitenleiste, darunter
 * nichts; mobil die feste Leiste am unteren Rand (Daumenreichweite,
 * §13). Beide Varianten tragen dieselben Namen, Reihenfolge und Zustände.
 */
export function AppNav({
  tab,
  onSelect,
}: {
  tab: TabId;
  onSelect: (id: TabId) => void;
}) {
  const isDesktop = useIsDesktop();

  if (!isDesktop) {
    return (
      <nav
        aria-label="Bereiche"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-slate-950/95 backdrop-blur-md lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto grid max-w-3xl grid-cols-6">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelect(item.id)}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg text-[0.625rem] font-semibold transition-colors ${activeClasses(item.id, active)}`}
              >
                <Icon size={18} aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>
    );
  }

  return (
    <nav
      aria-label="Bereiche"
      className="sticky top-24 hidden w-56 shrink-0 flex-col gap-1 self-start lg:flex"
    >
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = tab === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-lg px-4 text-sm font-semibold transition-colors ${activeClasses(item.id, active)}`}
          >
            <Icon size={17} aria-hidden="true" />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
