# Projektstand und Grenzen

> Stand: 28.11.2026 · App-Version 0.79.0
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
| NAS | Archiv-Nachholung, Modell- und Selektionsjobs, Fortschritt, Alarme, Backup; `/health`-Readiness vor Modell-Refresh und Hintergrund-Prewarm mit maximal 30 s Wartezeit | [Betrieb](../betrieb/BETRIEB.md) |
| Oberfläche | Seit 0.76.0: Übersicht + Stationen als Alltagsnavigation, dahinter Labor/System/Einstellungen/Glossar; alte Woche- und Ich-Links werden weitergeleitet. Die Übersicht beantwortet eine Frage; der Atlas nutzt ausgewählte → angeheftete → nächste frische Referenz. Server-Netto erfordert dieselbe Referenz-ID und `ref_price_fresh=true`; veraltete Alternativpreise sind markiert. Historische Umsetzung der drei UX-Batches (0.73–0.75) und mobile Kopfzeile siehe Release-Historie | [UI](../produkt/UI.md) |
| Labor | Gütekennzahlen und Modell-Pipeline; Kalibrierungs-Bins, Prognose-vs.-Ist (24 h/3 Tage/7 Tage), Wochen-Heatmap, gefiltertes Tagebuch und Parameter | [UI](../produkt/UI.md#labor-aktuelle-datenansichten) |
| Modell | Default `profile_ar2`, gemeinsame Ziehung, Day-Pair; bei frischem Regime-Monitoralarm verkürzte Bootstrap-Halbwertszeit nur in der Live-Prognose, ohne alte PIT-Kalibrierung. Die Verkürzung ist als `bootstrap_mode` veröffentlicht und bildet eine **eigene M7-Kohorte** (`…+bootstrap=regime_short`), damit zwei verschiedene Ziehverteilungen nicht in einer Statistik landen | [Engine](../referenz/ENGINE.md) |
| Kalibrierung | PIT-Kandidaten-/Aktivierungspfad vorhanden; 24-h-Horizontfilter und Herkunftsprüfung noch fehlerhaft, siehe NAS-/Pi-Befund M1/M6 (Bericht nicht im Bestand) | [Offene Arbeit](#offene-arbeit) |
| Produktfreigabe | M7-Ledger-Gate getrennt vom technischen `calibrated`; kein automatisches Nachregeln der Prozent-Gates; `decision_ready=false` seit 0.70.0 dokumentierter Produkt-Blocker (Preisvergleich trägt die Übersicht, M7-Archiv `runtime/m7/archive.jsonl`, Verfügbarkeit in `/v1/health`) | [Konzept](../produkt/KONZEPT.md#ehrlichkeits-regel) |
| Entscheidung | `latest_by`, DST-sichere UTC-Blockidentität, exakt geschnittene Restfenster und getrennte €-Semantik; `/decide` liefert maximal fünf Alternativen plus `price_fresh`/`ref_price_fresh` | [API](../referenz/API.md) |
| Mengen-/Nutzenvertrag | Physische freie Menge, explizites What-if, benanntes Medianpotenzial, ausführbare Strategie und Oracle-Untergrenze getrennt; historische Belege bleiben unverändert | [API](../referenz/API.md) |
| Persönliche Daten | Folgen, Intents, Belege, Storno, CSV-Export, Profile und Offline-Queue | [API](../referenz/API.md) |
| RP2 | React-Leseausgabe mit lokalem Build, Python-Notausgabe ohne Bundle; Readiness-geprüfter NAS-Proxy, versionierte Tab-Verträge; Pi nur Preisvergleich, keine Aktionen | [RP2](../betrieb/RP2.md) |
| Qualität | Unit-Tests, Browser-Suite mit Mocks und eigene Demo-Suite ohne Mocks | [Qualität](../entwicklung/QUALITAET.md) |

Die frühere Abweichung zwischen Backtest-Kern und veröffentlichtem Modell ist
kein offener Codepunkt mehr. Die Referenzmessung auf dem echten Bestand bleibt Voraussetzung, bevor
eine neue Güteabnahme behauptet wird; sie ist kein unabhängiger Ausbauauftrag.

## Offene Arbeit

**Überlappende Zeitfenster:** Neue Modellläufe veröffentlichen zusätzlich zum
unveränderten Altformat vollständige 2-Stunden-Minima im 60-Minuten-Raster.
Die Entscheidung verwendet diese Fenster und eine getrennte M7-Kohorte;
Altbestände bleiben bei den disjunkten Blöcken. Angeschnittene Fenster haben
mangels Suffix-/Prefix-Draws keine Verteilungs-P. Die Größe wird im produktiven
Stationsdatei-Layout je Datei geprüft; ein neuer Gesamt-Monolith für elf
Stationen würde das alte 8-MB-Budget überschreiten und wird nicht geschrieben.
Eine neue statistische Gütefreigabe aus Betriebsdaten ist damit nicht belegt.

**Regime-Gewichtung:** Ein aktueller Monitor-Alarm oder eine einzelne gesperrte
Station begrenzt die Halbwertszeit neuer Live-Draws auf sieben Tage und
verwendet keine alte PIT-Kurve. Seit 0.77.0 trägt jede Veröffentlichung ihren
wirksamen `bootstrap_mode`; die Vertrags-ID trennt `default` und
`regime_short`, damit die 500-Draw-Verteilung des verkürzten Laufs nicht in
derselben M7-Statistik wie der Standardlauf landet (A21-B5.1). Altbestände ohne
Feld bilden die Kohorte `unknown` und öffnen nichts rückwirkend. Die
historischen Backtest-Folds behalten ihren bisherigen Pfad; eine zeitgetrennte
Gegenmessung der veränderten Live-Prognose und der Nachweis auf Betriebsdaten
stehen aus — die Kohortentrennung macht die beiden Verteilungen vergleichbar,
sie belegt keine Güte. Ein Monitoralarm kann auch ein Datenproblem bedeuten und
ist kein Beweis eines Marktsprungs.

**UX-Neuentwurf, Batches 1–3 (0.73.0–0.75.0).** Jetzt und Woche, Labor,
Stationen und Ich sind verdichtet; Rohdaten sind Betreiber-Sicht in „System“.
Batch 3 setzt die zuvor ausgeklammerte Verdichtung der globalen Kopfzeile
(C13) um: Unter 1280 px bleibt die Shell einzeilig, die Antwort-Überschrift
passt bei 320 × 720 in den ersten Viewport. Die 390-px- und Desktop-Abnahmen
bleiben bestehen. Aus diesem Neuentwurf ist kein UX-Auftrag mehr offen.

In [TODO](TODO.md) stehen unmittelbar ausführbare Korrekturen:
**A14** klärt die Rechts-/Terminbasis vor weiteren Regime-Eingriffen.
Der Labor-Umbau einschließlich des schmalen Kartenumbruchs ist implementiert;
B5 ist im [Release 0.59.2](../releases/CHANGELOG.md#0592--2026-09-20) dokumentiert
und wird nicht erneut beauftragt.

Der NAS-/Pi-Befund vom 20.09.2026
ergänzt bestätigte Integrationsfehler. Die UX-Batches 1–3 sowie der
konservative Failover aus **NAS/Pi Batch 3** sind im Code korrigiert;
verbleibende Arbeit steht in
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
Hinweis und Regime-Dedup) bleiben unverbindliche
Vorschläge.
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
| M7 und Kalibrierung | Genügend abgerechnete echte Advice, bestandene Brier-/Reliability-Gates und Beobachtung über Betriebszeit; technische PIT-Kalibrierung allein reicht nicht. A21-B5.1 (0.68.0) bindet die Freigabe an Vertragskohorten — strenge Kohorten starten die Statistik neu (bis n ≥ 100 je Kohorte vergehen real Wochen/Monate); das ist der eingegangene Trade-off gegen unsauberes Pooling fremder Historie |
| Modellgüte | Vergleich auf echtem Bestand je Station/Horizont, einschließlich alternativer Kerne; keine neue Abnahme durch diese Dokuänderung |
| A21-B5.3 Replay-Freigabe | Der Walk-forward-/Replay-Harness misst Produktionsketten-Ausgänge gegen vorab festgelegte Margen; der Ersatzbestand (Rolle synthetic) ist Regression, **kein** Abnahmebeweis. Offen: einmaliger Freigabelauf mit äußerem, zeitlich unangetastetem Abnahmeset (Rolle acceptance) — bis dahin sind alle Replay-Zahlen Entwicklungsstand |
| A21-B5.4 NAS/Pi-Betriebsabnahme | **Blocker: fehlender Zugang ist ein Blocker, kein erfolgreicher Test.** Messrezept/Tooling liegen vor (`docs/betrieb/BETRIEBSABNAHME.md`, `data-tools/ops_acceptance.py`); gemessen ist nichts — weder p95 ≤ 300 ms LAN noch Pollkadenz noch RPO/RTO. Der Audit-Befund Overview p95 2,00 s bleibt die einzige bekannte Messung |
| A21-B5.2 Missingness | Die Ablation ist reproduzierbar, aber synthetisch (Einzelrealisierung, PICP unter Nominal); seit 0.70.0 fährt sie echte Lückenmuster (`--gap-pattern-from`, `real_gaps`) und mehrere Seeds, und die Publikation trägt `data_quality`. Kein Policy-Wechsel ohne robusten Nachweis über echte Lückenmuster — Default bleibt zero_fill |
| A21-B4 Betriebsabnahme | DST-/Restfenster-/Mengen-/Nutzenverträge sind synthetisch regressionsgeprüft. Eine Hardware-/NAS-Feldabnahme, reale Draw-Abdeckung und ein belastbarer Live-Nettonutzen bleiben separat offen; der Code-Fix ist kein Betriebsnachweis. |
| B0-Referenz | PICP/MASE je Station und Brier global nach P-Quelle; ein stationsweiser Brier ist bei geringer Advice-Zahl nicht belastbar |
| ACI | Mindestens vier Wochen Live-Betrieb und belastbare Scores vor einer Aktivierungsentscheidung |
| `w(h)` | Mindestens acht Füllungen für eine belastbare persönliche Rückkopplung |
| Winter/Regime | Erster Regel-Winter separat prüfen; Simulationen nicht als Live-Messung verbuchen |
| Ledger-Persistenz | Überschreiben beschädigter Stores ist seit 0.60.0 fail-closed (NP1/S3); Archivzeilen gehören seit 0.63.0 zur Jahres-/Allzeitbilanz und zur M7-Grundgesamtheit (NP5/F3); die serverseitige Speichertechnik bleibt gesondert zu entscheiden (die Browser-Queue ist seit 0.60.0 eine Outbox in IndexedDB) |
| NAS-/Pi-Betrieb | Zielhardware-Latenzen, Speicher-/Threadbudgets, Watchdog, Stromausfall und tatsächlicher Cache-Mount nicht neu abgenommen; seit 0.68.0 mit fester Messlatte und Messrezept vorbereitet (siehe A21-B5.4 oben), Feldabnahme weiter offen |
| Backup/Restore | Runtime-Backups sind seit 0.66.0 validiert veröffentlicht (Erfolgsmanifest) und der Restore per `ops/nas/restore.sh` + Verifizierer gegen die Quelle nachgewiesen (A21-B3.2); offen bleiben die datenbankkonsistente Influx-Sicherung, ein Restore-Nachweis mit Produktionsdaten im Feld und die RPO/RTO-Stopuhr (A21-B5.4) |
| NAS-Kampagnenquote | 6/2/2 nur offline; Bedarf am realen Mehrstadtbetrieb messen, nicht als NAS-Funktion behaupten |

Die Juli-Generalprobe **A16 ist gemessen**: Frankfurt, E10 und Diesel,
Ergebnisse und Grenzen im [Regime-Plan](REGIME.md#messstand).
Das schließt weder die Regime-Implementierung noch deren Backtest-Abnahme ab.

## Bewusste Grenzen

**Eine Oberfläche (0.78.0):** Der M3-Prototyp (`/?konzept=1`,
`web/src/concept/`, `sample/good gui`) ist mit der UI-Konsolidierung entfernt.
Die übernommenen Leitplanken stehen in [GUI-Vorlagen](../produkt/GUI-VORLAGEN.md),
der ausführbare Stand ist die Live-App unter `/` mit den Bereichen aus
[UI](../produkt/UI.md). Eine zweite, parallel gepflegte Konzept-Ansicht kehrt
nicht zurück.

| Thema | Entscheidung |
|---|---|
| Öffentlicher Betrieb, Benutzerverwaltung, Mehrsprachigkeit | Nicht im Produktumfang; eigener deutschsprachiger Haushalt im LAN |
| Preis-Ticker | Kein zusätzlicher Kursalarm; vorhandene System- und Empfehlungsfenster-Meldungen bleiben |
| Markenrabatte, E5/E10-Verbrauchsfaktor | Ohne echte Fahrzeug-/Rabattdaten kein verlässlicher Ranking-Eingriff |
| Freie Standortsuche | Kuratiertes Polling-Set statt zusätzlicher API-Requests ohne Kontingentmodell |
| Tankrabatt und andere Preisniveau-Sprünge | Die Engine rechnet nicht mit dem angekündigten Betrag (nur Marker, [Regime-Plan](REGIME.md)). Seit 0.72.1 warnt `regime_notice` in der Übersicht und unterdrückt den Abstand „günstiger als jetzt“ über einen bevorstehenden Stichtag; Gates und Kohorten ändert das nicht (A14 bleibt menschliche Bestätigung) |
| Top-3-Trefferquote | Keine Kennzahl über nicht veröffentlichte Kandidatenfenster |
| OpenAPI | Markdown-API bleibt der Vertrag; Generator erst bei weiterem API-Verbraucher neu bewerten |
| Ensemble-Gewichte | Horizontgewichte nicht geschätzt; das optionale Ensemble erhält keine unbelegte zweite Mischung |
| Ledger-Fallback | Laplace `(hits + 5)/(n + 10)` entspricht dem Beta(5,5)-Mittelwert; kein unbegründeter Schätzerwechsel |
| Live-only-Handover | 90 Tage bleiben; die Regel ist kein M7-Zeitgeber und wird nicht zur künstlichen Gate-Beschleunigung verkürzt |
| Stationslebenszyklus | Ranking darf tote Stationen ausblenden; Polling-Tausch bleibt bestätigt |
| Archivierte Stichtagsberichte | Die datierten Berichte unter `docs/archiv/` (`BEFUND-…`, `ANALYSE-…`, `GUTACHTEN-…`, `PRUEFSTAND-…`, `TIEFENANALYSE-…`, `UMSETZUNG-…`, `GUI-UX-BEFUND`, `RP2-…`) sowie `planung/UI-NEUGESTALTUNG-2026-09-26.md` und `sample/good statistic gui` liegen in **keinem** Commit dieses Repositories. Ihre Verweise sind am 27.09.2026 entfernt (D1 in [TODO](TODO.md)): Ein Prüfbericht lässt sich nicht rekonstruieren, und ein nachträglich geschriebener wäre erfundene Evidenz (§1). Das Archiv-Verzeichnis führt ihre Titel als Text, nicht als Verweis |
| UX-Neuentwurf, Batches 1–3 (0.73.0–0.75.0) | Historische Abnahme: **Jetzt** und **Woche** (§3/§4), Labor in drei Blöcken (§5), Stationen/Ich verdichtet (§6/§7), Rohdaten als Betreiber-Sicht in „System“ und kompakte globale Kopfzeile (C13/§13). Die gestrichenen Annahmen, Raster und Feedback-Elemente bleiben gestrichen. Für diese Batches blieb der Serververtrag unverändert; Release 0.76.0 ergänzt separat Alternativenlimit und Frischefelder und migriert die Navigation auf Übersicht/Stationen + Mehr. C13 bleibt abgenommen: bei 320 × 720 endet die Antwort-Überschrift im ersten Viewport; unter 1280 px liegen Profil und Aktionen im Kopfzeilen-Blatt |
| ~~M3-Kartenflächen der Entscheidung~~ | **Erledigt 27.09.2026 (GUI v2):** Die Entscheidungskarte trägt `CARD_TONE` auf M3-Basis (`m3-now`/`m3-relaxed`/`m3-wait`/`m3-neutral` in styles.css), Buttons/Chips sind M3-Pills, die Shell (Kopf, Navigation) folgt der M3-Vorlage. Die Vorlage selbst ist mit 0.78.0 entfernt; die Token bleiben in `styles.css` (siehe [GUI-Vorlagen](../produkt/GUI-VORLAGEN.md)) |

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
