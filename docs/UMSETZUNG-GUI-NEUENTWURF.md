# UMSETZUNG-GUI-NEUENTWURF — Arbeits-Checkliste

> Stand: 14.09.2026 · App-Version **0.34.0** · Konzept:
> [UI-NEUENTWURF.md](UI-NEUENTWURF.md) (§16 Phasen, §7 Erklär-Treppe,
> §10 Zustände) · Leitplanken: [GUI-VORLAGEN.md](GUI-VORLAGEN.md) ·
> Texte: [MICROCOPY.md](MICROCOPY.md) ·
> Vorlage für diese Liste: [UMSETZUNG-FALLBACK-GUI-V2.md](UMSETZUNG-FALLBACK-GUI-V2.md).
>
> **Diese Datei ist die Arbeitsunterlage.** Sie führt die Phasen aus §16 als
> abhakbare Schritte, mit Definition of Done je Schritt. Regel aus §16:
> *Kein Bereich geht live, ohne dass Hilfe, Leer-/Fehlerzustände und sein
> Labor-Anschluss (mindestens Ebene 1) fertig sind. Lieber ein Bereich
> weniger als ein halber mehr.*
>
> **Stand der Abarbeitung:** Phase 0 ist erledigt (Doku repariert, Baseline
> gemessen, CI-Spiegel grün). Der erste Schnitt aus Phase 1 — der Bereich
> **Jetzt** in `web/src/views/Jetzt.tsx` plus der Gleichschritt in der
> Fallback-GUI — ist gebaut und getestet, aber **noch nicht abgenommen**
> (Sichtprüfung auf Desktop und Smartphone steht aus, siehe §7).

