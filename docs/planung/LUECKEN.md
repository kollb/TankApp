# Projektstand und Grenzen

> Stand: 21.09.2026 · App-Version 0.65.0
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
| RP2 | Readiness-geprüfter NAS-Proxy; versionierte Tab-Verträge; Pi nur Preisvergleich, keine Aktionen | [RP2](../betrieb/RP2.md) |
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
ergänzt bestätigte Integrationsfehler. Batch 1/2 und der konservative
Failover aus Batch 3 sind im Code korrigiert; verbleibende Arbeit steht in
[TODO](TODO.md#n1-naspi-integrationsfehler-beheben). Es gelten folgende Grenzen:

- **Datenintegrität:** Outbox, fail-closed Stores und konsistente Publikation
  sind implementiert. Die 90-Tage-Retention lagert in `archive.jsonl` aus;
  Jahres-/Allzeitbilanz und die M7-Grundgesamtheit lesen Hot-Store plus Archiv
  (0.63.0, F3). Der 90-Tage-Live-Fenster-Handover bleibt unverändert.
- **Schutz:** Der optionale Lesetoken schützt keine unverschlüsselte
  Verbindung; Betrieb und Zugriffsschutz bleiben Betreiberaufgabe.
- **Failover:** Der Pi ist ausdrücklich kein gleichwertiger Decision Layer:
  keine eigene Aktionsfreigabe, keine lokale Modellinferenz, kein zweiter
  Ledger-Schreiber. Readiness, gebundene API-Verträge und Wiederkehr-Flush
  sind mit echten Handlern im Browser geprüft; Zielhardware-Latenzen und
  Stromausfall nicht. Offene NAS-Formulare bleiben im selben Tab erhalten;
  ungebuchte Entwürfe sind kein versprochener persistenter Beleg. Alte Tabs
  vor 0.61.0 benötigen einmalig ein Update/Reload. Backoff begrenzt, wann eine
  wartende Outbox tatsächlich erneut sendet.
- **Modelle:** Die Batch-4-Verträge (0.62.0) sind im Code korrigiert:
  Horizont-Vorlauf statt Fensterlänge im NAS-Kandidaten (M1), kausale
  Hampel-Aufbereitung mit getrennter Datenqualitätsdiagnostik (M2),
  DST-sichere Mittagsgrenzen (M3), Gapfill-Priorität je
  Verfügbarkeits-Bucket (I4), Bias-/Mittel-Prüfung mit gemeinsam
  block-resamptem Skill-Gate (M5) und Day-Pair-/Regime-Provenienz der
  Kalibrierungsaktivierung (M6). Offen bleibt der **Betriebsnachweis auf
  NAS-Daten** (ausstehender Betriebsnachweis unten) und zwei ehrliche
  Grenzen: (1) Die *endgültige veröffentlichte Prognose* wird nicht selbst
  out-of-sample replayt — der Kalibrierungsnachweis läuft auf dem
  zeitgetrennten PIT-Holdout des Backtests, ein Live-Replay der
  publizierten Kurve braucht Betriebshistorie; (2) der kausale Hampel-Filter
  entfernt den ersten Poll eines echten Sprungs (ein Bucket FFill) —
  Trainingspreise starten bestätigte Sprünge einen Bucket später, die
  Diagnostik (`price_raw`) bleibt ungefiltert. Außerdem entwertet der
  M6-Vertrag veröffentlichte Kurven des Altvertrags (ohne `day_pair`):
  Der erste Lauf nach dem Update bleibt sichtbar unkalibriert, bis der
  Backtest einen Kandidaten mit ausgewiesenem Modus liefert.
- **Nachreichen:** Mit 0.63.0 nachgezogen (I5/I3): ein höherer Watermark
  während eines Jobs erzeugt genau einen Folgelauf; der Uploader-ACK ist ein
  Datei-Offset plus Event-Zeit, Stationsname/Stadt sind Felder. Der
  Betriebsnachweis bleibt die echte ACK-Datei und der Pi-Heartbeat, nicht nur
  der Unit-Test.

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
| Ledger-Persistenz | Überschreiben beschädigter Stores ist seit 0.60.0 fail-closed (NP1/S3); Archivzeilen gehören seit 0.63.0 zur Jahres-/Allzeitbilanz und zur M7-Grundgesamtheit (NP5/F3); die serverseitige Speichertechnik bleibt gesondert zu entscheiden (die Browser-Queue ist seit 0.60.0 eine Outbox in IndexedDB) |
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
