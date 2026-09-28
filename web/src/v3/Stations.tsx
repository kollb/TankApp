// „Stationen“ im Konzept-Neubau — der Preis-Atlas.
//
// Die Seite rendert, sie entscheidet nichts (D1): Referenz, Netto-€-Zeilen,
// Einordnung und Vergleich kommen aus `stations.ts` — dieselben geprüften
// Funktionen wie in der bisherigen Ansicht. Der Server bleibt Quelle für
// Strecke und Netto (B6/H1); wo keine Route liegt, steht „ohne Umweg“, nie
// eine client-seitige Rechnung.
//
// Anordnung (Desktop):
//
//   Kopfzeile     die Frage („Wo ist es am günstigsten?“) + Herkunft
//   Steuerleiste  Suche · nur offene · Marke · Zeitwert (volle Breite)
//   Zeile 1       links Karte und Liste, rechts die Referenz und der
//                 Datenstand — die Liste bleibt so hoch wie ihr Inhalt
//   Zeile 2       Detail der gewählten Station mit **Verlauf über die volle
//                 Breite**: `LineChart` braucht Achsen und Zeitmarken; in
//                 einer 360-px-Seitspalte wäre das die nächste gequetschte
//                 Grafik (Lehre aus „Heute im Blick“, 28.09.2026)
//   Zeile 3       „A gegen B“ — ebenfalls volle Breite (zwei Spalten)
//
// Am Handy dieselbe Reihenfolge in einer Spalte.

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  LineChart as LineChartIcon,
  MapPin,
  Scale,
  Search,
  Star,
  X,
} from "lucide-react";
import { FreshnessLine } from "../components/FreshnessLine";
import { Level1Sheet } from "../components/Level1Sheet";
import { LoadError } from "../components/LoadError";
import { SeriesChart, SPANS, spanLabel } from "../components/SeriesChart";
import { SkeletonPanel } from "../components/Skeleton";
import { StationMap } from "../components/StationMap";
import { Empty, radius } from "../components/ui";
import {
  ageWord,
  centPerLiter,
  deTrimmed,
  euro,
  euroPerLiter,
  kilometersLabel,
} from "../data";
import {
  atlasEur,
  ATLAS_SORTS,
  atlasExplanation,
  atlasMatchesFilter,
  atlasRows,
  compareStationsPair,
  dayRhythmLine,
  referenceStation,
  sortAtlasRows,
  stationContextLines,
  stationsFreshness,
  type AtlasRow,
  type AtlasSort,
} from "../stations";
import { useOverview } from "../state/overview";
import { CardTitle, PageHeader, SectionCard } from "./parts";

/** Alterswort einer Zeile — dieselben Worte wie im Rest der App (T11/T13). */
function ageLabelOf(row: AtlasRow, elapsed: number, online: boolean): string {
  if (row.station.observed_at === null) return "Noch keine Meldung";
  const age =
    row.ageMinutes !== null ? Math.max(0, Math.floor(row.ageMinutes + elapsed)) : null;
  if (age === null) return "Stand unbekannt";
  if (!online || age > 30) return "veralteter Stand";
  return ageWord(age);
}

