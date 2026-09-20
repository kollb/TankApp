# Projektstand und Grenzen

> Stand: 20.09.2026 · App-Version 0.59.2
> Abgleich von Produktkonzept, Konfiguration und Release-Stand.
> Kein Nachweis eines neuen Hardwaretests oder einer neuen Live-Daten-Messung.

## Inhaltsverzeichnis

- [Implementierter Stand](#implementierter-stand)
- [Offene Arbeit](#offene-arbeit)
- [Ausstehender Betriebsnachweis](#ausstehender-betriebsnachweis)
- [Bewusste Grenzen](#bewusste-grenzen)
- [Belege und Zuständigkeiten](#belege-und-zuständigkeiten)

## Implementierter Stand

| Bereich | Aktueller Stand | Maßgebliche Beschreibung |
|---|---|---|
| Datenerhebung | Mehrstadt-Collector, RAM-Ring, Heartbeat, Upload mit Ack und Wiederholung | [Architektur](../architektur/ARCHITEKTUR.md) |
| NAS | Archiv-Nachholung, Modell- und Selektionsjobs, Fortschritt, Alarme, Backup | [Betrieb](../betrieb/BETRIEB.md) |
| Oberfläche | Jetzt/Woche/Stationen plus Mehr; Labor/Ich/System/Glossar in der Studio-Gruppe | [UI](../produkt/UI.md) |
| Labor | Vier Sub-Tabs, acht Parameterkarten, Beta-Intervall, CSV/API-Rohdatenraum; Layout-Regressionsschutz für lange Bezeichner bei 320/390 px | [UI](../produkt/UI.md#labor-unterbereiche) |
| Modell | Default `profile_ar2`, gemeinsame Ziehung, Day-Pair; Backtest und Veröffentlichung mit gleichem Modellpfad | [Engine](../referenz/ENGINE.md) |
| Kalibrierung | PIT-Kandidaten-/Aktivierungspfad vorhanden; 24-h-Horizontfilter und Herkunftsprüfung noch fehlerhaft, siehe NAS-/Pi-Befund M1/M6 | [Befund](../archiv/BEFUND-TANKAPP-NAS-PI-2026-09-20.md#3-mathematische-modelle-und-performance) |
| Produktfreigabe | M7-Ledger-Gate getrennt vom technischen `calibrated`; kein automatisches Nachregeln der Prozent-Gates | [Konzept](../produkt/KONZEPT.md#ehrlichkeits-regel) |
| Entscheidung | `latest_by`, Fahrtmodus, pfadbasierte Wahrscheinlichkeiten und getrennte €-Semantik | [API](../referenz/API.md) |
| Persönliche Daten | Folgen, Intents, Belege, Storno, CSV-Export, Profile und Offline-Queue | [API](../referenz/API.md) |
| RP2 | NAS-Proxy einschließlich Schreibaktionen bei erreichbarem NAS; offline nur lesender Fallback | [RP2](../betrieb/RP2.md) |
| Qualität | Unit-Tests, Browser-Suite mit Mocks und eigene Demo-Suite ohne Mocks | [Qualität](../entwicklung/QUALITAET.md) |

Die frühere Abweichung zwischen Backtest-Kern und veröffentlichtem Modell ist
kein offener Codepunkt mehr. Die Referenzmessung auf dem echten Bestand bleibt Voraussetzung, bevor
eine neue Güteabnahme behauptet wird; sie ist kein unabhängiger Ausbauauftrag.

## Offene Arbeit

In [TODO](TODO.md) stehen unmittelbar ausführbare Korrekturen:
**A14** klärt die Rechts-/Terminbasis vor weiteren Regime-Eingriffen.
Der Labor-Umbau einschließlich des schmalen Kartenumbruchs ist implementiert;
B5 ist im [Release 0.59.2](../releases/CHANGELOG.md#0592--2026-09-20) dokumentiert
und wird nicht erneut beauftragt.

Der [NAS-/Pi-Befund vom 20.09.2026](../archiv/BEFUND-TANKAPP-NAS-PI-2026-09-20.md)
ergänzt bestätigte Integrationsfehler; sie sind **nicht behoben** und in
[NP1–NP6](TODO.md#n1-naspi-integrationsfehler-beheben) mit Abnahmen
extrahiert. Bis zur Korrektur gelten folgende Grenzen:

- **Datenintegrität:** Offline-Queue, beschädigte Stores und unterbrochene
  Veröffentlichungen können bestätigte Eingaben verlieren bzw. gemischte
  Modellstände liefern. Retention sichert die Allzeit-/Jahresbilanz nicht.
- **Schutz:** Der optionale Lesetoken ist über Compose, Proxy, Aggregat-/POST-
  Rückgaben und aktiven Service-Worker-Cache nicht durchgängig wirksam.
- **Failover:** Der Pi ist kein gleichwertiger Decision Layer. Empfehlungen
  bei veraltetem ausgewähltem Preis und der API-/UI-Rückwechsel sind nicht
  abgenommen; NAS-Wiederkehr garantiert kein automatisches Queue-Nachreichen.
- **Modelle:** Nichtleere 24-h-Kalibrierung, kausale Vorverarbeitung,
  Gapfill-Übernahme, DST-Segmente, Bias-Prüfung und vollständige
  Kalibrierungsprovenienz sind noch zu korrigieren. Ein M7-Slope-Nachweis
  allein beweist keine unverzerrte Wahrscheinlichkeit.
- **Nachreichen:** Watermarks während eines Jobs, Uhr-Rücksprünge und
  veränderliche Upload-Tags verletzen die bisherigen Synchronisationsannahmen.

Die Bestandsübersicht oben bezeichnet implementierte Komponenten, nicht deren
Fehlerfreiheit. Synthetische Gegenproben belegen die beschriebenen Fehler,
aber keine neue Hardware-, Influx-Restore- oder Feldqualitätsabnahme.
Ein zweiter Ledger-Schreiber, eine Datenbankmigration, neue Schreibauthentisierung
oder Pi-Modelltraining sind Vorschläge bzw. gesonderte Architekturentscheidungen,
keine beschlossenen Funktionen.

**Noch nicht beauftragter Regime-Ausbau:** A15 und H6–H10 hängen von der
bestätigten Rechtslage, dem betroffenen Bestand und der Entscheidung für
weitere Eingriffe ab. Voraussetzungen und Abnahme bleiben im
[Regime-Plan](REGIME.md#aktivierungsbedingungen) erhalten. Die Punkte sind
nicht erledigt, aber auch keine voraussetzungslose Pflichtliste.

**Unverbindliche Review-Vorschläge** (Konditionierung beider Stationen,
dynamische Frischeschwelle, engeres Slope-Gate, PIT-Tail-Gitter, Mehrtage-
Hinweis und Regime-Dedup) bleiben im
[Originalreview](../archiv/ANALYSE-B0-B1-B2-2026-09-19.md#empfehlungen).
Sie sind keine zugesagten Features und erzeugen ohne konkrete Entscheidung
keinen Eintrag in TODO. Dasselbe gilt für zusätzliche Ensemble-Gewichte.

## Ausstehender Betriebsnachweis

Diese Grenzen gelten für spätere Freigaben oder Erweiterungen. Sie sind keine
laufenden Handlungsaufträge: Reine Betriebszeit (B6), noch fehlende Füllungen,
optionale ACI-Aktivierung und Winterbeobachtung stehen deshalb nicht in TODO.
Solange Nachweise fehlen, bleiben die betreffenden Gates und Zusagen begrenzt.
Parameteränderungen benötigen weiterhin einen Ablationsvergleich; diese
Qualitätsregel erzeugt ohne Parameteränderung keine zusätzliche Aufgabe.

| Thema | Was fehlt oder den Start begrenzt |
|---|---|
| M7 und Kalibrierung | Genügend abgerechnete echte Advice, bestandene Brier-/Reliability-Gates und Beobachtung über Betriebszeit; technische PIT-Kalibrierung allein reicht nicht |
| Modellgüte | Vergleich auf echtem Bestand je Station/Horizont, einschließlich alternativer Kerne; keine neue Abnahme durch diese Dokuänderung |
| B0-Referenz | PICP/MASE je Station und Brier global nach P-Quelle; ein stationsweiser Brier ist bei geringer Advice-Zahl nicht belastbar |
| ACI | Mindestens vier Wochen Live-Betrieb und belastbare Scores vor einer Aktivierungsentscheidung |
| `w(h)` | Mindestens acht Füllungen für eine belastbare persönliche Rückkopplung |
| Winter/Regime | Erster Regel-Winter separat prüfen; Simulationen nicht als Live-Messung verbuchen |
| Ledger-Persistenz | Überschreiben beschädigter Stores und Verlust archivierter Zeilen aus der Langzeitbilanz sind bestätigt (NP1/NP5); die Speichertechnik bleibt gesondert zu entscheiden |
| NAS-/Pi-Betrieb | Zielhardware-Latenzen, Speicher-/Threadbudgets, Watchdog, Stromausfall und tatsächlicher Cache-Mount nicht neu abgenommen |
| Backup/Restore | Dateialter belegt keine Wiederherstellbarkeit; datenbankkonsistente Influx-Sicherung und vollständiger Restore-Nachweis fehlen im Audit |
| NAS-Kampagnenquote | 6/2/2 nur offline; Bedarf am realen Mehrstadtbetrieb messen, nicht als NAS-Funktion behaupten |

Die Juli-Generalprobe **A16 ist gemessen**: Frankfurt, E10 und Diesel,
Ergebnisse und Grenzen im [Regime-Plan](REGIME.md#messstand).
Das schließt weder die Regime-Implementierung noch deren Backtest-Abnahme ab.

## Bewusste Grenzen

| Thema | Entscheidung |
|---|---|
| Öffentlicher Betrieb, Benutzerverwaltung, Mehrsprachigkeit | Nicht im Produktumfang; eigener deutschsprachiger Haushalt im LAN |
| Preis-Ticker | Kein zusätzlicher Kursalarm; vorhandene System- und Empfehlungsfenster-Meldungen bleiben |
| Markenrabatte, E5/E10-Verbrauchsfaktor | Ohne echte Fahrzeug-/Rabattdaten kein verlässlicher Ranking-Eingriff |
| Freie Standortsuche | Kuratiertes Polling-Set statt zusätzlicher API-Requests ohne Kontingentmodell |
| Top-3-Trefferquote | Keine Kennzahl über nicht veröffentlichte Kandidatenfenster |
| OpenAPI | Markdown-API bleibt der Vertrag; Generator erst bei weiterem API-Verbraucher neu bewerten |
| Ensemble-Gewichte | Horizontgewichte nicht geschätzt; das optionale Ensemble erhält keine unbelegte zweite Mischung |
| Ledger-Fallback | Laplace `(hits + 5)/(n + 10)` entspricht dem Beta(5,5)-Mittelwert; kein unbegründeter Schätzerwechsel |
| Live-only-Handover | 90 Tage bleiben; die Regel ist kein M7-Zeitgeber und wird nicht zur künstlichen Gate-Beschleunigung verkürzt |
| Stationslebenszyklus | Ranking darf tote Stationen ausblenden; Polling-Tausch bleibt bestätigt |

Betriebsentscheidungen (flüchtiger Cache, Speicher, Backup), zurückgestellte
UI-/Laufzeitoptimierungen und Modellfreigabe sind in den
[ADRs](../adr/README.md) begründet. Sie sind keine offenen TODO-Zeilen.

## Belege und Zuständigkeiten

- [Konzept](../produkt/KONZEPT.md): gültige Produktregeln.
- [TODO](TODO.md): nur offene Aufgaben und deren Abnahme.
- [Release-Historie](../releases/CHANGELOG.md): abgeschlossene Änderungen.
- [Archiv](../archiv/README.md): Messprotokolle und stichtagsbezogene Prüfungen.

Historische Laufzeitwerte sind keine heutigen Leistungszusagen. Messrezepte
und Betriebswerte gehören in [Betrieb](../betrieb/BETRIEB.md) bzw.
[Qualität](../entwicklung/QUALITAET.md), nicht in eine zweite Erledigt-Chronik.
