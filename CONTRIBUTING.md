# Mitwirken an TankApp

> Stand: 20.09.2026 · App-Version 0.59.1

## Inhaltsverzeichnis

- [Umgebung](#umgebung)
- [Prüfungen](#prüfungen)
- [Dokumentation](#dokumentation)

## Umgebung

Die CI prüft Python 3.11 und 3.12; das NAS-Bild verwendet Python 3.12.
Für das Frontend gilt Node 22. Vom Repository-Root aus:

```bash
python -m pip install -r requirements-dev.txt
npm --prefix web ci
npx --prefix web playwright install chromium
```

Bei systemverwaltetem Python eine lokale virtuelle Umgebung verwenden.
Private Konfiguration und erzeugte Daten nicht einchecken.

## Prüfungen

Vor Commit und Push den lokalen CI-Spiegel ausführen:

```bash
python -m ruff check app tankapp.py data-tools/polling_plan.py data-tools/collect_prices.py engine data-tools/export_influx.py data-tools/upload_influx.py tests
python -m ruff format --check app tankapp.py data-tools/polling_plan.py engine data-tools/export_influx.py tests
python -m pytest -q
npm --prefix web test
npm --prefix web run build
npm --prefix web run test:e2e
npm --prefix web run test:e2e:demo
```

Die Browser-Suiten starten ihre Server selbst. Die Demo-Suite benötigt auch
die Python-Abhängigkeiten und prüft echte Serverantworten ohne API-Mocks.
Details und Messbudgets: [Qualität](docs/entwicklung/QUALITAET.md).
Arbeitsregeln für Agenten: [AGENTS.md](AGENTS.md).

Bei Dokumentationsänderungen zusätzlich gezielt prüfen:

```bash
python -m pytest -q tests/test_operations.py
```

Das umfasst lokale Markdown-Links und Anker. Umbenennungen müssen außerdem
Verweise in CLI-Hilfen, Fehlermeldungen, Kommentaren und Betriebsdateien
nachziehen.

## Dokumentation

- Einstieg und Zuständigkeiten: [docs/README.md](docs/README.md).
- Struktur, Archivierungsregeln und Pflege:
  [Dokumentationspflege](docs/entwicklung/DOKUMENTATION.md).
- Nutzertexte: [Microcopy](docs/produkt/MICROCOPY.md).
- App-Releases: `app/version.py` und
  [Changelog](docs/releases/CHANGELOG.md) gemeinsam pflegen.
- Reine redaktionelle Änderungen sind kein App-Release. Eine neue
  Stand-Zeile darf keine nicht durchgeführte technische Abnahme behaupten.
