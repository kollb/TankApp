// U8: OverviewContext — die geteilten Daten der App.
//
// Vorher hielt die Root (Dashboard.tsx, ~2 200 Zeilen) jeden Zustand und
// reichte ihn über 41/32-Prop-Listen an Labor/System weiter. Seit U8 gilt:
//   * Alles, was mehrere Bereiche lesen (Preise, Overview-Poll, Profile,
//     Auswahl, Navigation, Offline-Queue, Feedback), lebt hier und wird per
//     Context gereicht — die Views holen sich, was sie brauchen.
//   * Bereichsspezifischer Zustand wohnt in den Views: das Labor besitzt
//     seinen Spielplatz (ε, Tagesindex) und sein Modell (useLaborModel),
//     der System-Bereich sein Log-Terminal (Refs, Kommandos).
// Die Root ist Zusammensetzung geblieben: Header, Navigation, Banner und
// die Bereich-Umschaltung.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  applyAppTheme,
  autoTimeValue,
  checkFillDraft,
  currentPrice,
  germanDecimalToNumber,
  heatmapPath,
  HEATMAP_DEFAULT_BASIS,
  HEATMAP_DEFAULT_WEEKS,
  isAppTheme,
  isHeatmapBasis,
  isHeatmapWeeks,
  livePhaseHint,
  m7GateLine,
  PINNED_MAX,
  fillPositionNote,
  profileFields,
  profileFieldsDiffer,
  profileErrorText,
  profileRequest,
  readShareParams,
  shareQuery,
  problem,
  segments,
  timeLabel,
  timeSpanLabel,
  type SpanHours,
  togglePinnedStation,
  transitionRuleLine,
  useResource,
  usePreference,
  postIntent,
  postQueued,
  queuedNote,
  saveFailedNote,
  FILL_BOOKED_LINE,
  NO_LIVE_PRICE_LINE,
  SHARE_URL_LINE,
  postFill,
  voidFill,
  rowOutcome,
  scoreRows,
  type AppTheme,
  type DetourMode,
  type Fills,
  type FillsSummary,
  type Fuel,
  type HeatmapBasis,
  type ProfileFields,
  type Profiles,
  type Station,
  type Stations,
  usableStations,
  type Health,
  type Forecast,
  type Point,
  type Heatmap,
  type Selection,
  type DataReach,
  type CollectorStatus,
  type DecideResult,
  type StatsSummary,
  type JobLog,
  type Overview,
  type AdviceDiary,
} from "../data";
import {
  flushQueue,
  queueOldestAgeMs,
  queueStatusText,
  readQueue,
  type QueuedWrite,
} from "../offline-queue";
import { forecastStamp, type NowTarget } from "../now";
import { promptFillPrice } from "../fills";
import { buildStripCells } from "../strip";
import { type LabSectionId } from "../lab";
import {
  tabFromUrlId,
  tabToUrlId,
  sectionFromUrlId,
  queryWithTab,
  type TabId,
} from "../routing";
import type { NowAssumptions } from "../views/Jetzt";
import type { ActionFeedback, FeedbackTone } from "../components/FeedbackBanner";

