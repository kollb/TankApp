// Stationen — der Preis-Atlas (docs/UI-NEUENTWURF.md §5.2).
//
// Feste Reihenfolge, nie anders:
//   ① Suche + Filter (⌘K springt hierher)
//   ② Karte mit €-Pins (Server-Netto, Urteil-Farben)
//   ③ Liste (Sortierung Netto-€ | Preis | Entfernung; Referenz markiert)
//   ④ Station-Detail (Preis, Verlauf 7 Tage, Tagesrhythmus, Einordnung)
//   ⑤ Vergleich (A gegen B) — eigener Modus, kein Rechnen im Kopf
//   — darunter die Frische-Fußzeile (fester Platz, jede Ansicht)
//
// Seit 0.36.0 (Nutzer-Feedback 14.09.2026):
//   * Jede Zeile hat einen eigenen „Verlauf“-Knopf — der Verlauf war
//     vorher nur über die (nicht offensichtliche) Zeilenauswahl zu
//     erreichen und lag bei zehn Stationen weit unter dem Falz.
//   * Der Verlauf ist derselbe Diagramm-Baustein wie im Stations-Labor
//     (`LineChart` mit Achsen, 24 h / 3 Tage / 7 Tage umschaltbar) statt
//     einer gequetschten Mini-Grafik.
//   * „A gegen B“ startet mit der Vorauswahl Top 1 gegen Top 2 der
//     aktuellen Sortierung, änderbar über beide Auswahlfelder.
//
// Die View rendert, sie entscheidet nichts (D1): Referenz, Netto-€-
// Zeilen, Einordnung und Vergleich kommen aus `stations.ts` und sind
// dort getestet. Der Server bleibt Quelle für Strecke und Netto (B6/H1)
// — wo keine Route liegt, steht ehrlich „ohne Umweg“, nie eine
// client-seitige Rechnung.
//
// Bewusster Schnitt (Checkliste 1.9/1.10): Die 24-h-Sparkline je Zeile
// braucht pro Station einen eigenen Series-Poll; bis die v2-Atlas-Antwort
// (Checkliste 1.10) steht, zeigt nur die ausgewählte Station ihr
// Mini-Verlauf (aus dem vorhandenen Tagesstreifen), die anderen ehrlich
// keines.

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  LineChart as LineChartIcon,
  MapPin,
  Search,
  Scale,
  Star,
  X,
} from "lucide-react";
import { FreshnessLine } from "../components/FreshnessLine";
import { useChartPalette } from "../chartTheme";
import { LineChart } from "../components/LineChart";
import { Level1Sheet } from "../components/Level1Sheet";
import { LoadError } from "../components/LoadError";
import { SkeletonPanel } from "../components/Skeleton";
import { StationMap } from "../components/StationMap";
import { Empty, panel } from "../components/ui";
import {
  ageWord,
  autoTimeTicks,
  centPerLiter,
  euro,
  euroPerLiter,
  deTrimmed,
  kilometersLabel,
  timeLabel,
  timeSpanLabel,
  type DecideResult,
  type Point,
  type ResourceState,
  type Station,
  type Stations,
} from "../data";
import {
  atlasEur,
  ATLAS_SORTS,
  atlasRows,
  atlasExplanation,
  compareStationsPair,
  dayMedianPoints,
  dayRhythmLine,
  referenceStation,
  sortAtlasRows,
  stationContextLines,
  stationsFreshness,
  type AtlasRow,
  type AtlasSort,
} from "../stations";
import { labSectionButtonLabel, type LabSectionId } from "../lab";
import type { StripCell } from "../strip";

