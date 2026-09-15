// Ich — Fahrzeug, Belege, Bilanz, Einstellungen (docs/UI-NEUENTWURF.md
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
 * Einordnung nach dem Buchen (MICROCOPY: kurze Bestätigung mit
 * Einordnung): der gezahlte Preis gegen den Median der frischen
 * Set-Preise zu dem Moment — eine berechenbare, ehrliche Größe.
 * `null` ohne genug Messwerte (keine Einordnung, kein Lob).
 */
export function fillPositionNote(
  pricePaid: number,
  freshPrices: number[],
): string | null {
  const values = freshPrices.filter((value) => Number.isFinite(value));
  if (values.length < 2) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const median =
    sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const deltaCt = (pricePaid - median) * 100;
  if (Math.abs(deltaCt) < 0.05)
    return "Gleichauf mit dem Median deines Sets.";
  return deltaCt < 0
    ? `${centPerLiter(Math.abs(deltaCt))} unter dem Median deines Sets (heute).`
    : `${centPerLiter(Math.abs(deltaCt))} über dem Median deines Sets (heute) — der nächste Beleg ist der bessere Vergleich.`;
}

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
        className="mt-4 flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-slate-900/60 p-1"
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
      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
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
          <div className="grid gap-3 sm:grid-cols-3">
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
                onChange={(e) => setQuickLitersStr(commaToDot(e.target.value))}
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
                onChange={(e) => setQuickPriceStr(commaToDot(e.target.value))}
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
            className="mt-4 w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-8"
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
              title="Stornierte Belege zählen nicht in die Bilanz; der CSV-Export enthält sie immer."
              className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200"
            >
              {showVoidedFills
                ? "Stornierte ausblenden"
                : `Stornierte anzeigen (${voidedCount})`}
            </button>
          )}
        </div>
        <p className="mb-3 px-5 text-[11px] text-slate-500">
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
          <div className="overflow-x-auto">
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
                {visibleFills.map((fill) => (
                  <tr key={fill.id} className={fill.voided ? "opacity-60" : undefined}>
                    <td className="px-5 py-2 pr-3 font-mono text-slate-300">
                      {timeLabel(fill.tanked_at)}
                    </td>
                    <td className="px-3 py-2 text-slate-200">
                      {fill.station_name || fill.station_id}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">
                      {euro(fill.liters, 1)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">
                      {euro(fill.price_paid, 3)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono ${
                        (fill.saved_vs_always_now_eur ?? 0) >= 0
                          ? "text-emerald-300"
                          : "text-rose-300"
                      }`}
                    >
                      {fill.saved_vs_always_now_eur != null
                        ? `${euro(Math.abs(fill.saved_vs_always_now_eur))} € ${
                            fill.saved_vs_always_now_eur >= 0
                              ? "günstiger"
                              : "teurer"
                          }`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {fill.voided ? (
                        <span className="font-semibold text-rose-300">storniert</span>
                      ) : (
                        <span className="text-slate-400">gebucht</span>
                      )}
                    </td>
                    <td className="px-5 py-2 text-right">
                      {!fill.voided && (
                        <button
                          type="button"
                          onClick={() => onVoidFill(fill.id)}
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
            {mostUsed && (
              <p className="mt-3 px-5 pb-1 text-[11px] leading-relaxed text-slate-500">
                Maßstab: der Median deines Sets (Standard) · deine
                meistgenutzte Station: {mostUsed.name} (
                {countLabel(mostUsed.count)} Belege).
              </p>
            )}
          </div>
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
          className="flex rounded-lg border border-slate-800 bg-slate-950 p-1 text-[11px] font-bold"
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
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {period === "month"
              ? monthBalanceLabel(latest.key)
              : yearBalanceLabel(latest.key)}
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                Getankt
              </p>
              <p className="mt-1 text-xl font-bold text-white tabular-nums">
                {euro(latest.total_eur)} €
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                {latest.fills} Beleg{latest.fills === 1 ? "" : "e"} ·{" "}
                {latest.avg_eur_per_liter != null
                  ? `Ø ${euro(latest.avg_eur_per_liter, 3)} €/L`
                  : "Ø —"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                Gegenüber „immer sofort getankt“
              </p>
              <p
                className={`mt-1 text-xl font-bold tabular-nums ${
                  latest.saved_eur >= 0 ? "text-emerald-300" : "text-rose-300"
                }`}
              >
                {latest.saved_eur >= 0 ? "+" : "−"}
                {euro(Math.abs(latest.saved_eur))} €
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                Maßstab: die Liter zu dem Preis, der an deiner Station stand,
                als du getankt hast (Server).
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                Gegenüber Stadt-Median
              </p>
              <p className="mt-1 text-xl font-bold text-slate-500">—</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                Noch nicht messbar: der Median deiner Stadt fehlt in den
                heutigen Daten — die Zahl kommt, wenn die Engine ihn liefert.
              </p>
            </div>
          </div>

          {bars.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
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
                    <span className="text-[8px] font-semibold text-slate-600">
                      {row.key.slice(5)}
                    </span>
                  </div>
                ))}
              </div>
              {data?.overall && (
                <p className="mt-2 text-[11px] text-slate-500">
                  Gesamt: {euro(data.overall.total_eur)} € ·{" "}
                  {data.overall.fills} Belege ·{" "}
                  {euro(Math.abs(data.overall.saved_eur))} €{" "}
                  {data.overall.saved_eur >= 0 ? "günstiger" : "teurer"}{" "}
                  gegenüber „immer sofort getankt“
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
