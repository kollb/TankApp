// Die Bereiche für **beide** Hüllen — alte Oberfläche (`Dashboard.tsx`) und
// Konzept-Neubau (`v3/App.tsx`).
//
// Warum eine Datei statt zweier Kopien: Die Views „Woche“, „Stationen“, „Ich“,
// „Labor“, „System“ und „Glossar“ brauchen je 8–30 Werte aus dem geteilten
// Zustand. Zwei Kopien dieser Verdrahtung wären zwei Wahrheiten — die neue
// Hülle würde bei jeder Änderung stillschweigend auseinanderlaufen, und genau
// das war im Befund „verschiedene Dinge, die scrollen müssen“ schon einmal
// der Fehler. Der jeweilige **Bereich** (`jetzt`) wird von der Hülle selbst
// gestellt: die alte Oberfläche rendert dort `views/Jetzt`, der Neubau seine
// eigene Guide-Seite.
//
// Die Importe laufen beim Laden dieses Moduls an (`import()` je Bereich),
// damit die Chunks parallel zum Erst-Paint-Gate eintreffen (U7/0.41.1).
// `SECTION_MODULES` gibt der alten Hülle die Promises für ihr Gate.

import { lazy, type ReactNode } from "react";
import { SkeletonPanel } from "../components/Skeleton";
import type { TabId } from "../routing";
import type { OverviewState } from "../state/overview";

export const jetztModule = import("./Jetzt");
export const stationenModule = import("./Stationen");
export const wocheModule = import("./Woche");
export const ichModule = import("./Ich");
export const laborModule = import("./Labor");
export const systemModule = import("./System");
export const glossaryModule = import("./Glossary");

/** „Jetzt“ in der bisherigen Gestaltung (die alte Hülle rendert sie). */
export const JetztView = lazy(() =>
  jetztModule.then((m) => ({ default: m.JetztView })),
);
const StationenView = lazy(() =>
  stationenModule.then((m) => ({ default: m.StationenView })),
);
const WocheView = lazy(() =>
  wocheModule.then((m) => ({ default: m.WocheView })),
);
const IchView = lazy(() => ichModule.then((m) => ({ default: m.IchView })));
const LaborView = lazy(() => laborModule.then((m) => ({ default: m.LaborView })));
const SystemView = lazy(() =>
  systemModule.then((m) => ({ default: m.SystemView })),
);
const GlossaryView = lazy(() =>
  glossaryModule.then((m) => ({ default: m.GlossaryView })),
);

/** Bereich → Modul-Promise (Erst-Paint-Gate der alten Hülle). */
export const SECTION_MODULES: Record<TabId, Promise<unknown>> = {
  jetzt: jetztModule,
  stations: stationenModule,
  week: wocheModule,
  ich: ichModule,
  labor: laborModule,
  system: systemModule,
  glossary: glossaryModule,
};

/** Platzhalter, solange ein Bereichs-Chunk noch nicht da ist. */
export function SectionFallback() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <SkeletonPanel />
      <SkeletonPanel />
    </div>
  );
}

/**
 * Die sechs Bereiche außerhalb von „Jetzt“. Die Hülle entscheidet, wie sie
 * eingerahmt werden (alte Kopfzeile/Seitenleiste bzw. neue Desktop-Shell);
 * gerendert wird hier **einmal**.
 */
export function SectionContent({
  ov,
  tab,
}: {
  ov: OverviewState;
  tab: TabId;
}): ReactNode {
  const {
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
    themeChoice,
    setThemeChoice,
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
    stripBand,
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
    dueFillPrice,
    handleConfirmRecommendedFill,
    handleQuickFill,
    handleVoidFill,
    handleDismissDue,
    handleIntent,
    showJobLog,
    fallbackNotice,
  } = ov;

  return (
    <>
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
            themeChoice,
            setThemeChoice,
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
    </>
  );
}
