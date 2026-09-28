import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "./Dashboard";
import { registerServiceWorker } from "./service-worker";
import "./styles.css";

// Der Konzept-Neubau („GUI v3“): echte Daten, echte Gates — dieselbe
// App, andere Gestaltung. Eigener Chunk, damit die klassische Ansicht
// nichts davon mitlädt.
const ConceptApp = lazy(() => import("./v3/App"));
const isConcept =
  new URLSearchParams(window.location.search).get("konzept") === "1";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isConcept ? (
      <Suspense fallback={<p className="p-8">Ansicht wird geladen …</p>}>
        <ConceptApp />
      </Suspense>
    ) : (
      <Dashboard />
    )}
  </React.StrictMode>,
);

// Offline an der Säule: App-Shell + letzte API-Antworten (max. 30 Min.).
// B10: Die Registrierung meldet zusätzlich einen **wartenden** Nachfolger —
// die Ansicht zeigt dann „Neue Version verfügbar“ samt eigener Version.
// webdriver = automatisierter Test: dort kein Cache zwischen App und Assertions.
if (
  !isConcept &&
  "serviceWorker" in navigator &&
  !import.meta.env.DEV &&
  !navigator.webdriver
) {
  window.addEventListener("load", () => registerServiceWorker());
}
