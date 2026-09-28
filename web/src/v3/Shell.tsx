// Die Hülle des Konzept-Neubaus („GUI v3“): Kopfzeile, Seitenleiste am
// Desktop, Navigationsleiste am Handy, Inhalt.
//
// Warum eine eigene Hülle statt eines Umbaus der alten: Der Bereich „Jetzt“
// antwortet hier in der Konzept-Gestaltung (eine Karte, eine Antwort), die
// übrigen Bereiche kommen aus `views/Sections.tsx` — derselbe Code, den auch
// die alte Hülle rendert, damit es keine zweite Wahrheit über die
// Verdrahtung gibt. Jeder migrierte Bereich ersetzt dort genau einen Block.
//
// Desktop zuerst: Die Breite ist der Normalfall (Seitenleiste links, Inhalt
// in zwei Spalten), das Handy erbt dieselbe Reihenfolge als Einzelspalte und
// bekommt Kopfzeile + untere Leiste statt Seitenleiste. Nichts ist
// „mobil ausgeblendet“, was am Desktop trägt: beide Raster nennen dieselben
// Bereiche in derselben Reihenfolge.
//
// Der Bereich selbst reist in der Adresse (`?tab=…`, `routing.ts`), also
// funktionieren Zurück-Knopf, Lesezeichen und Teilen wie in der alten Hülle;
// `konzept=1` bleibt beim Bereichswechsel erhalten.

import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Car,
  Check,
  ChevronDown,
  Compass,
  FlaskConical,
  Fuel as FuelIcon,
  Gauge,
  MapPin,
  Monitor,
  MonitorSmartphone,
  Moon,
  MoreHorizontal,
  RefreshCw,
  Sun,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { BottomSheet } from "../components/BottomSheet";
import { radius } from "../components/ui";
import { clockLabel, freshCountLabel, type Fuel } from "../data";
import type { TabId } from "../routing";
import type { OverviewState } from "../state/overview";
import {
  THEME_CHOICES,
  THEME_CHOICE_LABEL,
  type ThemeChoice,
} from "../theme";

/** Symbol je Darstellungswahl — dieselbe Zuordnung wie in den Einstellungen. */
const THEME_ICON: Record<ThemeChoice, LucideIcon> = {
  system: MonitorSmartphone,
  dark: Moon,
  light: Sun,
};

/** Die drei Alltagsfragen (Reihenfolge wie in der alten Hülle, B4). */
const PRIMARY: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: "jetzt", label: "Jetzt", icon: Compass },
  { id: "week", label: "Woche", icon: Gauge },
  { id: "stations", label: "Stationen", icon: MapPin },
];

/** Studio: verstehen und betreiben — erreichbar, aber nicht dauerpräsent. */
const STUDIO: Array<{
  id: TabId;
  label: string;
  icon: LucideIcon;
  note: string;
}> = [
  {
    id: "labor",
    label: "Labor",
    icon: FlaskConical,
    note: "Nachrechnen, prüfen, vergleichen",
  },
  { id: "ich", label: "Ich", icon: Car, note: "Tankstand · Belege · Bilanz" },
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
    note: "Begriffe von A bis Z",
  },
];

/** Ist der Bereich noch in der bisherigen Gestaltung? */
export function isLegacySection(tab: TabId): boolean {
  return tab !== "jetzt";
}

function navButtonClass(active: boolean, compact = false): string {
  return `flex w-full items-center gap-3 ${compact ? "justify-center px-2 py-2 text-xs" : "px-3 py-2.5 text-sm"} font-semibold transition-colors ${
    active
      ? "bg-secondary-container text-on-secondary-container"
      : "text-on-surface-variant hover:bg-sc-low hover:text-on-surface"
  } ${radius.chip}`;
}

/**
 * Kopfzeile: Wortmarke, Kontext (Stadt · Kraftstoff), Zustand und die
 * Werkzeuge (Darstellung, Aktualisieren, klassische Ansicht).
 */
