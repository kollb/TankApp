/* C4: Theme vor dem ersten Paint anwenden (localStorage „tankapp.theme“,
   Default „light“ = helles Material-You-Schema, die neue Design-Basis
   (UX-Konzept v2, sample/good gui). React übernimmt in data.ts denselben
   Wert und hält meta/Classes synchron.

   Warum eine eigene Datei statt eines Inline-Skripts: Der Server sendet
   `Content-Security-Policy: script-src 'self'` ohne 'unsafe-inline' — ein
   Inline-Block im <head> wäre damit gesperrt und die Umschaltung hätte beim
   Laden geflackert (Stand 0.30.0). Eine eigene, selbst gehostete Datei läuft
   unter `script-src 'self'` und blockiert als klassisches Skript im <head>
   weiterhin das erste Paint, solange sie ohne defer/async eingebunden ist. */
try {
  var t = JSON.parse(localStorage.getItem("tankapp.theme") || '"light"');
  if (t === "dark") {
    document.documentElement.classList.remove("light");
    document.documentElement.classList.add("dark");
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", "#0b0f19");
  }
} catch (e) {
  /* Storage gesperrt → heller Default bleibt. */
}
