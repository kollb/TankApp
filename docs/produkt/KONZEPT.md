# Produktkonzept

> Stand: 20.09.2026 · App-Version 0.59.1 · Konsolidierter Produktstand.
> Implementierungsgrenzen: [Projektstand](../planung/LUECKEN.md).
> Endpunktverträge: [API](../referenz/API.md).

## Inhaltsverzeichnis

- [Produktprinzip](#produktprinzip)
- [Daten und Stationsauswahl](#daten-und-stationsauswahl)
- [Prognose und Kalibrierung](#prognose-und-kalibrierung)
- [Entscheidungen](#entscheidungen)
- [Feedback und persönliche Bilanz](#feedback-und-persönliche-bilanz)
- [Fahrzeug und Umwegkosten](#fahrzeug-und-umwegkosten)
- [Oberfläche und Betrieb](#oberfläche-und-betrieb)
- [Abnahme und Grenzen](#abnahme-und-grenzen)

## Produktprinzip

Die App soll eine Tankentscheidung erleichtern, nicht eine Prognosekurve zur
Pflichtlektüre machen. Die Alltagsansicht beantwortet drei Fragen:

| Frage | Benötigte Information |
|---|---|
| **F1: Jetzt oder warten?** | Tankzeitpunkt, Fenster und finanzieller Unterschied |
| **F2: Hier oder woanders?** | Vorteil nach zusätzlichem Sprit- und Zeitaufwand |
| **F3: Heute oder später?** | Verfügbare Fenster bis zum notwendigen Tankzeitpunkt |

Antwort → Begründung → Beweis ist die Reihenfolge der Darstellung.
Kurven, Quantile und Gütemaße bleiben auf Nachfrage erreichbar.

### Ehrlichkeits-Regel

- Ohne Daten: Einrichtung oder ein begründeter Leerzustand, keine Demo-Preise.
- Ohne belastbare Kalibrierung: keine als sicher verkaufte Empfehlung.
- `forecast.calibrated` bezeichnet nur die technische 24-h-PIT-Kalibrierung;
  `decision_ready` hängt zusätzlich vom M7-Ledger-Gate **und** der
  Freigabekette ab (A21-B1.4): nur ausreichende aktuelle Evidenz — frischer
  Preis, offene Station, frische Herkunft, gültiger Prognosezeitraum,
  vollständige Pfade, veröffentlichte Güte — gibt eine Handlung frei.
  Die Sperrgründe stehen maschinenlesbar im Vertrag, und eine Handlung hat
  ein Gültigkeitsende (`valid_until`).
- Beobachtete Preise, geschätzte Preise und persönliche Belege sind getrennte
  Quellen. Alter, Unsicherheit und fehlende Daten werden sichtbar benannt.
- Softwaretests ersetzen weder echte Messungen noch Betriebsabnahmen.

## Daten und Stationsauswahl

Tankerkönig liefert Preise und Stationsdaten. Der Collector auf dem Pi nutzt
zwischen 06:00 und 24:00 Uhr ein Budget von einem Request je 300 Sekunden.
Stadtsets teilen das Budget im Round-Robin-Verfahren; es ist kein Versprechen,
dass jede Stadt alle fünf Minuten aktualisiert wird.

Das NAS hält Live-Preise in InfluxDB und lädt das Tankerkönig-Archiv getrennt
nach. Das Archiv ersetzt keine verlorenen eigenen Poll-Snapshots.
Schlüssel und private Daten bleiben außerhalb von Git.

Das aktive Polling-Set ist kuratiert. Die Selektion bewertet Preisvorteil,
Datenqualität und Umwegkosten. Der NAS-Job rankt global Top-10 je Kraftstoff;
eine Kampagnenquotierung 6/2/2 gehört nur zur Offline-Pipeline. Tote Stationen
werden nicht eigenmächtig aus dem Polling entfernt: Ohne weitere Polls wäre
eine Rückkehr zur Aktivität nicht erkennbar. Tausch erfolgt mit Bestätigung
nach [Stations-Tausch](../betrieb/STATIONEN-TAUSCH.md).

Methodik und Parameter stehen ausschließlich in
[Analyse](../referenz/ANALYSE.md), Befehle in
[Datenwerkzeuge](../referenz/DATENWERKZEUGE.md).

## Prognose und Kalibrierung

Der aktuelle Standardkern ist `profile_ar2`; `harmonic_ar2` und `ensemble`
bleiben wählbar. Backtest und Veröffentlichung sollen denselben Kern und
dieselbe Ziehstrategie bewerten. Gemeinsame Ziehungen erhalten Abhängigkeiten
zwischen Stationen; Day-Pair-Blöcke berücksichtigen benachbarte Trainingstage.
Ohne zulässiges Paar fällt die Ziehung auf unabhängige Tage zurück.

Die Engine liefert Pfade und Quantile für 24, 72 und 168 Stunden. Aussagen
über ein Fensterminimum werden aus den Pfaden berechnet, nicht aus einer
nachträglich erfundenen Normalverteilung um den Median.

### Technische Kalibrierung

Eine monotone PIT-Rekalibrierung kann 24-h-Pfade korrigieren. Kandidaten werden
zeitlich getrennt validiert und frühestens im folgenden Modell-Lauf genutzt.
Modellherkunft und Ziehstrategie müssen passen. Ein Regime-Blackout blockiert
die Aktivierung für 45 lokale Tage nach einer konfigurierten Kante.
72-/168-h-Pfade bleiben unkalibriert. ACI ist nicht aktiviert.

Die technische Kurve gibt keine Empfehlung frei. Das M7-Gate bewertet echte
abgerechnete Advice-Snapshots anhand von Brier-Referenzen und der Unsicherheit
der Reliability-Steigung. Automatischer Schwellennachzug darf Geld-, Zeit-
und Umwegschwellen verändern, nicht Prozent-Gates passend regeln.

Technische Details und Messrezepte: [Engine](../referenz/ENGINE.md).
Entscheidungsgrund: [ADR 0003](../adr/0003-MODELL-UND-FREIGABE.md).

## Entscheidungen

### F1: Jetzt oder warten

Die App vergleicht den aktuellen Ankerpreis mit möglichen Minima im
zulässigen Zeitfenster. `latest_by` begrenzt, wie lange der Nutzer warten kann.
Die Wahrscheinlichkeit `p_besser` zählt das relevante Ereignis über die Draws;
Geldbeträge werden mit der Tankmenge skaliert.

Zwei Beträge dürfen nicht verwechselt werden:

- `saving_eur`: pfadbasierter Vorteil über Fensterminima („bis zu“).
- `saving_median_eur`: Vergleich zum Minimum der Median-Kurve („erwartet“).

Die primäre Antwort und die Fensterlisten verwenden dieselbe Semantik.
Aktuelle Schwellen und Prioritäten stehen in `app/decide.py` und
`app/thresholds.py`, der öffentliche Vertrag in der
[API-Referenz](../referenz/API.md). Dieses Konzept führt keine zweite
Parametertabelle mit abweichenden Prototypwerten.

### F2: Hier oder woanders

Netto-Vorteil ist Preisvorteil mal Tankmenge minus Umwegkosten. Die
Wahrscheinlichkeit `p_lohnt` beruht auf gemeinsamen Draws. Bei frischer
Referenz kann deren beobachteter Preis als Konstante eingehen; die alternative
Station bleibt in der implementierten Konditionierung draw-basiert. Der
[Projektstand](../planung/LUECKEN.md) nennt diese Grenze ausdrücklich.

### F3: Heute oder später

Die App zeigt veröffentlichte Fenster der nächsten Tage und berücksichtigt den
spätesten Tankzeitpunkt. Sie behauptet keine Top-3-Trefferquote über drei
unabhängig erzeugte Kandidaten, wenn die Engine nur eine Prognosestunde pro
Tag veröffentlicht. Mehrtagesbänder sind nicht PIT-kalibriert.

### Keine klare Empfehlung

Fehlende Daten oder nicht bestandene Gates sind ein regulärer Produktzustand.
Die App erklärt den Grund und zeigt verfügbare aktuelle Preise, statt eine
Ampel oder Prozentzahl zu erfinden. Beobachtungsdaten bleiben auch dann
nützlich, wenn eine Empfehlung nicht freigegeben ist.

Seit A21-B1.4 (0.64.0) prüft die Freigabekette jede Handlung auf
ausreichende **aktuelle** Evidenz (§0.4): ein aus einem letzten Preis
gerechnetes Median-Potenzial ist keine Handlung mehr — die App zeigt die
Spanne als Fakt und nennt als Grund den Sperrgrund der Kette
(`blocking_reasons`), nicht nur „das Modell lernt noch“. Der Lern-Zählstand
bleibt sichtbar, steht aber hinter dem konkreten Grund zurück. Eine
freigegebene Handlung ist befristet (`valid_until`); abgelaufen darf kein
Cache sie erneut aussprechen.

## Feedback und persönliche Bilanz

### Drei getrennte Ebenen

| Ebene | Quelle | Aussage |
|---|---|---|
| Markt-Labor | Preisreihe und Rolling-Origin-Backtest | Wie eine Regel auf dem Markt abgeschnitten hätte |
| Live-Advice | Gespeicherte und gegen Preise abgerechnete Empfehlungen | Brier, Trefferquote und Regret der ausgegebenen Advice |
| Wallet | Tatsächliche Tankbelege | Persönliche Bilanz und Befolgung |

Ein Intent („Ich warte“) ist kein Tankbeleg. Ein erfolgreicher Advice-Snapshot
ist kein Nachweis persönlicher Ersparnis. Die drei Ebenen dürfen nicht in
einer Kennzahl zusammengerechnet werden.

### Folgen, Snapshots und Belege

Eine Tank-Folge (`episode`) bündelt Empfehlungen bis zur Buchung oder zum
Verfall. Wiederholtes Öffnen darf die Gütemessung nicht vervielfachen:
Snapshots werden nach den Regeln in `app/feedback.py` zusammengefasst.
Settlement bewertet sie anhand der Preisgeschichte auch ohne Tankbeleg.

Ein Beleg wird über Station, Zeitpunkt, Liter und Preis zugeordnet. Befolgung
wird gegen die relevante vorherige Empfehlung bewertet; die persönliche
Vergleichsbilanz verwendet den dokumentierten Gegenfall „immer sofort“.
Nicht zuordenbare Belege bleiben als solche kenntlich. Storno erhält eine
Audit-Spur; CSV-Export und Offline-Queue sind vorhanden.

Das Stundenprofil `w(h)` braucht mindestens acht Füllungen, bevor persönliche
Daten den Default verdrängen sollen. Belegdaten dürfen nicht die Güte des
Marktmodells vortäuschen. Payloads, Zeitfenster und Zustände sind in der
[API](../referenz/API.md) verbindlich beschrieben.

## Fahrzeug und Umwegkosten

Fahrzeugparameter verändern die Entscheidung, nicht die Marktpreisprognose.
Kraftstoffsorten werden getrennt betrachtet. Eine pauschale E5/E10-
Verbrauchsäquivalenz wird ohne Fahrzeugmessung nicht ins Ranking eingerechnet.

Für Tankmenge `L` und Preisunterschied `Δp` in €/L gilt:

```text
Brutto-Vorteil = Δp · L
K = d · (c / 100) · p + (d / v) · z
Netto-Vorteil = Brutto-Vorteil − K
Kritische Preisdifferenz = K / L
```

`d` ist der zusätzliche Weg in km, `c` Verbrauch in L/100 km, `p` Kraftstoffpreis,
`v` Geschwindigkeit und `z` Zeitwert in €/h. Bei einer Extrafahrt (`dedicated`)
zählt Hin- und Rückweg; bei `onroute` nur der zusätzliche Weg. Sprit- und
Zeitanteil bleiben unterscheidbar. Der eingesetzte Zeitwert wird ausgewiesen.

## Oberfläche und Betrieb

Die aktuelle Navigation und Zustände stehen in [UI](UI.md), alle Textregeln in
[Microcopy](MICROCOPY.md). Die beiden Prototypen in `sample/` bleiben Design-
Basis, nicht Datenquelle; maßgeblich sind die [Übernahmeregeln](GUI-VORLAGEN.md).

Pi sammelt und puffert unabhängig vom NAS. Das NAS rechnet, persistiert und
liefert API/Web-GUI. Der optionale RP2-Zugang proxyt das NAS und bleibt bei
dessen Ausfall lesend erreichbar. Installation, Dienste und Speicherpfade
werden nicht nochmals im Produktkonzept gepflegt:
[Architektur](../architektur/ARCHITEKTUR.md) ·
[Installation](../betrieb/INSTALL.md) · [Betrieb](../betrieb/BETRIEB.md).

## Abnahme und Grenzen

- Gates müssen aus ausreichend echten Daten bestehen, nicht nur im Testfall.
- Prognosegüte ist je Horizont, Station und Datenlage zu messen.
- Parameteränderungen benötigen einen dokumentierten Ablationsvergleich.
- Regime-Simulationen belegen Mechanismen, keine tatsächliche künftige
  Marktentwicklung. Rechtsfragen und politische Szenarien stehen im
  [Regime-Plan](../planung/REGIME.md), nicht als implementierte Zusage hier.
- Betrieb ist für einen deutschsprachigen Haushalt im eigenen LAN ausgelegt;
  öffentliche Bereitstellung ist kein freigegebener Betriebsmodus.

Offene Aufgaben stehen nur in [TODO](../planung/TODO.md), bewusst begrenzter
Umfang in [ADR 0002](../adr/0002-PRODUKTUMFANG.md).
