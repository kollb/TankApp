import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  webServer: process.env.TANKAPP_TEST_URL
    ? undefined
    : {
        command: `${process.platform === "win32" ? "py -3" : "python3"} ../tankapp.py serve --host 0.0.0.0 --port 1355`,
        url: "http://127.0.0.1:1355/api/v1/health",
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
      },
  use: {
    baseURL: process.env.TANKAPP_TEST_URL || "http://127.0.0.1:1355",
    headless: true,
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
      use: { viewport: { width: 390, height: 844 }, isMobile: true },
    },
  ],
});
