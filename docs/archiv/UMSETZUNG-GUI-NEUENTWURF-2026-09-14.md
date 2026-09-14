# UMSETZUNG-GUI-NEUENTWURF — Arbeits-Checkliste

> **Archiviert am 14.09.2026 · App-Version 0.37.1.** Diese Arbeits-Checkliste ist abgeschlossen. Nachfolger für neue Befunde: [LUECKEN.md](../LUECKEN.md) und konkrete Prüfberichte in [docs/archiv/](README.md).
>
> Stand: 14.09.2026 · App-Version **0.37.1** · Konzept:
> [UI-NEUENTWURF.md](../UI-NEUENTWURF.md) (§16 Phasen, §7 Erklär-Treppe,
> §10 Zustände) · Leitplanken: [GUI-VORLAGEN.md](../GUI-VORLAGEN.md) ·
> Texte: [MICROCOPY.md](../MICROCOPY.md) ·
> Vorlage für diese Liste: [UMSETZUNG-FALLBACK-GUI-V2.md](../UMSETZUNG-FALLBACK-GUI-V2.md).
>
> **Diese Datei ist die Arbeitsunterlage.** Sie führt die Phasen aus §16 als
> abhakbare Schritte, mit Definition of Done je Schritt. Regel aus §16:
> *Kein Bereich geht live, ohne dass Hilfe, Leer-/Fehlerzustände und sein
> Labor-Anschluss (mindestens Ebene 1) fertig sind. Lieber ein Bereich
> weniger als ein halber mehr.*
>
> **Stand der Abarbeitung:** Phase 0 ist erledigt (Doku repariert, Baseline
> gemessen, CI-Spiegel grün). Phase 1 (**Jetzt** + **Stationen**), Phase 2
> (**Woche** + **Ich**), Phase 3 (**Labor**) und Phase 4 (**System**) sind
> gebaut: die Bereiche `Jetzt.tsx`/`Stationen.tsx`/`Woche.tsx`/`Ich.tsx`/
> `Labor.tsx`/`System.tsx` stehen, die alten Tabs „Alltag“, „Einstellungen“
> und „Werkstatt“ sind ersetzt (kein Nebeneinander, §16). `/api/v1` bleibt
> die einzige API; UX-KPIs aus §15 sind ohne Realnutzung unmessbar; der
> Service-Worker existiert, B10 bleibt offen.
> **Reihenfolge abweichend:** Phase 3 und 4 wurden auf Nutzerwunsch
> (14.09.2026) vor der manuellen Abnahme gebaut. Die Abnahme am echten Stand
> (S0/S1/Stufe A/Fehler/Offline, §7.2), der Pi-Fallback (7.3), die
> Vorleser-Stichprobe (7.4) sowie Labor-/System-Flächen (7.5) sind laut
> Rückmeldung vom 14.09.2026 durchgeführt; der Nachbefund
> Fallback-Ortsfilter FRA/GT ist in 0.37.1 behoben.

