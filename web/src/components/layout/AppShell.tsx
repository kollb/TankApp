import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Station, StationsResponse } from "../../api/types";
import { useAppContext } from "../../state/AppContext";
import { OverviewPage } from "../../features/overview/OverviewPage";
import { LabPage } from "../../features/lab/LabPage";
import { SettingsPage } from "../../features/settings/SettingsPage";
import { SystemPage } from "../../features/system/SystemPage";
import { GlossaryPage } from "../../features/glossary/GlossaryPage";
import { StationsPage } from "../../features/stations/StationsPage";
import "../../features/overview/overview.css";
import { BookOpen, FlaskConical, Home, MapPin, Menu, Server, Settings } from "lucide-react";
import { Sheet } from "../ui/Sheet";
import { TopBar } from "./TopBar";
import { useOverview } from "../../state/useOverview";
import { UpdateBanner } from "../UpdateBanner";
import { routeFromSearch, urlForTab, type TabId } from "../../routing";

const tabs: Array<{ id: TabId; label: string; Icon: typeof Home }> = [
  { id: "overview", label: "Übersicht", Icon: Home },
  { id: "stationen", label: "Stationen", Icon: MapPin },
  { id: "labor", label: "Labor", Icon: FlaskConical },
  { id: "system", label: "System", Icon: Server },
  { id: "einstellungen", label: "Einstellungen", Icon: Settings },
  { id: "glossar", label: "Glossar", Icon: BookOpen },
];
function normalizeUrl(tab: TabId, replace = false) {
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const next = urlForTab(current, tab);
  if (replace) window.history.replaceState(null, "", next);
  else if (next !== current) window.history.pushState(null, "", next);
}

function NavButton({ id, label, Icon, active, onClick }: { id?: TabId; label: string; Icon: typeof Home; active: boolean; onClick: () => void }) {
  return <button type="button" className={`nav-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} onClick={onClick}>
    <span className="nav-icon"><Icon size={18} /></span><span>{label}</span>
  </button>;
}

export function AppShell() {
  const [tab, setTab] = useState<TabId>(() => routeFromSearch(window.location.search));
  const [menuOpen, setMenuOpen] = useState(false);
  const { city, fuel, refreshKey } = useAppContext();
  const overview = useOverview();
  const [stations, setStations] = useState<Station[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ fuel });
    if (city) query.set("city", city);
    api.get<StationsResponse>(`stations?${query}`, controller.signal).then((payload) => setStations(Array.isArray(payload.stations) ? payload.stations : [])).catch(() => { if (!controller.signal.aborted) setStations([]); });
    return () => controller.abort();
  }, [city, fuel, refreshKey]);
  useEffect(() => {
    const initial = routeFromSearch(window.location.search);
    setTab(initial);
    normalizeUrl(initial, true);
    const onPopState = () => setTab(routeFromSearch(window.location.search));
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
        <UpdateBanner />
        <h1 className="page-heading">{selected.label}</h1>
        {overview.error && tab !== "overview" && tab !== "stationen" && <div className="panel" role="status" style={{ marginBottom: 14, color: "var(--accent-neutral)" }}>{overview.error}</div>}
        {tab === "overview" ? <OverviewPage data={overview} stations={stations} navigate={(next) => go(next)} /> : tab === "stationen" ? <StationsPage /> : tab === "labor" ? <LabPage /> : tab === "system" ? <SystemPage health={overview.health} /> : tab === "einstellungen" ? <SettingsPage /> : <GlossaryPage />}
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