function useOverviewState() {
  // A6: Share-URL beim Start lesen — einmalig vor allen Preferences. Eine
  // geteilte Ansicht (?city=…&fuel=…&station_id=…&liters=…&weeks=…&basis=…)
  // überschreibt damit den localStorage des empfangenden Geräts; ohne das
  // würde sie falsch wiederhergestellt, seit heatmapWeeks/heatmapBasis echte
  // Preferences sind. Ungültige Parameter werden in readShareParams
  // weggelassen, die GUI fällt auf ihre Defaults zurück.
  const share = useMemo(() => readShareParams(window.location.search), []);
  const [fuel, setFuel] = usePreference<Fuel>(
    "fuel",
    "e10",
    (value) => value === "e10" || value === "e5" || value === "diesel",
    share.fuel,
  );
  const [city, setCity] = usePreference(
    "city",
    "",
    (value) => typeof value === "string",
    share.city,
  );
  const [selectedId, setSelectedId] = useState(share.stationId ?? "");
  // GUI-Neuentwurf (Phase 3): die sechs Aufgaben-Bereiche.
  // U4: Der Bereich steht in der URL (`?tab=…`) — beim Start gelesen, beim
  // Wechsel per pushState geschrieben, Browser-Zurück hört auf popstate.
  const [tab, setTab] = useState<TabId>(() => tabFromUrlId(share.tab));
  // Erklär-Treppe Ebene 1 → 2 (§7): Die Root merkt sich nur noch den
  // Labor-Abschnitt, in den ein Ebene-2-Sprung führt. Eine „Zurück zu:“-
  // Herkunft braucht es seit U5 nicht mehr — Ebene 1 öffnet ein Sheet am
  // Ort, und der Rückweg ist das Browser-Zurück (U4-Routing).
  const [laborFocus, setLaborFocus] = useState<LabSectionId | null>(() =>
    share.tab === "labor" ? sectionFromUrlId(share.section) : null,
  );
  // U4: Bereich wechseln heißt auch URL wechseln — pushState, damit der
  // Browser-Zurück-Knopf die Ansichten in umgekehrter Reihenfolge abfährt.
  // Die übrige Query (Stadt, Kraftstoff, Station …) bleibt erhalten.
  const gotoTab = (next: TabId, section: LabSectionId | null = laborFocus) => {
    setTab(next);
    try {
      const query = queryWithTab(window.location.search, next, section);
      const current = window.location.search.replace(/^\?/, "");
      if (query !== current) {
        window.history.pushState(
          null,
          "",
          `${window.location.pathname}${query ? `?${query}` : ""}`,
        );
      }
    } catch {
      /* History darf scheitern (Sandbox) — die Ansicht wechselt trotzdem. */
    }
  };
  // Einstieg in „Ich“, wenn ein anderer Bereich dort hinverweist (z. B.
  // „Beleg manuell buchen“ im Due-Prompt → Belege). Sonst „Fahrzeug“.
  const [ichSection, setIchSection] = useState<
    "vehicle" | "fills" | "balance" | "settings"
  >("vehicle");
  // GUI-Neuentwurf §5.1/§5.2: Was-wäre-wenn ist Ansichtszustand, kein
  // Setting — die Karte ändert die Annahmen live (dieselbe Anfrage, andere
  // Parameter), das Profil bleibt unangetastet. null = Profilwert.
  const [assumptions, setAssumptions] = useState<NowAssumptions>({
    liters: null,
    latestBy: null,
    timeValue: null,
  });
  // GUI-Neuentwurf §5.2: „Suche stations-/ortsübergreifend aus jeder
  // Ansicht (⌘K)“ — die Root nimmt den Tastenabdruck, die Stationen-View
  // bekommt den Fokus per Signal.
  const [searchFocusSignal, setSearchFocusSignal] = useState(0);
  const [liters, setLiters] = usePreference(
    "liters",
    40,
    (value) =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 10 &&
      value <= 80,
    share.liters,
  );
  const [consumption, setConsumption] = usePreference(
    "consumption",
    7,
    (value) =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 4 &&
      value <= 15,
  );
  const [timeValue, setTimeValue] = usePreference(
    "timeValue",
    12,
    (value) =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 30,
  );
  const [detourMode, setDetourMode] = usePreference<DetourMode>(
    "detourMode",
    "onroute",
    (value) => value === "onroute" || value === "dedicated",
  );
  const [speed, setSpeed] = usePreference(
    "speed",
    45,
    (value) =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 25 &&
      value <= 80,
  );
  const [spanHours, setSpanHours] = usePreference(
    "spanHours",
    24,
    (value) => value === 24 || value === 72 || value === 168,
  );
  // Verlauf-Umschalter der Stationen-Ansicht (Vorbild: Stations-Labor).
  // Eigene Präferenz, damit ein Zeitraum im Atlas den Labor-Zeitraum nicht
  // umstellt — beide sind „letzte X“, aber verschiedene Fragen.
  const [stationsSpanHours, setStationsSpanHours] = usePreference(
    "stationsSpanHours",
    168,
    (value) => value === 24 || value === 72 || value === 168,
  );
  const [horizon, setHorizon] = usePreference(
    "horizon",
    0,
    (value) => value === 0 || value === 3 || value === 7,
  );
  // C4: Dark/Light-Umschaltung (Einstellungen-Tab). Dunkel (Slate) ist der
  // Default — die Design-Basis; die Wahl gilt gerätelokal. Der
  // Bootstrap-Script in index.html wendet denselben Wert vor dem ersten
  // Paint an, hier hält React meta und Klassen synchron.
  const [theme, setTheme] = usePreference<AppTheme>(
    "theme",
    "dark",
    isAppTheme,
  );
  useEffect(() => {
    applyAppTheme(theme);
  }, [theme]);
  const [heatmapKind, setHeatmapKind] = usePreference<"level" | "probability">(
    "heatmapKind",
    "probability",
    (v) => v === "level" || v === "probability",
  );
  // E5: Wochen sind wählbar (4/6/12); die Preference war bisher ein Sackgasse,
  // weil kein Eingabeweg existierte. Saved Werte außerhalb der Auswahl (z. B.
  // 2/8 aus früheren Ständen) fallen auf den Default zurück.
  const [heatmapWeeks, setHeatmapWeeks] = usePreference<number>(
    "heatmapWeeks",
    HEATMAP_DEFAULT_WEEKS,
    isHeatmapWeeks,
    share.heatmapWeeks,
  );
  // B12: Vergleichs-Basis der Cheap-Probability ohne Station. Default
  // „hour“ (Spalten-Basis) — nur die macht die Wochentage vergleichbar.
  const [heatmapBasis, setHeatmapBasis] = usePreference<HeatmapBasis>(
    "heatmapBasis",
    HEATMAP_DEFAULT_BASIS,
    isHeatmapBasis,
    share.heatmapBasis,
  );

  // Läuft ein NAS-Job, wird der Systemstatus dichter gepollt — ein
  // 20-Minuten-Modelllauf soll seinen Fortschritt zeigen, nicht raten lassen.
  const [healthInterval, setHealthInterval] = useState(60000);

  // B4 Due-Prompt UI state
  const [dueDismissed, setDueDismissed] = useState(false);
  // Schnell-Erfassung „Tanken erfassen“: immer sichtbar, nicht nur im
  // Due-Prompt — eigener Formular-State, damit beide Dialoge sich nicht
  // gegenseitig die Eingaben überschreiben.
  const [quickStationId, setQuickStationId] = useState("");
  const [quickLitersStr, setQuickLitersStr] = useState("40");
  const [quickPriceStr, setQuickPriceStr] = useState("");
  // Eine langsame NAS machte die Buchungs-Buttons mehrere Sekunden
  // unresponsiv — wiederholtes Klicken buchte doppelte Belege. Solange eine
  // Anfrage läuft: Buttons gesperrt, Label „Wird verbucht …“.
  const [fillSubmitting, setFillSubmitting] = useState(false);
  const [voidBusy, setVoidBusy] = useState(false);
  // Stornierte Belege bleiben im Ledger (CSV, Audit), sind in der Tabelle
  // aber standardmäßig ausgeblendet — der Doppelklick-Ursprung.
  const [showVoidedFills, setShowVoidedFills] = useState(false);
  // T2: Jede Rückmeldung trägt ihren Ton — Fehler sehen nicht mehr aus wie
  // Erfolge. Ein Timer, damit eine neue Meldung die alte sofort ablöst.
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(
    null,
  );
  const feedbackTimer = useRef<number | null>(null);
  // A3: Rückmeldung beim Stornieren eines Belegs (lokal im Verlauf).
  const [voidNote, setVoidNote] = useState<string | null>(null);

  const feedback = (tone: FeedbackTone, text: string, ms = 5000) => {
    setActionFeedback({ tone, text });
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => setActionFeedback(null), ms);
  };

  // A6: Rückmeldung des „Ansicht teilen“-Knopfs (Kopfzeile).
  const [shareNote, setShareNote] = useState<string | null>(null);
  const shareNoteTimer = useRef<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(performance.now());
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  // B10: lokal vorgemerkte Belege/Vorsätze (§5.4) — sichtbar, nicht still.
  const [queue, setQueue] = useState<QueuedWrite[]>(() => readQueue());
  const [queueNote, setQueueNote] = useState<string | null>(null);

  const flushPending = async () => {
    const result = await flushQueue(postQueued);
    setQueue(result.list);
    if (result.rejected.length > 0) {
      setQueueNote(
        `${result.rejected.length === 1 ? "Ein vorgemerkter Eintrag wurde" : `${result.rejected.length} vorgemerkte Einträge wurden`} vom Server abgelehnt (${result.rejected[0].last_error ?? "abgelehnt"}) — bitte neu erfassen.`,
      );
      setTimeout(() => setQueueNote(null), 8000);
    }
    if (result.sent > 0) {
      feedback(
        "ok",
        `${result.sent === 1 ? "Ein vorgemerkter Eintrag ist" : `${result.sent} vorgemerkte Einträge sind`} übertragen.`,
        6000,
      );
      setRefresh((count) => count + 1);
    }
  };

  useEffect(() => {
    const on = () => setBrowserOnline(true);
    const off = () => setBrowserOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Beim Start und sobald das Netz zurück ist: Nachreichen, was liegen blieb.
  useEffect(() => {
    void flushPending();
    const onOnline = () => void flushPending();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // GUI-Neuentwurf §4.1: Suche als Nebenweg aus jeder Ansicht (⌘K / Strg+K).
  // Der Handler springt nach „Stationen“ und setzt das Fokus-Signal —
  // die View fokussiert ihre Suchzeile, wenn das Signal steigt.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        gotoTab("stations");
        setSearchFocusSignal((value) => value + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // U4: Browser-Zurück/Vorwärts liest den Bereich aus der URL — die App
  // bleibt eine Single-Shell, aber die Adresse ist die Wahrheit.
  useEffect(() => {
    const onPop = () => {
      const params = new URLSearchParams(window.location.search);
      const next = tabFromUrlId(params.get("tab"));
      setTab(next);
      setLaborFocus(
        next === "labor" ? sectionFromUrlId(params.get("section")) : null,
      );
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // A1: Fahrzeug-/Haushaltsprofile. Aktives Profil + fahrzeugspezifische
  // Felder kommen serverseitig aus /api/v1/profiles (Haushalt, kein Login);
  // fällt der Server aus, gilt weiter der letzte localStorage-Stand. Stadt
  // und Vergleichsstation bleiben bewusst Gerätesache.
  const [activeProfileId, setActiveProfileId] = usePreference<string>(
    "profileId",
    "",
    (value) => typeof value === "string",
  );
  const [tankCapacity, setTankCapacity] = usePreference<number>(
    "tankCapacity",
    50,
    (value) =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 20 &&
      value <= 120,
  );
  // A2: Füllstand in Prozent — Zustand, kein Profilwert (er ändert sich mit
  // jedem Beleg). null = keine Angabe, dann sagt die App nichts zum Tank.
  const [tankPercent, setTankPercent] = usePreference<number | null>(
    "tankPercent",
    null,
    (value) =>
      value === null ||
      (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100),
  );
  // C2: Stamm-Stationen — bewusst lokal (localStorage), kein Account nötig.
  const [pinnedIds, setPinnedIds] = usePreference<string[]>(
    "pinnedStations",
    [],
    (value) =>
      Array.isArray(value) &&
      value.length <= PINNED_MAX &&
      value.every((id) => typeof id === "string"),
  );
  const [pinNote, setPinNote] = useState<string | null>(null);
  const pinNoteTimer = useRef<number | null>(null);
  const togglePin = (stationId: string) => {
    const result = togglePinnedStation(pinnedIds, stationId);
    setPinnedIds(result.ids);
    if (result.note) {
      setPinNote(result.note);
      if (pinNoteTimer.current) window.clearTimeout(pinNoteTimer.current);
      pinNoteTimer.current = window.setTimeout(() => setPinNote(null), 5000);
    } else {
      setPinNote(null);
    }
  };

  // A1: Profil-Liste holen (langsam pollen; nach jedem Schreibvorgang
  // zählt `refresh` die Liste sofort neu).
  const profilesRes = useResource<Profiles>("/api/v1/profiles", 120000, refresh);
  const [profilesBusy, setProfilesBusy] = useState(false);
  const [profileManagerOpen, setProfileManagerOpen] = useState(false);
  const [profileNote, setProfileNote] = useState<string | null>(null);
  const profileNoteTimer = useRef<number | null>(null);
  const noteProfile = (text: string) => {
    setProfileNote(text);
    if (profileNoteTimer.current) window.clearTimeout(profileNoteTimer.current);
    profileNoteTimer.current = window.setTimeout(() => setProfileNote(null), 6000);
  };

  const activeProfile = useMemo(
    () =>
      profilesRes.data?.profiles.find(
        (profile) => profile.id === activeProfileId,
      ) ?? null,
    [profilesRes.data, activeProfileId],
  );
  // Aktueller Stand der Profil-Felder für Vergleiche ohne Effect-Ketten.
  const prefsRef = useRef({
    fuel,
    liters,
    consumption,
    timeValue,
    speed,
    detourMode,
    tankCapacity,
  });
  prefsRef.current = {
    fuel,
    liters,
    consumption,
    timeValue,
    speed,
    detourMode,
    tankCapacity,
  };
  // Zuletzt angewandter Profilstand (id + updated_at) — verhindert, dass
  // ein Poll dieselben Werte immer wieder in die Felder schreibt, während
  // der Nutzer gerade tippt.
  const lastAppliedRef = useRef<string | null>(null);

  // A1 Sync, Richtung Server → GUI: neues/anderes Profil (oder ein Stand
  // von einem anderen Gerät) überschreibt die Profil-Felder lokal.
  useEffect(() => {
    if (!activeProfile) return;
    const stamp = `${activeProfile.id}:${activeProfile.updated_at ?? ""}`;
    if (lastAppliedRef.current === stamp) return;
    lastAppliedRef.current = stamp;
    const fromProfile: ProfileFields = {
      fuel: activeProfile.fuel,
      liters: activeProfile.liters,
      consumption: activeProfile.consumption,
      time_value_eur_h: activeProfile.time_value_eur_h,
      speed_kmh: activeProfile.speed_kmh,
      detour_mode: activeProfile.detour_mode,
      tank_capacity_l: activeProfile.tank_capacity_l,
    };
    if (!profileFieldsDiffer(profileFields(prefsRef.current), fromProfile)) return;
    setFuel(activeProfile.fuel);
    setLiters(activeProfile.liters);
    setConsumption(activeProfile.consumption);
    setTimeValue(activeProfile.time_value_eur_h);
    setSpeed(activeProfile.speed_kmh);
    setDetourMode(activeProfile.detour_mode);
    setTankCapacity(activeProfile.tank_capacity_l);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile]);

  // A1 Sync, Richtung GUI → Server: ändert der Nutzer ein Profil-Feld,
  // schreibt es (entprellt) in das aktive Profil zurück — solange einer
  // Profileinstellung folgt, gilt sie auf allen Geräten im Haushalt.
  useEffect(() => {
    if (!activeProfile) return;
    const current = profileFields({ fuel, liters, consumption, timeValue, speed, detourMode, tankCapacity });
    const fromProfile: ProfileFields = {
      fuel: activeProfile.fuel,
      liters: activeProfile.liters,
      consumption: activeProfile.consumption,
      time_value_eur_h: activeProfile.time_value_eur_h,
      speed_kmh: activeProfile.speed_kmh,
      detour_mode: activeProfile.detour_mode,
      tank_capacity_l: activeProfile.tank_capacity_l,
    };
    if (!profileFieldsDiffer(current, fromProfile)) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const res = await profileRequest(`/${activeProfile.id}`, "PUT", current);
        if (!res.ok) {
          noteProfile(profileErrorText(res.data?.error_code as string | undefined));
          return;
        }
        setRefresh((value) => value + 1);
      })();
    }, 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fuel, liters, consumption, timeValue, speed, detourMode, tankCapacity, activeProfile]);

  // A1 Handler der Verwaltung: anlegen, aktivieren, umbenennen, löschen.
  const handleCreateProfile = async (name: string) => {
    setProfilesBusy(true);
    try {
      const body = { name, ...profileFields(prefsRef.current) };
      const res = await profileRequest("", "POST", body);
      const created = res.data as { id?: string; error_code?: string } | null;
      if (!res.ok || !created?.id) {
        noteProfile(profileErrorText(created?.error_code));
        return;
      }
      lastAppliedRef.current = null;
      setActiveProfileId(created.id);
      setProfileManagerOpen(false);
      noteProfile(`Profil „${name}“ erstellt und auf diesem Gerät aktiviert.`);
      setRefresh((value) => value + 1);
    } finally {
      setProfilesBusy(false);
    }
  };
  const handleActivateProfile = async (id: string | null) => {
    setProfilesBusy(true);
    try {
      const res = await profileRequest(
        id === null ? "/activate" : `/${id}/activate`,
        "POST",
        { active: id },
      );
      if (!res.ok) {
        noteProfile(profileErrorText(res.data?.error_code as string | undefined));
        return;
      }
      lastAppliedRef.current = null;
      setActiveProfileId(id ?? "");
      noteProfile(
        id === null
          ? "Kein Profil aktiv — Einstellungen gelten nur noch auf diesem Gerät."
          : `Profil „${profilesRes.data?.profiles.find((p) => p.id === id)?.name ?? id}“ aktiv.`,
      );
      setRefresh((value) => value + 1);
    } finally {
      setProfilesBusy(false);
    }
  };
  const handleRenameProfile = async (id: string, name: string) => {
    setProfilesBusy(true);
    try {
      const res = await profileRequest(`/${id}`, "PUT", { name });
      if (!res.ok) {
        noteProfile(profileErrorText(res.data?.error_code as string | undefined));
        return;
      }
      noteProfile("Profilname gespeichert.");
      setRefresh((value) => value + 1);
    } finally {
      setProfilesBusy(false);
    }
  };
  const handleDeleteProfile = async (id: string) => {
    setProfilesBusy(true);
    try {
      const res = await profileRequest(`/${id}`, "DELETE");
      if (!res.ok) {
        noteProfile(profileErrorText(res.data?.error_code as string | undefined));
        return;
      }
      if (activeProfileId === id) {
        lastAppliedRef.current = null;
        setActiveProfileId("");
      }
      noteProfile("Profil gelöscht. War es aktiv, ist jetzt keins aktiv.");
      setRefresh((value) => value + 1);
    } finally {
      setProfilesBusy(false);
    }
  };

  const prices = useResource<Stations>(
    `/api/v1/stations?fuel=${fuel}`,
    30000,
    refresh,
  );
  const health = useResource<Health>("/api/v1/health", healthInterval, refresh);

  // Job-Log: Die Auswahl (Job, Zeilen, Reload) lebt hier, weil der
  // Hinweisblock fehlgeschlagener Jobs in der Root „Log ansehen“ anbietet
  // und dafür in den System-Bereich springt. Das Terminal selbst (Refs,
  // Scrollverhalten, Kommandos) besitzt die System-View (U8).
  const [logJob, setLogJob] = useState("models");
  const [logLineCount, setLogLineCount] = useState(200);
  const [logReload, setLogReload] = useState(0);
  const runningJob =
    Object.entries(health.data?.jobs || {}).find(
      ([, job]) => job?.state === "running",
    )?.[0] ?? null;

  useEffect(() => {
    const running = Object.values(health.data?.jobs || {}).some(
      (job) => job?.state === "running",
    );
    setHealthInterval(running ? 15000 : 60000);
  }, [health.data?.jobs]);

  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 10000);
    return () => clearInterval(timer);
  }, []);

  // O44: Fremde Payloads (Pi-Fallback auf Port 8000, Proxy-Seiten, Fehler-
  // Objekte) sind kein Stations-Payload. Ohne diese Prüfung las die Ansicht
  // `data.cities.includes(...)` auf einem Objekt ohne `cities` und die ganze
  // App blieb weiß (Befund 17.09.2026).
  const data = usableStations(prices.data);
  const isStaleFuel = !!data && data.fuel !== fuel;
  const activeCity = data?.cities.includes(city) ? city : data?.cities[0] || "";
  const stations =
    data?.stations.filter((row) => row.city === activeCity) || [];
  // Während Fuel-Switch E10→Diesel bleibt data stale (fuel mismatch) und
  // pending true — online darf dann nicht als „frisch“ gelten, sonst zeigt
  // der Header alte Counts statt „lädt …“.
  const online = !prices.error && !!data && !data.connection_error && !isStaleFuel;
  const elapsed = Math.max(0, now - prices.receivedAt) / 60000;
  const price = (row: Station) => currentPrice(row, online, elapsed);
  const fresh = isStaleFuel
    ? []
    : stations
        .filter((row) => price(row) !== null)
        .sort((a, b) => price(a)! - price(b)!);
  const best = fresh[0];
  // Vergleichsstation per Default: die nächste mit frischem Preis — nicht die
  // billigste. Die billigste als Default machte „Unterschied zur
  // Vergleichsstation“ zu einer 0,00-€-Kachel ohne Aussage; die nächste Station
  // ist dagegen die, an der man normalerweise vorbeikommt.
  const nearestFresh = [...fresh].sort(
    (a, b) => (a.dist_km ?? 1e9) - (b.dist_km ?? 1e9),
  )[0];
  const selected =
    stations.find((row) => row.station_id === selectedId) ||
    nearestFresh ||
    best ||
    stations[0];
  const bestPrice = best ? price(best) : null;
  const selectedPrice = selected ? price(selected) : null;

  // Schnell-Erfassung: Station per Default = Vergleichsstation, Preis =
  // deren frischer Preis (sonst billigster). Nur solange das Feld leer ist —
  // eine eigene Eingabe wird nie überschrieben.
  const quickStation =
    stations.find((row) => row.station_id === quickStationId) || selected;
  const quickSuggested =
    (quickStation ? price(quickStation) : null) ?? bestPrice;
  useEffect(() => {
    if (!quickStationId && selected) setQuickStationId(selected.station_id);
  }, [quickStationId, selected]);
  useEffect(() => {
    if (
      quickPriceStr === "" &&
      quickSuggested !== null &&
      Number.isFinite(quickSuggested)
    ) {
      setQuickPriceStr(quickSuggested.toFixed(3));
    }
  }, [quickPriceStr, quickSuggested]);
  const quickDraft = checkFillDraft({
    liters: quickLitersStr,
    price: quickPriceStr,
    stationId: quickStation?.station_id,
  });
  const autoZ = autoTimeValue();
  const timeValueUsed = timeValue > 0 ? timeValue : autoZ.z;
  // Teuerste frische Station: Ist die Vergleichsstation selbst die billigste,
  // zeigt die Kachel statt „0,00 €“ die Spanne zur teuersten — eine Zahl mit
  // Aussage statt einer Null ohne.
  const worst = fresh.length ? fresh[fresh.length - 1] : undefined;
  const worstPrice = worst ? price(worst) : null;
  const span =
    bestPrice !== null && worstPrice !== null
      ? (worstPrice - bestPrice) * liters
      : null;
  // GUI-Neuentwurf: frische Set-Preise (für die Einordnung nach dem Buchen
  // und für „Ich → Belege“) + gewählte Stations zuerst in der Beleg-Auswahl
  // (gepinnte Stationen rücken nach vorn — dieselbe Reihenfolge wie Karte).
  const freshPrices = fresh.map((row) => price(row)!).filter(
    (value) => value !== null,
  );
  const pinnedFirstStations = [...stations].sort((a, b) => {
    const aPin = pinnedIds.includes(a.station_id) ? 0 : 1;
    const bPin = pinnedIds.includes(b.station_id) ? 0 : 1;
    if (aPin !== bPin) return aPin - bPin;
    return (a.dist_km ?? 1e9) - (b.dist_km ?? 1e9);
  });
  // A6: aktuelle Sicht als Share-URL — in die Adresszeile (bookmarkbar) und,
  // wenn der Browser es erlaubt (LAN-HTTP ohne Secure Context tut es oft
  // nicht), zusätzlich in die Zwischenablage.
  const copyShareLink = () => {
    const query = shareQuery({
      city: activeCity,
      fuel,
      stationId: selected?.station_id ?? null,
      liters,
      heatmapWeeks,
      heatmapBasis,
      // U4: Der Link teilt die Antwort, nicht nur die Filter — Bereich und
      // (im Labor) der Abschnitt reisen mit.
      tab: tabToUrlId(tab),
      section: tab === "labor" ? laborFocus : null,
    });
    const url = `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ""}`;
    try {
      window.history.replaceState(null, "", url);
    } catch {
      /* History darf scheitern (z. B. Sandbox) — der Hinweistext bleibt korrekt. */
    }
    const note = (text: string) => {
      setShareNote(text);
      if (shareNoteTimer.current) window.clearTimeout(shareNoteTimer.current);
      shareNoteTimer.current = window.setTimeout(
        () => setShareNote(null),
        5000,
      );
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(url)
        .then(() =>
          note(
            "Link kopiert — teilt diese Sicht (Bereich, Stadt, Kraftstoff, Station, Tankmenge, Heatmap-Einstellungen).",
          ),
        )
        .catch(() =>
          note(SHARE_URL_LINE),
        );
    } else {
      note(SHARE_URL_LINE);
    }
  };

  // H1/B6: Server ist einzige Quelle für Umweg-Strecke und Verdict — keine lokale haversine×1,3-Rechnung mehr.
  // Die What-if-Ökonomie (Verbrauch, Tempo, Zeitwert, Modus) läuft über /api/v1/decide, die GUI zeigt exakt die Server-Zahlen.
  const identity = selected
    ? new URLSearchParams({
        city: activeCity,
        station_id: selected.station_id,
        fuel,
      }).toString()
    : "";

  // --- B4 Resources ---
  // H1/B6: alle What-if-Parameter an den Server — Strecke und Verdict kommen ausschließlich vom Server.
  // B7: „Jetzt“ und „Woche“ kommen als EINE Anfrage aus /api/v1/overview
  // (decide + Wallet + Summary + Due-Episoden + Tageskurve) statt sechs
  // Parallel-Polls, die auf der NAS an File-Locks hängen und einen Refresh
  // auf 5–10 s blähen, während die Ansicht tot wirkt.
  // A2: Tankstand an /decide mitgeben — nur mit Füllstand-Angabe; die
  // Tankgröße kommt aus dem Profil (bzw. lokal, solange keins aktiv ist).
  // GUI-Neuentwurf §5.1: die Was-wäre-wenn-Overrides (Liter, latest_by,
  // Zeitwert) gelten nur für die Ansicht — dieselbe Anfrage, andere
  // Parameter; der Server bleibt die einzige Quelle.
  const effLiters = assumptions.liters ?? liters;
  const effTimeValue = assumptions.timeValue ?? timeValue;
  const tankQuery =
    tankPercent !== null
      ? `&tank_percent=${tankPercent}&tank_capacity_l=${tankCapacity}`
      : "";
  const latestByQuery = assumptions.latestBy
    ? `&latest_by=${encodeURIComponent(assumptions.latestBy)}`
    : "";
  const decideQuery = activeCity
    ? `city=${encodeURIComponent(activeCity)}&fuel=${fuel}&liters=${effLiters}&value_of_time=${effTimeValue}${latestByQuery}&consumption=${consumption}&speed_kmh=${speed}&mode=${detourMode}${selected ? `&station_id=${encodeURIComponent(selected.station_id)}` : ""}${tankQuery}`
    : null;
  // „Jetzt“, „Stationen“ und „Woche“ teilen denselben Overview-Poll
  // (decide + Tageskurve + Wallet) — eine Antwort, drei Ansichten.
  const overviewTab = tab === "jetzt" || tab === "stations" || tab === "week";
  const overview = useResource<Overview>(
    overviewTab && decideQuery ? `/api/v1/overview?${decideQuery}` : null,
    30000,
    refresh,
  );
  // Übersicht-Teil mit exakt der Form eines Einzelpolls (data/error/pending),
  // damit die Panels unverändert bleiben können.
  const overviewPart = <T,>(part: T | null | undefined) => ({
    data: part ?? null,
    error: overview.error,
    errorCode: overview.errorCode,
    pending: overview.pending,
    receivedAt: overview.receivedAt,
  });
  const emptyResource = <T,>() => ({
    data: null,
    error: false,
    errorCode: null,
    pending: false,
    receivedAt: 0,
  });
  const decideRes =
    overviewTab
      ? overviewPart<DecideResult>(overview.data?.decide)
      : emptyResource<DecideResult>();

  const statsSummaryPoll = useResource<StatsSummary>(
    // Die Güte-Kacheln im System-Tab, das Labor und die Schwellen-Tabelle
    // in „Ich → Einstellungen“ lesen dieselbe Antwort — in
    // „Jetzt“/„Woche“ steckt sie im Overview-Payload.
    tab === "labor" || tab === "system" || tab === "ich"
      ? `/api/v1/stats/summary?fuel=${fuel}${activeCity ? `&city=${encodeURIComponent(activeCity)}` : ""}`
      : null,
    60000,
    refresh,
  );
  const statsSummaryRes =
    overviewTab
      ? overviewPart<StatsSummary>(overview.data?.stats_summary)
      : statsSummaryPoll;

  const dueEpisodesRes =
    overviewTab
      ? overviewPart<{ count: number; episodes: any[] }>(
          overview.data?.episodes,
        )
      : emptyResource<{ count: number; episodes: any[] }>();

  // A3/A6: Wallet-Verlauf (Liste der Belege) für Storno + Export.
  //
  // Der Verlauf kommt normalerweise als Teil des Overview-Polls. Der läuft
  // aber nur für Jetzt/Stationen/Woche: Ein kalter Aufruf von `/?tab=ich`
  // (geteilter Link, PWA-Start, mobile.spec) hatte deshalb **nie** einen
  // Beleg im Speicher und zeigte „Noch keine Belege“, obwohl der Ledger
  // gefüllt war. Auf „Ich“ holt die Liste sich ihren Stand jetzt selbst —
  // dieselbe Route `GET /api/v1/fills`, dieselbe Form (B7-Muster).
  const walletFills = useResource<Fills>(
    tab === "ich" ? "/api/v1/fills" : null,
    120000,
    refresh,
  );
  const fillsRes =
    tab === "ich"
      ? walletFills
      : overviewTab
        ? overviewPart<Fills>(overview.data?.fills)
        : emptyResource<Fills>();

  const history = useResource<
    { points: Point[]; error_code: string | null } & DataReach
  >(
    tab === "labor" && identity
      ? `/api/v1/series?${identity}&hours=${spanHours}`
      : null,
    60000,
    refresh,
  );
  // GUI-Neuentwurf §5.2: Verlauf der Stationen-View (eigener Poll nur für
  // die gewählte Station — „Verlauf schlägt Moment“). Der Zeitraum ist
  // derselbe Umschalter wie im Stations-Labor (24 h / 3 Tage / 7 Tage).
  const series7d = useResource<
    { points: Point[]; error_code: string | null } | null
  >(
    tab === "stations" && identity
      ? `/api/v1/series?${identity}&hours=${stationsSpanHours}`
      : null,
    60000,
    refresh,
  );
  const dayStrip =
    overviewTab
      ? overviewPart<{ points: Point[]; error_code: string | null }>(
          overview.data?.day,
        )
      : emptyResource<{ points: Point[]; error_code: string | null }>();
  const forecast = useResource<Forecast>(
    tab === "labor" && identity ? `/api/v1/forecast?${identity}` : null,
    300000,
    refresh,
  );
  // E5: weeks kommt aus dem Wochen-Select, B12: basis aus dem Umschalter —
  // beides nur dort, wo es wirkt (basis gilt ausschließlich Cheap-Prob ohne Station).
  const heatmapBasisActive = heatmapKind === "probability" && !selected;
  const heatmap = useResource<Heatmap>(
    tab === "labor" && activeCity
      ? heatmapPath({
          city: activeCity,
          fuel,
          kind: heatmapKind,
          weeks: heatmapWeeks,
          basis: heatmapBasisActive ? heatmapBasis : undefined,
          stationId: selected?.station_id,
        })
      : null,
    120000,
    refresh,
  );
  const selection = useResource<Selection>(
    tab === "labor" || tab === "system"
      ? `/api/v1/selection?fuel=${fuel}${activeCity ? `&city=${encodeURIComponent(activeCity)}` : ""}`
      : null,
    120000,
    refresh,
  );
  // A4: Monats-/Jahresbilanz — die Summen-Kacheln stehen im Alltag, die
  // volle Monats-/Jahres-Sicht in „Ich → Bilanz“. Seit Phase 3 liest nur
  // noch „Ich“ diese Antwort; die alte Werkstatt-Kachel ist entfallen.
  const fillsSummary = useResource<FillsSummary>(
    tab === "ich" ? "/api/v1/fills/summary" : null,
    120000,
    refresh,
  );
  // Labor §6.2 Abschnitt 4: Prognose-Tagebuch — echte Settlements des
  // Advice-Ledgers (`GET /api/v1/advice/diary`), kein Demo, keine Zeile
  // ohne Abrechnung. Nur im Labor gepollt; andere Tabs zahlen nicht.
  const diary = useResource<AdviceDiary>(
    tab === "labor" ? "/api/v1/advice/diary?limit=50" : null,
    120000,
    refresh,
  );
  const collectorStatus = useResource<CollectorStatus>(
    tab === "system" ? "/api/v1/collector/status" : null,
    60000,
    refresh,
  );
  // Job-Log: nur im System-Tab, dichter gepollt, solange ein Job läuft.
  const jobLog = useResource<JobLog>(
    tab === "system"
      ? `/api/v1/jobs/${logJob}/log?lines=${logLineCount}`
      : null,
    runningJob ? 15000 : 120000,
    logReload,
  );
  // GUI-Neuentwurf: der A-gegen-B-Vergleich in „Stationen“ nutzt die
  // decide-Alternativen (inkl. Server-Netto-€) aus dem Overview-Payload —
  // kein eigener route/evaluate-Poll mehr („kein zweiter Poll“).

  // C6: Server-Verbindung. Ein einzelner fehlgeschlagener Poll löst hier
  // nichts mehr aus (useResource debounced) — der Satz benennt den letzten
  // erfolgreichen Stand und die Selbstheilung, ohne Schuld oder Handlungs-
  // befehl (MICROCOPY §5).
  const connectionProblem = prices.error
    ? data?.generated_at
      ? `App-Server unterbrochen — angezeigt bleiben die letzten erfolgreich geladenen Preise vom ${timeLabel(data.generated_at)}. Die Ansicht lädt neu, sobald die Verbindung wiederhergestellt ist.`
      : "App-Server nicht erreichbar — die Ansicht lädt neu, sobald die Verbindung wiederhergestellt ist."
    : problem(data?.connection_error);
  // O44: Antwortet der Pi-Fallback (``rp2/fallback_gui.py``, Port 8000), sind
  // die Preise echt — der Puffer des Pi —, aber alles Modellseitige fehlt: Der
  // Fallback kennt nur health, stations, forecasts, decide, series und
  // nas-check. Ohne diesen Satz sieht die halb gefüllte Oberfläche aus wie ein
  // NAS-Stand; mit ihm steht die Herkunft da und die leeren Bereiche haben
  // eine Erklärung (Befund 17.09.2026).
  const fallbackNotice =
    data?.nas_status === "offline"
      ? "Antwort kommt vom Pi-Fallback: Das NAS ist für den Pi nicht erreichbar. Preise und Stationen sind der Live-Puffer des Pi; Prognosen, Empfehlungen und Belege brauchen das NAS."
      : null;
  // B10: Statuszeile der Offline-Queue — nur wenn wirklich etwas wartet.
  const queueBanner = queueStatusText(
    queue.length,
    queueOldestAgeMs(queue, Date.now()),
  );
  const h = health.error ? null : health.data;
  const collector = collectorStatus.data || h?.collector;
  // Job-Log: neueste Zeile unten, beim Job-Wechsel automatisch ans Ende.
  const logLines = jobLog.data?.lines ?? [];
  // Fehlgeschlagene Jobs mit Ursache — Hinweis über allen Bereichen.
  const failedJobs = Object.entries(h?.jobs || {}).filter(
    ([, job]) => job?.state === "failed",
  );
  // Nach einem Knopf-Start: Health sofort neu laden, nicht erst im Intervall.
  const refreshNow = () => setRefresh((count) => count + 1);
  const showJobLog = (name: string) => {
    setLogJob(name);
    setLogReload((count) => count + 1);
  };
  const horizonDays = horizon;

  const observations = segments(history.data?.points || []);
  // V5 (GUI-TEXT-BEFUND): eine Wortform für 24 h / 3 Tage / 7 Tage — Schalter
  // und Verlaufssätze ziehen `timeSpanLabel` aus data.ts; „(die) letzten“ steht
  // hier im Satz, nicht im Schalter-Label. Die Präferenz erzwingt die drei
  // Werte (Validator oben), der Fallback deckt Altstände ehrlich ab.
  const spanLabel = `letzte ${timeSpanLabel(spanHours as SpanHours)}`;

  // GUI-Neuentwurf: der Tagesstreifen ist jetzt „Heute im Blick“ (Jetzt)
  // und „Der Set-Ton“ (Stationen) — dieselbe pure Funktion (strip.ts),
  // dieselbe Overview-Antwort.
  const stripCells = buildStripCells(dayStrip.data?.points ?? []);

  // Zwei Freigaben, zwei Zeilen — sie haben verschiedene Nenner:
  //   1. M7-Gate (§0.4): Zähl-Gate über abgeschlossene Empfehlungen
  //      (live_advice.min_recommendations, Default 100) plus Brier-Schwelle.
  //   2. Übergangsregel Datenhygiene (Archiv → Live-Polling): bewertete
  //      Live-Tage, Schwelle = live_only_days der Engine (Default 90), aus den
  //      Bootstrap-Policies über stats_summary.live_phase — nicht aus dem
  //      Browserdatum. Fehlen die Policies, sagt die UI das und erfindet
  //      keinen Countdown (§0.4 Ehrlichkeitsregel).
  const livePhase = statsSummaryRes.data?.live_phase ?? null;
  // „Jetzt“ (GUI-Neuentwurf): Frische-Anker ist die jüngste Preismeldung,
  // nicht der Zeitpunkt dieses Renderns — die Fußzeile nennt das Alter der
  // Zahlen. Die Prognose datiert der Modell-Lauf (stats/summary), sonst die
  // Entscheidungsantwort.
  const nowPricesAt = useMemo(() => {
    const stamps = fresh
      .map((row) => (row.observed_at ? Date.parse(row.observed_at) : Number.NaN))
      .filter((ms) => Number.isFinite(ms));
    if (!stamps.length) return data?.generated_at ?? null;
    return new Date(Math.max(...stamps)).toISOString();
  }, [fresh, data?.generated_at]);
  // Die Frische der Prognose kommt aus der Engine-Publikation bzw. dem
  // Fit-Zeitpunkt — nicht aus der Berechnungszeit dieser Antwort (`now.ts`).
  const nowForecastAt = forecastStamp(decideRes.data);
  // GUI-Neuentwurf: die Ziele des Neuentwurfs sind echte Bereiche —
  // „Jetzt“, „Stationen“, „Woche“ (inkl. Tankstand), „Ich“, „Labor“ und
  // „System“. „werkstatt“ bleibt als Alt-Ziel erhalten und landet im Labor.
  const handleNowNavigate = (target: NowTarget | "jetzt" | "werkstatt") => {
    if (target === "jetzt") gotoTab("jetzt");
    else if (target === "stations") gotoTab("stations");
    else if (target === "week" || target === "tank") gotoTab("week");
    else if (target === "ich") gotoTab("ich");
    else if (target === "werkstatt") gotoTab("labor");
    else gotoTab("system");
  };
  // Erklär-Treppe Ebene 1 → 2 (§7): Ebene 2 (Beweis) öffnet den Abschnitt
  // im Labor — der Sprung ist ausdrücklich (das Sheet der Ebene 1 steht am
  // Wirkungsort, U5), und der Rückweg ist das Browser-Zurück (U4).
  const openLabor = (section: LabSectionId) => {
    setLaborFocus(section);
    gotoTab("labor", section);
  };
  const liveAdvice = statsSummaryRes.data?.live_advice ?? null;
  const gateStatus =
    liveAdvice?.gate_status ||
    (statsSummaryRes.data ? "Kalibrierung steht aus" : "kein Engine-Lauf");
  const m7Line = statsSummaryRes.data ? m7GateLine(liveAdvice) : null;
  const transitionLine = transitionRuleLine(livePhase);
  // Hint für leere Güte-Kacheln im System-Tab: erklärt die fehlende
  // Live-Abdeckung, ohne eine Tageszahl zu erfinden.
  const calibrationHint = statsSummaryRes.data
    ? livePhaseHint(livePhase)
    : "Kennzahlen nicht geladen — zur Live-Phase liegen keine Daten vor.";
  const stationPhase = forecast.data?.data_policy;

  // Labor-Backtest: Das eigentliche Modell (Scores, Tagesreihen, Bänder)
  // rechnet die Labor-View selbst (views/laborModel.ts, U8) — hier bleibt
  // nur der Rohstoff.
  const labData = statsSummaryRes.data?.backtest;

  const dueEpisode =
    dueEpisodesRes.data?.episodes?.[0] ||
    (decideRes.data?.episode?.status === "due" ? decideRes.data.episode : null);

  // O17: Der Ein-Tipp-Beleg bucht genau diesen Preis — den frischen
  // Live-Preis der empfohlenen Station. Ohne ihn ist der Knopf aus und die
  // Maske fragt nach (nie der Prognose-Median, nie ein fremder Preis).
  const dueFillStationId =
    dueEpisode?.last_snapshot?.station_id || selected?.station_id || null;
  const dueFillPrice = promptFillPrice(dueFillStationId, stations, price);

  // E2/E3: die Sofort-Validierung des Belegs lebt jetzt in „Ich → Belege“
  // (quickDraft), dieselben Grenzen wie der Server (app/feedback.py).

  // B4: Alarme aus /health für den roten/grünen Punkt im Header.
  const alarms = h?.alarms ?? [];
  const errorAlarms = alarms.filter((a) => a.severity === "error");
  const warnAlarms = alarms.filter((a) => a.severity !== "error");

  // A3: Wallet-Verlauf.
  const fillList = fillsRes.data?.fills ?? [];
  // Stornierte Belege (meist Doppelbuchungen bei langsamer NAS) sind standard-
  // mäßig ausgeblendet; der Toggle macht den Audit-Trail wieder sichtbar.
  const visibleFills = showVoidedFills
    ? fillList
    : fillList.filter((fill) => !fill.voided);
  const voidedCount = fillList.length - visibleFills.length;

  const handleConfirmRecommendedFill = async (ep: any) => {
    if (!ep) return;
    const snap = ep.last_snapshot || decideRes.data?.primary;
    const fillStationId = snap?.station_id || selected?.station_id || null;
    // O17: Gebucht wird ausschließlich der frische Live-Preis der Station —
    // expected_price ist eine Prognose und kein gezahlter Preis. Ohne
    // Live-Preis öffnet sich die Erfassungs-Maske (Station vorausgefüllt),
    // statt still den Median zu buchen.
    const livePrice = promptFillPrice(fillStationId, stations, price);
    if (livePrice === null || !fillStationId) {
      if (fillStationId) setQuickStationId(fillStationId);
      setQuickPriceStr("");
      setIchSection("fills");
      gotoTab("ich");
      feedback("warn", NO_LIVE_PRICE_LINE, 6000);
      return;
    }
    const res = await postFill({
      station_id: fillStationId,
      station_name: snap?.station_name || selected?.name || "Station",
      liters,
      price_paid: livePrice,
      price_source: "live",
      fuel,
      source: "prompt",
      episode_id: ep.id,
    });
    if (res?.queued) {
      setQueue(readQueue());
      feedback("warn", queuedNote("Beleg"), 6000);
      setDueDismissed(true);
      return;
    }
    if (res?.error_code) {
      feedback("error", saveFailedNote(problem(res.error_code) || res.error_code));
      return;
    }
    feedback("ok", FILL_BOOKED_LINE, 4000);
    setDueDismissed(true);
    setRefresh((r) => r + 1);
  };

  const handleQuickFill = async () => {
    if (fillSubmitting) return;
    // Schnell-Erfassung ohne Episode (Quelle „tanke gerade / habe getankt“):
    // dieselben Grenzen wie der Server, Prüfung vor dem Roundtrip.
    const litersVal = germanDecimalToNumber(quickLitersStr);
    const priceVal = germanDecimalToNumber(quickPriceStr);
    const stationId = quickStation?.station_id;
    if (
      !quickDraft.ok ||
      litersVal === null ||
      priceVal === null ||
      !stationId
    ) {
      feedback(
        "error",
        quickDraft.stationMissing
          ? "Ohne Station kein Beleg — bitte zuerst eine Station wählen."
          : quickDraft.litersError ?? quickDraft.priceError ?? "Eingabe prüfen.",
      );
      return;
    }
    setFillSubmitting(true);
    const res = await postFill({
      station_id: stationId,
      station_name: quickStation?.name || "Station",
      liters: litersVal,
      price_paid: priceVal,
      // O17: aus der Maske kommt ein eingetragener Preis — nie live.
      price_source: "manuell",
      fuel,
      source: "manual",
    });
    setFillSubmitting(false);
    if (res?.queued) {
      setQueue(readQueue());
      feedback("warn", queuedNote("Beleg"), 6000);
      return;
    }
    if (res?.error_code) {
      feedback("error", saveFailedNote(problem(res.error_code) || res.error_code));
      return;
    }
    // GUI-Neuentwurf: Einordnung des gerade gebuchten Preises gegen den
    // frischen Set-Median (pure Funktion in Ich.tsx) — ehrlich, nur wenn
    // mindestens zwei frische Messungen vorliegen, sonst nur der Satz.
    const positionNote = fillPositionNote(priceVal, freshPrices);
    feedback(
      "ok",
      positionNote ? `${FILL_BOOKED_LINE} ${positionNote}` : FILL_BOOKED_LINE,
      6000,
    );
    setRefresh((r) => r + 1);
  };

  const handleVoidFill = async (fillId: string) => {
    if (voidBusy) return;
    setVoidBusy(true);
    setVoidNote(null);
    const res = await voidFill(fillId);
    setVoidBusy(false);
    if (res?.error_code) {
      setVoidNote(
        `Storno fehlgeschlagen: ${problem(res.error_code) || res.error_code}`,
      );
      return;
    }
    setVoidNote(
      `Beleg ${fillId} storniert — zählt nicht mehr in deiner Bilanz.`,
    );
    setRefresh((r) => r + 1);
  };

  const handleDismissDue = async (epId?: string) => {
    if (epId) {
      const res = await postIntent(epId, "dismiss");
      if (res?.error_code) {
        feedback(
          "error",
          `Verwerfen fehlgeschlagen: ${problem(res.error_code) || res.error_code}`,
        );
        return;
      }
    }
    setDueDismissed(true);
    setRefresh((r) => r + 1);
  };

  const handleIntent = async (intent: string, mapsUrl?: string | null) => {
    const epId = decideRes.data?.episode?.id;
    if (epId) {
      const res = await postIntent(epId, intent);
      if (res?.queued) {
        setQueue(readQueue());
        if (mapsUrl) window.open(mapsUrl, "_blank", "noopener,noreferrer");
        feedback("warn", queuedNote("Auswahl"), 6000);
        return;
      }
      if (res?.error_code) {
        feedback(
          "error",
          `Auswahl speichern fehlgeschlagen: ${problem(res.error_code) || res.error_code} — App-Server erreichbar?`,
        );
        return;
      }
    }
    if (mapsUrl) window.open(mapsUrl, "_blank", "noopener,noreferrer");
    feedback("ok", "Auswahl gespeichert.", 4000);
    setRefresh((r) => r + 1);
  };

  return {
    // Navigation & Routing
    tab,
    gotoTab,
    laborFocus,
    setLaborFocus,
    openLabor,
    handleNowNavigate,
    ichSection,
    setIchSection,
    searchFocusSignal,
    // Share
    shareNote,
    copyShareLink,
    // Präferenzen & Auswahlen
    fuel,
    setFuel,
    city,
    setCity,
    selectedId,
    setSelectedId,
    liters,
    setLiters,
    consumption,
    setConsumption,
    timeValue,
    setTimeValue,
    detourMode,
    setDetourMode,
    speed,
    setSpeed,
    spanHours,
    setSpanHours,
    stationsSpanHours,
    setStationsSpanHours,
    horizon,
    setHorizon,
    horizonDays,
    theme,
    setTheme,
    heatmapKind,
    setHeatmapKind,
    heatmapWeeks,
    setHeatmapWeeks,
    heatmapBasis,
    setHeatmapBasis,
    heatmapBasisActive,
    tankCapacity,
    setTankCapacity,
    tankPercent,
    setTankPercent,
    pinnedIds,
    togglePin,
    pinNote,
    assumptions,
    setAssumptions,
    dueDismissed,
    setDueDismissed,
    // Preise & Auswahl
    prices,
    data,
    isStaleFuel,
    activeCity,
    stations,
    online,
    elapsed,
    price,
    fresh,
    best,
    selected,
    bestPrice,
    selectedPrice,
    worst,
    span,
    freshPrices,
    pinnedFirstStations,
    // Gesundheit & Jobs
    health,
    h,
    alarms,
    errorAlarms,
    warnAlarms,
    failedJobs,
    refresh,
    setRefresh,
    refreshNow,
    browserOnline,
    connectionProblem,
    fallbackNotice,
    // Offline-Queue
    queue,
    queueNote,
    queueBanner,
    // Feedback
    actionFeedback,
    feedback,
    // Profile
    activeProfileId,
    setActiveProfileId,
    activeProfile,
    profilesRes,
    profilesBusy,
    profileManagerOpen,
    setProfileManagerOpen,
    profileNote,
    handleCreateProfile,
    handleActivateProfile,
    handleRenameProfile,
    handleDeleteProfile,
    // Ressourcen
    overview,
    decideRes,
    statsSummaryRes,
    fillsRes,
    history,
    series7d,
    dayStrip,
    forecast,
    heatmap,
    selection,
    fillsSummary,
    diary,
    collector,
    // Abgeleitete Antworten
    identity,
    effLiters,
    effTimeValue,
    timeValueUsed,
    autoZ,
    stripCells,
    nowPricesAt,
    nowForecastAt,
    observations,
    spanLabel,
    gateStatus,
    m7Line,
    transitionLine,
    calibrationHint,
    liveAdvice,
    stationPhase,
    labData,
    // Belege & Due-Prompt
    quickStationId,
    setQuickStationId,
    quickLitersStr,
    setQuickLitersStr,
    quickPriceStr,
    setQuickPriceStr,
    quickDraft,
    fillSubmitting,
    showVoidedFills,
    setShowVoidedFills,
    voidNote,
    voidBusy,
    fillList,
    visibleFills,
    voidedCount,
    dueEpisode,
    dueFillPrice,
    handleConfirmRecommendedFill,
    handleQuickFill,
    handleVoidFill,
    handleDismissDue,
    handleIntent,
    // Job-Log (Auswahl; das Terminal besitzt die System-View)
    logJob,
    setLogJob,
    logLineCount,
    setLogLineCount,
    setLogReload,
    jobLog,
    logLines,
    showJobLog,
  };
}

export type OverviewState = ReturnType<typeof useOverviewState>;

const OverviewContext = createContext<OverviewState | null>(null);

/**
 * U8: Provider der geteilten Daten. Ohne `value` rechnet er den vollen
 * App-Zustand aus; Tests injizieren einen fertigen Zustand über `value`
 * (dann läuft kein einziger Hook der Live-Variante).
 */
export function OverviewProvider(props: {
  value?: OverviewState;
  children: ReactNode;
}) {
  if (props.value) {
    return (
      <OverviewContext.Provider value={props.value}>
        {props.children}
      </OverviewContext.Provider>
    );
  }
  return <LiveOverviewProvider>{props.children}</LiveOverviewProvider>;
}

function LiveOverviewProvider({ children }: { children: ReactNode }) {
  const state = useOverviewState();
  return (
    <OverviewContext.Provider value={state}>{children}</OverviewContext.Provider>
  );
}

export function useOverview(): OverviewState {
  const value = useContext(OverviewContext);
  if (!value) {
    throw new Error("useOverview muss innerhalb von <OverviewProvider> laufen");
  }
  return value;
}
