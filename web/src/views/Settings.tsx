// C4 (weitergezogen, Phase 2): „Einstellungen verschwindet als eigener Tab“
// (UI-NEUENTWURF §4.2) — Einstellungen wohnen dort, wo sie wirken.
//
// Diese Datei liefert die zwei Panels, die der Bereich „Ich“ zusammensetzt:
//   * `VehiclePanel`   → Ich → Fahrzeug (Profil-Felder: Tank, Verbrauch,
//                        Zeitwert, Tempo, Fahrtcharakter)
//   * `SettingsPanel`  → Ich → Einstellungen (Kontext, Schwellen
//                        read-only, Darstellung, Daten, Über)
//
// Die Entscheidungsschwellen bleiben read-only aus /api/v1/stats/summary —
// die Engine rechnet, die GUI zeigt und ändert nichts. Der Zustand bleibt
// in Dashboard.tsx und wandert per typisierten Props herein (D1-Muster).

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
import { PrecisionSlider } from "../components/PrecisionSlider";
import { LoadError } from "../components/LoadError";
import { SkeletonPanel } from "../components/Skeleton";
import { Empty, panel } from "../components/ui";
import {
  APP_THEMES,
  clockLabel,
  deTrimmed,
  THRESHOLD_ROWS,
  thresholdHysteresisLine,
  thresholdSampleLine,
  thresholdStatusLine,
  thresholdValueLabel,
  type AppTheme,
  type DetourMode,
  type Fuel,
  type Profiles,
  type ResourceState,
  type StatsSummary,
  type Station,
  type Stations,
} from "../data";

export interface VehiclePanelProps {
  // Fahrzeug & Füllung (Profil-Felder — gelten haushaltsweit, wenn ein
  // Profil aktiv ist, sonst gerätelokal)
  liters: number;
  setLiters: (v: number) => void;
  consumption: number;
  setConsumption: (v: number) => void;
  tankCapacity: number;
  setTankCapacity: (v: number) => void;
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
  timeValueUsed: number,
  autoZ: { z: number; isPeak: boolean },
): string {
  return timeValue > 0
    ? `${deTrimmed(timeValue)} €/h`
    : `Auto (${deTrimmed(timeValueUsed)} €/h ${autoZ.isPeak ? "Peak" : "offpeak"})`;
}

