# GUI-Vorlagen und interaktiver M3-Prototyp

> Stand: 27.09.2026. `sample/good gui` bleibt die geschützte gestalterische
> und technische Basis. Der ausführbare Prototyp liegt in `web/src/concept/`.

## Inhaltsverzeichnis

- [Vorlagen und Übernahme](#vorlagen-und-übernahme)
- [Visuelle Leitplanken aus dem vorhandenen Code](#visuelle-leitplanken-aus-dem-vorhandenen-code)
- [Daten und Design getrennt migrieren](#daten-und-design-getrennt-migrieren)
- [Bedienung und Funktionsabdeckung](#bedienung-und-funktionsabdeckung)
- [Prüfung](#prüfung)

## Vorlagen und Übernahme

Die Dateien in [`sample/good gui`](../../sample/good%20gui) bleiben unverändert.
Sie enthalten `App`, `PhoneApp`, `ConceptPanel`, Tokens, Beispieldaten und
Labor-Konzepttexte. Die Vorlage importiert einen `LabScreen`, der im aktuellen
Bestand fehlt. In `web/src/concept/` ist dieser Screen ergänzt; Importpfade
sind an die ausführbare React-App angepasst. Karte und Alarme der Vorlage
waren Snackbar-Platzhalter und haben jetzt eigene Demo-Ansichten.

Die ältere Referenz `sample/good statistic gui` ist im aktuellen Checkout
nicht vorhanden. Vorhandene produktive Labor-/Statistikfunktionen in `web/src/`
werden durch diese Änderung weder gelöscht noch durch Demo-Logik ersetzt.

## Visuelle Leitplanken aus dem vorhandenen Code

- Helles Material You: Primary `#006c4c`, Mint `#89f8c7`, Error `#ba1a1a`,
  Rosa `#ffdad6`, Tertiary `#3d6373`, Eisblau `#c1e8fb`, Warnung `#7c5800`
  auf `#ffdea3`. Surface-Rampe Weiß bis `#e4eae3`.
- Desktop: Smartphone mit Statusbar und Dynamic Island links; unabhängig
  scrollendes Konzept-Panel rechts. Mobil: Vollbild-App und expliziter
  Umschalter „Konzept & Steuerung“ statt zweier winziger Spalten.
- Material-3-Karten, Filter Chips, Segmented Buttons, Navigation Bar, Extended
  FAB, Switches, Snackbar und Bottom Sheet. SVG-Diagramme bleiben ohne externe
  Chart-Runtime interaktiv.
- Tailwind und Lucide für Komponenten; Framer Motion für Übergänge. Reduzierte
  Bewegung wird respektiert. Der helle Prototyp überschreibt Tokens nur in
  seinem eigenen Root, nicht das wählbare Thema der Live-App.

## Daten und Design getrennt migrieren

**Einstieg:** `/?konzept=1`, zusätzlich „Neue GUI“ in der Desktop-Kopfzeile.
Der Parameter lädt einen eigenen Chunk. Die produktive Oberfläche bleibt
unter `/` und ihren bestehenden Tab-URLs erhalten; Rücklinks führen zu allen
Funktionsbereichen. Beide Ansichten liegen im selben Produktionsbuild.

Das Mockup verwendet deterministische Beispieldaten, keine Live-API. Insbesondere:

- „Live“, „Offline“ und der Retry sind vom Panel gesteuerte Szenarien. Der Retry
  simuliert die Wiederherstellung, er misst keine Netzwerkverbindung.
- „26 von 30 Tagen“, „9 von 10 Fällen“, MAE und Gradient Boosting sind markierte
  Konzeptwerte, keine Modellfreigabe oder Gütemessung der produktiven Engine.
- Profile, Kraftstoff, Experimente und Demo-Alarme verwenden ausschließlich
  `tankapp-concept:*` in Local Storage. Blockierter Speicher fällt auf
  Sitzungszustand zurück. Keine Synchronisation und keine Push-Nachrichten.
- Die schematische Karte benötigt keine Kartenkacheln. Die Routenaktion öffnet
  Google Maps mit der Beispieladresse; externe Navigation braucht ggf. Netz.
- Echte Preis-/Modellabfragen, Profile, Tankbuch, Feedback, Alarme, Export,
  Offline-Queue, System und Failover bleiben in den bestehenden Live-Views.

Das ist **keine vollständige Portierung der produktiven API ins Smartphone**.
Diese Grenze steht auch in [LUECKEN](../planung/LUECKEN.md#bewusste-grenzen).
Eine spätere Integration muss bestehende Freigabegates und Fehlerzustände
übernehmen, nicht fixe Demo-Ergebnisse an produktive Schreibaktionen hängen.

## Bedienung und Funktionsabdeckung

| Bereich | Bedienbare Funktionen |
|---|---|
| Guide | Kraftstoff, drei Empfehlungen, drei Datenlagen, Retry-Spinner, Preis-Badges, Sortierung Preis/Nähe, Routen, einklappender Karten-FAB, Warum-Sheet |
| Labor | Fächer mit P10–P90-Band und Tiefpunkt, SVG-Zeitpunkte per Klick/Tastatur, typische/graue Fallback-Kurve, fünf Faktoren, 30-Tage-Raster |
| Tankprofil | HTML-Range 20–80 Liter, drei Warteoptionen, sofortige Beispielrechnung pro Füllung/Jahr, lokale Speicherung |
| Experimente | Drei Switches, echte Undo-Funktion, offline deaktiviert mit Begründung |
| Karte | Vier auswählbare Stationen, schematische Positionen, externe Routenaktion |
| Alarme | Zielpreis validieren, lokal speichern, anzeigen, löschen; offline keine Neuanlage |
| Konzept | Screen-/Datenlagen-/Empfehlungswahl, Nummerierung, Aufbau, Texte, zwölf Komponenten je Hauptscreen, Matrix und fünf Leitregeln |
| Barrierearme Bedienung | Benannte Steuerelemente, roving Fokus in Tabs/Radio-Gruppen, Pfeiltasten/Home/End, Escape/Fokus-Rückgabe im Sheet, inerte Umgebung, Reduced Motion |

Rechner-Annahmen: 24 Füllungen/Jahr; je nach Warteoption 0, 3,5 oder 8 ct/L.
Diese Annahmen stehen direkt im Mockup und sind keine garantierte Ersparnis.

## Prüfung

- `web/src/concept/state.test.ts`: Rechenbasis, Kurvenlänge, Preisstufen,
  kodierte Routenziele. Die bestehenden Format-/A11y-Ratchets gelten ebenfalls.
- `web/e2e/concept.spec.ts`: Desktop und Mobil; alle Empfehlungen und Datenlagen,
  Retry, Sheet, Sortierung, Karte, Alarme, Slider, Persistenz, Undo und Konzepttabs.
- Bestehende E2E-Suiten prüfen die Live-App weiter, inklusive echter
  Demo-Serverantworten. Der Prototyp ersetzt diese Nachweise nicht.
- Lokaler Browser benötigt die üblichen Systembibliotheken und Schriften.
  Fehlt die in `styles.css` bevorzugte Roboto-Schrift, kann die abweichende
  Fallback-Metrik den bestehenden Scrollhöhenratchet verändern. Keine Grenzwerte
  lockern, um eine abweichende Testumgebung zu kaschieren.
