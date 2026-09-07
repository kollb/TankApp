# TankApp

Persönliche Spritpreis-Entscheidungs-App: **jetzt tanken · warten · woanders**.
Collector und RAM-Puffer auf dem Raspberry Pi, InfluxDB und Modell-Fits auf
dem NAS, später eine gemeinsame Homepage mit Alltag und Statistik-Werkstatt.

## Stand · 07.09.2026

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

**[M3 ausführen → `engine/README.md`](engine/README.md)** — auf NAS oder PC:
InfluxDB nur lesen, Datenqualität prüfen, historische Daten bei Bedarf
hinzunehmen, Backtest rechnen. Keine Änderungen an Collector, Uploader,
Bucket oder Ack-Dateien erforderlich. Noch keine kalibrierten Empfehlungen.

## Dokumentation

- [Installation & Betrieb](docs/INSTALL.md) — Pi/NAS, systemd, Secrets, Kontrolle.
- [Datenbezug](docs/DATEN-BEZUG.md) · [Werkzeuge](data-tools/README.md) —
  Historie holen, InfluxDB exportieren, Polling-Set bei Bedarf neu erstellen.
- [Stationsselektion](analysis/README.md) — Methodik und lokale Ausgaben.
- [Produkt- und Architekturkonzept](docs/KONZEPT.md) — Zielbild und Roadmap;
  **nicht** alle beschriebenen Funktionen sind schon implementiert.

Die alten synthetischen Selektionsberichte, Abbildungen und separaten
Demo-Datengeneratoren wurden entfernt. Neue Berichte, Exporte, Modelle und
private Konfigurationen bleiben gitignored; keine Beispielzahlen als Abnahmenachweis.

## Entwicklung prüfen

Python 3.11+, in einer separaten Entwicklungsumgebung:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m pytest -q
python -m ruff check engine data-tools/export_influx.py tests
```
