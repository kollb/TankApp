/* C4: Theme vor dem ersten Paint anwenden (localStorage „tankapp.theme“,
   Default „dark“ = dunkles Slate, die Design-Basis). React übernimmt in
   Dashboard.tsx denselben Wert und hält meta/Classes synchron.

   Warum eine eigene Datei statt eines Inline-Skripts: Der Server sendet
   `Content-Security-Policy: script-src 'self'` ohne 'unsafe-inline' — ein
   Inline-Block im <head> wäre damit gesperrt und die Umschaltung hätte beim
   Laden geflackert (Stand 0.30.0). Eine eigene, selbst gehostete Datei läuft
   unter `script-src 'self'` und blockiert als klassisches Skript im <head>
   weiterhin das erste Paint, solange sie ohne defer/async eingebunden ist. */
try {
  var t = JSON.parse(localStorage.getItem("tankapp.theme") || '"dark"');
  if (t === "light") {
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", "#eef2f7");
  }
} catch (e) {
  /* Storage gesperrt → dunkler Default bleibt. */
}
