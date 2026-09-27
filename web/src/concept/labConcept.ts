import type { Level } from "./data";

export const labStructure: Record<
  Level,
  { name: string; comp: string; why: string }[]
> = {
  full: [
    {
      name: "Kopfzeile „Labor“",
      comp: "Top App Bar + Beta-Badge",
      why: "Macht klar: Hier ist ein Bereich für Neugierige. Wer nur tanken will, muss ihn nie öffnen.",
    },
    {
      name: "Prognose mit Spielraum",
      comp: "Elevated Card + Fächer-Diagramm",
      why: "Übersetzt die Wahrscheinlichkeitsverteilung in ein Bild: eine Linie für den erwarteten Preis und ein heller Bereich, in dem er ziemlich sicher landet. Je weiter in der Zukunft, desto breiter.",
    },
    {
      name: "Was den Preis bewegt",
      comp: "Filled Card + Balken mit Richtungspfeilen",
      why: "Die Einflussfaktoren des Modells als Alltagsbegriffe (Tageszeit, Ölpreis, Konkurrenz vor Ort) mit Stärke und Richtung, ohne Zahlen.",
    },
    {
      name: "Wie oft lagen wir richtig?",
      comp: "Elevated Card + Punkte-Raster (30 Tage)",
      why: "Der Rückblick schafft Vertrauen: ein Punkt pro Tag, grün für richtig. Dazu, was die Empfehlungen konkret gespart hätten.",
    },
    {
      name: "Dein Tankprofil",
      comp: "Slider + Segmented Button",
      why: "Tankgröße und Wartebereitschaft steuern die Beispielrechnung. Das Ergebnis aktualisiert sich live in Euro pro Füllung und pro Jahr.",
    },
    {
      name: "Experimente",
      comp: "List mit Switches",
      why: "Neue Funktionen zum Ausprobieren. Jede hat einen Satz Erklärung und ist jederzeit abschaltbar.",
    },
    {
      name: "Für Technik-Fans",
      comp: "Expandable List (Accordion)",
      why: "Fachbegriffe, Fehlerwerte und Konzeptparameter stehen ganz unten und eingeklappt. Wer sie sucht, findet sie. Alle anderen sehen sie nicht.",
    },
  ],
  noForecast: [
    {
      name: "Kopfzeile & Status",
      comp: "Top App Bar + Inline Banner",
      why: "Der Hinweis nennt die fehlende Prognose. Der Neuversuch simuliert die Rückkehr.",
    },
    {
      name: "Typischer Verlauf",
      comp: "Elevated Card, gestrichelte SVG-Linie",
      why: "Ein Beispiel-Tagesverlauf ersetzt die Vorhersage. Er wird ausdrücklich als Orientierung beschriftet.",
    },
    {
      name: "Typische Einflüsse",
      comp: "Filled Card + Linear Progress",
      why: "Die Faktoren zeigen typische Einflüsse, nicht eine aktuell berechnete Modell-Erklärung.",
    },
    {
      name: "Rückblick",
      comp: "Elevated Card + Punkte-Raster",
      why: "Der Beispielmonat bleibt lesbar. Die Demo-Güte wird nicht als nachgewiesen ausgegeben.",
    },
    {
      name: "Dein Tankprofil",
      comp: "Slider + Segmented Button",
      why: "Die Beispielrechnung funktioniert unabhängig vom Modell und wird lokal gespeichert.",
    },
    {
      name: "Experimente",
      comp: "List mit Switches",
      why: "Lokal umschaltbar, mit wirksamem Rückgängig. Keine produktiven Feature-Flags.",
    },
    {
      name: "Für Technik-Fans",
      comp: "Expandable List",
      why: "Konzeptparameter bleiben verfügbar; der Link führt zum echten Live-Labor.",
    },
  ],
  offline: [
    {
      name: "Kopfzeile & Offline-Banner",
      comp: "Top App Bar + Warn Container",
      why: "Nennt den simulierten Stand 14:32 Uhr und bietet einen Neuversuch.",
    },
    {
      name: "Letzte Prognose",
      comp: "Elevated Card, graues SVG",
      why: "Die Kurve ist grau und datiert. Es sind gespeicherte Beispielwerte, keine aktuelle Prognose.",
    },
    {
      name: "Typische Einflüsse",
      comp: "Filled Card, graue Balken",
      why: "Orientierung statt Live-Erklärung. Die fehlende Aktualität wird im Untertitel genannt.",
    },
    {
      name: "Rückblick",
      comp: "Elevated Card + Punkte-Raster",
      why: "Der Beispielmonat braucht keine Verbindung.",
    },
    {
      name: "Dein Tankprofil",
      comp: "Slider + Segmented Button",
      why: "Die Berechnung und lokale Speicherung bleiben bedienbar. Keine Synchronisation wird versprochen.",
    },
    {
      name: "Experimente",
      comp: "List mit deaktivierten Switches",
      why: "Ausgegraut und begründet, statt versteckt oder erst nach dem Antippen abgelehnt.",
    },
    {
      name: "Für Technik-Fans",
      comp: "Expandable List",
      why: "Die lokalen Erklärungen bleiben lesbar. Das externe Live-Labor benötigt eine Verbindung.",
    },
  ],
};

