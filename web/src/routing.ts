// GUI-UX-BEFUND U4 + B5: Jede Ansicht ist eine URL.
//
// Vorher kannte die App keinen Bereich in der Adresse: Der Browser-Zurück-
// Knopf vergaß die Tabs, Lesezeichen landeten immer auf „Jetzt“, und der
// Teilen-Knopf teilte Filter statt Antwort. Jetzt reist der Bereich als
// `?tab=…` mit (Labor zusätzlich mit `?section=…` und `?subtab=…`), die Root
// liest ihn beim Start und schreibt ihn bei jedem Wechsel per `pushState` —
// damit das Browser-Zurück funktioniert, ohne dass die Ansicht neu lädt.

import { LAB_SECTIONS, type LabSectionId } from "./lab";
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

/**
 * Alte Sub-Tab-Kennungen (`?subtab=ueberblick|modell|guete|daten`) bleiben
 * als Alias gültig: Sie springen auf den Block, der ihren Inhalt trägt.
 * Seit Batch 2 (0.74.0) hat das Labor keine Sub-Tabs mehr.
 */
export function sectionFromLegacySubTab(
  raw: string | null | undefined,
): LabSectionId | null {
  if (!raw) return null;
  const id = raw.trim().toLowerCase();
  if (id === "ueberblick" || id === "überblick") return "sicherheit";
  if (id === "modell" || id === "model" || id === "parameter" || id === "parameterschrank")
    return "stationen";
  if (id === "guete" || id === "güte" || id === "kalibrierung" || id === "sicherheit")
    return "prognose";
  if (id === "daten" || id === "rohdaten" || id === "roh" || id === "data")
    return "stationen";
  return null;
}

/**
 * Baut die neue Query für einen Bereichswechsel: `tab` wird gesetzt (der
 * Einstieg bleibt als Default außen vor), `section` gilt nur im Labor. Alle
 * übrigen Parameter (Stadt, Kraftstoff, Station …) bleiben erhalten. Die
 * alte Sub-Tab-Kennung wird entfernt — sie reist nur noch als Alias ein
 * (siehe `sectionFromLegacySubTab`).
 */
export function queryWithTab(
  search: string,
  tab: TabId,
  section: LabSectionId | null = null,
): string {
  const params = new URLSearchParams(search);
  const urlTab = TAB_URL_IDS[tab];
  if (urlTab === "jetzt") params.delete("tab");
  else params.set("tab", urlTab);
  if (tab === "labor") {
    if (section) params.set("section", section);
    else params.delete("section");
  } else {
    params.delete("section");
  }
  params.delete("subtab");
  return params.toString();
}