function TopBar({ ov }: { ov: OverviewState }) {
  const [contextOpen, setContextOpen] = useState(false);
  const {
    activeCity,
    data,
    setCity,
    setSelectedId,
    fuel,
    setFuel,
    online,
    fresh,
    prices,
    setRefresh,
    h,
    alarms,
    errorAlarms,
    warnAlarms,
    themeChoice,
    setThemeChoice,
    setTheme,
  } = ov;

  const cycleTheme = () => {
    const order = THEME_CHOICES;
    const at = order.indexOf(themeChoice);
    const next = order[(at + 1) % order.length];
    setThemeChoice(next);
    if (next !== "system") setTheme(next);
  };

  return (
    <header className="v3-topbar">
      <div className="v3-topbar-inner">
        <a href="/?konzept=1" className="tap-44 flex items-center gap-2.5">
          <span
            className={`grid h-9 w-9 grid-cols-1 place-items-center bg-primary text-on-primary ${radius.inset}`}
            aria-hidden="true"
          >
            <FuelIcon size={18} />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="text-lg font-black tracking-tight">
                TankApp
              </span>
              <span className="hidden rounded-full border border-outline-variant px-2 py-0.5 text-xs font-semibold text-on-surface-variant sm:inline">
                Konzeptstand
              </span>
            </span>
            <span className="hidden text-xs text-on-surface-variant lg:block">
              Dein Tank-Kompass — eine Frage, eine Antwort.
            </span>
          </span>
        </a>

        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setContextOpen(true)}
            aria-haspopup="dialog"
            aria-label="Stadt und Kraftstoff auswählen"
            className={`tap-44 flex min-w-0 items-center gap-1.5 border border-outline-variant bg-sc-lowest py-2 pl-3 pr-2 text-xs font-bold hover:bg-sc-low ${radius.chip}`}
          >
            <MapPin size={14} className="shrink-0 text-primary" />
            <span className="truncate">
              {activeCity || "Stadt auswählen"} ·{" "}
              {fuel === "diesel" ? "Diesel" : fuel.toUpperCase()}
            </span>
            <ChevronDown
              size={14}
              className="shrink-0 text-on-surface-variant"
              aria-hidden="true"
            />
          </button>

          <span
            role="status"
            className="hidden min-w-0 items-center gap-2 text-xs text-on-surface-variant md:flex"
          >
            {online && fresh.length ? (
              <Wifi size={14} className="shrink-0 text-primary" />
            ) : (
              <WifiOff size={14} className="shrink-0 text-warn" />
            )}
            <span className="truncate">
              {online && fresh.length
                ? `${freshCountLabel(fresh.length)} · Stand ${clockLabel(data?.generated_at)}`
                : prices.pending
                  ? "Daten werden geladen …"
                  : `Kein bestätigter Live-Preis${data ? ` · Stand ${clockLabel(data.generated_at)}` : ""}`}
            </span>
          </span>

          {h && alarms.length > 0 && (
            <span
              role="status"
              title={alarms.map((a) => a.message).join(" · ")}
              className={`hidden items-center gap-1.5 border px-2.5 py-1.5 text-xs font-semibold sm:inline-flex ${radius.chip} ${
                errorAlarms.length
                  ? "border-error/40 bg-error-container text-on-error-container"
                  : warnAlarms.length
                    ? "border-warn/40 bg-warn-container text-on-warn-container"
                    : "border-outline-variant bg-sc-low text-on-surface-variant"
              }`}
            >
              {errorAlarms.length
                ? `${errorAlarms.length} Alarm${errorAlarms.length > 1 ? "e" : ""}`
                : warnAlarms.length
                  ? `${warnAlarms.length} Hinweis${warnAlarms.length > 1 ? "e" : ""}`
                  : "Alles in Ordnung"}
            </span>
          )}

          <button
            type="button"
            onClick={cycleTheme}
            title={`Darstellung: ${THEME_CHOICE_LABEL[themeChoice]} · als Nächstes umschalten`}
            aria-label={`Darstellung umschalten (aktuell ${THEME_CHOICE_LABEL[themeChoice]})`}
            className={`tap-44 hidden h-10 w-10 grid-cols-1 place-items-center border border-outline-variant bg-sc-lowest text-on-surface-variant hover:bg-sc-low sm:grid ${radius.chip}`}
          >
            {(() => {
              const Icon = THEME_ICON[themeChoice];
              return <Icon size={16} aria-hidden="true" />;
            })()}
          </button>

          <button
            type="button"
            onClick={() => setRefresh((value) => value + 1)}
            disabled={prices.pending}
            aria-label="Daten aktualisieren"
            className={`tap-44 grid h-10 w-10 grid-cols-1 place-items-center border border-outline-variant bg-sc-lowest text-on-surface-variant hover:bg-sc-low ${radius.chip}`}
          >
            <RefreshCw
              size={16}
              aria-hidden="true"
              className={prices.pending ? "animate-spin text-primary" : ""}
            />
          </button>

          <a
            href="/"
            className={`tap-44 hidden items-center gap-1.5 border border-outline-variant px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-sc-low xl:inline-flex ${radius.chip}`}
          >
            Klassische Ansicht <ArrowUpRight size={13} aria-hidden="true" />
          </a>
        </div>
      </div>

      <BottomSheet
        open={contextOpen}
        title="Stadt und Kraftstoff"
        onClose={() => setContextOpen(false)}
      >
        <div className="flex flex-wrap gap-4">
          <label
            className={`flex shrink-0 items-center gap-2 border border-outline-variant bg-sc-lowest px-3 py-2 text-xs ${radius.chip}`}
          >
            <MapPin size={14} className="text-primary" aria-hidden="true" />
            <span className="sr-only">Stadt</span>
            <select
              aria-label="Stadt"
              value={activeCity}
              onChange={(event) => {
                setCity(event.target.value);
                setSelectedId("");
              }}
              disabled={!data?.cities.length}
              className="max-w-40 bg-transparent pr-1 text-on-surface"
            >
              {data?.cities.length ? (
                data.cities.map((label) => <option key={label}>{label}</option>)
              ) : (
                <option value="">Keine Stadt eingerichtet</option>
              )}
            </select>
          </label>
          <div
            role="group"
            aria-label="Kraftstoff"
            className="flex shrink-0 flex-wrap items-center gap-2"
          >
            {(["e10", "e5", "diesel"] as Fuel[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={fuel === value}
                onClick={() => setFuel(value)}
                className={`flex h-9 items-center gap-1.5 border px-3 text-sm font-medium transition-colors ${radius.chip} ${
                  fuel === value
                    ? "border-transparent bg-secondary-container text-on-secondary-container"
                    : "border-outline-variant text-on-surface-variant hover:bg-sc-low"
                }`}
              >
                {fuel === value && <Check size={16} aria-hidden="true" />}
                {value === "diesel" ? "Diesel" : value.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setContextOpen(false)}
          className={`m3-btn-now mt-5 px-5 py-2.5 text-sm font-semibold ${radius.chip}`}
        >
          Auswahl übernehmen
        </button>
      </BottomSheet>
    </header>
  );
}

/** Seitenleiste am Desktop: dieselben Einträge wie die untere Leiste mobil. */
function SideNav({
  tab,
  onSelect,
}: {
  tab: TabId;
  onSelect: (id: TabId) => void;
}) {
  return (
    <nav aria-label="Bereiche" className="v3-side">
      <ul className="space-y-1">
        {PRIMARY.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={tab === item.id ? "page" : undefined}
              className={navButtonClass(tab === item.id)}
            >
              <item.icon size={17} aria-hidden="true" />
              {item.label}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-6 px-3 text-xs font-bold uppercase tracking-wider text-on-surface-variant">
        Studio
      </p>
      <ul className="mt-2 space-y-1">
        {STUDIO.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={tab === item.id ? "page" : undefined}
              className={navButtonClass(tab === item.id)}
            >
              <item.icon size={17} aria-hidden="true" />
              {item.label}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-6 px-3 text-xs leading-relaxed text-on-surface-variant">
        Der Neubau beginnt bei <strong>Jetzt</strong>. Woche, Stationen und
        Studio kommen Schritt für Schritt dazu — bis dahin tragen sie ihre
        bisherige Gestaltung und bleiben voll bedienbar.
      </p>
    </nav>
  );
}

/** Untere Leiste mobil: drei Fragen plus „Mehr“ als Blatt. */
function BottomNav({
  tab,
  onSelect,
}: {
  tab: TabId;
  onSelect: (id: TabId) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const studioActive = STUDIO.some((item) => item.id === tab);

  // Beim Wechsel in einen Studio-Bereich schließt das Blatt — ein Tipp
  // bringt zurück, das Blatt ist kein zweiter Navigationsweg.
  useEffect(() => {
    if (studioActive) setMoreOpen(false);
  }, [studioActive]);

  return (
    <div className="lg:hidden">
      <BottomSheet
        open={moreOpen}
        title="Studio"
        onClose={() => setMoreOpen(false)}
      >
        <ul className="divide-y divide-outline-variant">
          {STUDIO.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                aria-current={tab === item.id ? "page" : undefined}
                className="flex w-full items-center gap-3 px-1 py-3 text-left"
              >
                <span
                  className={`grid h-10 w-10 grid-cols-1 place-items-center bg-sc-low text-on-surface-variant ${radius.chip}`}
                  aria-hidden="true"
                >
                  <item.icon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">
                    {item.label}
                  </span>
                  <span className="block text-xs text-on-surface-variant">
                    {item.note}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
      <nav aria-label="Bereiche" className="v3-bottomnav">
        {PRIMARY.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={tab === item.id ? "page" : undefined}
            className={navButtonClass(tab === item.id, true)}
          >
            <item.icon size={19} aria-hidden="true" />
            {item.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-current={studioActive ? "page" : undefined}
          aria-haspopup="dialog"
          className={navButtonClass(studioActive, true)}
        >
          <MoreHorizontal size={19} aria-hidden="true" />
          Mehr
        </button>
      </nav>
    </div>
  );
}

/** Fußzeile aller Bereiche: Quelle, Version, Ehrlichkeits-Zeile. */
function Footer({ ov }: { ov: OverviewState }) {
  const { h } = ov;
  return (
    <footer className="mt-10 border-t border-outline-variant pt-5 text-xs leading-relaxed text-on-surface-variant">
      <p>
        Datenquelle: Markttransparenzstelle für Kraftstoffe (MTS-K) über
        tankerkoenig.de — Lizenz CC BY 4.0 · Abfrage höchstens alle 5 Minuten ·
        Polling-Fenster 06–24 Uhr (Europe/Berlin)
        {h?.version ? ` · TankApp ${h.version}` : ""}
      </p>
      <p className="mt-1.5 flex items-center gap-1.5">
        <Wifi size={12} aria-hidden="true" /> Keine Demo-Preise. Keine
        erfundene Sicherheit.
      </p>
    </footer>
  );
}

export function V3Shell({
  ov,
  children,
}: {
  ov: OverviewState;
  /** Der Bereich selbst — die Hülle kennt nur den Rahmen. */
  children: ReactNode;
}) {
  return (
    <div className="v3-root">
      <a href="#v3-main" className="v3-skip">
        Zum Inhalt springen
      </a>
      <TopBar ov={ov} />
      <div className="v3-body">
        <SideNav tab={ov.tab} onSelect={ov.gotoTab} />
        <main id="v3-main" className="v3-main">
          {children}
          <Footer ov={ov} />
        </main>
      </div>
      <BottomNav tab={ov.tab} onSelect={ov.gotoTab} />
    </div>
  );
}
