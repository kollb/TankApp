# data-tools/ – Datenbezug für die TankApp

Werkzeuge, um die **Historie** (Tankerkönig-Datenrepo, eine CSV pro Tag) zu holen und in das
Analyse-Schema zu überführen — ohne das 100-GB-Repo zu clonen.
**Ausführliche Anleitung inkl. Größen-/Zeitrechnung und Fehlerbildern: [`docs/DATEN-BEZUG.md`](../docs/DATEN-BEZUG.md).**

| Skript | Zweck |
|---|---|
| `fetch_history.py` | Tagesdateien per HTTP (raw-Endpoint) laden: fortsetzbar, idempotent, gzip, Backoff. `--dry-run` zeigt Größe + Zeitprojektion. |
| `ingest_history.py` | Rohhistorie → `data/ready/<kampagne>_hist.csv(.gz)` im Schema `analysis/README.md` (Radiusfilter, long-Format, Fortschreibung, Raster, QA-Bericht). |
| `make_demo_raw.py` | Demo-Rohdaten im echten Format erzeugen (Kette testen, ohne Netzzugang/Keys). |

Alle drei laufen mit **nur Standardbibliothek** (Python ≥ 3.8) — kein `pip`, damit auf Pi/NAS/PC identisch.
`data/` ist gitignored: Rohdaten und Ready-CSVs verlassen den Rechner nie, Zugangsdaten liegen in `~/.netrc`
(chmod 600) oder `/etc/tankapp/env` — **nie** im Repo, nie in der Shell-History.

```bash
python3 data-tools/fetch_history.py --since 2025-01-01 --dry-run       # 1) Größe & Dauer ansehen
python3 data-tools/fetch_history.py --stations-latest                   # 2) Metadaten (eine Datei)
python3 data-tools/fetch_history.py --since 2026-07-08 --until 2026-09-05   # 3) Kurz-Historie laden
python3 data-tools/ingest_history.py --config analysis/config.local.json \
    --radius 25 --resample 30 --density 60 --city campaign --qa data/ready/QA.md   # 4) aufbereiten
python3 analysis/station_selection.py --data data/ready/*.csv* --fuel E10 --step-min 30  # 5) selektieren
```
