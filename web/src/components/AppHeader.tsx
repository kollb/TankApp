// U8: Die Kopfzeile der App-Shell — Ort und Kraftstoff bleiben direkt
// erreichbar. Auf schmalen und mittleren Viewports liegen Profil und seltene
// App-Aktionen gemeinsam in einem Blatt, damit die Antwort nicht unter einer
// mehrzeiligen Steuerzeile verschwindet.
import {
  Car,
  Check,
  ChevronDown,
  Fuel as FuelIcon,
  MapPin,
  RefreshCw,
  Share2,
  SquarePen,
} from "lucide-react";
import { useState } from "react";
import { BottomSheet } from "./BottomSheet";
import type { Fuel } from "../data";
import type { OverviewState } from "../state/overview";

type HeaderOverview = Pick<
  OverviewState,
  | "activeCity"
  | "data"
  | "setCity"
  | "setSelectedId"
  | "fuel"
  | "setFuel"
  | "activeProfileId"
  | "handleActivateProfile"
  | "activeProfile"
  | "profilesRes"
  | "profilesBusy"
  | "setProfileManagerOpen"
  | "h"
  | "alarms"
  | "errorAlarms"
  | "warnAlarms"
  | "shareNote"
  | "copyShareLink"
  | "prices"
  | "setRefresh"
>;

