// A1: Verwaltung der Fahrzeug-/Haushaltsprofile — ein Dialog, aufgerufen aus
// dem Profil-Umschalter im Header. Die Datenhaltung (POST/PUT/DELETE und der
// Sync in die Preferences) bleibt in der Dashboard-Root; diese Komponente
// rendert und ruft zurück. Kein Login, kein Account: serverseitige
// Haushalts-Speicherung im LAN, offen zugänglich wie der Rest der App.

import { useState } from "react";
import { Car, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  deTrimmed,
  type Profiles,
  type ResourceState,
  type VehicleProfile,
} from "../data";

const FIELD =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white focus:border-emerald-500";
const BUTTON_GHOST =
  "rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50";

/** Eine Zeile Profil-Zusammenfassung — dieselben Formatter wie die Panels. */
export function profileSummaryLine(profile: VehicleProfile): string {
  const fuel = profile.fuel === "diesel" ? "Diesel" : profile.fuel.toUpperCase();
  return `${fuel} · ${deTrimmed(profile.liters, 0)} L Tankmenge · ${deTrimmed(
    profile.consumption,
    1,
  )} L/100 km · Zeitwert ${profile.time_value_eur_h > 0 ? `${deTrimmed(profile.time_value_eur_h, 1)} €/h` : "Automatik"} · Tank ${deTrimmed(
    profile.tank_capacity_l,
    0,
  )} L`;
}

export type ProfileManagerProps = {
  open: boolean;
  onClose: () => void;
  profilesRes: ResourceState<Profiles>;
  activeId: string | null;
  busy: boolean;
  note: string | null;
  onActivate: (id: string | null) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
};

export function ProfileManager({
  open,
  onClose,
  profilesRes,
  activeId,
  busy,
  note,
  onActivate,
  onCreate,
  onRename,
  onDelete,
}: ProfileManagerProps) {
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  if (!open) return null;
  const profiles = profilesRes.data?.profiles ?? [];
  const serverActive = profilesRes.data?.active ?? null;

  const submitCreate = () => {
    const name = newName.trim();
    if (!name || busy) return;
    onCreate(name);
    setNewName("");
  };

  const submitRename = () => {
    const name = renameValue.trim();
    if (!renamingId || !name || busy) return;
    onRename(renamingId, name);
    setRenamingId(null);
    setRenameValue("");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-manager-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="profile-manager-title"
              className="flex items-center gap-2 text-base font-bold text-white"
            >
              <Car size={18} className="text-emerald-400" aria-hidden="true" />
              Fahrzeug-Profile
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              Verbrauch, Zeitwert, Tankmenge, Kraftstoff und Tankgröße —
              serverseitig für den Haushalt gespeichert, für alle Geräte im
              LAN. Ohne Login.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Profil-Verwaltung schließen"
            className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-white"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        {profilesRes.error && (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/40 px-3 py-2 text-[11px] leading-snug text-amber-200"
          >
            Profile sind gerade nicht erreichbar — Änderungen wirken nur auf
            diesem Gerät, bis der Server wieder antwortet.
          </p>
        )}
        {profilesRes.errorCode === "profiles_read_failed" && (
          <p
            role="alert"
            className="mt-2 rounded-lg border border-amber-500/30 bg-amber-950/40 px-3 py-2 text-[11px] leading-snug text-amber-200"
          >
            Der Profil-Speicher konnte nicht gelesen werden (Fehlercode
            „profiles_read_failed“).
          </p>
        )}
        {note && (
          <p
            role="status"
            aria-live="polite"
            className="mt-3 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-[11px] leading-snug text-slate-300"
          >
            {note}
          </p>
        )}

        <ul className="mt-4 space-y-2">
          {profiles.map((profile) => {
            const isActive = activeId === profile.id;
            const serverMarked = serverActive === profile.id;
            return (
              <li
                key={profile.id}
                className={`rounded-xl border p-3 ${
                  isActive
                    ? "border-emerald-500/40 bg-emerald-500/[.06]"
                    : "border-slate-800 bg-slate-950/40"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-200">
                      {profile.name}
                      {isActive && (
                        <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                          aktiv auf diesem Gerät
                        </span>
                      )}
                      {!isActive && serverMarked && (
                        <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
                          aktiv auf einem anderen Gerät
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {profileSummaryLine(profile)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!isActive && (
                      <button
                        onClick={() => onActivate(profile.id)}
                        disabled={busy}
                        title="Dieses Profil auf diesem Gerät verwenden"
                        className={BUTTON_GHOST}
                      >
                        <Check size={13} aria-hidden="true" /> Verwenden
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setRenamingId(
                          renamingId === profile.id ? null : profile.id,
                        );
                        setRenameValue(profile.name);
                      }}
                      disabled={busy}
                      aria-label={`Profil „${profile.name}“ umbenennen`}
                      className={BUTTON_GHOST}
                    >
                      <Pencil size={13} aria-hidden="true" />
                    </button>
                    <button
                      onClick={() => onDelete(profile.id)}
                      disabled={busy}
                      title={`Profil „${profile.name}“ löschen — war es aktiv, ist danach keins aktiv`}
                      aria-label={`Profil „${profile.name}“ löschen`}
                      className={`${BUTTON_GHOST} hover:border-rose-500/40 hover:text-rose-300`}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </div>
                </div>
                {renamingId === profile.id && (
                  <form
                    className="mt-2 flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitRename();
                    }}
                  >
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      maxLength={40}
                      aria-label="Neuer Profilname"
                      className={FIELD}
                    />
                    <button
                      type="submit"
                      disabled={busy || !renameValue.trim()}
                      className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                    >
                      Speichern
                    </button>
                  </form>
                )}
              </li>
            );
          })}
          {!profiles.length && !profilesRes.error && (
            <li className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-4 text-xs leading-relaxed text-slate-400">
              Noch kein Profil angelegt. „Aus aktuellen Einstellungen erstellen“
              übernimmt Verbrauch, Zeitwert, Tankmenge und Kraftstoff genau so,
              wie sie gerade stehen.
            </li>
          )}
        </ul>

        <form
          className="mt-4 flex flex-col gap-2 border-t border-slate-800 pt-4 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            submitCreate();
          }}
        >
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={40}
            placeholder="Name, z. B. „Pendler-Benziner“"
            aria-label="Name des neuen Profils"
            className={`${FIELD} sm:flex-1`}
          />
          <button
            type="submit"
            disabled={busy || !newName.trim()}
            title="Erstellt ein Profil aus den aktuellen Einstellungen und aktiviert es"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={14} aria-hidden="true" />
            Aus aktuellen Einstellungen erstellen
          </button>
        </form>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          Höchstens 8 Profile. Änderungen an Verbrauch, Zeitwert, Tankmenge,
          Kraftstoff, Tempo oder Tankgröße schreiben in das aktive Profil
          zurück — solange einer Profileinstellung folgt, gilt sie auf allen
          Geräten im Haushalt. Stadt und Vergleichsstation bleiben Gerätetzung.
        </p>
      </div>
    </div>
  );
}
