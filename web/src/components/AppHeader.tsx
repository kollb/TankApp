// U8: Die Kopfzeile der App-Shell — eine Zeile mit den globalen
// Steuerungen (Stadt, Kraftstoff, Profil, Alarm, Teilen, Aktualisieren).
// Vorher stand sie inline in Dashboard.tsx; die Daten kommen aus dem
// OverviewContext.
import {
  Car,
  Fuel as FuelIcon,
  MapPin,
  RefreshCw,
  Share2,
  SquarePen,
} from "lucide-react";
import type { Fuel } from "../data";
import type { OverviewState } from "../state/overview";

export function AppHeader({
  ov,
  ready,
}: {
  ov: OverviewState;
  /** Erst-Paint-Gate (0.40.1): Die Steuerungen erscheinen gemeinsam mit dem
      fertigen Inhalt — vorher würden Stadt-/Profil-Auswahl und der Alarm-Punkt
      nachträglich in die Zeile springen und alles daneben verschieben
      (Lighthouse-Gate `cumulative-layout-shift`). */
  ready: boolean;
}) {
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
    <header className="app-header sticky top-0 z-40 border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-md">
      {/* U3: eine Zeile — die globalen Steuerungen (Stadt, Kraftstoff,
          Profil, Alarm, Teilen, Aktualisieren) laufen nebeneinander und
          scrollen auf schmalen Viewports, statt eine zweite Steuerzeile
          über den Inhalt zu schieben. */}
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <a
          href="/"
          className="flex shrink-0 items-center gap-3"
          aria-label="TankApp Startseite"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-tr from-emerald-500 to-sky-500 text-slate-950 shadow-lg shadow-emerald-500/20">
            <FuelIcon size={21} />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight text-white">
              TankApp
            </h1>
            <p className="app-tagline hidden text-xs text-slate-500 sm:block">
              Dein Tank-Kompass. Ohne Rätselraten.
            </p>
          </div>
        </a>
        {/* min-w-0: als Flex-Kind sonst so breit wie der Inhalt — dann
            scrollt nichts und die Zeile sprengt schmale Viewports
            (e2e-Check `scrollWidth <= innerWidth`). relative: hält
            absolut positionierte Kinder (sr-only-Status) im Clip der
            Zeile, sonst erweitern sie die Dokument-Breite. */}
        {ready && (
        <div className="relative flex min-w-0 items-center gap-2 overflow-x-auto sm:gap-3">
          <label className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs">
            <MapPin size={14} className="text-emerald-400" />
            <span className="sr-only">Stadt</span>
            <select
              aria-label="Stadt"
              value={activeCity}
              onChange={(e) => {
                setCity(e.target.value);
                setSelectedId("");
              }}
              disabled={!data?.cities.length}
              className="max-w-40 bg-slate-950 pr-1 text-slate-100"
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
            className="flex shrink-0 rounded-lg border border-slate-800 bg-slate-950 p-1 text-xs font-bold"
          >
            {(["e10", "e5", "diesel"] as Fuel[]).map((value) => (
              <button
                key={value}
                aria-pressed={fuel === value}
                onClick={() => setFuel(value)}
                className={`rounded-lg px-3 py-1.5 transition-colors ${fuel === value ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"}`}
              >
                {value === "diesel" ? "Diesel" : value.toUpperCase()}
              </button>
            ))}
          </div>
          {/* A1: Profil-Umschalter — das aktive Profil liefert Verbrauch,
              Zeitwert, Tankmenge, Kraftstoff, Tempo und Tankgröße für alle
              Geräte im Haushalt. Änderungen schreiben zurück (entprellt). */}
          <label className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs">
            <Car size={14} className="text-emerald-400" />
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
              className="max-w-40 bg-slate-950 pr-1 text-slate-100"
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
            className="rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-slate-300 hover:text-white"
          >
            <SquarePen size={16} aria-hidden="true" />
          </button>
          {/* B4: aggregierter System-Alarm als roter/gelber/grüner Punkt. */}
          {h && (
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
              title="Setzt Bereich, Stadt, Kraftstoff, Station, Tankmenge und Heatmap-Einstellungen in die URL und kopiert sie"
              onClick={copyShareLink}
              className="rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-slate-300 hover:text-white"
            >
              <Share2 size={16} aria-hidden="true" />
            </button>
            <span role="status" aria-live="polite" className="sr-only">
              {shareNote ?? ""}
            </span>
            {shareNote && (
              <span
                role="status"
                className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-xs leading-snug text-slate-200 shadow-xl"
              >
                {shareNote}
              </span>
            )}
          </span>
          <button
            aria-label="Daten aktualisieren"
            title="Aktualisiert die NAS-Datenansicht, löst keinen Tankerkönig-Poll aus"
            onClick={() => setRefresh((value) => value + 1)}
            disabled={prices.pending}
            className="rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-slate-300 hover:text-white"
          >
            <RefreshCw
              size={16}
              className={
                prices.pending ? "animate-spin text-emerald-400" : ""
              }
            />
          </button>
        </div>
        )}
      </div>
    </header>
  );
}
