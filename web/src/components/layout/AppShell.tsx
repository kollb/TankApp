import { useCallback, useEffect, useState } from "react";
import { BookOpen, FlaskConical, Home, MapPin, Menu, Server, Settings } from "lucide-react";
import { Sheet } from "../ui/Sheet";
import { TopBar } from "./TopBar";
import { useOverview } from "../../state/useOverview";

export type TabId = "overview" | "stationen" | "labor" | "system" | "einstellungen" | "glossar";
const tabs: Array<{ id: TabId; label: string; Icon: typeof Home }> = [
  { id: "overview", label: "Übersicht", Icon: Home },
  { id: "stationen", label: "Stationen", Icon: MapPin },
  { id: "labor", label: "Labor", Icon: FlaskConical },
  { id: "system", label: "System", Icon: Server },
  { id: "einstellungen", label: "Einstellungen", Icon: Settings },
  { id: "glossar", label: "Glossar", Icon: BookOpen },
];
const validTabs = new Set<string>(tabs.map(({ id }) => id));
function routeFromUrl(): TabId {
  const raw = new URLSearchParams(window.location.search).get("tab")?.toLowerCase();
  if (raw === "woche" || raw === "week") return "overview";
  if (raw === "ich") return "einstellungen";
  return raw && validTabs.has(raw) ? raw as TabId : "overview";
}
function normalizeUrl(tab: TabId, replace = false) {
  const params = new URLSearchParams(window.location.search);
  if (tab === "overview" && !params.has("tab")) return;
  params.set("tab", tab);
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}

function NavButton({ id, label, Icon, active, onClick }: { id?: TabId; label: string; Icon: typeof Home; active: boolean; onClick: () => void }) {
  return <button type="button" className={`nav-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} onClick={onClick}>
    <span className="nav-icon"><Icon size={18} /></span><span>{label}</span>
  </button>;
}

export function AppShell() {
  const [tab, setTab] = useState<TabId>(() => routeFromUrl());
  const [menuOpen, setMenuOpen] = useState(false);
  const overview = useOverview();
  useEffect(() => {
    const initial = routeFromUrl();
    setTab(initial);
    normalizeUrl(initial, true);
    const onPopState = () => setTab(routeFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const go = useCallback((next: TabId) => {
    setTab(next);
    setMenuOpen(false);
    normalizeUrl(next);
  }, []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const selected = tabs.find((item) => item.id === tab)!;
  const mainNav = tabs.slice(0, 2);
  const menuTabs = tabs.slice(2);
  const dataAge = overview.overview?.generated_at ?? overview.health?.prices?.fetched_at ?? null;

  return <div className="app-shell">
    <aside className="sidebar" aria-label="Hauptnavigation">
      <a className="brand" href="/?tab=overview"><span className="brand-mark">T</span>TankApp</a>
      <nav className="nav-list">
        {tabs.map(({ id, label, Icon }) => <NavButton key={id} id={id} label={label} Icon={Icon} active={tab === id} onClick={() => go(id)} />)}
      </nav>
      <div className="sidebar-status"><span className={`status-dot ${overview.offline ? "offline" : overview.health ? "online" : ""}`} />{overview.offline ? "Backend offline" : overview.health ? "Backend erreichbar" : "Backend wird geprüft"}<br /><span style={{ paddingLeft: 14 }}>{dataAge ? `Daten ${dataAge}` : "Datenstand —"}</span></div>
    </aside>
    <div className="main-column">
      <TopBar health={overview.health} generatedAt={dataAge} offline={overview.offline} refresh={overview.refresh} />
      <main className="page-content">
        <h1 className="page-heading">{selected.label}</h1>
        {overview.error && <div className="panel" role="status" style={{ marginBottom: 14, color: "var(--accent-neutral)" }}>{overview.error}</div>}
        <section className="panel placeholder-panel" aria-live="polite" aria-busy={overview.loading}>
          <div><strong>{selected.label}</strong><p style={{ margin: "8px 0 0" }}>{tab === "overview" ? overview.loading ? "Daten werden geladen …" : overview.overview ? "Datenstand geladen" : "Warte auf Backend-Daten" : "Ansicht wird im nächsten Umsetzungspaket aufgebaut."}</p></div>
        </section>
      </main>
      <nav className="mobile-nav" aria-label="Mobile Navigation">
        {mainNav.map(({ id, label, Icon }) => <NavButton key={id} id={id} label={label} Icon={Icon} active={tab === id} onClick={() => go(id)} />)}
        <NavButton label="Menü" Icon={Menu} active={menuOpen || menuTabs.some((item) => item.id === tab)} onClick={() => setMenuOpen(true)} />
      </nav>
    </div>
    <Sheet open={menuOpen} title="Bereiche" onClose={closeMenu}>
      <nav className="nav-list" aria-label="Weitere Bereiche">
        {menuTabs.map(({ id, label, Icon }) => <NavButton key={id} id={id} label={label} Icon={Icon} active={tab === id} onClick={() => go(id)} />)}
      </nav>
    </Sheet>
  </div>;
}
