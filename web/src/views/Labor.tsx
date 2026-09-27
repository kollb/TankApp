// Labor — B5: 4 Sub-Tabs (Überblick, Modell & Parameter, Güte, Daten)
// Wrapper <200 Zeilen: Header + Sub-Tab-Bar + Content-Delegation
import { useEffect } from "react";
import { BookOpen } from "lucide-react";
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
          <h1 id="labor-title" className="text-2xl font-bold tracking-tight text-white">
            Verstehen, warum die App das sagt
          </h1>
          {/* Beta-Badge und Leitsatz (Entwurf „Tankklar“): Das Labor ist
              freiwillig. Wer nur tanken will, muss es nie öffnen — der
              Guide funktioniert ohne jede Zahl von hier. */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wider text-violet-300">
              Beta
            </span>
            <p className="max-w-xl text-xs leading-relaxed text-slate-400">
              Alles hier ist optional. Die Empfehlung im Guide funktioniert
              auch ohne.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onOpenGlossary}
            className="tap-44 inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-violet-500/40"
          >
            <BookOpen size={14} aria-hidden="true" />
            Glossar
          </button>
        </div>
      </div>

      {/* Sub-Tab-Bar */}
      <div
        className="mb-4 flex flex-wrap gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1"
        role="tablist"
        aria-label="Labor Bereiche"
      >
        {LAB_SUBTABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={laborSubTab === tab.id}
            aria-controls={`labor-subtab-${tab.id}`}
            onClick={() => handleSubTab(tab.id)}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              laborSubTab === tab.id
                ? "bg-slate-800 text-violet-300 shadow"
                : "text-slate-500 hover:text-slate-200"
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
