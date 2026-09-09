import React from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "./Dashboard";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Dashboard />
  </React.StrictMode>,
);

// Offline an der Säule: App-Shell + letzte API-Antworten (max. 30 Min.).
// webdriver = automatisierter Test: dort kein Cache zwischen App und Assertions.
if (
  "serviceWorker" in navigator &&
  !import.meta.env.DEV &&
  !navigator.webdriver
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* Offline-Cache ist Bonus; die App läuft auch ohne. */
    });
  });
}
