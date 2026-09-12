# TankApp — ToDo (Stand 12.09.2026, App-Version 0.19.0)

> **Rahmenbedingung:** Die App läuft ausschließlich im eigenen LAN (Pi ↔ NAS ↔
> Browser). **Usermanagement, Login und Auth sind explizit nicht nötig** und
> werden in dieser Liste bewusst *nicht* aufgeführt. Rate-Limiting und
> Input-Validierung bleiben trotzdem drin — sie schützen vor Fehlbedienung,
> Doppelgeräten im Haushalt und defekten Clients, nicht vor Angreifern.
>
> **Prioritäten:**
> - **P0** = riskiert falsche Zahlen oder Datenverlust → als Nächstes
> - **P1** = wichtig für den echten 24/7-Dauerbetrieb
> - **P2** = Komfort, Ausbau, Feinschliff
> - **D**  = braucht echte Live-Daten oder eine Produktentscheidung (kein reines Code-Task)
>
> **Quellen:** [docs/LUECKEN.md](docs/LUECKEN.md) (Konzept ↔ Stand) und die
> Prüfberichte im [Archiv](docs/archiv/README.md) —
> [Prüfstand 10.09.](docs/archiv/PRUEFSTAND-2026-09-10.md),
> [Tiefenanalyse V1](docs/archiv/TIEFENANALYSE-2026-09-11.md)/
> [V2](docs/archiv/TIEFENANALYSE-V2-2026-09-11.md)/
> [V3-GUI](docs/archiv/TIEFENANALYSE-V3-GUI-2026-09-11.md),
> [Gutachten](docs/archiv/GUTACHTEN-2026-09-10.md).
> Diese Liste ist die priorisierte Arbeitsliste daraus. **Erledigte Punkte stehen
> hier nicht mehr** — sie sind im [CHANGELOG](CHANGELOG.md) und in
> [docs/LUECKEN.md](docs/LUECKEN.md#umgesetzt-seit-der-prüfung-am-10092026)
> nachvollziehbar; die IDs (A3, B4, …) bleiben dort stabil.

---

## A. Fachlich (Produkt & Domäne)

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| A1 | P1 | **Fahrzeug-/Haushaltsprofile ohne Login** | Verbrauch, Zeitwert, Tankmenge, Kraftstoffart liegen heute im `localStorage` pro Browser → Handy ≠ PC, zweites Fahrzeug (Diesel vs. Benziner) unmöglich. Ziel: Profil-Umschalter im Header, serverseitig gespeichert (pro Haushalt, kein Account), GUI-Felder lesen daraus. |
| A2 | P1 | **Tankstand / Restreichweite als Eingabe für F3** | Konzept-F3 („Tank bei ¼, kann ich warten?“) hat keinen Tankstand-Input. Ziel: Fuellstand-Angabe (≈ Füllstand oder Rest-km), App sagt ehrlich „Warten riskant, Reserve reicht ~40 km“ statt nur „bestes Fenster morgen“. |
| A4 | P1 | **Jahres-/Monatsbilanz in der Werkstatt** | Konzept §12 P2: „Wallet-Ledger im Alltag, **Jahresbilanz in der Werkstatt**“. Heute nur Summen-Kacheln im Alltag. Ziel: Verlaufsliste der Fills, Monats-/Jahressumme, Ø €/Tankung, Vergleich gegen „immer sofort getankt“-Baseline (Regret-Ratio ist vorhanden, nur nicht persönlich aufbereitet). |
| A8 | D | **Markenrabatte/Karten** (`--brand-rebate`) | 2–4 ct können das F2-Ranking umdrehen. Erst sinnvoll, sobald echte Rabattdaten vorliegen; bis dahin soll die GUI im Ranking anzeigen „rechnet ohne Rabattprogramme“ (Transparenz-Hinweis). |
| A9 | D | **w(h)-Rückkopplung anschließen** | Persönliches Zeitprofil (`wallet.wh_hours`) wird berechnet, fließt aber nicht in „billigste Stunde“/F3 ein (Konzept §5.5). Ab ≥8 Füllungen aktivieren, vorher Default — mit UI-Hinweis ab wann personalisiert. |
| A10 | D | **M3-Zweitmodell/Ensemble + Echt-Daten-Abnahme** | Hampel-Filter, Feiertags-/Sprung-Features, Mehrtage- und 21-Tage-Backtest sowie Rolling-PICP sind seit PR #69 implementiert und testgedeckt. Offen bleiben das unabhängige Zweitmodell mit inverse-MASE-Ensemble und die Abnahme aller M3-Kriterien auf echten Live-Daten. |
| A11 | D | **Gemeinsame Bootstrap-Ziehung für `p_lohnt`** | Konzept §4.2: Marktgleichlauf darf nicht wegkorreliert werden. Braucht stationsübergreifenden Resampling-Schritt (gleicher Tagesblock je Ziehung) — eigener Arbeitsschritt, in LUECKEN begründet offen. |
| A12 | P2 | **Station-Lebenszyklus & Zustandsehrlichkeit** | „führt E10 nicht“ vs. „temporär geschlossen“ vs. „keine Daten seit n Tagen“ wird in der GUI nicht unterschieden. Tote Stationen (`no prices` > 7 Kalendertage) sollen automatisch aus Ranking/Polling-Set fallen (konfigurierbar), nicht dauerhaft Kontingent kosten. |
| A13 | P2 | **Preis-Zwillinge: automatische Warnung** | Identische Preisverläufe zweier Stationen (Doppel-Source/Franchise) werden nur manuell per `compare-stations` gefunden. Ziel: Warnung im Selektions-Artefakt + System-Tab. |

---

## B. Technisch (Backend, Datenhaltung, Betrieb, Qualität)

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| B8 | P2 | **Webhook-Retry Pi → NAS** | `POST /jobs/trigger` ist Fire-and-Forget: NAS kurz offline → Watermark verloren, läuft nur noch intervallbasiert, ohne Hinweis. Ziel: Retry mit Backoff + Quittierung, Status im Collector-Status sichtbar. |
| B10 | P2 | **Service-Worker: Versionierung & Update-Anzeige** | Cache-Namen sind fix `…-v1`; ein GUI-Update signalisiert dem Nutzer nichts, und die Offline-Queue aus dem Konzept (§5.4, IndexedDB) fehlt. Ziel: SW-Version im Build bumsen, „Neue Version — neu laden?“-Banner, Offline-Queue für Fill/Intent mit sichtbarem „wird gesendet, sobald online“-Zustand. |
| B11 | P2 | **Ressourcen-Abgleich Modell-Worker** | `TANKAPP_MODEL_WORKERS` bis 8 Prozesse × pandas vs. `shm_size: 256m` in [ops/nas/app/compose.yml](ops/nas/app/compose.yml) — nicht getestet; bei NAS-HDD werden außerdem File-Locks (`locked_store`, 50×0,05 s) knapp. Ziel: Lauf mit Max-Workern auf Zielhardware + Doku-Werte, Lock-Timeout erhöhen bzw. klare 503-Meldung. Teilmessung vom 12.09.2026 (Synthetik-Datenstand, nicht Zielhardware): Privat-Speicher je Worker 105 MB (fork) bzw. 150 MB (forkserver), 8 Worker ≈ 0,8–1,2 GB — Details und Folgen in B19. Zielhardware am selben Tag gemessen: **4** Kerne (J5040) und damit 4 Worker, kein Pinning/Quota/Speicher-Limit (`CpusetCpus` leer, `NanoCpus=0`, `HostConfig.Memory=0`); Host 15 Gi gesamt / **4,2 Gi verfügbar** / Swap 0; Container laut `docker stats` 220–280 MiB im Leerlauf bzw. während leichter Phasen. `shm_size: 256m` bleibt ungetestet. Achtung Messfalle: `nproc` meldet im Container `1`, weil das Image `OMP_NUM_THREADS=1` setzt — Details in B23. |

### Laufzeit des Modell-Laufs — Befund und Messwerte vom 12.09.2026 (B15–B23, nichts davon umgesetzt)

Auslöser sind zwei `models`-Läufe im Job-Log vom 12.09.2026: 80 Tasks
(20 Stationen × fit24/wide72/wide168/backtest21), Dauer **8,3 min** bzw.
**11,2 min**, davon ~95 % in der Phase „Modelle fitten + Backtest“.

Messaufbau für alle Zahlen unten (bewusst außerhalb des Repos, nur Messung):
nachgebauter Datenstand aus demselben Log — 20 Stationen, 120 Tage Archiv
(28 152 Ereignisse) plus ~2 Tage Live-Polling (10 760 Zeilen), 5-Minuten-Raster,
`Config`-Defaults (`bootstrap_samples=2000`, `train_days=42`,
`holiday_pool_days=365`), Original-Engine-Code, Python 3.11, numpy 2.4.6,
pandas 3.0.5, ein Kern. „Bitgleich“ heißt jeweils: gegen die aktuelle
Implementierung auf vier Stationen geprüft (Modellfelder, Kennzahlen,
Vergleichszeilen, Rolling-PICP) — nicht geschätzt.

**Zielhardware-Messung vom 12.09.2026 (NAS `Tower`, Container `tankapp-web-app-1`) —
diese Zahlen gelten für den echten Betrieb, nicht für den Messaufbau:**

| Größe | Wert | Folge |
|---|---|---|
| Kerne, Host = Container | **4** (Intel Pentium Silver J5040, 4 Kerne, 1 Thread/Kern) | `resolve_workers` → `min(8, 4)` = **4 Worker**. Der Prozess-Pool bringt auf dieser Hardware echten Durchsatz. |
| `CpusetCpus` / `NanoCpus` / `CpuQuota` | leer / `0` / `0` | Kein Pinning, keine Quota, kein Limit. unRAID führt Compose-Container (Projekt `tankapp-web`) nicht in der CPU-Pinning-Oberfläche; eine Bindung wäre trotzdem in `docker inspect` sichtbar — ist sie nicht. |
| `nproc` im Container | **1 — Messfalle, kein Limit** | Das Image setzt `OMP_NUM_THREADS=1` ([ops/nas/app/Dockerfile](ops/nas/app/Dockerfile), Zeile 11), und GNU `nproc` ehrt diese Variable. Nachbau im Sandkasten: `nproc` = 2, `OMP_NUM_THREADS=1 nproc` = 1, Affinität unverändert 2. Korrekt messen: `python -c "import os; print(os.cpu_count(), os.process_cpu_count(), len(os.sched_getaffinity(0)))"` → auf dem NAS `4 / 4 / 4`. |
| `multiprocessing.get_start_method()` | **`forkserver`** | B19 ist damit auf der Zielhardware bestätigt (Python 3.14, gh-84559): initargs werden je Worker gepickelt, zwei Pools je Kraftstoff. |
| `docker inspect`: `OOMKilled` / `RestartCount` / `HostConfig.Memory` | `false` / `0` / `0` | Kein Container-OOM, kein Neustart, kein Speicher-Limit. |
| `dmesg -T \| grep -i oom` auf dem Host | **leer** | Auch der Kernel hat nichts gekillt. Speicherdruck scheidet als Erklärung für den Abbruch um 14:48 aus — Einschränkung: die Abdeckung des Ringpuffers bis 14:48 wurde nicht geprüft. |
| `free -h` auf dem Host | 15 Gi gesamt, 11 Gi belegt, **4,2 Gi verfügbar**, Swap 0 | 4 Worker × ~150 MB ≈ 0,6 GB passen; B11 bleibt als Abgleich offen. |
| `docker stats` (nach Neustart mit `TANKAPP_MODEL_WORKERS=1`) | 220–280 MiB, 101–185 % CPU, 7–10 PIDs | Einzelwerte, nicht während der Fit-Phase aufgenommen — kein Beleg für oder gegen seriell/parallel. `ps` fehlt im Image (`python:3.14-slim`), Prozessliste über `docker top`. |

Zusammenspiel mit dem Code — **korrigiert gegenüber der ersten Deutung derselben
Messung** (die `nproc` = 1 als Ein-Kern-Bindung gelesen hatte):
`app/model_jobs.py::resolve_workers` nutzt `os.cpu_count()`, das CPU-Affinität
und cgroup-Quota ignoriert. Auf dieser Hardware ist das ohne Wirkung, weil Host
und Container dieselben 4 Kerne sehen (`4 / 4 / 4`); latent bleibt der Fehler
trotzdem, siehe B23. Die Wandzeit von 8,3 bzw. 11,2 min **bei 4 Workern** heißt
umgekehrt: ein J5040-Kern liefert grob ein Viertel bis ein Drittel des
Durchsatzes des Mess-Kerns (557 s serielle CPU-Zeit im Sandkasten wären dort
~25–40 min, durch 4 Worker ~7–10 min — Abschätzung aus zwei Datenpunkten unter
der Annahme idealer Skalierung, nicht gemessen). **Absolute Zeiten aus dem
Sandkasten sind damit nicht übertragbar, Verhältnisse schon.** Ein Image von
Docker Hub würde an alldem nichts ändern: Es gibt keine Restriktion, die
wegfallen könnte, und [ops/nas/app/compose.yml](ops/nas/app/compose.yml) baut
bewusst lokal aus dem Repo (inklusive `TANKAPP_BUILD_COMMIT` als
Versionsnachweis in der GUI).

**Wo die Zeit hingeht (gemessen, eine Station):**

| Anteil | Messung |
|---|---|
| Task `backtest21` | 24,3 s = **86 %** der CPU-Zeit einer Station (21 Folds × 1 `fit` + 3 `predict`); fit24 0,6 s, wide72 1,2 s, wide168 2,2 s |
| `predict()` → 12-Uhr-Projektion | **91 %** von `predict`: 2000 Bootstrap-Pfade einzeln in Python, darin 1,04 Mio. Aufrufe `isotonic_decreasing`, 126 Tsd. `noon_law_projection`, allein 3,4 s für 126 Tsd. Aufrufe von `law_since_utc` (nur von `cfg` abhängig) |
| `fit()` (219 ms) | 90 ms `strftime` für die Tagesschlüssel der Residuen-Blöcke, 46 ms Feiertagsmaske als List-Comprehension über Timestamps, 65 ms `pivot_table(aggfunc="median")` über ~2 900 (Tag, Slot)-Zellen mit je **genau einem** Gitterpunkt, 18 ms Huber-IRLS |
| Summe 20 Stationen | 557 s CPU seriell auf dem Mess-Kern. Zielhardware: 4 Kerne (J5040), 4 Worker, 8,3 bzw. 11,2 min Wandzeit — ein Kern dort ist grob 4× langsamer als der Mess-Kern, also nur Verhältnisse übertragen, keine absoluten Zeiten |

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| B15 | P1 | **Bootstrap-Pfade vor der 12-Uhr-Projektion deduplizieren** | Ein Pfad hängt innerhalb eines Segments [12:00, nächste 12:00) nur von den gezogenen Tagesblöcken ab: bei 43 Blöcken gibt es je Segment höchstens 43² Kombinationen, bei Mitternachts-Origin — also in **allen** Backtest-Folds — genau 43. Gemessen: 86 von 4 000 Pfaden sind projektionspflichtig (46× weniger Arbeit), beim Tages-Origin 14:45 noch 1 065 von 4 000 (3,8×). Prototyp: Ziehungen je Segment über `np.unique(…, axis=0, return_inverse=True)` deduplizieren, eindeutige Zeilen projizieren, per `inverse` zurückschreiben — **bitgleich** (MAE, MASE, PICP, MPIW, Pinball, Vergleichszeilen und Rolling-PICP identisch). Wirkung allein: `predict` 24 h 0,41→0,16 s, 72 h 0,98→0,52 s, 168 h 2,18→1,21 s, `run_backtest(21 d)` 24,3→5,5 s. Ziel: Umsetzung in `engine/models.py::predict` mit Test „Dedup liefert bitgleiche Quantile/Pfade“ und Gegenmessung im Lauf. **Negatives Messergebnis, damit es niemand wiederholt:** ein PAVA, der über die Pfad-Achse vektorisiert (alle Zeilen gleichzeitig, Merge-Runden als Masken-Operation), war je Zeile ~7× **langsamer** als die bestehende skalare Fassung — die Zahl der Runden pro Position skaliert mit der tiefsten Merge-Kaskade über alle Zeilen (aus 1,3 µs/Pfad-Zeile wurden 9,6 µs). Der wirksame Hebel ist die Deduplizierung, nicht die Vektorisierung. Optionaler Nachsatz: `np.nanquantile` ist danach noch ~5 % von `predict` und ließe sich aus den deduplizierten Pfaden mit ihren Häufigkeiten rechnen. |
| B16 | P1 | **`fit()` von String- und Aggregator-Overhead befreien** | 22 Fits je Station und Lauf. Prototyp **bitgleich** (219→79 ms): (a) Tagesschlüssel über `pd.factorize(index.tz_convert(tz).normalize())` statt `strftime("%Y-%m-%d")` (14,4→0,24 ms je 2016 Punkte; Auftretensreihenfolge = chronologisch, weil das Raster sortiert ist — dieselbe Ziehreihenfolge wie heute), (b) Feiertagsmaske über `searchsorted` auf Feiertags-Int64 statt List-Comprehension mit Timestamp-Iterierung (28,7→2,3 ms), (c) Residuen-Tagesblöcke als Index-Zuweisung `blocks[tag, slot] = residual` statt `pivot_table(aggfunc="median")` — (Tag, Slot) ist je Gitterpunkt eindeutig, der Median reduziert also genau einen Wert und verwirft NaN, (d) Naiv-Profil über stabilen Sortierindex + `searchsorted` statt `groupby(…).agg(lambda g: g.iloc[-1])`, (e) Zähler `law_rise_outside_noon` vektorisiert. Zusätzlich möglich, aber **nicht bitgleich**: Huber-IRLS über gewichtete Normalgleichungen (13 Spalten, `XᵀWX` bilden und lösen) statt `lstsq` — 79→56 ms, größte Abweichung in `beta` 3,2e-12, in den Residuen-Blöcken 3,4e-12. Nur mit ausdrücklichem Okay und dann als eigene, geprüfte Änderung. |
| B17 | P1 | **21-Tage-Backtest je Tag cachen statt je Lauf** | Gemessen: eine zusätzliche Stunde Live-Daten am selben Tag ändert den Backtestbericht **nicht** (Kennzahlen, Vergleichszeilen und die 21 Fold-Origine identisch). Grund: alle Folds enden vor der heutigen lokalen Mitternacht, ihre Trainingsfenster und Wahrheiten liegen vollständig in der Vergangenheit; die +3-d/+7-d-Fenster der letzten Folds sind Zukunft. Der Bericht hängt also nur am lokalen Endtag und an den **vergangenen** Eingabedaten (Archiv-Nachholung, Lückenfüllung). Ziel: Cache je (Station, Kraftstoff, Endtag, Fingerabdruck der Eingabedaten bis Endtag) unter `runtime/engine/`; Treffer überspringt 21 Folds × (1 Fit + 3 Prognosen) = 86 % der CPU-Zeit eines Laufs, Fingerabdruck-Wechsel rechnet neu. Ehrlich ausweisen (`backtest_computed_at`/`backtest_cached`) statt Alter verschweigen; Test „gleicher Tag, neue Stundendaten → gleicher Bericht“ und „gapfill in der Vergangenheit → neuer Bericht“. |
| B18 | P1 | **Dauerhaftes `partial` löst stündlichen Voll-Lauf aus** | `Scheduler.next_delay` und `worker.finish` setzen 3600 s, sobald der Zustand nicht `success` ist. Eine dauerhaft unfitbare Station (im Log jeden Lauf „Gütersloh – GTB-Tankstelle, Isselhorster Str. 10-12 · fit24 – Fehler“, Grund `insufficient_or_invalid_training_data`) hält den Zustand auf `partial` → der 8–11-minütige Lauf wiederholt sich **24×/Tag** (Log: Ende 13:48:01 → Start 14:48:03, exakt 3600 s). Ziel: dauerhafte von flüchtigen Ursachen trennen — „Station hat strukturell zu wenig Historie“ darf keinen Stundentakt auslösen (Backoff auf `INTERVALS`, eigener Fehlercode je Station, Alarm/Checkliste statt Wiederholung); gehört zu A12 (Station-Lebenszyklus: tote Stationen fallen aus Polling-Set und Ranking). `tests/test_app_jobs.py` erwartet heute `partial` und 3600 s — mitziehen, nicht umbiegen. |
| B19 | P2 | **Prozess-Pool: eine Phase, explizite Startmethode, schlankere initargs** | Das Image baut auf `python:3.14-slim-bookworm`; seit 3.14 ist `forkserver` die Default-Startmethode (gh-84559), `app/model_jobs.py` legt keine fest — **auf der Zielhardware am 12.09.2026 bestätigt** (`get_start_method()` im Container `tankapp-web-app-1` = `forkserver`). Messung mit denselben Daten und 8 Workern: Pool-Start inklusive initargs **0,03 s (fork) gegen 1,3–1,8 s (forkserver)**, und `app/refresh.py` baut **zwei** Pools je Kraftstoff (Phase A fit, Phase B wide/backtest) — im NAS-Log sichtbar als 17 s bis zum ersten Task-Ergebnis von Phase A. Privat-Speicher (PSS) je Worker 105 MB (fork) gegen 150 MB (forkserver), weil `series_map` (30,6 MB gepickelt, alle 20 Stationen, obwohl ein Task genau eine braucht) je Worker privat entpackt wird: 8 Worker ≈ 0,8–1,2 GB, dazu 32 MB Pfade plus `nanquantile`-Temporäres je wide168-Task. Ziel: ein Pool für beide Phasen; Startmethode explizit wählen (der Job-Prozess `python -m app.worker` ist single-threaded, `fork` ist dort sicher — sonst forkserver mit Datentransfer als `.npy` in `/dev/shm` + `mmap_mode="r"`); initargs auf die wirklich gebrauchten Spalten reduzieren; Pfade ggf. `float32`; Worker-Zahl an `nproc` der Zielhardware ausrichten und die gemessenen Werte in [docs/BETRIEB.md](docs/BETRIEB.md#modell-lauf-beschleunigen) belegen. Ergänzt B11; die Worker-Zahl selbst ist B23 — auf der Zielhardware 4 Kerne und damit 4 Worker, also korrekt, der Aufwand hier skaliert mit 4 statt 8. Auf dieser Hardware kostet der doppelte Pool rund 1,3–1,8 s je Phase und ~0,6 GB Privat-Speicher bei 4,2 Gi verfügbarem Host-Speicher: Feinschliff und Robustheit, **kein** Durchsatz-Hebel. Durchsatz kommt aus B15/B16 (bitgleich) und B17 (Tages-Cache). |
| B20 | P2 | **Verschenkte Arbeit in den Tasks** | Vier Punkte, alle ohne Änderung der Ergebnisse: (1) `app/model_jobs.py::_run` fittet auch für `kind="backtest"`, obwohl `app/refresh.py` das Modell ausschließlich aus Phase A liest (`fitted[identity]["model"]`) — Fit und zurückgeschicktes Artefakt (101 kB je Task) sind tot, ebenso `model` in `wide`-Ergebnissen. (2) `engine/backtest.py::run_backtest` ruft `predict` für das +3-d/+7-d-Fenster auf, **bevor** es prüft, ob dort Beobachtungen liegen — 8 von 63 Aufrufen je Station (13 %) enden sicher in `no_common_observations`; eine Vorab-Prüfung `h_observed.any()` ist bitgleich. (3) fit24/wide72/wide168 fitten dreimal dieselbe Station zum selben Cutoff — Fit plus beide Horizonte in einem Task spart zwei Fits je Station (Load-Balance beachten: `backtest` bleibt eigener Task). (4) `_records` baut je Zeile ein dict plus `isoformat()` über `index.map(lambda …)`; für die Publikation genügen die vorhandenen `HORIZON_COLUMNS`. (5) `run_tasks` holt Ergebnisse strikt in Einreichreihenfolge ab (`for _task, future in futures: future.result()`), der Fortschritt meldet also Fertigstellung in Task-Reihenfolge und nicht in Wahrheits-Reihenfolge — im Log sieht das aus wie ein Hänger (Task 21/22 kommen, dann 72 s Stille bis `backtest21`), und die `eta_s`-Schätzung erbt denselben Fehler. `as_completed` für `on_done` plus Ergebnisliste weiter in Task-Reihenfolge macht die Anzeige ehrlich, ohne die Publikation zu ändern. |
| B21 | P2 | **Selektion läuft doppelt und überschreibt das Artefakt** | `refresh()` rechnet δ̂ je Kraftstoff und schreibt `runtime/selection/{fuel}.json` plus `current.json`; `worker.execute("models")` ruft danach `build_selection()` erneut auf und überschreibt `current.json` mit einer anders aufgebauten Datei. Im Log: erste Selektion 0,13 s (Ergebnis nur im stdout-Log, nicht im Fortschritt), zweite 0,7 s mit „e10: **0 Stationen**“ und Fortschritt „2/1“ bei `total=1`. Zu klären: warum `top_global` leer ist (Eingabedaten, `min_coverage=0.85`, oder stiller Fehler im ersten Aufruf), welche der beiden Rechnungen die publizierte sein soll, ob die zweite entfallen kann, und ob „Meine Stationen“ in der GUI heute aus `by_fuel` oder aus `stations` liest. Fortschrittszähler darf nicht über `total` laufen. |
| B22 | D | **Zahlen-ändernde Hebel: `bootstrap_samples` und Nacht-Raster — Entscheidung, kein Gratishebel** | Nach B15/B16 nicht mehr nötig; falls trotzdem gewollt: 2000→500 Ziehungen halbiert die Backtest-Zeit (24,3→9,6 s), verschiebt aber die publizierten Kennzahlen (Messung, eine Station: MASE 2,1059→2,0939, PICP 55,82→54,63 %, MPIW 1,866→1,830 ct, MAE 1,3590→1,3509 ct). Also Produktentscheidung mit eigener Konfiguration (`bootstrap_samples_backtest`) und Ausweis im Bericht — keine stille Änderung an einer Zahl, die ein Gate (§4.4) prüft. Zweiter Hebel derselben Klasse: `predict(hours=72/168)` rechnet das **volle** 5-Minuten-Raster inklusive Nachtstunden, obwohl der Collector nur 06–24 Uhr pollt und die Nachtzellen mangels Residuen-Unterstützung überwiegend NaN sind — mit `scheduled()`-Filter wären das 25 % weniger Punkte (168 h: 2016→1512). Ändert die publizierten `points_3d`/`points_7d` und damit den Fan-Chart, also erst entscheiden, ob die GUI die Nachtstunden braucht. |
| B23 | P2 | **Worker-Zahl hängt an `os.cpu_count()` (ignoriert Affinität/Quota) — latent, heute ohne Wirkung** | Zielhardware-Messung 12.09.2026: Host **und** Container sehen 4 Kerne (J5040), `CpusetCpus` leer, `NanoCpus=0`, `CpuQuota=0`, `os.cpu_count()`/`os.process_cpu_count()`/Affinität = `4 / 4 / 4` → `resolve_workers` liefert 4; es gibt derzeit **keine** Fehlzuordnung, der Pool arbeitet sinnvoll. Eingebaut ist der Fehler trotzdem: `os.cpu_count()` meldet die Host-Kerne und ignoriert CPU-Affinität sowie cgroup-`cpu.max`. Sobald der Container gepinnt oder mit einer Quota belegt wird (unRAID-CPU-Pinning, `--cpuset-cpus`, `deploy.resources.limits.cpus`), startet die App weiter bis zu 8 Worker auf weniger Kernen — dann ohne Durchsatzgewinn, aber mit vollem Speicher- und initargs-Aufwand (B19). Ziel: `os.process_cpu_count()` (seit Python 3.13) statt `os.cpu_count()`, zusätzlich `cpu.max`/`NanoCpus` auswerten, plus Test „2 nutzbare bei 8 gemeldeten Kernen ⇒ 2 Worker“. **Messfalle, damit sie niemand wiederholt:** `nproc` im Container meldete `1`, obwohl 4 Kerne nutzbar sind — das Image setzt `OMP_NUM_THREADS=1` ([ops/nas/app/Dockerfile](ops/nas/app/Dockerfile), Zeile 11), und GNU `nproc` ehrt diese Variable (im Sandkasten nachgebaut: `nproc` = 2, `OMP_NUM_THREADS=1 nproc` = 1, Affinität unverändert). Kerne deshalb immer über die Affinität bestimmen, nie über `nproc`. **Fehlberatung aus derselben Messung, ausdrücklich zum Rückgängigmachen:** auf Basis der `nproc`-Zahl wurde `TANKAPP_MODEL_WORKERS=1` gesetzt. Das ist auf 4 Kernen eine Verschlechterung — `run_tasks` nimmt den seriellen Pfad, baut keinen Pool, die Wandzeit steigt grob um den Faktor 4 und damit vermutlich über das 3600-s-Intervall aus B18 (überlappende Läufe). Zurück auf `0` (automatisch = 4) oder bewusst `2`/`3`, wenn andere Dienste auf dem NAS Vorrang haben; Gegenmessung mit `docker stats` bzw. `docker top` während der Fit-Phase, nicht im Leerlauf. |

**Offene Diagnose aus demselben Log (kein eigener Punkt, gehört zu B18/B19/B23):**
um 14:48:03 startete ein Lauf und brach nach Task 20/80 (14:48:59) ohne
`beendet`-Zeile ab; um 14:49:22 startete ein zweiter, der 11,2 min lief. Zwei
überlappende Modell-Läufe verdoppeln die Last. `Scheduler.run_once` wartet auf
das Ende des Kindprozesses, der zweite Lauf kann also nur von einem Neustart des
App-Prozesses kommen (der Scheduler startet den ersten Job sofort) oder von einer
zweiten App-Instanz. Der Abbruch lag zeitlich genau auf dem Pool-Wechsel zu
Phase B, wo 8 neue Worker je ~150 MB Privat-Speicher anfordern; ein OOM-Kill war
die naheliegendste Erklärung.

Stand nach der Messung auf der Zielhardware (12.09.2026): **ausgeschlossen** sind
ein OOM-Kill des Containers, ein Container-Neustart und ein Kernel-OOM überhaupt
(`OOMKilled=false`, `RestartCount=0`, `HostConfig.Memory=0`, `dmesg` ohne
Treffer, 4,2 Gi verfügbar). Damit ist auch der Erklärungsversuch „Phase B fordert
8 × ~150 MB an und der Speicher geht aus" vom Tisch — zumal auf dieser Hardware
4 Worker starten, nicht 8 (Zielhardware-Tabelle oben). Ehrliche Einschränkung: ob
der `dmesg`-Ringpuffer überhaupt bis 14:48 zurückreicht, ist nicht geprüft
(`dmesg -T | tail -2` zeigt die jüngste Zeitmarke). Weiter offen, in dieser
Reihenfolge: (1) lief der App-Prozess im Container neu an — `tankapp.py nas-up`,
manueller Restart, Datei-Änderung mit `--reload`? Das beendet einen laufenden Job
ohne `beendet`-Zeile, und der Scheduler startet beim Anlaufen sofort den nächsten;
das Muster „Abbruch 14:48:59 → neuer Lauf 14:49:22" (83 s) passt dazu. Der
Beweis über `State.StartedAt` ist allerdings verloren: das `nas-up` vom selben Tag
hat den Container neu erzeugt. (2) Läuft eine zweite App-Instanz?
(3) Warf der Job-Prozess eine Ausnahme, die nicht als Fehlerzustand verbucht
wurde? Dann stünde ein Traceback im Log. Zu prüfen — am besten **vor** dem
nächsten Lauf, weil beide Dateien weitergeschrieben werden:
`cat data/runtime/jobs/models.json` (letzter Zustand mit `started_at`/`finished_at`),
`grep -n "14:4[5-9]\|14:5[0-2]" data/runtime/jobs/models.log` (eigenes Job-Log,
letzte 500 Zeilen, unabhängig von Docker),
`docker logs --since 2026-09-12T14:47:00 --until 2026-09-12T14:52:00 tankapp-web-app-1`
(Container-Logging ist auf 2 × 5 m begrenzt, möglicherweise schon rotiert),
`docker ps --format '{{.Names}}' | grep -i tank` (Instanzen zählen) und
`docker top tankapp-web-app-1` während eines Laufs — `ps` fehlt im Image
`python:3.14-slim`, deshalb `docker top` statt `docker exec … ps`.

**Erwartete Wirkung, wenn B15+B16 zusammen umgesetzt sind (gemessen, ein Kern):**
28,3 s → 5,2 s je Station, also 9,4 min → 1,7 min CPU für 20 Stationen
(**5,4×**); der Backtest-Anteil fällt von 86 % auf 62 %. Mit B17 (Tages-Cache)
bleiben in einem untertägigen Lauf noch 37 s CPU statt 80 s, und mit B18 läuft
der teure Lauf einmal am Tag statt 24×. Reihenfolge: erst B15+B16 (bitgleich,
kein Architektur-Eingriff, sofort messbar), dann B18 (kleinste Änderung mit
größter Betriebswirkung), dann B17 (Cache-Schlüssel und Ehrlichkeits-Ausweis
brauchen einen Entwurf), dann B19/B20/B21.

---

## C. GUI / UX

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| C2 | P1 | **Stamm-Stationen pinnen + Suche/Filter/Sortierung** | „Meine Stationen“ lebt nur in der Werkstatt; im Alltag will der Nutzer seine 2–3 Stammstationen oben sehen. Liste bei 20+ Stationen (Frankfurt-Radius) ohne Suche/Markenfilter/Sortierung (Preis, Distanz, Netto-€). Lokal speicherbar, kein Account nötig. |
| C3 | P2 | **Karten-/Umgebungsansicht für F2** | „Hier oder woanders?“ als Karte mit Netto-€-Pins. OSM-Tiles brauchen Internet (im LAN okay, wenn NAS/Handy online); Alternativen: statische Tile-Region oder reduzierte Luftlinien-Übersicht. |
| C4 | P2 | **Einstellungen-Tab zentral** | Verbrauch, Zeitwert (manuell/auto), Liter-Default, Kraftstoff, Stadt liegen verteilt in Panels. Ziel: ein Tab „Einstellungen“: alle Defaults inkl. aktiver Schwellen-Tabelle (read-only aus `/api/v1/stats/summary → thresholds`), Dark/Light-Umschaltung (Fallback-GUI kann dunkel, NAS-GUI nur dunkles Slate). |
| C5 | P2 | **Barrierefreiheit-Runde, Rest** *(Fokus-Ring + Charts-Textfassungen sind drin, 0.13.0)* | Erledigt: Ampel-Chip mit Symbol (▲/▼/●/→) und Slider mit `aria-valuetext` (0.10.0); Fokus-Ring durchgängig (die `outline-none`-Überschreibungen an den 0.11-Eingabefeldern sind entfernt) und alle Charts `role="img"` **mit** `aria-describedby`-Textfassung (0.13.0), `prefers-reduced-motion` war schon in `styles.css`. Offen: Touch-Targets ≥ 44 px, Kontraste AA prüfen, komplette Bedienung per Tastatur (Beleg buchen ohne Maus). |
| C7 | P2 | **Hilfe/Glossar-Layer** | δ̂, MASE, PICP, Brier, ε, Regret — Werkstatt-Begriffe ohne Erklärung in der App. Ziel: i-Tooltips + eine kurze „Was heißt das?“-Seite (kann auf docs/ANALYSE.md-Anker verweisen), Begriffe konsistent zur Doku. |
| C8 | P2 | **Mobile-Feinschliff & PWA** | Sticky-Aktions-Chip im Alltag („Jetzt tanken / Warten bis …“ beim Scrollen sichtbar), Install-/„Zum Homescreen“-Hinweis (manifest ist da, Prompt fehlt), Landscape-Layout der Tageskurve prüfen, Pull-to-Refresh dort unterdrücken, wo er mit Karten-/Slider-Gesten kollidiert. |

---

## D. Code-Wartbarkeit (Voraussetzung für C-Features)

| # | Prio | Fehlt | Details |
|---|---|---|---|
| D4 | P2 | **Qualitäts-Gates in CI: Lighthouse + Last** | M4-Kriterium „Lighthouse > 90“ nie gemessen; kein Last-Test, ob das GUI-Polling (B7) unter dem Rate-Limit bleibt. Ziel: Lighthouse-CI-Job mit Budget, kleiner K6-/Autocannon-Pfadtest gegen den Docker-Stack. |

---

## E. Funktional & Eingabe (Prüfstrang 2: „Funktioniert der Kern, kann man eingeben?“)

Vorab — **verifiziert funktionsfähig** (kein Task, zur Einordnung): Alle Schreibpfade
existieren und sind mit der GUI verdrahtet: `POST /fills` (Validierung 5–100 L,
0,40–5,00 €/L, unbekannte Station → `unknown_station`, Nowcast-Zufall — seit
0.11.0 prüft die GUI dieselben Grenzen **vor** dem Roundtrip und bucht ohne
gewählte Station gar nicht erst, E3/E4),
`POST /episodes/{id}/intent`, `POST /jobs/{job}/run` (Startknopf), `POST /collector/heartbeat`,
`POST /jobs/trigger` (HMAC). Server-Statuscodes 4xx, GUI prüft `error_code` vor
Erfolgsmeldung. Fallback-GUI (rp2): Liter-Eingabe geclampt 5–100 und persistent.

Die Prüfpunkte dieses Abschnitts (E1–E7) sind abgearbeitet — E2 in 0.10.0,
E3/E4/E5/E6/E7 in 0.11.0; nachvollziehbar im
[CHANGELOG](CHANGELOG.md#0110--2026-09-12). Neue Eingabefehler hier bitte mit
demselben Muster melden: Befund, Grenze, Definition of Done.

## F. App-Texte & UX-Sprache (Prüfstrang 2)

| # | Prio | Befund | ToDo |
|---|---|---|---|
| F3 | P2 | **Typografie** *(Regelwerk + Zitate erledigt, 0.16.0)* | Erledigt: [docs/MICROCOPY.md](docs/MICROCOPY.md) — eine Seite, verlinkt aus `docs/README.md`, Repo-`README` und `AGENTS.md`: Tonfall, `„…“`-Zitate, Sonderzeichen, **Regel Niveaus in €/L, Differenzen in ct/L**, Uhrzeiten Europe/Berlin, Benennungen, Leer-/Lade-/Fehlermuster, „was nie im Text steht“; Ratchet `web/src/microcopy.test.ts` (paarige `„…“`, kein `”`, keine HTML-Entities) plus einmalige Bereinigung der gemischten Zitate in Doku und CHANGELOG. Die **inhaltliche** ct/L-€/L-Wahl je Panel ist mit 0.19.0 durchgezogen (C9-Rest). Offen: die Fachlabel-vs.-Hook-Zeilen im Footer an das Regelwerk angleichen. |
| F4 | P2 | **Intent-Leiste zeigt immer alle 4 CTAs** („Ich warte / Navigieren / Jetzt tanken / Verwerfen“) — bei Aktion `refuel_now` ist „Ich warte“ als gleichrangiger CTA irritierend; bei `wait` ist „Jetzt tanken“ irritierend. | Empfohlene Aktion als primären Button, kompatible Intents sekundär, widersprechende Intent mit Erklär-Tooltip (Logik ändert nichts, nur Sichtbarkeit/Gewichtung). |
| F5 | P2 | **Sonst sauber geprüft:** Fehlertexte in `web/src/data.ts` (`messages`) durchgehend sachlich-deutsch ohne erfundene Inhalte ✓; Fallback-GUI-Texte konsistent ✓; keine Demo-/Lorem-Reste ✓; Ladezustände einheitlich formuliert („… wird geladen/berechnet“). | Kein Task — als Referenz in das F3-Regelwerk übernehmen. |

## G. Storage-Management: rp2/Pi & NAS (Prüfstrang 2)

| # | Prio | Befund | ToDo |
|---|---|---|---|
| G4 | P2 | **`/tmp/tankapp_cache` überlebt keinen Reboot** → Fallback-GUI zeigt nach Pi-Neustart bis zum ersten erfolgreichen Fetch „keine Prognose“. Ehrlich, aber unerwartet. | Wie geht man damit um? |

## H. Mathematik (Prüfstrang 2: „muss mathematisch was getan werden?“)

Kurzantwort: **kein Rechenfehler gefunden** — Formeln (Umweg-`K`, Netto-€, `p_besser`/`p_lohnt` aus Draws, Settlement gegen beobachtete Minima, PAVA/12-Uhr ist bekannt sauber). Die offenen mathematischen Punkte sind **Konsistenz und dokumentierte Ausbauten**, keine Bugs:

| # | Prio | Befund | ToDo |
|---|---|---|---|
| H3 | D | **M7-Tuning-Regler ohne Oszillationsschutz dokumentiert:** Schwellen-Vorschlag begrenzt Schritte, aber Zusammenspiel von Schrittweite, Mindest-Abstand zwischen Anpassungen und n-Basis (n ≥ 25) ist nicht als Regel festgeschrieben — bei kleinen Stichproben können Schwellen pendeln. | Kurze Methodik-Notiz + Hysterese (nur ändern, wenn \|Δ\| > Rauschband) in `app/thresholds.py` + Test „stabile Schwellen bei Rauschdaten“. |
| H4 | D | **Weiterhin offen (bereits gelistet, hier qualifiziert):** M3-Zweitmodell/Ensemble, gemeinsame Bootstrap-Ziehung über Stationen (§4.2) und w(h)-Rückkopplung ab ≥8 Füllungen. | Bleiben A9–A11 mit Datenbedarf; Reihenfolge nach M7-Fortschritt (A7). |
| H5 | P2 | **DST-Kante `seasonal_scale`:** bei Zeitumstellung kann der Vortages-Anker `NaT` liefern → MASE `None` an ~2 Tagen/Jahr (korrekt als None, kein falsches Ergebnis). | Backtest soll DST-Tage explizit behandeln (ausschließen oder 23/25-h-Tage normalisieren) + Randnotiz in docs/ENGINE.md, statt stillem `None`. |

---

## Quick Wins (jeweils ≤ ½ Tag, ohne Architektur-Abhängigkeit)

> Status: **14 von 14 umgesetzt** (Version 0.10.0). **B6/H1**
> (Umweg: Server als einzige Quelle von Strecke und Schwellen) ist jetzt drin:
> Server liefert `detour_km_est`, `dist_mode`, `verdict`/`worth_it` + Schwellen,
> GUI rechnet nicht selbst (kein `haversineKm*CIRCUITY`, keine 1,50/0,50-Konstanten).

1. ✅ **A3** Storno-Flag für Fills (`DELETE /fills/{id}` → `voided`, Audit-Zeile) + Button im Wallet.
2. ✅ **A6** CSV-Export `GET /api/v1/fills.csv` + Download-Link im System-Tab.
3. ✅ **B1** Eine Zeile Backup-Skript für `runtime/` + Restore-Absatz in BETRIEB.md.
4. ✅ **B4** `alarms[]`-Array in `/health` (nur Aggregation vorhandener Prüfungen) + roter Punkt im Header.
5. ✅ **B6/H1** Umweg: Server liefert `detour_km_est` **und** `verdict`/Schwellen; GUI-Eigenrechnung raus (0.10.0).
6. ✅ **B9** Version/Commit in `/health` + Footer-Anzeige.
7. ✅ **C1** Einrichtungs-Checkliste als Daten-getriebene Karte (Status kommt aus vorhandenen Endpunkten).
8. ✅ **C5** Zwei schnelle A11y-Fixes: Ampel-Chip mit Symbol (▲/▼/●) statt nur Farbe, Slider-`aria-valuetext` in €.
9. ✅ **D2** Eine Playwright-Spec „decide → intent → fill → due“ mit Mocks — schützt alle V3-Fixes.
10. ✅ **A7** Fortschritts-Kachel „M7: n/100 Settlements, Brier x (Ziel < 0,25)“ — Daten liegen in `/stats/summary` schon vor.
11. ✅ **E2** Komma-Eingabe: `inputMode="decimal"` + `,`→`.`-Normalisierung im Beleg-Dialog.
12. ✅ **G1** `cache.log`-Cap (20 Zeilen Code) — stoppt unbegrenztes Wachstum auf dem RP2.
13. ✅ **F1** Tab-Label „Statistik“ → „Werkstatt“ (inkl. Sekundär-Texte) — eine Zeile Code + Terminologie-Commit.
14. ✅ **C10** Tages-Zeilen + Fazit-Satz unter der Heatmap — reines Frontend, die 7×24-Matrix liegt bereits vor.

---

## Quick Wins 0.11 – Kandidaten (jeweils ≤ ½ Tag, ohne Architektur-Abhängigkeit)

> Status: **7 von 7 umgesetzt** (Version 0.11.0). Es waren die kleinen
> Ehrlichkeits-/Bedienbarkeits-Fixes nach 0.10.0 — alle ohne Architektur-Umbau,
> alle testbar. Die Nachfolger stehen unter der Liste.

1. ✅ **B13** Build-Commit im Docker-Image: `tankapp.py nas-up` setzt `TANKAPP_BUILD_COMMIT=$(git rev-parse --short=12 HEAD)` als Build-Arg + Env, `compose.yml` + `Dockerfile` übernehmen es, `/health` liefert `commit` nicht mehr null (0.11).
2. ✅ **E3/E4** Beleg-Eingabe ehrlich: Grenzen (5–100 L / 0,40–5,00 €/L) stehen gemeinsam in `web/src/data.ts::FILL_LIMITS`, geprüft wird vor dem Roundtrip direkt am Feld; „Beleg buchen“ ist ohne gewählte Station deaktiviert + Hinweis „Station wählen“ (0.11). Statt `min`/`max`/`step`-Attributen am Komma-Textfeld (E2) wirken die Grenzen im Code — Attribute ohne Effekt an einem Textfeld wären die größere Lüge.
3. ✅ **E5** `heatmapWeeks` wählbar: Wochen-Select 4/6/12 neben „Heatmap Art“, `setHeatmapWeeks` verdrahtet, Default 6 Wochen, `weeks=` bleibt URL-Param (0.11).
4. ✅ **E6** Slider-Präzision: Verbrauch `step=0.5`, Liter `step=1`, Zeitwert `step=0.5` — jeweils mit Begleit-Zahlenfeld (6,3 L/100 km wählbar), `aria-valuetext` in €/h bleibt (0.11).
5. ✅ **B12** Cheap-Prob ohne Station: `basis=hour` rechnet gegen den Median derselben Stunde (Spalten-Basis), GUI-Default ohne Station, Umschalter + Begründung in `docs/ANALYSE.md`; API-Default `overall` unverändert (0.11).
6. ✅ **G2** Journal-Wachstum rp2: Drop-in `rp2/journald.conf.d/50-tankapp-journal.conf` (`SystemMaxUse=50M`) + `journalctl --vacuum-size=50M` als Wartungsschritt, Anleitung in `docs/RP2.md` (0.11).
7. ✅ **E7** API-Explorer „day (Beispiel)“: erscheint nur bei gewählter Station, sonst grauer, deaktivierter Knopf mit Hinweis „erst Station wählen“ (0.11).

**Kandidaten 0.13 — Ergebnis der Kalibrierung (Befunde gegen den Code geprüft),
umgesetzt in 0.13.0; der Rest der Liste bleibt stehen:**

1. ✅ **A6 (Rest)** Share-URL: `?city=…&fuel=…&station_id=…&liters=…` wird beim
   Start in die Preferences übernommen; zusätzlich setzt der Teilen-Knopf die
   aktuelle Sicht in die Adresszeile und kopiert sie. Seit 0.11 zwingend auch
   für `heatmapWeeks`/`heatmapBasis` — beides ist inzwischen echte Preference,
   ohne Übernahme würde eine geteilte Ansicht falsch wiederhergestellt (0.13).
2. ⚠️→✅ **C5** — der 0.11-Kandidat „zwei CSS-Zeilen“ war **falsch**: Fokus-Ring
   (`:focus-visible`) und `prefers-reduced-motion` standen schon in
   `styles.css`; der echte Rest war, dass `outline-none`-Klassen den Ring an
   genau den Feldern überschrieben, die 0.11 angefasst hat — plus Charts mit
   `aria-describedby`-Textfassung (0.13). Übrig bleiben 44 px/AA/Tastatur.
3. ✅ **F2 (kleinster Schnitt)** Deutsche Primär-Labels für die
   Jargon-Stellen in der Werkstatt: „Wahrscheinlichkeit für günstig“ statt
   „Cheap-Probability P(p ≤ Median)“, „Ampel-Stärke“ statt „AV-Score“,
   „Preis-Abstand“ statt „δ̂ Ranking“, „Prüfzeitraum“ statt „Out-of-Sample“,
   „Ø Mehrkosten“ statt „Ø Regret“; Fachwort und Formel stehen jetzt im
   `title`/Tooltip (0.15).
4. ✅ **C9** Formatierungs-Satz in `data.ts` (€/L drei Nachkommastellen,
   ct/L eine, Uhrzeiten immer Europe/Berlin) plus vitest-Test gegen Mischnutzung:
   `euroPerLiter`, `centPerLiter`, `percentLabel`, `countLabel`, `hourRangeLabel`
   sind gebaut und getestet (0.14), Heatmap **und** alle übrigen Anzeigen
   (Dashboard, LineChart, LabCharts) nutzen sie, `format-convention.test.ts`
   hält neue `toFixed`-Anzeigen auf (0.15). Übrig: ct/L-€/L-Wahl je Panel und
   Uhrzeiten-Check (F3).
5. ✅ **C6** Gemeinsame Zustände pro Panel: Fehler (`components/LoadError.tsx`,
   0.15), dann Skeletons, Datenstand-Banner und Tabellen-Fehler
   (`Skeleton.tsx`/`DataAge.tsx`/`CellError.tsx`, 0.17) und zuletzt die
   Datenreichweite in Preisverlauf, Modell-Ausblick und Ranking
   (`DataReach.tsx` + `range_*`/`n_points` in `series`/`forecast`/`selection`,
   **C11**, 0.18). Damit ist C6 vollständig.
6. ✅ **D3** Property-Tests für die Umweg-Ökonomie (`K = d·(c/100)·p +
   (d/v)·z`): `web/src/data.property.test.ts` (fast-check, 300 Läufe je
   Eigenschaft, fester Seed) prüft Identität Netto = Brutto − Sprit − Zeit,
   Monotonie in Litern/km/Verbrauch/Geschwindigkeit/Zeitwert, Break-even
   `criticalCtPerL`, Grenzfälle `z = 0`, `d = 0`, `liters→∞`, `v ≤ 0` und die
   `worth_it`-Schwellen inkl. exakter Kanten (0.15). Reine Tests, kein
   Produktcode — schützt die 0.10.0-Umstellung auf Server-only-Strecke.

---

## Erledigt — hier gestrichen, im CHANGELOG nachvollziehbar

IDs bleiben stabil, damit Commits, Tests und Code-Kommentare weiterhin lesbar
sind. Vollständig erledigt und aus den Tabellen oben entfernt:

| Version | Punkte |
|---|---|
| 0.19.0 (12.09.2026) | **B7** (Rest) Alltags-Aggregat `GET /api/v1/overview` (`DataApi.overview()`: `decide` + `fills` + `stats/summary` + due-Episoden + 24-h-Tageskurve in einer Antwort, Einzelrouten bleiben unverändert; unbekannte Station entlädt nur `day`) — der Alltagstabs läuft damit auf einer Anfrage statt sechs Parallel-Polls; dazu `useResource` ohne Abbruch (Refresh reih ein Reload ein statt laufende Requests umzuwerfen), Fehlerbanner erst nach zwei aufeinanderfolgenden Fehlversuchen, solange Daten angezeigt werden (`resourceErrorVisible`), und Revalidierung per ETag/304: `data_version()` aus Datei-Stats + 60-s-Uhrzeit-Fenster, `If-None-Match` → 304 ohne Compute, Antwort-Cache je (Datenstand, Parameter) — ein Refresh kostet damit fast immer Millisekunden; **D1** (Rest) Views-Schnitt: `views/Daily.tsx` / `views/Statistics.tsx` / `views/System.tsx` mit typisierten Props (Zustand bleibt in `Dashboard`, ~4 700 → ~1 600 Zeilen) + `components/JobCard.tsx`; **C9** (Rest) ct/L-€/L-Wahl je Panel durchgezogen, Uhrzeiten auf Europe/Berlin geprüft, Anführungszeichen über den F3-Ratchet. Bewusst offen: `route/evaluate` bleibt ein eigener Poll (Ausklinken ist Follow-up) |
| 0.18.0 (12.09.2026) | **C11** Datenreichweite in den übrigen Panels: `/api/v1/series` liefert `range_from`/`range_to`/`n_points` (nur Punkte **mit** Preis — geschlossene Meldungen sind Beobachtungen, kein Bestand), `/api/v1/forecast` reicht die Fit-Reichweite aus dem Modell durch (`training_start`/`last_observation`/`training_points`/`training_days`, neu in `app/refresh.py` publiziert), `/api/v1/selection` die Ranking-Reichweite je Kraftstoff (neu in `engine/selection.py` berechnet, je Stadt und aggregiert). Frontend: `dataReachLabel` in `data.ts` + `components/DataReach.tsx` — dieselbe Zeile und Beschriftung wie in der Heatmap, kein Rendern ohne Angaben. Tests: drei in `test_app.py`, einer in `test_b3.py`, vier in `components/states.test.tsx` |
| 0.17.0 (12.09.2026) | **C6** (Rest) einheitliche Zustände: Skeletons (`components/Skeleton.tsx` — `SkeletonPanel`/`SkeletonChart`/`SkeletonRows`, nur beim ersten Laden, `role="status"`+`aria-busy`) in acht Panels, „Datenstand älter als X“-Banner (`components/DataAge.tsx` + `STALE_AFTER_MINUTES`/`freshness`/`ageLabel`/`dataAgeNote` in `data.ts`: Preise 30 min, Modell 180 min, Selektion 36 h, doppelte Schwelle = roter Ton, kein Banner ohne bekannten Stand) über Tab-Inhalt, Modell-Ausblick, Heatmap und Ranking, Fehler in Tabellenzellen (`components/CellError.tsx`, Leerstand vs. Fehler getrennt) im Scoreboard und bei den Tages-Entscheidungen; Tests `data-age.test.ts` + `components/states.test.tsx`, beide Ratchets erweitert |
| 0.16.0 (12.09.2026) | **B4** (Rest) Alarm-Zustellung im System-Tab sichtbar (Kachel „Alarm-Zustellung · Push aufs Handy“: Badge, Klartextsatz, offene Codes als Chips, „Zuletzt gemeldet“/„Zuletzt Entwarnung“; Texte als reine Funktionen `notifyTone`/`notifyStatusLine`/`notifyLastLine` in `web/src/data.ts` mit `notify.test.ts`; serverseitig nur ein neues Feld `notify.last_sent_at`), **B14** `docs/analysis/` → `data/analysis/` (Default in `app/config.py`, `tankapp.py`, allen `data-tools/`-CLIs, `analysis/*`, `ops/nas/preflight.sh`, RP2-Suchpfaden und der Doku; alter Pfad bleibt gültig, solange nur er existiert, mit Hinweis je Prozess — kein stiller Umzug; `tests/test_analysis_path.py`), **F3** (Rest) Microcopy-Regelwerk `docs/MICROCOPY.md` + Ratchet `microcopy.test.ts` + Zitate vereinheitlicht |
| 0.15.0 (12.09.2026) | **F2** Deutsche Primär-Labels in der Werkstatt („Wahrscheinlichkeit für günstig“, „Ampel-Stärke“, „Preis-Abstand“, „Prüfzeitraum“, „Ø Mehrkosten“, „q-Wert“, „95-%-KI“, „Billigste Stunde“, „Sprungfreie Tage · MASE“, „Drift-Status · CUSUM“, `aria-label` „Rückmeldung nach Fensterende“), Fachwort/Formel jeweils im Tooltip; **D3** Property-Tests Umweg-Ökonomie (fast-check gegen `detourEconomics`/`detourVerdict` in `web/src/data.ts`: Identität Netto = Brutto − Sprit − Zeit, Monotonie in Litern/km/Verbrauch/Geschwindigkeit/Zeitwert, Break-even `criticalCtPerL` exakt, Grenzfälle `z=0`/`d=0`/`liters→∞`/`v≤0`, `worth_it`-Schwellen inkl. exakter Kanten), **B4** ntfy-Zustellung für `severity: error` (`app/notify.py`, ein Webhook `TANKAPP_NTFY_URL`, Zustandswechsel statt Dauerschleife, `/health` → `notify`) — GUI-Anzeige bleibt offen, **C6** (Teil) gemeinsamer Fehler-Zustand `LoadError` in sechs Panels, **C9** (Rest) alle Anzeigen auf den Formatter-Satz umgestellt + `format-convention.test.ts` als Ratchet, **F3** (Teil) Tageszahlen ausgeschrieben, **D1** (Teil) geteilte UI-Bausteine (`components/ui.tsx`: `panel`/`Empty`/`Badge`/`Metric` + Render-Test) |
| 0.13.0 (12.09.2026) | **B2** Schema-Version + Migration des Feedback-Stores (Versionsfeld, Migration je Sprung, Test „alter 0.10-Store → neuer Code“, Doku in BETRIEB.md), **B5** Schreib-Härtung: `tanked_at`-Plausibilitätsfenster (sonst 1970/2100 im Ledger), Freitext-Caps für `station_name`/`source`, getrenntes Schreib-Budget (20/min je Client, nur Ledger-Endpunkte — GET bleibt frei), **A6** Share-URL beim Start lesen + Teilen-Knopf, **B7** (Teil) gzip für JSON + `max-age=900` für `heatmap`/`last_forecasts`, **C5** (Teil) Fokus-Ring ohne `outline-none`-Überschreibung + Charts `aria-describedby`, **D1** (Teil) `PrecisionSlider`/`HeatmapGrid`/`ApiExplorer` nach `components/` ausgelagert |
| 0.11.0 (12.09.2026) | **B12** Heatmap-Basis umschaltbar (`basis=hour` = Median derselben Stunde; API-Default `overall`), **B13** Build-Commit im Image (Doku nachgezogen), **E3** Beleg-Grenzen vor dem Roundtrip, **E4** Buchung nur mit gewählter Station, **E5** Wochen-Select 4/6/12, **E6** Slider 0,5/1 L/0,5 + Begleitfeld, **E7** API-Explorer „day“ nur mit Station, **G2** RP2-Journal-Cap (Drop-in + `--vacuum-size`) |
| 0.10.0 (12.09.2026) | **A3** Beleg-Storno, **A6** CSV-Export, **A7** M7-Fortschritts-Kachel, **B1** `runtime/`-Backup, **B4** Alarm-Block + GUI-Punkt, **B6/H1** Umweg server-only (`detour_km_est`, `dist_mode`, `verdict`/`worth_it` + Schwellen `elsewhere_net_eur`/`elsewhere_borderline_eur` M7-tunebar; GUI ohne `haversineKm*CIRCUITY`/1,50-0,50-Konstanten), **B9** Version/Commit + CHANGELOG, **C1** Einrichtungs-Checkliste, **C5** (zwei A11y-Fixes), **C10** Heatmap-Tages-Zusammenfassung, **D2** e2e-Spec decide→intent→fill→due, **E2** Komma-Eingabe, **F1** Tab „Werkstatt“, **G1** `cache.log`-Cap, **G3** Datenverlust-Fenster benannt (docs/ARCHITEKTUR.md), Doku-Umbau `docs/` mit Index + Archiv (`docs/archiv/`) + Link-Test |

Teilweise erledigt und mit reduziertem Scope oben stehen geblieben: **C5**
(44 px, AA, Tastatur offen), **F3** (Rest: Regelwerk steht, Anwendung auf
Footer-Zeilen offen).

## Bewusst NICHT in dieser Liste

- **Login, Benutzerkonten, Rollen, Mandanten, OAuth/SSO** — LAN-only per Vorgabe.
- **DSGVO-Löschkonzept, Daten-Portabilität für Fremdnutzer, Consent-Management** — keine Fremddaten.
- **i18n über Deutsch hinaus** — Zielgruppe ist ein deutschsprachiger Haushalt.
- **Öffentliche Skalierung** (CDN, Multi-Instanz, Loadbalancer) — ein NAS, ein Haushalt.

## Reihenfolge-Empfehlung

1. **Größere C-Features (C2/C4) können jetzt anfangen** — D1 ist mit 0.19.0
   erledigt (Views-Schnitt + `JobCard`), neue Panels/Features landen in
   `views/`/`components/` statt in `Dashboard.tsx`.
2. **B7-Follow-up separat entscheiden**: `route/evaluate` (eigener Poll im
   Alltag, nur bei Alternativ-Station) ausklinken bzw. in `/overview`
   aufnehmen — erst nach einer Messung der echten Last (siehe D4).
3. **Kein P0 mehr offen** — der Heatmap-P0 vom 12.09. ist mit 0.14.0
   geschlossen, B2 (Schema-Version) seit 0.13.0;
   der nächste Store-Feldsprung braucht nur eine Migrationsfunktion nach
   `app/feedback.py::_STORE_MIGRATIONS` und ein Anheben von
   `FEEDBACK_SCHEMA_VERSION`.
4. **D-Items erst nach Live-Daten** (M7-Termin, Rabatte, Engine-Ausbau) — sie
   stehen begründet in [docs/LUECKEN.md](docs/LUECKEN.md#bewusst-offen-backlog-mit-grund).
5. **Laufzeit-Bündel — Reihenfolge nach der Zielhardware-Messung vom
   12.09.2026** (NAS: **4** Kerne J5040, kein Pinning/Quota/Limit,
   `forkserver` bestätigt, kein OOM und kein Neustart, 4,2 Gi verfügbar, kein
   Swap; `nproc` = 1 war eine Messfalle über `OMP_NUM_THREADS`, siehe B23):
   zuerst **B15/B16** — bitgleich, kein Architektur-Eingriff, gemessen 5,4×
   weniger CPU-Zeit je Station; auf 4 Kernen ist das der einzige Hebel, der die
   Wandzeit deutlich senkt (8–11 min → grob 2 min, wenn die Skalierung hält).
   **Zurückzunehmen vorher:** `TANKAPP_MODEL_WORKERS=1` wieder auf `0`
   (automatisch = 4 Worker) — seriell würde der Lauf grob 4× länger und damit
   vermutlich länger als das 3600-s-Intervall aus B18. Danach **B18** (kleinste
   Änderung, größte Betriebswirkung: der Lauf fällt von 24×/Tag auf 1×/Tag),
   dann **B17** (Tages-Cache, braucht einen Entwurf für Schlüssel und
   Ehrlichkeits-Ausweis), dann **B19–B21** (Feinschliff: ein Pool statt zwei,
   explizite Startmethode, schlanke initargs, verschenkte Arbeit, doppelte
   Selektion) und **B23** (Robustheit der Worker-Zahl gegen Pinning/Quota).
   B22 bleibt eine Produktentscheidung. Befund und Messwerte stehen im Abschnitt
   [B — Laufzeit des Modell-Laufs](#laufzeit-des-modell-laufs--befund-und-messwerte-vom-12092026-b15b23-nichts-davon-umgesetzt).
