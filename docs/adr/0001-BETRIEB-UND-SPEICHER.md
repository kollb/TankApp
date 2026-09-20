# ADR 0001: Speicher und Sicherungen im Haushaltsbetrieb

- **Status:** angenommen; bestehende Entscheidungen konsolidiert.
- **Stand:** 18.09.2026 · dokumentiert 20.09.2026 · App 0.59.1.

## Inhaltsverzeichnis

- [Kontext](#kontext)
- [Entscheidung](#entscheidung)
- [Konsequenzen](#konsequenzen)
- [Wiederaufnahme](#wiederaufnahme)

## Kontext

Der Pi soll die SD-Karte schonen und unabhängig vom NAS sammeln. Laufende
GUI-Abfragen benötigen häufigen Zugriff; ein HDD-Spindown wäre bei Influx
auf HDD kaum erreichbar. Ein zweites automatisches Backup-Gerät steht im
Haushalt nicht bereit.

## Entscheidung

- Collector-Puffer und RP2-Prognose-Cache bleiben flüchtig (G4). Kein
  regelmäßiger SD-Spiegel des Prognose-Caches.
- InfluxDB und Runtime bleiben auf SSD, das große Archiv auf HDD.
- Runtime-Backup mit 14 Tages- und sechs Monatsständen sowie
  Alterungsalarm ab 36 Stunden beibehalten. Unersetzbare Daten erhalten eine
  **manuelle Zweitkopie**; kein zweites automatisches Backup-Ziel (B25).
- `route/evaluate` bleibt separat: Bündelung würde Routenparameter in den
  Overview-Cache-Schlüssel ziehen, bei geringem gemessenem Zeitvorteil.

## Konsequenzen

Nach Pi-Reboot kann der Prognose-Cache kalt sein; die GUI muss das erklären.
Überlange NAS-Ausfälle können ungesyncte Polls aus dem RAM-Ring verdrängen.
Eine Sicherung auf demselben Gerät schützt nicht vor dessen Totalausfall:
Die manuelle externe Zweitkopie bleibt eine Betreiberpflicht, kein durch
Retention gelöstes Risiko.

## Wiederaufnahme

Neu bewerten bei verfügbarer Zweithardware, unzureichender Wiederherstellbarkeit,
geänderter Speicherkapazität oder gemessenem Performancebedarf.
Anleitungen und Zahlen: [Speicher](../betrieb/SPEICHER.md),
[Backup](../betrieb/BETRIEB.md#nas-laufzeitdaten-runtime-backup),
[Route-Messung](../entwicklung/QUALITAET.md#b7-rest-routeevaluate-bleibt-ein-eigener-abruf).
