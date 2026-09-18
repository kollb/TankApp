# TankApp Dokumentation

**Ein Ordner, ein Einstieg.** Alle Dokumente liegen direkt in `docs/`, benannt
nach ihrer Aufgabe. Veraltete Dokumente und Stichtags-Prüfberichte liegen in
[`docs/archiv/`](archiv/README.md) — nichts wird stillschweigend gelöscht.

> Stand: 18.09.2026 · App-Version **0.54.0**
> Was sich zuletzt geändert hat: [CHANGELOG](../CHANGELOG.md) ·
> was als Nächstes ansteht: [TODO](../TODO.md)

## Ich will … → Dokument

| Ich will … | Dokument |
|---|---|
| TankApp auf Pi + NAS einrichten (erster Start) | [INSTALL.md](INSTALL.md) |
| wissen, was im Dauerbetrieb zu tun ist (systemd, Backup, Alarme, Fehlersuche) | [BETRIEB.md](BETRIEB.md) |
| einen 24/7-Zugang über den RP2 (Fallback-GUI + NAS-Proxy) | [RP2.md](RP2.md) |
| das Fallback-GUI-v2-Konzept umsetzen (Arbeits-Checkliste) | [UMSETZUNG-FALLBACK-GUI-V2.md](UMSETZUNG-FALLBACK-GUI-V2.md) |
| die 12-Uhr-Bodenkante für Panels und Kalibrierung umsetzen (B30, Arbeits-Checkliste) | [UMSETZUNG-B30-12-UHR-BODENKANTE.md](UMSETZUNG-B30-12-UHR-BODENKANTE.md) |
| die GUI neu entwerfen (6 Bereiche, Erklär-Treppe, Labor) | [UI-NEUENTWURF.md](UI-NEUENTWURF.md) |
| wissen, warum sich die GUI trotz grüner TODO-Listen noch schwer anfühlt (UX-Befund U1–U8, in 0.41.0 umgesetzt) | [archiv/GUI-UX-BEFUND.md](archiv/GUI-UX-BEFUND.md) |
| wissen, wo Nutzertexte gegen das eigene Regelwerk laufen (Text-Befund T1–T13) | [TEXT-BEFUND.md](TEXT-BEFUND.md) |
| wissen, wo 0.43.2 noch Optimierungspotenzial hat (Rechnung, Anzeige, Betrieb, Alltag, Backup, Wirkung — Befund O1–O42; Batch 1 = O1 + O22 ist in 0.44.0 umgesetzt) | [OPTIMIERUNGS-BEFUND.md](OPTIMIERUNGS-BEFUND.md) |
| den abgeschlossenen GUI-Neuentwurf nachvollziehen (Phasen-Checkliste) | [UMSETZUNG-GUI-NEUENTWURF-2026-09-14.md](archiv/UMSETZUNG-GUI-NEUENTWURF-2026-09-14.md) |
| eine tote oder sortenlose Station im Polling-Set tauschen | [STATIONEN-TAUSCH.md](STATIONEN-TAUSCH.md) |
| verstehen, wie Pi ↔ NAS ↔ Browser zusammenspielen | [ARCHITEKTUR.md](ARCHITEKTUR.md) |
| einen API-Endpunkt nachschlagen | [API.md](API.md) |
| wissen, wie Selektion, Modelle und Heatmaps rechnen | [ANALYSE.md](ANALYSE.md) |
| das fachliche Zielbild lesen (drei Fragen, Decision Layer, Ehrlichkeits-Regel) | [KONZEPT.md](KONZEPT.md) |
| sehen, was vom Konzept umgesetzt ist und was bewusst offen bleibt | [LUECKEN.md](LUECKEN.md) |
| Modelle selbst fitten und prüfen (Werkstatt-Lauf am PC) | [ENGINE.md](ENGINE.md) |
| die Einzelprogramme in `data-tools/` verstehen | [DATENWERKZEUGE.md](DATENWERKZEUGE.md) |
| die GUI-Vorlagen in `sample/` als Design-Basis nutzen | [GUI-VORLAGEN.md](GUI-VORLAGEN.md) |
| eine Zeile Nutzertext schreiben (Tonfall, Einheiten, Zitate, Fehlertexte) | [MICROCOPY.md](MICROCOPY.md) |
| Lighthouse/Last messen und die Budgets nachziehen | [QUALITAET.md](QUALITAET.md) |
| eine frühere Prüfung oder ein altes Konzept nachlesen | [archiv/README.md](archiv/README.md) |

