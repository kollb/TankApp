# MICROCOPY — Regelwerk für alle Texte in der App

> Stand: 12.09.2026 · App-Version **0.16.0** · gilt für `web/src/**`,
> `rp2/fallback_gui.py`, Fehlertexte in `app/**` und für jede neue Zeile Text,
> die ein Nutzer zu sehen bekommt.

Eine Seite, damit Texte nicht je Panel neu erfunden werden. Wer eine
Formulierung sucht, findet hier Tonfall, Einheiten, Zahlen, Zitate und die
Standardsätze für Leer-, Lade- und Fehlerzustände.

- [1. Tonfall](#1-tonfall)
- [2. Anführungszeichen und Sonderzeichen](#2-anführungszeichen-und-sonderzeichen)
- [3. Zahlen, Einheiten, Zeiten](#3-zahlen-einheiten-zeiten)
- [4. Benennungen](#4-benennungen)
- [5. Zustände: leer, lädt, Fehler](#5-zustände-leer-lädt-fehler)
- [6. Was nie im Text steht](#6-was-nie-im-text-steht)
- [7. Prüfung](#7-prüfung)

## 1. Tonfall

**Ehrlich, knapp, handlungsleitend** — in dieser Reihenfolge.

| Regel | Ja | Nein |
|---|---|---|
| Handlung zuerst, Begründung danach | „Jetzt tanken — 4 ct unter Tagesmedian.“ | „Der Tagesmedian liegt über dem aktuellen Preis, daher …“ |
| Keine Sicherheit behaupten, die nicht gemessen ist | „Noch nicht kalibriert — bis dahin zählen nur aktuelle Preise.“ | „82 % sicher“ vor der Abnahme (Konzept §0.4) |
| Kein Tadel an den Nutzer | „Tankmenge außerhalb 5–100 Liter.“ | „Ungültige Eingabe!“ |
| Deutsch als Primärlabel, Fachwort im Tooltip | „Wahrscheinlichkeit für günstig“, `title="Cheap-Probability P(p ≤ Median)"` | „Cheap-Probability“ als sichtbares Label |
| Kein Ausrufezeichen, kein Emoji im Fließtext | „Collector meldet seit 2 Stunden nichts.“ | „Achtung!! ⚠️“ |
| Zustände benennen, nicht bewerten | „Noch kein Lauf“ | „Leider noch nichts da“ |
| Sie/Du wird vermieden — die App spricht über die Sache, nicht über den Nutzer | „Beleg gespeichert.“ | „Du hast deinen Beleg gespeichert.“ |

Anrede in **Hinweistexten der Doku** darf „Sie“ verwenden; in der GUI bleibt es
bei sachlichen Aussagesätzen.

## 2. Anführungszeichen und Sonderzeichen

| Zeichen | Verwendung | Beispiel |
|---|---|---|
| `„…“` | **jedes** Zitat, jeder zitierte Label- oder Job-Name in Fließtext | Job „Modell-Update“ starten |
| `'…'` | nie in Nutzertext (nur JS-Stringliterale im Code) | — |
| `"…"` | nie in Nutzertext (nur JSX-Attributsyntax) | — |
| `—` (Geviertstrich, mit Leerzeichen) | Einschub, Gegenüberstellung | „Warten — 3 ct Ersparnis erwartet“ |
| `–` (Halbgeviertstrich) | Bereiche ohne Wortpaar | „18–20 Uhr“, „5–100 Liter“ |
| `…` (ein Zeichen) | Auslassung, Ladezustand | „Läuft …“ |
| `·` | Trenner zwischen gleichrangigen Angaben | „12.345 Preise · 18 Stationen“ |
| `≤ ≥ ≈ ±` | mit geschütztem Sinn, immer mit Leerzeichen | „≤ 5 Sekunden“ |

Typografische Zeichen stehen direkt im Quelltext (UTF-8), **keine**
HTML-Entities (`&bdquo;`, `&quot;`) — die lesen sich im Diff nicht.

## 3. Zahlen, Einheiten, Zeiten

Formatiert wird **ausschließlich** über die Funktionen in `web/src/data.ts`;
`toFixed` in Anzeigen ist verboten und wird von
`web/src/format-convention.test.ts` als Ratchet gemeldet.

| Größe | Funktion | Darstellung |
|---|---|---|
| Preis je Liter | `euroPerLiter` | `1,749 €/L` (3 Nachkommastellen) |
| Preis**differenz** je Liter | `centPerLiter` | `4,2 ct/L` (1 Nachkommastelle) |
| Geldbetrag gesamt | `euro` | `62,45` (2 Nachkommastellen) + „€“ im Label |
| Prozent | `percentLabel` | `93 %` (Leerzeichen vor „%“) |
| Stückzahl | `countLabel` | `12.345` |
| Stundenbereich | `hourRangeLabel` | `18–20 Uhr` |
| Zeitpunkt | `timeLabel` / `epochLabel` | `12.09., 08:00` |

**Regel ct/L vs. €/L (C9):** *Niveaus* stehen in €/L, *Unterschiede* in ct/L.
Ein Panel mischt beides nur, wenn es Niveau **und** Differenz zeigt — dann
steht das Niveau zuerst. Beispiel: „1,749 €/L · 4,2 ct/L unter Tagesmedian“.

**Zeitzone:** Jede angezeigte Uhrzeit ist Europe/Berlin, auch wenn die API
UTC liefert. Die Formatter setzen `timeZone: "Europe/Berlin"` — eigene
`Date`-Ausgaben ohne Formatter sind ein Fehler.

Dezimaltrennzeichen ist immer das Komma (`de-DE`), Tausendertrennzeichen der
Punkt. Eingabefelder akzeptieren beides (`commaToDot`), zeigen aber Komma.

## 4. Benennungen

| Gemeint | Wort in der App |
|---|---|
| die drei Tabs | **Alltag**, **Werkstatt**, **System** (nicht „Statistik“, nicht „Prüfstand“) |
| eine Tankstelle | **Station** |
| ein gebuchter Tankvorgang | **Beleg** (nicht „Fill“, nicht „Buchung“) |
| Prognoselauf auf dem NAS | **Modell-Update** |
| Preisdaten-Abholung auf dem Pi | **Collector** |
| Zeitfenster mit günstigem Preis | **Fenster** |
| Ampel-Aussage | **Empfehlung** (nicht „Signal“) |

Fachbegriffe (δ̂, MASE, PICP, Brier, ε, Regret) bleiben der Werkstatt
vorbehalten und stehen dort im `title`/Tooltip hinter einem deutschen Label
(F2, 0.15.0). Der Alltag kommt ohne sie aus.

## 5. Zustände: leer, lädt, Fehler

| Zustand | Muster | Beispiel |
|---|---|---|
| lädt | „<Sache> wird geladen …“ / „… wird berechnet …“ | „Prognose wird berechnet …“ |
| leer, weil noch nichts da | „Noch kein/e <Sache>.“ + was fehlt | „Noch kein Modell-Lauf — Job „Modell-Update“ starten.“ |
| leer, weil bewusst nichts | Grund nennen, nicht entschuldigen | „Fehlende Tage, kein Datenverlust.“ |
| Fehler | `components/LoadError.tsx` mit `problem(error_code)`, Rohcode darunter, Knopf „Erneut laden“ | — |
| keine Zahl bestimmbar | `—` (Geviertstrich), nie `0`, nie leer | — |

Ein Panel erfindet keinen eigenen Fehlertext: Klartexte stehen zentral in
`messages` in `web/src/data.ts`, je `error_code` genau einer.

## 6. Was nie im Text steht

- **Erfundene Zahlen.** Keine Demo-Preise, keine Platzhalter-Prozentwerte,
  keine „ca.“-Werte ohne Rechnung dahinter (Ehrlichkeits-Regel, Konzept §0.4).
- **Pfade, Tokens, URLs, Koordinaten.** Auch nicht in Alarm-Pushes: die
  ntfy-Nachricht trägt nur Alarm-Code, deutschen Klartext und App-Version.
- **Interne Ausnahmen.** Serverfehler werden über `app/errors.py` bereinigt,
  bevor sie irgendwo erscheinen.
- **Englische Hook-Zeilen** als Marketing. Eine deutsche Kurzzeile pro Tab
  reicht („Nachvollziehen statt blind vertrauen.“).

## 7. Prüfung

- `npm --prefix web test` — enthält `format-convention.test.ts` (Ratchet gegen
  neue `toFixed`-Anzeigen) und `microcopy.test.ts` (paarige `„…“`, keine
  HTML-Entities für Anführungszeichen in Nutzertexten).
- `python -m pytest -q tests/test_operations.py` — prüft unter anderem, dass
  jeder lokale Doku-Link (also auch die Verweise auf diese Seite) existiert.

Neue Formulierung unklar? Kürzeste Variante wählen, die noch erklärt, **was
zu tun ist** — und sie hier eintragen, wenn sie ein Muster ist.