export interface StationenViewProps {
  activeCity: string;
  data: Stations | null;
  stations: Station[];
  price: (row: Station) => number | null;
  elapsed: number;
  online: boolean;
  selectedId: string;
  setSelectedId: (id: string) => void;
  pinnedIds: string[];
  togglePin: (stationId: string) => void;
  pinNote: string | null;
  /** decide-Antwort der Overview — Server-Netto-€ und Schwellen. */
  decideRes: ResourceState<DecideResult>;
  /** Tagesstreifen der ausgewählten Station (Overview → day). */
  stripCells: StripCell[];
  /** Verlauf der ausgewählten Station (eigener Poll, 60 s). */
  series7d: ResourceState<{ points: Point[]; error_code: string | null } | null>;
  /**
   * Zeitraum des Verlaufs in Stunden (24 / 72 / 168) — derselbe Umschalter
   * wie im Stations-Labor. Die Ansicht wählt nur aus; geladen wird in der
   * Dashboard-Root (ein Poll, eine Wahrheit).
   */
  seriesSpan: number;
  onSeriesSpan: (hours: number) => void;
  liters: number;
  timeValue: number;
  timeValueUsed: number;
  autoZ: { z: number; isPeak: boolean };
  /** Zeitwert-Chip: schreibt den Was-wäre-wenn-Override (kein Setting). */
  onTimeValue: (value: number | null) => void;
  pricesAt: string | null;
  onRetry: () => void;
  /** In die Jetzt- oder Ich-Ansicht springen (Schritte/Verweise). */
  onNavigate: (target: "jetzt" | "ich" | "system") => void;
  /** Ebene 2 ansteuern: der Labor-Abschnitt, der diese Zahl beweist (§7). */
  onDeepen?: (section: LabSectionId) => void;
  /** ⌘K-Signal aus der Dashboard-Root: > 0 = Fokus in die Suche. */
  searchFocusSignal: number;
  /** Nur für Tests; sonst Date.now(). */
  now?: number;
}

/** Zeitraum-Umschalter des Verlaufs — Wortlaut aus einer Quelle (V5). */
const SPANS: Array<{ hours: number; label: string }> = [
  { hours: 24, label: timeSpanLabel(24) },
  { hours: 72, label: timeSpanLabel(72) },
  { hours: 168, label: timeSpanLabel(168) },
];

function spanLabel(hours: number): string {
  return SPANS.find((span) => span.hours === hours)?.label ?? `${hours} Stunden`;
}

/** Mini-Verlauf (24 h) einer Zeile: 19 Punkte aus dem Tagesstreifen. */
function Sparkline({ cells }: { cells: StripCell[] }) {
  const values = cells.map((cell) => cell.value);
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 3) return null;
  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = max - min || 1;
  const w = 96;
  const h = 24;
  const step = w / Math.max(1, values.length - 1);
  const pts: string[] = [];
  values.forEach((value, i) => {
    if (value === null) return;
    const x = i * step;
    const y = h - ((value - min) / span) * (h - 4) - 2;
    pts.push(`${x},${y}`);
  });
  if (pts.length < 2) return null;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="Preisverlauf der letzten 24 Stunden (ausgeblendete Punkte = keine offene Meldung)"
      className="shrink-0"
    >
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-sky-400/80"
      />
    </svg>
  );
}

