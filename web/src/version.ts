// B10: Version der **laufenden Ansicht** — beim Build gestempelt (vite.config.ts
// ersetzt `__APP_VERSION__` durch `VERSION` aus app/version.py, dieselbe Zahl
// wie im Footer und in /api/v1/health).
//
// Warum das nötig ist: Ein installiertes Fenster kann auf einer alten
// App-Shell sitzen. Der Update-Hinweis nennt dann die Version, die dort
// wirklich läuft — statt einer Zahl, die nur der Server kennt.

declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" && __APP_VERSION__
    ? __APP_VERSION__
    : "dev";
