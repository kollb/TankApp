// U3 (GUI-UX-BEFUND) + B4 (Befund UX/Mathe 19.09.2026, §1.2–1.3): die
// Hauptnavigation ist ein Abbild der drei Kernfragen des Konzepts —
// „Jetzt oder warten?“ (Jetzt), „Wann in den nächsten Tagen?“ (Woche),
// „Welche Station?“ (Stationen) — plus genau einem Studio-Eingang für die
// übrigen Bereiche (Labor, Ich, System, Glossar).
//
// Vor B4 (GUI-UX-BEFUND §13) saßen sechs gleichberechtigte Punkte in der
// Leiste: Buchhaltung (Ich) und Betrieb (System) belegten permanent
// Aufmerksamkeit, obwohl 95 % der Sitzungen nur die drei Kernfragen
// stellen. Die Gleichberechtigung war der Konstruktionsfehler — nicht die
// Bereiche selbst. Sie bleiben voll erreichbar:
//
//   * Mobil (unter `lg`): Bottom-Leiste mit Jetzt · Woche · Stationen +
//     „Mehr“-Eintrag, der das Studio-Blatt öffnet (vier Zeilen: Labor,
//     Ich, System, Glossar). Das Blatt ist ein kurzes Menü über der
//     Leiste, kein zweites Navigationsmodell — ein Tap bringt zurück.
//   * Desktop (ab `lg`): Seitenleiste links mit den drei Kernfragen,
//     Trennlinie, „Studio“-Gruppe mit denselben vier Bereichen — alles
//     direkt sichtbar, weil auf Desktop die Breite da ist.
//
// Beide Raster teilen dieselben Listen (`MAIN_NAV_ITEMS`/
// `STUDIO_NAV_ITEMS`). Welche Variante sichtbar ist, entscheidet allein
// CSS (`hidden`/`lg:`-Varianten) — kein matchMedia-Zustand. Die
// unsichtbare Variante ist `display: none` und nimmt damit weder an der
// Tastatur-Reihenfolge noch am Accessibility-Baum teil; strenge
// Test-Selektoren (`getByRole`) sehen pro Viewport genau eine
// Schaltfläche je Bereich.
//
// URL-Schema bleibt kompatibel (U4): `?tab=labor`, `?tab=ich`,
// `?tab=system`, `?tab=glossar` sind weiter gültig und teilbar —
// `routing.ts` ändert sich nicht. Im Studio-Bereich trägt mobil der
// „Mehr“-Eintrag `aria-current="page"` (Studio-Karten in der Seitenleiste
// desktop), damit der Bereichsstand in der Navigation sichtbar bleibt.
//
// CI-Fix 0.41.0 bleibt bestehen: Die mobile Leiste wird in Dashboard.tsx
// als **letztes** Element der App-Hülle gerendert (nach `<main>`), trägt
// `z-50` und liegt damit in DOM- wie in Stapel-Reihenfolge über dem
// Inhalt. Das Studio-Blatt hängt an derselben Fixierung — es kann von
// keinem Inhalt überdeckt werden.

import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Car,
  Compass,
  FlaskConical,
  Gauge,
  MapPin,
  Monitor,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { TabId } from "../routing";

export interface NavItem {
  id: TabId;
  label: string;
  icon: LucideIcon;
  /** Studio-Blatt (mobil): eine Zeile unter dem Namen — was dort wartet. */
  note?: string;
}

/** Die drei Kernfragen des Konzepts (Befund §1.3) — Hauptnavigation. */
export const MAIN_NAV_ITEMS: NavItem[] = [
  { id: "jetzt", label: "Jetzt", icon: Compass },
  { id: "week", label: "Woche", icon: Gauge },
  { id: "stations", label: "Stationen", icon: MapPin },
];

/**
 * Welt 2 — Verstehen & Betreiben (Befund §1.2): hinter einem Eingang,
 * sichtbar erreichbar, aber nicht dauerpräsent. Die Beschriftungen folgen
 * dem Studio-Wireframe (§1.4.4) und den jeweiligen Bereichs-Überschriften.
 */
export const STUDIO_NAV_ITEMS: NavItem[] = [
  {
    id: "labor",
    label: "Labor",
    icon: FlaskConical,
    note: "Verstehen, warum die App das sagt",
  },
  {
    id: "ich",
    label: "Ich",
    icon: Car,
    note: "Tankstand · Belege · Bilanz · Profile",
  },
  {
    id: "system",
    label: "System",
    icon: Monitor,
    note: "Zustand · Läufe · Störungen",
  },
  {
    id: "glossary",
    label: "Glossar",
    icon: BookOpen,
    note: "Alle Begriffe A–Z",
  },
];

/** Alle sieben Bereiche in Navigation-Reihenfolge. */
export const NAV_ITEMS: NavItem[] = [...MAIN_NAV_ITEMS, ...STUDIO_NAV_ITEMS];

/** Studio-Bereich? Der mobile „Mehr“-Eintrag ist dann die aktive Markierung. */
export function isStudioTab(tab: TabId): boolean {
  return STUDIO_NAV_ITEMS.some((item) => item.id === tab);
}

