# GUI-Vorlagen für die neue Homepage — behalten

**Beide Prototypen sind ausdrücklich die gestalterische und technische Basis
der neuen TankApp-Homepage.** Nicht zusammen mit entbehrlichen Demo-Daten
löschen und nicht durch ein unverbundenes Landingpage-Design ersetzen.

| Vorlage | Übernahme |
|---|---|
| [`good gui`](good%20gui/) | Alltags-Homepage: `TankAppDashboard`, sticky Navigation, Kampagnen-/Kraftstoff-Umschalter, `DecisionCockpit`, Tagesstreifen, Umwegvergleich und Feedback-Karten. |
| [`good statistic gui`](good%20statistic%20gui/) | Statistik/Werkstatt: `DecisionLab`, Scoreboard, Kalibrierungsdiagramm, Schwellen-Slider, `StationPanel`, `PairPanel` und SVG-Charts. |

## Visuelle Leitplanken aus dem vorhandenen Code

- Dunkler **Slate-950**-Hintergrund (`#020617`), Slate-900-Karten,
  dezente Slate-800-Rahmen; **Emerald** für aktive/positive Zustände,
  **Sky** für Kurven/Details, **Amber** für Warnungen/Schwellen.
- Die weichen Emerald-/Sky-Verläufe und Glows bleiben Teil der Gestaltung.
- System-Sans, kräftige weiße Überschriften, zurückhaltende Slate-Texte,
  kompakte Badges; `max-w-7xl` und die bestehenden responsiven Raster.
- Abgerundete Karten (`rounded-2xl` / `rounded-3xl`), Tabs, Regler,
  Tabellen und Diagramme aus den vorhandenen Komponenten übernehmen.
- Alltag: Kompass/Handlung zuerst. Statistik: das ausführliche Labor bleibt
  erhalten, nicht auf eine einzelne Kennzahlen-Kachel reduzieren.

## Daten und Design getrennt migrieren

Die enthaltenen Seeds/Simulatoren werden **noch für die Vorschau dieser
Oberflächen benötigt** und bleiben deshalb hier. Beide Samples verwenden
PostgreSQL/Demo-Logik und sind **keine produktive InfluxDB-Anbindung**.
Nicht mit Produktions-Zugangsdaten starten, keine Demo-Preise in den Live-Bucket
schreiben. Aussagen wie „kalibriert“, simulierte Ersparnisse und fixe
Gütewerte sind keine Nachweise der neuen Engine.

Bei M4/M5: Komponenten in eine gemeinsame Homepage mit Alltag und Werkstatt
überführen, Datenzugriff/Entscheidungslogik durch die echten Server-Schnittstellen
ersetzen. Fehlende Daten als fehlend darstellen, nicht durch Sample-Werte ersetzen;
Kalibrierungs-Gate aus dem [Konzept](../docs/KONZEPT.md) beachten.
Erst nach visueller Prüfung beider Bereiche auf Desktop **und** Smartphone
werden nicht mehr benötigte Seed-/Prototyp-Dateien entfernt.