/** Ich → Fahrzeug: was ist meins — und auf welchen Geräten gilt es. */
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
    setTimeValue,
    speed,
    tankCapacity,
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
            Fahrzeug &amp; Füllung
          </h3>
          {activeProfileName ? (
            <span className="font-mono text-[11px] text-slate-500">
              Profil „{activeProfileName}“ — gilt haushaltsweit
            </span>
          ) : (
            <span className="font-mono text-[11px] text-slate-500">
              nur dieses Gerät
            </span>
          )}
        </div>
        {/* Profile: [Ich] [Partner] [+ Neu] — Segment-Steuerung, kein Menü. */}
        <div className="mb-5 flex flex-wrap items-center gap-2" role="group" aria-label="Fahrzeug-Profile">
          <button
            onClick={() => onActivateProfile(null)}
            disabled={profilesBusy}
            aria-pressed={activeProfileId === ""}
            className={`rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
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
              className={`rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
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
            className="rounded-lg border border-dashed border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-500 hover:border-slate-600 hover:text-slate-300"
          >
            + Neu / verwalten
          </button>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <PrecisionSlider
            id="liters"
            label="Deine Tankmenge"
            icon={<FuelIcon size={14} />}
            value={liters}
            onChange={setLiters}
            min={10}
            max={80}
            step={1}
            unit="L"
            valueSpeech={`${liters} Liter`}
            hint={
              <span className="mt-1 block text-[10px] text-slate-500">
                Nur zur Berechnung. Keine Buchung, keine erfundene
                Ersparnis.
              </span>
            }
          />
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
          <PrecisionSlider
            id="tankCapacity"
            label="Tankgröße"
            icon={<Gauge size={14} />}
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
                Fahrzeugangabe für Restreichweite und Reserve (5 l).
              </span>
            }
          />
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
          <span className="font-mono text-[11px] text-slate-500">
            K = d · (c/100) · p + (d/v) · z
          </span>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <PrecisionSlider
            id="timeValue"
            label="Zeitwert"
            icon={<Clock size={14} />}
            value={timeValue}
            onChange={setTimeValue}
            min={0}
            max={30}
            step={0.5}
            unit="€/h"
            valueText={timeValueShort(timeValue, timeValueUsed, autoZ)}
            valueSpeech={
              timeValue > 0
                ? `${deTrimmed(timeValue)} Euro pro Stunde`
                : `Automatik ${deTrimmed(timeValueUsed)} Euro pro Stunde`
            }
            hint={
              <span className="mt-1 block text-[10px] text-slate-500">
                0 = Auto: 16 €/h im Peak (16:30–20:00), sonst 10 €/h.
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
            <span className="mt-1 block text-[10px] text-slate-500">
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
              <span className="mt-1 block text-[10px] leading-snug text-rose-300">
                Bei 12 €/h Zeitwert ist eine Extrafahrt von zuhause praktisch
                nie wirtschaftlich — fahr nur hin, wenn du ohnehin an der
                Station vorbeikommst.
              </span>
            )}
          </label>
        </div>
        {!activeProfileName && (
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            Kein Fahrzeug-Profil aktiv — diese Werte gelten nur auf diesem
            Gerät. Mit aktivem Profil gelten sie auf allen Geräten des
            Haushalts.
          </p>
        )}
      </section>
    </div>
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
  pinnedStations: Array<{ station: Station; }>;
  togglePin: (stationId: string) => void;
  /** /health → version (Über). */
  version: string | null;
  /** In das Glossar springen (Hilfe). */
  onOpenGlossary: () => void;
}

