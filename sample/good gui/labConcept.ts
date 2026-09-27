import type { Level } from "./data";

export const labStructure: Record<Level, { name: string; comp: string; why: string }[]> = {
  full: [
    { name: "Kopfzeile „Labor“", comp: "Top App Bar + Beta-Badge", why: "Macht klar: Hier ist ein Bereich für Neugierige. Wer nur tanken will, muss ihn nie öffnen." },
    { name: "Prognose mit Spielraum", comp: "Elevated Card + Fächer-Diagramm", why: "Übersetzt die Wahrscheinlichkeitsverteilung in ein Bild: eine Linie für den erwarteten Preis und ein heller Bereich, in dem er ziemlich sicher landet. Je weiter in der Zukunft, desto breiter." },
    { name: "Was den Preis bewegt", comp: "Filled Card + Balken mit Richtungspfeilen", why: "Die Einflussfaktoren des Modells als Alltagsbegriffe (Tageszeit, Ölpreis, Konkurrenz vor Ort) mit Stärke und Richtung, ohne Zahlen." },
    { name: "Wie oft lagen wir richtig?", comp: "Elevated Card + Punkte-Raster (30 Tage)", why: "Der Rückblick schafft Vertrauen: ein Punkt pro Tag, grün für richtig. Dazu, was die Empfehlungen konkret gespart hätten." },
    { name: "Dein Tankprofil", comp: "Slider + Segmented Button", why: "Tankgröße und Wartebereitschaft steuern die Empfehlung. Das Ergebnis aktualisiert sich live in Euro pro Füllung und pro Jahr." },
    { name: "Experimente", comp: "List mit Switches", why: "Neue Funktionen zum Ausprobieren. Jede hat einen Satz Erklärung und ist jederzeit abschaltbar." },
    { name: "Für Technik-Fans", comp: "Expandable List (Accordion)", why: "Fachbegriffe, Fehlerwerte und Modellversion stehen ganz unten und eingeklappt. Wer sie sucht, findet sie. Alle anderen sehen sie nicht." },
  ],
  noForecast: [
    { name: "Kopfzeile „Labor“", comp: "Top App Bar + Beta-Badge", why: "Unverändert. Der Live-Status bleibt grün, weil die Preise weiter kommen." },
    { name: "Status-Banner", comp: "Inline Banner (neutral)", why: "Sagt, dass die Prognose pausiert, und zählt auf, was im Labor weiter funktioniert." },
    { name: "Prognose → typischer Verlauf", comp: "Elevated Card, gestrichelte Linie", why: "Statt eines leeren Diagramms zeigt die Karte den durchschnittlichen Tagesverlauf. Sie ist klar als „typisch“ beschriftet, nicht als Prognose." },
    { name: "Was den Preis bewegt", comp: "Filled Card, Stand gestern", why: "Die Faktoren bleiben sichtbar, bekommen aber ein Datum. Sie ändern sich ohnehin nur langsam." },
    { name: "Wie oft lagen wir richtig?", comp: "Elevated Card", why: "Vollständig verfügbar, weil es Vergangenheitsdaten sind." },
    { name: "Dein Tankprofil", comp: "Slider + Segmented Button", why: "Einstellbar. Der Rechner nutzt übliche Tagesschwankungen statt der Prognose und sagt das auch." },
    { name: "Experimente", comp: "List mit Switches", why: "Einstellbar. Die Änderungen wirken, sobald die Prognose zurück ist." },
  ],
  offline: [
    { name: "Kopfzeile „Labor“", comp: "Top App Bar + Offline-Chip", why: "Grauer „Offline“-Chip statt „Live“." },
    { name: "Offline-Banner", comp: "Inline Banner (Warn Container)", why: "Nennt den Datenstand und was ohne Netz nicht geht. Dazu ein Button zum erneuten Verbinden." },
    { name: "Prognose → letzter Stand", comp: "Elevated Card, gedämpft", why: "Die letzte heruntergeladene Prognose, grau und mit Uhrzeit. Man kann sie noch lesen, sie wirkt aber nicht mehr aktuell." },
    { name: "Was den Preis bewegt", comp: "Filled Card, gedämpft", why: "Aus dem Cache, mit Uhrzeit." },
    { name: "Wie oft lagen wir richtig?", comp: "Elevated Card", why: "Aus dem Cache. Der Rückblick braucht kein Netz." },
    { name: "Dein Tankprofil", comp: "Slider + Segmented Button", why: "Wird lokal gespeichert und später synchronisiert. Der Nutzer verliert nichts." },
    { name: "Experimente", comp: "List mit deaktivierten Switches", why: "Ausgegraut mit dem Grund „Braucht eine Verbindung“, statt sie zu verstecken oder beim Antippen einen Fehler zu zeigen." },
  ],
};

