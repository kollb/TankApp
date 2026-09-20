// Ich — Fahrzeug, Belege, Bilanz, Einstellungen (docs/produkt/UI.md
// §5.4, Phase 2).
//
// Vier Unterseiten, Segment-Steuerung oben, kein eigenes Menü. Die View
// rendert, sie entscheidet nichts (D1): die Bilanz-Zahlen kommen vom
// Server (fills/summary), die Beleg-Prüfung läuft über `data.ts`
// (`checkFillDraft`, dieselben Grenzen wie app/feedback.py), die
// Einordnung nach dem Buchen ist eine reine Median-Rechnung über die
// geladenen Preise — nie eine erfundene Ersparnis.
//
// Ehrlichkeits-Grenzen (Bilanz): Der Server liefert einen
// Vergleichsmaßstab — „immer sofort getankt“ (deine echten Belege).
// Der zweite Maßstab des Konzepts (Stadt-Median) ist mit den heutigen
// Daten nicht belegbar und steht deshalb ehrlich als „noch nicht
// messbar“ da, statt mit einer Zahl verkleidet.

import { useState } from "react";
import { Fuel as FuelIcon, Scale } from "lucide-react";
import {
  FeedbackBanner,
  type ActionFeedback,
} from "../components/FeedbackBanner";
import { LoadError } from "../components/LoadError";
import { SkeletonPanel } from "../components/Skeleton";
import { Empty, panel } from "../components/ui";
import {
  centPerLiter,
  commaToDot,
  countLabel,
  euro,
  fillLimitHint,
  monthBalanceLabel,
  timeLabel,
  yearBalanceLabel,
  type BalanceRow,
  type Fill,
  type FillDraftCheck,
  type ResourceState,
  type FillsSummary,
  type Station,
} from "../data";
import { fillPriceHint, fillRows } from "../fills";
import {
  SettingsPanel,
  VehiclePanel,
  type SettingsPanelProps,
  type VehiclePanelProps,
} from "./Settings";

/** Ich → Unterseiten (Segment-Steuerung, §5.4). */
export type IchSection = "vehicle" | "fills" | "balance" | "settings";

export const ICH_SECTIONS: Array<{ id: IchSection; label: string }> = [
  { id: "vehicle", label: "Fahrzeug" },
  { id: "fills", label: "Belege" },
  { id: "balance", label: "Bilanz" },
  { id: "settings", label: "Einstellungen" },
];

/**
 * Zweiter Maßstab (Konzept-Entscheidung 4: „Median als Standard,
 * meistgenutzte Station darunter“): die Station mit den meisten
 * (nicht stornierten) Belegen. Erst ab zwei Belegen an derselben
 * Station ist „meistgenutzt“ mehr als eine Einzelbeobachtung —
 * sonst steht nichts (keine Erfindung).
 */
export function mostUsedStation(
  fills: Fill[],
): { name: string; count: number } | null {
  const counts = new Map<string, { name: string; count: number }>();
  for (const fill of fills) {
    if (fill.voided) continue;
    const entry = counts.get(fill.station_id) ?? {
      name: fill.station_name || fill.station_id,
      count: 0,
    };
    entry.count += 1;
    counts.set(fill.station_id, entry);
  }
  let best: { name: string; count: number } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best !== null && best.count >= 2 ? best : null;
}