/**
 * Ich → Einstellungen: Darstellung, Verhalten, Daten & Privatsphäre, Über.
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
          <span className="font-mono text-[11px] text-slate-500">
            gilt für alle Ansichten
          </span>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
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
                data.cities.map((label) => (
                  <option key={label}>{label}</option>
                ))
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
                className="mt-3 flex rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs font-bold"
              >
                {(["e10", "e5", "diesel"] as Fuel[]).map((value) => (
                  <button
                    key={value}
                    aria-pressed={fuel === value}
                    onClick={() => setFuel(value)}
                    className={`rounded-lg px-3 py-1.5 transition-colors ${
                      fuel === value
                        ? "bg-emerald-500 text-slate-950"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {value === "diesel" ? "Diesel" : value.toUpperCase()}
                  </button>
                ))}
              </div>
            </span>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
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
          <span className="font-mono text-[11px] text-slate-500">
            read-only · Quelle: /api/v1/stats/summary
          </span>
        </div>

        {statsSummaryRes.error ? (
          <LoadError
            errorCode={summary?.error_code || statsSummaryRes.errorCode}
            fallback="Die Statistik mit den aktiven Schwellen konnte nicht geladen werden."
            onRetry={refreshNow}
            retryLabel="Statistik neu laden"
          />
        ) : statsSummaryRes.pending && !summary ? (
          <SkeletonPanel lines={5} title={false} label="Schwellen werden geladen" />
        ) : thresholds ? (
          <>
            <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
              {thresholdStatusLine(tuning)}{" "}
              {summary?.generated_at
                ? `Stand ${clockLabel(summary.generated_at)}.`
                : ""}
            </p>
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full min-w-[26rem] text-left text-xs">
                <caption className="sr-only">
                  Aktive Entscheidungsschwellen der Engine (read-only)
                </caption>
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Aktion
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Bedingung
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                      Wert
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {THRESHOLD_ROWS.map((row) => (
                    <tr key={row.key}>
                      <th
                        scope="row"
                        className="px-4 py-2.5 font-semibold text-slate-200"
                      >
                        {row.action}
                      </th>
                      <td className="px-4 py-2.5 text-slate-400">
                        {row.condition}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-emerald-400">
                        {thresholdValueLabel(row.kind, thresholds[row.key])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sampleLine && (
              <p className="mt-3 text-[10px] text-slate-500">{sampleLine}</p>
            )}
            {hysteresisLine && (
              <p className="mt-1 text-[10px] text-slate-500">{hysteresisLine}</p>
            )}
            {tuningReasons.length > 0 && (
              <div className="mt-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {tuning?.changed
                    ? "Begründung des Nachzugs (Engine)"
                    : "Warum nicht nachgezogen wird (Engine)"}
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-slate-400">
                  {tuningReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
              Die Schwellen legt die Engine fest (Startwerte, Nachzug mit
              M7). Die App zeigt sie nur an und rechnet damit — ändern kann
              sie sie nicht.
            </p>
          </>
        ) : (
          <Empty>
            Noch keine Statistik geladen — die Schwellen-Tabelle erscheint
            mit dem nächsten Statistik-Lauf der Engine.
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
          <span className="font-mono text-[11px] text-slate-500">
            gerätelokal
          </span>
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
              className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold transition-colors ${
                theme === value
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-slate-700 bg-slate-950 text-slate-400 hover:text-white"
              }`}
            >
              {value === "dark" ? (
                <Moon size={14} aria-hidden="true" />
              ) : (
                <Sun size={14} aria-hidden="true" />
              )}
              {value === "dark" ? "Dunkles Slate (Standard)" : "Hell (Slate)"}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Dunkles Slate ist die Design-Basis und der Default. Hell ist eine
          helle Variante derselben Skala — dieselbe Farbwelt wie die
          Fallback-GUI am RP2. Die Wahl gilt nur auf diesem Gerät.
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
          <span className="font-mono text-[11px] text-slate-500">
            LAN-only · nichts verlässt die Anlage
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
            <p className="text-xs font-semibold text-slate-200">
              Tankbelege exportieren (CSV)
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Alle Belege inklusive Storno — für die Steuer oder den
              eigenen Notizzettel.
            </p>
            <a
              href="/api/v1/fills.csv"
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-[11px] font-semibold text-slate-200 hover:border-slate-600"
            >
              /api/v1/fills.csv laden
            </a>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
            <p className="text-xs font-semibold text-slate-200">
              Angepinnte Stationen
            </p>
            {pinnedStations.length === 0 ? (
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                Keine Stamm-Stationen — der Stern in „Stationen“ merkt sich
                deine Säulen (geräte-lokal, ohne Account).
              </p>
            ) : (
              <ul className="mt-2 grid gap-1.5">
                {pinnedStations.map(({ station }) => (
                  <li
                    key={station.station_id}
                    className="flex items-center justify-between gap-2 text-[11px] text-slate-300"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Star size={11} className="shrink-0 text-amber-300" aria-hidden="true" />
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
        <dl className="grid gap-3 text-xs text-slate-400 sm:grid-cols-3">
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-slate-500">
              Version
            </dt>
            <dd className="mt-0.5 font-mono font-semibold text-slate-200">
              {version ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-slate-500">
              Datenquelle
            </dt>
            <dd className="mt-0.5 leading-relaxed">
              Markttransparenzstelle für Kraftstoffe (MTS-K) über
              tankerkoenig.de · Lizenz CC BY 4.0
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-slate-500">
              Hilfe
            </dt>
            <dd className="mt-0.5">
              <button
                onClick={onOpenGlossary}
                className="font-semibold text-sky-300 underline underline-offset-4 hover:text-sky-200"
              >
                Glossar — was heißt das?
              </button>
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
