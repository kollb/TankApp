# GUI-Vorlagen für die neue Homepage — behalten

> Stand: 12.09.2026. Übernahmeregeln für die beiden Prototypen in `sample/`.
> Früher `sample/README.md`; Dokumentation hat jetzt einen Ort (`docs/`).
> Die Regel selbst steht auch in [AGENTS.md](../AGENTS.md): Beim Aufräumen von
> Demo-Daten werden diese Vorlagen **nicht** gelöscht.

## Inhaltsverzeichnis

- [Vorlagen und Übernahme](#vorlagen-und-übernahme)
- [Visuelle Leitplanken aus dem vorhandenen Code](#visuelle-leitplanken-aus-dem-vorhandenen-code)
- [Daten und Design getrennt migrieren](#daten-und-design-getrennt-migrieren)

## Vorlagen und Übernahme

**Beide Prototypen sind ausdrücklich die gestalterische und technische Basis
der neuen TankApp-Homepage.** Nicht zusammen mit entbehrlichen Demo-Daten
löschen und nicht durch ein unverbundenes Landingpage-Design ersetzen.

| Vorlage | Übernahme |
|---|---|
| [`good gui`](../sample/good%20gui/) | Alltags-Homepage: `TankAppDashboard`, sticky Navigation, Kampagnen-/Kraftstoff-Umschalter, `DecisionCockpit`, Tagesstreifen, Umwegvergleich und Feedback-Karten. |
| [`good statistic gui`](../sample/good%20statistic%20gui/) | Werkstatt: `DecisionLab`, Scoreboard, Kalibrierungsdiagramm, Schwellen-Slider, `StationPanel`, `PairPanel` und SVG-Charts. |

## Visuelle Leitplanken aus dem vorhandenen Code

- Dunkler **Slate-950**-Hintergrund (`#020617`), Slate-900-Karten,
  dezente Slate-800-Rahmen; **Emerald** für aktive/positive Zustände,
  **Sky** für Kurven/Details, **Amber** für Warnungen/Schwellen.
- Die weichen Emerald-/Sky-Verläufe und Glows bleiben Teil der Gestaltung.
- System-Sans, kräftige weiße Überschriften, zurückhaltende Slate-Texte,
  kompakte Badges; `max-w-7xl` und die bestehenden responsiven Raster.
- Abgerundete Karten (`rounded-2xl` / `rounded-3xl`), Tabs, Regler,
  Tabellen und Diagramme aus den vorhandenen Komponenten übernehmen.
- Alltag: Kompass/Handlung zuerst. Werkstatt: das ausführliche Labor bleibt
  erhalten, nicht auf eine einzelne Kennzahlen-Kachel reduzieren.

## Daten und Design getrennt migrieren

Die enthaltenen Seeds/Simulatoren werden **noch für die Vorschau dieser
Oberflächen benötigt** und bleiben deshalb hier. Beide Samples verwenden
PostgreSQL/Demo-Logik und sind **keine produktive InfluxDB-Anbindung**.
Nicht mit Produktions-Zugangsdaten starten, keine Demo-Preise in den Live-Bucket
schreiben. Aussagen wie „kalibriert“, simulierte Ersparnisse und fixe
Gütewerte sind keine Nachweise der neuen Engine.

Die lauffähige gemeinsame Umsetzung liegt jetzt in `web/`: React/Tailwind,
Alltags-/Statistik-/Systemansicht, übernommene Slate/Emerald/Sky-Gestaltung und
adaptierte SVG-Charts. `app/` liefert die echten Nur-Lese-Schnittstellen; das
NAS-Image baut die GUI mit Vite, ohne die Next-/PostgreSQL-Demo-Runtime.
Noch nicht freigegebene Entscheidungs-, Feedback- und Kalibrierungsfunktionen
werden nicht durch die Demo-Implementierung ersetzt. Beide Vorlagen bleiben
für diese weitere Übernahme unverändert erhalten. Fehlende Daten als fehlend darstellen, nicht durch Sample-Werte ersetzen;
Kalibrierungs-Gate aus dem [Konzept](KONZEPT.md) beachten.
Erst nach visueller Prüfung beider Bereiche auf Desktop **und** Smartphone
werden nicht mehr benötigte Seed-/Prototyp-Dateien entfernt.