- [0. Basis, Regeln und Messwerte](#0-basis-regeln-und-messwerte)
- [1. Phase 0 — Fundament](#1-phase-0--fundament)
- [2. Phase 1 — Jetzt + Stationen](#2-phase-1--jetzt--stationen)
- [3. Phase 2 — Woche + Ich](#3-phase-2--woche--ich)
- [4. Phase 3 — Labor](#4-phase-3--labor)
- [5. Phase 4 — System](#5-phase-4--system)
- [6. Fallback-Gleichschritt (jede Phase)](#6-fallback-gleichschritt-jede-phase)
- [7. Abnahme (manuell)](#7-abnahme-manuell)
- [8. Abschluss](#8-abschluss)

## 0. Basis, Regeln und Messwerte

**Vorgehen:** Tab für Tab ersetzen, kein Feature-Schalter (§16). Der neue
Bereich liest dieselbe Server-Antwort wie der alte (heute `/api/v1/overview`),
bis der alte Bereich fällt — kein zweiter Poll, keine zweite Wahrheit.

**Definition of Done je Bereich** (gilt für jede Phase):

- [ ] Layout und Reihenfolge des Bereichs stehen wie in §5 beschrieben.
- [ ] Alle vier Ehrlichkeits-Fälle sind gebaut: **Lädt** (Skelett im
      späteren Raster), **Leer** (Grund + was als Nächstes passiert),
      **Unsicher** (grau, erster Klasse), **Fehler** (Klartext + Rohcode +
      „Erneut laden“).
- [ ] Erklär-Treppe mindestens **Ebene 1** an jeder Zahl mit Empfehlungs-
      oder Bilanzcharakter (§7); „Warum?“ immer an derselben Stelle.
- [ ] Frische-Fußzeile mit Alter in Worten (§10, dieselben Schwellen wie
      `dataAgeNote`).
- [ ] Zahlen ausschließlich über die Formatter (`web/src/data.ts`);
      Microcopy geprüft; `web/src/microcopy.test.ts` und
      `web/src/format-convention.test.ts` kennen die neuen Dateien.
- [ ] Fallback-GUI im Gleichschritt (§6).
- [ ] Tests: reine Logik in `.test.ts`, Rendering in `.test.tsx`
      (`renderToStaticMarkup`, feste Uhr), Volltext-Ratchet erweitert.
- [ ] CI-Spiegel grün: ruff check, ruff format --check, `pytest -q`,
      `npm --prefix web test`, `npm --prefix web run build`.
- [ ] `app/version.py` angehoben, `CHANGELOG.md` ergänzt.

**Messwerte (Baseline 14.09.2026, Phase 0 vor dem Schnitt „Jetzt“).** Die
Werte aus §15 sind ohne Nutzer nicht messbar; hier steht, was messbar ist —
und was ehrlich offen bleibt:

| Größe | Vor dem Schnitt | Nach dem Schnitt „Jetzt“ |
|---|---|---|
| Unit-Tests Web (`vitest`, `src/`) | 306 in 18 Dateien | **350 in 20 Dateien** |
| Python-Tests (`pytest -q`) | 754 | **756** (+1 Fallback-Test, +1 Dokument im Link-Test) |
| Bundle (index JS, gzip) | 463,05 kB / 137,59 kB | **479,65 kB / 141,99 kB** (+3,2 % gzip) |
| API-Aufrufe „Jetzt“ pro Refresh | — | 1× `/api/v1/overview` (wie „Alltag“, kein zweiter Poll) |
| Antwort-Reihenfolge | keine Zusage | per Test: Entscheidung → 3 Fakten → Schritte → Tagesstreifen → Frische |
| Zeit bis zur Entscheidung (≤ 10 s, §15) | nicht messbar | **offen** — braucht echte Nutzung |

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
- [x] **1.4** Tests: `web/src/now.test.ts` (23 Fälle: Stufen, vier Ausgänge,
  drei Fakten, Schritte, Frische, Ebene-1-Sätze) und
  `web/src/views/Jetzt.test.tsx` (9 Fälle: Reihenfolge, Zustände, Sheet).
- [x] **1.5** Verdrahtung in `Dashboard.tsx`: neuer Haupttab **„Jetzt“** als
  Einstieg; der neue Bereich liest die Overview-Antwort des Alltags
  (`overviewTab`) — **kein zweiter Poll**. Der Alltagstab bleibt vorerst
  daneben stehen (siehe 1.6).
- [ ] **1.6** **Alltag entlasten:** Entscheidungs- und Listenteil aus
  `views/Daily.tsx` entfernen, sobald „Stationen“ steht — sonst gibt es zwei
  Orte für dieselbe Empfehlung. Dabei die Übergangs-Ziele aus `handleNowNavigate`
  („Stationen“/„Woche“ → Alltagstab) auf die echten Bereiche umstellen.
- [ ] **1.7** **Annahmen live in der Karte** (Was-wäre-wenn, §5.1):
  Liter, spätester Zeitpunkt und Zeitwert direkt neben der Empfehlung ändern,
  mit Hinweis, welche Annahme den Ausschlag gibt („Kippt zu „Jetzt“, wenn …“).
  Heute steht dort ein Verweis auf die Einstellungen.
- [ ] **1.8** **Mini-Visual in Ebene 1** (§7): die Begründung bekommt das
  Tagesprofil mit markiertem Fenster; heute trägt der Tagesstreifen der
  Ansicht diese Rolle.

### 2b. Bereich „Stationen“ (§5.2) — offen

- [ ] **1.9** Preis-Atlas bauen (Karte + Liste + Verlauf + Vergleich), inkl.
  Netto-€-Rechnung und Referenzlinie; Suche/⌘K als Nebenweg vorbereiten.
- [ ] **1.10** Erst mit 1.9 entscheiden, ob `/api/v2/stations/atlas` nötig
  ist oder `stations` + `overview` reichen (§12).

## 3. Phase 2 — Woche + Ich

- [ ] **2.1** Fenster-Kalender (7 Tage) mit Tank-Abgleich.
- [ ] **2.2** Tankstand als eigener Bereich und als Fakt in „Jetzt“
  (Schnellauswahl „¼ / ½ / ¾ / voll“).
- [ ] **2.3** Ich: Fahrzeug, Belege, Bilanz (Median als Standard,
  meistgenutzte Station darunter), Einstellungen am Wirkungsort.
- [ ] **2.4** Erinnerungen/Alarme: §17.9 streicht Push ersatzlos. Vor dem
  Umbau muss definiert sein, was mit `app/alarms.py`, `app/notify.py` und
  den bestehenden Alarm-Einträgen passiert (Betriebs-Entscheidung, gehört
  in [BETRIEB.md](BETRIEB.md)).

## 4. Phase 3 — Labor

- [ ] **3.1** Alle fünf Abschnitte als Aufklapp-Seite, Tagebuch,
  Spielplatz, Glossar.
- [ ] **3.2** Erklär-Treppe Ebene 2 anschließen: Sprung klappt den passenden
  Abschnitt auf, scrollt hin und merkt sich die Herkunft („Zurück zu: …“).
  Dann wandert `labHint` in `now.ts` von „In der Werkstatt vertiefen“ auf
  den Labor-Abschnitt.
- [ ] **3.3** Alte Werkstatt ersetzen (kein Nebeneinander).

## 5. Phase 4 — System

- [ ] **4.1** Technik-Bereich in die neuen Bausteine überführen (Inhalt
  bleibt vollständig: Anlage, Daten, Läufe, Störungen).
- [ ] **4.2** API v1 stilllegen, PWA-Ausbau, UX-KPIs aus §15 auswerten.

## 6. Fallback-Gleichschritt (jede Phase)

Die Pi-Fallback-GUI ([RP2.md](RP2.md)) ist eine **zweite Oberfläche
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
- [ ] **F4** Mit jedem weiteren Bereich prüfen: Was davon ist auf dem Pi
  ehrlich darstellbar? Was bleibt NAS-only? (Liste je Phase in §6 der
  jeweiligen Bereichs-Notiz ergänzen.)

## 7. Abnahme (manuell)

- [ ] **7.1** Sichtprüfung „Jetzt“ auf Desktop (1920 px) und Smartphone
  (390 px): Reihenfolge ohne Scrollen erkennbar, Faktenreihe bricht sauber
  um, Tagesstreifen ohne horizontales Scrollen, Sheet bedienbar (Escape,
  Backdrop, Fokus), Dark/Light.
- [ ] **7.2** Zustände am echten Stand durchspielen: S0 (keine Stationen),
  S1 (Preise ohne Modell), Stufe A (kalibriert), Fehler
  (`influx_read_failed`), Offline (Banner + Cache-Stand).
- [ ] **7.3** Fallback auf dem Pi: neues Template aktiv, `index.html.old`
  vorhanden, NAS online → transparente Weiterleitung unverändert
  (`X-TankApp-Proxy: nas`).
- [ ] **7.4** Vorleser-Stichprobe: Entscheidung, Fakten, Schritte und
  „Warum?“ in sinnvoller Reihenfolge; Sheet meldet `role="dialog"`.

## 8. Abschluss

- [ ] **8.1** Nach der Abnahme: Phase 1b („Stationen“) beginnen; erst danach
  fällt der Alltagstab (1.6).
- [ ] **8.2** Dieses Dokument bleibt lebend, bis Phase 4 steht — erst dann
  nach `docs/archiv/` mit Banner (Stand, Nachfolger) und Eintrag in
  [archiv/README.md](archiv/README.md).
