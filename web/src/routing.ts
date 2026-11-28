export type TabId =
  | "overview"
  | "stationen"
  | "labor"
  | "system"
  | "einstellungen"
  | "glossar";

const VALID_TABS = new Set<TabId>([
  "overview",
  "stationen",
  "labor",
  "system",
  "einstellungen",
  "glossar",
]);

/** Resolve the visible area while keeping old shared links useful. */
export function routeFromSearch(search: string): TabId {
  const raw = new URLSearchParams(search).get("tab")?.toLowerCase();
  if (raw === "woche" || raw === "week") return "overview";
  if (raw === "ich") return "einstellungen";
  return raw && VALID_TABS.has(raw as TabId) ? (raw as TabId) : "overview";
}

/** Build a same-origin URL without losing filters, section anchors, or hashes. */
export function urlForTab(currentUrl: string, tab: TabId): string {
  const url = new URL(currentUrl, "http://tankapp.invalid");
  const params = new URLSearchParams(url.search);
  if (tab === "overview" && !params.has("tab")) {
    return `${url.pathname}${url.search}${url.hash}`;
  }
  params.set("tab", tab);
  const query = params.toString();
  return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
}