export const labCopy: Record<Level, [string, string][]> = {
  full: [
    ["Titel", "Labor"],
    ["Intro", "So rechnet Tankklar. Alles hier ist optional. Die Empfehlung im Guide funktioniert auch ohne."],
    ["Prognose-Karte", "Prognose mit Spielraum"],
    ["Prognose-Erklärung", "Die Linie ist unser bester Tipp. Im hellen Bereich landet der Preis ziemlich sicher."],
    ["Faktoren-Karte", "Was den Preis gerade bewegt"],
    ["Rückblick", "An 26 von 30 Tagen lagen wir richtig"],
    ["Rückblick-Ergebnis", "Wer unseren Tipps gefolgt ist, hat ca. 11,40 € gespart."],
    ["Profil-Frage", "Wie lange würdest du warten?"],
    ["Profil-Ergebnis", "Mit deinem Profil sparst du ca. 3,15 € pro Füllung."],
    ["Experimente", "Neue Ideen zum Ausprobieren. Jederzeit abschaltbar."],
    ["Accordion", "Für Technik-Fans"],
  ],
  noForecast: [
    ["Banner-Titel", "Die Prognose macht gerade Pause"],
    ["Banner-Text", "Rückblick, Profil und Experimente funktionieren weiter."],
    ["Diagramm-Titel", "So verläuft ein typischer Tag"],
    ["Diagramm-Hinweis", "Durchschnitt der letzten 8 Wochen, keine Prognose für heute."],
    ["Faktoren-Stand", "Stand gestern, 22 Uhr"],
    ["Profil-Hinweis", "Gerechnet mit üblichen Tagesschwankungen."],
  ],
  offline: [
    ["Banner-Titel", "Du bist offline"],
    ["Banner-Text", "Du siehst den Stand von 14:32 Uhr. Experimente brauchen eine Verbindung."],
    ["Diagramm-Titel", "Letzte Prognose · 14:32 Uhr"],
    ["Experiment-Hinweis", "Braucht eine Verbindung"],
    ["Profil-Hinweis", "Wird gespeichert und später synchronisiert."],
  ],
};

export const labRewrites: [string, string][] = [
  ["80-%-Prognoseintervall", "Hier landet der Preis ziemlich sicher"],
  ["Feature Importance", "Was den Preis gerade bewegt"],
  ["Backtest Hit-Rate: 86,7 %", "An 26 von 30 Tagen lagen wir richtig"],
  ["Risikoaversions-Parameter λ", "Wie lange würdest du warten?"],
  ["Quantil-Regression, Median", "Unser bester Tipp"],
  ["Feature-Flag: forecast_weekly", "Wochenprognose ausprobieren"],
  ["Stale cache (TTL expired)", "Stand 14:32 Uhr"],
];

export const labComponents = [
  { c: "Top App Bar + Badge", u: "„Labor“ mit Beta-Kennzeichnung", n: "Das Badge setzt die Erwartung: experimentell, aber sicher." },
  { c: "Elevated Card + Fächer-Diagramm", u: "Prognose mit Spielraum", n: "Das Band wird nach rechts breiter. Die Unsicherheit ist so zu sehen, ohne dass Zahlen nötig sind." },
  { c: "Linear Progress (statisch)", u: "Stärke der Einflussfaktoren", n: "Dient als Balken, nicht als Ladeanzeige. Dazu ein Pfeil für die Richtung." },
  { c: "Punkte-Raster", u: "Treffsicherheit 30 Tage", n: "Ein Punkt pro Tag. Das versteht man schneller als Prozent." },
  { c: "Slider (continuous)", u: "Tankmenge 20–80 Liter", n: "Mit Wert-Anzeige. Das Ergebnis aktualisiert sich live." },
  { c: "Segmented Button (3)", u: "Wartebereitschaft", n: "„Nie“ · „Bis 2 Std.“ · „Flexibel“" },
  { c: "Switch", u: "Experimente", n: "Wo die Aktion Netz braucht, ist der Switch deaktiviert und zeigt den Grund im Untertitel." },
  { c: "Expandable List", u: "Für Technik-Fans", n: "Fachbegriffe sind eingeklappt und nie der Einstieg." },
  { c: "Banner (inline)", u: "Fallback-Stufe 2 und 3", n: "Gleiche Logik wie im Guide. So verhält sich die ganze App gleich." },
  { c: "Snackbar", u: "„Experiment aktiviert“", n: "Bestätigung mit „Rückgängig“." },
];

type Row = { m: string; s: ("y" | "r" | "n")[] };
export const labMatrix: Row[] = [
  { m: "Prognose mit Spielraum", s: ["y", "r", "r"] },
  { m: "Was den Preis bewegt", s: ["y", "r", "r"] },
  { m: "Treffsicherheit (Rückblick)", s: ["y", "y", "y"] },
  { m: "Tankprofil & Rechner", s: ["y", "r", "y"] },
  { m: "Experimente schalten", s: ["y", "y", "n"] },
  { m: "Für Technik-Fans", s: ["y", "y", "y"] },
];

export const labPrinciples: [string, string][] = [
  ["Das Labor ist freiwillig", "Kein Inhalt im Guide hängt vom Labor ab. Es erklärt, es entscheidet nicht."],
  ["Unsicherheit wird zur Fläche", "Das Fächer-Diagramm macht Wahrscheinlichkeiten sichtbar, ohne sie zu nennen."],
  ["Gewohntes Wissen als Ersatz", "Fehlt die Prognose, zeigt die Karte den typischen Verlauf, klar als solcher beschriftet."],
  ["Deaktivieren statt verstecken", "Was offline nicht geht, bleibt sichtbar, ist ausgegraut und nennt den Grund."],
  ["Einstellungen gehen nie verloren", "Das Profil wird lokal gespeichert und später synchronisiert."],
];
