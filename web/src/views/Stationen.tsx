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
  MapPin,
  Search,
  Scale,
  Star,
  X,
} from "lucide-react";
import { Level1Sheet } from "../components/Level1Sheet";
import { LoadError } from "../components/LoadError";
import { SkeletonPanel } from "../components/Skeleton";
import { StationMap } from "../components/StationMap";
import { Empty, panel } from "../components/ui";
import {
  centPerLiter,
  euro,
  euroPerLiter,
  deTrimmed,
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
  dayRhythmLine,
  referenceStation,
  sortAtlasRows,
  stationContextLines,
  stationsFreshness,
  type AtlasRow,
  type AtlasSort,
} from "../stations";
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
  /** 7-Tage-Verlauf der ausgewählten Station (eigener Poll, 60 s). */
  series7d: ResourceState<{ points: Point[]; error_code: string | null } | null>;
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
  /** Ebene 2 ansteuern (bis Phase 3: die Werkstatt). */
  onDeepen?: () => void;
  /** ⌘K-Signal aus der Dashboard-Root: > 0 = Fokus in die Suche. */
  searchFocusSignal: number;
  /** Nur für Tests; sonst Date.now(). */
  now?: number;
}

/** Mini-Verlauf (24 h) einer Zeile: 18 Punkte aus dem Tagesstreifen. */
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
  const [sort, setSort] = useState<AtlasSort>("net");
  // Vergleichs-Modus: B-Station (A = die gewählte Station).
  const [compareB, setCompareB] = useState<string>("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

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
  const compareRowB = byId.get(compareB) ?? null;
  const comparePair =
    selected &&
    compareRowB &&
    compareRowB.station.station_id !== selected.station.station_id
      ? compareStationsPair(
          selected.station,
          compareRowB.station,
          price(selected.station),
          price(compareRowB.station),
          liters,
          decide?.alternatives_nearby.find(
            (alt) => alt.station_id === compareRowB.station.station_id,
          ) ?? null,
        )
      : null;

  const freshCount = rows.filter((row) => row.price !== null).length;
  const freshness = stationsFreshness(pricesAt, now);
  const FRESHNESS_TONE = {
    ok: "text-slate-500",
    warn: "text-amber-300",
    bad: "text-rose-300",
  } as const;

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

  const ageLabel = (row: AtlasRow): string => {
    if (row.station.observed_at === null) return "Noch keine Meldung";
    const age =
      row.ageMinutes !== null
        ? Math.max(0, Math.floor(row.ageMinutes + elapsed))
        : null;
    if (age === null) return "Stand unbekannt";
    if (!online || age > 30) return "Stand veraltet";
    return `vor ${age} Min.`;
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
        <label className="flex flex-1 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs">
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
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <span className="sr-only">Marke filtern</span>
            <select
              aria-label="Nach Marke filtern"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100"
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
            className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-300"
            title="Wirkt auf die Umweg-Rechnung des Servers (Was-wäre-wenn, nicht das Profil)"
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
                Auto ({deTrimmed(timeValueUsed)} €/h {autoZ.isPeak ? "Peak" : "offpeak"})
              </option>
              {[5, 8, 10, 12, 15, 20, 25, 30].map((z) => (
                <option key={z} value={z}>
                  {z} €/h
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* ② Karte */}
      {setup ? (
        <div className={`${panel} mt-4 p-5 sm:p-7`}>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-[11px] font-bold text-slate-300">
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
              title="Karte — Pin = Netto-€ ggü. der Referenz"
            />
          </div>

          {/* ③ Liste */}
          <div className={`${panel} mt-4 overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-slate-200">
                  {stations.length} Stationen
                </span>
                <span className="text-[11px] text-slate-500">
                  {freshCount} mit frischem Preis
                </span>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1 text-[11px] font-bold">
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
                className="border-b border-slate-800 px-4 py-2 text-[11px] leading-snug text-amber-300"
              >
                {pinNote}
              </p>
            )}
            {decideRes.pending && rows.length === 0 ? (
              <div className="p-4">
                <SkeletonPanel lines={4} label="Preise werden geladen" />
              </div>
            ) : problemCode && freshCount === 0 ? (
              <div className="p-4">
                <LoadError
                  errorCode={problemCode}
                  fallback="Preise derzeit nicht erreichbar."
                  onRetry={onRetry}
                />
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
                        onClick={() => setSelectedId(row.station.station_id)}
                        aria-pressed={isSel}
                        aria-label={`${row.station.name} als Referenz und Detail wählen`}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
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
                              <span className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300">
                                Referenz
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                            <span>{row.station.brand || "Freie Station"}</span>
                            {row.distKm != null && (
                              <span className="font-mono">
                                {euro(row.distKm, 1)} km
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
                              className={`block text-[11px] font-semibold tabular-nums ${
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
            <div className={`${panel} mt-4 overflow-hidden`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <MapPin size={15} className="text-emerald-400" aria-hidden="true" />
                  {selected.station.name}
                  <span className="font-mono text-[11px] font-normal text-slate-500">
                    {selected.station.brand || "Freie Station"}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
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
                    onClick={() => setCompareB("")}
                    className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 font-semibold text-sky-300 hover:bg-sky-500/20"
                  >
                    Vergleichen
                  </button>
                </div>
              </div>
              <div className="grid gap-4 p-4 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">
                    Preis
                  </p>
                  <p className="mt-1 font-mono text-lg font-bold text-slate-100 tabular-nums">
                    {euroPerLiter(selected.price)}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {selected.station.status === "closed"
                      ? "Geschlossen"
                      : "Aktuelle offene Meldung"}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">
                    Tagesrhythmus
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                    {dayRhythmLine(stripCells) ??
                      "Zu wenige offene Messstunden für ein Muster — keine Erfindung."}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">
                    Einordnung
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-slate-300">
                    {contextLines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              </div>
              {/* Verlauf 7 Tage (eigener Poll, nur für die gewählte Station) */}
              <div className="border-t border-slate-800 p-4">
                <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
                  Verlauf (7 Tage)
                </p>
                {series7d.error ? (
                  <LoadError
                    errorCode={series7d.data?.error_code || series7d.errorCode}
                    fallback="Der 7-Tage-Verlauf konnte nicht geladen werden."
                    onRetry={onRetry}
                    retryLabel="Verlauf neu laden"
                    compact
                  />
                ) : series7d.pending && !series7d.data ? (
                  <SkeletonPanel lines={2} title={false} label="Verlauf wird geladen" />
                ) : (series7d.data?.points ?? []).length === 0 ? (
                  <Empty>
                    Noch keine 7-Tage-Historie für diese Station — der
                    Verlauf füllt sich mit den nächsten Collector-Läufen.
                  </Empty>
                ) : (
                  <SeriesChart points={series7d.data?.points ?? []} />
                )}
              </div>
            </div>
          )}

          {/* ⑤ Vergleich */}
          {selected && (
            <div className={`${panel} mt-4 overflow-hidden`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <Scale size={15} className="text-sky-400" aria-hidden="true" />
                  A gegen B
                </div>
                <label className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="sr-only">Station B wählen</span>
                  <select
                    aria-label="Station B für den Vergleich wählen"
                    value={compareB}
                    onChange={(e) => setCompareB(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-100"
                  >
                    <option value="">Station B wählen …</option>
                    {stations
                      .filter(
                        (row) => row.station_id !== selected.station.station_id,
                      )
                      .map((row) => (
                        <option key={row.station_id} value={row.station_id}>
                          {row.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {!compareB ? (
                <div className="p-5">
                  <Empty>
                    Zwei Stationen wählen — A ist die gewählte Station
                    (oben), B wählst du rechts. Der Vergleich zeigt Preis,
                    Umweg und Netto-€; die tiefere Statistik verlinkt in
                    die Werkstatt.
                  </Empty>
                </div>
              ) : comparePair ? (
                <div className="p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      { row: selected, label: "A (Referenz)" },
                      { row: compareRowB!, label: "B" },
                    ].map(({ row, label }) => (
                      <div
                        key={row.station.station_id}
                        className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"
                      >
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">
                          {label}
                        </p>
                        <p className="mt-1 truncate text-sm font-semibold text-slate-200">
                          {row.station.name}
                        </p>
                        <p className="font-mono text-sm font-bold text-slate-100 tabular-nums">
                          {euroPerLiter(row.price)}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {ageLabel(row)}
                        </p>
                      </div>
                    ))}
                  </div>
                  {comparePair.netEur !== null && (
                    <p className="mt-3 font-mono text-[11px] text-slate-300">
                      {comparePair.deltaCt !== null &&
                        `${centPerLiter(Math.abs(comparePair.deltaCt))} ${comparePair.deltaCt > 0 ? "teurer" : "günstiger"} · `}
                      {comparePair.detourKm !== null &&
                        `${euro(comparePair.detourKm, 1)} km Umweg · `}
                      netto {euro(comparePair.netEur)} € pro {deTrimmed(liters, 0)} L
                    </p>
                  )}
                  <p className="mt-2 rounded-lg border border-sky-500/20 bg-sky-950/20 p-3 text-xs leading-relaxed text-sky-100">
                    {comparePair.sentence}
                  </p>
                  {comparePair.netEur !== null && (
                    <p className="mt-2 font-mono text-[11px] text-slate-500">
                      Quelle: decide → alternatives_nearby (Server-Netto-€
                      inkl. Umweg)
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
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
                      Beleg für {selected.station.name} buchen
                    </button>
                    <button
                      onClick={() => props.onDeepen?.()}
                      className="font-semibold text-slate-400 underline underline-offset-4 hover:text-slate-300"
                    >
                      Tiefer: sind die beiden wirklich verschieden? → Werkstatt
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* Warum? (Ebene 1) */}
          <div className="mt-4">
            <button
              onClick={() => setSheetOpen(true)}
              aria-haspopup="dialog"
              className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-2.5 text-xs font-semibold text-slate-200 hover:border-slate-600"
            >
              Warum diese Reihenfolge?
            </button>
          </div>
        </>
      )}

      {/* Frische-Fußzeile (fester Platz) */}
      <p
        role="status"
        className={`mt-4 text-[11px] leading-relaxed ${FRESHNESS_TONE[freshness.tone]}`}
      >
        {freshness.text} · {activeCity || "kein Ort gewählt"}
      </p>

      <Level1Sheet
        open={sheetOpen}
        title="Warum ist die Liste so sortiert?"
        sentences={explanation.sentences}
        source={explanation.source}
        labHint={explanation.labHint}
        onDeepen={() => {
          setSheetOpen(false);
          props.onDeepen?.();
        }}
        onClose={() => setSheetOpen(false)}
      />
    </section>
  );
}

/**
 * Kleiner Verlaufs-Chart (7 Tage, offene Meldungen): Linie plus
 * Tagesmedian-Punkte („üblich“ statt Moment). Bewusst klein und ohne
 * Chart-Bibliothek — das Labor hat die großen Charts, hier gilt
 * „Verlauf schlägt Moment“.
 */
function SeriesChart({ points }: { points: Point[] }) {
  const known = points
    .filter((p) => p.price !== null && Number.isFinite(Date.parse(p.timestamp)))
    .map((p) => ({ x: Date.parse(p.timestamp), y: p.price as number }));
  if (known.length < 2) return null;
  const xs = known.map((p) => p.x);
  const ys = known.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 0.01;
  const w = 640;
  const h = 140;
  const px = (x: number) => ((x - minX) / spanX) * (w - 16) + 8;
  const py = (y: number) => h - 14 - ((y - minY) / spanY) * (h - 28);
  const line = known
    .map((p, i) => `${i === 0 ? "M" : "L"}${px(p.x)},${py(p.y)}`)
    .join(" ");
  // Tagesmediane: je Kalender-Tag (Berlin) der Median der offenen
  // Meldungen, plotted an der ersten Messzeit des Tages.
  const byDay = new Map<string, { firstX: number; values: number[] }>();
  for (const p of known) {
    const key = new Date(p.x).toLocaleDateString("de-DE", {
      timeZone: "Europe/Berlin",
    });
    const entry = byDay.get(key);
    if (entry) {
      entry.values.push(p.y);
      if (p.x < entry.firstX) entry.firstX = p.x;
    } else {
      byDay.set(key, { firstX: p.x, values: [p.y] });
    }
  }
  const dayMedians = [...byDay.values()]
    .map((entry) => {
      const sorted = [...entry.values].sort((a, b) => a - b);
      return {
        x: entry.firstX,
        y: sorted[Math.floor(sorted.length / 2)],
      };
    })
    .sort((a, b) => a.x - b.x);
  const band = dayMedians
    .map((p, i) => `${i === 0 ? "M" : "L"}${px(p.x)},${py(p.y)}`)
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Preisverlauf der letzten 7 Tage: ${deTrimmed(minY, 3)} bis ${deTrimmed(maxY, 3)} Euro pro Liter, Linie = offene Meldungen, Punkte = Tagesmediane`}
      className="h-40 w-full text-slate-300"
    >
      {band && (
        <path d={band} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="3 3" />
      )}
      <path d={line} fill="none" stroke="#38bdf8" strokeWidth="1.75" />
      {dayMedians.map((p, i) => (
        <circle key={i} cx={px(p.x)} cy={py(p.y)} r="2.5" fill="#38bdf8" />
      ))}
    </svg>
  );
}