export interface IchViewProps {
  // Fahrzeugschnitt (SettingsPanel/VehiclePanel weiterreichen)
  vehicle: VehiclePanelProps;
  settings: SettingsPanelProps;
  // Belege: Schnellerfassung (Station vorausgefüllt, Liter + Preis)
  pinnedFirstStations: Station[];
  quickStationId: string;
  setQuickStationId: (v: string) => void;
  quickLitersStr: string;
  setQuickLitersStr: (v: string) => void;
  quickPriceStr: string;
  setQuickPriceStr: (v: string) => void;
  quickDraft: FillDraftCheck;
  priceOf: (row: Station) => number | null;
  /** Frische Set-Preise — für die Einordnung nach dem Buchen. */
  freshPrices: number[];
  fillSubmitting: boolean;
  onQuickFill: () => void;
  actionFeedback: ActionFeedback | null;
  // Belege: Verlauf mit Storno
  fillList: Fill[];
  visibleFills: Fill[];
  voidedCount: number;
  showVoidedFills: boolean;
  setShowVoidedFills: (v: boolean | ((prev: boolean) => boolean)) => void;
  voidNote: string | null;
  voidBusy: boolean;
  onVoidFill: (fillId: string) => void;
  // Bilanz
  fillsSummary: ResourceState<FillsSummary>;
  onRetry: () => void;
  /** Einstieg, wenn „Ich“ von außen geöffnet wird (z. B. „Beleg manuell
      buchen“ im Due-Prompt auf „Jetzt“). */
  initialSection?: IchSection;
  /** Nur für Tests; sonst Date.now(). */
  now?: number;
}

