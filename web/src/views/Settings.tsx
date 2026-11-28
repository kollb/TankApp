// Einstellungen — Fahrzeug, Belege, Bilanz und App-Kontext an einem Ort
// (docs/produkt/UI.md, Bereiche). Der frühere Bereich „Ich“ ist vollständig
// hier aufgegangen (UI-Konsolidierung 0.78.0): **eine** Ansicht, **eine**
// Segment-Steuerung, kein zweiter Navigationsbaum und kein eigener Poll für
// eine parallele Ansicht.
//
// Aufbau:
//   ① Fahrzeug (VehiclePanel) — Tankmenge, Verbrauch, Tankstand, Profile
//   ② Belege und Bilanz — eingeklappt (`<details>`): das Formular und der
//      Verlauf entstehen erst auf Wunsch; die Polls laufen nur, solange der
//      Bereich offen ist (state/overview.tsx: `settingsWantsFills`).
//   ③ App (SettingsPanel) — Kontext, read-only Schwellen, Darstellung, Daten
//
// Die Entscheidungsschwellen bleiben read-only aus /api/v1/stats/summary —
// die Engine rechnet, die GUI zeigt und ändert nichts. Der Zustand bleibt in
// Dashboard.tsx / state/overview.tsx und wandert per typisierten Props herein
// (D1-Muster).

import { useState } from "react";
import {
  Car,
  Clock,
  Fuel as FuelIcon,
  Gauge,
  Info,
  MapPin,
  Moon,
  Scale,
  SlidersHorizontal,
  Star,
  Sun,
} from "lucide-react";
import {
  FeedbackBanner,
  type ActionFeedback,
} from "../components/FeedbackBanner";
import { PrecisionSlider } from "../components/PrecisionSlider";
import { TANK_QUICK } from "../now";
import { LoadError } from "../components/LoadError";
import { SkeletonPanel } from "../components/Skeleton";
import { Empty, panel } from "../components/ui";
import {
  APP_THEMES,
  centPerLiter,
  clockLabel,
  commaToDot,
  countLabel,
  deTrimmed,
  euro,
  euroPerHour,
  fillLimitHint,
  kilometersPerHourSpeech,
  monthBalanceLabel,
  PROFILE_BOUNDS,
  THRESHOLD_ROWS,
  thresholdHysteresisLine,
  thresholdSampleLine,
  thresholdStatusLine,
  thresholdValueLabel,
  timeLabel,
  yearBalanceLabel,
  type AppTheme,
  type BalanceRow,
  type DetourMode,
  type Fill,
  type FillDraftCheck,
  type FillsSummary,
  type Fuel,
  type Profiles,
  type ResourceState,
  type StatsSummary,
  type Station,
  type Stations,
} from "../data";
import { fillPriceHint, fillRows } from "../fills";

export interface VehiclePanelProps {
  // Fahrzeug & Tankmenge (Profil-Felder — gelten haushaltsweit, wenn ein
  // Profil aktiv ist, sonst gerätelokal)
  liters: number;
  setLiters: (v: number) => void;
  consumption: number;
  setConsumption: (v: number) => void;
  tankCapacity: number;
  setTankCapacity: (v: number) => void;
  /**
   * Tankstand (A2) — der **eine** Ort der Pflege (UX-NEUENTWURF §6).
   * Die Übersicht zeigt ihn nur an; hier wird er gesetzt.
   */
  tankPercent: number | null;
  setTankPercent: (v: number | null) => void;
  activeProfileName: string | null;
  // Zeit & Fahrtcharakter
  speed: number;
  setSpeed: (v: number) => void;
  timeValue: number;
  setTimeValue: (v: number) => void;
  timeValueUsed: number;
  autoZ: { z: number; isPeak: boolean };
  detourMode: DetourMode;
  setDetourMode: (v: DetourMode) => void;
  // Profile (A1): Umschalter + Verwaltung
  profilesRes: ResourceState<Profiles>;
  activeProfileId: string;
  onActivateProfile: (id: string | null) => void;
  profilesBusy: boolean;
  onOpenProfileManager: () => void;
}

/**
 * Kurzbeschriftung der aktiven Zeitwert-Wahl — dieselbe Logik wie in der
 * Vorschau: 0 = Automatik, sonst der manuelle Wert (MICROCOPY: €/h).
 */
