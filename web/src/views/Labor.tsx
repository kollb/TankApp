// Labor — B5: 4 Sub-Tabs (Überblick, Modell & Parameter, Güte, Daten)
// Wrapper <200 Zeilen: Header + Sub-Tab-Bar + Content-Delegation
import { useEffect } from "react";
import { BookOpen } from "lucide-react";
import { panel } from "../components/ui";
import { FreshnessLine } from "../components/FreshnessLine";
import { LAB_SUBTABS, labSubTabForSection, type LabSectionId, type LabSubTabId } from "../lab";
import { useOverview } from "../state/overview";
import { UeberblickView } from "./labor/Ueberblick";
import { ModellView } from "./labor/Modell";
import { GueteView } from "./labor/Guete";
import { DatenView } from "./labor/Daten";

export interface LaborViewProps {
  focusSection: LabSectionId | null;
  onFocusHandled: () => void;
  onNavigate: (target: any) => void;
  onOpenGlossary: () => void;
}

const LAB_ACCENT = "text-violet-300";

export function LaborView(props: LaborViewProps) {
  const { focusSection, onFocusHandled, onOpenGlossary } = props;
  const ov = useOverview();
  const { laborSubTab, gotoTab, setLaborFocus } = ov;

  // Wenn focusSection aus Erklär-Treppe kommt, Sub-Tab daraus ableiten
  useEffect(() => {
    if (!focusSection) return;
    // Karte-Anker wie "karte-6-selektion" → modell
    if (typeof focusSection === "string" && (focusSection as string).startsWith("karte-")) {
      const anchor = focusSection as string;
      if (anchor.includes("struktur") || anchor.includes("ar2") || anchor.includes("bootstrap") || anchor.includes("projektion") || anchor.includes("ensemble") || anchor.includes("selektion") || anchor.includes("schwellen") || anchor.includes("regime") || anchor.includes("spielplatz") || anchor.includes("stationen")) {
        if (laborSubTab !== "modell") gotoTab("labor", undefined, "modell" as LabSubTabId);
      }
      return;
    }
    const needed = labSubTabForSection(focusSection as LabSectionId);
    if (needed !== laborSubTab) {
      gotoTab("labor", focusSection as LabSectionId, needed);
    }
  }, [focusSection, laborSubTab, gotoTab]);

  const handleSubTab = (next: LabSubTabId) => {
    gotoTab("labor", undefined, next);
  };

  const handleFocusHandled = () => {
    onFocusHandled();
    setLaborFocus(null);
  };

  return (
    <section aria-labelledby="labor-title" className="pb-2">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={`text-xs font-bold uppercase tracking-[.3em] ${LAB_ACCENT}`}>◈ Labor</p>
          <h1 id="labor-title" className="mt-1 text-2xl font-bold tracking-tight text-white">
            Verstehen, warum die App das sagt
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">
            Vier Bereiche: Überblick (eine offene Sektion), Modell & Parameter (8 Karten im Raster, eine offen),
            Güte & Kalibrierung, Daten & Rohdaten. Erklär-Treppe: ?subtab=…&section=…#karte-…
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onOpenGlossary}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-violet-500/40"
          >
            <BookOpen size={14} aria-hidden="true" />
            Glossar
          </button>
        </div>
      </div>

      {/* Sub-Tab-Bar */}
      <div className={`${panel} mb-4 flex flex-wrap gap-1.5 p-2`} role="tablist" aria-label="Labor Bereiche">
        {LAB_SUBTABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={laborSubTab === tab.id}
            aria-controls={`labor-subtab-${tab.id}`}
            onClick={() => handleSubTab(tab.id)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              laborSubTab === tab.id
                ? "border-violet-500/40 bg-violet-500/10 text-violet-200"
                : "border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div id={`labor-subtab-${laborSubTab}`} role="tabpanel">
        {laborSubTab === "ueberblick" && (
          <UeberblickView focusSection={focusSection} onFocusHandled={handleFocusHandled} />
        )}
        {laborSubTab === "modell" && (
          <ModellView focusSection={focusSection} onFocusHandled={handleFocusHandled} />
        )}
        {laborSubTab === "guete" && (
          <GueteView focusSection={focusSection} onFocusHandled={handleFocusHandled} />
        )}
        {laborSubTab === "daten" && <DatenView />}
      </div>

      {/* Frische-Fußzeile — fester Platz, jede Ansicht */}
      <FreshnessLine text={ov.data ? `Preise vor Ort` : "Preise werden geladen"} tone={ov.data ? "ok" : "warn"} place={ov.activeCity} />
    </section>
  );
}