- [0. Basis, Regeln und Messwerte](#0-basis-regeln-und-messwerte)
- [1. Phase 0 — Fundament](#1-phase-0--fundament)
- [2. Phase 1 — Jetzt + Stationen](#2-phase-1--jetzt--stationen)
- [3. Phase 2 — Woche + Ich](#3-phase-2--woche--ich--gebaut)
- [4. Phase 3 — Labor](#4-phase-3--labor)
- [5. Phase 4 — System](#5-phase-4--system)
- [6. Fallback-Gleichschritt (jede Phase)](#6-fallback-gleichschritt-jede-phase)
- [7. Abnahme (manuell)](#7-abnahme-manuell)
- [8. Abschluss](#8-abschluss)

## 0. Basis, Regeln und Messwerte

**Vorgehen:** Tab für Tab ersetzen, kein Feature-Schalter (§16). Der neue
Bereich liest dieselbe Server-Antwort wie der alte (heute `/api/v1/overview`),
bis der alte Bereich fällt — kein zweiter Poll, keine zweite Wahrheit.

**Definition of Done je Bereich** (gilt für jede Phase) — für die neuen
Bereiche der Phasen 1–4 erfüllt:

- [x] Layout und Reihenfolge des Bereichs stehen wie in §5 beschrieben.
- [x] Alle vier Ehrlichkeits-Fälle sind gebaut: **Lädt** (Skelett im
      späteren Raster), **Leer** (Grund + was als Nächstes passiert),
      **Unsicher** (grau, erster Klasse), **Fehler** (Klartext + Rohcode +
      „Erneut laden“).
- [x] Erklär-Treppe mindestens **Ebene 1** an jeder Zahl mit Empfehlungs-
      oder Bilanzcharakter (§7); „Warum?“ immer an derselben Stelle.
- [x] Frische-Fußzeile mit Alter in Worten (§10, dieselben Schwellen wie
      `dataAgeNote`).
- [x] Zahlen ausschließlich über die Formatter (`web/src/data.ts`);
      Microcopy geprüft; `web/src/microcopy.test.ts` und
      `web/src/format-convention.test.ts` kennen die neuen Dateien.
- [x] Fallback-GUI im Gleichschritt (§6) — die neuen Bereiche sind
      NAS-only (Pi-Einordnung in F4), die Pi-Antwort-Karte erzählt weiter
      die drei Fakten von „Jetzt“.
- [x] Tests: reine Logik in `.test.ts`, Rendering in `.test.tsx`
      (`renderToStaticMarkup`, feste Uhr), Volltext-Ratchet erweitert.
- [x] CI-Spiegel grün: ruff check, ruff format --check, `pytest -q`,
      `npm --prefix web test`, `npm --prefix web run build`.
- [x] `app/version.py` angehoben, `CHANGELOG.md` ergänzt.

**Messwerte (Baseline 14.09.2026, Phase 0 vor dem Schnitt „Jetzt“).** Die
Werte aus §15 sind ohne Nutzer nicht messbar; hier steht, was messbar ist —
und was ehrlich offen bleibt:

| Größe | Vor dem Schnitt | Nach dem Schnitt „Jetzt“ | Nach Phase 1+2 (Stationen · Woche · Ich) | Nach Phase 3 (Labor) | Nach Phase 4 (System) |
|---|---|---|---|---|---|
| Unit-Tests Web (`vitest`, `src/`) | 306 in 18 Dateien | **352 in 20 Dateien** | **462 in 26 Dateien** | **492 in 28 Dateien** | **544 in 30 Dateien** |
| Python-Tests (`pytest -q`) | 754 | **756** (+1 Fallback-Test, +1 Dokument im Link-Test) | **756** (unverändert) | **758** (+2 Tagebuch-Tests in `tests/test_b4.py`) | **758** (unverändert) |
| Bundle (index JS, gzip) | 463,05 kB / 137,59 kB | **479,65 kB / 141,99 kB** (+3,2 % gzip) | **493,80 kB / 146,58 kB** (+3,2 % gzip ggü. „Jetzt“) | **507,83 kB / 152,19 kB** (+3,8 % gzip ggü. Phase 2) | **530,16 kB / 157,40 kB** (+3,4 % gzip ggü. Phase 3) |
| Testfälle der neuen Bereiche | — | `now.test.ts` 25 + `views/Jetzt.test.tsx` 9 | Logik: `strip.test.ts` 7 + `stations.test.ts` 30 + `week.test.ts` 19 · Rendering: `views/Stationen.test.tsx` 7 + `views/Woche.test.tsx` 7 + `views/Ich.test.tsx` 9 (inkl. `mostUsedStation`) | Logik: `lab.test.ts` 16 (Abschnitte, Sprung, Tagebuch-Sprache) · Rendering: `views/Labor.test.tsx` 7 (fünf Abschnitte, Spielplatz, Tagebuch-Grund, Sprung mit Herkunft) | Logik: `system.test.ts` 33 (Bausteine, Töne, Diagnose-JSON) · Rendering: `views/System.test.tsx` 10 (Reihenfolge ①–⑤, Lädt/Leer/Fehler) · plus Gleichstand 06–12, Zellpreise, `boundsCenteredOn` |
| API-Aufrufe pro Refresh | — | „Jetzt“: 1× `/api/v1/overview` (wie „Alltag“, kein zweiter Poll) | „Jetzt“/„Woche“/„Ich“: je 1× `/api/v1/overview`; „Stationen“: Overview + 1× `/api/v1/series` (nur für die gewählte Station, 7 Tage) | „Labor“: Overview + `stats/summary` + `series`/`forecast`/`heatmap`/`selection` **statt** der Werkstatt-Aufrufe (dieselben Endpunkte wie vorher) + neu `advice/diary?limit=50` | „System“: `/health` + `collector/status` + `selection` + `stats/summary` + `jobs/{job}/log` — dieselben Endpunkte wie der alte System-Tab, kein zweiter Poll, kein v2 |
| Antwort-Reihenfolge | keine Zusage | per Test: Entscheidung → 3 Fakten → Schritte → Tagesstreifen → Frische | „Stationen“: Karte → Liste → Detail → Vergleich → Frische-Fußzeile (feste Reihenfolge in `Stationen.tsx`) | „Labor“: Kopf (Herkunft) → Vertrauens-Konto → Sprungleiste → 1 Prognose → 2 Sicherheit → 3 Stationen → 4 Lernen → 5 Glossar → Spielplatz (feste Reihenfolge aus `lab.ts` `LAB_SECTIONS`) | „System“: Zustand → Daten → Läufe → Störungen → Diagnose → Frische-Fußzeile (feste Reihenfolge in `System.tsx`) |
| Browser-Suite (`test:e2e`) | 16 Tests, **rot** (Startansicht, Absturz) | **16/16 grün** (Desktop 1440 px + Mobil 390 px) | **16/16 grün** — 8 Tests × 2 Viewports, Specs auf die neue Tab-Struktur umgestellt | **16/16 grün** — Specs auf „Labor“ umgeschrieben; im Sandbox ohne Browser-Download nicht lauffähig, der CI-Lauf belegt sie (und fand die fehlende Heading-Rolle der Abschnitts-Fragen) | **unverändert** — kein neuer Spec; im Sandbox ohne Playwright-Browser, der CI-Lauf belegt sie |
| Zeit bis zur Entscheidung (≤ 10 s, §15) | nicht messbar | **offen** — braucht echte Nutzung | **offen** — braucht echte Nutzung | **offen** — braucht echte Nutzung | **offen** — braucht echte Nutzung |

## 1. Phase 0 — Fundament

- [x] **0.1** `docs/UI-NEUENTWURF.md` reparieren: §12 hatte zwei verschmolzene
  API-Zeilen (`ops/runs/{job}/start` + `ops/diagnostics`), §18 hatte am Ende
  ~15 Fragment-Wiederholungen. Beides wiederhergestellt.
- [x] **0.2** Diese Checkliste angelegt und in `docs/README.md` eingetragen.
- [x] **0.3** Baseline gemessen (Tabelle in §0) und CI-Spiegel hergestellt:
  ruff, pytest, vitest, Build laufen lokal grün (`.venv`, `web/node_modules`).
- [x] **0.4** API-Richtung für den Schnitt entschieden: **kein** neuer
  `/api/v2`-Baum in diesem Schritt. Der neue Bereich liest
  `/api/v1/overview` (ETag/304, eine Antwort für eine Ansicht). Die
  `/api/v2`-Fassade aus §12 bleibt Konzept und wird in Phase 1 geprüft,
  bevor „Stationen“ eigene Aggregate braucht.
- [x] **0.5** Baustein-Basis gelegt: geteilte Karten (`components/ui.tsx`),
  Fehler-/Ladezustände (`LoadError`, `SkeletonPanel`) und der neue
  **`components/Level1Sheet.tsx`** (Erklär-Treppe Ebene 1: höchstens drei
  Sätze, Herkunft, ein Weg in die Tiefe).

## 2. Phase 1 — Jetzt + Stationen

### 2a. Bereich „Jetzt“ (§5.1) — erster Schnitt, gebaut

- [x] **1.1** Reine Logik in **`web/src/now.ts`**: vier Ausgänge der
  Ampel-Karte 2.0 (`refuel_now`, `wait`, `refuel_elsewhere`, `no_advice`),
  genau drei Fakten in fester Reihenfolge, höchstens drei nächste Schritte,
  Frische-Fußzeile, Ebene-1-Begründung. Ehrlichkeits-Regeln dort erzwungen:
  Prozent nur auf Stufe A, „Bisher“ nie als „Erwartet“, fehlende Zahl = „—“
  mit Grund.
- [x] **1.2** Ansicht **`web/src/views/Jetzt.tsx`** mit der festen
  Reihenfolge ① Entscheidung ② Drei Fakten ③ Nächste Schritte ④ Heute im
  Blick + Frische-Fußzeile. Zustände: S0 „Einrichten in drei Schritten“,
  S1/S2 grau mit Zählstand („Das Modell lernt noch“), Laden, Fehler.
- [x] **1.3** „Warum?“ öffnet das Begründungs-Sheet (Ebene 1) — immer an
  derselben Stelle, Escape/Backdrop schließen, Klick auf den Hintergrund
  schließt, Fokus auf dem Schließen-Knopf.
- [x] **1.4** Tests: `web/src/now.test.ts` (25 Fälle: Stufen, vier Ausgänge,
  drei Fakten, Schritte, Frische, Ebene-1-Sätze, kein Widerspruch zwischen
  Wort und Prozent) und
  `web/src/views/Jetzt.test.tsx` (9 Fälle: Reihenfolge, Zustände, Sheet).
- [x] **1.5** Verdrahtung in `Dashboard.tsx`: neuer Haupttab **„Jetzt“** als
  Einstieg; der neue Bereich liest die Overview-Antwort des Alltags
  (`overviewTab`) — **kein zweiter Poll**. Der Alltagstab bleibt vorerst
  daneben stehen (siehe 1.6).
- [x] **1.6** **Alltag entlasten:** Entscheidungs- und Listenteil aus
  `views/Daily.tsx` entfernen, sobald „Stationen“ steht — sonst gibt es zwei
  Orte für dieselbe Empfehlung. Dabei die Übergangs-Ziele aus `handleNowNavigate`
  („Stationen“/„Woche“ → Alltagstab) auf die echten Bereiche umstellen.
  *Erledigt mit dem Phase-2-Schnitt: `Daily.tsx` ist entfernt, „Alltag“ und
  „Einstellungen“ stehen nicht mehr in der Navigation; `handleNowNavigate`
  zielt auf die echten Bereiche („Stationen“ → `stations`, „Woche“/Tank →
  `week`, „Ich“ → `ich`, „Werkstatt“ → `statistics`).*
- [x] **1.7** **Annahmen live in der Karte** (Was-wäre-wenn, §5.1):
  Liter, spätester Zeitpunkt und Zeitwert direkt neben der Empfehlung ändern,
  mit Hinweis, welche Annahme den Ausschlag gibt („Kippt zu „Jetzt“, wenn …“).
  *Erledigt: das Annahmen-Panel unter der Entscheidung (`Jetzt.tsx`) ändert
  Liter/spätesten Zeitpunkt/Zeitwert ohne Tabwechsel; `assumptionHint()` in
  `now.ts` benennt die ausschlaggebende Annahme („Kippt zu „Jetzt“, wenn …“),
  aktive Annahmen werden als Chips sichtbar.*
- [x] **1.8** **Mini-Visual in Ebene 1** (§7): die Begründung bekommt das
  Tagesprofil mit markiertem Fenster; heute trägt der Tagesstreifen der
  Ansicht diese Rolle. *Erledigt wie konzipiert: der Tagesstreifen der
  Ansicht (06–24, markierte aktuelle Stunde) trägt die Mini-Visual-Rolle;
  das Begründungs-Sheet verlinkt auf dieselben Zahlen.*

### 2b. Bereich „Stationen“ (§5.2) — gebaut

- [x] **1.9** Preis-Atlas bauen (Karte + Liste + Verlauf + Vergleich), inkl.
  Netto-€-Rechnung und Referenzlinie; Suche/⌘K als Nebenweg vorbereiten.
  *Erledigt: `views/Stationen.tsx` + reine Logik in `stations.ts`/`strip.ts`
  (Karte mit Netto-€-Pins → sortierte Liste mit Referenz → Detail mit
  7-Tage-Verlauf und Tagesrhythmus → A-gegen-B-Vergleich, ⌘K in die Suche).
  Ehrlichkeits-Grenzen stehen als Tests in `stations.test.ts`: Server-Netto
  nur gegen die aktuelle Referenz, ohne Route steht „ohne Umweg“, Rangliste
  nur unter frischen Preisen. Bewusster Schnitt: die 24-h-Sparkline je Zeile
  bleibt offen (pro Station eigener Series-Poll) — sie steht erst bei der
  v2-Atlas-Antwort aus 1.10.*
- [x] **1.10** Erst mit 1.9 entscheiden, ob `/api/v2/stations/atlas` nötig
  ist oder `stations` + `overview` reichen (§12). *Entscheidung: für den
  gebauten Atlas reichen `stations` + `overview` — Karte, Liste, Referenz,
  Netto-€ (via `alternatives_nearby`), Frische und Vergleich brauchen keinen
  neuen Endpunkt. `GET /api/v2/stations/atlas` wird erst nötig, wenn die
  24-h-Verläufe je Zeile kommen (siehe 1.9); bis dahin bleibt der §12-Baum
  Konzept.*

## 3. Phase 2 — Woche + Ich — gebaut

- [x] **2.1** Fenster-Kalender (7 Tage) mit Tank-Abgleich.
  *Erledigt: `views/Woche.tsx` + Logik in `week.ts` — 7-Tage-Raster aus
  `decide.windows_week` (lowest `expected_price` je Tag), Sterne nur aus
  Server-p, Tage 5–7 „noch unsicher“, Auswahl-Detail mit erwartetem Preis,
  Abstand zu jetzt, Sicherheit in Worten und Tank-Abgleich
  (`tankReach`: Server-`blocks_wait` nur für heute, kommende Tage ehrlich
  Reichweite statt „reicht bis Do“). Tage ohne Fenster bleiben leer.*
- [x] **2.2** Tankstand als eigener Bereich und als Fakt in „Jetzt“
  (Schnellauswahl „¼ / ½ / ¾ / voll“). *Erledigt: Tank-Zeile im Wochen-Kopf
  (eigener Bereich, Pflege mit Schnellauswahl + Slider) und Tank als
  Fakt Nr. 3 in „Jetzt“ mit der Schnellauswahl „¼ / ½ / ¾ / voll“
  (`onTankQuick`). Der Server bleibt die einzige Physik-Quelle
  (`tank` in der Decide-Antwort).*
- [x] **2.3** Ich: Fahrzeug, Belege, Bilanz (Median als Standard,
  meistgenutzte Station darunter), Einstellungen am Wirkungsort.
  *Erledigt: `views/Ich.tsx` mit vier Unterseiten als ARIA-Tabs —
  **Fahrzeug** (alle Default-Fields an einem Ort: Tankmenge, Verbrauch,
  Zeitwert, Tempo, Fahrtcharakter, Tankgröße), **Belege** (Schnellerfassung
  + Verlauf mit Storno, Einordnung gegen den Median des Sets — den
  Standard-Maßstab; die meistgenutzte Station steht als zweiter Maßstab
  darunter, erst ab zwei Belegen an derselben Station), **Bilanz**
  (Monat/Jahr aus `fills/summary`) und **Einstellungen** (Stadt/Kraftstoff
  am Wirkungsort, read-only-Schwellen, Dark/Light, Über). Der alte
  Einstellungen-Tab ist damit ersetzt.*
- [x] **2.4** Erinnerungen/Alarme: §17.9 streicht Push ersatzlos. Vor dem
  Umbau muss definiert sein, was mit `app/alarms.py`, `app/notify.py` und
  den bestehenden Alarm-Einträgen passiert (Betriebs-Entscheidung, gehört
  in [BETRIEB.md](../BETRIEB.md)). *Erledigt: die Betriebs-Entscheidung steht
  in [BETRIEB.md → „System-Alarme und GUI-Neuentwurf“](../BETRIEB.md#system-alarme-und-gui-neuentwurf-seit-0350) —
  §11 streicht **Preis-Erinnerungen/Push** (es wird dafür keine Komponente
  gebaut); der **System-Alarmweg** (`app/alarms.py`, `app/notify.py`/ntfy B4,
  bestehende Codes) bleibt unverändert aktiv. Störungen erscheinen in der
  neuen GUI nur als Anzeige (Header-Punkt + System-Tab), kein Push, kein Ton.*

## 4. Phase 3 — Labor

- [x] **3.1** Alle fünf Abschnitte als Aufklapp-Seite, Tagebuch,
  Spielplatz, Glossar. **(14.09.2026)** `web/src/views/Labor.tsx` mit
  `web/src/lab.ts` als Adressraum (`LAB_SECTIONS` = 1 Prognose, 2 Sicherheit,
  3 Stationen, 4 Lernen, 5 Glossar, Spielplatz ohne Nummer); Tagebuch aus
  echten Settlements (`GET /api/v1/advice/diary`, `app/data.py` `diary()`),
  Spielplatz mit Orakel, ε-Scan, „Eine Station sezieren“ und Rohpreisen
  24/72/168 h inkl. CSV/SVG-Export. Belegt durch `views/Labor.test.tsx`
  (7 Tests) und `lab.test.ts` (16 Tests).
- [x] **3.2** Erklär-Treppe Ebene 2 anschließen: Sprung klappt den passenden
  Abschnitt auf, scrollt hin und merkt sich die Herkunft („Zurück zu: …“).
  Dann wandert `labHint` in `now.ts` von „In der Werkstatt vertiefen“ auf
  den Labor-Abschnitt. **(14.09.2026)** `labHint(section)` liefert Text und
  Ziel, `Dashboard.tsx` `openLabor(section, label, from)` setzt Fokus und
  Herkunft, `Labor.tsx` öffnet den Abschnitt, scrollt ihn in die Sicht und
  zeigt „Zurück zu: <Anlass>“ samt Zurück-Knopf; `LabOrigin`
  (`lab.ts`) trägt den Anlass, `views/Jetzt.tsx` nennt „Jetzt · Warum?“,
  `views/Stationen.tsx` „Stationen · <Name>“, `views/Woche.tsx` „Woche · Fenster“.
- [x] **3.3** Alte Werkstatt ersetzen (kein Nebeneinander). **(14.09.2026)**
  `web/src/views/Statistics.tsx` (1.367 Zeilen) gelöscht; der Tab heißt
  „Labor“ (violett, `FlaskConical`), gelesen werden dieselben Server-Antworten
  wie vorher (`stats/summary`, `series`, `forecast`, `heatmap`, `selection`).
  Die Monats-/Jahresbilanz bleibt in „Ich“ (dort seit Phase 2), die
  System-Teile bleiben in „System“.

## 5. Phase 4 — System

- [x] **4.1** Technik-Bereich in die neuen Bausteine überführen (Inhalt
  bleibt vollständig: Anlage, Daten, Läufe, Störungen). **(14.09.2026)**
  `web/src/views/System.tsx` + `web/src/system.ts`: ① Zustand (vier
  Bausteine Collector/Datenbank/Modelle/App) ② Daten ③ Läufe & Protokolle
  ④ Störungen ⑤ Diagnose + Frische-Fußzeile. Diagnose-Export als JSON
  (Version, Zustand, Coverage, letzte Log-Zeilen, ohne Tokens). „Warum?“
  öffnet Ebene 1 und springt ins Labor (`onDeepen` → `openLabor`). Belegt
  durch `system.test.ts` und `views/System.test.tsx`.
- [x] **4.2** API v1 stilllegen, PWA-Ausbau, UX-KPIs aus §15 auswerten.
  *Ehrlich (14.09.2026):* `/api/v1` bleibt die einzige API (kein v2-Baum;
  Phasen 1–3 lesen overview/stations/series weiter so). UX-KPIs aus §15
  sind ohne Realnutzung unmessbar. Der Service-Worker existiert (`/sw.js`);
  B10 (Versionierung, Update-Banner, Offline-Queue) bleibt offen — die
  Diagnose-Karte sagt das, statt es zu behaupten.

## 6. Fallback-Gleichschritt (jede Phase)

Die Pi-Fallback-GUI ([RP2.md](../RP2.md)) ist eine **zweite Oberfläche
desselben Produkts**. Sie darf schlanker sein (Standardbibliothek, kein
Tankstand, keine Belege, kein M7), aber sie darf nicht anderes erzählen.

- [x] **F1** Antwort-Karte trägt dieselben **drei Fakten** wie „Jetzt“ in
  derselben Reihenfolge: „Jetzt hier“ · „Bestes Fenster heute“ ·
  „Frische Preise“. Der Tankstand fehlt bewusst — er ist NAS-Sache; dafür
  nennt der dritte Fakt die Zahl frischer Preise im Set.
- [x] **F2** **Frische-Fußzeile** unter der Antwort-Karte: „Preise … alt ·
  Prognose … alt“ (Preismeldung + Modell-Lauf), Farbe erst ab den Schwellen.
- [x] **F3** Template-Version 3.1 → **4.0**, damit bestehende Installationen
  das neue Template beim Start übernehmen (altes wird als `index.html.old`
  gesichert); Test `tests/test_rp2_fallback.py` prüft Fakten, Reihenfolge und
  Fußzeile.
- [x] **F4** Mit jedem weiteren Bereich prüfen: Was davon ist auf dem Pi
  ehrlich darstellbar? Was bleibt NAS-only? (Liste je Phase in §6 der
  jeweiligen Bereichs-Notiz ergänzen.)
  *Liste Phase 1+2: „Jetzt“ ist der Pi-Bereich (F1–F3, drei Fakten,
  Tankstand bewusst NAS-only). Die neuen Bereiche bleiben **NAS-only** —
  auf dem Pi ehrlich darstellbar ist von ihnen nichts: „Stationen“ braucht
  Karte/Atlas/Vergleich und Polling-Daten, „Woche“ die Modell-Fenster aus
  der Engine, „Ich“ Profile/Belege/Bilanz (alle NAS-Daten). Die Fallback-
  Antwort-Karte erzählt weiter die drei Fakten von „Jetzt“; das Template
  bleibt bei Version 4.0 (nichts Neues hinzugefügt, nichts geändert).
  Preis-Erinnerungen/Push gibt es auf keiner der drei Oberflächen (§11,
  Betriebs-Entscheidung in [BETRIEB.md](../BETRIEB.md#system-alarme-und-gui-neuentwurf-seit-0350)).*
  *Liste Phase 4: „System“ bleibt NAS-only — Collector-Status, Job-Start,
  Diagnose-Export und ntfy leben auf dem NAS. Der Pi zeigt weiter die drei
  Fakten von „Jetzt“; das Template bleibt bei Version 4.0.*

## 7. Abnahme (manuell)

- [x] **7.1** Sichtprüfung „Jetzt“ auf Desktop (1440 px) und Smartphone
  (390 px) — **durchgeführt** mit Demo-Daten (Chromium headless): feste
  Reihenfolge erkennbar, Faktenreihe bricht um, kein horizontales Scrollen auf
  beiden Breiten, Frische-Fußzeile steht unter dem Tagesstreifen. Die
  Sichtprüfung deckte zwei Fehler auf, beide behoben (Absturz auf der leeren
  Anlage, falsch datierte Prognose in der Fußzeile). Pi-Gerät und Dark/Light
  sind durch die spätere echte Abnahme nach §7.3–7.5 abgedeckt.
- [x] **7.2** Zustände am echten Stand durchspielen: S0 (keine Stationen),
  S1 (Preise ohne Modell), Stufe A (kalibriert), Fehler
  (`influx_read_failed`), Offline (Banner + Cache-Stand). **Abgenommen
  am echten NAS/Pi laut Rückmeldung vom 14.09.2026.**
- [x] **7.3** Fallback auf dem Pi: neues Template aktiv, `index.html.old`
  vorhanden, NAS online → transparente Weiterleitung unverändert
  (`X-TankApp-Proxy: nas`). **Abgenommen; Nachbefund Ortsfilter FRA/GT
  in 0.37.1 behoben.**
- [x] **7.4** Vorleser-Stichprobe: Entscheidung, Fakten, Schritte und
  „Warum?“ in sinnvoller Reihenfolge; Sheet meldet `role="dialog"`.
  **Abgenommen laut Rückmeldung vom 14.09.2026.**
- [x] **7.5** Sichtprüfung „Labor“ (neu seit Phase 3, Desktop 1440 px und
  Mobil 390 px): fünf Abschnitte auf- und zuklappen, Sprung aus „Jetzt ·
  Warum?“ (öffnet den Abschnitt, scrollt, „Zurück zu: …“), Spielplatz-Rohpreise
  24 h/3 Tage/7 Tage, Tagebuch im leeren Zustand (Grund statt Leere),
  Glossar-Suche. Ebenso die Korrekturen aus der Nutzung: „Referenz“-Pin und
  Haus-Symbol auf der Karte, „Verlauf“-Knopf je Atlas-Zeile, „A gegen B“ mit
  Vorauswahl, graue Preisvergleich-Karte in „Jetzt“, „Heute im Blick“.
  **Seit 0.37.0 auch „System“:** vier Bausteine, Diagnose-Export, Zellpreise
  im Tagesstreifen, Gleichstand als Spanne, Referenz geometrisch in der
  Kartenmitte. **Abgenommen laut Rückmeldung vom 14.09.2026.**

## 8. Abschluss

- [x] **8.1** Phase 4 steht mit 0.37.0; die echte Abnahme 7.2–7.5 ist laut
  Rückmeldung vom 14.09.2026 durchgeführt. Ein Nachbefund aus der Abnahme
  (Fallback-Ortsfilter FRA/GT) ist in 0.37.1 behoben und im Sanity-Bericht
  [GUI-FALLBACK-SANITY-2026-09-14.md](GUI-FALLBACK-SANITY-2026-09-14.md)
  dokumentiert.
- [x] **8.2** Dieses Dokument ist abgeschlossen und liegt im Archiv. Gültige
  Betriebs-Aussagen bleiben in [../BETRIEB.md](../BETRIEB.md), Zielbild in
  [../UI-NEUENTWURF.md](../UI-NEUENTWURF.md), offene/neu gefundene Punkte in
  [../LUECKEN.md](../LUECKEN.md).
