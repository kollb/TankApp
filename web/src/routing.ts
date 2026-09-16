// GUI-UX-BEFUND U4: Jede Ansicht ist eine URL.
//
// Vorher kannte die App keinen Bereich in der Adresse: Der Browser-Zurück-
// Knopf vergaß die Tabs, Lesezeichen landeten immer auf „Jetzt“, und der
// Teilen-Knopf teilte Filter statt Antwort. Jetzt reist der Bereich als
// `?tab=…` mit (Labor zusätzlich mit `?section=…`), die Root liest ihn beim
// Start und schreibt ihn bei jedem Wechsel per `pushState` — damit das
// Browser-Zurück funktioniert, ohne dass die Ansicht neu lädt.
//
// Pfad-Routing (`/jetzt`) wäre die nächste Stufe; Query-Parameter reichen
// hier, weil die App eine einzelne Shell ohne Server-Routen ist und die
// bestehenden Share-Parameter (`city`, `fuel`, …) dieselbe Query teilen.

import { LAB_SECTIONS, type LabSectionId } from "./lab";
import { type ShareTab } from "./data";

/** Die Hauptbereiche der GUI (UI-NEUENTWURF §4.1) — interne Kennung. */
export type TabId =
  | "jetzt"
  | "stations"
  | "week"
  | "ich"
  | "labor"
  | "system"
  | "glossary";

/** Interne Kennung → alltagsdeutscher Name in der URL. */
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

/** URL-Wert → Bereich; ungültige oder fehlende Werte landen im Einstieg. */
export function tabFromUrlId(raw: string | null | undefined): TabId {
  if (raw && raw in URL_TAB_IDS) return URL_TAB_IDS[raw as ShareTab];
  return "jetzt";
}

/** URL-Wert → Labor-Abschnitt; alles Unbekannte bleibt ehrlich `null`. */
export function sectionFromUrlId(raw: string | null | undefined): LabSectionId | null {
  if (!raw) return null;
  return LAB_SECTIONS.some((entry) => entry.id === raw)
    ? (raw as LabSectionId)
    : null;
}

/**
 * Baut die neue Query für einen Bereichswechsel: `tab` wird gesetzt (der
 * Einstieg bleibt als Default außen vor), `section` gilt nur im Labor.
 * Alle übrigen Parameter (Stadt, Kraftstoff, Station …) bleiben erhalten.
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
  if (tab === "labor" && section) params.set("section", section);
  else params.delete("section");
  return params.toString();
}
