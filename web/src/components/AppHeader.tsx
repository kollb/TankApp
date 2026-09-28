// U8: Die Kopfzeile der App-Shell — eine Zeile mit den globalen
// Steuerungen (Stadt, Kraftstoff, Profil, Alarm, Teilen, Aktualisieren).
// Vorher stand sie inline in Dashboard.tsx; die Daten kommen aus dem
// OverviewContext.
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

export function AppHeader({
  ov,
  ready,
}: {
  ov: OverviewState;
  /** Erst-Paint-Gate (0.41.1): Die Steuerungen erscheinen gemeinsam mit dem
      fertigen Inhalt — vorher würden Stadt-/Profil-Auswahl und der Alarm-Punkt
      nachträglich in die Zeile springen und alles daneben verschieben
      (Lighthouse-Gate `cumulative-layout-shift`). */
  ready: boolean;
}) {
  const [contextOpen, setContextOpen] = useState(false);
  const {
    activeCity,
    data,
    setCity,
    setSelectedId,
    fuel,
    setFuel,
    activeProfileId,
    handleActivateProfile,
    activeProfile,
    profilesRes,
    profilesBusy,
    setProfileManagerOpen,
    h,
    alarms,
    errorAlarms,
    warnAlarms,
    shareNote,
    copyShareLink,
    prices,
    setRefresh,
  } = ov;
  return (
    <header className="app-header z-40 border-b border-outline-variant bg-surface/95 backdrop-blur-md sm:sticky sm:top-0">
      {/* U3 (überarbeitet 16.09.2026): Auf schmalen Viewports **bricht** die
          Steuerzeile um, statt seitlich zu scrollen. Der Streifen war 748 px
          breit und zeigte in 209 px Fensterbreite kaum zwei Steuerungen — wer
          das Profil wechseln wollte, musste erst schieben („verschiedene
          Dinge die scrollen müssen“). Dafür entfällt auf dem Handy die
          Wortmarke (das Symbol bleibt), und die Kopfzeile klebt erst ab `sm`
          am oberen Rand: zwei Steuerzeilen dauerhaft über dem Inhalt wären
          der nächste Platzverlust. */}
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        {/* 0.55.1: `tap-44`, weil auf dem Handy nur das 40-px-Symbol übrig
            bleibt (die Wortmarke steht erst ab `sm`) — als Link ohne die
            Klasse greift die 44-px-Regel nicht, siehe C5-Ratchet. */}
        <a
          href="/"
          className="tap-44 flex shrink-0 items-center gap-3"
          aria-label="TankApp Startseite"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-on-primary">
            <FuelIcon size={21} />
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
        {/* min-w-0: als Flex-Kind sonst so breit wie der Inhalt — dann
            scrollt nichts und die Zeile sprengt schmale Viewports
            (e2e-Check `scrollWidth <= innerWidth`). relative: hält
            absolut positionierte Kinder (sr-only-Status) im Clip der
            Zeile, sonst erweitern sie die Dokument-Breite. */}
        {/* Der Neubau ist die echte Ansicht (dieselben Endpunkte, dieselben
            Gates) — deshalb heißt der Einstieg „Neue Ansicht“, nicht „Demo“. */}
        <a href="/?konzept=1" title="Neue Ansicht mit denselben Daten und Freigaben öffnen" className="tap-44 hidden shrink-0 items-center rounded-full border border-outline-variant px-3 py-2 text-xs font-semibold text-primary lg:inline-flex">Neue Ansicht ↗</a>
        {ready && (
        <div className="relative flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <button onClick={() => setContextOpen(true)} aria-label="Stadt und Kraftstoff auswählen"
            aria-haspopup="dialog" className="flex min-w-0 items-center gap-1.5 rounded-full border border-outline-variant bg-sc-lowest py-2 pl-3 pr-2 text-xs font-bold hover:bg-sc-low">
            <MapPin size={14} className="shrink-0 text-primary" />
            <span className="truncate">{activeCity || "Stadt auswählen"} · {fuel === "diesel" ? "Diesel" : fuel.toUpperCase()}</span>
            <ChevronDown size={14} className="shrink-0 text-on-surface-variant" />
          </button>
          <BottomSheet open={contextOpen} title="Stadt und Kraftstoff" onClose={() => setContextOpen(false)}>
            <div className="flex flex-wrap gap-4">
          <label className="flex shrink-0 items-center gap-2 rounded-lg border border-outline-variant bg-sc-lowest px-3 py-2 text-xs">
            <MapPin size={14} className="text-primary" />
            <span className="sr-only">Stadt</span>
            <select
              aria-label="Stadt"
              value={activeCity}
              onChange={(e) => {
                setCity(e.target.value);
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
          {/* M3 Filter Chips (Konzept v2): Häkchen bei der Auswahl. */}
          <div
            role="group"
            aria-label="Kraftstoff"
            className="flex shrink-0 flex-wrap items-center gap-2"
          >
            {(["e10", "e5", "diesel"] as Fuel[]).map((value) => (
              <button
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
            <button onClick={() => setContextOpen(false)} className="m3-btn-now mt-5 rounded-full px-5 py-2.5 text-sm font-semibold">Auswahl übernehmen</button>
          </BottomSheet>
          {/* A1: Profil-Umschalter — das aktive Profil liefert Verbrauch,
              Zeitwert, Tankmenge, Kraftstoff, Tempo und Tankgröße für alle
              Geräte im Haushalt. Änderungen schreiben zurück (entprellt). */}
          <label className="flex shrink-0 items-center gap-2 rounded-full border border-outline-variant bg-sc-lowest px-3 py-2 text-xs hover:bg-sc-low">
            <Car size={14} className="text-primary" />
            <span className="sr-only">Fahrzeug-Profil</span>
            <select
              aria-label="Fahrzeug-Profil"
              value={activeProfileId}
              onChange={(e) => {
                void handleActivateProfile(e.target.value || null);
              }}
              title={
                activeProfile
                  ? `Aktives Profil „${activeProfile.name}“ — Felder gelten haushaltsweit`
                  : "Kein Profil aktiv — Einstellungen gelten nur auf diesem Gerät"
              }
              className="max-w-40 bg-transparent pr-1 text-on-surface"
            >
              <option value="">Kein Profil (nur dieses Gerät)</option>
              {(profilesRes.data?.profiles ?? []).map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          <button
            aria-label="Fahrzeug-Profile verwalten"
            title="Profile anlegen, umbenennen, löschen (A1)"
            onClick={() => setProfileManagerOpen(true)}
            disabled={profilesBusy}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-outline-variant bg-sc-lowest text-on-surface-variant hover:bg-sc-low"
          >
            <SquarePen size={16} aria-hidden="true" />
          </button>
          {/* B4: aggregierter System-Alarm als roter/gelber/grüner Punkt. */}
          {h && alarms.length > 0 && (
            <span
              role="status"
              title={
                alarms.length
                  ? alarms.map((a) => a.message).join(" · ")
                  : "Alles ok — keine Alarme"
              }
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold ${
                errorAlarms.length
                  ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                  : warnAlarms.length
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${
                  errorAlarms.length
                    ? "bg-rose-400"
                    : warnAlarms.length
                      ? "bg-amber-400"
                      : "bg-emerald-400"
                }`}
              />
              {errorAlarms.length
                ? `${errorAlarms.length} Alarm${errorAlarms.length > 1 ? "e" : ""}`
                : warnAlarms.length
                  ? `${warnAlarms.length} Hinweis${warnAlarms.length > 1 ? "e" : ""}`
                  : "Alles ok"}
            </span>
          )}
          {/* A6: aktuelle Sicht als Link teilen (Haushalt/Bookmark). */}
          <span className="relative inline-flex">
            <button
              aria-label="Ansicht als Link teilen"
              title="Ansicht als Link kopieren"
              onClick={copyShareLink}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-outline-variant bg-sc-lowest text-on-surface-variant hover:bg-sc-low"
            >
              <Share2 size={16} aria-hidden="true" />
            </button>
            <span role="status" aria-live="polite" className="sr-only">
              {shareNote ?? ""}
            </span>
            {shareNote && (
              <span
                role="status"
                className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-outline-variant bg-sc-lowest p-2.5 text-xs leading-snug text-on-surface shadow-xl"
              >
                {shareNote}
              </span>
            )}
          </span>
          <button
            aria-label="Daten aktualisieren"
            title="Datenansicht aktualisieren"
            onClick={() => setRefresh((value) => value + 1)}
            disabled={prices.pending}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-outline-variant bg-sc-lowest text-on-surface-variant hover:bg-sc-low"
          >
            <RefreshCw
              size={16}
              className={
                prices.pending ? "animate-spin text-primary" : ""
              }
            />
          </button>
        </div>
        )}
      </div>
    </header>
  );
}
