// Layout/visual foundation: sample/good gui/TankAppDashboard + DecisionCockpit.
// Workshop composition and charts: sample/good statistic gui/DecisionLab.
// No demo engine, seeds, simulated decisions or PostgreSQL are imported.
//
// U8: Die Root ist Zusammensetzung. Der geteilte Zustand (Preise, Polls,
// Profile, Navigation, Offline-Queue, Feedback) lebt im OverviewContext
// (state/overview.tsx); bereichsspezifischer Zustand in den Views (Labor:
// Spielplatz + Modell, System: Log-Terminal). Diese Datei montiert Header,
// Bereichs-Navigation, globale Banner und die Bereich-Umschaltung.
import { lazy, Suspense } from "react";
import {
  AlertCircle,
  CloudOff,
  Fuel as FuelIcon,
  ShieldCheck,
  Wifi,
  WifiOff,
} from "lucide-react";
import { AppNav } from "./components/AppNav";
import { AppHeader } from "./components/AppHeader";
// A1: Fahrzeug-/Haushaltsprofile — Verwaltungsdialog.
import { ProfileManager } from "./components/ProfileManager";
// C6 (Rest): Datenstand-Banner.
import { DataAgeBanner } from "./components/DataAge";
import { FeedbackBanner } from "./components/FeedbackBanner";
import { InstallHint } from "./components/InstallHint";
import { UpdateBanner } from "./components/UpdateBanner";
import { SkeletonPanel } from "./components/Skeleton";
import { clockLabel, JOB_LABELS, problem } from "./data";
import { OverviewProvider, useOverview } from "./state/overview";

// U7: Code-Splitting pro Bereich — jede View ist ein eigener Chunk und
// lädt erst, wenn ihr Tab geöffnet wird. So zahlt der Einstieg („Jetzt“)
// nicht mehr das komplette Labor, die Karten-Bibliothek oder die
// System-Ansicht mit; der einzelne große Chunk wird in handliche Stücke
// zerlegt.
const JetztView = lazy(() =>
  import("./views/Jetzt").then((m) => ({ default: m.JetztView })),
);
const StationenView = lazy(() =>
  import("./views/Stationen").then((m) => ({ default: m.StationenView })),
);
const WocheView = lazy(() =>
  import("./views/Woche").then((m) => ({ default: m.WocheView })),
);
const IchView = lazy(() =>
  import("./views/Ich").then((m) => ({ default: m.IchView })),
);
const LaborView = lazy(() =>
  import("./views/Labor").then((m) => ({ default: m.LaborView })),
);
const SystemView = lazy(() =>
  import("./views/System").then((m) => ({ default: m.SystemView })),
);
const GlossaryView = lazy(() =>
  import("./views/Glossary").then((m) => ({ default: m.GlossaryView })),
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-emerald-500 selection:text-slate-950">
      <AppHeader ov={ov} />

      {/* U3 (§13): desktop die Seitenleiste links vor dem Inhalt, mobil
          die Bottom-Navigation — dieselbe Liste, zwei Raster (AppNav). */}
      <div className="mx-auto flex max-w-7xl items-start gap-6 px-4 sm:px-6 lg:px-8">
        <AppNav tab={tab} onSelect={gotoTab} />
        <main className="app-main min-w-0 flex-1 pt-6 pb-24 lg:pb-12">
        <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {online && fresh.length ? (
              <Wifi size={13} className="text-emerald-400" />
            ) : (
              <WifiOff size={13} className="text-amber-400" />
            )}
            <span>
              {online && fresh.length
                ? `${fresh.length} frische Preise · ${activeCity} · Stand ${clockLabel(data?.generated_at)}`
                : prices.pending
                  ? "Daten werden geladen …"
                  : `Kein bestätigter Live-Preis${data ? ` · Stand ${clockLabel(data.generated_at)}` : ""}`}
            </span>
          </div>
        </div>

        <FeedbackBanner feedback={actionFeedback} />

        {/* C6: Preis-Datenstand — gilt für alle Tabs, deshalb über den
            Tab-Inhalt und nicht in jedes Panel einzeln. */}
        <DataAgeBanner stamp={data?.generated_at} kind="prices" />

        {/* C8: Installationshinweis — nach „Nicht jetzt“ 30 Tage still. */}
        <InstallHint onNote={(message) => feedback("ok", message)} />

        {/* B10: „Neue Version verfügbar“ — nur wenn ein Service Worker wartet. */}
        <UpdateBanner />

        {queueBanner && (
          <div
            role="status"
            className="mb-6 flex items-start gap-3 rounded-lg border border-sky-500/25 bg-sky-500/10 p-4 text-sm text-sky-200"
          >
            <CloudOff size={18} className="mt-0.5 shrink-0" />
            <div>
              <p>{queueBanner.text}</p>
              <p className="mt-0.5 text-xs text-sky-200/80">
                {queueBanner.note}
                {queueNote ? ` ${queueNote}` : ""}
              </p>
            </div>
          </div>
        )}

        {!browserOnline && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200"
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
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-sky-500/25 bg-sky-500/10 p-4 text-xs leading-relaxed text-sky-200">
            <FuelIcon size={17} className="mt-0.5 shrink-0" />
            <p>
              <span className="font-semibold">E5↔E10-Äquivalenz:</span> E10
              verbraucht ≈ 1–2 % mehr Kraftstoff — E5 lohnt sich erst, wenn der
              E5-Preis höchstens 1,015 × E10-Preis beträgt (etwa 4–5 ct/L
              Differenz). E5-Preise gehören nur mit E5 verglichen, nie mit
              E10.
            </p>
          </div>
        )}

        {connectionProblem && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200"
          >
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p>{connectionProblem}</p>
              {!prices.error && (
                <button
                  onClick={() => gotoTab("system")}
                  className="mt-1 text-xs underline underline-offset-4"
                >
                  Einrichtung im Systembereich ansehen
                </button>
              )}
            </div>
          </div>
        )}

        {/* Fehlgeschlagene NAS-Jobs: in allen Bereichen sichtbar, nicht nur
            in „System“ — sonst wirken veraltete Prognosen wie aktuelle. */}
        {failedJobs.length > 0 && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-lg border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200"
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
                  gotoTab("system");
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
      </main>
      </div>
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
