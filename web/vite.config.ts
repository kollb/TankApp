import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";

/**
 * Die App-Version steht in `app/version.py` (eine Quelle für Footer,
 * `/api/v1/health` und GUI-Build). Der GUI-Build liest sie von dort; fehlt
 * die Datei (z. B. isolierter Web-Checkout), greift package.json.
 */
function appVersion(): string {
  try {
    const raw = readFileSync(
      fileURLToPath(new URL("../app/version.py", import.meta.url)),
      "utf8",
    );
    const match = raw.match(/^VERSION\s*=\s*"([^"]+)"/m);
    if (match) return match[1];
  } catch {
    /* Fallback unten. */
  }
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
  ) as { version?: string };
  return pkg.version || "0.0.0";
}

/**
 * B10: Die App-Shell trägt die App-Version. Vorher stand in `sw.js` ein festes
 * `…-v1`: Ein Update blieb unsichtbar, und ein installiertes Fenster konnte
 * auf der alten Shell sitzen, ohne dass es irgendwo stand.
 *
 * Der Platzhalter wird **nur** beim Build ersetzt; bleibt er stehen, bricht
 * der Build ab — eine ausgelieferte Shell mit Platzhalter wäre genau die
 * stille Lüge, die dieser Punkt beseitigt.
 */
export function stampServiceWorker(version: string): Plugin {
  return {
    name: "tankapp-sw-version",
    apply: "build",
    closeBundle() {
      const target = fileURLToPath(new URL("./dist/sw.js", import.meta.url));
      const raw = readFileSync(target, "utf8");
      if (!raw.includes("__APP_VERSION__")) {
        throw new Error(
          "web/dist/sw.js trägt keinen __APP_VERSION__-Platzhalter — " +
            "public/sw.js und dieses Plugin gehören zusammen (B10).",
        );
      }
      const stamped = raw.replaceAll("__APP_VERSION__", version);
      if (stamped.includes("__APP_VERSION__")) {
        throw new Error("web/dist/sw.js: Platzhalter nicht vollständig ersetzt.");
      }
      writeFileSync(target, stamped, "utf8");
    },
  };
}

const version = appVersion();

export default defineConfig({
  plugins: [tailwindcss(), stampServiceWorker(version)],
  // B10: Die laufende Ansicht kennt ihre eigene Version (`src/version.ts`).
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    host: "0.0.0.0",
    allowedHosts: [".e2b.app"],
    proxy: { "/api": "http://127.0.0.1:1355" },
  },
});
