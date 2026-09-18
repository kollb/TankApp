# Testabdeckung (Python) — PR-Kommentar ohne Gate

> Stand: 18.09.2026 · App-Version **0.51.0** · Zuständig: `.github/workflows/coverage.yml`

Bei jedem Pull-Request rechnet die CI die Python-Testabdeckung (`app/`,
`engine/`, `tankapp.py`) mit `pytest-cov` und postet einen Kommentar in den
PR: Prozentwert, fehlende Zeilen je Datei (nur Dateien, die der PR anfasst)
und der Testlauf. Der Kommentar ist **bewusst kein Gate**: Er informiert,
blockiert aber nie. Die einzige harte Ampel bleibt
[`tests.yml`](../.github/workflows/tests.yml) (Ruff + pytest + Browser-Suite).

## Inhaltsverzeichnis

- [Warum nicht blockierend](#warum-nicht-blockierend)
- [Was der Kommentar zeigt](#was-der-kommentar-zeigt)
- [Warum ein eigener Workflow](#warum-ein-eigener-workflow)
- [Was nicht gemessen wird](#was-nicht-gemessen-wird)
- [Lokal ausführen](#lokal-ausführen)
- [Offen](#offen)

---

## Warum nicht blockierend

Coverage als Pflicht-Gate bestraft drei richtige Dinge: einen Test-Rückbau, der
die Menge nutzloser Mocks verkleinert; einen bewussten Schnitt nach unten, weil
der Test gerade eine Lücke offenlegt; und ein kleines PR, das einer Datei ohne
Abdeckung eine ungetestete Zeile hinzufügt. Ein Prozentwert ist eine Kennzahl,
keine Qualitätsaussage — er soll den Autoren und Reviewern auffallen, aber keine
Freigabe aufhalten, die `tests.yml` sonst grün lässt.

Deshalb gilt: **kein Schwellwert, kein roter Haken.** `continue-on-error` macht
den Job weich (Fehlstarts erscheinen unter „Checks“ als ausgegrauter Haken,
der PR bleibt freigebbar), und der Kommentar entsteht nur in einem sauberen,
grünen Testlauf. Dadurch kann Coverage später einen Schwellwert bekommen
(„nach unten schauen, wenn er fällt“), ohne dass er heute schon etwas blockiert.

## Was der Kommentar zeigt

| Baustein | Quelle | Inhalt |
|---|---|---|
| Prozentzeile | `coverage.xml` (`pytest-cov`) | Gesamt-Coverage über `app/`, `engine/`, `tankapp.py` |
| Datei-Tabelle | `coverage.xml` | Nur Dateien, die der **PR** anfasst (`report-only-changed-files`) — die volle Tabelle ginge monorepo-weit in die Hunderte |
| Testlauf-Statistik | `pytest.xml` | Gesamt / grün / rot / übersprungen |

Der Kommentar wird bei jedem Push desselben PR aktualisiert (ein Kommentar, kein
Wasserfall). PRs aus Forks bekommen keinen Kommentar: Der Standard-Token eines
`pull_request`-Laufs ist dort schreibgeschützt, und der
„Co-Autoren-Erlauben“-Token wird in Fork-PRs nicht gesetzt — der Job läuft dann
bewusst gar nicht erst an.

## Warum ein eigener Workflow

1. **Geringenste Rechte.** Der Kommentar braucht `pull-requests: write`. Diese
   Berechtigung soll nur der Coverage-Workflow tragen — `tests.yml` behält
   `contents: read` (siehe [BETRIEB.md](BETRIEB.md)).
2. **Der CI-Spiegel bleibt schlank.** Der in [AGENTS.md](../AGENTS.md)
   festgeschriebene Spiegel (`python -m pytest -q`) braucht kein
   `pytest-cov` — wer lokal pusht, läuft weiter Sekunden statt Minuten.
3. **Kein doppeltes Gates.** `tests.yml` bleibt die Ampel; Coverage hat ein
   eigenes Feld und kann nicht versehentlich als zweites Gate mitlaufen.

Der Preis dafür: Unter `pull_request` fahren die Python-Tests einmal zusätzlich
(in `tests.yml` und hier). Das ist gewollt — die gemeinsame Kopie würde die
Schreibrechte vermischen (siehe Punkt 1).

## Was nicht gemessen wird

- **Das GUI nicht.** Vitest/Playwright laufen ohne Coverage-Configuration; die
  Abdeckung des React-Codes (`web/src/`) ist eine eigene, noch offene Messung.
- **Nicht die Hilfsskripte.** `data-tools/`, `rp2/` und `analysis/` sind
  bewusst außen vor: Sie werden teils per `importlib` ausgeladen (Coverage zählt
  dann die Test-Module statt der Skripte) und decken Randpfade (Pi, NAS) ab.
  Die Quellen lassen sich nachziehen, sobald jemand die Zahlen dieser Pfade
  braucht ([Offen](#offen)).

## Lokal ausführen

```bash
python -m pip install -r requirements-dev.txt pytest-cov
python -m pytest --cov=app --cov=engine --cov=tankapp \
  --cov-report=term-missing | tail -40
```

`pytest-cov` ist bewusst **nicht** in `requirements-dev.txt` aufgenommen, weil
der Spiegel aus [AGENTS.md](../AGENTS.md) ohne es bleiben soll; der Workflow
installiert es selbst.

## Offen

| # | Was fehlt | Grund |
|---|---|---|
| 1 | GUI-Abdeckung (`web/src/` über `v8`/Vitest-Reporter) | eigene Messung, eigener Workflow — nicht Teil dieses PR-Kommentars |
| 2 | Coverage-Quellen `data-tools/`, `rp2/`, `analysis/` | siehe oben; `importlib`-Ausladen verfälscht die Zahlen, bis jemand die Pfade nachmisst |
| 3 | Schwellwert mit Verlauf („nicht unter X fallen“) | bewusste Entscheidung: erst beobachten, dann ggf. nachziehen — ohne Blockade |
