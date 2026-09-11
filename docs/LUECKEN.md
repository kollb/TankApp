# TankApp Lücken-Check — Konzept gegen Stand

> Stand: 2026-09-10. Abgleich von [KONZEPT.md](KONZEPT.md) (Zielbild) mit dem
> Code. **B3** (Aggregate), **B4** (Decision Layer) und die Ereignis-Pipeline
> waren vor diesem Durchgang fertig; **B5** schließt die Lücken dieses Blatts.
> Kein Punkt behauptet Modellgüte: Kalibrierung bleibt M7 vorbehalten (§0.4).
> Die unabhängige Prüfung vom 10.09.2026 ([Prüfstand](Prüfstand.md)) ergänzt
> dieses Blatt: Dort stehen weitere Abweichungen und die offenen Code-Aufgaben
> (§3, §7); hier sind die Stellen verlinkt, die Konzeptaussagen betreffen.

## Inhaltsverzeichnis

- [Kurzfassung](#kurzfassung)
- [B5: in diesem Durchgang geschlossen](#b5-in-diesem-durchgang-geschlossen)
- [Konzept-Abdeckung im Einzelnen](#konzept-abdeckung-im-einzelnen)
- [Bewusst offen (Backlog mit Grund)](#bewusst-offen-backlog-mit-grund)
- [Nicht umgesetzt und warum nicht](#nicht-umgesetzt-und-warum-nicht)
- [Messwerte](#messwerte)

## Kurzfassung

| Bereich | Vor B5 | Nach B5 |
|---|---|---|
| „Läuft …“ beim Modell-Job | nur Zustand, kein Fortschritt | Phasen, Schritt x/y, Balken, Restschätzung in GUI, Statusdatei und Log |
| Rechenzeit Modell-Lauf | ~3 min je Station, ein Kern | ~14 s je Station, mehrere Kerne |
| API-Schutz | nur im Reverse Proxy gedacht | Rate-Limit + `X-Api-Key` in der App (§11) |
| Alte Alltags-Routen | ohne Hinweis | `Deprecation`/`Sunset`/`Link` (§11.3, M5) |
| `latest_by` („bis wann muss ich tanken?“) | Parameter dokumentiert, nicht implementiert | schneidet Fenster und F1-Entscheidung |
| Fahrtmodus `dedicated` | nur in der Selektion | auch in `/v1/decide` (§10) |
| M7-Schwellen-Nachzug | Ankündigung | Vorschlag aus dem Advice-Ledger, abschaltbar (§13) |

## B5: in diesem Durchgang geschlossen

1. **Fortschritts-Protokoll der NAS-Jobs** (`app/progress.py`) — Statusdatei
   `runtime/jobs/<job>.progress.json`, Log `runtime/jobs/<job>.log`
   (500 Zeilen), Ausgabe im Journal/Docker-Log und im System-Tab.
   `/api/v1/health` liefert `progress` je laufendem Job; die GUI pollt
   während eines Laufs alle 15 s. Siehe [Betrieb](BETRIEB.md#modell-lauf-beobachten).
2. **Beschleunigung des Modell-Laufs** — vektorisierte Segmentgrenzen der
   12-Uhr-Regel (kein `pd.Timestamp`-Boxing mehr) und schnellere
   Pool-adjacent-violators-Projektion; Ergebnisse **bitgleich** zur vorherigen
   Implementierung (direkter Vergleich über 24 h/72 h/168 h und 200
   Zufallsverläufe). Neu `app/model_jobs.py`: Fit, Horizonte und Backtests
   laufen prozessparallel (`TANKAPP_MODEL_WORKERS`, Default automatisch),
   mit seriellem Rückfall, wenn kein Prozess-Pool verfügbar ist.
3. **Rate-Limit + API-Key** (`app/ratelimit.py`, Konzept §11) — 60/min
   anonym, 300/min mit Schlüssel, Tageskontingente, `X-RateLimit-*`-Header,
   `429` + `Retry-After` + `error_code: rate_limited`.
4. **Deprecation-Header** (§11.3, M5) auf `stations`, `day` und
   `route/evaluate` mit `Link` auf `/api/v1/decide`. Werkstatt-Routen bleiben
   unmarkiert.
5. **`latest_by`** in `/api/v1/decide` (§4.1 H, §4.3 T_max, §11.1): Fenster
   und Warten-Empfehlung enden spätestens am angegebenen Zeitpunkt; ohne
   verbleibendes Fenster folgt ehrlich `no_advice` statt eines erfundenen.
6. **Fahrtmodus in `/api/v1/decide`** (§10): `mode=onroute|dedicated` plus
   `home_lat`/`home_lon`; Alternativen weisen `trip_mode`, Umweg-km,
   Sprit-/Zeitkosten und Netto getrennt aus.
7. **M7-Schwellen-Nachzug** (`app/thresholds.py`, §5.5 Schritt 4, §13 M7):
   Vorschlag aus den gemessenen Trefferquoten (Ziele 70 %/85 %/60 %, erst ab
   n = 25 je Aktion), begrenzte Schritte, harte Grenzen; sichtbar in
   `/api/v1/stats/summary` (`threshold_tuning`). Wirksam nur mit
   `TANKAPP_M7_AUTO_APPLY=1` — die Produktion entscheidet sonst weiter mit
   der kalibrierten Tabelle (§8.2 Nr. 1).
8. **Trefferquote `refuel_elsewhere`** im Advice-Ledger (bisher nur
   WARTEN/JETZT) — Voraussetzung für Punkt 7.

## Konzept-Abdeckung im Einzelnen

| § | Anforderung | Stand |
|---|---|---|
| 0.1–0.3 | Drei Fragen, zwei Modi, eine Zahl |fertig (Alltag/Werkstatt-Tabs, Ampelkarte) |
| 0.4 | Kalibrierungs-Gate (Brier < 0,25, n ≥ 100) |fertig als hartes Gate; offen bis echte Daten (M7) |
| 1 | Tankerkönig-Collector, tmpfs, Upload |fertig (M1) |
| 2 | Selektion δ̂, Bootstrap-KI, AV, Tagesform |fertig (B3.10); **Abweichung**: GUI sortiert nach δ̂-Score, Konzept §2/§8.2 Nr. 7 verlangt Sortierung nach Empfehlungsstärke ([Prüfstand §1.2](Prüfstand.md)) |
| 3.1–3.2 | Aufbereitung, Strukturmodell + AR(2), 12-Uhr-Regel |Strukturmodell + AR(2) + 12-Uhr-Regel fertig; **offen**: Hampel-Filter (§3.1 Schritt 3), gepoolter Feiertags-Dummy, Zeit-seit-Sprung-Feature, M3-Zweitmodell/Ensemble ([Prüfstand §1.3](Prüfstand.md)) |
| 3.3 | Bootstrap-Intervalle |fertig (unkalibriert, gekennzeichnet); **ACI offen** (§3.3 selbst: erst nach 4 Wochen Live-Betrieb) |
| 3.4 | Backtest 24 h, Horizonte +3/+7 d |fertig; Mehrtage-Backtests offen |
| 4.1–4.3 | F1/F2/F3 inkl. Fenster-Top-3 |Regel- und €-Seite fertig (B4) + `latest_by` (B5); **P-Seite abweichend**: `p_besser` ist eine Ledger-Trefferquote (Laplace-geglättet), nicht die Prognoseverteilungs-Wahrscheinlichkeit aus §4.1; `p_lohnt` (§4.2) und F3-Fenster-P fehlen ([Prüfstand §1.4](Prüfstand.md)) |
| 4.4 | „Keine klare Empfehlung“ |fertig |
| 4.5 | Schwellen in einer Config |fertig (B5: `app/thresholds.py`) |
| 5.1–5.2 | Brier, Reliability, zwei Ledger |fertig |
| 5.4 | Drei Uhren, Episode, Slack-Matching, Due-Prompt |fertig; **Offline-Queue für Fill/Intent offen** (P2) |
| 5.5 | Drei Schichten A/B/C |fertig; w(h)-Rückkopplung in Selektion/F3 offen (Datenbedarf ≥ 8 Füllungen) |
| 6 | Produkt-KPIs | Brier, Trefferquoten, Regret-Ratio fertig; **Top-3-Fenster-Trefferquote offen** (Engine liefert je Tag nur eine Prognosestunde) |
| 7 | Polling-Fenster 06–24 |fertig |
| 8.1 | Alltag: Ampel, Alternativen, Tagesstreifen, What-If |fertig |
| 8.2 Nr. 1–4, 6–9 | Werkstatt: Regel/ε, Scoreboard, Kalibrierung, Stations-Labor, Fan-Chart/Heatmaps, Meine Stationen, System-Status, API-Explorer |fertig (System-Status jetzt mit Fortschritt) |
| 8.2 Nr. 5 | Paarvergleich als Werkstatt-Werkzeug |teilweise: die Umweg-Rechnung liegt im Alltag („Rechnet sich der Umweg?“) und serverseitig in `/api/v1/route/evaluate`; ein zweites Panel in der Werkstatt wäre Duplikat |
| 9 | Pi ↔ NAS, Archiv, Jobs |fertig + Job-Fortschritt (B5) |
| 10 | Umweg-Ökonomie, Zeitwert, Rushhour |fertig; E5↔E10-Äquivalenz nur als Hinweis, nicht im Ranking |
| 11.1 | `/v1/decide` inkl. `lat`/`lon`, `latest_by`, `home_*` |fertig außer Standortwahl per `lat`/`lon` (App arbeitet mit dem Polling-Set) |
| 11.2 | Intent, Fills, Settlement |fertig |
| 11.3 | Detail-Endpunkte + Deprecation |fertig (B5) |
| 12 P0 | Datenquellen, Erreichbarkeit, E10 |fertig |
| 12 P1 | Markenrabatte, w(h), Lebenszyklus |Rabatte offen, w(h) berechnet aber nicht zurückgekoppelt, CUSUM-/Coverage-Alarm teilweise |
| 12 P2 | Push, Belege |offen (siehe unten) |
| 13 M1–M4 | Collector, Selektion, Engine, PWA |M1/M2/M4 fertig; M3 ohne Echt-Daten-Abnahme |
| 13 M5 | TankPuls-API |fertig (B4 + B5: Rate-Limit, Deprecation); **offen**: OpenAPI-Spezifikation aus M5-Fertig-Kriterium (siehe „Bewusst offen") |
| 13 M6 | Quantile-Boosting |optional, verworfen bis ≥ 3 Monate Daten |
| 13 M7 | Kalibrierungs-Loop |Vorschlag und Regler fertig (B5); Anziehen der Schwellen erst mit echten Live-Daten sinnvoll |

## Bewusst offen (Backlog mit Grund)

| Thema | Grund, es jetzt *nicht* zu tun |
|---|---|
| **ACI (§3.3)** | Konzept verlangt 4 Wochen Live-Betrieb vor der Aktivierung; ohne echte Scores wäre α eine erfundene Zahl. Bootstrap-Intervalle bleiben als unkalibriert gekennzeichnet. |
| **M3-Zweitmodell/Ensemble (§3.2)** | Setzt die Abnahme-Kriterien (MASE, Pinball) voraus — die sind ohne echten Datenbestand nicht prüfbar. |
| **Push-Benachrichtigung (§12 P2)** | Braucht ntfy/Telegram und eine Entscheidung über Netzzugänge; Trigger aus dem Decision Layer sind vorbereitet, aber ungetestet. |
| **Top-3-Fenster-Trefferquote (§6)** | Die Engine veröffentlicht je Tag eine Prognosestunde; drei Kandidatenfenster wären geraten. Erst mit Fensterstruktur im Backtest. |
| **w(h)-Rückkopplung in Selektion/F3 (§5.5)** | Profil ist berechnet (`wallet.wh_hours`), aber erst ab ≥ 8 Füllungen belastbar — vorher wäre der Default die ehrlichere Wahl. |
| **Markenrabatte (§12 P1)** | `--brand-rebate` ist ein Eingriff in δ̂ und Score; ohne echte Rabattdaten nicht kalibrierbar. |
| **Standortwahl per `lat`/`lon` (§11.1)** | Die App arbeitet mit dem kuratierten Polling-Set ( Kontingent 1 R/5 min). Freie Umkreissuche bräuchte eigene Requests und ein Kontingent-Modell. |
| **Offline-Queue für Fill/Intent (§5.4)** | Der Service-Worker hält die letzte Antwort vor; eine IndexedDB-Warteschlange ist sinnvoll, aber erst nötig, wenn Füllungen im echten Betrieb häufig offline erfasst werden. |
| **E5↔E10-Äquivalenz im Ranking (§10)** | 1,015-Faktor ist eine Näherung; ohne gemessenen Mehrverbrauch des Fahrzeugs wäre das Ranking damit weniger ehrlich, nicht mehr. |
| **OpenAPI-Spezifikation (M5)** | Konzept §13 nennt „OpenAPI + Tests grün" als Fertig-Kriterium; bis dahin ist [API.md](API.md) die verbindliche Endpunkt-Beschreibung. Eine aus `app/server.py` generierte OpenAPI-Datei wäre Werkzeugarbeit ohne neuen Inhalt — erst mit einer zweiten API-Verbraucherin lohnend. |
| **Feedback-Ledger-Persistenz (JSON vs. relationale DB)** | Gutachten-Empfehlung (ACID via SQLite/PostgreSQL). Der JSON-Store funktioniert im Ein-Nutzer-NAS-Betrieb; entschieden wird zusammen mit Retention/Rotation ([Prüfstand §3.5](Prüfstand.md)). |
| **Kampagnen-Quote 6/2/2 auf dem NAS (§2)** | Der NAS-Job rankt global Top-10 je Kraftstoff; die 6/2/2-Quotierung existiert nur in der Offline-Pipeline (`analysis/station_selection.py`). Erst relevant, sobald mehr als eine Kampagnenstadt live geht ([Prüfstand §1.2](Prüfstand.md)). |
| **P-Schätzer im Advice-Ledger (Laplace vs. Beta-Binomial)** | Implementiert ist Laplace-Glättung `(hits + 10·0,5)/(n + 10)`; das Gutachten schlägt Beta(5,5)-Binomial vor. Beide sind priorsauber — ein Wechsel vor M7 ist nicht messbar, deshalb kein Handlungsbedarf. |
| **`live_only_days` senken (90 → z. B. 28), „damit es zum M7-Zeitplan passt“** | Die Übergangsregel liegt **nicht** im M7-Pfad: `/v1/decide` schreibt ab Tag 1 Shadow-Snapshots (`app/decide.py`, „der Ledger misst die Tabelle trotzdem“), und das Gate zählt abgeschlossene Settlements (`min_recommendations`). 28 statt 90 Tage brächten M7 keinen Tag früher — die Kacheln sind seit der Trennung ohnehin getrennt ausgewiesen ([API.md](API.md) Punkte 2 und 6). Was die 90 Tage kaufen, ist Modell-Input: ab Handover fällt das Archiv weg (`engine/bootstrap.py`, `selected_archive = archive.iloc[:0]`), der Fit braucht sein 42-Tage-Fenster (`engine/config.py`: `train_days=42`, Untergrenze `min_train_days=28`, geprüft in `engine/models.py::fit`). Bei 28 live-only Tagen läge der Fit exakt auf der Untergrenze — ein einziger Tag ohne Daten (Umbau, Collector-Ausfall) ließe ihn mit `ValueError` scheitern; bei 90 Tagen bleiben 62 Tage Puffer. **Untergrenze einer Senkung ist deshalb `train_days` = 42, nicht 28**, und sie gehört gemessen (Backtest: MASE/PICP bei 42 vs. 90 Tagen Live-Input), nicht geschätzt. Nebenbefund: `app/refresh.py` ruft `bootstrap()` zweimal ohne `live_only_days` auf (Abdeckungsprüfung und Training) — der Produktivpfad ist damit auf 90 fest, `--live-only-days` wirkt nur im Standalone-CLI. Ein Knopf `TANKAPP_LIVE_ONLY_DAYS` in `app/config.py` lohnt erst, wenn die Messung einen anderen Wert verlangt. |

## Nicht umgesetzt und warum nicht

- **Ergebnisse verändern sich nicht durch Parallelität.** Die Aufgaben
  (Station × Horizont) sind unabhängig, Config und Cutoff sind identisch, der
  Bootstrap nutzt einen seed-basierten Generator. Test
  `tests/test_model_jobs.py::test_parallel_matches_sequential` vergleicht
  serielle und parallele Ausgabe.
- **Keine neuen Demo-Zahlen.** Alle neuen Felder (`progress`, `thresholds`,
  `context`) sind `null` bzw. Startwerte, solange keine echten Daten
  vorliegen — Ehrlichkeits-Regel (§14).
- **Keine Credentials im Log.** Das Fortschrittsprotokoll schreibt Phasen,
  Stationsnamen und Zähler. Zugangsdaten, Tokens und Pfade zu privaten
  Dateien erscheinen nicht.

## Messwerte

Gemessen auf 8 Test-Stationen, 70 Tage Verlauf, 2 CPU-Kerne
(siehe [Betrieb](BETRIEB.md#modell-lauf-beschleunigen)):

| Schritt | vorher | nachher |
|---|---|---|
| Prognose 24 h | 12,4 s | 0,8 s |
| Prognose +3 d | 35,7 s | 2,2 s |
| Prognose +7 d | 82,1 s | 4,9 s |
| Backtest 7 Tage | 44,3 s | 6,4 s |
| Gesamtlauf 8 Stationen (seriell) | ~23 min | 121 s |
| Gesamtlauf 8 Stationen (2 Prozesse) | – | 70 s |

Die Zahlen sind Messwerte einer Testreihe, keine Zusage für den echten
Bestand; entscheidend ist der Faktor, nicht der Absolutwert.