const labCommonCopy: [string, string][] = [
  ["Titel", "Labor"],
  [
    "Einleitung",
    "Kein blindes Vertrauen. Entdecke, wie unsere Empfehlung entsteht.",
  ],
  [
    "Diagramm-Hinweis",
    "Je weiter wir vorausblicken, desto größer der Spielraum. Tippe auf einen Zeitpunkt.",
  ],
  ["Legende", "Unser bester Tipp · 80 % Spielraum"],
  ["Faktoren", "Was den Preis gerade bewegt"],
  ["Einflüsse", "Tageszeit · Ölpreis · Konkurrenz · Wochentag · Ferien"],
  ["Richtung", "drückt den Preis · treibt den Preis"],
  ["Rückblick", "An 26 von 30 Tagen lagen wir richtig"],
  [
    "Rückblick-Ergebnis",
    "Im Beispiel 18,40 € gespart. Keine nachgewiesene Modellgüte.",
  ],
  ["Profil", "Dein Tankprofil · So viel könnte Warten dir bringen."],
  ["Profil-Frage", "Wie lange kannst du warten?"],
  ["Wartebereitschaft", "Nie · Bis 2 Std. · Flexibel"],
  ["Ergebnis-Einheiten", "pro Füllung · hochgerechnet pro Jahr"],
  [
    "Rechenbasis",
    "Beispielrechnung: 24 Füllungen/Jahr; je nach Wartezeit 0, 3,5 oder 8 ct/L. Keine Spargarantie. Nur lokal gespeichert.",
  ],
  ["Experimente", "Neugierig? Probier etwas Neues."],
  ["Switches", "Wochenprognose · Umweg-Rechner · Smarter Preisalarm"],
  ["Snackbar", "Wochenprognose aktiviert. Nur im Prototyp."],
  ["Aktion", "Rückgängig"],
  ["Accordion", "Für Technik-Fans"],
  ["Modell (Konzept)", "Gradient Boosting"],
  ["MAE (Beispiel)", "± 1,1 ct/L"],
  ["Datenbasis (geplant)", "MTS-K · Markttransparenzstelle für Kraftstoffe"],
];
export const labCopy: Record<Level, [string, string][]> = {
  full: [
    ["Prognose-Karte", "Prognose mit Spielraum"],
    ["Untertitel", "Ein Tipp, kein Versprechen."],
    ...labCommonCopy,
  ],
  noForecast: [
    ["Banner-Titel", "Die Prognose macht gerade Pause."],
    ["Banner-Text", "Du siehst einen typischen Verlauf, keine Vorhersage."],
    ["Diagramm-Titel", "Typischer Verlauf"],
    ["Diagramm-Untertitel", "Orientierung statt Live-Vorhersage"],
    ["Faktoren-Untertitel", "Typische Einflüsse · nicht live berechnet"],
    ...labCommonCopy.filter(([key]) => key !== "Legende"),
  ],
  offline: [
    ["Banner-Titel", "Du bist offline. Stand: 14:32 Uhr."],
    ["Banner-Text", "Gespeicherte Beispielwerte, keine aktuelle Prognose."],
    ["Diagramm-Titel", "Letzte Prognose · 14:32 Uhr"],
    ["Experiment-Hinweis", "Zum Ändern brauchst du eine Verbindung."],
    ["Wiederverbinden", "Erneut versuchen · Verbinde …"],
    ...labCommonCopy.filter(([key]) => key !== "Legende" && key !== "Snackbar"),
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
  {
    c: "Top App Bar + Badge",
    u: "„Labor“ mit Beta-Kennzeichnung",
    n: "Das Badge setzt die Erwartung: experimentell, aber sicher.",
  },
  {
    c: "Elevated Card + Fächer-Diagramm",
    u: "Prognose mit Spielraum",
    n: "Das Band wird nach rechts breiter. Die Unsicherheit ist so zu sehen, ohne dass Zahlen nötig sind.",
  },
  {
    c: "Linear Progress (statisch)",
    u: "Stärke der Einflussfaktoren",
    n: "Dient als Balken, nicht als Ladeanzeige. Dazu ein Pfeil für die Richtung.",
  },
  {
    c: "Punkte-Raster",
    u: "Treffsicherheit 30 Tage",
    n: "Ein Punkt pro Tag. Das versteht man schneller als Prozent.",
  },
  {
    c: "Slider (continuous)",
    u: "Tankmenge 20–80 Liter",
    n: "Mit Wert-Anzeige. Das Ergebnis aktualisiert sich live.",
  },
  {
    c: "Segmented Button (3)",
    u: "Wartebereitschaft",
    n: "„Nie“ · „Bis 2 Std.“ · „Flexibel“",
  },
  {
    c: "Switch",
    u: "Experimente",
    n: "Wo die Aktion Netz braucht, ist der Switch deaktiviert und zeigt den Grund im Untertitel.",
  },
  {
    c: "Expandable List",
    u: "Für Technik-Fans",
    n: "Fachbegriffe sind eingeklappt und nie der Einstieg.",
  },
  {
    c: "Banner (inline)",
    u: "Fallback-Stufe 2 und 3",
    n: "Gleiche Logik wie im Guide. So verhält sich die ganze App gleich.",
  },
  {
    c: "Navigation Bar",
    u: "Vier Hauptbereiche",
    n: "Guide, Karte, Labor und Alarme bleiben stets erreichbar.",
  },
  {
    c: "Progress Indicator",
    u: "Neuversuch",
    n: "Der Spinner sitzt im Button und blockiert nicht das ganze Labor.",
  },
  {
    c: "Snackbar",
    u: "„Experiment aktiviert“",
    n: "Bestätigung mit „Rückgängig“.",
  },
];

type Row = { m: string; s: ("y" | "r" | "n")[] };
export const labMatrix: Row[] = [
  { m: "Prognose mit Spielraum", s: ["y", "r", "r"] },
  { m: "Was den Preis bewegt", s: ["y", "r", "r"] },
  { m: "Treffsicherheit (Rückblick)", s: ["y", "y", "y"] },
  { m: "Tankprofil & Rechner", s: ["y", "y", "y"] },
  { m: "Experimente schalten", s: ["y", "y", "n"] },
  { m: "Für Technik-Fans", s: ["y", "y", "y"] },
];

export const labPrinciples: [string, string][] = [
  [
    "Das Labor ist freiwillig",
    "Kein Inhalt im Guide hängt vom Labor ab. Es erklärt, es entscheidet nicht.",
  ],
  [
    "Unsicherheit wird zur Fläche",
    "Das Fächer-Diagramm macht Wahrscheinlichkeiten sichtbar, ohne sie zu nennen.",
  ],
  [
    "Gewohntes Wissen als Ersatz",
    "Fehlt die Prognose, zeigt die Karte den typischen Verlauf, klar als solcher beschriftet.",
  ],
  [
    "Deaktivieren statt verstecken",
    "Was offline nicht geht, bleibt sichtbar, ist ausgegraut und nennt den Grund.",
  ],
  [
    "Einstellungen gehen nie verloren",
    "Das Profil wird lokal gespeichert. Bei blockiertem Speicher gilt es nur für diese Sitzung; es gibt keine Server-Synchronisation.",
  ],
];
