# Oberfläche und Interaktion

> Stand: 20.09.2026 · App-Version 0.59.1
> Beschreibt die implementierte Navigation einschließlich Labor-Unterbereichen.
> Offene Abnahme: [TODO B5](../planung/TODO.md#b5-labor-überlauf-beheben).

## Inhaltsverzeichnis

- [Navigation](#navigation)
- [Bereiche](#bereiche)
- [Labor-Unterbereiche](#labor-unterbereiche)
- [Antwort, Begründung und Beweis](#antwort-begründung-und-beweis)
- [Zustände und Datenwahrheit](#zustände-und-datenwahrheit)
- [Mobil, Desktop und Barrierefreiheit](#mobil-desktop-und-barrierefreiheit)
- [Änderungen abnehmen](#änderungen-abnehmen)

## Navigation

Die Alltagsnavigation folgt **3+1**:

```text
Jetzt
Woche
Stationen
Mehr / Studio
├── Labor
├── Ich
├── System
└── Glossar
```

Mobil öffnet „Mehr“ ein nicht-modales Auswahlblatt; Escape schließt es und der
Fokus springt beim Öffnen auf die aktive Zeile. Der aktive Studio-Bereich ist
am Mehr-Eintrag markiert. Auf dem Desktop stehen diese Einträge in einer
Studio-Gruppe der Seitenleiste.

Bestehende URLs bleiben erreichbar: `?tab=labor`, `?tab=ich`, `?tab=system`,
`?tab=glossar` und zugehörige `?section=…`-Sprünge. Alarm-Pille und
Update-Banner bleiben global. Die Navigation darf keine Inhalte verstecken,
die nur über einen alten Haupttab erreichbar waren.

## Bereiche

| Bereich | Verantwortung | Abgrenzung |
|---|---|---|
| Jetzt | Empfehlung, drei Fakten, „Heute im Blick“, Umweg-Rechnung | Keine zweite vollständige Stationsliste |
| Woche | Veröffentlichte Fenster für die nächsten Tage | Mehrtagesbänder nicht als PIT-kalibriert ausgeben |
| Stationen | Polling-Set, Karte, Vergleich und Stationsdetails | Tagesverlauf im Detail statt unbeschrifteter Mini-Linie in jeder Zeile |
| Labor | Modell, Güte, Kalibrierung, Heatmaps und Begründungen | Markt-Labor und Live-Advice nicht mit persönlicher Bilanz vermengen |
| Ich | Fahrzeug, Profile, Tankstand, Belege und Bilanz | Ein Intent ist kein Beleg |
| System | Konfiguration, Jobs, Archiv, Collector, Alarme und Export | Interne Pfade und Betriebsbegriffe bleiben hier, nicht in Alltagskarten |
| Glossar | Begriffe mit verständlicher Kurz- und Langform | Fachwörter erst erklären, dann vertiefen |

„Heute im Blick“ zeigt die drei Faktenzeilen dauerhaft, den Tagesstreifen
zunächst eingeklappt. Ohne Empfehlung entfällt eine zusätzliche Freitext-
Wiederholung derselben Aussage. Mit Empfehlung kann sie Referenz und
persönlichen Vorteil erläutern.

## Labor-Unterbereiche

Das Labor ist im Checkout bereits in vier Sub-Tabs aufgeteilt:

| Sub-Tab | Inhalt |
|---|---|
| Überblick | Geführter Fan-Chart, Vertrauens-Konto und Tagebuch |
| Modell & Parameter | Acht Karten: Struktur, AR(2), Bootstrap, 12-Uhr-Projektion, Ensemble, Selektion, Schwellen, Regime |
| Güte & Kalibrierung | Rolling-PICP, Reliability, Brier, Backtest und Heatmaps |
| Daten & Rohdaten | Reichweite, Roh-Tabellen, CSV-Export, API-Explorer und Winter-Hinweis |

`?tab=labor&subtab=ueberblick|modell|guete|daten` adressiert die Unterbereiche.
Historische Abschnittssprünge werden über `LAB_SECTION_TO_SUBTAB` zugeordnet.
Die Einzelansichten liegen unter `web/src/views/labor/`; Karte 7 zeigt ein
Beta(5,5)-Intervall der Trefferquote. Karte 8 beschreibt auch geplante
Regime-Bausteine und ist deshalb **kein Beleg**, dass Normalisierung, Deckel
oder Projektionsausnahme in der Engine implementiert sind.

Die Implementierung ist von der vollständigen Abnahme zu unterscheiden.
Der schmale 320-px-Browsertest zeigt einen bestehenden Textüberlauf an der
Regime-Karte; [TODO B5](../planung/TODO.md#b5-labor-überlauf-beheben) hält diesen Rest fest.

## Antwort, Begründung und Beweis

1. **Antwort:** eine klare Aussage mit handlungsrelevanten Zahlen.
2. **Begründung:** Datenalter, Quelle, Bedingungen und relevante Unsicherheit.
3. **Beweis:** gezielter Sprung in Labor, Diagramm oder Rohdaten.

Tooltips ergänzen bekannte Begriffe; sie ersetzen keine notwendige Erklärung.
Preise verwenden €/L, Differenzen ct/L, Tankbeträge €. Zeitangaben folgen
Europe/Berlin. Formatierung erfolgt über `web/src/data.ts`; verbindliche
Formulierungen stehen in [Microcopy](MICROCOPY.md).

Fenster-Vorteil („bis zu“) und Median-Erwartung sind verschiedene Größen.
Die GUI darf sie weder sprachlich noch rechnerisch austauschen. Ebenso bleiben
Prognosekalibrierung und Produktfreigabe getrennt sichtbar.

## Zustände und Datenwahrheit

- **Einrichtung:** fehlende Daten erklären und nächste Schritte nennen.
- **Laden:** Ladezustand statt fälschlicher Behauptung, es gebe keine Preise.
- **Veraltet:** vorhandene Daten mit Alter kennzeichnen, nicht als frisch
  empfehlen.
- **Fehler:** Grund und Handlung nennen; ein HTTP-200-Fehlerkörper ist keine
  gültige Summary.
- **Nicht entscheidungsbereit:** reine Preise zeigen, keine erfundene
  Empfehlung oder Sicherheitsquote.
- **Offline:** Belege/Vorsätze können in der Offline-Queue verbleiben;
  RP2-Fallback ist dagegen eine eigene, lesende Betriebsoberfläche.

Forecast, Backtest, Live-Advice und Wallet müssen als unterschiedliche
Datenquellen erkennbar bleiben. Diagramme brauchen eine Textalternative mit
Werten, nicht nur Reihennamen.

## Mobil, Desktop und Barrierefreiheit

- Fokusführung, Tastaturbedienung und aktive Navigation sind testbare Zusagen.
- Auf 390 px dürfen Stationskarten und Tabellen keinen unnötigen horizontalen
  Seiten-Scroll erzeugen.
- Die Scrolltiefen-Grenze von 1,5 Viewports gilt für den „Jetzt“-Abschnitt bei
  390 × 844, nicht für die gesamte Seite einschließlich globalem Kopf.
- Ein Desktop-Zweispalter und eine zusätzliche Verdichtung der mobilen
  Steuerzeilen sind keine offenen Implementierungszusagen:
  [ADR 0002](../adr/0002-PRODUKTUMFANG.md).
- Dark/Light, Typografie und Komponenten übernehmen die gestalterische Basis
  der [GUI-Vorlagen](GUI-VORLAGEN.md), aber keine Demo-Datenlogik.

## Änderungen abnehmen

Die gemockte Browser-Suite prüft Interaktionsfälle; die Demo-Suite prüft die
Oberfläche gegen echte Serverantworten. Beides ist erforderlich. Zusätzlich
bleiben Microcopy-Ratchet, mobile Layout-Prüfungen und die
[Qualitätsbudgets](../entwicklung/QUALITAET.md) maßgeblich.

Die Labor-Struktur ist implementiert; ausstehende Abnahmekriterien und der
reproduzierte Layoutbefund stehen in [TODO B5](../planung/TODO.md#b5-labor-überlauf-beheben).
