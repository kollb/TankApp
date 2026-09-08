# TankApp

Persönliche Spritpreis-Entscheidungs-App: **jetzt tanken · warten · woanders**.
Collector und RAM-Puffer auf dem Raspberry Pi, InfluxDB und Modell-Fits auf
dem NAS, später eine gemeinsame Homepage mit Alltag und Statistik-Werkstatt.

## Stand · 08.09.2026

| Bereich | Arbeitsstand |
|---|---|
| M1 – Collector / Uploader / InfluxDB | Läuft; InfluxDB wird laut Betreiber befüllt. Der formale 14-Tage-Lücken-/Ack-Nachweis bleibt eine Betriebsprüfung. |
| M2 – Stationsauswahl | Nach Betreiber-Rückmeldung vorläufig abgeschlossen. Polling-Set und echter Selektionsbericht liegen lokal, nicht im Git-Checkout. |
| **M3 – Prognose / Backtest** | **In Arbeit:** nur lesender Influx-Export, Datenprüfung, robustes Strukturmodell + AR(2), saisonale Naive, vorläufige Intervalle, Rolling-Backtest und JSON-Artefakte. Ensemble, ACI und Echt-Daten-Abnahme stehen noch aus. |
| M4/M5 – Homepage / API | Die beiden vorhandenen GUIs sind die Basis, kein neues beliebiges Design. Produktive Datenanbindung folgt auf die Engine. |

### Die GUI-Vorlagen bleiben erhalten

- **[`sample/good gui`](sample/good%20gui/):** Optik, Navigation und
  Entscheidungs-Kompass als Basis der Alltags-Homepage.
- **[`sample/good statistic gui`](sample/good%20statistic%20gui/):**
  Scoreboard, Kalibrierungsansicht und Stations-/Paar-Labor als Basis des
  Statistikbereichs.
- [Übernahmeregeln](sample/README.md): Layout, Farben und Komponenten
  bewahren; simulierte Preise und Beispiel-Gütewerte **nicht** als echte
  Ergebnisse übernehmen. Die benötigten Preview-Seeds bleiben bis zur
  Überführung der Oberflächen bestehen.

## Weiter mit echten Daten

**Neu: [Archiv-Warmstart, 90-Tage-Übergang und Gütersloh](docs/HISTORIE-LIVE-STRATEGIE.md).**
Dieselben Tankerkönig-Preise über Archiv und Polling nutzen, statt drei Monate
zu warten. `engine bootstrap` erzeugt eine gemeinsame Trainingsdatei mit
Bezugsweg-Grenze und geprüftem Übergang je Station. Die Anleitung trennt klar
zwischen umgesetzt, noch zu automatisieren und noch zu kalibrieren.

**[M3 am Windows-PC testen → `engine/README.md`](engine/README.md)** —
Schritt für Schritt mit **PowerShell**, ohne WSL oder Aktivierungsskripte:
Tests ausführen und vorhandene M2-CSVs direkt prüfen, backtesten und fitten.
Dafür sind weder NAS noch API-Schlüssel nötig. Optional die Live-Historie aus
InfluxDB mit separatem Lese-Token hinzunehmen. `data\apikey.txt` bleibt der
Tankerkönig-Schlüssel für den Collector, nicht für InfluxDB.

Der Export selbst ändert keine Dienste, Buckets oder Ack-Dateien. Für bestehende
Namenskollisionen ist einmalig die [Stations-UUID-Umstellung](docs/STATIONS-UUID.md)
auf dem RPi nötig (neuer Uploader-Tag, optionaler Replay aus Original-JSONL).
Noch keine kalibrierten Empfehlungen; die Anleitung enthält auch Hilfe bei fehlender
Historie und einen isolierten Collector-Einzeltest mit der vorhandenen Schlüsseldatei.

## Dokumentation

- [Installation & Betrieb](docs/INSTALL.md) — Pi/NAS, systemd, Secrets, Kontrolle.
- [Historie + Live: Strategie und nächste Schritte](docs/HISTORIE-LIVE-STRATEGIE.md) —
  sofortiger Warmstart, Übergangsregeln und Gütersloh ohne Überschreiben Frankfurts.
- [Datenbezug](docs/DATEN-BEZUG.md) · [Werkzeuge](data-tools/README.md) —
  Historie holen, InfluxDB exportieren, Polling-Set bei Bedarf neu erstellen.
- [Stationsselektion](analysis/README.md) — Methodik und lokale Ausgaben.
- [Stationsnamen eindeutig machen](docs/STATIONS-UUID.md) — UUID-Tags und sichere
  Nachlieferung, ohne alte Serien zu löschen oder den Ack zurückzusetzen.
- [Preis-Zwillinge prüfen und Ersatz vorschlagen](docs/PREIS-ZWILLINGE.md) —
  Windows-Befehle für UUID-getrennte Preisvergleiche, ohne das aktive Set zu ändern.
- [Produkt- und Architekturkonzept](docs/KONZEPT.md) — Zielbild und Roadmap;
  **nicht** alle beschriebenen Funktionen sind schon implementiert.

Die alten synthetischen Selektionsberichte, Abbildungen und separaten
Demo-Datengeneratoren wurden entfernt. Neue Berichte, Exporte, Modelle und
private Konfigurationen bleiben gitignored; keine Beispielzahlen als Abnahmenachweis.

## Entwicklung am Windows-PC prüfen

PowerShell im Repository-Ordner, Python **3.11+**. Eigene M3-Umgebung anlegen;
eine bestehende passende `.venv-m3` weiterverwenden und dann den ersten Befehl auslassen:

```powershell
py -3 -m venv .venv-m3
.\.venv-m3\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv-m3\Scripts\python.exe -m pytest -q
.\.venv-m3\Scripts\python.exe -m ruff check engine data-tools/export_influx.py tests
```

Die M2-Umgebung `.venv` bleibt bestehen. Keine `Activate.ps1` oder Änderung
der ExecutionPolicy nötig. Python-Versionsprüfung und alle folgenden Schritte:
[Windows-Anleitung](engine/README.md).
