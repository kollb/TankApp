// GUI-UX-BEFUND U4 + B5: Jede Ansicht ist eine URL.
//
// Vorher kannte die App keinen Bereich in der Adresse: Der Browser-Zurück-
// Knopf vergaß die Tabs, Lesezeichen landeten immer auf „Jetzt“, und der
// Teilen-Knopf teilte Filter statt Antwort. Jetzt reist der Bereich als
// `?tab=…` mit (Labor zusätzlich mit `?section=…` und `?subtab=…`), die Root
// liest ihn beim Start und schreibt ihn bei jedem Wechsel per `pushState` —
// damit das Browser-Zurück funktioniert, ohne dass die Ansicht neu lädt.

import { LAB_SECTIONS, LAB_SUBTABS, labSubTabFromUrlId, type LabSectionId, type LabSubTabId } from "./lab";
import { type ShareTab } from "./data";

export type TabId =
  | "jetzt"
  | "stations"
  | "week"
  | "ich"
  | "labor"
  | "system"
  | "glossary";

const TAB_URL_IDS: Record<TabId, ShareTab> = {
  jetzt: "jetzt",
  stations: "stationen",
  week: "woche",
  ich: "ich",
  labor: "labor",
  system: "system",
  glossary: "glossar",
};

const URL_TAB_IDS: Record<ShareTab, TabId> = {
  jetzt: "jetzt",
  stationen: "stations",
  woche: "week",
  ich: "ich",
  labor: "labor",
  system: "system",
  glossar: "glossary",
};

export function tabToUrlId(tab: TabId): ShareTab {
  return TAB_URL_IDS[tab];
}

export function tabFromUrlId(raw: string | null | undefined): TabId {
  if (raw && raw in URL_TAB_IDS) return URL_TAB_IDS[raw as ShareTab];
  return "jetzt";
}

export function sectionFromUrlId(raw: string | null | undefined): LabSectionId | null {
  if (!raw) return null;
  return LAB_SECTIONS.some((entry) => entry.id === raw) ? (raw as LabSectionId) : null;
}

export function subtabFromUrlId(raw: string | null | undefined): LabSubTabId | null {
  return labSubTabFromUrlId(raw);
}

export function isLabSubTabId(value: string): value is LabSubTabId {
  return LAB_SUBTABS.some((entry) => entry.id === value);
}

/**
 * Baut die neue Query für einen Bereichswechsel: `tab` wird gesetzt (der
 * Einstieg bleibt als Default außen vor), `section` und `subtab` gelten nur
 * im Labor. Alle übrigen Parameter (Stadt, Kraftstoff, Station …) bleiben
 * erhalten.
 */
export function queryWithTab(
  search: string,
  tab: TabId,
  section: LabSectionId | null = null,
  subtab: LabSubTabId | null = null,
): string {
  const params = new URLSearchParams(search);
  const urlTab = TAB_URL_IDS[tab];
  if (urlTab === "jetzt") params.delete("tab");
  else params.set("tab", urlTab);
  if (tab === "labor") {
    if (section) params.set("section", section);
    else params.delete("section");
    if (subtab) params.set("subtab", subtab);
    else params.delete("subtab");
  } else {
    params.delete("section");
    params.delete("subtab");
  }
  return params.toString();
}
