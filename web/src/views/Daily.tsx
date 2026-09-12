// D1: Views-Schnitt — Alltagstab. Der gemeinsame Zustand (~100 useState/
// useResource) lebt in der Dashboard-Root und wandert per typisierten Props
// in diese View; die View rendert, sie entscheidet nichts.
import { useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  Clock,
  Compass,
  Cpu,
  Fuel as FuelIcon,
  Gauge,
  Route,
  Scale,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Star,
} from "lucide-react";
import { PrecisionSlider } from "../components/PrecisionSlider";
import { LoadError } from "../components/LoadError";
import { SkeletonPanel } from "../components/Skeleton";
import { Badge, Empty, Metric, panel } from "../components/ui";
import {
  centPerLiter,
  clockLabel,
  commaToDot,
  deNumber,
  deTrimmed,
  detourVerdict,
  euro,
  euroPerLiter,
  fillLimitHint,
  orderedStationList,
  percentLabel,
  STATION_SORTS,
  tankPreviewLine,
  timeLabel,
  type DecideResult,
  type Fill,
  type FillDraftCheck,
  type Fills,
  type Fuel,
  type Health,
  type Point,
  type ResourceState,
  type RouteEvaluate,
  type Station,
  type Stations,
  type StationSort,
  type StatsSummary,
  type DetourMode,
} from "../data";
export type StripCell = {
  hour: number;
  value: number | null;
  tone: string;
  current: boolean;
};

