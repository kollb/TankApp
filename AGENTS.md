# Arbeitsregeln für TankApp

## Prüfungen vor dem Commit/Push

Vor jedem Commit den kompletten CI-Spiegel aus `.github/workflows/tests.yml` lokal ausführen und erst pushen, wenn alles grün ist. Rote CI-Läufe durch pushen „testen“ zu lassen ist ein Fehler im Arbeitsablauf:

```
python -m ruff check app tankapp.py data-tools/polling_plan.py data-tools/collect_prices.py engine data-tools/export_influx.py data-tools/upload_influx.py tests
python -m ruff format --check app tankapp.py data-tools/polling_plan.py engine data-tools/export_influx.py tests
python -m pytest -q
npm --prefix web test && npm --prefix web run build
npm --prefix web run test:e2e
npm --prefix web run test:e2e:demo   # braucht python -m pip install -r requirements-dev.txt
```

**Die Browser-Suite gehört dazu.** `web`-Job der CI führt `npm --prefix web
run test:e2e` aus (Playwright, Desktop 1440 px + Mobil 390 px); wer sie lokal
auslässt, pusht rote Läufe. Einmalig `npx --prefix web playwright install
chromium`, dann startet die Suite ihren Server (`tankapp.py serve`) selbst.
Sie prüft die GUI im echten Browser — genau dort fallen Navigations- und
Absturzfehler auf, die Unit-Tests nicht sehen (z. B. eine leere Seite wegen
eines fehlenden Feldes in einer Server-Antwort). Danach läuft in der CI der
Schritt „E2E ohne Mocks gegen den Demo-Stack“ (`npm --prefix web run
test:e2e:demo`): dieselbe Oberfläche gegen echte Server-Antworten. Diese Suite
gehört vor dem Push ebenfalls gefahren — ohne Chromium bleibt sie der CI
vorbehalten, der Server-Teil liegt als `tests/test_e2e_demo.py` bei.

`ruff format --check` läuft in CI **vor** pytest; eine reine Formatabweichung (z. B. zu lange Signatur) fällt daher schon nach Sekunden durch, bevor Tests überhaupt starten. Gefundene Abweichungen mit `ruff format <datei>` fixen, nicht per Hand umbrechen.

## Änderungen abschließen

- Nach abgeschlossenen Änderungen die relevanten Prüfungen durchführen.
- Die Änderungen **committen und anschließend den aktuellen Arbeitsbranch pushen**. Nicht bei lokalen, ungepushten Änderungen stehen bleiben.
- Im Abschluss den Commit und den tatsächlichen Push-Status nennen. Wenn ein Push fehlschlägt, den Fehler klar melden statt Erfolg zu behaupten; nicht mit einem Force-Push umgehen.

## Dokumentation: ein Ort, ein Index

- Fachliche Dokumente liegen in thematischen `docs/`-Unterordnern;
  `docs/README.md` ist der einzige Gesamtindex. Im Root bleiben `README.md`,
  `CONTRIBUTING.md`, `AGENTS.md` und technisch erforderliche Dateien.
- Ein Dokument = eine Aufgabe, Dateinamen in ASCII-Großbuchstaben (ADRs mit
  Nummernpräfix). Stand-Zeile und klickbares Inhaltsverzeichnis oben.
- Aktuelle Dokumente enthalten nur gültige Regeln; Aufgaben, Release-Historie
  und historische Belege sind getrennt. Entscheidungen als kurze ADRs.
- `docs/planung/TODO.md` enthält nur notwendige, jetzt ausführbare Schritte
  mit konkreter Handlung und Abnahme. Keine Review-Wunschliste, bloßen
  Wartezustände, Erledigt-Einträge oder unbestätigten Szenario-Fristen.
  Abhängige Ausbaupläne bleiben in der Fachplanung, Freigabegrenzen in LUECKEN.
- Stichtags-Prüfungen und abgeschlossene Migrationen nach `docs/archiv/`, mit
  Banner (Stand, Nachfolger) und Indexeintrag. Offene Aufgaben vorher in
  `docs/planung/TODO.md`, gültige Regeln ins zuständige Dokument übernehmen.
- Umbenennungen: alle Links, Anker, Python-Docstrings, CLI-Hilfen,
  Fehlermeldungen, `web/`, `.github/` und `ops/` nachziehen.
  `tests/test_operations.py::test_local_documentation_links_exist` muss grün sein.
- App-Release: `app/version.py` und `docs/releases/CHANGELOG.md` gemeinsam
  pflegen. Redaktionelle Änderungen sind kein App-Release.
- Kein „fertig“ ohne Abnahme; offene Grenzen in `docs/planung/LUECKEN.md`.
- Pflegekonvention und Struktur: [Dokumentationspflege](docs/entwicklung/DOKUMENTATION.md).

## Texte in der App

Jede Zeile, die ein Nutzer sieht (GUI, Fallback-GUI, Fehlertexte), folgt
[docs/produkt/MICROCOPY.md](docs/produkt/MICROCOPY.md): Tonfall „ehrlich, knapp,
handlungsleitend“, `„…“` als Anführungszeichen, Zahlen und Einheiten
ausschließlich über die Formatter in `web/src/data.ts` (€/L für Niveaus,
ct/L für Differenzen, Uhrzeiten Europe/Berlin). Neue Muster gehören in das
Regelwerk, nicht nur in das Panel.

## GUI-Basis bewahren

`sample/good gui` und `sample/good statistic gui` sind ausdrücklich die gestalterische und technische Basis der neuen Homepage. Nicht beim Aufräumen von Demo-Daten löschen. Die Übernahmeregeln stehen in `docs/produkt/GUI-VORLAGEN.md`.