export function V3Stations() {
  const ov = useOverview();
  const {
    activeCity,
    data,
    stations,
    price,
    elapsed,
    online,
    selectedId,
    setSelectedId,
    pinnedIds,
    togglePin,
    pinNote,
    decideRes,
    stripCells,
    series7d,
    stationsSpanHours,
    setStationsSpanHours,
    effLiters,
    effTimeValue,
    autoZ,
    setAssumptions,
    nowPricesAt,
    refreshNow,
    handleNowNavigate,
    openLabor,
    searchFocusSignal,
    fuel,
  } = ov;

  // Ansichts-Zustand (C2): Suche, Markenfilter, „nur offene“, Sortierung.
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const [sort, setSort] = useState<AtlasSort>("net");
  // A gegen B: "" heißt „Vorauswahl Top 1 gegen Top 2 der Sortierung“.
  const [compareA, setCompareA] = useState<string>("");
  const [compareB, setCompareB] = useState<string>("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const compareRef = useRef<HTMLDivElement | null>(null);

  // ⌘K: die Hülle erhöht das Signal, hier landet der Fokus in der Suche.
  useEffect(() => {
    if (searchFocusSignal > 0) searchRef.current?.focus();
  }, [searchFocusSignal]);

  const now = Date.now();
  const decide = decideRes.data ?? null;
  const problemCode =
    decide?.error_code ?? (decideRes.error ? decideRes.errorCode : null);

  const ref = referenceStation(stations, price, selectedId, pinnedIds);
  const rows = atlasRows({
    stations,
    priceOf: price,
    liters: effLiters,
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
  const filtered = rows.filter((row) =>
    atlasMatchesFilter(row, { query, brand, openOnly }),
  );
  const sorted = sortAtlasRows(filtered, sort);

  const selected =
    byId.get(selectedId) ?? (ref ? (byId.get(ref.station.station_id) ?? null) : null);
  const referenceRow = ref ? (byId.get(ref.station.station_id) ?? null) : null;
  const contextLines = selected ? stationContextLines(selected, referenceRow) : [];

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
          effLiters,
          // O44: Ein Fehlerpayload hat keine `alternatives_nearby` — ohne
          // den Klammer-Zusatz stürzte die Ansicht hier ab.
          (decide?.alternatives_nearby ?? []).find(
            (alt) => alt.station_id === compareRowB.station.station_id,
          ) ?? null,
        )
      : null;
  const compareIsDefault =
    compareA === "" &&
    compareB === "" &&
    compareRowA !== null &&
    compareRowA.station.station_id === defaultA?.station.station_id;

  const openStation = (row: AtlasRow) => {
    setSelectedId(row.station.station_id);
    setCompareA(row.station.station_id);
  };
  const openHistory = (row: AtlasRow) => {
    openStation(row);
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const freshCount = rows.filter((row) => row.price !== null).length;
  const freshness = stationsFreshness(nowPricesAt, now);
  const setup = stations.length === 0 && !decideRes.error;
  const explanation = atlasExplanation({
    reference: ref ? { name: ref.station.name } : null,
    reason: ref?.reason ?? null,
    liters: effLiters,
    timeValueLabel:
      effTimeValue > 0
        ? `${deTrimmed(effTimeValue)} €/h`
        : `Auto (${deTrimmed(autoZ.z)} €/h)`,
    pricesAt: nowPricesAt,
    now,
  });
  const ageLabel = (row: AtlasRow) => ageLabelOf(row, elapsed, online);

  return (
    <div className="v3-page">
      <PageHeader
        kicker="Stationen"
        title="Wo ist es am günstigsten?"
        subtitle={
          <>
            Karte, Liste, Verlauf, Vergleich — gemessen an einer sichtbaren
            Referenz. {activeCity || "ohne Stadt"} ·{" "}
            {fuel === "diesel" ? "Diesel" : fuel.toUpperCase()}
          </>
        }
      />

      {setup ? (
        <SectionCard>
          <span className="inline-flex items-center gap-1.5 border border-outline-variant bg-sc-low px-2.5 py-1 text-xs font-bold text-on-surface-variant rounded-full">
            <MapPin size={13} aria-hidden="true" />
            Noch keine Stationen
          </span>
          <h2 className="mt-3 text-xl font-bold">
            Erst Stationen einrichten, dann der Atlas
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-on-surface-variant">
            Sobald die App Stationen beobachtet, stehen hier Karte, Liste und
            Vergleich — mit den aktuellen Preisen.
          </p>
          <button
            type="button"
            onClick={() => handleNowNavigate("system")}
            className={`tap-44 m3-btn-now mt-4 inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold ${radius.chip}`}
          >
            Einrichtung ansehen
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </SectionCard>
      ) : (
        <>
          {/* Steuerleiste: Suche, Filter, Sortierung — volle Breite. */}
          <SectionCard>
            <CardTitle icon={Search}>Suchen und filtern</CardTitle>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <label className="flex flex-1 items-center gap-2 border border-outline-variant bg-sc-lowest px-3 py-2 text-xs rounded-lg">
                <Search
                  size={14}
                  className="shrink-0 text-on-surface-variant"
                  aria-hidden="true"
                />
                <span className="sr-only">Station durchsuchen (Strg+K)</span>
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Station suchen — Strg+K / ⌘K"
                  aria-label="Station nach Name oder Marke durchsuchen"
                  className="w-full bg-transparent text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Suche leeren"
                    className="text-on-surface-variant hover:text-on-surface"
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
                  title="Filter: nur offene Stationen"
                  className={`tap-44 px-3 py-2 text-xs font-semibold ${radius.chip} ${
                    openOnly
                      ? "bg-secondary-container text-on-secondary-container"
                      : "border border-outline-variant text-on-surface-variant hover:bg-sc-low"
                  }`}
                >
                  {openOnly ? "nur offene" : "alle Stationen"}
                </button>
                <label className="flex items-center gap-2 text-xs text-on-surface-variant">
                  <span className="sr-only">Marke filtern</span>
                  <select
                    aria-label="Nach Marke filtern"
                    value={brand}
                    onChange={(event) => setBrand(event.target.value)}
                    className={`border border-outline-variant bg-sc-lowest px-2 py-2 text-xs text-on-surface ${radius.control}`}
                  >
                    <option value="">Alle Marken</option>
                    {brands.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  className={`flex items-center gap-2 border border-outline-variant bg-sc-lowest px-2.5 py-2 text-xs text-on-surface-variant ${radius.control}`}
                  title="Zeitwert für die Umweg-Rechnung"
                >
                  <span className="sr-only">Zeitwert für die Umweg-Rechnung</span>
                  Zeit:{" "}
                  <select
                    aria-label="Zeitwert (€/h) für die Umweg-Rechnung"
                    value={effTimeValue === 0 ? "0" : String(effTimeValue)}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setAssumptions((current) => ({
                        ...current,
                        timeValue: Number.isFinite(value) ? value : null,
                      }));
                    }}
                    className="bg-transparent pr-1 text-on-surface"
                  >
                    <option value="0">
                      Auto ({deTrimmed(autoZ.z)} €/h ·{" "}
                      {autoZ.isPeak ? "Stoßzeit" : "Nebenzeit"})
                    </option>
                    {[5, 8, 10, 12, 15, 20, 25, 30].map((z) => (
                      <option key={z} value={z}>
                        {z} €/h
                      </option>
                    ))}
                  </select>
                </label>
                <div
                  role="group"
                  aria-label="Sortierung der Liste"
                  className={`flex items-center gap-1 border border-outline-variant bg-sc-low p-1 text-xs font-bold ${radius.control}`}
                >
                  {ATLAS_SORTS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setSort(option.value)}
                      aria-pressed={sort === option.value}
                      className={`px-2.5 py-1 transition-colors ${
                        sort === option.value
                          ? "bg-secondary-container text-on-secondary-container"
                          : "text-on-surface-variant hover:text-on-surface"
                      } ${radius.chip}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
              „offen“ zeigt nur Stationen mit aktuellem Preis für den gewählten
              Kraftstoff. Der Zeitwert wirkt auf die Umweg-Rechnung des Servers
              — als Was-wäre-wenn, das Profil bleibt unverändert. Die
              Euro-Beträge in der Liste rechnen mit der Tankmenge von{" "}
              {deTrimmed(effLiters, 0)} L.
            </p>
          </SectionCard>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-6">
            {/* Zeile 1 links: Karte und Liste. */}
            <div className="space-y-4">
              <SectionCard className="overflow-hidden p-0">
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
              </SectionCard>

              <SectionCard className="overflow-hidden p-0">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">
                      {stations.length} Stationen
                    </span>
                    <span className="text-xs text-on-surface-variant">
                      {freshCount} mit frischem Preis
                    </span>
                  </div>
                </div>
                {pinNote && (
                  <p
                    role="status"
                    aria-live="polite"
                    className="border-b border-outline-variant px-4 py-2 text-xs leading-snug text-warn"
                  >
                    {pinNote}
                  </p>
                )}
                {decideRes.pending && rows.length === 0 ? (
                  <div className="p-4">
                    <SkeletonPanel lines={4} label="Preise werden geladen" />
                  </div>
                ) : data === null && decideRes.error ? (
                  <div className="p-4">
                    <LoadError
                      errorCode={decideRes.errorCode}
                      fallback="Preise derzeit nicht erreichbar."
                      onRetry={refreshNow}
                    />
                  </div>
                ) : stations.length === 0 ? (
                  <div className="p-5">
                    <Empty>
                      Noch keine Stationen — erst im Bereich „System“
                      einrichten, welche Stationen beobachtet werden; dann
                      füllt sich die Liste automatisch.
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
                  <div className="divide-y divide-outline-variant">
                    {sorted.map((row) => {
                      const eur = atlasEur(row);
                      const isSel =
                        selected !== null &&
                        row.station.station_id === selected.station.station_id;
                      return (
                        <div
                          key={row.station.station_id}
                          className={`flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-sc-low sm:flex-nowrap ${
                            isSel ? "bg-sc-low" : ""
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => openStation(row)}
                            aria-pressed={isSel}
                            aria-label={`${row.station.name} als Referenz und Detail wählen`}
                            className="flex min-w-0 flex-1 basis-full items-center gap-3 text-left sm:basis-auto"
                          >
                            <span
                              className={`flex h-9 w-9 shrink-0 grid-cols-1 place-items-center border ${radius.chip} ${
                                row.isReference
                                  ? "border-primary/40 bg-primary-container text-on-primary-container"
                                  : "border-outline-variant bg-sc-low text-on-surface-variant"
                              } grid`}
                            >
                              <MapPin size={15} aria-hidden="true" />
                            </span>
                            <span className="min-w-0">
                              <span className="flex items-center gap-2 text-sm font-semibold">
                                <span className="truncate">
                                  {row.station.name}
                                </span>
                                {row.isReference && (
                                  <span className="shrink-0 border border-primary/40 bg-primary-container px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-on-primary-container rounded">
                                    Referenz
                                  </span>
                                )}
                              </span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-on-surface-variant">
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
                          <span className="flex w-full items-center justify-between gap-3 sm:w-auto sm:shrink-0 sm:justify-end">
                            <span className="text-left sm:text-right">
                              <span className="block font-mono text-sm font-bold tabular-nums">
                                {euroPerLiter(row.price)}
                              </span>
                              {eur && (
                                <span
                                  className={`block text-xs font-semibold tabular-nums ${
                                    eur.tone === "save"
                                      ? "text-primary"
                                      : eur.tone === "cost"
                                        ? "text-error"
                                        : "text-on-surface-variant"
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
                              type="button"
                              onClick={() => openHistory(row)}
                              aria-label={`Verlauf von ${row.station.name} ansehen`}
                              title={`Verlauf · ${spanLabel(stationsSpanHours)} öffnen`}
                              className={`tap-44 shrink-0 border border-outline-variant p-2 text-on-surface-variant hover:bg-sc-low ${radius.chip}`}
                            >
                              <LineChartIcon size={14} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => togglePin(row.station.station_id)}
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
                              className={`tap-44 shrink-0 border p-2 ${radius.chip} ${
                                row.isPinned
                                  ? "border-warn/50 bg-warn-container text-on-warn-container"
                                  : "border-outline-variant text-on-surface-variant hover:bg-sc-low"
                              }`}
                            >
                              <Star
                                size={14}
                                fill={row.isPinned ? "currentColor" : "none"}
                                aria-hidden="true"
                              />
                            </button>
                            {row.station.maps_url ? (
                              <a
                                href={row.station.maps_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Route zu ${row.station.name} öffnen`}
                                title="Route öffnen"
                                className={`tap-44 inline-flex shrink-0 items-center justify-center border border-outline-variant p-2 text-on-surface-variant hover:bg-sc-low ${radius.chip}`}
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
              </SectionCard>
            </div>

            {/* Zeile 1 rechts: die Referenz und der Datenstand. */}
            <div className="space-y-4 lg:order-2">
              <SectionCard>
                <CardTitle icon={MapPin}>Referenz</CardTitle>
                {referenceRow ? (
                  <>
                    <p className="text-sm font-semibold">
                      {referenceRow.station.name}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                      {ref?.reason ??
                        "Referenz ist die nächste frische Station — alles andere wird daran gemessen."}
                    </p>
                    <dl className="mt-3 grid grid-cols-1 gap-1 text-xs">
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-on-surface-variant">Preis</dt>
                        <dd className="font-mono font-semibold tabular-nums">
                          {euroPerLiter(referenceRow.price)}
                        </dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-on-surface-variant">Stand</dt>
                        <dd>{ageLabel(referenceRow)}</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-on-surface-variant">Tankmenge</dt>
                        <dd className="font-mono tabular-nums">
                          {deTrimmed(effLiters, 0)} L
                        </dd>
                      </div>
                    </dl>
                  </>
                ) : (
                  <Empty>
                    Noch keine Referenz — sie entsteht mit dem ersten frischen
                    Preis.
                  </Empty>
                )}
                <button
                  type="button"
                  onClick={() => setSheetOpen(true)}
                  aria-haspopup="dialog"
                  className={`tap-44 mt-4 inline-flex items-center gap-2 border border-outline-variant px-3 py-2 text-xs font-semibold hover:bg-sc-low ${radius.chip}`}
                >
                  {explanation.title}
                </button>
              </SectionCard>

              <FreshnessLine
                text={freshness.text}
                tone={freshness.tone}
                place={activeCity}
              />
            </div>

            {/* Zeile 2: Detail der gewählten Station — Verlauf in voller Breite. */}
            {selected && (
              <div ref={detailRef} className="lg:order-3 lg:col-span-2">
                <SectionCard>
                  <CardTitle
                    icon={MapPin}
                    right={
                      <span className="flex items-center gap-2 text-xs text-on-surface-variant">
                        {ageLabel(selected)}
                        {selected.station.maps_url && (
                          <a
                            href={selected.station.maps_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`tap-44 inline-flex items-center justify-center border border-outline-variant px-2.5 py-1.5 font-semibold hover:bg-sc-low ${radius.chip}`}
                          >
                            Route
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setCompareA(selected.station.station_id);
                            setCompareB("");
                            compareRef.current?.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                          }}
                          className={`tap-44 inline-flex items-center gap-1.5 border border-tertiary/40 bg-tertiary-container px-2.5 py-1.5 font-semibold text-on-tertiary-container ${radius.chip}`}
                        >
                          A gegen B
                        </button>
                      </span>
                    }
                  >
                    {selected.station.name}{" "}
                    <span className="font-mono text-xs font-normal text-on-surface-variant">
                      {selected.station.brand || "Freie Station"}
                    </span>
                  </CardTitle>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-on-surface-variant">
                        Preis
                      </p>
                      <p className="mt-1 font-mono text-lg font-bold tabular-nums">
                        {euroPerLiter(selected.price)}
                      </p>
                      <p className="mt-1 text-xs text-on-surface-variant">
                        {selected.station.status === "closed"
                          ? "Geschlossen"
                          : "Aktuelle offene Meldung"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wider text-on-surface-variant">
                        Tagesrhythmus
                      </p>
                      <p className="mt-1 text-xs leading-relaxed">
                        {dayRhythmLine(stripCells) ??
                          "Zu wenige offene Messstunden für ein Muster — keine Erfindung."}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wider text-on-surface-variant">
                        Einordnung
                      </p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-relaxed">
                        {contextLines.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-outline-variant pt-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                        Verlauf · letzte {spanLabel(stationsSpanHours)}
                      </p>
                      <div
                        role="group"
                        aria-label="Zeitraum des Verlaufs"
                        className={`flex border border-outline-variant bg-sc-low p-1 text-xs font-semibold ${radius.control}`}
                      >
                        {SPANS.map((span) => (
                          <button
                            key={span.hours}
                            type="button"
                            aria-pressed={stationsSpanHours === span.hours}
                            onClick={() => setStationsSpanHours(span.hours)}
                            className={`px-2 py-1 transition-colors ${
                              stationsSpanHours === span.hours
                                ? "bg-secondary-container text-on-secondary-container"
                                : "text-on-surface-variant hover:text-on-surface"
                            } ${radius.chip}`}
                          >
                            {span.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {series7d.error ? (
                      <LoadError
                        errorCode={series7d.data?.error_code || series7d.errorCode}
                        fallback={`Der Verlauf der letzten ${spanLabel(stationsSpanHours)} konnte nicht geladen werden.`}
                        onRetry={refreshNow}
                        retryLabel="Verlauf neu laden"
                        compact
                      />
                    ) : series7d.pending && !series7d.data ? (
                      <SkeletonPanel
                        lines={2}
                        title={false}
                        label="Verlauf wird geladen"
                      />
                    ) : (
                      <SeriesChart
                        points={series7d.data?.points ?? []}
                        spanHours={stationsSpanHours}
                      />
                    )}
                  </div>
                </SectionCard>
              </div>
            )}

            {/* Zeile 3: A gegen B — zwei Spalten brauchen die volle Breite. */}
            {selected && (
              <div ref={compareRef} className="lg:order-4 lg:col-span-2">
                <SectionCard>
                  <CardTitle
                    icon={Scale}
                    right={
                      <span className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
                        {compareIsDefault && (
                          <span className="border border-outline-variant bg-sc-low px-2 py-0.5 rounded-full">
                            Vorauswahl: Top 1 gegen Top 2
                          </span>
                        )}
                        {(compareA !== "" || compareB !== "") && (
                          <button
                            type="button"
                            onClick={() => {
                              setCompareA("");
                              setCompareB("");
                            }}
                            className="font-semibold text-primary underline underline-offset-4"
                          >
                            Vorauswahl wiederherstellen
                          </button>
                        )}
                      </span>
                    }
                  >
                    A gegen B
                  </CardTitle>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="flex items-center gap-2 text-xs text-on-surface-variant">
                      <span className="font-bold text-tertiary">A</span>
                      <span className="sr-only">Station A wählen</span>
                      <select
                        aria-label="Station A für den Vergleich wählen"
                        value={compareA}
                        onChange={(event) => setCompareA(event.target.value)}
                        className={`w-full border border-outline-variant bg-sc-lowest px-2 py-1.5 text-xs text-on-surface ${radius.control}`}
                      >
                        <option value="">
                          {defaultA
                            ? `Vorauswahl: ${defaultA.station.name}`
                            : "Vorauswahl: keine Station mit Preis"}
                        </option>
                        {sorted.map((row) => (
                          <option
                            key={row.station.station_id}
                            value={row.station.station_id}
                          >
                            {row.station.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-on-surface-variant">
                      <span className="font-bold">B</span>
                      <span className="sr-only">Station B wählen</span>
                      <select
                        aria-label="Station B für den Vergleich wählen"
                        value={compareB}
                        onChange={(event) => setCompareB(event.target.value)}
                        className={`w-full border border-outline-variant bg-sc-lowest px-2 py-1.5 text-xs text-on-surface ${radius.control}`}
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
                            <option
                              key={row.station.station_id}
                              value={row.station.station_id}
                            >
                              {row.station.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>

                  {comparePair && compareRowA && compareRowB ? (
                    <div className="mt-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {[
                          { row: compareRowA, label: "A" },
                          { row: compareRowB, label: "B" },
                        ].map(({ row, label }) => (
                          <div
                            key={row.station.station_id}
                            className="border border-outline-variant bg-sc-low p-3 rounded-lg"
                          >
                            <p className="text-xs uppercase tracking-wider text-on-surface-variant">
                              {label}
                              {row.isReference ? " · Referenz" : ""}
                            </p>
                            {/* Der Name bricht um, statt zu kürzen: In A/B ist
                                er die Frage („welche zwei vergleiche ich?“). */}
                            <p className="mt-1 break-words text-sm font-semibold">
                              {row.station.name}
                            </p>
                            <p className="font-mono text-sm font-bold tabular-nums">
                              {euroPerLiter(row.price)}
                            </p>
                            <p className="text-xs text-on-surface-variant">
                              {ageLabel(row)}
                            </p>
                          </div>
                        ))}
                      </div>
                      {comparePair.netEur !== null && (
                        <p className="mt-3 font-mono text-xs">
                          {comparePair.deltaCt !== null &&
                            `${centPerLiter(Math.abs(comparePair.deltaCt))} ${
                              comparePair.deltaCt > 0 ? "teurer" : "günstiger"
                            } · `}
                          {comparePair.detourKm !== null &&
                            `${kilometersLabel(comparePair.detourKm, 1)} Umweg · `}
                          netto {euro(comparePair.netEur)} € pro{" "}
                          {deTrimmed(effLiters, 0)} L
                        </p>
                      )}
                      <p className="mt-2 border border-tertiary/30 bg-tertiary-container/40 p-3 text-xs leading-relaxed rounded-lg">
                        {comparePair.sentence}
                      </p>
                      {comparePair.netEur !== null && (
                        <p
                          className="mt-2 text-xs text-on-surface-variant"
                          title="Quelle: decide → alternatives_nearby (Server-Netto-€ inkl. Umweg)"
                        >
                          Quelle: die Umweg-Rechnung des Servers (Netto-€ inkl.
                          Umweg)
                        </p>
                      )}
                      {comparePair.deltaCt !== null && comparePair.deltaCt < 0 && (
                        <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
                          Achtung beim Lesen: „günstiger“ vergleicht nur die
                          Literpreise an der Säule. Umweg und Zeit stehen in
                          der Netto-Zeile darüber.
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                        <button
                          type="button"
                          onClick={() => handleNowNavigate("jetzt")}
                          className="font-semibold text-primary underline underline-offset-4"
                        >
                          Zurück zu „Jetzt“
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNowNavigate("ich")}
                          className="font-semibold text-tertiary underline underline-offset-4"
                        >
                          Beleg für {compareRowA.station.name} buchen
                        </button>
                        <button
                          type="button"
                          onClick={() => setSheetOpen(true)}
                          aria-haspopup="dialog"
                          className="font-semibold underline underline-offset-4"
                        >
                          sind die beiden wirklich verschieden?
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3">
                      <Empty>
                        Für einen Vergleich fehlen zwei Stationen mit frischem
                        Preis. Sobald der Collector meldet, steht hier die
                        Gegenüberstellung — mit Vorauswahl der zwei
                        günstigsten.
                      </Empty>
                    </div>
                  )}
                </SectionCard>
              </div>
            )}
          </div>
        </>
      )}

      {problemCode && !setup && (
        <p className="mt-4">
          <LoadError
            errorCode={problemCode}
            detail={decide?.detail ?? null}
            fallback="Der Preis-Atlas ist derzeit nicht vollständig."
            onRetry={refreshNow}
            compact
          />
        </p>
      )}

      <Level1Sheet
        open={sheetOpen}
        title={explanation.title}
        sentences={explanation.sentences}
        source={explanation.source}
        labHint={explanation.labHint}
        onDeepen={(section) => {
          setSheetOpen(false);
          openLabor(section);
        }}
        onClose={() => setSheetOpen(false)}
      />
    </div>
  );
}