export interface DailyViewProps {
  // Präferenzen (Slider/Select lesen und schreiben)
  fuel: Fuel;
  activeCity: string;
  selectedId: string;
  routeAltId: string;
  liters: number;
  consumption: number;
  speed: number;
  timeValue: number;
  timeValueUsed: number;
  autoZ: { z: number; isPeak: boolean };
  detourMode: DetourMode;
  // A2: Tankstand als F3-Eingabe (Füllstand in Prozent, Tankgröße des Fahrzeugs)
  tankPercent: number | null;
  setTankPercent: (v: number | null) => void;
  tankCapacity: number;
  setTankCapacity: (v: number) => void;
  // C2: Stamm-Stationen (serverunabhängig, localStorage) — Reihenfolge und
  // Stern-Status kommen aus der Dashboard-Root, damit auch die Beleg-Erfassung
  // dieselben Pinned zuerst zeigt.
  pinnedIds: string[];
  togglePin: (stationId: string) => void;
  pinNote: string | null;
  setLiters: (v: number) => void;
  setConsumption: (v: number) => void;
  setSpeed: (v: number) => void;
  setTimeValue: (v: number) => void;
  setDetourMode: (v: DetourMode) => void;
  setSelectedId: (v: string) => void;
  setRouteAltId: (v: string) => void;
  // Stationen & Preise
  data: Stations | null;
  stations: Station[];
  selected: Station | undefined;
  best: Station | undefined;
  bestPrice: number | null;
  online: boolean;
  elapsed: number;
  price: (row: Station) => number | null;
  difference: number | null;
  span: number | null;
  selectedIsCheapest: boolean;
  h: Health | null;
  // Ressourcen (aus /api/v1/overview bzw. Einzelpolls)
  decideRes: ResourceState<DecideResult>;
  fillsRes: ResourceState<Fills>;
  statsSummaryRes: ResourceState<StatsSummary>;
  dayStrip: ResourceState<{ points: Point[]; error_code: string | null }>;
  routeEval: ResourceState<RouteEvaluate>;
  // Abgeleitete Alltags-Werte
  dueEpisode: any;
  gateStatus: string;
  m7Line: string | null;
  liveAdvice: StatsSummary["live_advice"] | null;
  stripCells: StripCell[];
  // Beleg-Erfassung (Schnell-Form + Due-Dialog)
  quickStation: Station | undefined;
  quickStationId: string;
  quickLitersStr: string;
  quickPriceStr: string;
  quickDraft: FillDraftCheck;
  fillDraft: FillDraftCheck;
  customLitersStr: string;
  customPriceStr: string;
  litersError: string | null;
  priceError: string | null;
  stationMissing: boolean;
  customFillOpen: boolean;
  fillSubmitting: boolean;
  voidBusy: boolean;
  voidNote: string | null;
  actionFeedback: string | null;
  dueDismissed: boolean;
  setQuickStationId: (v: string) => void;
  setQuickLitersStr: (v: string) => void;
  setQuickPriceStr: (v: string) => void;
  setCustomLitersStr: (v: string) => void;
  setCustomPriceStr: (v: string) => void;
  setCustomFillOpen: (v: boolean) => void;
  handleQuickFill: () => void;
  handleCustomFill: (ep: any) => void;
  handleVoidFill: (fillId: string) => void;
  handleIntent: (intent: string, mapsUrl?: string | null) => void;
  handleDismissDue: (epId?: string) => void;
  handleConfirmRecommendedFill: (ep: any) => void;
  refreshNow: () => void;
  // Tankbelege
  fillList: Fill[];
  visibleFills: Fill[];
  voidedCount: number;
  showVoidedFills: boolean;
  setShowVoidedFills: (v: boolean | ((prev: boolean) => boolean)) => void;
}
export function DailyView(props: DailyViewProps) {
  const { activeCity, actionFeedback, autoZ, best, bestPrice, consumption, customFillOpen, customLitersStr, customPriceStr, data, dayStrip, decideRes, detourMode, difference, dueDismissed, dueEpisode, elapsed, fillDraft, fillList, fillSubmitting, fuel, gateStatus, h, handleConfirmRecommendedFill, handleCustomFill, handleDismissDue, handleIntent, handleQuickFill, handleVoidFill, liters, litersError, liveAdvice, m7Line, online, price, priceError, quickDraft, quickLitersStr, quickPriceStr, quickStation, quickStationId, refreshNow, routeAltId, routeEval, selected, selectedId, selectedIsCheapest, setConsumption, setCustomFillOpen, setCustomLitersStr, setCustomPriceStr, setDetourMode, setLiters, setQuickLitersStr, setQuickPriceStr, setQuickStationId, setRouteAltId, setSelectedId, setShowVoidedFills, setSpeed, setTimeValue, showVoidedFills, span, speed, stationMissing, stations, statsSummaryRes, stripCells, timeValue, timeValueUsed, voidBusy, voidNote, visibleFills, voidedCount, fillsRes, tankPercent, setTankPercent, tankCapacity, setTankCapacity, pinnedIds, togglePin, pinNote, } = props;
  // C2: Suche/Markenfilter/Sortierung sind Ansichts-Zustand dieses Panels —
  // sie beschreiben, wonach gerade geschaut wird, nicht den Haushalt.
  const [stationQuery, setStationQuery] = useState("");
  const [stationBrand, setStationBrand] = useState("");
  const [stationSort, setStationSort] = useState<StationSort>("price");
  const stationBrands = Array.from(
    new Set(stations.map((row) => row.brand).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, "de"));
  const orderedStations = orderedStationList(
    stations,
    pinnedIds,
    stationSort,
    price,
    stationQuery,
    stationBrand,
  );
  const pinnedFirstStations = orderedStationList(
    stations,
    pinnedIds,
    "price",
    price,
  );
  const filteredCount = orderedStations.length;
  return (
<>
  {/* B4: Due-Prompt Banner */}
  {dueEpisode && !dueDismissed && (
    <section
      aria-label="Rückmeldung nach Fensterende"
      className="mb-6 rounded-2xl border border-amber-500/40 bg-gradient-to-r from-amber-950/40 via-slate-900 to-slate-900 p-5 shadow-xl"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3.5">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-400">
            <Clock size={22} />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">
              Rückmeldung nach Fensterende (Due-Prompt)
            </span>
            <h3 className="mt-0.5 text-lg font-bold text-white">
              Hast du getankt?
            </h3>
            <p className="mt-1 text-xs text-slate-400 leading-relaxed max-w-xl">
              Das empfohlene Zeitfenster ist vorüber. Ein kurzer Tap
              erfasst deinen Beleg in deiner persönlichen Tank-Bilanz.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleConfirmRecommendedFill(dueEpisode)}
            disabled={bestPrice === null}
            title={
              bestPrice === null
                ? "Kein frischer Preis – bitte manuell erfassen"
                : `Wie empfohlen ${euro(bestPrice, 3)} €/L`
            }
            className="rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ✓ Ja, wie empfohlen (
            {bestPrice !== null
              ? `${euro(bestPrice, 3)} €/L`
              : "Preis unbekannt"}
            )
          </button>
          <button
            onClick={() => setCustomFillOpen(!customFillOpen)}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
          >
            ✎ Anders
          </button>
          <button
            onClick={() => handleDismissDue(dueEpisode.id)}
            className="rounded-xl px-3 py-2.5 text-xs text-slate-400 hover:text-white transition"
          >
            ✕ Noch nicht
          </button>
        </div>
      </div>

      {customFillOpen && (
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-300">
            Tankvorgang manuell anpassen:
          </p>
          {/* E4: ohne Station ist nichts buchbar — vorher lief der
              Versuch gegen „custom“ und kam als unknown_station
              zurück, ohne dass der Nutzer selbst helfen konnte. */}
          {stationMissing && (
            <p
              id="custom-fill-station"
              role="alert"
              className="rounded-lg border border-amber-500/30 bg-amber-950/40 px-3 py-2 text-[11px] leading-snug text-amber-200"
            >
              Station wählen — erst dann kann ein Beleg gebucht
              werden.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs text-slate-400">
              Liter
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={customLitersStr}
                onChange={(e) =>
                  setCustomLitersStr(commaToDot(e.target.value))
                }
                aria-invalid={litersError != null}
                aria-describedby={`custom-liters-hint${litersError ? " custom-liters-error" : ""}`}
                title={`${fillLimitHint("liters")} — wie auf dem Kassenbon`}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white focus:border-emerald-500"
              />
              <span
                id="custom-liters-hint"
                className="mt-1 block text-[10px] text-slate-500"
              >
                {fillLimitHint("liters")} · z. B. 45,5.
              </span>
              {litersError && (
                <p
                  id="custom-liters-error"
                  className="mt-1 text-[10px] leading-snug text-rose-300"
                >
                  {litersError}
                </p>
              )}
            </label>
            <label className="text-xs text-slate-400">
              Gezahlter Preis (€/L)
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={customPriceStr}
                onChange={(e) =>
                  setCustomPriceStr(commaToDot(e.target.value))
                }
                aria-invalid={priceError != null}
                aria-describedby={`custom-price-hint${priceError ? " custom-price-error" : ""}`}
                title={`${fillLimitHint("price")} — wie an der Säule`}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white focus:border-emerald-500"
              />
              {priceError && (
                <p
                  id="custom-price-error"
                  className="mt-1 text-[10px] leading-snug text-rose-300"
                >
                  {priceError}
                </p>
              )}
              <span
                id="custom-price-hint"
                className="mt-1 block text-[10px] text-slate-500"
              >
                {fillLimitHint("price")} · wie an der Säule, z. B.
                1,629.
              </span>
            </label>
            <div className="flex flex-col items-stretch justify-end gap-1">
              <button
                onClick={() => handleCustomFill(dueEpisode)}
                disabled={!fillDraft.ok || fillSubmitting}
                title={
                  fillSubmitting
                    ? "Beleg wird verbucht"
                    : stationMissing
                      ? "Erst Station wählen"
                      : litersError || priceError
                        ? "Eingabe korrigieren"
                        : `Buchung für ${selected?.name || "die gewählte Station"}`
                }
                className="w-full rounded-lg bg-emerald-500 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {fillSubmitting ? "Wird verbucht …" : "Beleg buchen"}
              </button>
              {stationMissing ? (
                <span className="text-[10px] text-amber-300">
                  Station wählen
                </span>
              ) : (
                <span className="text-[10px] text-slate-500">
                  für {selected?.name || "—"}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )}

  <div className="mb-4">
    <p className="mb-1 text-[10px] font-bold uppercase tracking-[.2em] text-emerald-500">
      Alltag / {activeCity || "Dein Standort"}
    </p>
    <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
      Ein guter Stopp beginnt hier.
    </h2>
    <p className="mt-2 text-sm text-slate-400">
      Von oben nach unten: Empfehlung → Tanken → Kosten → Heute →
      Stationen → Umweg → Belege.
    </p>
  </div>
  <p className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-slate-500">
    1 · Empfehlung
  </p>

  <section
    className={`${panel} relative overflow-hidden p-5 shadow-2xl sm:p-7`}
    aria-labelledby="compass-title"
  >
    <div className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl" />
    <div className="pointer-events-none absolute -bottom-32 -left-32 h-80 w-80 rounded-full bg-sky-500/10 blur-3xl" />
    <div className="relative mb-6 flex flex-wrap items-center justify-between gap-3">
      <Badge warning={!decideRes.data?.calibrated}>
        <Compass size={13} />
        {decideRes.data?.calibrated
          ? "Kalibrierter Entscheidungs-Kompass"
          : "Entscheidungs-Kompass"}
      </Badge>
      <span className="text-xs text-slate-500">
        {best
          ? `Preismeldung ${timeLabel(best.observed_at)}`
          : "Keine simulierten Preise"}
      </span>
    </div>
    <div
      className={`relative rounded-xl border p-5 sm:p-6 ${best ? "border-emerald-500/30 bg-gradient-to-br from-emerald-950/70 via-slate-900 to-slate-900 glow-emerald" : "border-amber-500/20 bg-gradient-to-br from-amber-950/30 via-slate-900 to-slate-900"}`}
    >
      <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
        <div className="flex items-start gap-4">
          <div
            className={`rounded-2xl border p-3 ${best ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-amber-500/20 bg-amber-500/10 text-amber-400"}`}
          >
            {best ? <FuelIcon size={28} /> : <Clock size={28} />}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-widest text-slate-400">
              {best
                ? "Aktuell am günstigsten"
                : "Ehrlich statt geschätzt"}
            </p>
            <h3
              id="compass-title"
              className="mt-1 text-xl font-bold text-white sm:text-2xl"
            >
              {best ? best.name : "Noch kein frischer Preis."}
            </h3>
            <p className="mt-2 max-w-lg text-xs leading-relaxed text-slate-400">
              {best
                ? `Unter deinen ausgewählten Stationen in ${activeCity}. Das ist ein Preisvergleich, noch keine Empfehlung für eine Extra-Fahrt.`
                : "Sobald der Pi Preise hochlädt und der NAS-Lesezugang eingerichtet ist, erscheinen sie hier automatisch."}
            </p>
          </div>
        </div>
        <div className="shrink-0 sm:text-right">
          <div className="text-4xl font-black tracking-tight text-white tabular-nums">
            {euro(bestPrice, 3)}{" "}
            <span className="text-sm font-medium text-slate-500">
              €/L
            </span>
          </div>
          {best?.maps_url ? (
            <a
              href={best.maps_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"
            >
              Route öffnen
              <ArrowUpRight size={15} />
            </a>
          ) : (
            <span className="mt-3 block text-xs text-slate-500">
              {best
                ? "Keine Koordinaten hinterlegt"
                : "Route erst mit Stationsdaten"}
            </span>
          )}
        </div>
      </div>
    </div>

    {/* F1/F2/F3 Empfehlung aus /v1/decide (Ampel + Fenster + Alternativen) */}
    {(() => {
      const rec = decideRes.data;
      if (decideRes.pending && !rec) {
        return (
          <div className="mt-5">
            <SkeletonPanel
              lines={3}
              label="Empfehlung wird berechnet"
            />
          </div>
        );
      }
      if (decideRes.error || rec?.error_code) {
        return (
          <LoadError
            className="mt-5 rounded-xl border border-rose-500/25 bg-rose-950/20 p-4 text-xs leading-relaxed text-rose-200"
            errorCode={rec?.error_code || decideRes.errorCode}
            fallback="Empfehlung derzeit nicht erreichbar."
            onRetry={refreshNow}
            compact
          />
        );
      }
      if (!rec) return null;
      const p = rec.primary;
      // C5: Symbol zusätzlich zur Farbe — die Ampel ist für
      // Rot-Grün-Schwache nicht an der Farbe allein erkennbar.
      const meta = {
        refuel_now: {
          chip: "JETZT TANKEN",
          symbol: "●",
          cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
          Icon: FuelIcon,
        },
        wait: {
          chip: "WARTEN",
          symbol: "▼",
          cls: "border-amber-500/30 bg-amber-500/10 text-amber-300",
          Icon: Clock,
        },
        refuel_elsewhere: {
          chip: "WOANDERS TANKEN",
          symbol: "→",
          cls: "border-sky-500/30 bg-sky-500/10 text-sky-300",
          Icon: Route,
        },
        no_advice: {
          chip: "KEINE EMPFEHLUNG",
          symbol: "–",
          cls: "border-slate-700 bg-slate-800/60 text-slate-300",
          Icon: ShieldCheck,
        },
      }[p.action];
      const anchor = p.station.price_now;
      const bestAlt = [...rec.alternatives_nearby]
        .sort((a, b) => b.net_eur - a.net_eur)
        .find((a) => a.worth_it);
      const nearest3 = [...stations]
        .sort((a, b) => (a.dist_km ?? 1e9) - (b.dist_km ?? 1e9))
        .slice(0, 3);
      const savingVs = (expected: number | null | undefined) =>
        anchor != null && expected != null
          ? (anchor - expected) * liters
          : null;
      return (
        <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${meta.cls}`}
            >
              <span
                aria-hidden="true"
                className="text-[13px] leading-none"
              >
                {meta.symbol}
              </span>
              <meta.Icon size={13} />
              {meta.chip}
            </span>
            <span className="font-mono text-[11px] text-slate-500">
              {p.p_correct != null
                ? `${Math.round(p.p_correct * 100)} % sicher`
                : "unkalibriert"}
              {p.confidence_badge !== "low"
                ? ` · ${p.confidence_badge}`
                : ""}
            </span>
          </div>
          <p className="mt-2 text-[13px] leading-snug text-slate-200">
            {p.reason_short}
          </p>
          {rec.quality?.rolling_picp_7d_pct != null && (
            <p
              className={`mt-1 font-mono text-[11px] ${
                rec.quality.rolling_picp_7d_badge === "green"
                  ? "text-emerald-400/80"
                  : rec.quality.rolling_picp_7d_badge === "yellow"
                    ? "text-amber-300/90"
                    : "text-rose-300"
              }`}
            >
              Intervallqualität (7 Tage):{" "}
              {percentLabel(rec.quality.rolling_picp_7d_pct, 1)}
              {rec.quality.rolling_picp_7d_badge === "green"
                ? " — im Zielbereich"
                : rec.quality.rolling_picp_7d_badge === "yellow"
                  ? " — grenzwertig"
                  : " — unsicher, Empfehlung unterdrückt"}
            </p>
          )}
          {p.action === "wait" && p.recommended_window && (
            <p className="mt-1 font-mono text-[11px] text-amber-300">
              {clockLabel(p.recommended_window.start)}–
              {clockLabel(p.recommended_window.end)} Uhr · ~
              {euro(p.recommended_window.expected_price, 3)} €/L · −
              {euro(p.expected_saving_eur)} €
            </p>
          )}
          {p.action === "refuel_elsewhere" && bestAlt && (
            <p className="mt-1 font-mono text-[11px] text-sky-300">
              {bestAlt.name} · {euro(bestAlt.price, 3)} €/L · +
              {euro(bestAlt.detour_km, 1)} km · netto +
              {euro(bestAlt.net_eur)} €
            </p>
          )}
          {p.action === "refuel_now" && (
            <p className="mt-1 font-mono text-[11px] text-emerald-300">
              {p.station.name} ·{" "}
              {anchor != null
                ? `${euro(anchor, 3)} €/L`
                : "Preis unbekannt"}
            </p>
          )}
          {p.action === "no_advice" && (
            <div className="mt-2 grid gap-1 font-mono text-[11px] text-slate-400">
              {nearest3.map((s) => (
                <div
                  key={s.station_id}
                  className="flex justify-between gap-2"
                >
                  <span className="truncate">{s.name}</span>
                  <span>
                    {price(s) != null
                      ? `${euro(price(s), 3)} €/L`
                      : "—"}
                  </span>
                </div>
              ))}
              {nearest3.length === 0 && (
                <span>Keine Stationen im Polling-Set.</span>
              )}
            </div>
          )}

          {/* F3: Heute später / Diese Woche */}
          {(rec.windows_today.length > 0 ||
            rec.windows_week.length > 0) && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {rec.windows_today.length > 0 && (
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                  <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    <Clock size={11} /> Heute später
                  </p>
                  {rec.windows_today.map((w) => {
                    const sv =
                      w.expected_saving_eur ??
                      savingVs(w.expected_price);
                    return (
                      <div
                        key={w.start}
                        className="flex items-center justify-between gap-2 py-0.5 font-mono text-[11px]"
                      >
                        <span className="text-slate-300">
                          {clockLabel(w.start)}–{clockLabel(w.end)}
                        </span>
                        <span className="text-slate-400">
                          ~{euro(w.expected_price, 3)}
                        </span>
                        <span
                          className={
                            sv != null && sv > 0
                              ? "text-emerald-300"
                              : "text-slate-500"
                          }
                        >
                          {sv != null ? `−${euro(sv)} €` : "—"}
                          {w.p != null
                            ? ` · ${Math.round(w.p * 100)} %`
                            : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {rec.windows_week.length > 0 && (
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                  <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    <CalendarDays size={11} /> Diese Woche
                  </p>
                  {rec.windows_week.map((w) => {
                    const sv =
                      w.expected_saving_eur ??
                      savingVs(w.expected_price);
                    return (
                      <div
                        key={w.start}
                        className="flex items-center justify-between gap-2 py-0.5 font-mono text-[11px]"
                      >
                        <span className="text-slate-300">
                          {new Date(w.start).toLocaleDateString(
                            "de-DE",
                            {
                              weekday: "short",
                              timeZone: "Europe/Berlin",
                            },
                          )}{" "}
                          {clockLabel(w.start)}–{clockLabel(w.end)}
                        </span>
                        <span className="text-slate-400">
                          ~{euro(w.expected_price, 3)}
                        </span>
                        <span
                          className={
                            sv != null && sv > 0
                              ? "text-emerald-300"
                              : "text-slate-500"
                          }
                        >
                          {sv != null ? `−${euro(sv)} €` : "—"}
                          {w.p != null
                            ? ` · ${Math.round(w.p * 100)} %`
                            : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* F2: Alternativen */}
          {rec.alternatives_nearby.length > 0 && (
            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
              <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <Route size={11} /> Hier oder woanders?
              </p>
              {rec.alternatives_nearby.map((a) => (
                <div
                  key={a.station_id}
                  className="py-1.5 first:pt-0.5 last:pb-0.5"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-[12px] leading-snug text-slate-300">
                      {a.name}
                    </span>
                    <span
                      className={`shrink-0 font-mono text-[12px] font-bold ${a.worth_it ? "text-emerald-300" : "text-slate-500"}`}
                    >
                      {a.net_eur >= 0 ? "+" : "−"}
                      {euro(Math.abs(a.net_eur))} €
                      {a.worth_it ? " ✓" : ""}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-3 font-mono text-[11px] text-slate-500">
                    <span>
                      {euro(a.price, 3)} €/L · +{euro(a.detour_km, 1)}{" "}
                      km
                    </span>
                    <span className="shrink-0">
                      {a.p_lohnt != null
                        ? `${Math.round(a.p_lohnt * 100)} % lohnt sich`
                        : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Intent-CTAs */}
          {p.action !== "no_advice" && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => handleIntent("wait")}
                className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20"
              >
                Ich warte
              </button>
              <button
                onClick={() =>
                  handleIntent(
                    "navigate",
                    p.action === "refuel_elsewhere" &&
                      bestAlt?.maps_url
                      ? bestAlt.maps_url
                      : p.station.maps_url,
                  )
                }
                className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/20"
              >
                Navigieren
              </button>
              <button
                onClick={() => handleIntent("refuel_now")}
                className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/20"
              >
                Jetzt tanken
              </button>
              <button
                onClick={() => handleIntent("dismiss")}
                className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-[11px] font-semibold text-slate-400 hover:bg-slate-800"
              >
                Verwerfen
              </button>
            </div>
          )}
        </div>
      );
    })()}

    {/* A2: Tankstand — die Physik neben der Ampel. Ohne Eingabe steht hier
        nichts (die App rät keinen Tankstand); mit Eingabe übermittelt der
        Slider tank_percent + tank_capacity_l an /decide und bekommt die
        Bewertung zurück: Reservebereich blockiert das Warten, knapp heißt
        ehrlicher Hinweis. */}
    <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          <Gauge size={11} aria-hidden="true" /> Tankstand
        </span>
        {tankPercent != null && (
          <span className="font-mono text-[11px] text-slate-400">
            {tankPreviewLine(tankPercent, tankCapacity, consumption)}
          </span>
        )}
      </div>
      {tankPercent == null ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-[11px] leading-relaxed text-slate-400">
            Wie voll ist der Tank? Mit Angabe sagt die App ehrlich, ob
            Warten bis zum Fenster riskant ist.
          </p>
          <button
            onClick={() => setTankPercent(25)}
            title="Füllstand auf ein Viertel setzen — weiterdrehen unten"
            className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-800"
          >
            Viertel gesetzt — bewerten
          </button>
        </div>
      ) : (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <PrecisionSlider
            id="tankPercent"
            label="Füllstand"
            icon={<Gauge size={14} />}
            value={tankPercent}
            onChange={setTankPercent}
            min={0}
            max={100}
            step={5}
            unit="%"
            valueText={`${deTrimmed(tankPercent, 0)} % Füllstand`}
            valueSpeech={`${deTrimmed(tankPercent, 0)} Prozent Füllstand`}
            hint={
              <button
                onClick={() => setTankPercent(null)}
                className="mt-1 text-[10px] text-slate-500 underline decoration-dotted hover:text-slate-300"
              >
                Keine Angabe — Tankstand-Hinweis ausblenden
              </button>
            }
          />
          <PrecisionSlider
            id="tankCapacity"
            label="Tankgröße"
            value={tankCapacity}
            onChange={setTankCapacity}
            min={20}
            max={120}
            step={5}
            unit="L"
            valueText={`${deTrimmed(tankCapacity, 0)} Liter Tank`}
            valueSpeech={`${deTrimmed(tankCapacity, 0)} Liter Tank`}
            hint={
              <span className="mt-1 block text-[10px] text-slate-500">
                Fahrzeugangabe — gehört zum Profil, steht auf allen Geräten.
              </span>
            }
          />
        </div>
      )}
      {(() => {
        const tank = decideRes.data?.tank;
        if (!tank) return null;
        if (tank.state === "empty") {
          return (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-[11px] leading-snug text-rose-200"
            >
              {tank.message}
            </p>
          );
        }
        if (tank.state === "low") {
          return (
            <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/40 px-3 py-2 text-[11px] leading-snug text-amber-200">
              {tank.message}
            </p>
          );
        }
        return (
          <p className="mt-3 font-mono text-[11px] text-slate-500">
            Tankstand ok — Restreichweite ≈{" "}
            {deTrimmed(tank.range_km, 0)} km.
          </p>
        );
      })()}
    </div>

    <div className="relative mt-5 flex items-start gap-2.5 text-xs leading-relaxed text-slate-400">
      <ShieldCheck
        size={17}
        className="mt-0.5 shrink-0 text-sky-400"
      />
      <p>
        <span className="font-medium text-slate-200">Einordnung</span>{" "}
        {decideRes.data?.calibrated
          ? "Kalibrierte Empfehlung aktiv — Ampel oben beachten. Trefferquoten und Brier-Score stehen in der Modell-Trefferquote."
          : "Eine belastbare Warteempfehlung ist noch nicht freigegeben. Historie und Prognosen werden geprüft — bis dahin zählen hier nur aktuelle Preismeldungen."}
      </p>
    </div>
  </section>

  {/* 1b · Vertrauen auf einen Blick — die ausführliche Kalibrierung
      mit Diagramm lebt in der Werkstatt. */}
  <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-3 text-xs text-slate-400">
    <span className="flex items-center gap-1.5 font-semibold text-slate-300">
      <Scale size={14} className="text-emerald-400" />
      Modell-Trefferquote
    </span>
    <span className="font-mono">
      Warten{" "}
      <strong className="text-slate-200">
        {liveAdvice?.wait_hits ?? 0}/{liveAdvice?.wait_n ?? 0}
      </strong>
    </span>
    <span className="font-mono">
      Jetzt{" "}
      <strong className="text-slate-200">
        {liveAdvice?.now_hits ?? 0}/{liveAdvice?.now_n ?? 0}
      </strong>
    </span>
    <span className="font-mono">
      Woanders{" "}
      <strong className="text-slate-200">
        {liveAdvice?.elsewhere_hits ?? 0}/
        {liveAdvice?.elsewhere_n ?? 0}
      </strong>
    </span>
    <span className="font-mono">
      <span title="Brier-Score der letzten 30 Tage: mittlere quadratische Abweichung der behaupteten Wahrscheinlichkeit vom Ergebnis — kleiner ist besser, Ziel < 0,25.">
        Brier (30 Tage):{" "}
      </span>
      <strong className="text-slate-200">
        {liveAdvice?.brier_30d != null
          ? deNumber(liveAdvice.brier_30d)
          : "—"}
      </strong>
    </span>
    <span className="text-[11px] text-slate-500">{gateStatus}</span>
  </div>
  {m7Line && (
    <p className="mt-1.5 px-1 text-[11px] leading-snug text-slate-500">
      {m7Line} Gezählt wird pro ausgespielter Empfehlung — meist eine
      pro Tag.
      {(liveAdvice?.n_pending ?? 0) > 0 && (
        <span className="text-amber-300/90">
          {" "}
          {liveAdvice?.n_pending} Empfehlung
          {(liveAdvice?.n_pending ?? 0) > 1 ? "en" : ""} läuft noch
          und fehlt oben deshalb noch.
        </span>
      )}
    </p>
  )}

  {/* 2 · Tanken: Erfassen und Bilanz in einer Karte — man sieht
      sofort, wo ein Beleg hinkommt und was er gebracht hat. */}
  <p className="mb-2 mt-6 text-[10px] font-bold uppercase tracking-[.2em] text-slate-500">
    2 · Tanken
  </p>
  <section
    className={`${panel} mb-6 p-5 sm:p-6`}
    aria-labelledby="quickfill-heading"
  >
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <h3
          id="quickfill-heading"
          className="flex items-center gap-2 text-sm font-semibold text-white"
        >
          <FuelIcon size={16} className="text-emerald-400" />
          Tanken erfassen
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Gerade getankt? Station, Liter, Preis — fertig. Der Beleg
          landet in deiner Tank-Bilanz (rechts) und unten im Verlauf.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-400 sm:col-span-2">
            Station
            <select
              aria-label="Station des Tankbelegs"
              value={quickStation?.station_id || ""}
              onChange={(e) => setQuickStationId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white focus:border-emerald-500"
            >
              {stations.length ? (
                /* C2: Stamm-Stationen zuerst — die eigene Säule ist der
                   Normalfall beim Beleg. */
                pinnedFirstStations.map((row) => (
                  <option key={row.station_id} value={row.station_id}>
                    {pinnedIds.includes(row.station_id) ? "★ " : ""}
                    {row.name}
                    {price(row) !== null
                      ? ` — ${euro(price(row), 3)} €/L`
                      : " — Preis unbekannt"}
                  </option>
                ))
              ) : (
                <option value="">Keine Station im Set</option>
              )}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Liter
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={quickLitersStr}
              onChange={(e) =>
                setQuickLitersStr(commaToDot(e.target.value))
              }
              aria-invalid={quickDraft.litersError != null}
              title={`${fillLimitHint("liters")} — wie auf dem Kassenbon`}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white focus:border-emerald-500"
            />
            <span className="mt-1 block text-[10px] text-slate-500">
              {fillLimitHint("liters")} · z. B. 45,5.
            </span>
            {quickDraft.litersError && (
              <span className="mt-1 block text-[10px] leading-snug text-rose-300">
                {quickDraft.litersError}
              </span>
            )}
          </label>
          <label className="text-xs text-slate-400">
            Gezahlter Preis (€/L)
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={quickPriceStr}
              onChange={(e) =>
                setQuickPriceStr(commaToDot(e.target.value))
              }
              aria-invalid={quickDraft.priceError != null}
              title={`${fillLimitHint("price")} — wie an der Säule`}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white focus:border-emerald-500"
            />
            <span className="mt-1 block text-[10px] text-slate-500">
              {fillLimitHint("price")} · Vorschlag: frischer Preis der
              Station.
            </span>
            {quickDraft.priceError && (
              <span className="mt-1 block text-[10px] leading-snug text-rose-300">
                {quickDraft.priceError}
              </span>
            )}
          </label>
        </div>
        <button
          type="button"
          onClick={() => handleQuickFill()}
          disabled={!quickDraft.ok || fillSubmitting}
          title={
            fillSubmitting
              ? "Beleg wird verbucht"
              : quickDraft.stationMissing
                ? "Erst Station wählen"
                : quickDraft.litersError || quickDraft.priceError
                  ? "Eingabe korrigieren"
                  : `Beleg für ${quickStation?.name || "die gewählte Station"} buchen`
          }
          className="mt-4 w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-8"
        >
          {fillSubmitting ? "Wird verbucht …" : "Beleg buchen"}
        </button>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-5 lg:col-span-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-200">
            <FuelIcon size={15} className="text-sky-400" />
            Deine Tank-Bilanz
          </span>
          <span className="font-mono text-lg font-bold text-emerald-400">
            +{euro(statsSummaryRes.data?.wallet.saved_eur ?? 0)} €
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 font-mono text-slate-400">
          <div>
            <span className="block text-[10px] uppercase text-slate-500">
              Füllungen
            </span>
            <span className="text-xl font-bold text-slate-200">
              {statsSummaryRes.data?.wallet.n_fills ?? 0}
            </span>
          </div>
          <div>
            <span className="block text-[10px] uppercase text-slate-500">
              Befolgt
            </span>
            <span className="text-xl font-bold text-slate-200">
              {statsSummaryRes.data?.wallet.followed ?? 0}
            </span>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Dein Geld: gespart gegenüber „immer sofort tanken“ —
          gerechnet nur aus deinen echten Tankbelegen. Jeder Beleg
          erscheint zusätzlich unten im Verlauf.
        </p>
      </div>
    </div>
  </section>

  <p className="mb-2 mt-6 text-[10px] font-bold uppercase tracking-[.2em] text-slate-500">
    3 · Was kostet die Füllung
  </p>
  <div className="mb-6 grid gap-4 sm:grid-cols-3">
    <Metric
      label={`Füllung mit ${liters} Litern`}
      value={
        <>
          {euro(bestPrice === null ? null : bestPrice * liters)}{" "}
          <span className="text-sm font-normal text-slate-500">
            €
          </span>
        </>
      }
      detail="Zum günstigsten aktuell gemeldeten Literpreis."
    />
    <Metric
      label={
        selectedIsCheapest
          ? "Teuerste statt billigste Station"
          : "Unterschied zur Vergleichsstation"
      }
      value={
        <span
          className={
            selectedIsCheapest
              ? "text-amber-300"
              : difference != null && difference > 0.01
                ? "text-rose-300"
                : "text-slate-200"
          }
        >
          {euro(selectedIsCheapest ? span : difference)}{" "}
          <span className="text-sm font-normal text-slate-500">
            €
          </span>
        </span>
      }
      detail={
        selectedIsCheapest
          ? `Deine Vergleichsstation (${selected?.name || "—"}) ist gerade die billigste — so viel teurer wäre die teuerste pro Füllung. Umwegkosten rechnet „Rechnet sich der Umweg?“.`
          : `So viel teurer ist deine Vergleichsstation (${selected?.name || "—"}) pro Füllung als die billigste. Umwegkosten rechnet „Rechnet sich der Umweg?“.`
      }
    />
    <div className={`${panel} p-5`}>
      {/* E6: 1-L-Schritte am Slider, exakte Menge im Begleitfeld. */}
      <PrecisionSlider
        id="liters"
        label="Deine Tankmenge"
        icon={<SlidersHorizontal size={14} />}
        value={liters}
        onChange={setLiters}
        min={10}
        max={80}
        step={1}
        unit="L"
        valueSpeech={`${liters} Liter`}
        hint={
          <p className="mt-2 text-[11px] text-slate-500">
            Nur zur Berechnung. Keine Buchung, keine erfundene
            Ersparnis.
          </p>
        }
      />
    </div>
  </div>

  {/* Tagesstreifen (06–24 Uhr) */}
  <p className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-slate-500">
    4 · Heute
  </p>
  <section
    className={`${panel} mb-6 p-5 sm:p-6`}
    aria-labelledby="daystrip-heading"
  >
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h3
        id="daystrip-heading"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <CalendarDays size={16} className="text-emerald-400" />
        Heute im Überblick · {selected?.name || "—"}
      </h3>
      <span className="text-[11px] text-slate-500">
        06–24 Uhr · letzte Meldung je Stunde
      </span>
    </div>
    {dayStrip.error || dayStrip.data?.error_code ? (
      <LoadError
        errorCode={dayStrip.data?.error_code || dayStrip.errorCode}
        fallback="Der Tagesverlauf konnte nicht geladen werden."
        onRetry={refreshNow}
        retryLabel="Tagesverlauf neu laden"
      />
    ) : stripCells.some((c) => c.value !== null) ? (
      <>
        <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
          {stripCells.map((cell) => (
            <div
              key={cell.hour}
              title={
                cell.value === null
                  ? `${String(cell.hour).padStart(2, "0")}:00 — keine offene Meldung`
                  : `${String(cell.hour).padStart(2, "0")}:00 — ${euro(cell.value, 3)} €/L`
              }
              className={`rounded-lg border p-2 text-center ${
                cell.current
                  ? "z-10 scale-105 border-emerald-400 bg-emerald-950/80"
                  : cell.tone === "cheap"
                    ? "border-emerald-500/30 bg-emerald-900/30"
                    : cell.tone === "pricey"
                      ? "border-rose-500/30 bg-rose-950/30"
                      : cell.tone === "mid"
                        ? "border-slate-700/40 bg-slate-800/40"
                        : "border-slate-800 bg-slate-950/40"
              }`}
            >
              <div className="font-mono text-[10px] text-slate-400">
                {String(cell.hour).padStart(2, "0")}:00
              </div>
              <div
                className={`mt-0.5 truncate font-mono text-[11px] font-bold sm:text-xs ${
                  cell.value === null
                    ? "text-slate-600"
                    : cell.tone === "cheap"
                      ? "text-emerald-300"
                      : cell.tone === "pricey"
                        ? "text-rose-300"
                        : "text-slate-200"
                }`}
              >
                {cell.value === null ? "–" : euro(cell.value, 3)}
              </div>
              {cell.current && (
                <div className="mt-0.5 text-[9px] font-extrabold uppercase tracking-wider text-emerald-400">
                  Jetzt
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Grün = unteres Preisdrittel dieses Tages an dieser Station,
          rot = oberes Drittel. Nur echte offene Meldungen — leere
          Stunden hatten keine. Keine Prognose, keine Empfehlung.
        </p>
      </>
    ) : dayStrip.pending && !dayStrip.data ? (
      <SkeletonPanel
        lines={2}
        title={false}
        label="Tagesverlauf wird geladen"
      />
    ) : (
      <Empty>
        Noch keine offenen Stundenmeldungen für diese Station — leere
        Stunden werden nicht erfunden.
      </Empty>
    )}
  </section>

  {/* Stations List */}
  <p className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-slate-500">
    5 · Stationen
  </p>
  <section
    className={`${panel} mb-6 overflow-hidden`}
    aria-labelledby="stations-heading"
  >
    <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
      <div>
        <h3 id="stations-heading" className="text-sm font-semibold">
          Deine Stationen
        </h3>
        <p className="mt-1 text-[11px] text-slate-500">
          Stern = Stamm-Station (oben, auf diesem Gerät gespeichert).
          Station antippen, um sie als Vergleich zu wählen.
        </p>
      </div>
      <span className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-400">
        {stations.length} im Set
      </span>
    </div>
    {/* C2: Suche, Markenfilter, Sortierung — bei 20+ Stationen im
        Frankfurt-Radius sonst unbedienbar. */}
    <div className="flex flex-col gap-2 border-b border-slate-800 px-5 py-3 sm:flex-row sm:items-center">
      <label className="flex flex-1 items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs">
        <Search size={13} className="shrink-0 text-slate-500" aria-hidden="true" />
        <span className="sr-only">Stationen durchsuchen</span>
        <input
          type="text"
          value={stationQuery}
          onChange={(e) => setStationQuery(e.target.value)}
          placeholder="Suche nach Name oder Marke"
          aria-label="Stationen nach Name oder Marke durchsuchen"
          className="w-full bg-slate-900 text-slate-100 placeholder:text-slate-600 focus:outline-none"
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-slate-400">
        <span className="sr-only">Marke filtern</span>
        <select
          aria-label="Nach Marke filtern"
          value={stationBrand}
          onChange={(e) => setStationBrand(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-100"
        >
          <option value="">Alle Marken</option>
          {stationBrands.map((brand) => (
            <option key={brand} value={brand}>
              {brand}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs text-slate-400">
        <span className="sr-only">Sortieren</span>
        <select
          aria-label="Liste sortieren"
          value={stationSort}
          onChange={(e) => setStationSort(e.target.value as StationSort)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-100"
        >
          {STATION_SORTS.map((option) => (
            <option key={option.value} value={option.value} title={option.title}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
    {pinNote && (
      <p
        role="status"
        aria-live="polite"
        className="border-b border-slate-800 px-5 py-2 text-[11px] leading-snug text-amber-300"
      >
        {pinNote}
      </p>
    )}
    {stations.length ? (
      filteredCount === 0 ? (
        <div className="p-5">
          <Empty>
            Keine Station passt zu Suche oder Markenfilter. Suche leeren
            zeigt wieder alle {stations.length} Stationen.
          </Empty>
        </div>
      ) : (
      <div className="divide-y divide-slate-800/80">
        {orderedStations.map((row) => {
          const value = price(row);
          const age =
            row.age_minutes === null
              ? null
              : Math.max(0, row.age_minutes + elapsed);
          const label = !row.observed_at
            ? "Keine Meldung"
            : !online || age! > 30
              ? "Stand veraltet"
              : row.status === "closed"
                ? "Geschlossen"
                : value === null
                  ? "Kein Kraftstoffpreis"
                  : "Offen";
          const isPinned = pinnedIds.includes(row.station_id);
          return (
            <div
              key={row.station_id}
              className={`flex w-full items-center justify-between gap-2 px-5 py-4 transition-colors hover:bg-slate-800/40 ${selected?.station_id === row.station_id ? "bg-emerald-500/[.04]" : ""}`}
            >
              <button
                onClick={() => setSelectedId(row.station_id)}
                aria-pressed={selected?.station_id === row.station_id}
                aria-label={`${row.name} als Vergleich wählen`}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${row.station_id === best?.station_id ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-slate-700 bg-slate-800 text-slate-500"}`}
                  >
                    <FuelIcon size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-200">
                      {row.name}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                      <span
                        className={
                          value !== null
                            ? "text-emerald-400"
                            : "text-amber-400"
                        }
                      >
                        {label}
                      </span>
                      <span>{row.brand || "Freie Station"}</span>
                      {row.dist_km != null && (
                        <span
                          title={
                            row.dist_mode === "road"
                              ? "Fahrstrecke mit dem Auto vom Anker dieser Stadt"
                              : "Luftlinie zum Anker — Straßenroute gerade nicht verfügbar"
                          }
                          className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400"
                        >
                          {row.dist_km.toLocaleString("de-DE", {
                            maximumFractionDigits: 1,
                          })}{" "}
                          km{" "}
                          {row.dist_mode === "road"
                            ? "Fahrt"
                            : "Luftlinie"}
                        </span>
                      )}
                      <span>
                        {age === null
                          ? "Noch keine Daten"
                          : `vor ${Math.floor(age)} Min.`}
                      </span>
                      {selected?.station_id === row.station_id && (
                        <span className="text-sky-400">
                          Vergleichsstation
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <div
                      className={`font-mono text-lg font-bold tabular-nums ${row.station_id === best?.station_id ? "text-emerald-400" : "text-slate-200"}`}
                    >
                      {euro(value, 3)}{" "}
                      <span className="text-[10px] font-normal text-slate-500">
                        €/L
                      </span>
                    </div>
                    {value === null && row.last_price !== null && (
                      <div className="text-[10px] text-slate-500">
                        Letzte Meldung: {euroPerLiter(row.last_price)}
                      </div>
                    )}
                    {/* C2 „Netto-€“: was die Füllung mit der eingestellten
                        Tankmenge hier kostet. Umwegkosten rechnet bewusst
                        der Server (B6/H1) — deshalb keine client-seitige
                        Netto-Rechnung in der Sortierung. */}
                    {stationSort === "fill" && value !== null && (
                      <div className="text-[10px] font-semibold text-slate-400">
                        ≈ {euro(value * liters)} € für {deTrimmed(liters, 0)} L
                      </div>
                    )}
                  </div>
                  <ChevronRight
                    size={15}
                    className="text-slate-600"
                  />
                </div>
              </button>
              {/* C2: Stamm-Station pinnen — der Stern sortiert die Zeile nach
                  oben (Pin-Reihenfolge), gespeichert nur auf diesem Gerät. */}
              <button
                onClick={() => togglePin(row.station_id)}
                aria-pressed={isPinned}
                aria-label={
                  isPinned
                    ? `${row.name} aus Stamm-Stationen entfernen`
                    : `${row.name} als Stamm-Station merken`
                }
                title={
                  isPinned
                    ? "Stamm-Station lösen"
                    : "Als Stamm-Station merken — steht dann oben"
                }
                className={`shrink-0 rounded-lg border p-2 transition-colors ${
                  isPinned
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                    : "border-slate-700 text-slate-500 hover:border-amber-500/40 hover:text-amber-300"
                }`}
              >
                <Star size={15} fill={isPinned ? "currentColor" : "none"} />
              </button>
              {row.maps_url ? (
                <a
                  href={row.maps_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Route zu ${row.name} öffnen`}
                  title="Route öffnen"
                  className="shrink-0 rounded-lg border border-slate-700 p-2 text-slate-400 hover:border-emerald-500/40 hover:text-emerald-400"
                >
                  <ArrowUpRight size={15} />
                </a>
              ) : null}
            </div>
          );
        })}
      </div>
      )
    ) : (
      <div className="p-5">
        <Empty>
          Hier erscheinen die Stationen aus deinem gemeinsamen
          Polling-Set.
        </Empty>
      </div>
    )}
  </section>

  {/* Detour Section — H1/B6: Server ist einzige Quelle für Strecke + Verdict */}
  <p className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-slate-500">
    6 · Umweg
  </p>
  <section
    className={`${panel} mb-6 p-5 sm:p-6`}
    aria-labelledby="detour-heading"
  >
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h3
        id="detour-heading"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <Route size={16} className="text-emerald-400" />
        Rechnet sich der Umweg?
      </h3>
      <span className="font-mono text-[11px] text-slate-500">
        K = d · (c/100) · p + (d/v) · z · Quelle: Server (decide)
      </span>
    </div>
    {(() => {
      const rec = decideRes.data;
      const serverAlts = rec?.alternatives_nearby ?? [];
      const worthTh = rec?.thresholds?.active?.elsewhere_net_eur;
      const borderlineTh =
        rec?.thresholds?.active?.elsewhere_borderline_eur;
      const hasThresholds =
        typeof worthTh === "number" &&
        typeof borderlineTh === "number";
      if (decideRes.pending && !rec) {
        return (
          <SkeletonPanel
            lines={3}
            title={false}
            label="Umweg-Ökonomie wird berechnet"
          />
        );
      }
      if (!serverAlts.length) {
        return (
          <Empty>
            Kein günstigerer frischer Preis in {activeCity} — dann
            rechnet sich aktuell kein Umweg. Die Rechnung erscheint
            automatisch, sobald der Server (decide) Alternativen mit
            Strecke liefert.
          </Empty>
        );
      }
      return (
        <>
          <p className="mb-4 text-xs leading-relaxed text-slate-400">
            Gegenüber deiner Vergleichsstation (
            <span className="font-medium text-slate-200">
              {selected?.name}
            </span>
            ): Server liefert{" "}
            <span className="font-mono text-slate-300">
              detour_km_est
            </span>{" "}
            (Luftlinie × 1,3 → Straße, Quelle:{" "}
            <span className="font-mono text-slate-300">
              dist_mode
            </span>
            ) und{" "}
            <span className="font-mono text-slate-300">verdict</span>.
            GUI rechnet die Strecke nicht selbst (B6/H1). Der echte
            Weg kann länger sein, dann rechnet sich der Umweg eher
            noch weniger.
          </p>
          {detourMode === "dedicated" && (
            <p className="mb-4 rounded-xl border border-rose-500/30 bg-rose-950/40 p-3 text-xs leading-relaxed text-rose-200">
              <span className="font-semibold">Extrafahrt:</span> Bei
              12 €/h Zeitwert ist eine Extrafahrt von zuhause
              praktisch nie wirtschaftlich — fahr nur hin, wenn du
              ohnehin an der Station vorbeikommst.
            </p>
          )}
          <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* E6: 0,5er-Schritte am Slider, Feinwerte im Feld —
                6,3 L/100 km war mit step=1 nicht wählbar und
                beeinflusst jede Umweg-Rechnung. */}
            <PrecisionSlider
              id="consumption"
              label="Verbrauch"
              value={consumption}
              onChange={setConsumption}
              min={4}
              max={15}
              step={0.5}
              unit="L/100 km"
              valueSpeech={`${deTrimmed(consumption)} Liter pro 100 Kilometer`}
              hint={
                <span className="mt-1 block text-[10px] text-slate-500">
                  4–15 L/100 km · Feld: 6,3 möglich
                </span>
              }
            />
            <label htmlFor="speed" className="text-xs text-slate-400">
              Stadt-/Pendel-Tempo{" "}
              <span className="font-mono font-semibold text-emerald-400">
                {speed} km/h
              </span>
              <input
                id="speed"
                type="range"
                min={25}
                max={80}
                step={5}
                value={speed}
                aria-valuetext={`${speed} Kilometer pro Stunde`}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="mt-3 w-full"
              />
            </label>
            {/* E6: halbe Stufen + Feld (12,5 €/h war bisher
                unerreichbar). 0 bleibt die Automatik. */}
            <PrecisionSlider
              id="timeValue"
              label="Zeitwert"
              value={timeValue}
              onChange={setTimeValue}
              min={0}
              max={30}
              step={0.5}
              unit="€/h"
              valueText={
                timeValue > 0
                  ? `${deTrimmed(timeValue)} €/h`
                  : `Auto (${deTrimmed(timeValueUsed)} €/h ${autoZ.isPeak ? "Peak" : "offpeak"})`
              }
              valueSpeech={
                timeValue > 0
                  ? `${deTrimmed(timeValue)} Euro pro Stunde`
                  : `Automatik ${deTrimmed(timeValueUsed)} Euro pro Stunde`
              }
              hint={
                <span className="mt-1 block text-[10px] text-slate-500">
                  0 = Auto: 16 €/h im Peak (16:30–20:00), sonst 10
                  €/h.
                </span>
              }
            />
            <label
              htmlFor="detourMode"
              className="text-xs text-slate-400"
            >
              Fahrtcharakter
              <select
                id="detourMode"
                aria-label="Fahrtcharakter"
                value={detourMode}
                onChange={(e) =>
                  setDetourMode(e.target.value as DetourMode)
                }
                className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-200"
              >
                <option value="onroute">
                  Auf dem Weg (nur Mehrweg)
                </option>
                <option value="dedicated">
                  Extrafahrt (Hin & Rück)
                </option>
              </select>
            </label>
          </div>
          <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800">
            {serverAlts.map((alt) => {
              // Server ist Quelle — wenn Thresholds noch nicht da, kein Verdict-Label erfinden.
              const v = hasThresholds
                ? detourVerdict(alt.net_eur, worthTh!, borderlineTh!)
                : (alt.verdict as
                    "worth" | "borderline" | "not_worth");
              const worth = v === "worth";
              const borderline = v === "borderline";
              const km = alt.detour_km_est ?? alt.detour_km;
              const distMode = alt.dist_mode ?? alt.detour_mode;
              return (
                <div
                  key={alt.station_id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-200">
                      {alt.name}{" "}
                      <span className="font-mono text-emerald-400">
                        {euro(alt.price, 3)} €/L
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {km.toLocaleString("de-DE", {
                        maximumFractionDigits: 1,
                      })}{" "}
                      km Umweg ({distMode ?? "—"}) · Ersparnis{" "}
                      {alt.gross_eur != null
                        ? euro(alt.gross_eur)
                        : "—"}{" "}
                      · Sprit{" "}
                      {alt.fuel_cost_eur != null
                        ? euro(alt.fuel_cost_eur)
                        : "—"}{" "}
                      · Zeit{" "}
                      {alt.time_cost_eur != null
                        ? euro(alt.time_cost_eur)
                        : "—"}{" "}
                      · erst ab {centPerLiter(alt.critical_delta_ct)}{" "}
                      günstiger
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={`font-mono text-lg font-bold tabular-nums ${worth ? "text-emerald-400" : borderline ? "text-amber-300" : "text-slate-400"}`}
                    >
                      {euro(alt.net_eur)} € netto
                    </span>
                    {hasThresholds || alt.verdict ? (
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                          worth
                            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                            : borderline
                              ? "border-amber-500/25 bg-amber-500/10 text-amber-300"
                              : "border-slate-600 bg-slate-800/60 text-slate-400"
                        }`}
                      >
                        {worth
                          ? "lohnenswert"
                          : borderline
                            ? "grenzwertig"
                            : "lohnt sich nicht"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                        netto {euro(alt.net_eur)} €
                      </span>
                    )}
                    <button
                      onClick={() => setRouteAltId(alt.station_id)}
                      className={`rounded-lg border px-2 py-1 text-[11px] ${routeAltId === alt.station_id ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-700 bg-slate-900 text-slate-400 hover:text-white"}`}
                    >
                      Server prüfen
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {routeEval.data && !routeEval.error && (
            <div className="mt-5 rounded-xl border border-sky-500/25 bg-sky-950/30 p-4">
              <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold text-sky-300">
                <Cpu size={14} /> Serverseitige Prüfung:
                /v1/route/evaluate
              </h4>
              <div className="grid gap-3 text-xs sm:grid-cols-3">
                <div>
                  <p className="text-slate-500">Referenz → Ziel</p>
                  <p className="font-mono text-slate-200">
                    {euro(routeEval.data.ref_price, 3)} →{" "}
                    {euro(routeEval.data.alt_price, 3)} €/L
                  </p>
                  <p className="text-slate-400">
                    Δ {centPerLiter(routeEval.data.delta_ct)}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Kosten</p>
                  <p className="text-slate-200">
                    Brutto {euro(routeEval.data.gross_eur)} € · Umweg{" "}
                    {euro(routeEval.data.detour_cost_eur)} €
                  </p>
                  <p className="text-slate-400">
                    Sprit {euro(routeEval.data.fuel_cost_eur)} · Zeit{" "}
                    {euro(routeEval.data.time_cost_eur)} · z=
                    {routeEval.data.z_used} €/h{" "}
                    {routeEval.data.z_auto ? "(auto)" : ""}{" "}
                    {routeEval.data.is_peak ? "Peak" : "Offpeak"}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Netto</p>
                  <p
                    className={`font-mono text-lg font-bold ${routeEval.data.worth_it ? "text-emerald-400" : "text-amber-300"}`}
                  >
                    {euro(routeEval.data.net_eur)} €{" "}
                    {routeEval.data.verdict}
                  </p>
                  <p className="text-slate-400">
                    Kritisch ab{" "}
                    {centPerLiter(routeEval.data.critical_delta_ct)}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Modus {routeEval.data.mode} ·{" "}
                {routeEval.data.detour_km_oneway} km einfach,{" "}
                {routeEval.data.detour_km_total} km gesamt · Quelle{" "}
                {routeEval.data.detour_km_source ?? "—"} · Liter{" "}
                {routeEval.data.liters} · Stadt{" "}
                {routeEval.data.city || "—"}
              </p>
            </div>
          )}
          {routeEval.error && (
            <p className="mt-3 text-xs text-amber-300">
              Server-Evaluierung fehlgeschlagen — lokale Rechnung
              bleibt gültig (Server ist Quelle).
            </p>
          )}
        </>
      );
    })()}
    <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
      Netto-Ersparnis = (Dein Preis − günstigerer Preis) × Tankmenge −
      Kraftstoff des Umwegs − Zeitwert der Umwegzeit.{" "}
      {(() => {
        const rec = decideRes.data;
        const worthTh = rec?.thresholds?.active?.elsewhere_net_eur;
        const borderlineTh =
          rec?.thresholds?.active?.elsewhere_borderline_eur;
        if (
          typeof worthTh === "number" &&
          typeof borderlineTh === "number"
        ) {
          return `„Lohnenswert“ ab ${euro(worthTh)} €, „grenzwertig“ ab ${euro(borderlineTh)} € (Schwellen vom Server, M7-tunebar).`;
        }
        return "Schwellen kommen vom Server (decide → thresholds.active), keine feste Zahl in der GUI.";
      })()}{" "}
      Reine Rechenhilfe über deine Angaben — keine Buchung, keine
      garantierte Ersparnis.
    </p>
  </section>

  {/* A3: Tankbelege-Verlauf mit Storno (void statt löschen). */}
  <p className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-slate-500">
    7 · Belege
  </p>
  <section
    className={`${panel} mb-6 p-5 sm:p-6`}
    aria-labelledby="fills-heading"
  >
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h3
        id="fills-heading"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <FuelIcon size={16} className="text-emerald-400" />
        Deine Tankbelege
      </h3>
      {voidedCount > 0 && (
        <button
          type="button"
          onClick={() => setShowVoidedFills((value) => !value)}
          aria-pressed={showVoidedFills}
          title="Stornierte Belege zählen nicht in die Bilanz; der CSV-Export enthält sie immer."
          className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200"
        >
          {showVoidedFills
            ? "Stornierte ausblenden"
            : `Stornierte anzeigen (${voidedCount})`}
        </button>
      )}
      <span className="text-[11px] text-slate-500">
        Ein falsch gebuchter Beleg lässt sich stornieren — er bleibt
        als Storno in der Spur, zählt aber nicht mehr in deine Bilanz.
      </span>
    </div>
    {voidNote && (
      <p
        role="status"
        className={`mb-3 rounded-lg p-2.5 text-xs ${
          voidNote.startsWith("Storno fehlgeschlagen")
            ? "bg-rose-500/10 text-rose-300"
            : "bg-emerald-500/10 text-emerald-300"
        }`}
      >
        {voidNote}
      </p>
    )}
    {fillsRes.error ? (
      <LoadError
        errorCode={fillsRes.data?.error_code || fillsRes.errorCode}
        fallback="Tankbelege konnten nicht geladen werden."
        onRetry={refreshNow}
        retryLabel="Belege neu laden"
      />
    ) : fillList.length ? (
      visibleFills.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500">
                <th className="py-2 pr-3">Getankt</th>
                <th className="py-2 pr-3">Station</th>
                <th className="py-2 pr-3 text-right">Liter</th>
                <th className="py-2 pr-3 text-right">€/L</th>
                <th className="py-2 pr-3 text-right">Ersparnis</th>
                <th className="py-2 pr-3 text-right">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
                {visibleFills.map((fill: Fill) => (
                <tr
                  key={fill.id}
                  className={fill.voided ? "opacity-60" : undefined}
                >
                  <td className="py-2 pr-3 font-mono text-slate-300">
                    {timeLabel(fill.tanked_at)}
                  </td>
                  <td className="py-2 pr-3 text-slate-200">
                    {fill.station_name || fill.station_id}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-slate-300">
                    {euro(fill.liters, 1)}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-slate-300">
                    {euro(fill.price_paid, 3)}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-emerald-300">
                    {fill.saved_vs_always_now_eur != null
                      ? `${fill.saved_vs_always_now_eur > 0 ? "+" : "−"}${euro(Math.abs(fill.saved_vs_always_now_eur))} €`
                      : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {fill.voided ? (
                      <span className="font-semibold text-rose-300">
                        storniert
                      </span>
                    ) : (
                      <span className="text-slate-400">gebucht</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {!fill.voided && (
                      <button
                        type="button"
                        onClick={() => handleVoidFill(fill.id)}
                        disabled={voidBusy}
                        title="Beleg stornieren (wird als Storno markiert, nicht gelöscht)"
                        className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-400 transition-colors hover:border-rose-500/40 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {voidBusy ? "Storniere …" : "Stornieren"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>
          Alle Tankbelege sind storniert — „Stornierte anzeigen“
          oben macht sie wieder sichtbar.
        </Empty>
      )
    ) : (
      <Empty>
        {fillsRes.pending
          ? "Tankbelege werden geladen …"
          : "Noch keine Tankbelege. Oben unter „2 · Tanken“ erfassen — dann erscheint der Beleg hier."}
      </Empty>
    )}
  </section>
</>
  );
}
