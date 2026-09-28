// Einstieg des Konzept-Neubaus („GUI v3“), erreichbar über `/?konzept=1`.
//
// Die alte Oberfläche bleibt unter `/` unverändert erreichbar; dieser Zweig
// ist der ausführliche, **echte** Neubau: dieselben Endpunkte, dieselben
// Freigabegates, dieselben Formatter — nur die Gestaltung und die Anordnung
// kommen aus dem Konzept. Kein Beispiel-Handy, keine Demo-Preise.
//
// Bereiche: „Jetzt“ (`v3/Guide.tsx`) und „Woche“ (`v3/Week.tsx`) sind neu
// gebaut. Die übrigen fünf Bereiche rendert `views/Sections.tsx` — derselbe
// Code wie in der alten Hülle, damit beide Oberflächen nie auseinanderlaufen.
// Ein Hinweisstreifen sagt offen, wo noch die bisherige Gestaltung steht;
// sobald ein Bereich migriert ist, verschwindet der Streifen für ihn.
//
// Der Bereich reist in der Adresse (`?tab=…`); `konzept=1` bleibt erhalten,
// weil `gotoTab` (state/overview) die übrigen Parameter unverändert lässt.

import { Suspense } from "react";
import { Info } from "lucide-react";
import { radius } from "../components/ui";
import type { TabId } from "../routing";
import { OverviewProvider, useOverview } from "../state/overview";
import { SectionContent, SectionFallback } from "../views/Sections";
import { V3Guide } from "./Guide";
import { V3Shell } from "./Shell";
import { V3Week } from "./Week";
import "./v3.css";

/** Bereiche, die noch in der bisherigen Gestaltung laufen. */
const LEGACY_NOTE: Partial<Record<TabId, string>> = {
  stations:
    "„Stationen“ läuft noch in der bisherigen Gestaltung — dieselben Meldungen, dieselbe Karte.",
  labor:
    "„Labor“ läuft noch in der bisherigen Gestaltung — dieselben Modelle, dieselben Messungen.",
  ich: "„Ich“ läuft noch in der bisherigen Gestaltung — dieselben Belege, dieselbe Bilanz.",
  system:
    "„System“ läuft noch in der bisherigen Gestaltung — derselbe Zustand, dieselben Läufe.",
  glossary:
    "„Glossar“ läuft noch in der bisherigen Gestaltung — dieselben Begriffe.",
};

function LegacyNote({ tab }: { tab: TabId }) {
  const text = LEGACY_NOTE[tab];
  if (!text) return null;
  return (
    <p
      className={`mb-4 flex items-start gap-2.5 border border-outline-variant bg-sc-low p-3 text-xs leading-relaxed text-on-surface-variant ${radius.card}`}
    >
      <Info size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span className="min-w-0">
        {text} Der Neubau übernimmt diesen Bereich, sobald seine Gestaltung
        geprüft ist; bis dahin bleibt hier nichts unerreichbar.
      </span>
    </p>
  );
}

function Routes() {
  const ov = useOverview();
  return (
    <V3Shell ov={ov}>
      <Suspense fallback={<SectionFallback />}>
        {ov.tab === "jetzt" ? (
          <V3Guide />
        ) : ov.tab === "week" ? (
          <V3Week />
        ) : (
          <>
            <LegacyNote tab={ov.tab} />
            <SectionContent ov={ov} tab={ov.tab} />
          </>
        )}
      </Suspense>
    </V3Shell>
  );
}

export default function V3App() {
  return (
    <OverviewProvider>
      <Routes />
    </OverviewProvider>
  );
}
