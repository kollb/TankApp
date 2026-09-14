# GUI-FALLBACK-SANITY — Prüfbericht 2026-09-14

> **Archiviert am 14.09.2026 · App-Version 0.37.1.** Stichtagsprüfung nach echter NAS/Pi-Abnahme des GUI-Neuentwurfs. Nachfolger für offene Produktpunkte: [../LUECKEN.md](../LUECKEN.md). Laufende Betriebsanweisungen stehen in [../BETRIEB.md](../BETRIEB.md) und [../RP2.md](../RP2.md).

- [1. Ergebnis](#1-ergebnis)
- [2. UX/UI-Sanity](#2-uxui-sanity)
- [3. Implementierungs-Sanity](#3-implementierungs-sanity)
- [4. Default-Werte und Ehrlichkeit](#4-default-werte-und-ehrlichkeit)
- [5. Gefundener Fehler und Fix](#5-gefundener-fehler-und-fix)
- [6. Bewusst nicht gebaut](#6-bewusst-nicht-gebaut)
- [7. Prüfungen](#7-prüfungen)

## 1. Ergebnis

Die Grundarchitektur macht Sinn: Die NAS-GUI ist die vollständige Oberfläche, die RP2-Fallback-GUI ist ein bewusst schmaler Notbetrieb mit denselben drei Antwort-Fakten. Der Aufbau ist insgesamt konsistent mit dem Ziel „an der Säule schnell entscheiden, Details nur auf Nachfrage“.

Ein echter Fehler wurde gefunden und behoben: Die Fallback-GUI konnte kurze Stadt-Keys wie `FRA`/`GT` nicht sauber anbieten, obwohl 20 Stationen im Puffer standen. Ursache war eine verlorene Stadtidentität zwischen `polling.json`-Set-Key, sichtbarem Label und Snapshot-`city`. Fix in 0.37.1: `city_key`/`city_label`, neues Health-Feld `city_options`, API-Filter akzeptiert Key und Label.

## 2. UX/UI-Sanity

### NAS-GUI

**Sinnvoll:**

- Die Bereiche **Jetzt → Stationen → Woche → Ich → Labor → System** trennen Aufgaben statt technische Datenquellen. Das ist für Alltag, Analyse und Betrieb richtig.
- „Jetzt“ bleibt die schnelle Entscheidung: Entscheidung, drei Fakten, Schritte, Tagesstreifen, Frische. Das hält die Startansicht fokussiert.
- „Stationen“ trennt Referenz, Liste, Karte, Verlauf und A-gegen-B. Das ist fachlich besser als eine reine Preisrangliste, weil jede €-Zahl einen Bezugspunkt hat.
- „Labor“ ist der richtige Ort für Warum-Fragen, Modellgüte, Rohpreise und Glossar. Die Erklär-Treppe vermeidet, dass die Startansicht zur Expertenansicht wird.
- „System“ ist als Betriebsbereich sinnvoll: Zustand, Daten, Läufe, Störungen, Diagnose-Export. Die vier Bausteine Collector/Datenbank/Modelle/App sind für Fehlerdiagnose genau die richtige Abstraktion.

**UX-Risiken, aber keine Blocker:**

- Die Oberfläche ist inzwischen dicht. Der primäre Pfad ist klar, aber Labor/System sind informationsreich. Das ist vertretbar, solange sie nicht in „Jetzt“ hineinwandern.
- „Glossar“ als eigener Tab ist ein Nebenweg; er ist nützlich, aber kein Kernpfad. Kein Änderungsbedarf, solange der Hauptpfad nicht verdrängt wird.
- Viele Einstellungen sind bewusst am Wirkungsort. Das ist gut, verlangt aber weiterhin strikte Tests, damit Defaults nicht wieder an mehreren Stellen auseinanderlaufen.

### RP2-Fallback-GUI

**Sinnvoll:**

- Die Fallback-GUI ist nicht die NAS-GUI in klein, sondern ein Notbetrieb: Antwortkarte, Tagesstreifen, Stationsliste, Prognose-Cache, Rohdaten. Das ist richtig für Pi/Standardbibliothek.
- Die drei Fakten entsprechen der NAS-Startkarte in derselben Reihenfolge; der dritte Fakt ist bewusst „Frische Preise“ statt Tankstand, weil Tank/Profile NAS-Sache sind.
- Die Trennung Alltag/Werkstatt im Fallback ist ausreichend: Alltag für Entscheidung, Werkstatt für Cache/Rohdaten/Datenstatus.
- Dark/Light und Auto-Refresh sind sinnvoll, weil der RP2 oft als dauerhaft offener Zugang läuft.

**UX-Risiko:**

- Der Ortsfilter muss die echte Betriebsidentität zeigen. Wenn der Betreiber mit `FRA`/`GT` arbeitet, müssen genau diese Kürzel auswählbar sein. Das war der gefundene Fehler und ist jetzt abgesichert.

## 3. Implementierungs-Sanity

**Richtig umgesetzt:**

- Keine zweite Wahrheit: Die NAS-GUI nutzt weiter `/api/v1` und teilt den Overview-Poll für „Jetzt“, „Stationen“ und „Woche“.
- Fehler-/Leer-/Ladezustände sind als eigene Zustände gebaut, nicht als leere Karten.
- `Level1Sheet` hat `role="dialog"` und `aria-modal="true"`.
- Fallback bleibt Standardbibliothek und proxyt das NAS transparent mit `X-TankApp-Proxy: nas`.
- Fallback-Template ersetzt sich über Inhalts-Hash, nicht nur über die sichtbare Version; damit kommen JS/CSS-Fixes bei gleicher Template-Version auf bestehende Installationen.
- Keine Demo-Preise im Produktpfad; Fallback liest RAM-Puffer und Prognose-Cache.

**Gefundene Implementierungslücke:**

- Fallback-Ortsfilter: Health lieferte nur `cities` aus der gerade zusammengebauten Stationsliste. Wenn Set-Key (`FRA`/`GT`), Label (`Frankfurt`/`Gütersloh`) und Snapshot-`city` nicht identisch waren oder das Label fehlte, konnte die Auswahl oben leer/falsch sein, während die Liste alle 20 Stationen zeigte.

## 4. Default-Werte und Ehrlichkeit

### NAS-GUI Defaults

- Kraftstoff: `e10`.
- Stadt: leer bzw. erste vom Server gelieferte Stadt, wenn noch keine lokale Wahl passt.
- Tankmenge: 40 L.
- Verbrauch: 7 L/100 km.
- Zeitwert: 12 €/h, mit Auto-Zeitwert als eigener Anzeigeweg.
- Fahrtmodus: „auf dem Weg“ (`onroute`).
- Geschwindigkeit: 45 km/h.
- Tankgröße: 50 L.
- Heatmap: 6 Wochen, Basis `hour` für Cheap-Probability ohne Station.
- Theme: dunkel.

Bewertung: Diese Defaults sind sichtbar bzw. in „Ich“ änderbar und liegen in plausiblen Grenzen. Wichtig ist, dass sie keine fachlichen Messwerte vortäuschen: Modellgüte, Tankstand, Stadtmedian, Routen und Kalibrierung werden nicht geraten.

### Fallback Defaults

- Kraftstoff: `e10`.
- Ort: alle Orte.
- Tankmenge: 40 L.
- Sortierung: Preis.
- Ansicht: Alltag.
- Theme: Systempräferenz bzw. gespeicherte Wahl.
- Frischegrenze: 15 Minuten.
- Fallback-Warteentscheidung: ab 1,00 € erwarteter Ersparnis und Preis-Score ≥ 0,5.

Bewertung: Für einen Notbetrieb sind diese Defaults sinnvoll. Der Fallback sagt ausdrücklich „Preis-Score“ und nicht „kalibrierte Wahrscheinlichkeit“. Das ist wichtig, weil die echte M7-Kalibrierung auf dem NAS liegt.

## 5. Gefundener Fehler und Fix

### Fehler

Oben in der Fallback-GUI konnten `FRA`/`GT` nicht ausgewählt werden, obwohl 20 Stationen gelistet waren.

### Ursache

`StationMeta.load()` speicherte nur ein sichtbares Stadtlabel. Der stabile Set-Key aus `polling.json` ging verloren. `_api_health()` baute die Select-Optionen aus `row["city"]`; `_filter_city()` verglich nur gegen genau diesen einen Wert. Dadurch waren die Kurz-Keys nicht zuverlässig als Filterwerte verfügbar.

### Fix in 0.37.1

- `StationMeta.load()` speichert `city_key` und `city_label`.
- `build_stations()` reicht beide Felder in jede Stationszeile durch.
- `_api_health()` liefert zusätzlich `city_options` mit `{value, label}`.
- Das Template rendert z. B. `FRA · Frankfurt` und nutzt `FRA` als stabilen Wert.
- `_filter_city()` akzeptiert `city`, `city_key` und `city_label`, damit alte Links/Labels weiter funktionieren.
- Regressionstests decken `city=GT`, `city=FRA` und ausgeschriebene Labels ab.

## 6. Bewusst nicht gebaut

- Keine Tankstand-/Profil-/Beleg-Funktionen im Fallback: NAS-only, weil sie Persistenz und Haushaltszustand brauchen.
- Kein `/api/v2`: Der gebaute Zustand braucht ihn nicht; `/api/v1` bleibt die eine Wahrheit.
- Keine zusätzlichen Features im Abnahme-Fix: nur Filterfehler, Dokumentation und Checklistenabschluss.

## 7. Prüfungen

Lokal im Sandbox geprüft:

```text
python -m pytest tests/test_rp2_fallback.py -q  → 39 passed
python -m pytest -q                            → 762 passed
npm --prefix web test                         → 544 passed
npm --prefix web run build                    → grün
```

Nicht lokal abgeschlossen: `npm --prefix web run test:e2e`, weil der Playwright-Browser im Sandbox fehlt und `npx --prefix web playwright install chromium` am CDN mit `ECONNRESET` scheitert. Das ist ein Infrastrukturfehler des Sandbox-Laufs, kein fachlicher Befund aus der GUI.

Die echte NAS/Pi-Abnahme wurde laut Rückmeldung vom 14.09.2026 durchgeführt; der daraus gemeldete Fallback-Filterfehler ist der oben dokumentierte Fix.
