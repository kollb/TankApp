import { defineConfig } from "@playwright/test";

// E2E **ohne Mocks**: eigene Suite gegen den Demo-Stack aus `ops/quality/`
// (derselbe `make_server`-Pfad wie im Betrieb, nur mit injizierter
// Preisabfrage statt InfluxDB und einer vorab gerechneten Engine-Publikation).
//
// Warum getrennt von `playwright.config.ts`: Die Alltagssuite mockt jeden
// `/api/v1/*`-Pfad per `page.route` und beweist damit Rendering-Logik, nicht
// die Integration Server ↔ GUI. Genau deshalb fielen B1 (NaN brach
// `/last_forecasts`), B3 (UTC statt Ortszeit) und der defekte Demo-Stack in
// den 15.09.-Sanity-Check statt in die CI (docs/LUECKEN.md, „Bewusst offen“).
//
// Aufruf: `npm --prefix web run test:e2e:demo` — der GUI-Build (`npm run
// build`) muss stehen, weil der Demo-Server `web/dist` ausliefert. Der Server
// wird hier gestartet; die Rohdaten entstehen deterministisch (fester Samen)
// unter `.demo-e2e-data/` und sind nicht versioniert.
export default defineConfig({
  testDir: "./e2e",
  // Nur diese Dateien — die gemockten Specs gehören zur Alltagssuite und
  // erwarten deren Server auf 1355. `mobile.spec.ts` misst die Mobil-Zusagen
  // (kein Querlauf, keine überlaufenden Zellen) und braucht dafür echte
  // Server-Antworten; im `desktop`-Projekt überspringt es sich selbst.
  testMatch: /(demo|mobile)\.spec\.ts/,
  reporter: process.env.CI ? "github" : "list",
  // Genau ein Worker: Beide Projekte teilen sich einen Demo-Server mit einer
  // Store-Datei. Parallel laufende Projekte haben sich gegenseitig die O17-
  // Seeds überschrieben (dieselben Episode-IDs) und die Store-Schreibvorgänge
  // des einen Projekts haben dem ETag-Test des anderen die 304er gekostet
  // (data_version hängt am Feedback-Store). ~45 s mehr Laufzeit, dafür kein
  // Flake mehr aus Projekt-Kollisionen.
  workers: 1,
  // Der Aufbau rechnet echte Engine-Fits (45 Tage Demo-Verlauf) — das dauert
  // Minutenfrist, nicht Sekunden.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  webServer: {
    command: `${
      process.platform === "win32" ? "py -3" : "python3"
    } ../ops/quality/demo_server.py --rebuild --data-dir ../.demo-e2e-data --static dist --port 1357`,
    // Bereitschaft wird am echten Health-Endpunkt geprüft, nicht an einer
    // Wartezeit (dieselbe Regel wie im Qualitäts-Workflow).
    url: "http://127.0.0.1:1357/api/v1/health",
    env: {
      // Die Suite lädt mehrere Panels parallel; die Produktionsquote ist hier
      // nicht der Prüfgegenstand (Rate-Limit hat eigene Python-Tests).
      TANKAPP_RATE_ANON_PER_MIN: "100000",
      TANKAPP_RATE_ANON_PER_DAY: "10000000",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
  use: {
    baseURL: process.env.TANKAPP_DEMO_URL || "http://127.0.0.1:1357",
    headless: true,
    trace: "retain-on-failure",
    // Wie in playwright.config.ts: Wo Playwright seinen Browser nicht laden
    // darf (abgeschottete Umgebungen), zeigt `PLAYWRIGHT_CHROMIUM_EXECUTABLE`
    // auf ein vorhandenes Chromium. Ohne diesen Haken war ausgerechnet die
    // Mobil-Suite — die hier liegt — dort nicht lauffähig (0.55.0).
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        }
      : {},
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1050 } } },
    {
      name: "mobile",
      // Siehe playwright.config.ts: ohne `isMobile`, weil die Headless-
      // Mobile-Emulation auf GPU-losen Läufern den Viewport verzerrt und
      // damit fixe Bottom-Leisten unklickbar macht; Breite reicht fürs Raster.
      use: { viewport: { width: 390, height: 844 }, hasTouch: true },
    },
  ],
});
