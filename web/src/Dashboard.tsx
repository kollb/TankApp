// Layout/visual foundation: sample/good gui/TankAppDashboard + DecisionCockpit.
// Workshop composition and charts: sample/good statistic gui/DecisionLab.
// No demo engine, seeds, simulated decisions or PostgreSQL are imported.
//
// U8: Die Root ist Zusammensetzung. Der geteilte Zustand (Preise, Polls,
// Profile, Navigation, Offline-Queue, Feedback) lebt im OverviewContext
// (state/overview.tsx); bereichsspezifischer Zustand in den Views (Labor:
// Spielplatz + Modell, System: Log-Terminal). Diese Datei montiert Header,
// Bereichs-Navigation, globale Banner und die Bereich-Umschaltung.
import { lazy, Suspense, useEffect, useState } from "react";
import { ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { MobileNav, SideNav } from "./components/AppNav";
import { AppHeader } from "./components/AppHeader";
// A1: Fahrzeug-/Haushaltsprofile — Verwaltungsdialog.
import { ProfileManager } from "./components/ProfileManager";
// C6 (Rest): Datenstand-Banner — die Wurzel hängt die Datenstand-Note jetzt
// ins V3-Register (reduceNotices), nicht mehr als eigenen Block.
import { feedbackRank } from "./components/FeedbackBanner";
import { InstallHint } from "./components/InstallHint";
import { UpdateBanner } from "./components/UpdateBanner";
import { reduceNotices, type NoticeItem } from "./components/Notices";
import { NoticesView } from "./components/NoticesView";
import { SkeletonPanel } from "./components/Skeleton";
import {
  clockLabel,
  dataAgeNote,
  freshCountLabel,
  JOB_LABELS,
  problem,
} from "./data";
import { OverviewProvider, useOverview } from "./state/overview";

// U7: Code-Splitting pro Bereich — jede View bleibt ein eigener Chunk
// (`import()` je `views/*`). Seit 0.41.1 werden die Importe außerdem
// sofort angestoßen: Sie laden parallel zum Erst-Paint-Gate (unten), der
// auf die API-Antworten wartet. So steht beim ersten echten Paint sowohl
// das View-Modul als auch der Inhalt bereit — der frühere Tausch
// „Skeleton → View“ mitten im sichtbaren Bereich war die Hauptquelle für
// Layout-Verschiebungen (Lighthouse-Gate `cumulative-layout-shift`).
const jetztModule = import("./views/Jetzt");
const stationenModule = import("./views/Stationen");
const wocheModule = import("./views/Woche");
const ichModule = import("./views/Ich");
const laborModule = import("./views/Labor");
const systemModule = import("./views/System");
const glossaryModule = import("./views/Glossary");
const JetztView = lazy(() =>
  jetztModule.then((m) => ({ default: m.JetztView })),
);
const StationenView = lazy(() =>
  stationenModule.then((m) => ({ default: m.StationenView })),
);
const WocheView = lazy(() =>
  wocheModule.then((m) => ({ default: m.WocheView })),
);
const IchView = lazy(() =>
  ichModule.then((m) => ({ default: m.IchView })),
);
const LaborView = lazy(() =>
  laborModule.then((m) => ({ default: m.LaborView })),
);
const SystemView = lazy(() =>
  systemModule.then((m) => ({ default: m.SystemView })),
);
const GlossaryView = lazy(() =>
  glossaryModule.then((m) => ({ default: m.GlossaryView })),
);

export function Dashboard() {
  return (
    <OverviewProvider>
      <DashboardShell />
    </OverviewProvider>
  );
}

function DashboardShell() {
  const ov = useOverview();
  const {
    tab,
    gotoTab,
    laborFocus,
    setLaborFocus,
    openLabor,
    handleNowNavigate,
    ichSection,
    setIchSection,
    searchFocusSignal,
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
    stationsSpanHours,
    setStationsSpanHours,
    theme,
    setTheme,
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
    prices,
    data,
    activeCity,
    stations,
    online,
    elapsed,
    price,
    fresh,
    selected,
    bestPrice,
    freshPrices,
    pinnedFirstStations,
    h,
    failedJobs,
    refreshNow,
    browserOnline,
    connectionProblem,
    queueBanner,
    queueNote,
    actionFeedback,
    feedback,
    activeProfileId,
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
    decideRes,
    statsSummaryRes,
    fillsSummary,
    series7d,
    stripCells,
    effLiters,
    effTimeValue,
    timeValueUsed,
    autoZ,
    nowPricesAt,
    nowForecastAt,
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
    handleConfirmRecommendedFill,
    handleQuickFill,
    handleVoidFill,
    handleDismissDue,
    handleIntent,
    showJobLog,
  } = ov;

  /* V3 (GUI-TEXT-BEFUND): ein Mitteilungs-Register mit Rang statt acht
     gestapelten Blöcken (Rückmeldung, Datenstand, Installation, Update,
     Offline-Queue, offline, E5-Hinweis, Verbindungsproblem). Hier entsteht
     die **eine** Meldung je Quelle; `reduceNotices` behält davon den
     höchsten Rang und reiht Gleichrangige aneinander — nie mehr als ein
     Block. */
  const dataAge = dataAgeNote(data?.generated_at, "prices");
  const notices: NoticeItem[] = [
    ...(failedJobs.length > 0
      ? ([
          {
            id: "jobs",
            rank: "error",
            text:
              failedJobs.length === 1
                ? "Ein NAS-Job ist fehlgeschlagen:"
                : `${failedJobs.length} NAS-Jobs sind fehlgeschlagen:` +
                  ` ${failedJobs
                    .map(
                      ([name, job]) =>
                        `${JOB_LABELS[name] ?? name} — ${
                          job?.error_detail ??
                          problem(job?.error_code) ??
                          "unbekannte Ursache"
                        }`,
                    )
                    .join(" · ")}`,
            note: "Angezeigte Prognosen und Rankings können veraltet sein; die letzten guten Ergebnisse bleiben erhalten.",
            actionLabel: "Log ansehen",
            onAction: () => {
              gotoTab("system");
              showJobLog(failedJobs[0][0]);
            },
          },
        ] as NoticeItem[])
      : []),
    ...(connectionProblem
      ? ([
          {
            id: "connection",
            rank: "error",
            text: connectionProblem,
            actionLabel: prices.error ? null : "Einrichtung ansehen",
            onAction: () => gotoTab("system"),
          },
        ] as NoticeItem[])
      : []),
    ...(!browserOnline
      ? ([
          {
            id: "offline",
            rank: "warn",
            text: "Browser ist offline — gezeigt wird der letzte abgerufene Stand, keine Live-Preise. Sobald das Netz zurück ist, lädt die Ansicht neu.",
          },
        ] as NoticeItem[])
      : []),
    ...(queueBanner
      ? ([
          {
            id: "queue",
            rank: "warn",
            text: queueBanner.text,
            note: queueNote
              ? `${queueBanner.note} ${queueNote}`
              : queueBanner.note,
          },
        ] as NoticeItem[])
      : []),
    ...(dataAge
      ? ([
          {
            id: "stale",
            rank: dataAge.tone,
            text: dataAge.text,
          },
        ] as NoticeItem[])
      : []),
    ...(fuel === "e5"
      ? ([
          {
            id: "e5",
            rank: "hint",
            text: "E5↔E10-Äquivalenz: E10 verbraucht ≈ 1–2 % mehr Kraftstoff — E5 lohnt sich erst, wenn der E5-Preis höchstens 1,015 × E10-Preis beträgt (etwa 4–5 ct/L Differenz). E5-Preise gehören nur mit E5 verglichen, nie mit E10.",
          },
        ] as NoticeItem[])
      : []),
    ...(actionFeedback
      ? ([
          {
            id: "action",
            rank: feedbackRank(actionFeedback.tone),
            text: actionFeedback.text,
          },
        ] as NoticeItem[])
      : []),
  ];

  /* Erst-Paint-Gate (0.41.1, Lighthouse-CLS): Die Ansicht rendert erst,
     wenn die Shell-Daten (Preise, Gesundheit, Profile) und die primäre
     Antwort des aktiven Bereichs da sind. Dadurch steht beim ersten Paint
     sofort das fertige Layout — Header-Steuerungen, Banner und View-Inhalt
     erscheinen gemeinsam und nichts Sichtbares verschiebt sich nachträglich.
     Vorher wuchsen Skeletons in den sichtbaren Bereich hinein und schoben
     Fakten/Footer beiseite (cumulative-layout-shift bis 0,83).
     `gateLatched` hält das Gate einmal offen (Tab-Wechsel und Polls sollen
     weiterhin flüssig bleiben); `gateForced` ist die Sicherheitsleine,
     falls eine Antwort länger als 12 s auf sich warten lässt. */
  const [gateLatched, setGateLatched] = useState(false);
  const [gateForced, setGateForced] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setGateForced(true), 12000);
    return () => window.clearTimeout(timer);
  }, []);
  // „Settled“ heißt: nicht mehr pending **und** eine Antwort ist da (Daten
  // oder Fehler). Wichtig: `useResource` startet mit `pending: false` — erst
  // der Effekt schaltet auf laden. Nur auf `pending` zu prüfen würde das Gate
  // im allerersten Render sofort öffnen.
  const settled = (res: {
    pending: boolean;
    data: unknown;
    error: boolean;
  }) => !res.pending && (res.data !== null || res.error);
  const shellSettled =
    settled(ov.prices) && settled(ov.health) && settled(ov.profilesRes);
  const primarySettled =
    tab === "jetzt" || tab === "stations" || tab === "week"
      ? /* Ohne Stadt wird der Overview-Poll gar nicht abgefragt (URL null) —
           dann blockiert das Gate nicht, die Ansicht zeigt den Einrichtungs-
           zustand sofort. */
        !ov.activeCity || settled(ov.decideRes)
      : tab === "labor"
        ? /* forecast hängt an `identity` (Stadt + Kraftstoff) — ohne Stadt
             wird es gar nicht abgefragt und darf das Gate nicht blockieren. */
          settled(ov.statsSummaryRes) &&
          settled(ov.selection) &&
          (!ov.identity || settled(ov.forecast))
        : tab === "ich"
          ? /* `fillsRes` ist nur ein Overview-Teil (auf „Ich“ leer) — die
               eigentliche Antwort des Bereichs ist `fillsSummary`. */
            settled(ov.fillsSummary)
          : true;
  // Das View-Modul des aktiven Bereichs muss ebenfalls da sein, bevor das
  // Gate öffnet: Sonst zeigt Suspense kurz das Skeleton und tauscht es gegen
  // die View — ein sichtbarer Tausch, den das Lighthouse-Gate als Layout-
  // Shift zählt. Die Importe laufen seit Modulstart (oben), hier wartet das
  // Gate nur noch auf das Ergebnis.
  const tabModule =
    tab === "jetzt"
      ? jetztModule
      : tab === "stations"
        ? stationenModule
        : tab === "week"
          ? wocheModule
          : tab === "ich"
            ? ichModule
            : tab === "labor"
              ? laborModule
              : tab === "system"
                ? systemModule
                : glossaryModule;
  const [chunkReady, setChunkReady] = useState(false);
  useEffect(() => {
    let active = true;
    const done = () => {
      if (active) setChunkReady(true);
    };
    tabModule.then(done, done);
    return () => {
      active = false;
    };
  }, [tabModule]);
  const gateReady =
    gateLatched || gateForced || (shellSettled && primarySettled && chunkReady);
  useEffect(() => {
    if (gateReady && !gateLatched) setGateLatched(true);
  }, [gateReady, gateLatched]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-emerald-500 selection:text-slate-950">
      <AppHeader ov={ov} ready={gateReady} />

      {/* U3 (§13): desktop die Seitenleiste links vor dem Inhalt. Die
          mobile Bottom-Navigation (`MobileNav`) wird als letztes Element
          der App-Hülle montiert — so liegt sie in DOM- und Stapel-
          Reihenfolge sicher über dem Inhalt (CI-Fix 0.41.0). */}
      <div className="mx-auto flex max-w-7xl items-start gap-6 px-4 sm:px-6 lg:px-8">
        <SideNav tab={tab} onSelect={gotoTab} />
        <main className="app-main min-w-0 flex-1 pt-6 pb-24 lg:pb-12">
        {gateReady ? (
          <>
        <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {online && fresh.length ? (
              <Wifi size={13} className="text-emerald-400" />
            ) : (
              <WifiOff size={13} className="text-amber-400" />
            )}
            <span>
              {online && fresh.length
                ? `${freshCountLabel(fresh.length)} · ${activeCity} · Stand ${clockLabel(data?.generated_at)}`
                : prices.pending
                  ? "Daten werden geladen …"
                  : `Kein bestätigter Live-Preis${data ? ` · Stand ${clockLabel(data.generated_at)}` : ""}`}
            </span>
          </div>
        </div>

        {/* V3: Die gebündelte Meldung — genau ein Block. Auf „Ich“ zeigt die
            View ihre eigene Rückmeldung (FeedbackBanner im Belege-Abschnitt),
            deshalb fällt der Aktions-Kanal dort aus dem Register. */}
        <NoticesView
          result={reduceNotices(
            notices.filter((item) => item.id !== "action" || tab !== "ich"),
          )}
        />

        {/* C8: Installationshinweis — nach „Nicht jetzt“ 30 Tage still. */}
        <InstallHint onNote={(message) => feedback("ok", message)} />

        {/* B10: „Neue Version verfügbar“ — nur wenn ein Service Worker wartet. */}
        <UpdateBanner />

        {/* ============================================================ */}
        {/* Bereich-Inhalt (U7: die Views laden als eigene Chunks —       */}
        {/* Suspense zeigt derweil ein Skeleton statt einer weißen Fläche) */}
        {/* ============================================================ */}
        <Suspense
          fallback={
            <div className="space-y-6" aria-busy="true" aria-live="polite">
              <SkeletonPanel />
              <SkeletonPanel />
            </div>
          }
        >
        {tab === "jetzt" && (
          <JetztView
            activeCity={activeCity}
            liters={effLiters}
            timeValue={effTimeValue}
            timeValueUsed={timeValueUsed}
            autoZ={autoZ}
            decideRes={decideRes}
            stations={stations}
            selectedId={selectedId}
            stripCells={stripCells}
            pricesAt={nowPricesAt}
            forecastAt={nowForecastAt}
            onNavigate={handleNowNavigate}
            onDeepen={(section) => openLabor(section)}
            onRetry={refreshNow}
            assumptions={assumptions}
            defaultLiters={liters}
            defaultTimeValue={timeValue}
            onAssumptions={(patch) =>
              setAssumptions((current) => ({ ...current, ...patch }))
            }
            onAssumptionsReset={() =>
              setAssumptions({ liters: null, latestBy: null, timeValue: null })
            }
            tankPercent={tankPercent}
            onTankQuick={(percent) => setTankPercent(percent)}
            dueEpisode={dueEpisode}
            dueDismissed={dueDismissed}
            bestPrice={bestPrice}
            onConfirmRecommended={(ep) => handleConfirmRecommendedFill(ep)}
            onDismissDue={(epId) => handleDismissDue(epId)}
            onOpenFills={() => {
              setIchSection("fills");
              gotoTab("ich");
            }}
            onIntent={(intent, mapsUrl) => handleIntent(intent, mapsUrl)}
          />
        )}

        {/* ============================================================ */}
        {/* TAB STATIONEN (GUI-Neuentwurf, Phase 2)                      */}
        {/* ============================================================ */}
        {tab === "stations" && (
          <StationenView
            activeCity={activeCity}
            data={data}
            stations={stations}
            price={price}
            elapsed={elapsed}
            online={online}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            pinnedIds={pinnedIds}
            togglePin={togglePin}
            pinNote={pinNote}
            decideRes={decideRes}
            stripCells={stripCells}
            series7d={series7d}
            seriesSpan={stationsSpanHours}
            onSeriesSpan={setStationsSpanHours}
            liters={effLiters}
            timeValue={effTimeValue}
            timeValueUsed={timeValueUsed}
            autoZ={autoZ}
            onTimeValue={(value) =>
              setAssumptions((current) => ({ ...current, timeValue: value }))
            }
            pricesAt={nowPricesAt}
            onRetry={refreshNow}
            onNavigate={handleNowNavigate}
            onDeepen={(section) => openLabor(section)}
            searchFocusSignal={searchFocusSignal}
          />
        )}

        {/* ============================================================ */}
        {/* TAB WOCHE (GUI-Neuentwurf, Phase 2)                          */}
        {/* ============================================================ */}
        {tab === "week" && (
          <WocheView
            activeCity={activeCity}
            stationsCount={stations.length}
            decideRes={decideRes}
            priceNow={price(selected)}
            tankPercent={tankPercent}
            setTankPercent={setTankPercent}
            tankCapacity={tankCapacity}
            consumption={consumption}
            forecastAt={nowForecastAt}
            pricesAt={nowPricesAt}
            onRetry={refreshNow}
            onNavigate={handleNowNavigate}
            onDeepen={(section) => openLabor(section)}
          />
        )}

        {/* ============================================================ */}
        {/* TAB ICH (GUI-Neuentwurf, Phase 2)                            */}
        {/* ============================================================ */}
        {tab === "ich" && (
          <IchView
            initialSection={ichSection}
            vehicle={{
              liters,
              setLiters,
              consumption,
              setConsumption,
              tankCapacity,
              setTankCapacity,
              activeProfileName: activeProfile?.name ?? null,
              speed,
              setSpeed,
              timeValue,
              setTimeValue,
              timeValueUsed,
              autoZ,
              detourMode,
              setDetourMode,
              profilesRes,
              activeProfileId,
              onActivateProfile: handleActivateProfile,
              profilesBusy,
              onOpenProfileManager: () => setProfileManagerOpen(true),
            }}
            settings={{
              data,
              activeCity,
              setCity,
              fuel,
              setFuel,
              statsSummaryRes,
              refreshNow,
              theme,
              setTheme,
              pinnedStations: pinnedFirstStations
                .filter((row) => pinnedIds.includes(row.station_id))
                .map((station) => ({ station })),
              togglePin,
              version: h?.version ?? null,
              onOpenGlossary: () => gotoTab("glossary"),
            }}
            pinnedFirstStations={pinnedFirstStations}
            quickStationId={quickStationId}
            setQuickStationId={setQuickStationId}
            quickLitersStr={quickLitersStr}
            setQuickLitersStr={setQuickLitersStr}
            quickPriceStr={quickPriceStr}
            setQuickPriceStr={setQuickPriceStr}
            quickDraft={quickDraft}
            priceOf={price}
            freshPrices={freshPrices}
            fillSubmitting={fillSubmitting}
            onQuickFill={handleQuickFill}
            actionFeedback={actionFeedback}
            fillList={fillList}
            visibleFills={visibleFills}
            voidedCount={voidedCount}
            showVoidedFills={showVoidedFills}
            setShowVoidedFills={setShowVoidedFills}
            voidNote={voidNote}
            voidBusy={voidBusy}
            onVoidFill={handleVoidFill}
            fillsSummary={fillsSummary}
            onRetry={refreshNow}
          />
        )}

        {/* ============================================================ */}
        {/* TAB LABOR — holt sich Daten und Modell aus dem Context (U8)   */}
        {/* ============================================================ */}
        {tab === "labor" && (
          <LaborView
            focusSection={laborFocus}
            onFocusHandled={() => setLaborFocus(null)}
            onNavigate={handleNowNavigate}
            onOpenGlossary={() => gotoTab("glossary")}
          />
        )}

        {/* ============================================================ */}
        {/* TAB SYSTEM — Terminal-Zustand besitzt die View selbst (U8)   */}
        {/* ============================================================ */}
        {tab === "system" && (
          <SystemView onDeepen={(section) => openLabor(section)} />
        )}

        {/* ============================================================ */}
        {/* TAB GLOSSAR — C7 „Was heißt das?“                             */}
        {/* ============================================================ */}
        {tab === "glossary" && <GlossaryView />}
        </Suspense>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/70 pt-5 text-xs text-slate-600">
          <span>
            Datenquelle: Markttransparenzstelle für Kraftstoffe (MTS-K) über tankerkoenig.de — Lizenz CC BY 4.0 · Abfrage höchstens alle 5 Minuten · Polling-Fenster 06–24 Uhr (Europe/Berlin)
            {h?.version ? (
              <>
                {" "}
                · TankApp {h.version}
                {h?.commit ? (
                  <span className="font-mono"> ({h.commit})</span>
                ) : null}
              </>
            ) : null}{" "}
            ·{" "}
            <button
              onClick={() => gotoTab("glossary")}
              className="underline underline-offset-2 hover:text-slate-400"
            >
              Glossar
            </button>
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck size={12} />
            Keine Demo-Preise. Keine erfundene Sicherheit.
          </span>
        </footer>
          </>
        ) : (
          /* Erst-Paint-Gate zu: noch kein fertiges Layout zeigen, das sich
             gleich verschiebt — ein ruhender Ladeblock hält den Platz. */
          <div
            className="min-h-[70vh] space-y-6"
            aria-busy="true"
            aria-live="polite"
          >
            <SkeletonPanel lines={4} title label="Ansicht wird geladen" />
            <SkeletonPanel lines={6} title label="Inhalt wird geladen" />
          </div>
        )}
      </main>
      </div>

      {/* U3 (§13) mobil: Bottom-Navigation als letztes Element der Hülle,
          damit kein Inhalt sie überdecken oder Klicks abfangen kann. */}
      <MobileNav tab={tab} onSelect={gotoTab} />

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
