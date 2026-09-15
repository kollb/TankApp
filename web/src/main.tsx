import React from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "./Dashboard";
import { registerServiceWorker } from "./service-worker";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Dashboard />
  </React.StrictMode>,
);

// Offline an der Säule: App-Shell + letzte API-Antworten (max. 30 Min.).
// B10: Die Registrierung meldet zusätzlich einen **wartenden** Nachfolger —
// die Ansicht zeigt dann „Neue Version verfügbar“ samt eigener Version.
// webdriver = automatisierter Test: dort kein Cache zwischen App und Assertions.
if (
  "serviceWorker" in navigator &&
  !import.meta.env.DEV &&
  !navigator.webdriver
) {
  window.addEventListener("load", () => registerServiceWorker());
}