export function StationenView(props: StationenViewProps) {
  const {
    activeCity,
    data,
    decideRes,
    elapsed,
    onNavigate,
    onRetry,
    onTimeValue,
    online,
    pinNote,
    pinnedIds,
    price,
    pricesAt,
    searchFocusSignal,
    selectedId,
    series7d,
    seriesSpan,
    onSeriesSpan,
    setSelectedId,
    stations,
    stripCells,
    timeValue,
    timeValueUsed,
    autoZ,
    liters,
    now,
  } = props;
  // C2 (übernommen): Suche/Markenfilter/Sortierung sind Ansichts-Zustand.
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState("");
  // M1: Filter-Chip „offen“ aus dem Neuentwurf (§5.2): nur Stationen mit
  // aktuellem Preis für den gewählten Kraftstoff — „—“-Zeilen bleiben
  // andernfalls sichtbar und sortieren nach hinten.
  const [openOnly, setOpenOnly] = useState(false);
  const [sort, setSort] = useState<AtlasSort>("net");
  // Vergleichs-Modus: B-Station (A = die gewählte Station).
  // A gegen B: "" heißt „Vorauswahl Top 1 gegen Top 2 der Sortierung“.
  const [compareA, setCompareA] = useState<string>("");
  const [compareB, setCompareB] = useState<string>("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const compareRef = useRef<HTMLDivElement | null>(null);

  // ⌘K: die Root erhöht das Signal, hier landet der Fokus in der Suche.
  useEffect(() => {
    if (searchFocusSignal > 0) searchRef.current?.focus();
  }, [searchFocusSignal]);

  const decide = decideRes.data ?? null;
  const problemCode =
    decide?.error_code ?? (decideRes.error ? decideRes.errorCode : null);

  const ref = referenceStation(stations, price, selectedId, pinnedIds);
  const rows = atlasRows({
    stations,
    priceOf: price,
    liters,
    selectedId,
    pinnedIds,
    serverAlts: decide?.alternatives_nearby ?? [],
    worthThreshold:
    typeof decide?.thresholds?.active?.elsewhere_net_eur === "number"
      ? decide.thresholds.active.elsewhere_net_eur
      : null,
    borderlineThreshold:
      typeof decide?.thresholds?.active?.elsewhere_borderline_eur === "number"
        ? decide.thresholds.active.elsewhere_borderline_eur
        : null,
  });
  const byId = new Map(rows.map((row) => [row.station.station_id, row]));
  const brands = Array.from(
    new Set(stations.map((row) => row.brand).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, "de"));

  const filtered = rows.filter((row) => {
    const needle = query.trim().toLowerCase();
    if (
      needle &&
      !row.station.name.toLowerCase().includes(needle) &&
      !row.station.brand.toLowerCase().includes(needle)
    )
      return false;
    if (brand && row.station.brand !== brand) return false;
    if (openOnly && row.price === null) return false;
    return true;
  });
  const sorted = sortAtlasRows(filtered, sort);

  // Ohne explizite Auswahl (z. B. erste Ansicht) gilt dieselbe Referenz wie
  // die Netto-Referenz: die nächste frische Station. So stimmt die
  // Detail-Kachel mit der Empfehlung aus „Jetzt“ und der Netto-Spalte.
  const selected =
    byId.get(selectedId) ?? (ref ? byId.get(ref.station.station_id) ?? null : null);
  const referenceRow = ref ? (byId.get(ref.station.station_id) ?? null) : null;
  const contextLines = selected
    ? stationContextLines(selected, referenceRow)
    : [];
  // Vorauswahl „Top 1 gegen Top 2“: die ersten zwei Zeilen der aktuellen
  // Sortierung mit frischem Preis. Beide Felder sind änderbar; ein Klick in
  // der Liste setzt A.
  const topRows = sorted.filter((row) => row.price !== null);
  const defaultA = topRows[0] ?? null;
  const compareRowA = byId.get(compareA) ?? defaultA ?? selected;
  const defaultB =
    topRows.find(
      (row) => row.station.station_id !== compareRowA?.station.station_id,
    ) ?? null;
  const compareRowB = byId.get(compareB) ?? defaultB;
  const comparePair =
    compareRowA &&
    compareRowB &&
    compareRowB.station.station_id !== compareRowA.station.station_id
      ? compareStationsPair(
          compareRowA.station,
          compareRowB.station,
          price(compareRowA.station),
          price(compareRowB.station),
          liters,
          decide?.alternatives_nearby.find(
            (alt) => alt.station_id === compareRowB.station.station_id,
          ) ?? null,
        )
      : null;
  const compareIsDefault =
    compareA === "" &&
    compareB === "" &&
    compareRowA !== null &&
    compareRowA.station.station_id === defaultA?.station.station_id;

  /** Zeile wählen — und A des Vergleichs auf dieselbe Station ziehen. */
  const openStation = (row: AtlasRow) => {
    setSelectedId(row.station.station_id);
    setCompareA(row.station.station_id);
  };

  /** „Verlauf“ einer Zeile: wählen und zum Diagramm scrollen. */
  const openHistory = (row: AtlasRow) => {
    openStation(row);
    // Ohne Scrollen liegt der Verlauf bei zehn Stationen unter dem Falz —
    // genau das war der Vorwurf „nicht anklickbar“ (14.09.2026).
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const freshCount = rows.filter((row) => row.price !== null).length;
  const freshness = stationsFreshness(pricesAt, now);
  // S0: noch keine Stationen — einrichten statt leere Fläche.
  const setup = stations.length === 0 && !decideRes.error;
  const explanation = atlasExplanation({
    reference: ref ? { name: ref.station.name } : null,
    reason: ref?.reason ?? null,
    liters,
    timeValueLabel:
      timeValue > 0 ? `${deTrimmed(timeValue)} €/h` : `Auto (${deTrimmed(timeValueUsed)} €/h)`,
    pricesAt,
    now,
  });

  // T11/T13: Alter in denselben Worten wie der Rest der App („vor 12
  // Minuten“, nicht „vor 12 Min.“) — die Wortform kommt aus `data.ts`.
  const ageLabel = (row: AtlasRow): string => {
    if (row.station.observed_at === null) return "Noch keine Meldung";
    const age =
      row.ageMinutes !== null
        ? Math.max(0, Math.floor(row.ageMinutes + elapsed))
        : null;
    if (age === null) return "Stand unbekannt";
    if (!online || age > 30) return "veralteter Stand";
    return ageWord(age);
  };

  return (
    <section aria-labelledby="stationen-title">
      <h1 id="stationen-title" className="text-2xl font-bold tracking-tight text-white">
        Stationen
      </h1>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">
        Karte, Liste, Verlauf, Vergleich — gemessen an einer sichtbaren Referenz.
      </p>

      {/* ① Suche + Filter */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="flex flex-1 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs">
          <Search size={14} className="shrink-0 text-slate-500" aria-hidden="true" />
          <span className="sr-only">Station durchsuchen (Strg+K)</span>
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Station suchen — Strg+K / ⌘K"
            aria-label="Station nach Name oder Marke durchsuchen"
            className="w-full bg-slate-950 text-slate-100 placeholder:text-slate-600 focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Suche leeren"
              className="text-slate-500 hover:text-slate-300"
            >
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOpenOnly((value) => !value)}
            aria-pressed={openOnly}
            className={`rounded-lg border px-2.5 py-2 text-xs transition-colors ${
              openOnly
                ? "border-emerald-500/60 bg-emerald-900/40 text-emerald-200"
                : "border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-200"
            }`}
            title="Filter: nur offene Stationen"
          >
            {openOnly ? "nur offene" : "alle Stationen"}
          </button>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <span className="sr-only">Marke filtern</span>
            <select
              aria-label="Nach Marke filtern"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100"
            >
              <option value="">Alle Marken</option>
              {brands.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label
            className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-300"
            title="Zeitwert für die Umweg-Rechnung"
          >
            <span className="sr-only">Zeitwert für die Umweg-Rechnung</span>
            Zeit:{" "}
            <select
              aria-label="Zeitwert (€/h) für die Umweg-Rechnung"
              value={timeValue === 0 ? "0" : String(timeValue)}
              onChange={(e) => {
                const value = Number(e.target.value);
                onTimeValue(Number.isFinite(value) ? value : null);
              }}
              className="bg-slate-950 pr-1 text-slate-100"
            >
              <option value="0">
                Auto ({deTrimmed(timeValueUsed)} €/h ·{" "}
                {autoZ.isPeak ? "Stoßzeit" : "Nebenzeit"})
              </option>
              {[5, 8, 10, 12, 15, 20, 25, 30].map((z) => (
                <option key={z} value={z}>
                  {z} €/h
                </option>
              ))}
            </select>
          </label>
        </div>
        {/* V2: Die beiden Filter-Regeln standen nur im Tooltip (V1–V5, V2) —
            ohne Maus oder Tastaturfokus waren sie unsichtbar. */}
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          „offen“ zeigt nur Stationen mit aktuellem Preis für den gewählten
          Kraftstoff. Der Zeitwert wirkt auf die Umweg-Rechnung des Servers —
          als Was-wäre-wenn, das Profil bleibt unverändert.
        </p>
      </div>

      {/* ② Karte */}
      {setup ? (
        <div className={`${panel} mt-4 p-5 sm:p-7`}>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-xs font-bold text-slate-300">
            <MapPin size={13} aria-hidden="true" />
            Noch keine Stationen
          </span>
          <h2 className="mt-3 text-xl font-bold text-white">Erst ein Set, dann der Atlas</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300">
            Sobald das gemeinsame Polling-Set Stationen enthält, stehen hier
            Karte, Liste und Vergleich — mit den aktuellen Preisen.
          </p>
          <button
            onClick={() => onNavigate("system")}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"
          >
            Einrichtung ansehen
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <>
          <div className={`${panel} mt-4 overflow-hidden p-0`}>
            <StationMap
              stations={stations}
              selectedId={selected?.station.station_id ?? selectedId}
              setSelectedId={setSelectedId}
              alternatives={decide?.alternatives_nearby ?? []}
              primaryStation={decide?.primary?.station}
              anchor={data?.anchors?.[activeCity] ?? null}
              onNavigate={(url) => {
                window.open(url, "_blank", "noopener,noreferrer");
              }}
              title="Karte — Pin = Netto-€ gegenüber der Referenz"
            />
          </div>

          {/* ③ Liste */}
          <div className={`${panel} mt-4 overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-slate-200">
                  {stations.length} Stationen
                </span>
                <span className="text-xs text-slate-500">
                  {freshCount} mit frischem Preis
                </span>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1 text-xs font-bold">
                {ATLAS_SORTS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setSort(option.value)}
                    aria-pressed={sort === option.value}
                    className={`rounded-md px-2.5 py-1 transition-colors ${
                      sort === option.value
                        ? "bg-slate-800 text-emerald-300"
                        : "text-slate-500 hover:text-slate-200"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {pinNote && (
              <p
                role="status"
                aria-live="polite"
                className="border-b border-slate-800 px-4 py-2 text-xs leading-snug text-amber-300"
              >
                {pinNote}
              </p>
            )}
            {decideRes.pending && rows.length === 0 ? (
              <div className="p-4">
                <SkeletonPanel lines={4} label="Preise werden geladen" />
              </div>
            ) : data === null && decideRes.error ? (
              // Roter Zustand nur, wenn die Datenquelle selbst nicht
              // antwortet. Ein decide-`error_code` (z. B. „polling_missing“
              // auf einem frischen Server) ist eine *Konsequenz* fehlender
              // Daten — die Liste zeigt dann den ehrlichen Leerzustand,
              // keinen Fehler.
              <div className="p-4">
                <LoadError
                  errorCode={decideRes.errorCode}
                  fallback="Preise derzeit nicht erreichbar."
                  onRetry={onRetry}
                />
              </div>
            ) : stations.length === 0 ? (
              <div className="p-5">
                <Empty>
                  Noch keine Stationen — erst muss ein gemeinsames
                  Polling-Set laufen (System), dann füllt sich die Liste
                  automatisch.
                </Empty>
              </div>
            ) : freshCount === 0 ? (
              <div className="p-5">
                <Empty>
                  Noch kein frischer Preis — der Collector meldet im
                  5-Minuten-Takt (Fenster 06–24 Uhr). Die Liste füllt sich
                  automatisch, keine Aktion nötig.
                </Empty>
              </div>
            ) : sorted.length === 0 ? (
              <div className="p-5">
                <Empty>
                  Keine Station passt zu Suche oder Markenfilter — Suche
                  leeren zeigt wieder alle {stations.length} Stationen.
                </Empty>
              </div>
            ) : (
              <div className="divide-y divide-slate-800/80">
                {sorted.map((row) => {
                  const eur = atlasEur(row);
                  const isSel =
                    selected !== null &&
                    row.station.station_id === selected.station.station_id;
                  return (
                    <div
                      key={row.station.station_id}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-slate-800/40 ${isSel ? "bg-emerald-500/[.04]" : ""}`}
                    >
                      <button
                        onClick={() => openStation(row)}
                        aria-pressed={isSel}
                        aria-label={`${row.station.name} als Referenz und Detail wählen`}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                            row.isReference
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                              : "border-slate-700 bg-slate-800 text-slate-500"
                          }`}
                        >
                          <MapPin size={15} aria-hidden="true" />
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                            <span className="truncate">{row.station.name}</span>
                            {row.isReference && (
                              <span className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-emerald-300">
                                Referenz
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                            <span>{row.station.brand || "Freie Station"}</span>
                            {row.distKm != null && (
                              <span className="font-mono">
                                {kilometersLabel(row.distKm, 1)}
                              </span>
                            )}
                            <span>{ageLabel(row)}</span>
                          </span>
                        </span>
                      </button>
                      <span className="flex shrink-0 items-center gap-3">
                        {isSel && <Sparkline cells={stripCells} />}
                        <span className="text-right">
                          <span
                            className={`block font-mono text-sm font-bold tabular-nums ${row.isReference ? "text-emerald-300" : "text-slate-200"}`}
                          >
                            {euroPerLiter(row.price)}
                          </span>
                          {eur && (
                            <span
                              className={`block text-xs font-semibold tabular-nums ${
                                eur.tone === "save"
                                  ? "text-emerald-400"
                                  : eur.tone === "cost"
                                    ? "text-rose-300"
                                    : "text-slate-400"
                              }`}
                            >
                              {eur.text}
                              {row.netEur === null && !row.isReference
                                ? " ohne Umweg"
                                : row.netEur !== null
                                  ? " netto"
                                  : ""}
                            </span>
                          )}
                        </span>
                        <button
                          onClick={() => openHistory(row)}
                          aria-label={`Verlauf von ${row.station.name} ansehen`}
                          title={`Verlauf · ${spanLabel(seriesSpan)} öffnen`}
                          className="shrink-0 rounded-lg border border-slate-700 p-2 text-slate-400 transition-colors hover:border-sky-500/40 hover:text-sky-300"
                        >
                          <LineChartIcon size={14} aria-hidden="true" />
                        </button>
                        <button
                          onClick={() => props.togglePin(row.station.station_id)}
                          aria-pressed={row.isPinned}
                          aria-label={
                            row.isPinned
                              ? `${row.station.name} aus Stamm-Stationen entfernen`
                              : `${row.station.name} als Stamm-Station merken`
                          }
                          title={
                            row.isPinned
                              ? "Stamm-Station lösen"
                              : "Als Stamm-Station merken — wird Referenz-Kandidat und sortiert oben"
                          }
                          className={`shrink-0 rounded-lg border p-2 transition-colors ${
                            row.isPinned
                              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                              : "border-slate-700 text-slate-500 hover:border-amber-500/40 hover:text-amber-300"
                          }`}
                        >
                          <Star size={14} fill={row.isPinned ? "currentColor" : "none"} aria-hidden="true" />
                        </button>
                        {row.station.maps_url ? (
                          <a
                            href={row.station.maps_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Route zu ${row.station.name} öffnen`}
                            title="Route öffnen"
                            className="shrink-0 rounded-lg border border-slate-700 p-2 text-slate-400 hover:border-emerald-500/40 hover:text-emerald-400"
                          >
                            <ArrowUpRight size={14} aria-hidden="true" />
                          </a>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ④ Station-Detail */}
          {selected && (
            <div ref={detailRef} className={`${panel} mt-4 overflow-hidden`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <MapPin size={15} className="text-emerald-400" aria-hidden="true" />
                  {selected.station.name}
                  <span className="font-mono text-xs font-normal text-slate-500">
                    {selected.station.brand || "Freie Station"}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>{ageLabel(selected)}</span>
                  {selected.station.maps_url && (
                    <a
                      href={selected.station.maps_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-slate-700 px-2.5 py-1.5 font-semibold text-slate-200 hover:border-emerald-500/40 hover:text-emerald-300"
                    >
                      Route
                    </a>
                  )}
                  <button
                    onClick={() => {
                      setCompareA(selected.station.station_id);
                      setCompareB("");
                      compareRef.current?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                    }}
                    className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 font-semibold text-sky-300 hover:bg-sky-500/20"
                  >
                    A gegen B
                  </button>
                </div>
              </div>
              <div className="grid gap-4 p-4 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-xs uppercase tracking-wider text-slate-500">
                    Preis
                  </p>
                  <p className="mt-1 font-mono text-lg font-bold text-slate-100 tabular-nums">
                    {euroPerLiter(selected.price)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {selected.station.status === "closed"
                      ? "Geschlossen"
                      : "Aktuelle offene Meldung"}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-xs uppercase tracking-wider text-slate-500">
                    Tagesrhythmus
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-300">
                    {dayRhythmLine(stripCells) ??
                      "Zu wenige offene Messstunden für ein Muster — keine Erfindung."}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-xs uppercase tracking-wider text-slate-500">
                    Einordnung
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-slate-300">
                    {contextLines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              </div>
              {/* Verlauf (eigener Poll, nur für die gewählte Station) —
                  seit 0.36.0 derselbe Chart-Baustein wie im Stations-Labor
                  (Achsen, Zeitraum-Umschalter) statt einer Mini-Grafik. */}
              <div className="border-t border-slate-800 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-wider text-slate-500">
                    Verlauf · letzte {spanLabel(seriesSpan)}
                  </p>
                  <div
                    role="group"
                    aria-label="Zeitraum des Verlaufs"
                    className="flex rounded-lg border border-slate-800 bg-slate-950 p-1 text-xs font-semibold"
                  >
                    {SPANS.map((span) => (
                      <button
                        key={span.hours}
                        aria-pressed={seriesSpan === span.hours}
                        onClick={() => onSeriesSpan(span.hours)}
                        className={`rounded px-2 py-1 transition-colors ${
                          seriesSpan === span.hours
                            ? "bg-slate-800 text-sky-400"
                            : "text-slate-500 hover:text-slate-200"
                        }`}
                      >
                        {span.label}
                      </button>
                    ))}
                  </div>
                </div>
                {series7d.error ? (
                  <LoadError
                    errorCode={series7d.data?.error_code || series7d.errorCode}
                    fallback={`Der Verlauf der letzten ${spanLabel(seriesSpan)} konnte nicht geladen werden.`}
                    onRetry={onRetry}
                    retryLabel="Verlauf neu laden"
                    compact
                  />
                ) : series7d.pending && !series7d.data ? (
                  <SkeletonPanel lines={2} title={false} label="Verlauf wird geladen" />
                ) : (series7d.data?.points ?? []).length === 0 ? (
                  <Empty>
                    Noch keine Historie für diese Station — der Verlauf füllt
                    sich mit den nächsten Collector-Läufen.
                  </Empty>
                ) : (
                  <SeriesChart
                    points={series7d.data?.points ?? []}
                    spanHours={seriesSpan}
                  />
                )}
              </div>
            </div>
          )}

          {/* ⑤ A gegen B — mit Vorauswahl Top 1 gegen Top 2 */}
          {selected && (
            <div ref={compareRef} className={`${panel} mt-4 overflow-hidden`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <Scale size={15} className="text-sky-400" aria-hidden="true" />
                  A gegen B
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  {compareIsDefault && (
                    <span className="rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5">
                      Vorauswahl: Top 1 gegen Top 2
                    </span>
                  )}
                  {(compareA !== "" || compareB !== "") && (
                    <button
                      onClick={() => {
                        setCompareA("");
                        setCompareB("");
                      }}
                      className="font-semibold text-sky-300 underline underline-offset-4 hover:text-sky-200"
                    >
                      Vorauswahl wiederherstellen
                    </button>
                  )}
                </div>
              </div>
              <div className="grid gap-2 border-b border-slate-800 p-4 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="font-bold text-sky-300">A</span>
                  <span className="sr-only">Station A wählen</span>
                  <select
                    aria-label="Station A für den Vergleich wählen"
                    value={compareA}
                    onChange={(e) => setCompareA(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
                  >
                    <option value="">
                      {defaultA
                        ? `Vorauswahl: ${defaultA.station.name}`
                        : "Vorauswahl: keine Station mit Preis"}
                    </option>
                    {sorted.map((row) => (
                      <option key={row.station.station_id} value={row.station.station_id}>
                        {row.station.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="font-bold text-slate-300">B</span>
                  <span className="sr-only">Station B wählen</span>
                  <select
                    aria-label="Station B für den Vergleich wählen"
                    value={compareB}
                    onChange={(e) => setCompareB(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
                  >
                    <option value="">
                      {defaultB
                        ? `Vorauswahl: ${defaultB.station.name}`
                        : "Vorauswahl: keine zweite Station"}
                    </option>
                    {sorted
                      .filter(
                        (row) =>
                          row.station.station_id !==
                          compareRowA?.station.station_id,
                      )
                      .map((row) => (
                        <option key={row.station.station_id} value={row.station.station_id}>
                          {row.station.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {comparePair && compareRowA && compareRowB ? (
                <div className="p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      { row: compareRowA, label: "A" },
                      { row: compareRowB, label: "B" },
                    ].map(({ row, label }) => (
                      <div
                        key={row.station.station_id}
                        className="rounded-lg border border-slate-800 bg-slate-950/40 p-3"
                      >
                        <p className="text-xs uppercase tracking-wider text-slate-500">
                          {label}
                          {row.isReference ? " · Referenz" : ""}
                        </p>
                        <p className="mt-1 truncate text-sm font-semibold text-slate-200">
                          {row.station.name}
                        </p>
                        <p className="font-mono text-sm font-bold text-slate-100 tabular-nums">
                          {euroPerLiter(row.price)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {ageLabel(row)}
                        </p>
                      </div>
                    ))}
                  </div>
                  {comparePair.netEur !== null && (
                    <p className="mt-3 font-mono text-xs text-slate-300">
                      {comparePair.deltaCt !== null &&
                        `${centPerLiter(Math.abs(comparePair.deltaCt))} ${comparePair.deltaCt > 0 ? "teurer" : "günstiger"} · `}
                      {comparePair.detourKm !== null &&
                        `${kilometersLabel(comparePair.detourKm, 1)} Umweg · `}
                      netto {euro(comparePair.netEur)} € pro {deTrimmed(liters, 0)} L
                    </p>
                  )}
                  <p className="mt-2 rounded-lg border border-sky-500/20 bg-sky-950/20 p-3 text-xs leading-relaxed text-sky-100">
                    {comparePair.sentence}
                  </p>
                  {comparePair.netEur !== null && (
                    <p
                      className="mt-2 text-xs text-slate-500"
                      title="Quelle: decide → alternatives_nearby (Server-Netto-€ inkl. Umweg)"
                    >
                      Quelle: die Umweg-Rechnung des Servers (Netto-€ inkl.
                      Umweg)
                    </p>
                  )}
                  {comparePair.deltaCt !== null && comparePair.deltaCt < 0 && (
                    <p className="mt-2 text-xs leading-relaxed text-slate-400">
                      Achtung beim Lesen: „günstiger“ vergleicht nur die
                      Literpreise an der Säule. Umweg und Zeit stehen in der
                      Netto-Zeile darüber.
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                    <button
                      onClick={() => onNavigate("jetzt")}
                      className="font-semibold text-emerald-300 underline underline-offset-4 hover:text-emerald-200"
                    >
                      Zurück zu „Jetzt“
                    </button>
                    <button
                      onClick={() => onNavigate("ich")}
                      className="font-semibold text-sky-300 underline underline-offset-4 hover:text-sky-200"
                    >
                      Beleg für {compareRowA.station.name} buchen
                    </button>
                    {/* U5: Ebene 1 öffnet das Begründungs-Sheet am Ort —
                        der Labor-Sprung steht erst im Sheet (Ebene 2). */}
                    <button
                      onClick={() => setSheetOpen(true)}
                      aria-haspopup="dialog"
                      className="font-semibold text-violet-300 underline underline-offset-4 hover:text-violet-200"
                    >
                      {labSectionButtonLabel("stationen")} · sind die beiden
                      wirklich verschieden?
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-5">
                  <Empty>
                    Für einen Vergleich fehlen zwei Stationen mit frischem
                    Preis. Sobald der Collector meldet, steht hier die
                    Gegenüberstellung — mit Vorauswahl der zwei günstigsten.
                  </Empty>
                </div>
              )}
            </div>
          )}

          {/* Warum? (Ebene 1) */}
          <div className="mt-4">
            <button
              onClick={() => setSheetOpen(true)}
              aria-haspopup="dialog"
              className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-2.5 text-xs font-semibold text-slate-200 hover:border-slate-600"
            >
              {explanation.title}
            </button>
          </div>
        </>
      )}

      {/* Frische-Fußzeile (fester Platz, T8: ein Baustein) */}
      <FreshnessLine text={freshness.text} tone={freshness.tone} place={activeCity} />

      <Level1Sheet
        open={sheetOpen}
        title={explanation.title}
        sentences={explanation.sentences}
        source={explanation.source}
        labHint={explanation.labHint}
        onDeepen={(section) => {
          setSheetOpen(false);
          props.onDeepen?.(section);
        }}
        onClose={() => setSheetOpen(false)}
      />
    </section>
  );
}

/**
 * Verlauf der gewählten Station — derselbe Baustein wie im Stations-Labor
 * (`LineChart`): Achsen, beschriftete Zeitmarken und der Tagesmedian als
 * gestrichelte „üblich“-Linie. Vorher stand hier eine gequetschte Minigrafik
 * ohne Achsen (Nutzer-Feedback 14.09.2026).
 */
function SeriesChart({
  points,
  spanHours,
}: {
  points: Point[];
  spanHours: number;
}) {
  const c = useChartPalette();
  const known = points
    .filter((p) => p.price !== null && Number.isFinite(Date.parse(p.timestamp)))
    .map((p) => ({ x: Date.parse(p.timestamp), y: p.price as number }));
  if (known.length < 2) {
    return (
      <Empty>
        Zu wenige offene Meldungen im gewählten Zeitraum — der Verlauf
        entsteht aus den Collector-Läufen, geschätzt wird nichts.
      </Empty>
    );
  }
  const xs = known.map((p) => p.x);
  const ys = known.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const band = dayMedianPoints(points);
  const last = known[known.length - 1];
  return (
    <div>
      <LineChart
        series={[
          { name: "Offene Meldungen (€/L)", color: c.accent, pts: known },
          {
            name: "Tagesmedian (üblich)",
            color: c.text,
            dash: "4 3",
            pts: band,
          },
        ]}
        marks={[{ x: last.x, color: c.positive, label: "jetzt" }]}
        xDomain={[minX, maxX]}
        xTicks={autoTimeTicks(minX, maxX)}
        yFmt={(value) => euro(value, 3)}
        ariaDescription={`Preisverlauf der letzten ${spanLabel(spanHours)} in €/L: Linie = offene Meldungen (${known.length} Punkte), gestrichelte Linie = Tagesmedian, grüne Marke = jüngste Meldung (${euroPerLiter(last.y)}), Spanne ${euroPerLiter(minY)} bis ${euroPerLiter(maxY)}.`}
      />
      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        Durchgezogen = offene Meldungen · gestrichelt = Tagesmedian
        („üblich“) · grüne Marke = jüngste Meldung{" "}
        {timeLabel(new Date(last.x).toISOString())}. Leere Stunden bleiben
        leer — nichts wird interpoliert.
      </p>
    </div>
  );
}
