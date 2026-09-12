# Arbeitsregeln für TankApp

## Prüfungen vor dem Commit/Push

Vor jedem Commit den kompletten CI-Spiegel aus `.github/workflows/tests.yml` lokal ausführen und erst pushen, wenn alles grün ist. Rote CI-Läufe durch pushen „testen“ zu lassen ist ein Fehler im Arbeitsablauf:

```
python -m ruff check app tankapp.py data-tools/polling_plan.py data-tools/collect_prices.py engine data-tools/export_influx.py data-tools/upload_influx.py tests
python -m ruff format --check app tankapp.py data-tools/polling_plan.py engine data-tools/export_influx.py tests
python -m pytest -q
npm --prefix web test && npm --prefix web run build
```

`ruff format --check` läuft in CI **vor** pytest; eine reine Formatabweichung (z. B. zu lange Signatur) fällt daher schon nach Sekunden durch, bevor Tests überhaupt starten. Gefundene Abweichungen mit `ruff format <datei>` fixen, nicht per Hand umbrechen.

## Änderungen abschließen

- Nach abgeschlossenen Änderungen die relevanten Prüfungen durchführen.
- Die Änderungen **committen und anschließend den aktuellen Arbeitsbranch pushen**. Nicht bei lokalen, ungepushten Änderungen stehen bleiben.
- Im Abschluss den Commit und den tatsächlichen Push-Status nennen. Wenn ein Push fehlschlägt, den Fehler klar melden statt Erfolg zu behaupten; nicht mit einem Force-Push umgehen.

## Dokumentation: ein Ort, ein Index

- Alle Dokumente liegen in `docs/`; `docs/README.md` ist der Index. Keine READMEs
  neben Code-Ordnern und keine Anleitungen in der Repo-Wurzel (dort bleiben nur
  `README.md`, `CHANGELOG.md`, `TODO.md`, `AGENTS.md`).
- Ein Dokument = eine Aufgabe, Name in ASCII-Großbuchstaben. Stand-Zeile
  (Datum + App-Version) und klickbares Inhaltsverzeichnis oben.
- Stichtags-Prüfungen, abgeschlossene Migrationen und Punktstände gehen nach
  `docs/archiv/<THEMA>-<JJJJ-MM-TT>.md`, mit Banner (Stand, Nachfolger) und
  Eintrag in `docs/archiv/README.md`. Noch gültige Betriebs-Aussagen vorher in
  das zuständige lebende Dokument übernehmen (meist `docs/BETRIEB.md`).
- Dokumente umbenennen oder verschieben heißt: **alle** Verweise nachziehen —
  Markdown, Python-Docstrings, CLI-Hilfen und Fehlermeldungen, `web/`,
  `.github/`, `ops/`. `tests/test_operations.py::test_local_documentation_links_exist`
  prüft jeden lokalen Link und Anker; er muss grün bleiben.
- Neue Version = `app/version.py` anheben und `CHANGELOG.md` ergänzen
  (erscheint in `/api/v1/health` und im GUI-Footer).
- Ehrlichkeits-Regel gilt auch für Doku: kein „fertig“ ohne Abnahme, offene
  Punkte mit Grund (`docs/LUECKEN.md`) statt Lücke.

## GUI-Basis bewahren

`sample/good gui` und `sample/good statistic gui` sind ausdrücklich die gestalterische und technische Basis der neuen Homepage. Nicht beim Aufräumen von Demo-Daten löschen. Die Übernahmeregeln stehen in `docs/GUI-VORLAGEN.md`.
