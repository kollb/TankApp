# TankApp — ToDo (Stand 13.09.2026, App-Version 0.26.0)

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
| B11 | P2 | **Ressourcen-Abgleich Modell-Worker** | `TANKAPP_MODEL_WORKERS` bis 8 Prozesse × pandas vs. `shm_size: 256m` in [ops/nas/app/compose.yml](ops/nas/app/compose.yml) — nicht getestet; bei NAS-HDD werden außerdem File-Locks (`locked_store`, 50×0,05 s) knapp. Ziel: Lauf mit Max-Workern auf Zielhardware + Doku-Werte, Lock-Timeout erhöhen bzw. klare 503-Meldung. Teilmessung vom 12.09.2026 (Synthetik-Datenstand, nicht Zielhardware): Privat-Speicher je Worker 105 MB (fork) bzw. 150 MB (forkserver), 8 Worker ≈ 0,8–1,2 GB — Details und Folgen in B19. Zielhardware am selben Tag gemessen: **4** Kerne (J5040) und damit 4 Worker, kein Pinning/Quota/Speicher-Limit (`CpusetCpus` leer, `NanoCpus=0`, `HostConfig.Memory=0`); Host 15 Gi gesamt / **4,2 Gi verfügbar** / Swap 0; Container laut `docker stats` 220–280 MiB im Leerlauf bzw. während leichter Phasen. `shm_size: 256m` bleibt ungetestet. Achtung Messfalle: `nproc` meldet im Container `1`, weil das Image `OMP_NUM_THREADS=1` setzt — Details in B23. **Stand 0.25.0:** der Lock-Teil ist erledigt — `locked_store` wartet 100×0,05 s = 5 s (vorher 2,5 s) und meldet danach `store_locked` als 503 mit eigenem GUI-Text statt des Rohtexts, den die API als 400 `invalid_query` ausgegeben hat. **Offen bleibt die Messung auf der Zielhardware**, und zwar während Phase B (Leerlaufwerte belegen nichts): Protokoll in [docs/BETRIEB.md](docs/BETRIEB.md#ressourcen-während-phase-b-messen-b11) — fünf Zahlen (Python-Prozesse, `MEM USAGE`, `MEM %`/`free -h`, `CPUS`, `/dev/shm`), Sammler `ops/nas/measure-phase-b.sh`, Ergebnis hier eintragen. **Stand 0.25.1 — Protokoll auf den Kaltlauf umgestellt:** der Tages-Cache gilt für den ganzen lokalen Tag (`end_local` = letzter vollständiger Tag, `app/model_jobs.py::_backtest`) und `models` läuft nach B18 nur 1×/Tag ⇒ **jeder Planlauf ist ein Kaltlauf** (~9 min Phase B, zugleich der Speicher-Worst-Case); warm (~40 s, gemessen 13.09.2026: 11:22:28→11:23:07) sind nur zusätzliche Läufe am selben Tag, z. B. nach einem Container-Recreate. Kalt erzwingen: `TANKAPP_BACKTEST_CACHE=0` oder `runtime/engine/backtest-cache/` löschen. **Stand 13.09.2026 — erste Messung auf der Zielhardware** (Sammler `ops/nas/measure-phase-b.sh`, 33 Stichproben à 5 s, 14:26:40–14:30:34 local; Lauf beendet 14:29:09, 20 Stationen, Endzustand `partial (some_models_unavailable)`, Dauer 2,1 min): Container-Speicher max **1029 MiB (1,0 GiB)** am Ende der Phase „Modelle fitten + Backtest“ (14:29:00; MEM % max 6,6, Leerlauf 116–122 MiB; kurzes Sinken 511→369 MiB um 14:27:31 = Pool-Wechsel Phase A→B, B19) — passt zur Schätzung 4 × ~150 MB Worker + Master-Daten. Host verfügbar min **4217 MiB (4,1 GiB)** im selben Stichproben-Zeitpunkt (Start 5177, nach dem Lauf zurück ~5100) bei Swap 0 — weit über der kritischen Marke ~500 MiB. `/dev/shm` max **1 MiB** von 256 MiB → `shm_size: 256m` bleibt, keine Änderung in `compose.yml`. CPUS max **370 %** in Phase B (240–370 % über die Phase) → der Pool lief faktisch mit ~4 Workern; das ist die Gegenprobe, die B23 von der Prozessliste erwartete. **Zwei der fünf Zahlen fehlen in diesem Lauf, jeweils mit Ursache:** Python-Prozesse 0 in allen Stichproben, weil `docker top` ohne `ps` im Image gar keine Ausgabe liefert (Befund 13.09.; der Sammler zählt jetzt per `/proc`-Scan mit `docker exec`), und Phasenspalte „-“, weil Fortschrittszeilen nie auf Container-stdout stehen — der Worker-Subprozess schreibt seinen stdout nach `runtime/logs/models.log` (`app/server.py::Scheduler.run_once`), der Progress nach `runtime/jobs/models.log` (Befund 13.09.; der Sammler liest jetzt das Job-Log); das Messfenster wurde am Speicher-/CPU-Anstieg plus Job-Log zugeordnet. **Wichtig: der Lauf war trotz Cache-Löschung kein Kaltlauf** — das Job-Log sagt „Backtest: 9 aus Tages-Cache, 10 neu gerechnet“ (2,1 min statt ~9 min); eine Cache-Datei wird nie innerhalb desselben Laufs neu geschrieben und als Treffer gezählt, also war die Löschung vor diesem Lauf nicht wirksam — auf dem NAS zu prüfen: mtime der 19 Cache-Dateien gegen Laufstart (≈14:26:54) und der Quelle-Pfad von `/data/runtime` (`docker inspect tankapp-web-app-1 --format '{{json .Mounts}}'`). Am Speicherbefund ändert das nichts am Peak: 1029 MiB steht am Phase-B-Ende, wo Master und Worker maximal geladen sind, und der je-Station-Aufwand der Worker ist cache-unabhängig. **Offen bleibt der strenge Kaltlauf-Beleg** (0/19 aus Cache, ~9-min-Fenster): `ops/nas/b11-cold-run.sh` nach `nas-up` — wartet auf den Recreate-Lauf, löscht und verifiziert den Cache, sampelt mit dem gefixten Sammler, triggert den Lauf und schreibt alle fünf Zahlen plus Beleg in eine Report-Datei (Danach: Ergebnis hier eintragen). **Einordnung für Batch 4 / 0.26.0:** Die vorhandenen Dokuwerte bleiben die konservative Vorher-Messung (4 Worker, 1,0 GiB Peak, 4,1 GiB Host verfügbar, 1 MiB `/dev/shm`, 370 % CPU). Ein Pool statt zwei, `fork` statt `forkserver` und schmalere Worker-Daten erhöhen keinen dieser Bedarfe; eine niedrigere Nachher-Zahl wird aber erst nach Deployment behauptet. Der strenge Kaltlauf mit dem gefixten Sammler bleibt deshalb als Betriebsabnahme offen, nicht als Code-Blocker für Batch 4. |

### Laufzeit des Modell-Laufs — Befund und Messwerte vom 12.09.2026 (B15–B24; B15+B16 umgesetzt in 0.20.0, B18+B24 in 0.21.0, B17 in 0.22.0, B21 in 0.25.0, B19 + B20.1/.2/.4–.7 + B23 in 0.26.0)

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
| `free -h` auf dem Host | 15 Gi gesamt, 11 Gi belegt, **4,2 Gi verfügbar**, Swap 0 | 4 Worker × ~150 MB ≈ 0,6 GB passen — Abgleich gelaufen am 13.09.2026 (Container-Peak 1,0 GiB, Host min 4,1 GiB verfügbar, shm 1 MiB, CPUS max 370 %; Beleg und offene strenge Kaltlauf-Gegenprobe bei B11). |
| `docker stats` (nach Neustart mit `TANKAPP_MODEL_WORKERS=1`) | 220–280 MiB, 101–185 % CPU, 7–10 PIDs | Einzelwerte, nicht während der Fit-Phase aufgenommen — kein Beleg für oder gegen seriell/parallel. `ps` fehlt im Image (`python:3.14-slim`) — die Prozessliste kommt über einen `/proc`-Scan per `docker exec` (`docker top` liefert ohne `ps` nichts, Befund 13.09.2026). |

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

**Echter Lauf auf der Zielhardware (12.09.2026, 18:31:09–18:41:25 UTC,
`TANKAPP_MODEL_WORKERS=0` → 4 Worker, 20 Stationen, e10) — das ist die
Belastungsmarke, nicht die Sandkasten-Messung:**

| Phase | Dauer | Anteil |
|---|---|---|
| Start + InfluxDB-Export (9 518 Zeilen) | 13,5 s | 2 % |
| Live-Abdeckung + Archiv (25 112 Ereignisse) + gapfill + Bootstrap | 6,5 s | 1 % |
| **Phase A: 20 × `fit24`** | **22,3 s** | 4 % |
| **Phase B: 20 × (`wide72` + `wide168` + `backtest21`) = 60 Tasks** | **566 s = 9,4 min** | **92 %** |
| Selektion (doppelt, B21) + Veröffentlichen (19 Prognosen, 1 Fehler) | 8,5 s | 1 % |
| Gesamt, Endzustand `partial (some_models_unavailable)` | **10,3 min** | 100 % |

Umrechnung auf CPU-Zeit: 566 s Wandzeit × 4 Worker ≈ 2 264 s CPU für 20
Stationen = **~113 s CPU je Station**; dieselbe Arbeit kostet im Sandkasten
~31 s je Station. Ein J5040-Kern liefert also **rund 28 %** des Mess-Kerns —
die frühere Abschätzung (¼–⅓) ist damit mit echten Zahlen belegt. Daraus folgen
die Erwartungen für die Hebel (Skalierung aus den Sandkasten-Verhältnissen,
**nicht** auf dem NAS gemessen): B15+B16 (5,4× weniger CPU) ⇒ Phase B ~1,8 min,
Gesamtlauf ~2,3 min; zusätzlich B17 (Backtest je lokalem Tag gecacht) ⇒ Phase B
untertägig ~1 min, weil nur `wide72`/`wide168` übrig bleiben.

**Wo die Zeit hingeht (gemessen, eine Station, Sandkasten):**

| Anteil | Messung |
|---|---|
| Task `backtest21` | 24,3 s = **86 %** der CPU-Zeit einer Station (21 Folds × 1 `fit` + 3 `predict`); fit24 0,6 s, wide72 1,2 s, wide168 2,2 s |
| `predict()` → 12-Uhr-Projektion | **91 %** von `predict`: 2000 Bootstrap-Pfade einzeln in Python, darin 1,04 Mio. Aufrufe `isotonic_decreasing`, 126 Tsd. `noon_law_projection`, allein 3,4 s für 126 Tsd. Aufrufe von `law_since_utc` (nur von `cfg` abhängig) |
| `fit()` (219 ms) | 90 ms `strftime` für die Tagesschlüssel der Residuen-Blöcke, 46 ms Feiertagsmaske als List-Comprehension über Timestamps, 65 ms `pivot_table(aggfunc="median")` über ~2 900 (Tag, Slot)-Zellen mit je **genau einem** Gitterpunkt, 18 ms Huber-IRLS |
| Summe 20 Stationen | 557 s CPU seriell auf dem Mess-Kern. Zielhardware: 4 Kerne (J5040), 4 Worker, 8,3 bzw. 11,2 min Wandzeit — ein Kern dort ist grob 4× langsamer als der Mess-Kern, also nur Verhältnisse übertragen, keine absoluten Zeiten |

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| B18 | P1 | **Dauerhaftes `partial` löst stündlichen Voll-Lauf aus** | `Scheduler.next_delay` und `worker.finish` setzen 3600 s, sobald der Zustand nicht `success` ist. Eine dauerhaft unfitbare Station (im Log jeden Lauf „Gütersloh – GTB-Tankstelle, Isselhorster Str. 10-12 · fit24 – Fehler“, Grund `insufficient_or_invalid_training_data`) hält den Zustand auf `partial` → der 8–11-minütige Lauf wiederholt sich **24×/Tag** (Log: Ende 13:48:01 → Start 14:48:03, exakt 3600 s). Ziel: dauerhafte von flüchtigen Ursachen trennen — „Station hat strukturell zu wenig Historie“ darf keinen Stundentakt auslösen (Backoff auf `INTERVALS`, eigener Fehlercode je Station, Alarm/Checkliste statt Wiederholung); gehört zu A12 (Station-Lebenszyklus: tote Stationen fallen aus Polling-Set und Ranking). `tests/test_app_jobs.py` erwartet heute `partial` und 3600 s — mitziehen, nicht umbiegen. Am 12.09.2026 um 18:41:25 erneut eingetreten: Endzustand `partial (some_models_unavailable)`, wieder wegen derselben Station (Task 15/80 „Gütersloh – GTB-Tankstelle, Isselhorster Str. 10-12 · fit24 – Fehler“), `next_run_at` damit +3600 s — der 10,3-minütige Lauf wiederholt sich stündlich, solange diese eine Station nicht fitbar ist. |
| B19 | P2 | **Prozess-Pool: eine Phase, explizite Startmethode, schlankere initargs** | Das Image baut auf `python:3.14-slim-bookworm`; seit 3.14 ist `forkserver` die Default-Startmethode (gh-84559), `app/model_jobs.py` legt keine fest — **auf der Zielhardware am 12.09.2026 bestätigt** (`get_start_method()` im Container `tankapp-web-app-1` = `forkserver`). Messung mit denselben Daten und 8 Workern: Pool-Start inklusive initargs **0,03 s (fork) gegen 1,3–1,8 s (forkserver)**, und `app/refresh.py` baut **zwei** Pools je Kraftstoff (Phase A fit, Phase B wide/backtest) — im NAS-Log sichtbar als 17 s bis zum ersten Task-Ergebnis von Phase A. Privat-Speicher (PSS) je Worker 105 MB (fork) gegen 150 MB (forkserver), weil `series_map` (30,6 MB gepickelt, alle 20 Stationen, obwohl ein Task genau eine braucht) je Worker privat entpackt wird: 8 Worker ≈ 0,8–1,2 GB, dazu 32 MB Pfade plus `nanquantile`-Temporäres je wide168-Task. Ziel: ein Pool für beide Phasen; Startmethode explizit wählen (der Job-Prozess `python -m app.worker` ist single-threaded, `fork` ist dort sicher — sonst forkserver mit Datentransfer als `.npy` in `/dev/shm` + `mmap_mode="r"`); initargs auf die wirklich gebrauchten Spalten reduzieren; Pfade ggf. `float32`; Worker-Zahl an `nproc` der Zielhardware ausrichten und die gemessenen Werte in [docs/BETRIEB.md](docs/BETRIEB.md#modell-lauf-beschleunigen) belegen. Ergänzt B11; die Worker-Zahl selbst ist B23 — auf der Zielhardware 4 Kerne und damit 4 Worker, also korrekt, der Aufwand hier skaliert mit 4 statt 8. Auf dieser Hardware kostet der doppelte Pool rund 1,3–1,8 s je Phase und ~0,6 GB Privat-Speicher bei 4,2 Gi verfügbarem Host-Speicher: Feinschliff und Robustheit, **kein** Durchsatz-Hebel. Durchsatz kommt aus B15/B16 (bitgleich) und B17 (Tages-Cache). Messung auf der Zielhardware (12.09.2026): Phase A (20 × `fit24`) dauert seriell 33,3 s und mit 4 Workern 22,3 s — nur **1,5×** statt ~4×, weil Pool-Start, Worker-Bootstrap (jeder `forkserver`-Worker importiert Python/numpy/pandas neu) und 4 × 30,6 MB initargs bei einer kurzen Phase überwiegen; geschätzter Overhead ~14 s je Pool, zwei Pools je Lauf ≈ 28 s. Das erklärt auch die früher beobachteten 17 s bis zum ersten Task-Ergebnis. Gegenüber Phase B (566 s) ist derselbe Overhead vernachlässigbar — B19 bleibt Feinschliff, kein Wandzeit-Hebel. **Stand 0.26.0: umgesetzt.** `ModelTaskPool` bleibt über Phase A und B offen (ein Pool statt zwei), setzt auf dem Linux-NAS explizit `fork` und hält im Worker nur die sechs tatsächlich gelesenen Frame-Spalten. Der separate Job-Prozess ist single-threaded; Copy-on-write ist dort sicher. Fällt der Pool aus, werden nur noch nicht gemeldete Aufgaben seriell nachgerechnet. Ergebnisreihenfolge und Kennzahlen bleiben unabhängig von der Fertigstellungsreihenfolge stabil; Tests vergleichen seriell/parallel. |
| B20 | P2 | **Verschenkte Arbeit in den Tasks** | Sieben Punkte, alle ohne Änderung der Ergebnisse: (1) `app/model_jobs.py::_run` fittet auch für `kind="backtest"`, obwohl `app/refresh.py` das Modell ausschließlich aus Phase A liest (`fitted[identity]["model"]`) — Fit und zurückgeschicktes Artefakt (101 kB je Task) sind tot, ebenso `model` in `wide`-Ergebnissen. (2) `engine/backtest.py::run_backtest` ruft `predict` für das +3-d/+7-d-Fenster auf, **bevor** es prüft, ob dort Beobachtungen liegen — 8 von 63 Aufrufen je Station (13 %) enden sicher in `no_common_observations`; eine Vorab-Prüfung `h_observed.any()` ist bitgleich. (3) fit24/wide72/wide168 fitten dreimal dieselbe Station zum selben Cutoff — Fit plus beide Horizonte in einem Task spart zwei Fits je Station (Load-Balance beachten: `backtest` bleibt eigener Task). (4) `_records` baut je Zeile ein dict plus `isoformat()` über `index.map(lambda …)`; für die Publikation genügen die vorhandenen `HORIZON_COLUMNS`. (5) `run_tasks` holt Ergebnisse strikt in Einreichreihenfolge ab (`for _task, future in futures: future.result()`), der Fortschritt meldet also Fertigstellung in Task-Reihenfolge und nicht in Wahrheits-Reihenfolge — im Log sieht das aus wie ein Hänger (Task 21/22 kommen, dann 72 s Stille bis `backtest21`), und die `eta_s`-Schätzung erbt denselben Fehler. `as_completed` für `on_done` plus Ergebnisliste weiter in Task-Reihenfolge macht die Anzeige ehrlich, ohne die Publikation zu ändern. (6) Der Prozentwert springt rückwärts und steht dann lange still: im Lauf vom 12.09.2026 35 % (Archiv) → **0 %** (gapfill) → 85 % (Bootstrap) → 85–95 % während der **9,4 min** langen Phase B — die GUI zeigt also fast zehn Minuten lang praktisch keine Bewegung. (7) Im seriellen Pfad (`workers <= 1`) meldet `run_tasks` Fortschritt erst **nach** Abschluss der ganzen Phase; real beobachtet am 12.09.2026: 22,7 min ohne eine einzige Zeile (18:08:25 → 18:31), was wie ein Hänger aussieht und zunächst als „Abbruch an der Phasengrenze" fehlgedeutet wurde. Gegenmittel für beide: `on_done` je fertigem Task (auch im seriellen Pfad) und eine monoton wachsende Prozent-Abbildung über alle Phasen. **Stand 0.25.1:** zwei sichtbare Teile sind vorgezogen und damit erledigt — (a) die **Ursache** eines Fit-Fehlers landet im Job-Log (`app/progress.py::note(…, sticky=False)`, „Station · fit24 – FEHLER: …“ statt nur Container-stdout), (b) der **Zähler** zieht entfallene Folgetasks nach (`app/progress.py::retotal`, „Gesamtzahl auf 77 Schritte korrigiert“) statt mit „77/80“ zu enden; außerdem zählt er bei mehreren Kraftstoffen weiter, statt je Kraftstoff bei 0 zu beginnen. **Stand 0.26.0 (Batch 4):** Der Rest aus Punkt **1** (`wide` schickt kein ungenutztes Modellartefakt mehr zurück) sowie Punkte **2, 4, 5, 6 und 7 sind umgesetzt**: leere Mehrtage-Wahrheitsfenster werden vor `predict` erkannt; Worker serialisieren nur Zeitstempel + fünf Quantile; `as_completed` meldet echte Fertigstellung bei stabiler Rückgabeliste; `gapfill` hat ein eigenes Gewicht und der Balken läuft monoton, wobei die lange Fit-Phase 30–95 % belegt; seriell folgt `on_done` direkt nach jedem Task. **Offen bleibt nur Punkt 3** (Fit + beide Horizonte je Station bündeln); er war ausdrücklich nicht Teil von Batch 4 und braucht eine eigene Load-Balance-Änderung. |
| B22 | D | **Zahlen-ändernde Hebel: `bootstrap_samples` und Nacht-Raster — Entscheidung, kein Gratishebel** | Nach B15/B16 nicht mehr nötig; falls trotzdem gewollt: 2000→500 Ziehungen halbiert die Backtest-Zeit (24,3→9,6 s), verschiebt aber die publizierten Kennzahlen (Messung, eine Station: MASE 2,1059→2,0939, PICP 55,82→54,63 %, MPIW 1,866→1,830 ct, MAE 1,3590→1,3509 ct). Also Produktentscheidung mit eigener Konfiguration (`bootstrap_samples_backtest`) und Ausweis im Bericht — keine stille Änderung an einer Zahl, die ein Gate (§4.4) prüft. Zweiter Hebel derselben Klasse: `predict(hours=72/168)` rechnet das **volle** 5-Minuten-Raster inklusive Nachtstunden, obwohl der Collector nur 06–24 Uhr pollt und die Nachtzellen mangels Residuen-Unterstützung überwiegend NaN sind — mit `scheduled()`-Filter wären das 25 % weniger Punkte (168 h: 2016→1512). Ändert die publizierten `points_3d`/`points_7d` und damit den Fan-Chart, also erst entscheiden, ob die GUI die Nachtstunden braucht. |
| B23 | P2 | **Worker-Zahl hängt an `os.cpu_count()` (ignoriert Affinität/Quota) — latent, heute ohne Wirkung** | Zielhardware-Messung 12.09.2026: Host **und** Container sehen 4 Kerne (J5040), `CpusetCpus` leer, `NanoCpus=0`, `CpuQuota=0`, `os.cpu_count()`/`os.process_cpu_count()`/Affinität = `4 / 4 / 4` → `resolve_workers` liefert 4; es gibt derzeit **keine** Fehlzuordnung, der Pool arbeitet sinnvoll. Eingebaut ist der Fehler trotzdem: `os.cpu_count()` meldet die Host-Kerne und ignoriert CPU-Affinität sowie cgroup-`cpu.max`. Sobald der Container gepinnt oder mit einer Quota belegt wird (unRAID-CPU-Pinning, `--cpuset-cpus`, `deploy.resources.limits.cpus`), startet die App weiter bis zu 8 Worker auf weniger Kernen — dann ohne Durchsatzgewinn, aber mit vollem Speicher- und initargs-Aufwand (B19). Ziel: `os.process_cpu_count()` (seit Python 3.13) statt `os.cpu_count()`, zusätzlich `cpu.max`/`NanoCpus` auswerten, plus Test „2 nutzbare bei 8 gemeldeten Kernen ⇒ 2 Worker“. **Messfalle, damit sie niemand wiederholt:** `nproc` im Container meldete `1`, obwohl 4 Kerne nutzbar sind — das Image setzt `OMP_NUM_THREADS=1` ([ops/nas/app/Dockerfile](ops/nas/app/Dockerfile), Zeile 11), und GNU `nproc` ehrt diese Variable (im Sandkasten nachgebaut: `nproc` = 2, `OMP_NUM_THREADS=1 nproc` = 1, Affinität unverändert). Kerne deshalb immer über die Affinität bestimmen, nie über `nproc`. **Fehlberatung aus derselben Messung, ausdrücklich zum Rückgängigmachen:** auf Basis der `nproc`-Zahl wurde `TANKAPP_MODEL_WORKERS=1` gesetzt. Das ist auf 4 Kernen eine Verschlechterung — `run_tasks` nimmt den seriellen Pfad, baut keinen Pool, die Wandzeit steigt grob um den Faktor 4 und damit vermutlich über das 3600-s-Intervall aus B18 (überlappende Läufe). Zurück auf `0` (automatisch = 4) oder bewusst `2`/`3`, wenn andere Dienste auf dem NAS Vorrang haben; Gegenmessung mit `docker stats` bzw. `/proc`-Scan (Sammler `ops/nas/measure-phase-b.sh`, B11) während der Fit-Phase, nicht im Leerlauf. Gegenmessung im echten Betrieb (12.09.2026): mit `TANKAPP_MODEL_WORKERS=1` dauerte Phase A 33,3 s statt 22,3 s mit 4 Workern; Phase B lief 22,7 min **ohne eine einzige Log-Zeile** (serieller Pfad meldet Fortschritt erst nach der Phase, B20 Punkt 7) und wäre bei ~38 min gelandet — länger als das 3600-s-Intervall aus B18. Um 18:31 auf `0` zurückgesetzt, der Lauf danach brauchte 10,3 min. **Stand 0.26.0: umgesetzt.** Automatik nutzt `os.process_cpu_count()` (Python ≥3.13), zusätzlich die Prozess-Affinität und Docker/cgroup-v2-`cpu.max` bzw. cgroup-v1-Quota; Bruchteile werden aufgerundet, das Auto-Maximum bleibt 8. Ein explizit positiver Betreiberwert bleibt bewusst ein Override (maximal 64). Tests decken „8 sichtbar, 2 nutzbar ⇒ 2 Worker“ sowie v1/v2-Quotas ab. |
| B24 | P1 | **Hart abgebrochener Lauf bleibt als `state: running` liegen — kein `aborted`** | `app/worker.py::run` schreibt beim Start `{"state": "running", "started_at": …}` und aktualisiert `runtime/jobs/<name>.json` erst wieder in `finish()`. Wird der Prozess hart beendet — Container-Recreate durch `nas-up` (`compose up -d --build --force-recreate`), `docker restart`, SIGKILL nach `stop_grace_period: 20s` — läuft `finish()` nie: die Datei behauptet weiter `running`, ohne `finished_at`, `next_run_at` und `error_code`. `app/data.py::public_job` gibt das unverändert aus; nur das Fortschrittsfeld wird über die Staleness-Prüfung in `read_progress` unterdrückt. Die GUI kann also „läuft“ ohne Fortschritt zeigen, bis ein neuer Lauf die Datei überschreibt, und die Job-Historie kennt den Abbruch überhaupt nicht. Beleg: zwei Vorfälle am 12.09.2026 (14:48 und 18:07, Ursache im Diagnose-Block oben). Ziel: (a) SIGTERM-Handler im Job-Prozess, der den Zustand als `aborted` samt Abbruchphase schreibt — 20 s Grace-Periode reichen dafür; (b) beim Start einen `running`-Eintrag ohne lebenden Prozess als `aborted` verbuchen statt ihn still zu überschreiben; (c) `nas-up` warnen (oder warten), wenn ein Modell-Lauf aktiv ist, damit ein 10-Minuten-Lauf nicht unbemerkt stirbt; (d) Microcopy für „abgebrochen“ nach [docs/MICROCOPY.md](docs/MICROCOPY.md) und Test auf `aborted` in `tests/test_app_jobs.py`. Gehört zu B18 (Zustände und Intervalle) und B20 Punkt 7 (serieller Pfad meldet nichts). |

**Abgebrochene Läufe — Ursache gefunden (12.09.2026, gehört zu B18/B20/B24):**
zwei Abbrüche mit identischem Muster im Job-Log. Lauf 1: Start 14:48:03, letzte
Zeile 14:48:59 (Task 20/80), neuer „Job gestartet" 14:49:22. Lauf 2: Start
18:07:34, letzte Zeile 18:08:25 (Task 20/80), neuer „Job gestartet" 18:31:09.

Lauf 2 ist **beweisbar erklärt**: um ~18:31 lief `TANKAPP_MODEL_WORKERS=0 python3
tankapp.py nas-up`, und `nas_up` ruft `compose up -d --build --force-recreate` —
das ersetzt den Container und tötet den laufenden Job; der Scheduler des neuen
Containers startet den Modell-Lauf sofort. Die 22,7 min ohne eine einzige
Log-Zeile davor sind kein Hänger: dieser Lauf lief noch mit
`TANKAPP_MODEL_WORKERS=1`, und `run_tasks` meldet im seriellen Pfad Fortschritt
**erst nach Abschluss der ganzen Phase** (erst `results = [_run(task) …]`, dann
die `on_done`-Schleife). Phase B hätte seriell ~38 min gebraucht
(113 s CPU × 20 Stationen ÷ 1 Kern), der Lauf wurde mitten darin getötet —
siehe B20 Punkt 7.

Für Lauf 1 (14:48) ist dieselbe Erklärung **wahrscheinlich, aber nicht belegt**:
`RestartCount=0` schließt ein *Recreate* nicht aus (Compose/unRAID ersetzen den
Container, die Restart-Policy zählt das nicht), `OOMKilled=false`,
`HostConfig.Memory=0` und ein leeres `dmesg` schließen Speicherdruck aus, und der
Abstand von 23 s zwischen letzter Task-Zeile und neuem „Job gestartet" passt zu
Container-Neustart plus Anlauf: mit 4 Workern erscheint Task 21/80 rund 11 s nach
Task 20/80 (gemessen im Lauf um 18:31), hier kam er gar nicht. **Ausgeschlossen**
sind damit OOM auf Container- und Kernel-Ebene, ein Speicher-Limit und
CPU-Pinning/Quota. Die Läufe überlappten sich entgegen der ersten Deutung
vermutlich **nicht** — der erste wurde beendet, bevor der zweite anlief.

Falls es noch einmal ohne eigenes `nas-up` passiert, sofort sichern:
`uptime -s`, `systemctl show docker -p ActiveEnterTimestamp`,
`grep -n nas-up ~/.bash_history | tail -5`,
`docker ps --format '{{.Names}}' | grep -i tank` (Instanzen zählen),
`cat data/runtime/jobs/models.json` (`started_at` ohne `finished_at` = hart
abgebrochen, B24) und `tail -n 60 data/runtime/jobs/models.log`.

**Erwartete Wirkung, wenn B15+B16 zusammen umgesetzt sind (gemessen, ein Kern):**
28,3 s → 5,2 s je Station, also 9,4 min → 1,7 min CPU für 20 Stationen
(**5,4×**); der Backtest-Anteil fällt von 86 % auf 62 %. Mit B17 (Tages-Cache)
bleiben in einem untertägigen Lauf noch 37 s CPU statt 80 s, und mit B18 läuft
der teure Lauf einmal am Tag statt 24×.

### Reihenfolge-Empfehlung

**Abarbeitungsreihenfolge für dieses Bündel (Vorschlag vom 12.09.2026 — in
Batchen, je Batch eine Version; Aufwand grob inklusive Prüfaufwand):**

| Batch | Inhalt | Aufwand | Wirkung auf der Zielhardware | Warum an dieser Stelle |
|---|---|---|---|---|
| **0 — ohne Code** ✅ (bis auf B11-Messung) | B21-Ursache klären ✅, `nas-up` nie während eines Laufs ✅ (Warnung seit 0.21.0), B11-Messung während Phase B ⏳ | ~1 h | keine, aber Entscheidungsgrundlage | **Erledigt in 0.25.0:** B21 war ein echter Fehler hinter „Meine Stationen“, kein Eingabedaten-Problem — das Coverage-Gate maß gegen das volle 24-h-Raster und konnte nie 85 % erreichen (77,5 % Maximalwert bei lückenlosem 06–24-Polling; 4,8 % im Archiv-Betrieb). Damit war Batch 0 doch Code-Arbeit: Gate auf Polling-Fenster + Stadt-Bestwert umgestellt, Diagnosefelder ins Artefakt, Tests. **NAS-Beleg aus dem Job-Log vom 13.09.2026 (drei Läufe, Stand 0.24.1 — Fix noch nicht deployed):** die Selektionsphase dauert 0,13–0,15 s (07:52:38.343→.491, 10:15:44.663→.793, 10:50:14.125→.257) — ein Bail-out, kein Ranking; nachgebaut am selben Datenstand liefert der Stand vor dem Fix 0 Stationen in 0,05 s mit Grund „nach Coverage ≥85 % nur 0 Station(en) übrig“. **Kosten des Fixes:** dieselbe Selektion mit echtem δ̂-Ranking (20 Stationen, 2 Städte, B=2000) dauert **1,5 s** — gemessen, nicht geschätzt; gegen 1,4–1,7 min Laufzeit vernachlässigbar. **Offen:** B11-Messung auf der Zielhardware; der Lock-Teil von B11 ist mitgezogen (5 s + `store_locked`/503). **Stand 0.25.1:** das Protokoll in [docs/BETRIEB.md](docs/BETRIEB.md#ressourcen-während-phase-b-messen-b11) zielt jetzt auf den **Kaltlauf** (vorher stand dort „Task-Zeilen im Minutentakt“, was seit B17 nur noch für den ~9-min-Kaltlauf gilt, nicht für den ~40-s-Warm-Lauf) und es gibt einen Sammler (`ops/nas/measure-phase-b.sh`), der die fünf Zahlen selbst zusammerechnet. **Stand 13.09.2026:** erste Messung gelaufen (Container-Peak 1,0 GiB, Host min 4,1 GiB verfügbar, shm 1 MiB, CPUS max 370 %) — Ergebnis, die zwei Messlücken (Prozessliste, Phase) und der offene strenge Kaltlauf-Beleg stehen bei B11; der erste Lauf war trotz Cache-Löschung kein Kaltlauf („9 aus Tages-Cache, 10 neu gerechnet“) |
| **1 — bitgleich** ✅ | **B15**, danach **B16** (nur die bitgleichen Teile a–e) | ~2 Tage | 10,3 min → **~2,3 min** (hochgerechnet: Phase B 9,4 → ~1,8 min) | **Umgesetzt in 0.20.0** (Bitgleichheits-Tests in `tests/test_models.py`). **NAS-Gegenmessung 13.09.2026 (Job-Log, drei Läufe 07:52/10:15/10:50 UTC):** **1,4–1,7 min** je Lauf statt 10,3 min am 12.09. — Backtest komplett aus dem Tages-Cache („19 aus Tages-Cache, 0 neu gerechnet“), Phase B damit nur noch ~50 s. Kaltstart des Caches (erster Lauf des Tages) ist in diesem Log nicht enthalten. Der Anteil von B15/B16 ist darin nicht einzeln sichtbar — er steckt in denselben 50 s Phase B. Die B16-Normalgleichungen (Δ ≤ 3,4e-12) bleiben **aus**, bis sie ausdrücklich freigegeben sind |
| **2 — Betrieb** ✅ | **B18** + **B24** | ~1–1,5 Tage | 24 Läufe/Tag → **1**; Abbrüche werden `aborted` statt ewig `running` | **Umgesetzt in 0.21.0** (`is_transient_error` + Backoff auf `INTERVALS` für strukturelle Codes, SIGTERM-Handler + `_mark_prior_aborted`, Warnung in `nas-up`, Microcopy „Abgebrochen“, Tests in `tests/test_app_jobs.py`). Nach Batch 1 wiegt der Stundentakt weniger — die NAS-Last bleibt aber der Grund. **Gemessen 13.09.2026:** drei Läufe in 2:57 h (07:52, 10:14, 10:48) trotz `models: 86400` — kein Backoff-Fehler, sondern `app/server.py::Scheduler.loop`: der **erste Lauf im Prozess startet sofort** (`wake.wait(0.0 if first …)`), jeder Container-Recreate rechnet also einmal neu (PR 94 merged 10:48:07Z, Laufstart 10:48:56Z). Bei 1,4 min Laufzeit unkritisch; wer das nicht will, startet den Container nicht mitten am Tag neu |
| **3 — Architektur** ✅ | **B17** (Tages-Cache) | ~2–3 Tage | untertägig **~1 min** (nur `wide72`/`wide168` bleiben) | **Umgesetzt in 0.22.0** (`app/backtest_cache.py`: Fingerabdruck = Config + Inhalts-Hash der gesamten Reihe bis Endtag + Schema-/Bibliotheksversionen; Ausweis `backtest_cached`/`backtest_computed_at`; Tests in `tests/test_backtest_cache.py`). Nebenbefund: die +3-d/+7-d-Fenster wurden bisher gegen den laufenden Tag bewertet — `run_backtest` schneidet jetzt hart am Ende ab. B20 Punkt (1) — toter `fit` im backtest-Task — ist damit erledigt. **NAS-Gegenmessung 13.09.2026 (Job-Log, drei Läufe 07:52/10:15/10:50 UTC):** **1,4–1,7 min** je Lauf statt 10,3 min am 12.09. — Backtest komplett aus dem Tages-Cache („19 aus Tages-Cache, 0 neu gerechnet“), Phase B damit nur noch ~50 s. Kaltstart des Caches (erster Lauf des Tages) ist in diesem Log nicht enthalten. |
| **4 — Feinschliff** ✅ | **B19** ✅ + **B20** (Rest aus 1 sowie Punkte 2, 4, 5, 6, 7) ✅ + **B23** ✅ + B11-Dokuwerte ✅ (Nachher-Messung ⏳) | ~1,5–2 Tage | ein Poolstart weniger je Kraftstoff, ehrlicher Fortschritt, robuste Worker-Zahl | **Umgesetzt in 0.26.0:** ein expliziter `fork`-Pool für beide Phasen, sechs statt neun Frame-Spalten im Worker, Vorab-Skip leerer Backtest-Horizonte, kleine Prognose-Records, Callbacks via `as_completed` (Rückgabe weiterhin stabil), sofortiger serieller Fortschritt und monotone Laufzeitgewichtung 0–100 %. Automatik berücksichtigt Affinität + cgroup-v1/v2-Quota. Die vorhandenen B11-Werte sind als konservative Vorher-Messung dokumentiert; der strenge Kaltlauf nach Deployment bleibt ehrlich als Betriebsabnahme offen. B20 Punkt 3 (drei Fits bündeln) gehört nicht zu diesem Batch und bleibt separat offen. |
| **5 — Entscheidung** | **B22** (`bootstrap_samples`, Nacht-Raster) | Entscheidung + ~1 Tag | — | Ändert publizierte Kennzahlen und damit ein Gate (§4.4). Nach Batch 1–3 vermutlich überflüssig; ausdrücklich **nicht** als Laufzeit-Hebel einplanen |

Zwei Regeln für alle Batche: (1) je Batch eine Version mit `app/version.py` und
CHANGELOG-Eintrag **inklusive der auf dem NAS gemessenen Laufdauer** vorher/nachher
— aus der `beendet: … Dauer X min`-Zeile des Job-Logs, nicht nur Sandkasten-Zahlen;
(2) B15/B16/B17 bekommen je einen Test, der Bitgleichheit bzw. Cache-Treue gegen
die aktuelle Implementierung prüft; die Messprotokolle in diesem Abschnitt sind
die Referenz dafür.

---

## C. GUI / UX

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| C3 | P2 | **Karten-/Umgebungsansicht für F2** | „Hier oder woanders?“ als Karte mit Netto-€-Pins. OSM-Tiles brauchen Internet (im LAN okay, wenn NAS/Handy online); Alternativen: statische Tile-Region oder reduzierte Luftlinien-Übersicht. |
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
| 0.26.0 (13.09.2026) | **Laufzeit-Batch 4:** B19 (ein expliziter `fork`-Pool für Phase A+B, schmale Worker-Frames), B20 Rest aus Punkt 1 sowie Punkte 2/4/5/6/7 (kein `model` in `wide`, leere Horizontfenster vor `predict` überspringen, kleine Records, `as_completed`, monotone Gewichtung, sofortiger serieller Fortschritt) und B23 (Worker-Automatik aus Affinität + cgroup-v1/v2-Quota). B20 Punkt 3 und die B11-Nachher-Messung bleiben oben ausdrücklich offen. |
| 0.25.1 (13.09.2026) | **Fehlerursache im Job-Log** (`app/progress.py::note(…, sticky=False)`, `app/refresh.py`) und **ehrlicher Fortschrittszähler** (`app/progress.py::retotal`): entfallene Folgetasks werden aus der Gesamtzahl herausgerechnet; bei mehreren Kraftstoffen läuft der Zähler weiter. **B11-Doku:** Messprotokoll auf den Kaltlauf umgestellt und Sammler/Kaltlauf-Script ergänzt; erste Zielhardwaremessung mit ihren Einschränkungen steht oben bei B11. |
