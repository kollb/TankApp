# data-tools/ – Datenbezug für die TankApp

Werkzeuge, um die **Historie** (Tankerkönig-Datenrepo, eine CSV pro Tag) zu holen und in das
Analyse-Schema zu überführen — ohne das 100-GB-Repo zu clonen.
**Ausführliche Anleitung inkl. Größen-/Zeitrechnung und Fehlerbildern: [`docs/DATEN-BEZUG.md`](../docs/DATEN-BEZUG.md).**

| Skript | Zweck |
|---|---|
| **`run_pipeline.py`** | **Alles in einem Befehl:** fetch → ingest → Selektion → `polling.json`. Lädt fehlende Tage nach (idempotent), sichert die Stationsliste, ingesiet mit `--resample 30 --density 60 --fuel e10`, selektiert alle Städte aus `config.local.json` und baut das Polling-Set für eine Stadt (Default Frankfurt) nach der Regel **N_billigste im Gesamtumkreis (Preis-Leader) + N_billigste in der Nähe des Ankers** (max. 2 je Marke). Ausgabe u. a. `docs/analysis/stations/polling.json` (gitignored). Windows: `py -3 data-tools\run_pipeline.py` — netrc wird automatisch unter `data/_netrc` gefunden. |
| `fetch_history.py` | Tagesdateien per HTTP (raw-Endpoint) laden: fortsetzbar, idempotent, gzip, Backoff. `--dry-run` zeigt Größe + Zeitprojektion. |
| `discover_stations.py` | **Schritt 1**: Tankstellen je Ort finden (25-km-Radius über `config.local.json`-Anker), Zwillinge je Marke zusammenfassen, Polling-Set (max. 10 UUIDs = 1 Request) nach Marke/Präferenz wählen, Eignung aus der Historie prüfen (`--check-history`). Erzeugt `report.md`, `*_kandidaten.csv`, `polling.json`. Braucht nur die 10-MB-Tagesliste, keine Preisdateien. |
| `ingest_history.py` | Rohhistorie → `data/ready/<kampagne>_hist.csv(.gz)` im Schema `analysis/README.md` (Radiusfilter, long-Format, Fortschreibung, Raster, QA-Bericht). |
| `make_demo_raw.py` | Demo-Rohdaten im echten Format erzeugen (Kette testen, ohne Netzzugang/Keys). |

Alle drei laufen mit **nur Standardbibliothek** (Python ≥ 3.8) — kein `pip`, damit auf Pi/NAS/PC identisch.
`data/` ist gitignored: Rohdaten und Ready-CSVs verlassen den Rechner nie, Zugangsdaten liegen in `~/.netrc`
(chmod 600) oder `/etc/tankapp/env` — **nie** im Repo, nie in der Shell-History.

Windows: `py -3` statt `python3`, Pfade mit `\`; PowerShell-Kochrezept:
[`docs/DATEN-BEZUG.md` Kapitel 11.1](../docs/DATEN-BEZUG.md).

```bash
python3 data-tools/discover_stations.py --config analysis/config.local.json \
    --stations data/raw/stations --poll-size 10 --out docs/analysis/stations   # 0) WEN beobachten
python3 data-tools/fetch_history.py --since 2025-01-01 --dry-run       # 1) Größe & Dauer ansehen
python3 data-tools/fetch_history.py --stations-latest                   # 2) Metadaten (eine Datei)
python3 data-tools/fetch_history.py --since 2026-07-08 --until 2026-09-05   # 3) Kurz-Historie laden
python3 data-tools/ingest_history.py --config analysis/config.local.json --stations data/raw/stations \
    --radius 25 --resample 30 --density 60 --city campaign --qa data/ready/QA.md   # 4) aufbereiten
python3 analysis/station_selection.py --data data/ready/*.csv* --fuel E10 --step-min 30  # 5) selektieren
```