export function IchView(props: IchViewProps) {
  const [section, setSection] = useState<IchSection>(
    props.initialSection ?? "vehicle",
  );

  return (
    <section aria-labelledby="ich-title">
      <h1 id="ich-title" className="text-2xl font-bold tracking-tight text-white">
        Ich
      </h1>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">
        Was ist meins, was habe ich verfahren — und wie verhalte ich mich.
      </p>

      {/* Segment-Steuerung (§5.4: oben, kein eigenes Menü) */}
      <div
        role="tablist"
        aria-label="Ich — Unterseiten"
        className="mt-4 flex flex-wrap gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1"
      >
        {ICH_SECTIONS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={section === item.id}
            onClick={() => setSection(item.id)}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
              section === item.id
                ? "bg-slate-800 text-emerald-400 shadow"
                : "text-slate-500 hover:text-slate-200"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {section === "vehicle" && <VehiclePanelSection {...props} />}
        {section === "fills" && <FillsSection {...props} />}
        {section === "balance" && <BalanceSection {...props} />}
        {section === "settings" && <SettingsPanel {...props.settings} />}
      </div>
    </section>
  );
}

function VehiclePanelSection({ vehicle, settings }: IchViewProps) {
  return (
    <div>
      <VehiclePanel {...vehicle} />
      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        Kraftstoff und Stadt liegen unter „Einstellungen“ — sie gelten für
        alle Ansichten, nicht nur für das Fahrzeug.
        {settings.version ? ` · TankApp ${settings.version}` : ""}
      </p>
    </div>
  );
}

/** Ich → Belege: Schnellerfassung oben, Verlauf mit Storno darunter. */
function FillsSection(props: IchViewProps) {
  const {
    actionFeedback,
    fillList,
    fillSubmitting,
    onQuickFill,
    onVoidFill,
    priceOf,
    pinnedFirstStations,
    quickDraft,
    quickLitersStr,
    quickPriceStr,
    quickStationId,
    setQuickLitersStr,
    setQuickPriceStr,
    setQuickStationId,
    setShowVoidedFills,
    showVoidedFills,
    voidBusy,
    voidNote,
    visibleFills,
    voidedCount,
  } = props;

  // Zweiter Maßstab unter dem Median (Konzept-Entscheidung 4) — null,
  // solange „meistgenutzt“ keine Mehrbeobachtung wäre.
  const mostUsed = mostUsedStation(fillList);

  // O32: Was neben dem Preisfeld steht — Live-Preis der gewählten Station
  // mit Alter, und die Abweichung der Eingabe, sobald sie über der Schwelle
  // liegt. Ohne frischen Preis bleibt die Zeile leer statt zu raten.
  const quickStation =
    pinnedFirstStations.find((row) => row.station_id === quickStationId) ??
    null;
  const priceHint = fillPriceHint({
    station: quickStation,
    livePrice: quickStation ? priceOf(quickStation) : null,
    typed: quickPriceStr,
    now: props.now,
  });

  return (
    <div>
      {/* T2: derselbe Kanal wie im Kopf — Fehler in rose, nicht in grün. */}
      <FeedbackBanner feedback={props.actionFeedback} className="mb-4" />

      {/* Schnellerfassung — Station vorausgefüllt, Details optional */}
      <section
        className={`${panel} mb-4 p-5 sm:p-6`}
        aria-labelledby="ich-fills-quick-heading"
      >
        <h3
          id="ich-fills-quick-heading"
          className="flex items-center gap-2 text-sm font-semibold text-white"
        >
          <FuelIcon size={16} className="text-emerald-400" />
          Tanken erfassen
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Station, Liter, Preis — in unter 15 Sekunden steht der Beleg in
          deiner Bilanz.
        </p>
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void onQuickFill();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-xs text-slate-400 sm:col-span-1">
              Station
              <select
                aria-label="Station des Belegs"
                value={quickStationId}
                onChange={(e) => setQuickStationId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white focus:border-emerald-500"
              >
                {pinnedFirstStations.length ? (
                  pinnedFirstStations.map((row) => (
                    <option key={row.station_id} value={row.station_id}>
                      {row.name}
                      {priceOf(row) !== null
                        ? ` — ${euro(priceOf(row), 3)} €/L`
                        : " — Preis unbekannt"}
                    </option>
                  ))
                ) : (
                  <option value="">Noch keine Station eingerichtet</option>
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
                onChange={(e) => setQuickLitersStr(commaToDot(e.target.value))}
                aria-invalid={quickDraft.litersError != null}
                title={`${fillLimitHint("liters")} — wie auf dem Kassenbon`}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white focus:border-emerald-500"
              />
              <span className="mt-1 block text-xs text-slate-500">
                {fillLimitHint("liters")} · z. B. 45,5.
              </span>
              {quickDraft.litersError && (
                <span className="mt-1 block text-xs leading-snug text-rose-300">
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
                onChange={(e) => setQuickPriceStr(commaToDot(e.target.value))}
                aria-invalid={quickDraft.priceError != null}
                title={`${fillLimitHint("price")} — wie an der Säule`}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white focus:border-emerald-500"
              />
              <span className="mt-1 block text-xs text-slate-500">
                {fillLimitHint("price")} · Vorschlag: frischer Preis der
                Station.
              </span>
              {/* O32: Live-Preis mit Alter — der Vergleich, den man sonst in
                  der Stationsliste suchen müsste. */}
              {priceHint && (
                <span className="mt-1 block text-xs leading-snug text-slate-400">
                  {priceHint.text}
                </span>
              )}
              {priceHint?.driftText && (
                <span className="mt-1 block text-xs leading-snug text-amber-300">
                  {priceHint.driftText}
                </span>
              )}
              {quickDraft.priceError && (
                <span className="mt-1 block text-xs leading-snug text-rose-300">
                  {quickDraft.priceError}
                </span>
              )}
            </label>
          </div>
          <button
            type="submit"
            disabled={!quickDraft.ok || fillSubmitting}
            title={
              fillSubmitting
                ? "Beleg wird verbucht"
                : quickDraft.stationMissing
                  ? "Erst Station wählen"
                  : quickDraft.litersError || quickDraft.priceError
                    ? "Eingabe korrigieren"
                    : "Beleg buchen"
            }
            className="mt-4 w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-8"
          >
            {fillSubmitting ? "Wird verbucht …" : "Beleg buchen"}
          </button>
        </form>
      </section>

      {/* Verlauf mit Storno (void statt löschen — A3) */}
      <section
        className={`${panel} overflow-hidden`}
        aria-labelledby="ich-fills-list-heading"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 px-5 pt-5">
          <h3
            id="ich-fills-list-heading"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <FuelIcon size={16} className="text-emerald-400" />
            Deine Belege
          </h3>
          {voidedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowVoidedFills((value) => !value)}
              aria-pressed={showVoidedFills}
              title="Stornierte Belege anzeigen"
              className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200"
            >
              {showVoidedFills
                ? "Stornierte ausblenden"
                : `Stornierte anzeigen (${voidedCount})`}
            </button>
          )}
        </div>
        <p className="mb-3 px-5 text-xs text-slate-500">
          Ein falsch gebuchter Beleg lässt sich stornieren — er bleibt als
          Storno in der Spur, zählt aber nicht mehr in deine Bilanz.
        </p>
        {voidNote && (
          <p
            role="status"
            className={`mb-3 mx-5 rounded-lg p-2.5 text-xs ${
              voidNote.startsWith("Storno fehlgeschlagen")
                ? "bg-rose-500/10 text-rose-300"
                : "bg-emerald-500/10 text-emerald-300"
            }`}
          >
            {voidNote}
          </p>
        )}
        {visibleFills.length ? (
          <>
            {/* Mobil: Beleg als Karte — die siebenspaltige Tabelle brauchte
                560 px Mindestbreite und musste seitlich geschoben werden
                („verschiedene Dinge die scrollen müssen“). Beide Fassungen
                lesen dieselben Werte aus `fillRows()` (src/fills.ts). */}
            <ul className="divide-y divide-slate-800/60 sm:hidden">
              {fillRows(visibleFills).map((row) => (
                <li
                  key={row.id}
                  className={`flex items-start justify-between gap-3 px-5 py-3 ${
                    row.voided ? "opacity-60" : ""
                  }`}
                >
                  <div className="min-w-0 text-xs">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-mono text-slate-300">
                        {row.time}
                      </span>
                      <span
                        className={
                          row.voided
                            ? "font-semibold text-rose-300"
                            : "text-slate-400"
                        }
                      >
                        {row.status}
                      </span>
                    </p>
                    <p className="mt-0.5 break-words text-slate-200">
                      {row.station}
                    </p>
                    <p className="mt-1 font-mono text-slate-300">
                      {row.volume}
                    </p>
                    {row.priceNote && (
                      <p className="mt-0.5 text-amber-300/90">
                        {row.priceNote}
                      </p>
                    )}
                    <p
                      className={`mt-0.5 font-mono ${
                        row.savingsTone === "good"
                          ? "text-emerald-300"
                          : row.savingsTone === "bad"
                            ? "text-rose-300"
                            : "text-slate-500"
                      }`}
                    >
                      {row.savings}
                    </p>
                    {row.timing && <p className="mt-0.5 text-slate-400">{row.timing}</p>}
                    {row.elsewhereNet && <p className="mt-0.5 font-mono text-sky-200">{row.elsewhereNet}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    {!row.voided && (
                      <button
                        type="button"
                        onClick={() => onVoidFill(row.id)}
                        disabled={voidBusy}
                        title="Beleg stornieren (wird als Storno markiert, nicht gelöscht)"
                        className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 transition-colors hover:border-rose-500/40 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {voidBusy ? "Storniere …" : "Stornieren"}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {/* Ab `sm`: die Tabelle, unverändert in Spalten und Ausrichtung. */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-500">
                    <th className="px-5 py-2 pr-3">Getankt</th>
                    <th className="px-3 py-2">Station</th>
                    <th className="px-3 py-2 text-right">Liter</th>
                    <th className="px-3 py-2 text-right">€/L</th>
                    <th className="px-3 py-2 text-right">Ersparnis</th>
                    <th className="px-3 py-2 text-right">Status</th>
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {fillRows(visibleFills).map((row) => (
                    <tr key={row.id} className={row.voided ? "opacity-60" : undefined}>
                      <td className="px-5 py-2 pr-3 font-mono text-slate-300">
                        {row.time}
                      </td>
                      <td className="px-3 py-2 text-slate-200">
                        {row.station}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">
                        {row.liters}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">
                        {row.pricePerLiter}
                        {row.priceNote && (
                          <span className="block text-amber-300/90">
                            {row.priceNote}
                          </span>
                        )}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono ${
                          row.savingsTone === "good"
                            ? "text-emerald-300"
                            : row.savingsTone === "bad"
                              ? "text-rose-300"
                              : "text-slate-500"
                        }`}
                      >
                        {row.savings}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {row.voided ? (
                          <span className="font-semibold text-rose-300">
                            {row.status}
                          </span>
                        ) : (
                          <span className="text-slate-400">
                            {row.status}
                            {row.timing && <span className="block text-xs text-slate-500">{row.timing}</span>}
                            {row.elsewhereNet && <span className="block font-mono text-xs text-sky-300">{row.elsewhereNet}</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-2 text-right">
                        {!row.voided && (
                          <button
                            type="button"
                            onClick={() => onVoidFill(row.id)}
                            disabled={voidBusy}
                            title="Beleg stornieren (wird als Storno markiert, nicht gelöscht)"
                            className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 transition-colors hover:border-rose-500/40 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
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
            {mostUsed && (
              <p className="mt-3 px-5 pb-1 text-xs leading-relaxed text-slate-500">
                Maßstab: der Median deines Sets (Standard) · deine
                meistgenutzte Station: {mostUsed.name} (
                {countLabel(mostUsed.count)} Belege).
              </p>
            )}
          </>
        ) : (
          <div className="px-5 pb-5">
            <Empty>
              Noch keine Belege — oben erfassen, dann erscheint der Beleg
              hier und in der Bilanz.
            </Empty>
          </div>
        )}
      </section>
    </div>
  );
}

/** Ich → Bilanz: Monat/Jahr, zwei ehrliche Maßstäbe, Verlauf. */
function BalanceSection(props: IchViewProps) {
  const { fillsSummary, onRetry } = props;
  const [period, setPeriod] = useState<"month" | "year">("month");
  const data = fillsSummary.data;

  const rows: BalanceRow[] =
    period === "month" ? (data?.months ?? []) : (data?.years ?? []);
  const latest = rows[0] ?? null;

  const bars = (data?.months ?? []).slice(0, 12);
  const maxTotal = Math.max(0, ...bars.map((row) => row.total_eur));

  return (
    <section
      className={`${panel} p-5 sm:p-6`}
      aria-labelledby="ich-balance-heading"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3
          id="ich-balance-heading"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <Scale size={16} className="text-emerald-400" />
          Bilanz
        </h3>
        <div
          role="group"
          aria-label="Zeitraum der Bilanz"
          className="flex rounded-lg border border-slate-800 bg-slate-950 p-1 text-xs font-bold"
        >
          {(["month", "year"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setPeriod(value)}
              aria-pressed={period === value}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                period === value
                  ? "bg-slate-800 text-emerald-300"
                  : "text-slate-500 hover:text-slate-200"
              }`}
            >
              {value === "month" ? "Monat" : "Jahr"}
            </button>
          ))}
        </div>
      </div>

      {fillsSummary.error ? (
        <LoadError
          errorCode={data?.error_code || fillsSummary.errorCode}
          fallback="Die Bilanz konnte nicht geladen werden."
          onRetry={onRetry}
          retryLabel="Bilanz neu laden"
        />
      ) : fillsSummary.pending && !data ? (
        <SkeletonPanel lines={4} label="Bilanz wird geladen" />
      ) : !latest ? (
        <Empty>
          Noch keine Belege — die Bilanz füllt sich mit jedem erfassten
          Beleg.
        </Empty>
      ) : (
        <>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {period === "month"
              ? monthBalanceLabel(latest.key)
              : yearBalanceLabel(latest.key)}
          </p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">
                Getankt
              </p>
              <p className="mt-1 text-xl font-bold text-white tabular-nums">
                {euro(latest.total_eur)} €
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {latest.fills} Beleg{latest.fills === 1 ? "" : "e"} ·{" "}
                {latest.avg_eur_per_liter != null
                  ? `Ø ${euro(latest.avg_eur_per_liter, 3)} €/L`
                  : "Ø —"}
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">
                Gegenüber „immer sofort getankt“ · brutto
              </p>
              <p
                className={`mt-1 text-xl font-bold tabular-nums ${
                  latest.saved_eur >= 0 ? "text-emerald-300" : "text-rose-300"
                }`}
              >
                {latest.saved_eur >= 0 ? "+" : "−"}
                {euro(Math.abs(latest.saved_eur))} €
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Maßstab: die Liter zu dem Preis, der an deiner Station zum
                Zeitpunkt der Tankung stand (Server).
              </p>
              {/* O30: Die Entscheidung rechnete netto (Umwegkosten), die
                  Bilanz wies brutto aus — beide Zeilen, benannt. */}
              {(latest.n_detour_fills ?? 0) > 0 ? (
                <p className="mt-1 text-xs leading-relaxed text-slate-300">
                  Nach Umweg:{" "}
                  <span className="font-semibold tabular-nums">
                    {(latest.saved_net_eur ?? latest.saved_eur) >= 0 ? "+" : "−"}
                    {euro(Math.abs(latest.saved_net_eur ?? latest.saved_eur))} €
                  </span>{" "}
                  — Umwegkosten {euro(latest.detour_cost_eur ?? 0)} € bei{" "}
                  {latest.n_detour_fills}{" "}
                  {latest.n_detour_fills === 1 ? "Beleg" : "Belegen"}
                  {(latest.n_detour_estimated ?? 0) > 0
                    ? `, davon ${latest.n_detour_estimated} mit geschätzter Strecke`
                    : ""}
                  .
                </p>
              ) : (
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Nach Umweg: dieselbe Zahl — kein Beleg mit Umweg.
                </p>
              )}
              {(latest.n_prognosis_price ?? 0) > 0 && (
                <p className="mt-1 text-xs leading-relaxed text-amber-300/90">
                  Ohne Prognosepreis:{" "}
                  {latest.saved_verified_eur >= 0 ? "+" : "−"}
                  {euro(Math.abs(latest.saved_verified_eur))} € (
                  {latest.n_prognosis_price}{" "}
                  {latest.n_prognosis_price === 1
                    ? "Beleg zählt nicht mit"
                    : "Belege zählen nicht mit"}
                  ).
                </p>
              )}
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">
                Gegenüber Stadt-Median
              </p>
              <p className="mt-1 text-xl font-bold text-slate-500">—</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Noch nicht messbar: der Median deiner Stadt fehlt in den
                heutigen Daten — die Zahl kommt, wenn die Engine ihn liefert.
              </p>
            </div>
          </div>

          {bars.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-xs uppercase tracking-wider text-slate-500">
                Verlauf (Balken je Monat, 12)
              </p>
              <div
                className="flex items-end gap-1.5"
                role="img"
                aria-label="Monatsausgaben der letzten 12 Monate"
              >
                {bars.map((row) => (
                  <div
                    key={row.key}
                    className="flex h-24 flex-1 flex-col items-center justify-end gap-1"
                    title={`${monthBalanceLabel(row.key)}: ${euro(row.total_eur)} €`}
                  >
                    <div
                      className="w-full rounded-t bg-emerald-500/60"
                      style={{
                        height: `${maxTotal > 0 ? Math.max(4, (row.total_eur / maxTotal) * 80) : 4}px`,
                      }}
                    />
                    <span className="text-xs font-semibold text-slate-600">
                      {row.key.slice(5)}
                    </span>
                  </div>
                ))}
              </div>
              {data?.overall && (
                <p className="mt-2 text-xs text-slate-500">
                  Gesamt: {euro(data.overall.total_eur)} € ·{" "}
                  {data.overall.fills} Belege ·{" "}
                  {euro(Math.abs(data.overall.saved_eur))} €{" "}
                  {data.overall.saved_eur >= 0 ? "günstiger" : "teurer"}{" "}
                  gegenüber „immer sofort getankt“
                  {(data.overall.n_prognosis_price ?? 0) > 0
                    ? ` · verifiziert ${data.overall.saved_verified_eur >= 0 ? "+" : "−"}${euro(Math.abs(data.overall.saved_verified_eur))} € (ohne Prognosepreis-Belege)`
                    : ""}
                  {data.overall.n_without_date > 0
                    ? ` · ${data.overall.n_without_date} ohne Datum (nicht im Verlauf)`
                    : ""}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
