import { useState } from "react";
import ConceptPanel from "./components/ConceptPanel";
import PhoneApp, { type Screen } from "./components/PhoneApp";
import type { Fuel, Level, Verdict } from "./data";

export default function App() {
  const [level, setLevel] = useState<Level>("full");
  const [verdict, setVerdict] = useState<Verdict>("now");
  const [fuel, setFuel] = useState<Fuel>("E10");
  const [annotate, setAnnotate] = useState(false);
  const [screen, setScreen] = useState<Screen>("guide");

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_20%_20%,#d4efe0_0%,#e3ebe5_45%,#e6ebe7_100%)] lg:h-screen lg:overflow-hidden">
      <div className="mx-auto h-full max-w-[1440px] lg:grid lg:grid-cols-[minmax(460px,0.9fr)_minmax(0,1.1fr)]">
        <div className="flex items-center justify-center lg:h-screen lg:py-6">
          <div className="relative h-[100dvh] w-full overflow-hidden bg-surface lg:h-[min(844px,calc(100vh-48px))] lg:w-[400px] lg:rounded-[52px] lg:border-[10px] lg:border-[#1a1f1c] lg:shadow-[0_30px_80px_-20px_rgba(0,40,25,.45)]">
            <span className="absolute left-1/2 top-2 z-30 hidden h-6 w-24 -translate-x-1/2 rounded-full bg-[#1a1f1c] lg:block" />
            <PhoneApp
              level={level} setLevel={setLevel} verdict={verdict} fuel={fuel} setFuel={setFuel}
              annotate={annotate} screen={screen} setScreen={setScreen}
            />
          </div>
        </div>
        <main className="bg-surface/60 lg:h-screen lg:overflow-y-auto lg:border-l lg:border-outline-variant/60">
          <ConceptPanel
            level={level} setLevel={setLevel}
            verdict={verdict} setVerdict={setVerdict}
            annotate={annotate} setAnnotate={setAnnotate}
            screen={screen} setScreen={setScreen}
          />
        </main>
      </div>
    </div>
  );
}
