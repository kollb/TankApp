import React from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "./state/AppContext";
import { AppShell } from "./components/layout/AppShell";
import { registerServiceWorker } from "./service-worker";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("App root (#root) fehlt");

createRoot(root).render(<React.StrictMode><AppProvider><AppShell /></AppProvider></React.StrictMode>);

if ("serviceWorker" in navigator && !import.meta.env.DEV && !navigator.webdriver) {
  window.addEventListener("load", () => registerServiceWorker());
}