function activeClasses(id: TabId, active: boolean): string {
  if (id === "labor") {
    // Das Labor behält seinen Akzentfarbton als „andere Welt“-Signal
    // (Befund §1.6: bleibt, es wandert nur in die Studio-Gruppe).
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
      {/* Mobil: „Stationen“ ist mit 10 px Semibold ~2 px breiter als seine
          Zelle und malte über den Nachbarn (U3-Fix). Etwas enger gesetzt
          passt es; auf sehr schmalen Geräten wird der Rest sauber
          abgeschnitten statt gemalt. */}
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
 * Studio-Blatt (mobil): die vier Bereiche hinter dem „Mehr“-Eintrag.
 * Kein Modal: Das Blatt hängt direkt über der Bottom-Leiste (ein Element
 * darunter), die Leiste bleibt sichtbar und bedient den Rückweg
 * („Mehr“ noch einmal). Escape schließt zusätzlich; der Fokus liegt beim
 * Öffnen auf dem aktiven Eintrag — Tastatur und Screenreader landen dort,
 * wo der Bereichsstand markiert ist.
 */
function StudioSheet({
  tab,
  onSelect,
  onClose,
}: {
  tab: TabId;
  onSelect: (id: TabId) => void;
  onClose: () => void;
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    activeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label="Studio"
      className="rounded-t-2xl border-t border-slate-700 bg-slate-900/98 p-2 shadow-[0_-12px_32px_rgba(0,0,0,0.5)]"
    >
      <p className="px-2 pb-1 pt-1.5 text-[0.625rem] font-semibold uppercase tracking-widest text-slate-500">
        Studio
      </p>
      {/* `grid-cols-1` ist Pflicht, nicht Deko (A11y-Ratchet M1): eine
          implizite Spur wächst auf den breitesten Eintrag — bei vollen
          Zeilen mit `truncate` relevant, wenn der Text mal länger wird. */}
      <div className="grid grid-cols-1 gap-1">
        {STUDIO_NAV_ITEMS.map((item) => {
          const active = tab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              ref={active ? activeRef : undefined}
              onClick={() => onSelect(item.id)}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${activeClasses(item.id, active)}`}
            >
              <Icon size={18} aria-hidden="true" className="shrink-0" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">
                  {item.label}
                </span>
                {item.note && (
                  <span className="block truncate text-xs font-normal text-slate-400">
                    {item.note}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Mobil: die feste Leiste am unteren Rand (Daumenreichweite, §13) — seit
 * B4 mit vier Zellen: die drei Kernfragen plus „Mehr“. Wird in
 * Dashboard.tsx als letztes Element der App-Hülle montiert, damit sie in
 * DOM- und Stapel-Reihenfolge über dem Inhalt liegt (`z-50`); der Inhalt
 * hält per `pb-24` Abstand. Unter `lg` ist sie `display: none`.
 */
export function MobileNav({
  tab,
  onSelect,
}: {
  tab: TabId;
  onSelect: (id: TabId) => void;
}) {
  const [studioOpen, setStudioOpen] = useState(false);
  const studioActive = isStudioTab(tab);

  // Der Rückweg über die Leiste (Haupttab wählen) schließt das Blatt mit;
  // über den Bereichswechsel zu reagieren, hält die Leiste dumm.
  useEffect(() => {
    if (!studioActive) setStudioOpen(false);
  }, [studioActive]);

  // Deckender Hintergrund statt `backdrop-blur`: Die Leiste soll in jedem
  // Compositing-Modus (auch headless/CI) sicher ganz oben liegen und Klicks
  // bekommen — 95 %-Tönung plus Filter war dort anfällig.
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {studioOpen && (
        <StudioSheet
          tab={tab}
          onSelect={(id) => {
            onSelect(id);
            setStudioOpen(false);
          }}
          onClose={() => setStudioOpen(false)}
        />
      )}
      <nav
        aria-label="Bereiche"
        className="border-t border-slate-800 bg-slate-950"
      >
        <div className="mx-auto grid max-w-3xl grid-cols-4">
          {MAIN_NAV_ITEMS.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={tab === item.id}
              onSelect={onSelect}
              mobile
            />
          ))}
          {/* „Mehr“ (Befund §1.3): der Studio-Eingang. Im Studio-Bereich
              trägt er `aria-current` — die Bereichs-Zugehörigkeit bleibt
              in der Leiste lesbar, ohne dass das Blatt offen sein muss. */}
          <button
            onClick={() => setStudioOpen((open) => !open)}
            aria-haspopup="dialog"
            aria-expanded={studioOpen}
            aria-current={studioActive ? "page" : undefined}
            className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg text-[0.625rem] font-semibold transition-colors ${
              studioActive
                ? "bg-emerald-500/10 text-emerald-400"
                : "text-slate-500 hover:bg-slate-900 hover:text-slate-200"
            }`}
          >
            <MoreHorizontal size={18} aria-hidden="true" />
            <span>Mehr</span>
          </button>
        </div>
      </nav>
    </div>
  );
}

/**
 * Desktop (ab `lg`): die Seitenleiste links vor dem Inhalt — die drei
 * Kernfragen, dann die Studio-Gruppe (Befund §1.3). Unter `lg` ist sie
 * `display: none`.
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
      {MAIN_NAV_ITEMS.map((item) => (
        <NavButton
          key={item.id}
          item={item}
          active={tab === item.id}
          onSelect={onSelect}
          mobile={false}
        />
      ))}
      <div aria-hidden="true" className="my-2 border-t border-slate-800" />
      <p className="px-4 pb-1 text-[0.625rem] font-semibold uppercase tracking-widest text-slate-600">
        Studio
      </p>
      {STUDIO_NAV_ITEMS.map((item) => (
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
