/* Theme vor dem ersten Paint anwenden (localStorage „tankapp.theme“).
   Voreinstellung ist „System“: Die Anzeige folgt `prefers-color-scheme`,
   Rückfall ist **dunkel**. Eine gespeicherte Wahl („dark“/„light“) sticht
   das System; der Schlüssel fehlt genau dann, wenn „System“ gewählt ist.
   React rechnet dieselben Regeln in src/theme.ts und hält Klasse und
   theme-color-Meta synchron.

   Warum eine eigene Datei statt eines Inline-Skripts: Der Server sendet
   `Content-Security-Policy: script-src 'self'` ohne 'unsafe-inline' — ein
   Inline-Block im <head> wäre damit gesperrt und die Umschaltung hätte beim
   Laden geflackert (Stand 0.30.0). Eine eigene, selbst gehostete Datei läuft
   unter `script-src 'self'` und blockiert als klassisches Skript im <head>
   weiterhin das erste Paint, solange sie ohne defer/async eingebunden ist. */
(function () {
  var theme = "dark";
  try {
    var stored = localStorage.getItem("tankapp.theme");
    if (stored !== null) {
      var choice = JSON.parse(stored);
      if (choice === "dark" || choice === "light") theme = choice;
    }
  } catch (e) {
    /* Storage gesperrt → System (bzw. dunkler Rückfall) entscheidet. */
  }
  if (theme === "dark") {
    try {
      if (window.matchMedia("(prefers-color-scheme: light)").matches) {
        theme = "light";
      }
    } catch (e) {
      /* Kein matchMedia: dunkler Rückfall bleibt. */
    }
  }
  if (theme === "light") {
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
    var lightMeta = document.querySelector('meta[name="theme-color"]');
    if (lightMeta) lightMeta.setAttribute("content", "#f5fbf5");
  }
})();
