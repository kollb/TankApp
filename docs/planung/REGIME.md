# Regime-Behandlung: Plan und Messstand

> Stand: 20.09.2026 · App-Version 0.59.1
> **Planungsdokument, keine Rechtsauskunft und keine Implementierungszusage.**
> Quelle: [datierter UX-/Mathe-Befund](../archiv/BEFUND-UX-MATH-2026-09-19.md#teil-5-regime-wechsel--tankrabatt-und-spritpreisdeckel).

## Inhaltsverzeichnis

- [Annahmen und Grenzen](#annahmen-und-grenzen)
- [Implementierter Stand](#implementierter-stand)
- [Vorgesehene Konstruktion](#vorgesehene-konstruktion)
- [Aktivierungsbedingungen](#aktivierungsbedingungen)
- [Messstand](#messstand)
- [Abnahme](#abnahme)

## Annahmen und Grenzen

Der Repository-Befund plant mit einem befristeten Rabatt ab 01.10.2026,
dessen Ende am 01.01.2027 und einem möglichen beweglichen Preisdeckel.
Termine und der dort verwendete Ankündigungsbetrag von 17 ct/L sind
**Eingangsannahmen des Befunds**, in dieser Aufräumaktion nicht extern geprüft.
Bestätigte Rechtslage und konkrete Ausgestaltung sind vor dem Eingriff zu
klären (A14/A15).

Ein Niveau-Bruch betrifft nicht nur den Punktwert: Trainingsresiduen, Intervalle,
Feiertags-Pool, MASE-Skala und Advice-Gates können unterschiedliche Zeiträume
lang verzerrt sein. Die Ankündigung ist daher keine gemessene Durchgabe.

## Implementierter Stand

- Regime-Kalender über `TANKAPP_REGIMES` und Break-Marker im Backtest.
- Ausschluss markierter Bruchfenster aus dem PIT-Training und
  45 lokale Tage Aktivierungs-Blackout nach einer Kante.
- Day-Pair-Ziehung vermeidet Paare, deren späterer Trainingstag auf einer
  deklarierten Kante liegt; ohne gültiges Paar unabhängige Tage.
- Live-bedingte Referenz der Wahrscheinlichkeitsseite.
- Offline-Werkzeug `analysis/regime_check.py` für Messung und Simulation.

**Nicht dadurch implementiert:** eine allgemeine Niveau-Normalisierung,
Regime-Ausnahmen der Produktivprojektion, ein gesetzlicher Deckel oder die
vollständige Bereinigung von Gates und Alarmen. `TANKAPP_REGIME=0` ist im alten
Befund ein geplanter Gegenmessungsschalter, kein hier zugesagter aktueller
Betriebsschalter. Verfügbare Optionen stehen in
[Engine](../referenz/ENGINE.md) und [Betrieb](../betrieb/BETRIEB.md).

## Vorgesehene Konstruktion

| Baustein | Ziel | Voraussetzung |
|---|---|---|
| R1 Kalender | Datierte Eingriffe als Daten statt verstreuter Datumskonstanten | Bestätigter Termin, Geltungsbereich und Sorte |
| R2 Schätzung | Wirksamkeitszeit und Niveauänderung aus Daten schätzen; Modell und Feiertags-Pool konsistent behandeln | Ausreichende Beobachtungen und Behandlung fehlender Standardfehler |
| R3 Projektion | Rechtlich zulässige Kante als zusätzliche Segmentgrenze, kein Pooling über den erlaubten Sprung | Schriftliche Klärung A14 und Invarianztest |
| R4 Deckel | Bewegliche Schranke `cap(t)` vor der Mittagsprojektion | Bestätigte Ausgestaltung A15 und Reihenfolge-Test |
| R5 Degradation | Advice, Alarme und Schwellennachzug bei unsicherem Übergang begrenzen | Messbare Schutzregeln und verständliche Zustände |

Keine pauschale Verschiebung sämtlicher Trainingsdaten um den angekündigten
Betrag. Keine Szenario-Mischung auf Grundlage einer ungeklärten
Verzögerungsschätzung. Keine neue kalibrierte Wahrscheinlichkeitsaussage allein
durch das Abschneiden an einem Deckel.

## Aktivierungsbedingungen

Dieser Plan ist keine zweite Pflicht-TODO-Liste. Nach **A14** wird aus der
bestätigten Rechtslage und dem tatsächlichen Betrieb abgeleitet, welche
Eingriffe notwendig sind. Erst diese werden mit konkreter Abnahme in
[TODO](TODO.md) aufgenommen; die bisherigen Szenario-Termine allein lösen
keinen Auftrag aus. Die folgenden Punkte bleiben ungeklärt, nicht erledigt:

| Punkt | Auslöser | Erforderlicher Nachweis vor Freigabe |
|---|---|---|
| A15: `cap(t)` | Bestätigter, tatsächlich geltender Deckel | Ausgestaltung je Sorte/Region, Clip vor Projektion, Reihenfolgetest, kein erfundener Konstantwert |
| H6: Projektionskante | Rechtlich bestätigte Ausnahme nach A14 | Erlaubter Sprung bleibt stehen; ohne konfigurierte Ausnahme unverändertes Verhalten; echte Verstöße weiter erkannt |
| H7: Feiertags-Pool | Bestätigter Niveauwechsel im verwendeten Trainings-/Feiertagsbestand | Modell und 365-Tage-Pool konsistent normalisiert, Regressionstest und Vorher-/Nachher-Messung von `holiday_beta` unter `THETA_CT = 1,0` ct/L |
| H8: Gates und Zähler | Betroffene Datenfenster werden für Güte-Gates/Alarme verwendet | Normalisieren oder explizit suspendieren; MASE-Nenner darf das Gate nicht künstlich verbessern, Stabilität und Ledger mit Regime-Kennzeichnung |
| H9: Advice und Alarme | Aktive Entscheidungen/Alarme über eine bestätigte Kante | Kanten- gegen Referenztag messen; Hysterese und Gegenalarme bereinigen oder sperren; Degradation validieren |
| H10: Konditionierung | Wirksamkeitsbehauptung oder Erweiterung der vorhandenen B1-Konditionierung | Identischer Bestand mit/ohne Konditionierung, Intervallbreite und Wahrscheinlichkeitsrichtung vergleichen |

Für R2 bleiben vor einer Aktivierung die Grenzen der Juli-Messung zu lösen:
fehlende `se_ct` behandeln, Detektionsfenster begrenzen und den abweichenden
Diesel-Ankündigungswert klären. Das ist kein erneuter A16-Messauftrag ohne
begründeten Bedarf. Ausstehende Betriebsnachweise stehen im
[Projektstand](LUECKEN.md#ausstehender-betriebsnachweis).

## Messstand

### Juli-Generalprobe A16

Am 20.09.2026 wurde auf dem Daten-Host Frankfurt E10/Diesel ausgewertet;
Berichte liegen privat unter `data/analysis/`. Diese Dokumentation übernimmt
den protokollierten Befund und behauptet keinen neuen Messlauf.

| Größe | E10 | Diesel |
|---|---|---|
| Gültige Beobachtungen | 586.297 | 591.280 |
| Stationen / geschätzt | 282 / 256 | 284 / 258 |
| δ Median | +21,0 ct/L | +25,0 ct/L |
| p10–p90 | 17,0–23,0 ct/L | 22,5–28,0 ct/L |
| Spread | 11,0 ct/L | 10,5 ct/L |
| Durchgabe gegen angesetzte 17 ct/L | 123,5 % | 147,1 % |
| Verzögerung Median / Maximum | 0 / 14 Tage | 9 / 14 Tage |

**Belastbare Folgerung:** Betrag nach Sorte schätzen, nicht auf die Ankündigung
festsetzen. **Nicht übernommen:** die Verzögerung. Sie ist bimodal und kann
von einem weiteren Marktereignis oder vom zu langen Detektionsfenster stammen.
Der Export startete am 15.06.2026 ohne `--until`; die Detektion lief nicht nur
über das vorgesehene ±14-Tage-Fenster.

Weitere Grenzen:

- Genau 24 belegte Slots pro Station: faktisch Stundenraster und kein Puffer
  gegenüber der Mindestsubstanz.
- `se_ct` in etwa einem Drittel der Zeilen nicht berechenbar; Standardfehler-
  Behandlung und Darstellung fehlen, der Slot-Median δ bleibt davon getrennt.
- Diesel-Ankündigung 17,0 ct im Kalender versus 14,04 ct im Werkzeugbeispiel
  klären; das verändert Prozentrelationen, nicht die absoluten δ-Schätzungen.
- Tagesmedian-Plot und begrenztes Detektionsfenster vor einer Interpretation
  stationsweiser Verzögerungen nachreichen.

### Simulationen

Die im archivierten Befund dokumentierten Zahlen verwenden die echte
`fit`/`predict`-Kette auf synthetischen Reihen. Sie belegen Mechanismen,
keine zukünftigen Marktpreise und keinen neuen Benchmark des aktuellen Defaults:

- Intervalle wuchsen im Szenario von etwa 7,9 auf 23–26 ct/L.
- Eine +16,89-ct-Mitternachtskante wurde ohne zusätzliche Segmentgrenze
  auf null gepoolt; 231 von 288 Punkten wurden verändert.
- Im Anstiegsszenario stand `p_besser = 0,920` einem wahren Fensterminimum
  von +10,0 ct/L gegenüber.
- Ein bewegter Deckel nach der Projektion konnte einen Anstieg von +5 ct/L
  erzeugen; Reihenfolge und Randbedingungen müssen daher geprüft werden.

Vollständige Messtabellen bleiben im
[Originalbefund](../archiv/BEFUND-UX-MATH-2026-09-19.md#510-anhang-a-messtabellen).
Aufruf des Messwerkzeugs:
[Datenwerkzeuge](../referenz/DATENWERKZEUGE.md#regime-check-durchgabe-einer-steuer--oder-deckel-änderung).

## Abnahme

1. Gleicher Bestand und gleiche Tage: Status quo, R3 und R2 im
   Rolling-Origin-Backtest über die Juli-Kante vergleichen.
2. Ziele aus dem Plan: Bias q50 am Sprungtag ≤ 3 ct/L, Intervallbreite
   ≤ 1,5-facher Vor-Bruch-Basiswert, Wahrscheinlichkeit in Richtung der
   beobachteten Wahrheit; im synthetischen Anstiegsszenario `p_besser ≤ 0,20`.
3. Ohne konfigurierte Kante unveränderte Prognose; gesetzlich erlaubte Kanten
   und echte Regelverletzungen weiterhin unterscheiden.
4. PICP je Quantilstufe, Brier mit/ohne Regime-Kante getrennt, MASE auf
   bruchfreien Fenstern und Alarmzahlen an Kanten-/Referenztagen ausweisen.
5. Deckelnähe nur nach Abgleich von `p_at_cap` und tatsächlich beobachteter
   Deckelbelegung interpretieren.

A16 erfüllt die Bestandsmessung, **nicht** diese gesamte Abnahme. Die
10–14-Tage-Advice-Degradation ist ein zu prüfender Plan; sie ersetzt nicht den
technischen 45-Tage-PIT-Blackout.
