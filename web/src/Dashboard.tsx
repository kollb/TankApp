// Layout/visual foundation: sample/good gui/TankAppDashboard + DecisionCockpit.
// Workshop composition and charts: sample/good statistic gui/DecisionLab.
// No demo engine, seeds, simulated decisions or PostgreSQL are imported.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Fuel as FuelIcon,
  Car,
  SquarePen,
  Compass,
  LineChart as ChartIcon,
  Server,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  MapPin,
  Wifi,
  WifiOff,
  Share2,
  CheckCircle2,
} from "lucide-react";
// D1: ausgelagerte Bausteine — Slider, Heatmap und API-Explorer leben
// jetzt in components/; Dashboard bleibt die Zusammensetzung der Ansichten.
import { ApiExplorer } from "./components/ApiExplorer";
import { HeatmapGrid } from "./components/HeatmapGrid";
import { LoadError } from "./components/LoadError";
// A1: Fahrzeug-/Haushaltsprofile — Verwaltungsdialog + Umschalter im Header.
import { ProfileManager } from "./components/ProfileManager";
// C6 (Rest): Skeletons, Datenstand-Banner und Fehler in Tabellenzellen.
import { CellError } from "./components/CellError";
import { DataAgeBanner } from "./components/DataAge";
import { DataReachNote } from "./components/DataReach";
import {
  SkeletonChart,
  SkeletonPanel,
  SkeletonRows,
} from "./components/Skeleton";
// D1: geteilte UI-Bausteine (Panel-Klasse, Empty, Badge, Metric).
import { Badge, Empty, Metric, panel } from "./components/ui";
import { PrecisionSlider } from "./components/PrecisionSlider";
import { LineChart } from "./components/LineChart";
import {
  LabLineChart,
  HistogramBars,
  DeltaBars,
  CalibChart,
} from "./components/LabCharts";
import {
  autoTimeTicks,
  autoTimeValue,
  berlinHour,
  centPerLiter,
  checkFillDraft,
  clockLabel,
  commaToDot,
  currentPrice,
  deNumber,
  deTrimmed,
  detourVerdict,
  epochLabel,
  euro,
  euroPerLiter,
  fillLimitHint,
  formatHour,
  germanDecimalToNumber,
  heatmapPath,
  HEATMAP_DEFAULT_BASIS,
  HEATMAP_DEFAULT_WEEKS,
  HEATMAP_WEEKS,
  isHeatmapBasis,
  isHeatmapWeeks,
  PINNED_MAX,
  profileFields,
  profileFieldsDiffer,
  profileErrorText,
  profileRequest,
  readShareParams,
  shareQuery,
  livePhaseHint,
  M7_BRIER_THRESHOLD,
  M7_MIN_RECOMMENDATIONS,
  m7GateLine,
  percentLabel,
  notifyLastLine,
  notifyStatusLine,
  notifyTone,
  problem,
  segments,
  sliderCommit,
  timeLabel,
  togglePinnedStation,
  transitionRuleLine,
  triggerSkipLabel,
  useResource,
  usePreference,
  postIntent,
  postJobRun,
  jobRunMessage,
  postFill,
  voidFill,
  rowOutcome,
  scoreRows,
  type DetourMode,
  type Fill,
  type Fills,
  type FillsSummary,
  type Fuel,
  type HeatmapBasis,
  type ProfileFields,
  type Profiles,
  type Station,
  type Stations,
  type Health,
  type Forecast,
  type Point,
  type Job,
  type Heatmap,
  type Selection,
  type DataReach,
  type RouteEvaluate,
  type CollectorStatus,
  type DecideResult,
  type StatsSummary,
  type JobLog,
  type JobRunNote,
  type Overview,
  JOB_LABELS,
} from "./data";
// D1: Views-Schnitt — die drei Tabs sind eigene Dateien; der gemeinsame
// Zustand bleibt hier und wandert per typisierten Props in die Views.
// (JobCard ist ein Baustein des System-Views, vgl. views/System.tsx)
import { DailyView } from "./views/Daily";
import { StatisticsView } from "./views/Statistics";
import { SystemView } from "./views/System";
export function Dashboard() {
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
  const [tab, setTab] = useState<"daily" | "statistics" | "system">("daily");
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
  const [horizon, setHorizon] = usePreference(
    "horizon",
    0,
    (value) => value === 0 || value === 3 || value === 7,
  );
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
  // B4 Workshop State: ε Handlungsschwelle Slider
  const [eps, setEps] = useState(1.0);
  const [labDayIdx, setLabDayIdx] = useState(13);

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
  const [customFillOpen, setCustomFillOpen] = useState(false);
  // Eine langsame NAS machte die Buchungs-Buttons mehrere Sekunden
  // unresponsiv — wiederholtes Klicken buchte doppelte Belege. Solange eine
  // Anfrage läuft: Buttons gesperrt, Label „Wird verbucht …“.
  const [fillSubmitting, setFillSubmitting] = useState(false);
  const [voidBusy, setVoidBusy] = useState(false);
  // Stornierte Belege bleiben im Ledger (CSV, Audit), sind in der Tabelle
  // aber standardmäßig ausgeblendet — der Doppelklick-Ursprung.
  const [showVoidedFills, setShowVoidedFills] = useState(false);
  // E2: Werte als String halten — deutsche Mobil-Tastaturen liefern „1,689“,
  // Number("1,689") wäre NaN. Normalisierung erfolgt beim Parsen (data.ts).
  const [customLitersStr, setCustomLitersStr] = useState("40");
  // Fix: kein erfundener Default-Preis (vorher 1.689) – leer bedeutet "bitte
  // eingeben", wird mit bestPrice vorbefüllt, sobald der bekannt ist.
  const [customPriceStr, setCustomPriceStr] = useState("");
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  // A3: Rückmeldung beim Stornieren eines Belegs (lokal im Verlauf).
  const [voidNote, setVoidNote] = useState<string | null>(null);

  const [routeAltId, setRouteAltId] = useState("");
  // A6: Rückmeldung des „Ansicht teilen“-Knopfs (Kopfzeile).
  const [shareNote, setShareNote] = useState<string | null>(null);
  const shareNoteTimer = useRef<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(performance.now());
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

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
  // jeder Füllung). null = keine Angabe, dann sagt die App nichts zum Tank.
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

  // Job-Log im System-Tab: welcher Job, wie viele Zeilen, wann neu laden.
  const [logJob, setLogJob] = useState("models");
  const [logLineCount, setLogLineCount] = useState(200);
  const [logReload, setLogReload] = useState(0);
  const logRef = useRef<HTMLElement | null>(null);
  const logBodyRef = useRef<HTMLPreElement | null>(null);
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

  const data = prices.data;
  const activeCity = data?.cities.includes(city) ? city : data?.cities[0] || "";
  const stations =
    data?.stations.filter((row) => row.city === activeCity) || [];
  const online = !prices.error && !!data && !data.connection_error;
  const elapsed = Math.max(0, now - prices.receivedAt) / 60000;
  const price = (row: Station) => currentPrice(row, online, elapsed);
  const fresh = stations
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

  // Wenn bester Live-Preis bekannt wird und noch kein Custom-Preis eingegeben
  // wurde, vorbelegen (kein erfundener Fallback, nur echter bekannter Preis).
  // C9: hier bewusst Punkt statt Komma — das Eingabefeld normalisiert jede
  // Eingabe mit `commaToDot`, Vorbelegung und Getipptes müssen gleich aussehen.
  useEffect(() => {
    if (
      bestPrice !== null &&
      Number.isFinite(bestPrice) &&
      customPriceStr === ""
    ) {
      setCustomPriceStr(bestPrice.toFixed(3));
    }
  }, [bestPrice, customPriceStr]);
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
  const difference =
    bestPrice !== null && selectedPrice !== null
      ? (selectedPrice - bestPrice) * liters
      : null;
  // Teuerste frische Station: Ist die Vergleichsstation selbst die billigste,
  // zeigt die Kachel statt „0,00 €“ die Spanne zur teuersten — eine Zahl mit
  // Aussage statt einer Null ohne.
  const worst = fresh.length ? fresh[fresh.length - 1] : undefined;
  const worstPrice = worst ? price(worst) : null;
  const span =
    bestPrice !== null && worstPrice !== null
      ? (worstPrice - bestPrice) * liters
      : null;
  const selectedIsCheapest =
    difference !== null && Math.abs(difference) < 0.005;
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
            "Link kopiert — teilt diese Sicht (Stadt, Kraftstoff, Station, Tankmenge, Heatmap-Einstellungen).",
          ),
        )
        .catch(() =>
          note("URL steht jetzt in der Adresszeile — zum Teilen kopieren."),
        );
    } else {
      note("URL steht jetzt in der Adresszeile — zum Teilen kopieren.");
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
  // B7: Der Alltagstab kommt als EINE Anfrage aus /api/v1/overview
  // (decide + Wallet + Summary + Due-Episoden + Tageskurve) statt sechs
  // Parallel-Polls, die auf der NAS an File-Locks hängen und einen Refresh
  // auf 5–10 s blähen, während die Ansicht tot wirkt.
  // A2: Tankstand an /decide mitgeben — nur mit Füllstand-Angabe; die
  // Tankgröße kommt aus dem Profil (bzw. lokal, solange keins aktiv ist).
  const tankQuery =
    tankPercent !== null
      ? `&tank_percent=${tankPercent}&tank_capacity_l=${tankCapacity}`
      : "";
  const decideQuery = activeCity
    ? `city=${encodeURIComponent(activeCity)}&fuel=${fuel}&liters=${liters}&value_of_time=${timeValue}&consumption=${consumption}&speed_kmh=${speed}&mode=${detourMode}${selected ? `&station_id=${encodeURIComponent(selected.station_id)}` : ""}${tankQuery}`
    : null;
  const overview = useResource<Overview>(
    tab === "daily" && decideQuery ? `/api/v1/overview?${decideQuery}` : null,
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
    tab === "daily"
      ? overviewPart<DecideResult>(overview.data?.decide)
      : emptyResource<DecideResult>();

  const statsSummaryPoll = useResource<StatsSummary>(
    // Die Güte-Kacheln im System-Tab und das Labor in der Werkstatt lesen
    // dieselbe Antwort — im Alltagstabs steckt sie im Overview-Payload.
    tab === "statistics" || tab === "system"
      ? `/api/v1/stats/summary?fuel=${fuel}${activeCity ? `&city=${encodeURIComponent(activeCity)}` : ""}`
      : null,
    60000,
    refresh,
  );
  const statsSummaryRes =
    tab === "daily"
      ? overviewPart<StatsSummary>(overview.data?.stats_summary)
      : statsSummaryPoll;

  const dueEpisodesRes =
    tab === "daily"
      ? overviewPart<{ count: number; episodes: any[] }>(
          overview.data?.episodes,
        )
      : emptyResource<{ count: number; episodes: any[] }>();

  // A3/A6: Wallet-Verlauf (Liste der Belege) für Storno + Export.
  const fillsRes =
    tab === "daily"
      ? overviewPart<Fills>(overview.data?.fills)
      : emptyResource<Fills>();

  const history = useResource<
    { points: Point[]; error_code: string | null } & DataReach
  >(
    tab === "statistics" && identity
      ? `/api/v1/series?${identity}&hours=${spanHours}`
      : null,
    60000,
    refresh,
  );
  const dayStrip =
    tab === "daily"
      ? overviewPart<{ points: Point[]; error_code: string | null }>(
          overview.data?.day,
        )
      : emptyResource<{ points: Point[]; error_code: string | null }>();
  const forecast = useResource<Forecast>(
    tab === "statistics" && identity ? `/api/v1/forecast?${identity}` : null,
    300000,
    refresh,
  );
  // E5: weeks kommt aus dem Wochen-Select, B12: basis aus dem Umschalter —
  // beides nur dort, wo es wirkt (basis gilt ausschließlich Cheap-Prob ohne Station).
  const heatmapBasisActive = heatmapKind === "probability" && !selected;
  const heatmap = useResource<Heatmap>(
    tab === "statistics" && activeCity
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
    tab === "statistics" || tab === "system"
      ? `/api/v1/selection?fuel=${fuel}${activeCity ? `&city=${encodeURIComponent(activeCity)}` : ""}`
      : null,
    120000,
    refresh,
  );
  // A4: Monats-/Jahresbilanz — nur im Werkstatt-Tab (der Alltag zeigt
  // weiter die Summen-Kacheln aus stats_summary).
  const fillsSummary = useResource<FillsSummary>(
    tab === "statistics" ? "/api/v1/fills/summary" : null,
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
  const routeEval = useResource<RouteEvaluate>(
    tab === "daily" &&
      activeCity &&
      (routeAltId || decideRes.data?.alternatives_nearby?.[0]?.station_id)
      ? `/api/v1/route/evaluate?city=${encodeURIComponent(activeCity)}&fuel=${fuel}&station_id=${encodeURIComponent(routeAltId || decideRes.data?.alternatives_nearby?.[0]?.station_id || "")}&ref_station_id=${encodeURIComponent(selected?.station_id || "")}&liters=${liters}&consumption=${consumption}&speed=${speed}&value_of_time=${timeValue}&when=${encodeURIComponent(new Date().toISOString())}&mode=${detourMode}`
      : null,
    30000,
    refresh,
  );

  // C6: Server-Verbindung. Ein einzelner fehlgeschlagener Poll löst hier
  // nichts mehr aus (useResource debounced) — der Satz benennt den letzten
  // erfolgreichen Stand und die Selbstheilung, ohne Schuld oder Handlungs-
  // befehl (MICROCOPY §5).
  const connectionProblem = prices.error
    ? data?.generated_at
      ? `App-Server unterbrochen — angezeigt bleiben die letzten erfolgreich geladenen Preise vom ${timeLabel(data.generated_at)}. Die Ansicht lädt neu, sobald die Verbindung wiederhergestellt ist.`
      : "App-Server nicht erreichbar — die Ansicht lädt neu, sobald die Verbindung wiederhergestellt ist."
    : problem(data?.connection_error);
  const h = health.error ? null : health.data;
  const collector = collectorStatus.data || h?.collector;
  // Job-Log: neueste Zeile unten, beim Job-Wechsel automatisch ans Ende.
  const logLines = jobLog.data?.lines ?? [];
  // Fehlgeschlagene Jobs mit Ursache — Hinweis über allen Tabs (Alltag/Statistik).
  const failedJobs = Object.entries(h?.jobs || {}).filter(
    ([, job]) => job?.state === "failed",
  );
  const webhookCapable = logJob === "models" || logJob === "selection";
  const triggerCommand = `curl -X POST http://<nas>:1355/api/v1/jobs/trigger -H "Authorization: Bearer $TANKAPP_WEBHOOK_TOKEN" -H 'Content-Type: application/json' -d '{"job":"${logJob}"}'`;
  const workerCommand = `docker exec tankapp-app python3 -m app.worker ${logJob}`;
  // Nach einem Knopf-Start: Health sofort neu laden, nicht erst im Intervall.
  const refreshNow = () => setRefresh((count) => count + 1);
  const showJobLog = (name: string) => {
    setLogJob(name);
    setLogReload((count) => count + 1);
    requestAnimationFrame(() =>
      logRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };
  useEffect(() => {
    const box = logBodyRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [logLines.length, logJob]);
  const f = forecast.data;
  const horizonDays = horizon;
  const forecastPoints =
    (horizonDays === 3
      ? f?.points_3d
      : horizonDays === 7
        ? f?.points_7d
        : f?.points) || [];
  const metrics = f?.metrics;

  const obsPoints = history.data?.points || [];
  const obsWindow: [number, number] = [now - spanHours * 3600000, now];
  const observations = segments(obsPoints);
  const series = observations.map((s) => ({
    ...s,
    pts: s.pts.filter((p) => p.x >= obsWindow[0] && p.x <= obsWindow[1]),
  }));
  const spanLabel =
    spanHours === 24
      ? "letzte 24 Stunden"
      : spanHours === 72
        ? "letzte 3 Tage"
        : "letzte 7 Tage";

  const modelPoints = forecastPoints.map((p) => ({
    x: Date.parse(p.timestamp),
    y: p.q50,
  }));
  const modelSeries = modelPoints.length
    ? [
        {
          name: "Modell-Median (q50)",
          color: "#38bdf8",
          pts: modelPoints.filter(
            (p): p is { x: number; y: number } =>
              p.y !== null && Number.isFinite(p.y),
          ),
        },
      ]
    : [];
  const fanBand95 = forecastPoints.length
    ? [
        {
          name: "95-%-Band (q025–q975)",
          color: "rgba(56, 189, 248, 0.12)",
          pts: forecastPoints
            .filter((p) => p.q025 !== null && p.q975 !== null)
            .map((p) => ({
              x: Date.parse(p.timestamp),
              yLow: p.q025!,
              yHigh: p.q975!,
            })),
        },
      ]
    : [];
  const fanBand80 = forecastPoints.length
    ? [
        {
          name: "80-%-Band (q10–q90)",
          color: "rgba(56, 189, 248, 0.22)",
          pts: forecastPoints
            .filter(
              (p) =>
                p.q10 !== undefined &&
                p.q10 !== null &&
                p.q90 !== undefined &&
                p.q90 !== null,
            )
            .map((p) => ({
              x: Date.parse(p.timestamp),
              yLow: p.q10!,
              yHigh: p.q90!,
            })),
        },
      ]
    : [];

  const forecastWindow: [number, number] | null = modelPoints.length
    ? [modelPoints[0].x, modelPoints[modelPoints.length - 1].x]
    : null;

  const forecastMarks = modelPoints.length
    ? [
        {
          x: modelPoints[0].x,
          color: "#38bdf8",
          label: "Fit-Zeitpunkt",
        },
      ]
    : [];

  const modelWindows = (() => {
    if (!modelPoints.length) return [];
    const blocks: { start: number; end: number; values: number[] }[] = [];
    const twoHours = 2 * 3600000;
    for (const m of modelPoints) {
      if (m.y === null || !Number.isFinite(m.y)) continue;
      const bucket = Math.floor(m.x / twoHours) * twoHours;
      let block = blocks.find((b) => b.start === bucket);
      if (!block) {
        block = { start: bucket, end: bucket + twoHours, values: [] };
        blocks.push(block);
      }
      block.values.push(m.y);
    }
    return blocks
      .filter((b) => b.values.length >= 4)
      .map((b) => ({
        start: b.start,
        end: b.end,
        median: b.values.sort((a, c) => a - c)[Math.floor(b.values.length / 2)],
      }))
      .sort((a, b) => a.median - b.median)
      .slice(0, 3);
  })();

  const stripCells = (() => {
    const points =
      tab === "daily" && !dayStrip.error && !dayStrip.data?.error_code
        ? dayStrip.data?.points || []
        : [];
    const byHour = new Map<number, number>();
    for (const p of points) {
      const ms = Date.parse(p.timestamp);
      if (
        p.status !== "open" ||
        p.price === null ||
        !Number.isFinite(p.price) ||
        !Number.isFinite(ms)
      )
        continue;
      const hour = Math.floor(berlinHour(new Date(ms)));
      if (hour >= 6 && hour <= 24) byHour.set(hour, p.price);
    }
    const values = [...byHour.values()];
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    const span = max - min || 1;
    const nowHour = Math.floor(berlinHour());
    return Array.from({ length: 18 }, (_, i) => {
      const hour = 6 + i;
      const value = byHour.get(hour);
      return {
        hour,
        value: value ?? null,
        tone:
          value === undefined
            ? "empty"
            : value <= min + span / 3
              ? "cheap"
              : value >= max - span / 3
                ? "pricey"
                : "mid",
        current: hour === nowHour,
      };
    });
  })();

  // Zwei Freigaben, zwei Zeilen — sie haben verschiedene Nenner:
  //   1. M7-Gate (§0.4): Zähl-Gate über abgeschlossene Empfehlungen
  //      (live_advice.min_recommendations, Default 100) plus Brier-Schwelle.
  //   2. Übergangsregel Datenhygiene (Archiv → Live-Polling): bewertete
  //      Live-Tage, Schwelle = live_only_days der Engine (Default 90), aus den
  //      Bootstrap-Policies über stats_summary.live_phase — nicht aus dem
  //      Browserdatum. Fehlen die Policies, sagt die UI das und erfindet
  //      keinen Countdown (§0.4 Ehrlichkeitsregel).
  const livePhase = statsSummaryRes.data?.live_phase ?? null;
  const liveAdvice = statsSummaryRes.data?.live_advice ?? null;
  const gateStatus =
    liveAdvice?.gate_status ||
    (statsSummaryRes.data ? "Kalibrierung steht aus" : "kein Statistik-Lauf");
  const m7Line = statsSummaryRes.data ? m7GateLine(liveAdvice) : null;
  const transitionLine = transitionRuleLine(livePhase);
  // Hint für leere Güte-Kacheln im System-Tab: erklärt die fehlende
  // Live-Abdeckung, ohne eine Tageszahl zu erfinden.
  const calibrationHint = statsSummaryRes.data
    ? livePhaseHint(livePhase)
    : "Statistik nicht geladen — zur Live-Phase liegen keine Daten vor.";
  const stationPhase = f?.data_policy;

  // --- B4 Workshop Dynamic Calculations ---
  const labData = statsSummaryRes.data?.backtest;
  // Schicht-A-Anker aus dem Backtest-Report (TANKAPP_DECISION_HOUR, Default
  // 12) — alle Werkstatt-Texte folgen dem echten Wert, nie einem Hardcode.
  const anchorHour = labData?.decisionHour ?? 12;
  const anchorLabel = `${String(anchorHour).padStart(2, "0")}:00`;
  const labScores = useMemo(() => {
    if (!labData?.evalRows) return [];
    return Object.entries(labData.evalRows).map(([sid, rows]) => ({
      station_id: sid,
      score: scoreRows(rows, eps, liters, sid),
    }));
  }, [labData, eps, liters]);

  const labTotals = useMemo(() => {
    let smart = 0,
      commit = 0,
      bestVal = 0,
      always = 0,
      regretEur = 0,
      n = 0,
      sPos = 0,
      pSum = 0;
    for (const { score: sc } of labScores) {
      smart += sc.sum_smart_eur;
      commit += sc.sum_commit_eur;
      bestVal += sc.sum_best_eur;
      always += sc.sum_always_eur;
      regretEur += sc.avg_regret_eur * sc.n;
      n += sc.n;
      sPos += sc.n * sc.hit_freq;
      pSum += sc.p_avg * sc.n;
    }
    return {
      smart,
      commit,
      best: bestVal,
      always,
      regretEur: n ? regretEur / n : 0,
      n,
      hitFreq: n ? sPos / n : 0,
      pAvg: n ? pSum / n : 0,
      potShare: bestVal > 0 ? smart / bestVal : 0,
    };
  }, [labScores]);

  const calibPoints = labData?.calibration || [];
  const liveReliability = statsSummaryRes.data?.live_advice?.reliability || [];
  const livePointsForChart = liveReliability
    .filter((b) => b.empirical_hit_rate !== null && b.count > 0)
    .map((b) => ({
      p: b.mean_p,
      hit: b.empirical_hit_rate!,
      n: b.count,
    }));

  const calibErr = useMemo(() => {
    if (!calibPoints.length) return NaN;
    return (
      calibPoints.reduce((a, c) => a + Math.abs(c.hit - c.p), 0) /
      calibPoints.length
    );
  }, [calibPoints]);

  const labStationId = selected?.station_id || labData?.stations[0]?.id || "";
  const labRows = labData?.evalRows[labStationId] || [];
  const labModel = labData?.models[labStationId];
  const activeLabDayRow =
    labRows[Math.min(Math.max(labDayIdx, 0), Math.max(0, labRows.length - 1))];
  const activeLabOutcome = activeLabDayRow
    ? rowOutcome(activeLabDayRow, eps, liters)
    : null;

  const labDayClass = activeLabDayRow?.cls ?? 0;
  const labSaves = labModel
    ? labDayClass === 0
      ? labModel.savesWk
      : labModel.savesWe
    : [];
  const labPredHour = labModel
    ? labDayClass === 0
      ? labModel.predWk
      : labModel.predWe
    : 19;
  const labMu = labModel
    ? labDayClass === 0
      ? labModel.muWk
      : labModel.muWe
    : 1.5;

  // Paarvergleich-Werkstattpanel (Konzept §8.2 Nr. 5): bewusst nicht gebaut —
  // die Umweg-Ökonomie läuft im Alltags-Panel „Rechnet sich der Umweg?“ und
  // serverseitig in /api/v1/route/evaluate (LUECKEN „bewusst offen“). Ein
  // zweites Panel wäre Duplikat; der frühere Prototyp-Code mit erfundenen
  // Preisen (1,70/1,66 €/L) ist entfernt.

  const dueEpisode =
    dueEpisodesRes.data?.episodes?.[0] ||
    (decideRes.data?.episode?.status === "due" ? decideRes.data.episode : null);

  // E2/E3: Sofort-Validierung des Beleg-Dialogs — dieselben Grenzen wie der
  // Server (app/feedback.py), Komma normalisiert, Prüfung vor dem Roundtrip.
  // E4: ohne gewählte Station ist der Beleg nicht buchbar (der Server würde
  // mit unknown_station ablehnen, ohne dass der Nutzer selbst helfen kann).
  const fillDraft = checkFillDraft({
    liters: customLitersStr,
    price: customPriceStr,
    stationId: selected?.station_id,
  });
  const litersError = fillDraft.litersError;
  const priceError = fillDraft.priceError;
  const stationMissing = fillDraft.stationMissing;

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
    const targetPrice =
      snap?.expected_price ?? snap?.price_now ?? bestPrice ?? null;
    if (targetPrice == null || !Number.isFinite(targetPrice)) {
      setActionFeedback("! Kein Preis bekannt — bitte manuell erfassen.");
      setTimeout(() => setActionFeedback(null), 4000);
      return;
    }
    const fillStationId = snap?.station_id || selected?.station_id || null;
    if (!fillStationId) {
      setActionFeedback("! Keine Station bekannt — bitte manuell erfassen.");
      setTimeout(() => setActionFeedback(null), 4000);
      return;
    }
    const res = await postFill({
      station_id: fillStationId,
      station_name: snap?.station_name || selected?.name || "Station",
      liters,
      price_paid: targetPrice,
      fuel,
      source: "prompt",
      episode_id: ep.id,
    });
    if (res?.error_code) {
      setActionFeedback(
        `! Speichern fehlgeschlagen: ${problem(res.error_code) || res.error_code} – bitte erneut versuchen.`,
      );
      setTimeout(() => setActionFeedback(null), 5000);
      return;
    }
    setActionFeedback("✓ Füllung in deiner Tank-Bilanz verbucht!");
    setDueDismissed(true);
    setRefresh((r) => r + 1);
    setTimeout(() => setActionFeedback(null), 4000);
  };

  const handleCustomFill = async (ep: any) => {
    if (fillSubmitting) return;
    // E3: Vorprüfung mit denselben Grenzen wie der Server — 101 L oder 9,99 €/L
    // brächten dem Nutzer nur eine Fehlermeldung nach dem Roundtrip.
    // E4: ohne gewählte Station wird nicht gebucht; kein „custom“-Platzhalter,
    // den der Server erst mit unknown_station ablehnen müsste.
    const litersVal = germanDecimalToNumber(customLitersStr);
    const priceVal = germanDecimalToNumber(customPriceStr);
    const stationId = selected?.station_id;
    if (
      !fillDraft.ok ||
      litersVal === null ||
      priceVal === null ||
      !stationId
    ) {
      setActionFeedback(
        fillDraft.stationMissing
          ? "! Ohne Station kein Beleg — bitte zuerst eine Station wählen."
          : `! ${litersError ?? priceError ?? "Eingabe prüfen."}`,
      );
      setTimeout(() => setActionFeedback(null), 5000);
      return;
    }
    setFillSubmitting(true);
    const res = await postFill({
      station_id: stationId,
      station_name: selected?.name || "Station",
      liters: litersVal,
      price_paid: priceVal,
      fuel,
      source: "prompt",
      episode_id: ep?.id,
    });
    setFillSubmitting(false);
    if (res?.error_code) {
      setActionFeedback(
        `! Speichern fehlgeschlagen: ${problem(res.error_code) || res.error_code} – bitte erneut versuchen.`,
      );
      setTimeout(() => setActionFeedback(null), 5000);
      return;
    }
    setActionFeedback(
      "✓ Angepasste Füllung in deiner Tank-Bilanz gespeichert!",
    );
    setCustomFillOpen(false);
    setDueDismissed(true);
    setRefresh((r) => r + 1);
    setTimeout(() => setActionFeedback(null), 4000);
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
      setActionFeedback(
        quickDraft.stationMissing
          ? "! Ohne Station kein Beleg — bitte zuerst eine Station wählen."
          : `! ${quickDraft.litersError ?? quickDraft.priceError ?? "Eingabe prüfen."}`,
      );
      setTimeout(() => setActionFeedback(null), 5000);
      return;
    }
    setFillSubmitting(true);
    const res = await postFill({
      station_id: stationId,
      station_name: quickStation?.name || "Station",
      liters: litersVal,
      price_paid: priceVal,
      fuel,
      source: "manual",
    });
    setFillSubmitting(false);
    if (res?.error_code) {
      setActionFeedback(
        `! Speichern fehlgeschlagen: ${problem(res.error_code) || res.error_code} – bitte erneut versuchen.`,
      );
      setTimeout(() => setActionFeedback(null), 5000);
      return;
    }
    setActionFeedback("✓ Beleg in deiner Tank-Bilanz verbucht!");
    setRefresh((r) => r + 1);
    setTimeout(() => setActionFeedback(null), 4000);
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
        setActionFeedback(
          `! Verwerfen fehlgeschlagen: ${problem(res.error_code) || res.error_code}`,
        );
        setTimeout(() => setActionFeedback(null), 5000);
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
      if (res?.error_code) {
        setActionFeedback(
          `! Auswahl speichern fehlgeschlagen: ${problem(res.error_code) || res.error_code} – App-Server erreichbar?`,
        );
        setTimeout(() => setActionFeedback(null), 5000);
        return;
      }
    }
    if (mapsUrl) window.open(mapsUrl, "_blank", "noopener,noreferrer");
    setActionFeedback("✓ Auswahl gespeichert!");
    setRefresh((r) => r + 1);
    setTimeout(() => setActionFeedback(null), 4000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-emerald-500 selection:text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <a
            href="/"
            className="flex items-center gap-3"
            aria-label="TankApp Startseite"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-500 to-sky-500 text-slate-950 shadow-lg shadow-emerald-500/20">
              <FuelIcon size={21} />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight text-white">
                TankApp{" "}
                <span className="ml-1 rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-emerald-400">
                  LIVE
                </span>
              </h1>
              <p className="text-[11px] text-slate-500">
                Dein Tank-Kompass. Ohne Rätselraten.
              </p>
            </div>
          </a>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs">
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
              className="flex rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs font-bold"
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
            <label className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs">
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
              className="rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-slate-300 hover:text-white"
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
                    : "System in Ordnung — keine Alarme"
                }
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold ${
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
                    : "OK"}
              </span>
            )}
            {/* A6: aktuelle Sicht als Link teilen (Haushalt/Bookmark). */}
            <span className="relative inline-flex">
              <button
                aria-label="Ansicht als Link teilen"
                title="Setzt Stadt, Kraftstoff, Station, Tankmenge und Heatmap-Einstellungen in die URL und kopiert sie"
                onClick={copyShareLink}
                className="rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-slate-300 hover:text-white"
              >
                <Share2 size={16} aria-hidden="true" />
              </button>
              <span role="status" aria-live="polite" className="sr-only">
                {shareNote ?? ""}
              </span>
              {shareNote && (
                <span
                  role="status"
                  className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-[11px] leading-snug text-slate-200 shadow-xl"
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
              className="rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-slate-300 hover:text-white"
            >
              <RefreshCw
                size={16}
                className={
                  prices.pending ? "animate-spin text-emerald-400" : ""
                }
              />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-12 pt-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <nav
            aria-label="Ansichten"
            className="flex rounded-xl border border-slate-800 bg-slate-900/60 p-1"
          >
            {(
              [
                { id: "daily", label: "Alltag", icon: <Compass size={15} /> },
                {
                  id: "statistics",
                  label: "Werkstatt",
                  icon: <ChartIcon size={15} />,
                },
                { id: "system", label: "System", icon: <Server size={15} /> },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                aria-current={tab === item.id ? "page" : undefined}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors sm:px-5 ${tab === item.id ? "bg-slate-800 text-emerald-400 shadow" : "text-slate-500 hover:text-slate-200"}`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            {online && fresh.length ? (
              <Wifi size={13} className="text-emerald-400" />
            ) : (
              <WifiOff size={13} className="text-amber-400" />
            )}
            <span>
              {online && fresh.length
                ? `${fresh.length} frische Preise · ${activeCity} · Stand ${clockLabel(data?.generated_at)}`
                : prices.pending && !data
                  ? "Daten werden geladen …"
                  : `Kein bestätigter Live-Preis${data ? ` · Stand ${clockLabel(data.generated_at)}` : ""}`}
            </span>
          </div>
        </div>

        {actionFeedback && (
          <div
            role="status"
            className="mb-6 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/15 p-4 text-sm font-semibold text-emerald-200 shadow-lg"
          >
            <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
            <p>{actionFeedback}</p>
          </div>
        )}

        {/* C6: Preis-Datenstand — gilt für alle drei Tabs, deshalb über den
            Tab-Inhalt und nicht in jedes Panel einzeln. */}
        <DataAgeBanner stamp={data?.generated_at} kind="prices" />

        {!browserOnline && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200"
          >
            <WifiOff size={18} className="mt-0.5 shrink-0" />
            <p>
              Browser ist offline — gezeigt wird der letzte abgerufene Stand,
              keine Live-Preise. Sobald das Netz zurück ist, lädt die Ansicht
              neu.
            </p>
          </div>
        )}

        {fuel === "e5" && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-sky-500/25 bg-sky-500/10 p-4 text-xs leading-relaxed text-sky-200">
            <FuelIcon size={17} className="mt-0.5 shrink-0" />
            <p>
              <span className="font-semibold">E5↔E10-Äquivalenz:</span> E10
              verbraucht ~1–2 % mehr Kraftstoff — E5 lohnt sich erst bei p_E5 ≤
              ~1,015 · p_E10 (etwa 4–5 ct/L Differenz). Vergleiche E5-Preise nur
              mit E5, nie mit E10.
            </p>
          </div>
        )}

        {connectionProblem && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200"
          >
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p>{connectionProblem}</p>
              {!prices.error && (
                <button
                  onClick={() => setTab("system")}
                  className="mt-1 text-xs underline underline-offset-4"
                >
                  Einrichtung im Systembereich ansehen
                </button>
              )}
            </div>
          </div>
        )}

        {/* Fehlgeschlagene NAS-Jobs: in Alltag und Statistik sichtbar, nicht
            nur im System-Tab — sonst wirken veraltete Prognosen wie aktuelle. */}
        {failedJobs.length > 0 && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200"
          >
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p>
                {failedJobs.length === 1
                  ? "Ein NAS-Job ist fehlgeschlagen:"
                  : `${failedJobs.length} NAS-Jobs sind fehlgeschlagen:`}{" "}
                {failedJobs
                  .map(
                    ([name, job]) =>
                      `${JOB_LABELS[name] ?? name} — ${
                        job?.error_detail ??
                        problem(job?.error_code) ??
                        "unbekannte Ursache"
                      }`,
                  )
                  .join(" · ")}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-rose-300/80">
                Angezeigte Prognosen und Rankings können veraltet sein; die
                letzten guten Ergebnisse bleiben erhalten.
              </p>
              <button
                onClick={() => {
                  setTab("system");
                  showJobLog(failedJobs[0][0]);
                }}
                className="mt-1 text-xs underline underline-offset-4"
              >
                Log ansehen
              </button>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB ALLTAG                                                   */}
        {/* ============================================================ */}
        {tab === "daily" && (
          <DailyView
            activeCity={activeCity}
            actionFeedback={actionFeedback}
            best={best}
            bestPrice={bestPrice}
            consumption={consumption}
            speed={speed}
            customLitersStr={customLitersStr}
            customFillOpen={customFillOpen}
            customPriceStr={customPriceStr}
            data={data}
            dayStrip={dayStrip}
            decideRes={decideRes}
            detourMode={detourMode}
            difference={difference}
            dueDismissed={dueDismissed}
            dueEpisode={dueEpisode}
            elapsed={elapsed}
            fillDraft={fillDraft}
            fillList={fillList}
            fillSubmitting={fillSubmitting}
            fillsRes={fillsRes}
            fuel={fuel}
            gateStatus={gateStatus}
            h={h}
            handleConfirmRecommendedFill={handleConfirmRecommendedFill}
            handleCustomFill={handleCustomFill}
            handleDismissDue={handleDismissDue}
            handleIntent={handleIntent}
            handleQuickFill={handleQuickFill}
            handleVoidFill={handleVoidFill}
            liters={liters}
            litersError={litersError}
            liveAdvice={liveAdvice}
            m7Line={m7Line}
            online={online}
            price={price}
            priceError={priceError}
            quickDraft={quickDraft}
            quickLitersStr={quickLitersStr}
            quickPriceStr={quickPriceStr}
            quickStation={quickStation}
            quickStationId={quickStationId}
            refreshNow={refreshNow}
            routeEval={routeEval}
            selected={selected}
            selectedId={selectedId}
            routeAltId={routeAltId}
            selectedIsCheapest={selectedIsCheapest}
            setConsumption={setConsumption}
            setCustomFillOpen={setCustomFillOpen}
            setCustomLitersStr={setCustomLitersStr}
            setCustomPriceStr={setCustomPriceStr}
            setDetourMode={setDetourMode}
            setLiters={setLiters}
            setQuickLitersStr={setQuickLitersStr}
            setQuickPriceStr={setQuickPriceStr}
            setQuickStationId={setQuickStationId}
            setRouteAltId={setRouteAltId}
            setSelectedId={setSelectedId}
            setShowVoidedFills={setShowVoidedFills}
            setSpeed={setSpeed}
            setTimeValue={setTimeValue}
            showVoidedFills={showVoidedFills}
            span={span}
            stationMissing={stationMissing}
            stations={stations}
            statsSummaryRes={statsSummaryRes}
            stripCells={stripCells}
            timeValue={timeValue}
            timeValueUsed={timeValueUsed}
            autoZ={autoZ}
            voidBusy={voidBusy}
            voidNote={voidNote}
            visibleFills={visibleFills}
            voidedCount={voidedCount}
            tankPercent={tankPercent}
            setTankPercent={setTankPercent}
            tankCapacity={tankCapacity}
            setTankCapacity={setTankCapacity}
            pinnedIds={pinnedIds}
            togglePin={togglePin}
            pinNote={pinNote}
          />
        )}

        {/* ============================================================ */}
        {/* TAB STATISTIK / WERKSTATT                                    */}
        {/* ============================================================ */}
        {tab === "statistics" && (
          <StatisticsView
            activeCity={activeCity}
            activeLabDayRow={activeLabDayRow}
            activeLabOutcome={activeLabOutcome}
            anchorHour={anchorHour}
            anchorLabel={anchorLabel}
            best={best}
            calibErr={calibErr}
            calibPoints={calibPoints}
            data={data}
            eps={eps}
            f={f}
            fanBand80={fanBand80}
            fanBand95={fanBand95}
            forecast={forecast}
            forecastMarks={forecastMarks}
            forecastWindow={forecastWindow}
            gateStatus={gateStatus}
            h={h}
            heatmap={heatmap}
            heatmapBasis={heatmapBasis}
            heatmapBasisActive={heatmapBasisActive}
            heatmapKind={heatmapKind}
            heatmapWeeks={heatmapWeeks}
            history={history}
            horizon={horizon}
            horizonDays={horizonDays}
            labData={labData}
            labDayClass={labDayClass}
            labDayIdx={labDayIdx}
            labModel={labModel}
            labMu={labMu}
            labPredHour={labPredHour}
            liters={liters}
            labRows={labRows}
            labSaves={labSaves}
            labScores={labScores}
            labTotals={labTotals}
            livePointsForChart={livePointsForChart}
            m7Line={m7Line}
            metrics={metrics}
            modelSeries={modelSeries}
            modelWindows={modelWindows}
            obsWindow={obsWindow}
            observations={observations}
            refreshNow={refreshNow}
            selection={selection}
            series={series}
            selected={selected}
            setEps={setEps}
            setHeatmapBasis={setHeatmapBasis}
            setHeatmapKind={setHeatmapKind}
            setHeatmapWeeks={setHeatmapWeeks}
            setHorizon={setHorizon}
            setLabDayIdx={setLabDayIdx}
            setSelectedId={setSelectedId}
            setSpanHours={setSpanHours}
            span={span}
            spanHours={spanHours}
            spanLabel={spanLabel}
            stationPhase={f?.data_policy ?? null}
            stations={stations}
            statsSummaryRes={statsSummaryRes}
            fillsSummary={fillsSummary}
            transitionLine={transitionLine}
          />
        )}

        {/* ============================================================ */}
        {/* TAB SYSTEM                                                    */}
        {/* ============================================================ */}
        {tab === "system" && (
          <SystemView
            activeCity={activeCity}
            calibrationHint={calibrationHint}
            collector={collector}
            data={data}
            decideRes={decideRes}
            fresh={fresh}
            h={h}
            health={health}
            identity={identity}
            jobLog={jobLog}
            liveAdvice={liveAdvice}
            logBodyRef={logBodyRef}
            logJob={logJob}
            fuel={fuel}
            heatmapWeeks={heatmapWeeks}
            logLineCount={logLineCount}
            logLines={logLines}
            logRef={logRef}
            m7Line={m7Line}
            refreshNow={refreshNow}
            selection={selection}
            setLogJob={setLogJob}
            setLogLineCount={setLogLineCount}
            setLogReload={setLogReload}
            showJobLog={showJobLog}
            span={span}
            stations={stations}
            statsSummaryRes={statsSummaryRes}
            triggerCommand={triggerCommand}
            webhookCapable={webhookCapable}
            workerCommand={workerCommand}
          />
        )}

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/70 pt-5 text-[10px] text-slate-600">
          <span>
            Daten: <strong>MTS-K via tankerkoenig.de (CC BY 4.0)</strong> ·
            Token-Bucket 1 R / 300 s · Fenster 06–24 Uhr · Entscheidungs-API:
            decide · episodes · fills · settlement · summary
            {h?.version ? (
              <>
                {" "}
                · TankApp {h.version}
                {h?.commit ? (
                  <span className="font-mono"> ({h.commit})</span>
                ) : null}
              </>
            ) : null}
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck size={12} />
            Keine Demo-Preise. Keine erfundene Sicherheit.
          </span>
        </footer>
      </main>
      <ProfileManager
        open={profileManagerOpen}
        onClose={() => setProfileManagerOpen(false)}
        profilesRes={profilesRes}
        activeId={activeProfileId || null}
        busy={profilesBusy}
        note={profileNote}
        onActivate={(id) => void handleActivateProfile(id)}
        onCreate={(name) => void handleCreateProfile(name)}
        onRename={(id, name) => void handleRenameProfile(id, name)}
        onDelete={(id) => void handleDeleteProfile(id)}
      />
    </div>
  );
}

