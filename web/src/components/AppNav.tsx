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
// Beide Raster sind dieselbe Liste (`NAV_ITEMS`). Es gibt zwei Bausteine:
// `SideNav` (Seitenleiste, ab `lg`) und `MobileNav` (Bottom-Leiste, unter
// `lg`). Welche Variante sichtbar ist, entscheidet allein CSS (`hidden`/
// `lg:`-Varianten) — kein matchMedia-Zustand. Die unsichtbare Variante ist
// `display: none` und nimmt damit weder an der Tastatur-Reihenfolge noch am
// Accessibility-Baum teil; strenge Test-Selektoren (`getByRole`) sehen pro
// Viewport genau eine Schaltfläche je Bereich.
//
// CI-Fix 0.41.0: Die mobile Leiste wurde früher per matchMedia ausgewählt
// und stand als flex-Kind **neben** `<main>`. Auf mobilen Viewports konnte
// der Inhalt die Leiste überdecken und Klicks abfangen (e2e: „subtree
// intercepts pointer events“). Jetzt wird `MobileNav` in Dashboard.tsx als
// **letztes** Element der App-Hülle gerendert (nach `<main>`), trägt
// `z-50` und liegt damit in DOM- wie in Stapel-Reihenfolge über dem Inhalt.

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

function NavButton({
  item,
  active,
  onSelect,
  mobile,
}: {
  item: NavItem;
  active: boolean;
  onSelect: (id: TabId) => void;
  mobile: boolean;
}) {
  const Icon = item.icon;
  return (
    <button
      onClick={() => onSelect(item.id)}
      aria-current={active ? "page" : undefined}
      className={
        mobile
          ? `flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg text-[0.625rem] font-semibold transition-colors ${activeClasses(item.id, active)}`
          : `flex min-h-11 items-center gap-3 rounded-lg px-4 text-sm font-semibold transition-colors ${activeClasses(item.id, active)}`
      }
    >
      <Icon size={mobile ? 18 : 17} aria-hidden="true" />
      {/* Mobil sechs gleich breite Zellen: „Stationen“ ist mit 10 px
          Semibold ~2 px breiter als seine Zelle (66 px in 64 px) und malte
          damit über den Nachbarn. Etwas enger gesetzt passt es; auf sehr
          schmalen Geräten wird der Rest sauber abgeschnitten statt gemalt. */}
      {mobile ? (
        <span className="max-w-full truncate tracking-tighter">
          {item.label}
        </span>
      ) : (
        item.label
      )}
    </button>
  );
}

/**
 * Mobil: die feste Leiste am unteren Rand (Daumenreichweite, §13).
 * Wird in Dashboard.tsx als letztes Element der App-Hülle montiert, damit
 * sie in DOM- und Stapel-Reihenfolge über dem Inhalt liegt (`z-50`); der
 * Inhalt hält per `pb-24` Abstand. Unter `lg` ist sie `display: none`.
 */
export function MobileNav({
  tab,
  onSelect,
}: {
  tab: TabId;
  onSelect: (id: TabId) => void;
}) {
  // Deckender Hintergrund statt `backdrop-blur`: Die Leiste soll in jedem
  // Compositing-Modus (auch headless/CI) sicher ganz oben liegen und Klicks
  // bekommen — 95 %-Tönung plus Filter war dort anfällig.
  return (
    <nav
      aria-label="Bereiche"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-800 bg-slate-950 lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto grid max-w-3xl grid-cols-6">
        {NAV_ITEMS.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            active={tab === item.id}
            onSelect={onSelect}
            mobile
          />
        ))}
      </div>
    </nav>
  );
}

/**
 * Desktop (ab `lg`): die Seitenleiste links vor dem Inhalt, darunter nichts.
 * Unter `lg` ist sie `display: none`.
 */
export function SideNav({
  tab,
  onSelect,
}: {
  tab: TabId;
  onSelect: (id: TabId) => void;
}) {
  return (
    <nav
      aria-label="Bereiche"
      className="sticky top-24 hidden w-56 shrink-0 flex-col gap-1 self-start lg:flex"
    >
      {NAV_ITEMS.map((item) => (
        <NavButton
          key={item.id}
          item={item}
          active={tab === item.id}
          onSelect={onSelect}
          mobile={false}
        />
      ))}
    </nav>
  );
}