### Nicht gegen die aktuelle Version geprüft

Die Stand-Zeile oben in jedem Dokument nennt Datum und App-Version, **gegen die
der Inhalt zuletzt durchgesehen wurde**. Diese Dokumente stehen bewusst auf
älteren Ständen: Ihr Inhalt ist dadurch nicht falsch geworden, aber er ist auch
nicht gegen 0.54.0 geprüft — wer sie anfasst, zieht die Stand-Zeile mit.
0.54.0 schließt Batch 8 des Optimierungs-Befunds ab und damit den ganzen
Befund: Die Belegmaske zeigt den Live-Preis der Station mit Alter und markiert
eine Abweichung ab 1,0 ct/L (O32), und die Textalternative eines Diagramms
nennt seine Werte statt seiner Reihennamen, bei eigenem `aria-label` je
Diagramm (O40). O28 und O41 desselben Batches lagen seit PR #154 auf `main`,
ohne Versionswechsel — mit diesem Release sind Ledger und Befund wieder
deckungsgleich. Mitgezogen sind [MICROCOPY.md](MICROCOPY.md) (§4g: die neuen
Muster für Belegmaske und Diagramm-Beschreibung) und
[OPTIMIERUNGS-BEFUND.md](OPTIMIERUNGS-BEFUND.md) (Abnahme-Vermerk je Check).
0.53.0 setzt zwei Nutzerurteile vom 18.09.2026 um: Der Mini-Verlauf in der
Stationszeile ist entfallen („niemand kann was mit dem Graphen anfangen“ — die
Linie hatte weder Achse noch Zeitbezug; der Verlauf bleibt als Knopf je Zeile
im Stations-Detail), und der Einstieg „Jetzt“ ist auf dem Handy verdichtet
(„Zu lang auf mobil“): Die drei Fakten stehen mobil in der 3er-Reihe des
Entwurfs, „Heute im Blick“ zeigt seine drei Kennzahlen als Zeilenliste statt
als Karten, und die Stationszeilen tragen mobil zwei Zeilen (vorher
„Demo-T…“). Gemessen im Sandkasten: 2 530 px → 2 118 px bei 390 × 844 gegen
1 223 px des Mockups. Neue Zusage im Browser statt nur im Unit-Test
(`web/e2e/mobile.spec.ts`). Dazu die Abgrenzung „`reportAllChanges`/`startTime`
ist Chrome DevTools, nicht TankApp“ in
[BETRIEB.md](BETRIEB.md#reportallchangesstarttime-in-der-browser-konsole).
0.52.0 setzt Batch 7 des Optimierungs-Befunds um (Betrieb, Rest): API-Antworten
komprimieren mit gzip-Stufe 1 und revalidieren über `If-None-Match` auf sechs
weiteren Endpunkten (O25), der Decide-Poll nimmt die Feedback-Store-Sperre nicht
mehr (O26), der Server misst sich selbst (`X-Process-Time`,
`performance`/`publication.parse_ms` in `/health`, O37), der InfluxDB-Cron
rotiert und das Roharchiv ist als bewusst ungesichert benannt (O34), und Bild
wie Pipeline bauen gegen dieselbe Python-/Node-Linie — die Suite läuft jetzt
**im Bild** (O27). Messwerte und Budgets:
[QUALITAET.md](QUALITAET.md#selbstmessung-des-servers-seit-0520).
0.51.0 setzt Schritt 3 des 12-Uhr-Befunds um (B30): Heatmap, Selektion, Modell-Fit und beide Offline-Werkzeuge zählen nur Beobachtungen ab `price_law_local`, Payload und GUI nennen Kante und ausgeblendete Punkte, der Modell-Lauf misst den Vor-Gesetz-Anteil (`law_quality`). Konzept und Abnahme-Protokoll: [UMSETZUNG-B30-12-UHR-BODENKANTE.md](UMSETZUNG-B30-12-UHR-BODENKANTE.md); dabei ist der Befund §4 nachgerechnet — alle Muster-Fenster beginnen heute hinter dem Gesetz, die Kante ist Garantie statt Reparatur.
0.50.0 setzt Batch 6 des Optimierungs-Befunds um (Anzeige und Alltag): Score
und Selektion rechnen mit der Tankmenge aus dem Profil (O21), die Ersparnis
nennt ihre Referenz (O19), der Tagesstreifen färbt nicht mehr rückwirkend um
(O20), die Bilanz weist netto nach Umweg aus (O30), die Labor-Werkstätten
zeigen echte Daten statt eines Dauertextes (O18), die Woche bekommt einen
Rückblick über den ntfy-Kanal (O31), und persönliche Daten sind über
`TANKAPP_READ_TOKEN` schützbar (O39).
0.50.1 führt den 12-Uhr-Strang mit main zusammen (Kalendertag-Schnitt + feste Farbskala in einem Streifen) und legt den Befund zum Gesetz als Report ab ([BEFUND-12-UHR-REGEL.md](BEFUND-12-UHR-REGEL.md)): Live-Daten regeltreu (alle Erhöhungen am Mittagspunkt), Panels aus dem Mischbestand beschrieben die Welt vor dem 01.04.2026; Schritt 3 (Anzeige-Bodenkante und Nach-Gesetz-Kalibrierung) ist als B30 ausgelagert.
0.49.5 hält den 12-Uhr-Regel-Check auch an Tagen ohne gültigen Preis aufrecht (Statuszeilen werden zentral gefiltert, Lücken gezählt statt geraten — [DATENWERKZEUGE.md#12-uhr-regel-check](DATENWERKZEUGE.md#12-uhr-regel-check) erklärt die Datenquelle für den Vorher/Nachher-Kontrast); 0.49.4 macht auf der nackten NAS lauffähig (eigenständig, nur numpy/pandas, NAS-Ablauf in [DATENWERKZEUGE.md](DATENWERKZEUGE.md#12-uhr-regel-check) dokumentiert); 0.49.3 schneidet den Tagesstreifen („Heute im Blick“) auf den Berliner
Kalendertag — die Zellen 18–24 Uhr zeigten am Nachmittag Meldungen von
gestern Abend als „heute“ — und bringt mit `analysis/noon_rule_check.py`
den 12-Uhr-Regel-Check für den echten Bestand (Doku in
[DATENWERKZEUGE.md](DATENWERKZEUGE.md#12-uhr-regel-check)); 0.49.2 macht die
Stations-Achse im Labor bei vielen Stationen lesbar (gekippt, gekürzt,
voller Name per Tooltip).
0.49.1 behebt zwei Abstürze aus dem Produktionsbetrieb vom 17.09.2026 (O44):
`None` in den Draws ließ `decide` an einem `TypeError` scheitern (sichtbar war
nur `decide_failed`), und zwei Stellen lasen Felder ungeprüft
(`alternatives_nearby.find`, `cities.includes`) — die zweite traf den
Pi-Fallback, dessen Stations-Antwort kein `cities` trug. 0.49.0 behebt davor
zwei weitere Produktionsbefunde: die Selektion snappt Beobachtungs-Zeitstempel
wie der Trainingspfad aufs Raster (Coverage zählte sonst nur exakte
Raster-Treffer), und die Prognose-Veröffentlichung ist aufgeteilt (eine Datei
je Station, Index mit Zeigern, O22 Maßnahme d).
Mitgezogen sind [API.md](API.md), [BETRIEB.md](BETRIEB.md),
[LUECKEN.md](LUECKEN.md), [../TODO.md](../TODO.md) und
[../CHANGELOG.md](../CHANGELOG.md).

| Dokument | Stand | Warum nicht mitgezogen |
|---|---|---|
| [API.md](API.md) | 0.52.0 | 0.53.0 ist reine GUI-Arbeit: kein Endpunkt, kein Payload, kein Fehlercode angefasst — die Endpunkt-Beschreibung bleibt gültig, geprüft ist sie gegen 0.52.0 |
| [BEFUND-12-UHR-REGEL.md](BEFUND-12-UHR-REGEL.md) | 0.51.0 | Abgeschlossener Prüfbericht zum 12-Uhr-Gesetz; Batch 7 und 0.53.0 ändern weder Panel noch Kalibrierung |
| [DATENWERKZEUGE.md](DATENWERKZEUGE.md) | 0.51.0 | Offline-Werkzeuge und Datenquellen; Batch 7 ist ein Server-/CI-Batch und 0.53.0 reine GUI-Arbeit — keins von beiden fasst ein Werkzeug an |
| [RP2.md](RP2.md) | 0.49.1 | Batch 6 ändert nichts am Pi-Fallback: Score, Streifen, Bilanz, Labor und Rückblick laufen auf dem NAS. Der Fallback liefert weiterhin die Stations-Form aus 0.49.1 |
| [BETRIEB.md](BETRIEB.md) | 0.53.0 | 0.54.0 ist reine GUI-Arbeit: kein Dienst, kein Cron, kein Alarm, kein Backup-Pfad angefasst — Abläufe und Störungsfälle bleiben gültig, geprüft sind sie gegen 0.53.0 |
| [QUALITAET.md](QUALITAET.md) | 0.53.0 | Budgets, Lasttest und Lighthouse-Schwellen sind von 0.54.0 unberührt. Der dort beschriebene `@sparticuz/chromium`-Weg ist für dieses Release erneut gelaufen (38/38 bzw. 25 grün / 11 skipped) und stimmt unverändert; durchgesehen ist das Dokument im Ganzen gegen 0.53.0 |
| [ENGINE.md](ENGINE.md) | 0.11.0 | Werkstatt-Referenz für `engine/` — seither mehrfach umgebaut (Prozess-Pool, Backtest-Cache, DST-Kanten, Zweitmodell/Ensemble) |
| [KONZEPT.md](KONZEPT.md) | 0.11.0 | Zielbild; der Abgleich mit dem Code steht in [LUECKEN.md](LUECKEN.md) |
| [ANALYSE.md](ANALYSE.md) | 0.38.0 | 0.39.0 war ein Text-Release (T1–T13), 0.40.0 ändert Ledger-Grund und Tagebuch-Anzeige, 0.41.0/0.41.1 ist das GUI-Release (U1–U8), 0.42.0/0.43.0 sind Text-Releases (T1–T8, V1–V5) — Rechnungen, Endpunkte und Betrieb dieser Dokumente bleiben unberührt |
| [ARCHITEKTUR.md](ARCHITEKTUR.md) | 0.38.0 | 0.39.0 war ein Text-Release (T1–T13), 0.40.0 ändert Ledger-Grund und Tagebuch-Anzeige, 0.41.0/0.41.1 ist das GUI-Release (U1–U8), 0.42.0/0.43.0 sind Text-Releases (T1–T8, V1–V5) — Rechnungen, Endpunkte und Betrieb dieser Dokumente bleiben unberührt |
| [INSTALL.md](INSTALL.md) | 0.38.0 | 0.39.0 war ein Text-Release (T1–T13), 0.40.0 ändert Ledger-Grund und Tagebuch-Anzeige, 0.41.0/0.41.1 ist das GUI-Release (U1–U8), 0.42.0/0.43.0 sind Text-Releases (T1–T8, V1–V5) — Rechnungen, Endpunkte und Betrieb dieser Dokumente bleiben unberührt |
| [STATIONEN-TAUSCH.md](STATIONEN-TAUSCH.md) | 0.38.0 | 0.39.0 war ein Text-Release (T1–T13), 0.40.0 ändert Ledger-Grund und Tagebuch-Anzeige, 0.41.0/0.41.1 ist das GUI-Release (U1–U8), 0.42.0/0.43.0 sind Text-Releases (T1–T8, V1–V5) — Rechnungen, Endpunkte und Betrieb dieser Dokumente bleiben unberührt |
| [TEXT-BEFUND.md](TEXT-BEFUND.md) | 0.38.0 | Arbeitsdokument: Lektorat zum Stand 0.38.0 — T1–T13 sind in 0.39.0 umgesetzt, der Befund bleibt als Protokoll eingefroren |
| [OPTIMIERUNGS-BEFUND.md](OPTIMIERUNGS-BEFUND.md) | 0.43.2 | Arbeitsdokument: Sichtung gegen 0.43.2, Zeilenangaben und Messwerte bleiben eingefroren; die Batches 1–7 tragen ihre Umsetzungs-Vermerke 0.44.0–0.52.0 und O22 (d) den von 0.49.0 ([§10](OPTIMIERUNGS-BEFUND.md#10-batches-priorität-und-check)), der Betriebsbefund O44 den von 0.49.1 ([§7](OPTIMIERUNGS-BEFUND.md#o44--zwei-abstürze-aus-dem-produktionsbetrieb-fremde-antwortformen-brechen-die-seite)) |
| [UMSETZUNG-FALLBACK-GUI-V2.md](UMSETZUNG-FALLBACK-GUI-V2.md) | 0.33.0 | Umsetzungsprotokoll, historisch |
| [UI-NEUENTWURF.md](UI-NEUENTWURF.md) | — | Entwurf, bewusst unabhängig vom Bestand |
| [GUI-VORLAGEN.md](GUI-VORLAGEN.md) · [SPEICHER.md](SPEICHER.md) | — | Betriebs- und Übernahmeregeln, keine Versionsaussagen |

`tests/test_ledger_drift.py` prüft, dass jedes Dokument eine Stand-Zeile im
Kopf hat, dass keine **neuere** Version behauptet wird als die App und dass
diese Liste vollständig bleibt — beide Richtungen: kein alter Stand ohne
Eintrag, kein Eintrag ohne Grund.

## Lesereihenfolge

1. **[INSTALL.md](INSTALL.md)** — der einzige verbindliche Ablauf: Gütersloh
   mitpollen → NAS-App starten → Archiv parallel → automatische Berechnung.
2. **[ARCHITEKTUR.md](ARCHITEKTUR.md)** — Rollen, Datenfluss, Heartbeat,
   Ressourcen, SD-Härtung. Erklärt, warum die Schritte so herum stehen.
3. **[BETRIEB.md](BETRIEB.md)** — alles, was nach dem ersten Start wiederkehrt:
   systemd, Backup/Restore, Alarme, Störungsfälle, InfluxDB, Unraid.
4. **[API.md](API.md)** und **[ANALYSE.md](ANALYSE.md)** — Nachschlagewerke für
   Endpunkte und Methodik, keine Checklisten.
5. **[KONZEPT.md](KONZEPT.md)** + **[LUECKEN.md](LUECKEN.md)** — Zielbild und
   der ehrliche Abgleich Zielbild ↔ Code.

## Die Dokumente im Einzelnen

### Einrichten und betreiben

| Dokument | Inhalt |
|---|---|
| [INSTALL.md](INSTALL.md) | Verbindlicher Ersteinrichtungs-Ablauf (Pi → NAS → Browser), private Dateien, `nas-up`, Unraid, was danach automatisch läuft, Echt-Daten-Abnahme |
| [BETRIEB.md](BETRIEB.md) | Collector/Uploader als systemd-Dienst, tmpfs, InfluxDB, Modell-Läufe beobachten und beschleunigen, Backup + Restore (Pi, InfluxDB, `runtime/`), System-Alarme, Fehlersuche, M1-Abnahme |
| [RP2.md](RP2.md) | RP2 als 24/7-Zugang: NAS-Proxy auf Port 8000, Fallback-GUI, Prognose-Cache, Services, Template-Updates, Fehlersuche |
| [STATIONEN-TAUSCH.md](STATIONEN-TAUSCH.md) | Befund absichern, Ersatz suchen, 1:1-Vorschlag bauen, auf dem Pi aktivieren, NAS-Kopie nachziehen, Rollback |

### Verstehen

| Dokument | Inhalt |
|---|---|
| [ARCHITEKTUR.md](ARCHITEKTUR.md) | Zielbild, Rollen & Datenfluss, Pi (tmpfs, Heartbeat, systemd), Uploader, Ereignis-Pipeline, NAS (InfluxDB, Archiv, Modelle, Selektion), Browser/PWA (Shell, Cache, Offline-Queue), Ressourcen, Hardware-Bewertung |
| [ANALYSE.md](ANALYSE.md) | δ̂-Ranking, Bootstrap-KI & FDR, AV-Score, billigste Stunde, Heatmaps (Niveau/Cheap-Probability), Zeitreihen-Engine, Backtest, Umweg-Ökonomie |
| [KONZEPT.md](KONZEPT.md) | Fachliches Zielbild: drei Fragen (F1/F2/F3), zwei Modi, Ehrlichkeits-Regel, Datenquelle, Selektion, Engine, Decision Layer, Feedback-Ledger, KPIs, UI, Architektur, Roadmap M1–M7 |
| [LUECKEN.md](LUECKEN.md) | Konzept-Abdeckung § für §, geschlossene Punkte, bewusst offener Backlog **mit Grund**, Messwerte |

### Nachschlagen

| Dokument | Inhalt |
|---|---|
| [API.md](API.md) | Alle `/api/v1/*`-Endpunkte mit Parametern, Antworten, Fehlercodes, Deprecation, Beispielen |
| [ENGINE.md](ENGINE.md) | Modellwerkstatt: 12-Uhr-Regel, Datenqualität, Backtest-Rezepte, InfluxDB-Diagnose, Preis-Zwillinge, offene M3-Punkte |
| [DATENWERKZEUGE.md](DATENWERKZEUGE.md) | Gebündelte Befehle (`tankapp.py …`), interne Einzelprogramme, Archiv- und Analyse-CSV-Schema, optionale vertiefte Stationsanalyse |
| [UI-NEUENTWURF.md](UI-NEUENTWURF.md) | Gesamtkonzept der nächsten GUI-Iteration: Diagnose, 7 Leitideen, 6 Bereiche (Jetzt/Stationen/Woche/Ich/Labor/System), Erklär-Treppe, Zustände S0–S3 und Stufen A/B/C, API-Vision, 4 Migrationsphasen |
| [GUI-UX-BEFUND.md](archiv/GUI-UX-BEFUND.md) | Vermessung der gebauten GUI gegen den Entwurf: Typografie, Geräte-Raster, Routing, Erklär-Treppe, Designsystem, Gate-Selbsttäuschung, Props-Drilling — Befunde U1–U8 mit DoD, umgesetzt in 0.41.0 (archiviert mit Erledigt-Vermerk) |
| [TEXT-BEFUND.md](TEXT-BEFUND.md) | Lektorat aller Nutzertexte gegen MICROCOPY: Wochenlinie-Widerspruch, Feedback-Kanal, Tankmenge-Spannen, Tagebuch-Worte, Namens-Drift, Anglizismen, Pfade im Text — Befunde T1–T13 mit DoD, noch ohne Abnahme |
| [OPTIMIERUNGS-BEFUND.md](OPTIMIERUNGS-BEFUND.md) | Sichtung von 0.43.2 gegen sich selbst, ohne Auftrag und ohne Abnahme: Mathematik/Statistik (O1–O15), UX/UI (O16–O21), Technik/Betrieb (O22–O28), Kundensicht (O29–O32), dazu die Dimensionen Datenhaltbarkeit, Integrität, Konfiguration, Beobachtbarkeit, Wirkung, Zugriff, Datenschutz, Barrierefreiheit, Wartbarkeit (O33–O42) — je Befund Beleg mit Zeilenangabe, Wirkung und DoD; Messprotokoll, Abgrenzung zu bekannten Aufgaben und acht Batches mit Priorität, Aufwand und Check je Befund; die Batches 1–5 (O1–O15 mit den jeweils zugeordneten Batch-Punkten, O17, O22–O24, O29, O33, O35, O36, O38, O42, O43) sind mit 0.44.0–0.48.0 umgesetzt und tragen je Befund den Vermerk samt Batch-Abnahme |
| [UMSETZUNG-GUI-NEUENTWURF-2026-09-14.md](archiv/UMSETZUNG-GUI-NEUENTWURF-2026-09-14.md) | Archivierte Arbeits-Checkliste zum abgeschlossenen Neuentwurf: Phasen, Definition of Done je Bereich, Messwerte, Fallback-Gleichschritt, Abnahme |
| [GUI-VORLAGEN.md](GUI-VORLAGEN.md) | Die beiden Prototypen in `sample/` als gestalterische Basis: Übernahmeregeln, visuelle Leitplanken, Trennung Daten/Design |
| [MICROCOPY.md](MICROCOPY.md) | Regelwerk für alle Nutzertexte: Tonfall, Anführungszeichen, Zahlen-/Einheiten-Konvention (€/L vs. ct/L), Benennungen, Leer-/Lade-/Fehlerzustände |
| [QUALITAET.md](QUALITAET.md) | Qualitäts-Gates (D4): Lighthouse-Budgets, Lastpfad gegen `/api/v1/overview`, Demo-Stack, E2E-Suite ohne Mocks, Messwerte und die B7-Rest-Entscheidung |

### Projektstand (Repo-Wurzel, nicht in `docs/`)

| Datei | Inhalt |
|---|---|
| [../README.md](../README.md) | Kurzvorstellung, Geräte-Rollen, Stand der Umsetzung, Entwicklung & Tests |
| [../CHANGELOG.md](../CHANGELOG.md) | Alle nennenswerten Änderungen je Version |
| [../TODO.md](../TODO.md) | Priorisierte Arbeitsliste (P0/P1/P2/D) aus den Prüfungen |
| [../AGENTS.md](../AGENTS.md) | Arbeitsregeln für Änderungen in diesem Repo (CI-Spiegel, Push, GUI-Basis) |

### Archiv

[`archiv/README.md`](archiv/README.md) listet jedes abgelegte Dokument mit Datum,
Grund und Nachfolger. Dort liegen die Prüfberichte (Prüfstand, Gutachten,
Tiefenanalyse V1–V3), die abgeschlossene UUID-Migration, die alten RP2-Anleitungen
inkl. Mockups und ein Punktberichts-Polling-Set. Code-Kommentare, die
„Prüfstand §3.x“ oder „Gutachten“ zitieren, meinen genau diese Dateien.

## Was die App tut

TankApp beantwortet an der Säule in ≤ 5 Sekunden drei Fragen:

- **F1 — Jetzt oder warten?** Ampel + Zeitfenster + € + `p_besser`
- **F2 — Hier oder woanders?** Netto-€ nach Umweg (Sprit + Zeit)
- **F3 — Heute oder später?** Top-3-Fenster

Die GUI ist seit 0.37.x in Aufgabenbereiche geteilt:

- **Jetzt** — Entscheidung, drei Fakten, nächste Schritte, Tagesstreifen.
- **Stationen** — Preis-Atlas mit Referenz, Karte, Verlauf und A-gegen-B.
- **Woche** — Zeitfenster und Tank-Abgleich.
- **Ich** — Fahrzeug, Belege, Bilanz und Einstellungen am Wirkungsort.
- **Labor** — Warum-Ebene: Prognose, Sicherheit, Stationen, Lernen, Glossar und Spielplatz.
- **System** — Anlage, Daten, Läufe, Störungen und Diagnose-Export.

Die alten Tabs **Alltag**, **Werkstatt** und **Einstellungen** sind historisch;
entsprechende Inhalte leben in den Bereichen oben weiter.

```text
Tankerkönig live ──→ Pi: Collector + RAM-Puffer (/dev/shm/tankapp) ──→ NAS: InfluxDB
Tankerkönig-Archiv ───────────────────────────────────────────────→ NAS: Roharchiv + Cache
                                                                  ↓
                                                         Modelle + Selektion
                                                                  ↓
                                                         NAS: API + Web-GUI (1355)
                                                                  ↓
                                                          Handy/PC: Browser
Pi → NAS: collector_status (Herzschlag) via InfluxDB
RP2: Port 8000 proxyt das NAS, zeigt sonst die Fallback-GUI
```

## Schnellstart

```bash
# Pi: zweite Stadt aufnehmen und Polling-Set aktivieren
python3 tankapp.py add-city
sudo python3 tankapp.py activate-polling

# NAS: ein App-Dienst für GUI, Archiv, Modelle, Selektion
bash ops/nas/preflight.sh
python3 tankapp.py nas-up
# Browser: http://<NAS>:1355

# RP2 (optional, 24/7-Zugang): http://<Pi>:8000
```

Details und Reihenfolge: [INSTALL.md](INSTALL.md).

## API auf einen Blick

| Endpunkt | Aufgabe |
|---|---|
| `GET /api/v1/health` | App online, Version/Commit, Alarme, Jobs, Archiv, Modelle, Selektion, Collector |
| `GET /api/v1/decide` | **Primär:** Ampel, Alternativen, Fenster, `latest_by`, Fahrtmodus |
| `GET /api/v1/stations` | Aktuelle Preise (deprecated → `decide`) |
| `GET /api/v1/series` | Preisverlauf einer Station |
| `GET /api/v1/forecast` | Modell-Ausblick 24 h + 3 d/7 d je Station |
| `GET /api/v1/last_forecasts` | Prognose-Bündel für den RP2-Cache |
| `GET /api/v1/heatmap` | DoW × Stunde: Niveau oder Cheap-Probability, Vergleichs-Basis wählbar (B12) |
| `GET /api/v1/selection` | Meine Stationen: δ̂, Bootstrap-KI, AV-Score, billigste Stunde |
| `GET /api/v1/collector/status` | Pi/tmpfs-Livestatus |
| `GET /api/v1/route/evaluate` | Umweg-Ökonomie serverseitig (deprecated → `decide`) |
| `GET /api/v1/stats/summary` | Drei Schichten: Markt-Labor, Advice-Ledger, Wallet |
| `GET/POST /api/v1/episodes`, `POST …/intent` | Empfehlungs-Folgen und Nutzer-Intent |
| `GET/POST /api/v1/fills`, `DELETE …/{id}`, `GET …/fills.csv` | Tankbelege: Verlauf, Storno (Flag statt Löschen), CSV-Export |
| `POST /api/v1/jobs/{job}/run`, `GET …/log`, `POST /api/v1/jobs/trigger` | Job-Start, Job-Log, Webhook vom Uploader |
| `POST /api/v1/collector/heartbeat` | Herzschlag des Pi (HMAC) |

Vollständig mit Parametern, Antworten und Fehlercodes: [API.md](API.md).

## Hinweise, die Verwirrung sparen

- **`data/analysis/` ist das Ausgabeverzeichnis der Selektion** (gitignored:
  `stations/polling.json`, Berichte, Abbildungen). Es existiert nur lokal auf
  Pi/NAS/PC und gehört nie ins Repo — `app/config.py` und `data-tools/*`
  lesen/schreiben dorthin. **Bis 0.15.0 lag dieser Ordner unter
  `docs/analysis/`** (ein Datenverzeichnis mitten in der Doku). Bestehende
  Installationen laufen unverändert weiter: Solange nur der alte Pfad
  existiert, wird er weiter gelesen und geschrieben, und jeder Prozess meldet
  einmal einen Hinweis auf stderr. Verschieben passiert **von Hand**
  (`mv docs/analysis data/analysis`) — private Daten werden nicht still
  umgezogen.
- **`sample/` bleibt.** Beide GUI-Prototypen sind die gestalterische Basis der
  Homepage ([GUI-VORLAGEN.md](GUI-VORLAGEN.md), Regel in [../AGENTS.md](../AGENTS.md)).
- **Private Daten gehören nicht ins Repo:** `config.local.json`, `polling.json`,
  `data/influx.env`, `data/_netrc`, `data/apikey.txt` (siehe `.gitignore`).
- **Begriffe:** **Jetzt**, **Woche**, **Stationen**, **Labor**, **Ich**,
  **System** — die sechs Bereiche der GUI. „Alltag“, „Werkstatt“,
  „Einstellungen“, „Statistik“ und „Prüfstand“ sind veraltete Bezeichnungen und
  stehen nur noch in Archiv-Dokumenten und bewusst in der RP2-Fallback-GUI
  (dort heißen die zwei Ansichten weiter Alltag und Werkstatt, siehe
  [RP2.md](RP2.md)).

## Regeln für diese Dokumentation

1. **Ein Ort.** Dokumentation lebt in `docs/`. Keine READMEs neben Code-Ordnern,
   keine Anleitungen in Repo-Wurzel oder Unterordnern.
2. **Aufgabe im Dateinamen.** Ein Dokument = eine Aufgabe. ASCII, Großbuchstaben,
   keine Datumsangaben bei lebenden Dokumenten.
3. **Stichtag ins Archiv.** Prüfberichte, Migrationen und Punktstände sind nach
   ihrer Abarbeitung historisch: `docs/archiv/<THEMA>-<JJJJ-MM-TT>.md` plus Eintrag
   in [archiv/README.md](archiv/README.md) (Grund + Nachfolger). Noch gültige
   Betriebs-Aussagen daraus werden vorher in das zuständige lebende Dokument
   übernommen (meist [BETRIEB.md](BETRIEB.md)).
4. **Stand-Zeile und Inhaltsverzeichnis** oben in jedem Dokument.
5. **Links bleiben heil.** `tests/test_operations.py::test_local_documentation_links_exist`
   prüft jeden lokalen Link und jeden Anker in allen Dokumenten inklusive Archiv —
   ein umbenanntes Dokument bedeutet immer auch: Verweise nachziehen
   (Markdown, Python-Docstrings, CLI-Hilfen, `web/`, `.github/`).
6. **Ehrlichkeits-Regel gilt auch für Doku** (Konzept §0.4): kein „fertig“,
   was nicht abgenommen ist; offene Punkte mit Grund statt Lücke.

## Footer

Daten: MTS-K via tankerkoenig.de (CC BY 4.0) · Token-Bucket 1 Request/300 s ·
Polling-Fenster 06–24 Uhr · App-Version und Commit-Hash stehen in
`GET /api/v1/health` und im GUI-Footer.
