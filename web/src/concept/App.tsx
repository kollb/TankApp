import { radius } from "../components/ui";
import { useState } from "react";
import { MotionConfig } from "framer-motion";
import {
  ArrowUpRight,
  FlaskConical,
  Fuel as FuelIcon,
  Layers,
  Smartphone,
} from "lucide-react";
import ConceptPanel from "./ConceptPanel";
import PhoneApp, { type Screen } from "./PhoneApp";
import type { Fuel, Level, Verdict } from "./data";
import { usePrototypeState } from "./state";
import "./concept.css";

export default function App() {
  const [level, setLevel] = useState<Level>("full");
  const [verdict, setVerdict] = useState<Verdict>("now");
  const [fuel, setFuel] = usePrototypeState<Fuel>(
    "fuel",
    "E10",
    (x): x is Fuel => x === "E10" || x === "E5" || x === "Diesel",
  );
  const [annotate, setAnnotate] = useState(false);
  const [screen, setScreen] = useState<Screen>("guide");
  const [mobilePanel, setMobilePanel] = useState(false);
  return (
    <MotionConfig reducedMotion="user">
      <div className="concept-root">
        <header className="concept-topbar">
          <a href="/?konzept=1" className="tap-44 concept-wordmark">
            <span
              className={`grid grid-cols-1 h-9 w-9 place-items-center ${radius.inset} bg-primary text-white`}
            >
              <FuelIcon size={20} />
            </span>
            tankklar<span className="concept-version">DESIGN LAB</span>
          </a>
          <div className="hidden items-center gap-2 text-xs text-on-surface-variant md:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />{" "}
            Interaktiver Prototyp{" "}
            <span className="mx-2 text-outline-variant">/</span> Material Design
            3
          </div>
          <a
            href="/"
            className="tap-44 flex items-center gap-2 rounded-full border border-outline-variant px-4 py-2 text-xs font-semibold text-on-surface"
          >
            Live-App öffnen <ArrowUpRight size={14} />
          </a>
        </header>
        <div className="concept-modebar flex items-center justify-between border-b border-outline-variant/50 bg-sc-lowest px-4 py-2 lg:hidden">
          <span className="text-xs text-on-surface-variant">
            Demo · keine echten Live-Daten
          </span>
          <button
            onClick={() => setMobilePanel(!mobilePanel)}
            className="flex items-center gap-2 rounded-full bg-secondary-container px-3 py-2 text-xs font-semibold"
          >
            {mobilePanel ? <Smartphone size={14} /> : <Layers size={14} />}
            {mobilePanel ? "Zur App" : "Konzept & Steuerung"}
          </button>
        </div>
        <div className="concept-workspace">
          <section
            className={`concept-stage ${mobilePanel ? "concept-mobile-hidden" : ""}`}
            aria-label="Interaktive Smartphone-Vorschau"
          >
            <div className="concept-stage-label">
              <span className="flex items-center gap-2">
                <Smartphone size={14} /> LIVE PREVIEW
              </span>
              <span>
                01 —{" "}
                {screen === "lab"
                  ? "LABOR"
                  : screen === "map"
                    ? "KARTE"
                    : screen === "alarms"
                      ? "ALARME"
                      : "GUIDE"}
              </span>
            </div>
            <div className="concept-phone">
              <span className="concept-island" aria-hidden="true">
                <span />
              </span>
              <PhoneApp
                level={level}
                setLevel={setLevel}
                verdict={verdict}
                fuel={fuel}
                setFuel={setFuel}
                annotate={annotate}
                screen={screen}
                setScreen={setScreen}
              />
            </div>
            <div className="concept-stage-footer">
              <span className="inline-flex items-center gap-1.5">
                <FlaskConical size={12} /> Beispieldaten · keine Live-Empfehlung
              </span>
              <span>Alles im Mockup ist bedienbar.</span>
            </div>
          </section>
          <main
            className={`concept-panel ${!mobilePanel ? "concept-mobile-hidden" : ""}`}
            aria-label="UX-Konzept und Szenariosteuerung"
          >
            <ConceptPanel
              level={level}
              setLevel={setLevel}
              verdict={verdict}
              setVerdict={setVerdict}
              annotate={annotate}
              setAnnotate={setAnnotate}
              screen={screen}
              setScreen={(s) => {
                setScreen(s);
              }}
            />
            <section
              className={`mx-5 mb-8 ${radius.card} border border-outline-variant bg-sc-lowest p-5 lg:mx-10`}
            >
              <h2 className="text-sm font-semibold">
                Die ganze TankApp bleibt erreichbar
              </h2>
              <p className="mt-2 text-xs leading-5 text-on-surface-variant">
                Dieser Prototyp verwendet ausschließlich Beispieldaten.
                Bestehende API-Anbindung, Profile, Tankbuch, Alarme,
                Offline-Queue, Modelle und Systemfunktionen bleiben in der
                Live-App erhalten.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  ["jetzt", "Guide"],
                  ["stationen", "Karte & Tankstellen"],
                  ["woche", "Woche"],
                  ["ich", "Profile & Tankbuch"],
                  ["labor", "Live-Labor"],
                  ["system", "System"],
                ].map(([tab, label]) => (
                  <a
                    key={tab}
                    href={`/?tab=${tab}`}
                    className="tap-44 rounded-full bg-sc-low px-3 py-2 text-xs font-medium text-primary"
                  >
                    {label} ↗
                  </a>
                ))}
              </div>
            </section>
          </main>
        </div>
      </div>
    </MotionConfig>
  );
}