function ProfileSelector({
  ov,
  compact = false,
}: {
  ov: HeaderOverview;
  compact?: boolean;
}) {
  return (
    <label
      className={`flex shrink-0 items-center gap-2 border border-outline-variant bg-sc-lowest text-xs ${
        compact
          ? "w-full rounded-lg px-3 py-2.5"
          : "rounded-full px-3 py-2 hover:bg-sc-low"
      }`}
    >
      <Car size={14} className="shrink-0 text-primary" aria-hidden="true" />
      <span className="sr-only">Fahrzeug-Profil</span>
      <select
        aria-label="Fahrzeug-Profil"
        value={ov.activeProfileId}
        onChange={(event) => {
          void ov.handleActivateProfile(event.target.value || null);
        }}
        title={
          ov.activeProfile
            ? `Aktives Profil „${ov.activeProfile.name}“ — Felder gelten haushaltsweit`
            : "Kein Profil aktiv — Einstellungen gelten nur auf diesem Gerät"
        }
        className={`min-w-0 bg-transparent pr-1 text-on-surface ${
          compact ? "flex-1" : "max-w-40"
        }`}
      >
        <option value="">Kein Profil (nur dieses Gerät)</option>
        {(ov.profilesRes.data?.profiles ?? []).map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function ProfileManagerButton({
  ov,
  compact = false,
  onOpen,
}: {
  ov: HeaderOverview;
  compact?: boolean;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label="Fahrzeug-Profile verwalten"
      title="Profile anlegen, umbenennen, löschen (A1)"
      onClick={() => {
        onOpen?.();
        ov.setProfileManagerOpen(true);
      }}
      disabled={ov.profilesBusy}
      className={`flex shrink-0 items-center justify-center rounded-full border border-outline-variant bg-sc-lowest text-on-surface-variant hover:bg-sc-low ${
        compact
          ? "min-h-11 w-full justify-start gap-3 rounded-lg px-3 py-2 text-sm font-semibold"
          : "h-10 w-10"
      }`}
    >
      <SquarePen size={16} aria-hidden="true" />
      {compact && <span>Fahrzeug-Profile verwalten</span>}
    </button>
  );
}

function AlarmStatus({ ov, compact = false }: { ov: HeaderOverview; compact?: boolean }) {
  if (!ov.h || ov.alarms.length === 0) return null;
  const statusText = ov.errorAlarms.length
    ? `${ov.errorAlarms.length} Alarm${ov.errorAlarms.length > 1 ? "e" : ""}`
    : ov.warnAlarms.length
      ? `${ov.warnAlarms.length} Hinweis${ov.warnAlarms.length > 1 ? "e" : ""}`
      : "Alles ok";
  const statusCount = ov.errorAlarms.length || ov.warnAlarms.length || ov.alarms.length;
  return (
    <span
      role="status"
      title={ov.alarms.map((alarm) => alarm.message).join(" · ")}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border font-semibold ${
        compact
          ? "gap-1 px-1.5 py-1.5 text-[0.625rem] sm:gap-1.5 sm:px-2 sm:text-xs"
          : "px-2.5 py-1.5 text-xs"
      } ${
        ov.errorAlarms.length
          ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
          : ov.warnAlarms.length
            ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 shrink-0 rounded-full sm:h-2 sm:w-2 ${
          ov.errorAlarms.length
            ? "bg-rose-400"
            : ov.warnAlarms.length
              ? "bg-amber-400"
              : "bg-emerald-400"
        }`}
      />
      <span className="max-[359px]:sr-only sm:not-sr-only">{statusText}</span>
      {compact && (
        <span
          aria-hidden="true"
          className="hidden max-[359px]:inline sm:hidden"
        >
          {statusCount}
        </span>
      )}
    </span>
  );
}

function ShareButton({ ov, compact = false }: { ov: HeaderOverview; compact?: boolean }) {
  return (
    <span className={`relative inline-flex ${compact ? "w-full" : ""}`}>
      <button
        type="button"
        aria-label="Ansicht als Link teilen"
        title="Ansicht als Link kopieren"
        onClick={ov.copyShareLink}
        className={`flex shrink-0 items-center justify-center rounded-full border border-outline-variant bg-sc-lowest text-on-surface-variant hover:bg-sc-low ${
          compact
            ? "min-h-11 w-full gap-2 rounded-lg px-3 py-2 text-sm font-semibold"
            : "h-10 w-10"
        }`}
      >
        <Share2 size={16} aria-hidden="true" />
        {compact && <span>Ansicht teilen</span>}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {ov.shareNote ?? ""}
      </span>
      {ov.shareNote && (
        <span
          role="status"
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-outline-variant bg-sc-lowest p-2.5 text-xs leading-snug text-on-surface shadow-xl"
        >
          {ov.shareNote}
        </span>
      )}
    </span>
  );
}

function RefreshButton({ ov, compact = false }: { ov: HeaderOverview; compact?: boolean }) {
  return (
    <button
      type="button"
      aria-label="Daten aktualisieren"
      title="Datenansicht aktualisieren"
      onClick={() => ov.setRefresh((value) => value + 1)}
      disabled={ov.prices.pending}
      className={`flex shrink-0 items-center justify-center rounded-full border border-outline-variant bg-sc-lowest text-on-surface-variant hover:bg-sc-low disabled:opacity-50 ${
        compact
          ? "min-h-11 w-full gap-2 rounded-lg px-3 py-2 text-sm font-semibold"
          : "h-10 w-10"
      }`}
    >
      <RefreshCw
        size={16}
        aria-hidden="true"
        className={ov.prices.pending ? "animate-spin text-primary" : ""}
      />
      {compact && <span>Daten aktualisieren</span>}
    </button>
  );
}

export function AppHeader({
  ov,
  ready,
}: {
  ov: OverviewState;
  /** Erst-Paint-Gate: Die Steuerungen erscheinen mit dem fertigen Inhalt. */
  ready: boolean;
}) {
  const [contextOpen, setContextOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const {
    activeCity,
    data,
    setCity,
    setSelectedId,
    fuel,
    setFuel,
    activeProfile,
  } = ov;
  const fuelName = fuel === "diesel" ? "Diesel" : fuel.toUpperCase();
  const contextName = `${activeCity || "Stadt auswählen"} · ${fuelName}`;

  return (
    <header className="app-header z-40 border-b border-outline-variant bg-surface/95 backdrop-blur-md sm:sticky sm:top-0">
      {/* Unter xl bleibt die Shell einzeilig: Kontext ist direkt da, die
          Fahrzeug- und App-Aktionen wohnen gemeinsam im Profil-Blatt. */}
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2 sm:gap-4 sm:px-6 sm:py-3 lg:px-8">
        <a
          href="/"
          className="tap-44 flex shrink-0 items-center gap-3"
          aria-label="TankApp Startseite"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-on-primary">
            <FuelIcon size={21} aria-hidden="true" />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-lg font-black tracking-tight text-on-surface">
              TankApp
            </h1>
            <p className="app-tagline hidden text-xs text-on-surface-variant sm:block">
              Dein Tank-Kompass. Ohne Rätselraten.
            </p>
          </div>
        </a>
        <a
          href="/?konzept=1"
          className="tap-44 hidden shrink-0 items-center rounded-full border border-outline-variant px-3 py-2 text-xs font-semibold text-primary lg:inline-flex"
        >
          Neue GUI ↗
        </a>
        {ready && (
          <div className="relative flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-3 xl:flex-none">
            <button
              type="button"
              onClick={() => setContextOpen(true)}
              aria-label="Stadt und Kraftstoff auswählen"
              aria-haspopup="dialog"
              aria-expanded={contextOpen}
              title={contextName}
              className="flex min-w-0 flex-1 items-center gap-1 rounded-full border border-outline-variant bg-sc-lowest py-2 pl-2 pr-2 text-xs font-bold hover:bg-sc-low sm:gap-1.5 sm:pl-3 xl:flex-none xl:shrink-0"
            >
              <MapPin size={14} className="hidden shrink-0 text-primary sm:block" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{activeCity || "Stadt auswählen"}</span>
              <span className="shrink-0">{fuelName}</span>
              <ChevronDown
                size={14}
                className="shrink-0 text-on-surface-variant max-[359px]:hidden"
                aria-hidden="true"
              />
            </button>
            <BottomSheet
              open={contextOpen}
              title="Stadt und Kraftstoff"
              onClose={() => setContextOpen(false)}
            >
              <div className="flex flex-wrap gap-4">
                <label className="flex shrink-0 items-center gap-2 rounded-lg border border-outline-variant bg-sc-lowest px-3 py-2 text-xs">
                  <MapPin size={14} className="text-primary" aria-hidden="true" />
                  <span className="sr-only">Stadt</span>
                  <select
                    aria-label="Stadt"
                    value={activeCity}
                    onChange={(event) => {
                      setCity(event.target.value);
                      setSelectedId("");
                    }}
                    disabled={!data?.cities.length}
                    className="max-w-40 bg-transparent pr-1 text-on-surface"
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
                  aria-label="Kraftstoff"
                  className="flex shrink-0 flex-wrap items-center gap-2"
                >
                  {(["e10", "e5", "diesel"] as Fuel[]).map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={fuel === value}
                      onClick={() => setFuel(value)}
                      className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${fuel === value ? "border-transparent bg-secondary-container text-on-secondary-container" : "border-outline-variant text-on-surface-variant hover:bg-sc-low"}`}
                    >
                      {fuel === value && <Check size={16} aria-hidden="true" />}
                      {value === "diesel" ? "Diesel" : value.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setContextOpen(false)}
                className="m3-btn-now mt-5 rounded-full px-5 py-2.5 text-sm font-semibold"
              >
                Auswahl übernehmen
              </button>
            </BottomSheet>
            <div className="flex min-w-0 shrink-0 items-center gap-1.5 xl:hidden">
              <AlarmStatus ov={ov} compact />
              <button
                type="button"
                aria-label="Fahrzeug-Profil und Aktionen"
                aria-haspopup="dialog"
                aria-expanded={actionsOpen}
                title={activeProfile ? `Aktives Profil: ${activeProfile.name}` : "Profil und App-Aktionen"}
                onClick={() => setActionsOpen(true)}
                className="flex h-11 min-w-11 shrink-0 items-center gap-1 rounded-full border border-outline-variant bg-sc-lowest px-2 text-xs font-semibold text-on-surface-variant hover:bg-sc-low"
              >
                <Car size={16} className="hidden shrink-0 sm:block" aria-hidden="true" />
                <span>Profil</span>
                <ChevronDown size={14} className="hidden sm:block" aria-hidden="true" />
              </button>
            </div>
            <div className="hidden min-w-0 shrink-0 flex-wrap items-center justify-end gap-2 xl:flex">
              <ProfileSelector ov={ov} />
              <ProfileManagerButton ov={ov} />
              <AlarmStatus ov={ov} />
              <ShareButton ov={ov} />
              <RefreshButton ov={ov} />
            </div>
            <BottomSheet
              open={actionsOpen}
              title="Profil und Aktionen"
              onClose={() => setActionsOpen(false)}
            >
              <div className="space-y-5">
                <section aria-labelledby="header-profile-title" className="space-y-2">
                  <h3 id="header-profile-title" className="text-sm font-semibold text-on-surface">
                    Fahrzeug-Profil
                  </h3>
                  <ProfileSelector ov={ov} compact />
                  <ProfileManagerButton
                    ov={ov}
                    compact
                    onOpen={() => setActionsOpen(false)}
                  />
                </section>
                <section aria-labelledby="header-actions-title" className="space-y-2">
                  <h3 id="header-actions-title" className="text-sm font-semibold text-on-surface">
                    App-Aktionen
                  </h3>
                  <div role="group" aria-label="App-Aktionen" className="grid grid-cols-1 gap-2">
                    <ShareButton ov={ov} compact />
                    <RefreshButton ov={ov} compact />
                  </div>
                </section>
              </div>
            </BottomSheet>
          </div>
        )}
      </div>
    </header>
  );
}