function timeValueShort(
  timeValue: number,
  autoZ: { z: number; isPeak: boolean },
): string {
  // 0.55.0: Der Auto-Zweig nannte `timeValueUsed`. Der ist nur dann der
  // Automatik-Wert, wenn `timeValue` 0 ist — in diesem Zweig also gleich
  // `autoZ.z`. Die direkte Quelle lässt keine Verwechslung offen, wenn der
  // Aufrufer den Zweig einmal anders wählt.
  return timeValue > 0
    ? `${deTrimmed(timeValue)} €/h`
    : `Auto (${deTrimmed(autoZ.z)} €/h · ${autoZ.isPeak ? "Stoßzeit" : "Nebenzeit"})`;
}

/** Einstellungen → Fahrzeug: was ist meins — und auf welchen Geräten gilt es. */
export function VehiclePanel(props: VehiclePanelProps) {
  const {
    activeProfileId,
    activeProfileName,
    autoZ,
    consumption,
    detourMode,
    liters,
    onActivateProfile,
    onOpenProfileManager,
    profilesBusy,
    profilesRes,
    setConsumption,
    setDetourMode,
    setLiters,
    setSpeed,
    setTankCapacity,
    setTankPercent,
    setTimeValue,
    speed,
    tankCapacity,
    tankPercent,
    timeValue,
    timeValueUsed,
  } = props;

  return (
    <div>
      <section
        className={`${panel} mb-4 p-5 sm:p-6`}
        aria-labelledby="ich-vehicle-heading"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3
            id="ich-vehicle-heading"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <Car size={16} className="text-emerald-400" />
            Fahrzeug &amp; Tankmenge
          </h3>
          {activeProfileName ? (
            <span className="font-mono text-xs text-slate-500">
              Profil „{activeProfileName}“ — gilt haushaltsweit
            </span>
          ) : (
            <span className="font-mono text-xs text-slate-500">
              nur dieses Gerät
            </span>
          )}
        </div>
        {/* Profile: [Ich] [Partner] [+ Neu] — Segment-Steuerung, kein Menü. */}
        <div
          className="mb-5 flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Fahrzeug-Profile"
        >
          <button
            onClick={() => onActivateProfile(null)}
            disabled={profilesBusy}
            aria-pressed={activeProfileId === ""}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeProfileId === ""
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-200"
            }`}
          >
            Kein Profil (nur dieses Gerät)
          </button>
          {(profilesRes.data?.profiles ?? []).map((profile) => (
            <button
              key={profile.id}
              onClick={() => onActivateProfile(profile.id)}
              disabled={profilesBusy}
              aria-pressed={activeProfileId === profile.id}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeProfileId === profile.id
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-200"
              }`}
            >
              {profile.name}
            </button>
          ))}
          <button
            onClick={onOpenProfileManager}
            disabled={profilesBusy}
            className="rounded-lg border border-dashed border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:border-slate-600 hover:text-slate-300"
          >
            + Neu / verwalten
          </button>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <PrecisionSlider
            id="liters"
            label="Deine Tankmenge"
            icon={<FuelIcon size={14} />}
            value={liters}
            onChange={setLiters}
            // Die Profil-Grenzen sind die eine Quelle: Der Server prüft
            // dieselben Zahlen (app/profiles.py FIELD_BOUNDS), und ein
            // 100-L-Tank (Transporter/Diesel) muss auch hier darstellbar
            // sein — sonst deckt die Tankmenge den Beleg-Bereich nicht ab
            // (Prüfbericht §5).
            min={PROFILE_BOUNDS.liters.min}
            max={PROFILE_BOUNDS.liters.max}
            step={1}
            unit="L"
            valueSpeech={`${liters} Liter`}
            hint={
              <span className="mt-1 block text-xs text-slate-500">
                Nur zur Berechnung. Kein Beleg, keine erfundene Ersparnis.
              </span>
            }
          />
          <PrecisionSlider
            id="consumption"
            label="Verbrauch"
            value={consumption}
            onChange={setConsumption}
            min={PROFILE_BOUNDS.consumption.min}
            max={PROFILE_BOUNDS.consumption.max}
            step={0.5}
            unit="L/100 km"
            valueSpeech={`${deTrimmed(consumption)} Liter pro 100 Kilometer`}
            hint={
              <span className="mt-1 block text-xs text-slate-500">
                4–15 L/100 km · Kommastellen erlaubt (z. B. 6,3)
              </span>
            }
          />
          <PrecisionSlider
            id="tankCapacity"
            label="Tankgröße"
            icon={<Gauge size={14} />}
            value={tankCapacity}
            onChange={setTankCapacity}
            min={PROFILE_BOUNDS.tankCapacity.min}
            max={PROFILE_BOUNDS.tankCapacity.max}
            step={5}
            unit="L"
            valueText={`${deTrimmed(tankCapacity, 0)} Liter Tank`}
            valueSpeech={`${deTrimmed(tankCapacity, 0)} Liter Tank`}
            hint={
              <span className="mt-1 block text-xs text-slate-500">
                Fahrzeugangabe für Restreichweite und Reserve (5 L).
              </span>
            }
          />
        </div>
        {/* Tankstand — der eine Ort der Pflege (§6). Die Schnellauswahl
            stand bis 0.72.2 in „Jetzt“ und „Woche“ zugleich; hier gilt sie
            für alle Bereiche. */}
        <div
          className="mt-5 border-t border-slate-800 pt-4"
          aria-labelledby="ich-tankstand-heading"
        >
          <h4
            id="ich-tankstand-heading"
            className="flex items-center gap-2 text-xs font-semibold text-slate-200"
          >
            <Gauge size={14} className="text-emerald-400" aria-hidden="true" />
            Aktueller Tankstand
          </h4>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-400">
              Schnellauswahl:
            </span>
            {TANK_QUICK.map((item) => (
              <button
                key={item.percent}
                onClick={() =>
                  setTankPercent(
                    tankPercent === item.percent ? null : item.percent,
                  )
                }
                aria-pressed={tankPercent === item.percent}
                aria-label={`${item.percent} % Füllstand setzen`}
                className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
                  tankPercent === item.percent
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600"
                }`}
              >
                {item.label}
              </button>
            ))}
            {tankPercent !== null && (
              <button
                onClick={() => setTankPercent(null)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300"
              >
                Keine Angabe
              </button>
            )}
          </div>
          {tankPercent !== null && (
            <div className="mt-3 max-w-sm">
              <PrecisionSlider
                id="ich-tankPercent"
                label="Füllstand"
                icon={<Gauge size={14} />}
                value={tankPercent}
                onChange={(value) => setTankPercent(value)}
                min={0}
                max={100}
                step={5}
                unit="%"
                valueText={`${deTrimmed(tankPercent, 0)} % Füllstand`}
                valueSpeech={`${deTrimmed(tankPercent, 0)} Prozent Füllstand`}
              />
            </div>
          )}
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Mit dem Stand prüft die App, ob Warten bis zum günstigen Fenster
            reicht. Ohne Angabe sagt sie dazu nichts.
          </p>
        </div>
      </section>

      <section
        className={`${panel} p-5 sm:p-6`}
        aria-labelledby="ich-vehicle-time-heading"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3
            id="ich-vehicle-time-heading"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <Clock size={16} className="text-emerald-400" />
            Zeit &amp; Fahrtcharakter
          </h3>
          <span className="font-mono text-xs text-slate-500">
            K = d · (c/100) · p + (d/v) · z
          </span>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <PrecisionSlider
            id="timeValue"
            label="Zeitwert"
            icon={<Clock size={14} />}
            value={timeValue}
            onChange={setTimeValue}
            min={PROFILE_BOUNDS.timeValue.min}
            max={PROFILE_BOUNDS.timeValue.max}
            step={0.5}
            unit="€/h"
            valueText={timeValueShort(timeValue, autoZ)}
            valueSpeech={
              timeValue > 0
                ? euroPerHour(timeValue)
                : `Automatik ${euroPerHour(autoZ.z)}`
            }
            hint={
              <span
                className="mt-1 block text-xs text-slate-500"
                title="Fachwort: Peak"
              >
                {/* 0.55.0: Der Hinweis beschrieb die Automatik immer im
                    Präsens („gerade Nebenzeit“) — auch bei gesetztem Zeitwert,
                    wo sie gar nicht greift. Daneben stand dann „Auto (12 €/h)“
                    gegen „0 = Auto: 10 €/h“: zwei Zahlen, ein Zustand. Und die
                    Regel nannte 16/10 €/h fest, obwohl `autoTimeValue()` die
                    Quelle ist. Jetzt sagt der Satz, was tatsächlich gilt. */}
                {timeValue > 0 ? (
                  <>
                    Fester Wert. Mit 0 rechnet die App nach Uhrzeit — gerade
                    wären das {deTrimmed(autoZ.z, 1)} €/h (
                    {autoZ.isPeak ? "Stoßzeit" : "Nebenzeit"}).
                  </>
                ) : (
                  <>
                    Automatik nach Uhrzeit: gerade {deTrimmed(autoZ.z, 1)} €/h (
                    {autoZ.isPeak ? "Stoßzeit" : "Nebenzeit"}).
                  </>
                )}
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
              min={PROFILE_BOUNDS.speed.min}
              max={PROFILE_BOUNDS.speed.max}
              step={5}
              value={speed}
              aria-valuetext={kilometersPerHourSpeech(speed)}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="mt-3 w-full"
            />
            <span className="mt-1 block text-xs text-slate-500">
              25–80 km/h · Tempo der Umwegfahrt, nicht der Höchstgeschwindigkeit
            </span>
          </label>
          <label htmlFor="detourMode" className="text-xs text-slate-400">
            Fahrtcharakter
            <select
              id="detourMode"
              aria-label="Fahrtcharakter"
              value={detourMode}
              onChange={(e) => setDetourMode(e.target.value as DetourMode)}
              className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-200"
            >
              <option value="onroute">Auf dem Weg (nur Mehrweg)</option>
              <option value="dedicated">Extrafahrt (Hin & Rück)</option>
            </select>
            {detourMode === "dedicated" && (
              <span className="mt-1 block text-xs leading-snug text-rose-300">
                Bei {deTrimmed(timeValue > 0 ? timeValue : timeValueUsed, 1)}{" "}
                €/h Zeitwert ist eine Extrafahrt von zuhause praktisch nie
                wirtschaftlich — sie lohnt nur, wenn die Station ohnehin auf dem
                Weg liegt.
              </span>
            )}
          </label>
        </div>
        {!activeProfileName && (
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Kein Fahrzeug-Profil aktiv — diese Werte gelten nur auf diesem
            Gerät. Mit aktivem Profil gelten sie auf allen Geräten des
            Haushalts.
          </p>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Belege und Bilanz — eingeklappt am Wirkungsort.
 *
 * Bis 0.77.0 war das der eigene Bereich „Ich“ mit drei Unter-Tabs (Belege,
 * Bilanz, App). Die Ansicht ist in „Einstellungen“ aufgegangen: Fahrzeug,
 * Belege/Bilanz und App-Kontext stehen in **einer** Ansicht, die Buchhaltung
 * liegt hinter einem `<details>` statt hinter einem Tab. Der Beleg-Poll läuft
 * nur, solange das Blatt offen ist (`onFillsOpenChange` → Root).
 *
 * Bilanz-Ehrlichkeit: Der Server liefert einen Vergleichsmaßstab — „immer
 * sofort getankt“. Der zweite Maßstab des Konzepts (Stadt-Median) ist mit
 * den heutigen Daten nicht belegbar und steht deshalb ehrlich als „noch
 * nicht messbar“ da, statt mit einer Zahl verkleidet.
 * ------------------------------------------------------------------------- */

/** Zustand, der nur die Buchhaltung betrifft (Belege, Bilanz, Rückmeldung). */
export interface FillsPanelProps {
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
  /** Nur für Tests; sonst Date.now(). */
  now?: number;
}

export interface BalancePanelProps {
  fillsSummary: ResourceState<FillsSummary>;
  onRetry: () => void;
}

/**
 * Zweiter Maßstab (Konzept-Entscheidung 4: „Median als Standard,
 * meistgenutzte Station darunter“): die Station mit den meisten
 * (nicht stornierten) Belegen. Erst ab zwei Belegen an derselben
 * Station ist „meistgenutzt“ mehr als eine Einzelbeobachtung — sonst
 * steht nichts (keine Erfindung).
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

/** Belege: Schnellerfassung oben, Verlauf mit Storno darunter. */
function FillsSection(props: FillsPanelProps) {
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
          className="flex items-center gap-2 text-sm font-semibold text-slate-100"
        >
          <FuelIcon size={16} className="text-emerald-400" />
          Tanken erfassen
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Station, Liter, Preis — in unter 15 Sekunden steht der Beleg in deiner
          Bilanz.
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
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-emerald-500"
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
                title={fillLimitHint("liters") + " — wie auf dem Kassenbon"}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-emerald-500"
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
                title={fillLimitHint("price") + " — wie an der Säule"}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-emerald-500"
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
            className="m3-btn-now mt-4 w-full rounded-full px-4 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-8"
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
                    {row.timing && (
                      <p className="mt-0.5 text-slate-400">{row.timing}</p>
                    )}
                    {row.elsewhereNet && (
                      <p className="mt-0.5 font-mono text-sky-200">
                        {row.elsewhereNet}
                      </p>
                    )}
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
                    <tr
                      key={row.id}
                      className={row.voided ? "opacity-60" : undefined}
                    >
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
                            {row.timing && (
                              <span className="block text-xs text-slate-500">
                                {row.timing}
                              </span>
                            )}
                            {row.elsewhereNet && (
                              <span className="block font-mono text-xs text-sky-300">
                                {row.elsewhereNet}
                              </span>
                            )}
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
                Maßstab: der Median deines Sets (Standard) · deine meistgenutzte
                Station: {mostUsed.name} ({countLabel(mostUsed.count)} Belege).
              </p>
            )}
          </>
        ) : (
          <div className="px-5 pb-5">
            <Empty>
              Noch keine Belege — oben erfassen, dann erscheint der Beleg hier
              und in der Bilanz.
            </Empty>
          </div>
        )}
      </section>
    </div>
  );
}

/** Bilanz: Monat/Jahr, zwei ehrliche Maßstäbe, Verlauf. */
function BalanceSection(props: BalancePanelProps) {
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
      className="mt-4 px-4 pb-2 sm:px-5"
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
          Noch keine Belege — die Bilanz füllt sich mit jedem erfassten Beleg.
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
              <p className="mt-1 text-xl font-bold text-slate-100 tabular-nums">
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
                    {(latest.saved_net_eur ?? latest.saved_eur) >= 0
                      ? "+"
                      : "−"}
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
                    title={monthBalanceLabel(row.key) + ": " + euro(row.total_eur) + " €"}
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

export interface SettingsPanelProps {
  // Kontext (Kopfzeile und Einstellungen teilen sich dieselben Werte)
  data: Stations | null;
  activeCity: string;
  setCity: (v: string) => void;
  fuel: Fuel;
  setFuel: (v: Fuel) => void;
  // Schwellen (read-only)
  statsSummaryRes: ResourceState<StatsSummary>;
  refreshNow: () => void;
  // Darstellung
  theme: AppTheme;
  setTheme: (t: AppTheme) => void;
  // Daten (am Wirkungsort: angepinnte Stationen, Beleg-Export)
  pinnedStations: Array<{ station: Station }>;
  togglePin: (stationId: string) => void;
  /** /health → version (Über). */
  version: string | null;
  /** In das Glossar springen (Hilfe). */
  onOpenGlossary: () => void;
}

/**
 * Einstellungen → App: Darstellung, Verhalten, Daten & Privatsphäre, Über.
 * Die Fahrzeug-Felder wohnen unter „Fahrzeug“ (am Wirkungsort), die
 * Schwellen bleiben read-only — sie legt die Engine fest.
 */
export function SettingsPanel(props: SettingsPanelProps) {
  const {
    activeCity,
    data,
    fuel,
    onOpenGlossary,
    pinnedStations,
    refreshNow,
    setCity,
    setFuel,
    setTheme,
    statsSummaryRes,
    theme,
    togglePin,
    version,
  } = props;

  const summary = statsSummaryRes.data;
  const thresholds = summary?.thresholds ?? null;
  const tuning = summary?.threshold_tuning ?? null;
  const sampleLine = thresholdSampleLine(tuning);
  // H3: Das Rauschband erklärt, warum ein Nachzug ausbleibt — ohne diesen
  // Satz wirkt „keine Abweichung“ wie ein Stillstand.
  const hysteresisLine = thresholdHysteresisLine(tuning);
  const tuningReasons = tuning?.reasons ?? [];

  return (
    <div>
      <section
        className={`${panel} mb-4 p-5 sm:p-6`}
        aria-labelledby="ich-settings-context-heading"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3
            id="ich-settings-context-heading"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <MapPin size={16} className="text-emerald-400" />
            Kontext — wo und was
          </h3>
          <span className="font-mono text-xs text-slate-500">
            gilt für alle Ansichten
          </span>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <label htmlFor="settings-city" className="text-xs text-slate-400">
            Stadt
            <select
              id="settings-city"
              aria-label="Stadt (Einstellungen)"
              value={activeCity}
              onChange={(e) => setCity(e.target.value)}
              disabled={!data?.cities.length}
              className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-200"
            >
              {data?.cities.length ? (
                data.cities.map((label) => <option key={label}>{label}</option>)
              ) : (
                <option value="">Keine Stadt eingerichtet</option>
              )}
            </select>
          </label>
          <div
            role="group"
            aria-label="Kraftstoff (Einstellungen)"
            className="flex flex-wrap items-center gap-3 text-xs text-slate-400"
          >
            <span>
              Kraftstoff
              <div
                role="group"
                aria-label="Kraftstoff wählen"
                className="mt-3 flex rounded-full border border-outline-variant bg-sc-lowest p-1 text-xs font-bold"
              >
                {(["e10", "e5", "diesel"] as Fuel[]).map((value) => (
                  <button
                    key={value}
                    aria-pressed={fuel === value}
                    onClick={() => setFuel(value)}
                    className={`rounded-full px-3 py-1.5 transition-colors ${
                      fuel === value
                        ? "bg-secondary-container text-on-secondary-container"
                        : "text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    {value === "diesel" ? "Diesel" : value.toUpperCase()}
                  </button>
                ))}
              </div>
            </span>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Diesel gilt nur für die Diesel-Preise, E5 nur gegen E5 — die
          Schnellwahl in der Kopfzeile bedient dieselben Werte, es gibt keine
          zweite Kopie.
        </p>
      </section>

      <section
        className={`${panel} mb-4 p-5 sm:p-6`}
        aria-labelledby="ich-settings-thresholds-heading"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3
            id="ich-settings-thresholds-heading"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <Scale size={16} className="text-emerald-400" />
            Entscheidungsschwellen (aktiv)
          </h3>
          <span
            className="text-xs text-slate-500"
            title="Quelle: /api/v1/stats/summary"
          >
            schreibgeschützt
          </span>
        </div>

        {statsSummaryRes.error ? (
          <LoadError
            errorCode={summary?.error_code || statsSummaryRes.errorCode}
            fallback="Die Schwellen der Engine konnten nicht geladen werden."
            onRetry={refreshNow}
            retryLabel="Schwellen neu laden"
          />
        ) : statsSummaryRes.pending && !summary ? (
          <SkeletonPanel
            lines={5}
            title={false}
            label="Schwellen werden geladen"
          />
        ) : thresholds ? (
          <>
            <p className="mb-3 text-xs leading-relaxed text-slate-400">
              {thresholdStatusLine(tuning)}{" "}
              {summary?.generated_at
                ? `Stand ${clockLabel(summary.generated_at)}.`
                : ""}
            </p>
            {/* Kein `min-w` und weniger Innenabstand auf schmalen Viewports: Die
                Tabelle ist nur drei Spalten breit und bricht den Bedingungstext um —
                die 26-rem-Mindestbreite erzwang auf dem Handy einen Querlauf für
                eine Tabelle, die auch ohne ihn lesbar ist. */}
            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">
                  Aktive Entscheidungsschwellen der Engine (schreibgeschützt)
                </caption>
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                    <th
                      scope="col"
                      className="px-2 py-2.5 font-semibold sm:px-4"
                    >
                      Aktion
                    </th>
                    <th
                      scope="col"
                      className="px-2 py-2.5 font-semibold sm:px-4"
                    >
                      Bedingung
                    </th>
                    <th
                      scope="col"
                      className="px-2 py-2.5 text-right font-semibold sm:px-4"
                    >
                      Wert
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {THRESHOLD_ROWS.map((row) => (
                    <tr key={row.key}>
                      <th
                        scope="row"
                        className="px-2 py-2.5 font-semibold text-slate-200 sm:px-4"
                      >
                        {row.action}
                      </th>
                      <td className="px-2 py-2.5 text-slate-400 sm:px-4">
                        {row.condition}
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono text-emerald-400 sm:px-4">
                        {thresholdValueLabel(row.kind, thresholds[row.key])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sampleLine && (
              <p className="mt-3 text-xs text-slate-500">{sampleLine}</p>
            )}
            {hysteresisLine && (
              <p className="mt-1 text-xs text-slate-500">{hysteresisLine}</p>
            )}
            {tuningReasons.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {tuning?.changed
                    ? "Begründung des Nachzugs (Engine)"
                    : "Warum nicht nachgezogen wird (Engine)"}
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-slate-400">
                  {tuningReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              Die Schwellen legt die Engine fest (Startwerte, Nachzug mit M7).
              Die App zeigt sie nur an und rechnet damit — ändern kann sie sie
              nicht.
            </p>
          </>
        ) : (
          <Empty>
            Noch kein Engine-Lauf ausgewertet — die Schwellen-Tabelle erscheint
            mit dem nächsten Lauf der Engine.
          </Empty>
        )}
      </section>

      <section
        className={`${panel} mb-4 p-5 sm:p-6`}
        aria-labelledby="ich-settings-theme-heading"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3
            id="ich-settings-theme-heading"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <SlidersHorizontal size={16} className="text-emerald-400" />
            Darstellung
          </h3>
          <span className="font-mono text-xs text-slate-500">gerätelokal</span>
        </div>
        <div
          role="group"
          aria-label="Darstellung (dunkel oder hell)"
          className="flex flex-wrap gap-2"
        >
          {APP_THEMES.map((value) => (
            <button
              key={value}
              aria-pressed={theme === value}
              onClick={() => setTheme(value)}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-bold transition-colors ${
                theme === value
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-100"
              }`}
            >
              {value === "dark" ? (
                <Moon size={14} aria-hidden="true" />
              ) : (
                <Sun size={14} aria-hidden="true" />
              )}
              {value === "dark" ? "Dunkel" : "Hell (Standard)"}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Hell (Material You) ist die Design-Basis und der Default — das Konzept
          der neuen GUI. Dunkel ist eine dunkle Variante derselben Skala:
          dieselben Klassen, andere Token-Werte. Die Wahl gilt nur auf diesem
          Gerät.
        </p>
      </section>

      <section
        className={`${panel} mb-4 p-5 sm:p-6`}
        aria-labelledby="ich-settings-data-heading"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3
            id="ich-settings-data-heading"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <Info size={16} className="text-emerald-400" />
            Daten
          </h3>
          <span className="font-mono text-xs text-slate-500">
            LAN-only · nichts verlässt die Anlage
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
            <p className="text-xs font-semibold text-slate-200">
              Belege exportieren (CSV)
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Alle Belege inklusive Storno — für die Steuer oder den eigenen
              Notizzettel.
            </p>
            <a
              href="/api/v1/fills.csv"
              title="Quelle: /api/v1/fills.csv"
              className="tap-44 mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-slate-600"
            >
              Belege als Datei laden
            </a>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
            <p className="text-xs font-semibold text-slate-200">
              Angepinnte Stationen
            </p>
            {pinnedStations.length === 0 ? (
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Keine Stamm-Stationen — der Stern in „Stationen“ merkt sich
                deine Säulen (geräte-lokal, ohne Account).
              </p>
            ) : (
              <ul className="mt-2 grid grid-cols-1 gap-1.5">
                {pinnedStations.map(({ station }) => (
                  <li
                    key={station.station_id}
                    className="flex items-center justify-between gap-2 text-xs text-slate-300"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Star
                        size={11}
                        className="shrink-0 text-amber-300"
                        aria-hidden="true"
                      />
                      <span className="truncate">{station.name}</span>
                    </span>
                    <button
                      onClick={() => togglePin(station.station_id)}
                      className="shrink-0 text-slate-500 underline underline-offset-2 hover:text-slate-300"
                    >
                      lösen
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section
        className={`${panel} p-5 sm:p-6`}
        aria-labelledby="ich-settings-about-heading"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3
            id="ich-settings-about-heading"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <Info size={16} className="text-emerald-400" />
            Über
          </h3>
        </div>
        <dl className="grid grid-cols-1 gap-3 text-xs text-slate-400 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate-500">
              Version
            </dt>
            <dd className="mt-0.5 font-mono font-semibold text-slate-200">
              {version ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate-500">
              Datenquelle
            </dt>
            <dd className="mt-0.5 leading-relaxed">
              Markttransparenzstelle für Kraftstoffe (MTS-K) über
              tankerkoenig.de · Lizenz CC BY 4.0
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate-500">
              Hilfe
            </dt>
            <dd className="mt-0.5">
              <button
                onClick={onOpenGlossary}
                className="font-semibold text-sky-300 underline underline-offset-4 hover:text-sky-200"
              >
                Glossar
              </button>
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

export interface SettingsViewProps {
  /** Fahrzeug-Schnitt (VehiclePanel). */
  vehicle: VehiclePanelProps;
  /** App-Kontext (SettingsPanel). */
  settings: SettingsPanelProps;
  /** Belege / Bilanz — nur gelesen, wenn der Bereich offen ist. */
  fills: FillsPanelProps;
  balance: BalancePanelProps;
  /** Ob „Belege und Bilanz“ offen ist — der Zustand liegt in der Root, weil
   *  erst das offene Blatt die Polls startet und zwei Einstiege es öffnen. */
  fillsOpen: boolean;
  onFillsOpenChange: (open: boolean) => void;
  /** Einstieg in die Segment-Steuerung; ohne Angabe „Fahrzeug“. */
  initialSection?: "vehicle" | "app";
  /** Nur für Tests; sonst Date.now(). */
  now?: number;
}

/**
 * Einstellungen: Fahrzeug, Belege/Bilanz (eingeklappt) und App-Kontext.
 * Eine Segment-Steuerung für die beiden dauerhaften Teile, ein `<details>`
 * für die Buchhaltung — kein eigener Bereich „Ich“ mehr.
 */
export function SettingsView(props: SettingsViewProps) {
  const [section, setSection] = useState<"vehicle" | "app">(
    props.initialSection ?? "vehicle",
  );
  const fillsOpen = props.fillsOpen;

  return (
    <section aria-labelledby="settings-title">
      <h1
        id="settings-title"
        className="text-2xl font-bold tracking-tight text-slate-100"
      >
        Einstellungen
      </h1>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">
        Fahrzeug, Belege und App-Kontext an einem Ort.
      </p>

      {/* Segment-Steuerung: zwei dauerhafte Teile, die Buchhaltung darunter. */}
      <div
        role="tablist"
        aria-label="Einstellungen — Bereiche"
        className="mt-4 flex flex-wrap gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1"
      >
        {[
          { id: "vehicle" as const, label: "Fahrzeug" },
          { id: "app" as const, label: "App" },
        ].map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={section === item.id}
            onClick={() => setSection(item.id)}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
              section === item.id
                ? "bg-secondary-container text-on-secondary-container"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {section === "vehicle" && (
          <div>
            <VehiclePanel {...props.vehicle} />
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              Was es bringt, rechnet die Übersicht in Euro — mit dieser Menge:
              mehr Liter, mehr Betrag. Kraftstoff und Stadt liegen unter „App“ —
              sie gelten für alle Ansichten, nicht nur für das Fahrzeug.
              {props.settings.version
                ? ` · TankApp ${props.settings.version}`
                : ""}
            </p>
          </div>
        )}
        {section === "app" && <SettingsPanel {...props.settings} />}
      </div>

      {/* ② Buchhaltung — ein Blatt, kein Tab, keine Polls im Hintergrund. */}
      <details
        className={`${panel} mt-4 p-4`}
        open={fillsOpen}
        onToggle={(event) => props.onFillsOpenChange(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-sm font-semibold text-slate-200">
          Belege und Bilanz
        </summary>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          Tankungen erfassen und die Monatsbilanz nachsehen. Der Verlauf lädt
          erst, wenn dieser Abschnitt offen ist.
        </p>
        {fillsOpen && (
          <div className="mt-3">
            <FillsSection {...props.fills} />
            <BalanceSection {...props.balance} />
          </div>
        )}
      </details>
    </section>
  );
}
