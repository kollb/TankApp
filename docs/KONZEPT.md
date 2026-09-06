# TankApp — Detailliertes Gesamtkonzept (v3)

> Stand: 2026-09-06 · Gegenüber v2 ergänzt: echte Tankerkönig-Payloads
> (list.php / prices.php), empirisch belegte Antwort zur Poll-Fenster-Frage
> 08–24 Uhr, Öffnungszeiten-bewusste Engine, verfeinerte Betriebsdetails.

**Ziel:** Persönliche Tank-App, die
1. aus historischen Daten (3 Städte) mathematisch hart die ~10 lohnenden
   Tankstellen auswählt,
2. Preise für **heute, +3 und +7 Tage** mit **kalibrierter Konfidenz**
   prognostiziert (Graph **und** Heatmap, ApexCharts-Design),
3. autark auf **Raspberry Pi (1 GB) + NAS (Docker/InfluxDB)** läuft,
4. Umweg- und Fahrzeug-Ökonomie korrekt einrechnet.

```
 Tankerkönig API            Raspberry Pi (1 GB, 24/7)              NAS (bei Bedarf an)
 ┌───────────────┐  1 R/5min ┌──────────────────────────────┐   ┌───────────────────┐
 │ list.php      │ ────────► │ Collector (Python)           │   │ Docker            │
 │ prices.php    │  (≤10 IDs │  └► tmpfs-Ringpuffer         │──►│  └ influxdb:2     │
 │  (1 Req!)     │  pro Req) │     /dev/shm/tankapp         │LP │  └ (opt. Grafana) │
 └───────────────┘           │ Uploader: Batch→InfluxDB,   │   └───────────────────┘
 Google Maps                 │     idempotent, ack-Marker   │            ▲
 Deep-Link (kostenlos,       │ FastAPI „TankPuls“ (5 Endp.) │────────────┘
 ohne Key) ◄─────────────────┤  + statisches PWA-Frontend   │  Historie/Backfill
                             └──────────────────────────────┘
```

---

## 1. Datenquelle: Tankerkönig API

### 1.1 Nutzbares Kontingent und seine Konsequenz

Empfehlung/Limit: **1 Request / 5 min**. Der Preis-Endpunkt
`prices.php?ids=<uuid1,…,uuid10>&apikey=…` bündelt **bis zu 10 Stationen in
einem Request** → die 10 selektierten Stationen kosten exakt einen Poll je
5 min: **288 Requests/Tag** bei Volltag, **216** beim empfohlenen Fenster
06–24 Uhr (s. §4). Das Limit wird nie berührt; Engpass ist bewusst gewählt.

Stations-Masterdaten (Name, Marke, Geo, Öffnungsstatus-Stichprobe) 1×/Tag aus
`list.php?lat&lng&rad&sort=dist&type=e10` (Radius bis 25 km), gecacht —
`list.php` liefert bereits Preise + `dist` + `isOpen`, eignet sich daher auch
für den täglichen Plausibilitäts-Abgleich der 10 IDs.

### 1.2 Payload->Schema-Mapping (wichtig für den Collector)

`list.php` (Stationsliste mit Preisen):

| Feld | Typ | Verarbeitung |
|---|---|---|
| `id` | UUID | Primärschlüssel (Tag `station` in InfluxDB) |
| `name`, `brand` | string | nur Masterdaten-Tabelle (nicht je Punkt) |
| `street`, `houseNumber`, `place`, `postCode` | string/int | Masterdaten |
| `lat`, `lng` | float | WGS84 → Masterdaten + Google-Maps-Deep-Link |
| `dist` | float | **nur relativ zum Suchstandort** — nicht speichern |
| `e5`, `e10`, `diesel` | float | je eigener Datenpunkt (Measurement `price`, Tag `fuel`) |
| `isOpen` | bool | → Feld `status` |

`prices.php` (Detailpreise je ID) — **Zwei Fallstricke:**

```json
"<uuid>": { "status": "open",   "e5": false, "e10": false, "diesel": 1.189 }
"<uuid>": { "status": "closed" }
"<uuid>": { "status": "no prices" }
```

- `false` statt Zahl heißt *Kraftstoff wird nicht geführt* → **niemals 0
  schreiben**, sondern gar keinen Punkt für diese Sorte.
- `status: "closed"` → kein Preis. Der letzte bekannte Preis gilt *am
  Zapfhahn erst wieder bei Öffnung*; die Engine markiert diese Zeitspanne als
  **stale**, nicht als reale Beobachtung (Details §3.1).
- `status: "no prices"` → Station existiert, meldet aber nichts → nach 7
  Tagen ohne Daten aus Monitoring nehmen (Alarm im Dashboard).

**InfluxDB-Zeilenformat** (Line Protocol, idempotent durch festen Zeitstempel):

```
price,station=<uuid>,fuel=e10 value=1.389,open=1 <unix_ns(fetched_at)>
```

Doppeleinträge mit identischem (measurement, tags, timestamp) werden von
InfluxDB dedupliziert → der Uploader kann nach NAS-Ausfall blind nachliefern.

### 1.3 Lizenz & Etikette

Daten unter CC BY 4.0 (MTS-K) — Quellenangabe „Daten: MTS-K via
tankerkoenig.de (CC BY 4.0)" ins Footer-Impressum der App. Token-Bucket
1 R/300 s im Collector **hart verdrahten** (zusätzlich 429-Backoff 60 s).

---

## 2. Schritt 1: Mathematische Tankstellen-Selektion (fertig implementiert)

Pipeline: `analysis/station_selection.py` · Demo-Bericht:
`docs/analysis/report_top10.md` · Schema der Eingabedaten: `analysis/README.md`
(optionale Spalte `status` ∈ {open, closed} berücksichtigt, falls die
Historie sie mitliefert).

| # | Komponente | Verfahren | Funktion im Score |
|---|---|---|---|
| 1 | **Relative Preislage δ̂ᵢ** | Medianᵢ(t) von pᵢ(t) − Medianⱼ≠ᵢ pⱼ(t) (Leave-One-Out-Baseline) | Gewicht 0.40 |
| 2 | **Inferenz** | Tages-Block-Bootstrap (B = 2000) → 95 %-KI; p-Wert H₀: δᵢ ≥ 0; **Benjamini-Hochberg-FDR** (q < 0.05) über alle Stationen | Signifikanz-Gate |
| 3 | **Verfügbarkeit AVᵢ** | Σₕ wₕ·P(Station ∈ Top-3 ᐧ Stunde h); w = Tankzeitprofil (werktags 06–09/16–20 h) | Gewicht 0.25 |
| 4 | **Tagesform** | robuste harmonische Regression (Huber-IRLS, 1.+2. Harmonische) → Amplitude, **billigste Stunde**, R² | Gewicht 0.15 |
| 5 | **Risiko** | σᵢ = 1.4826·MAD(Δᵢ); Streuung der Tages-Mittelränge | Gewicht 0.10 + 0.10 |
| 6 | **Datenqualität** | Coverage-Gate ≥ 85 % je Station | Ausschluss |

Demo-Ergebnis (54 Stationen, 8 Wochen, 5-Min-Raster): Top-10 mit δ̂ zwischen
−2,85 und −4,40 ct/L, alle q < 0,005, Ersparnis **≈ 71–110 €/Jahr** bei
40 L/Füllung · 1,2 Füllungen/Woche.

---

## 3. Schritt 2: Zeitreihen-Engine

### 3.0 Direkte Antworten

- **„Ist einfache Statistik ausreichend?"** Nein. Spritpreise = starke
  Tageszyklen (Morgensprung, Abendtief) + Wochenmuster + diskontinuierliche
  Betreiber-Preissprünge + heteroskedastisches Rauschen. Ein Mittelwert-/
  Glättungsansatz liegt genau in den Sprungstunden systematisch daneben, und
  „Konfidenz" daraus wäre unkalibriert. Nötig: **Strukturmodell +
  Residuen-Dynamik + Ensemble + kalibrierte Intervalle** (alles unten
  spezifiziert; Abnahme-Kriterien quantifiziert).
- **„Geht es genauer?"** Ja — über den Modell-Stack §3.2 und vor allem über
  **konforme Kalibrierung** der Intervalle §3.3.
- **„Gute Konfidenz über die gesamte Zeitreihe?"** Ja, weil (i) die Intervalle
  verteilungsfrei kalibriert werden (Adaptive Conformal Inference) und (ii)
  die tatsächliche Überdeckung laufend gemessen und angezeigt wird
  (Rolling-PICP). Ab ~8 Wochen 5-Min-Historie sind Tages- (Periode 288) und
  Wochen-Saison (Periode 2016) stabil identifiziert; danach wächst die
  Konfidenz messbar (MASE↓, Intervallbreite↓).

### 3.1 Aufbereitung & Öffnungszeiten-Bewusstsein

1. Reguläres 5-Min-Raster je (Station, fuel); Poll-Lücken → Forward-Fill
   ≤ 30 min, sonst NaN **+ Staleness-Maske**.
2. `status: closed`-Zeitspannen: Preis = letzter Open-Preis (Zapfhahn-Realität),
   aber Flag `open=0` — die Streuung dieser Segmente fließt **nicht** in die
   Zyklus-Modellierung ein (eingefrorene Preise sind keine Marktsignale).
3. Hampel-Filter (Fenster 1 h, Median ± 5·MAD) gegen API-Artefakte.
4. Tagesblöcke als Bootstrap-/Backtest-Einheit.

### 3.2 Modell-Stack (pro Station × Sorte; R² der Demo-Fits 0,94 im Median)

**M1 Strukturmodell (robust):**
p(t) = μ + Σₖ₌₁²[aₖcos(2πkh/24) + bₖsin(2πkh/24)] + Wochen-Harmonische
       + γ′·X(t) + ε(t)
mit X = DoW-/Feiertags-Dummies + Zeit-seit-letztem-Preissprung; Huber-IRLS,
rollierendes 6-Wochen-Fenster, tägliches Refit.

**M2 Residuen-Nachlauf:** AR(2) auf ε(t) (Persistenz direkt nach Sprüngen),
Yule-Walker.

**M3 ETS/Holt-Winters** (gedämpfter Trend, Perioden 288/2016 gekoppelt) als
unabhängige Zweitmeinung.

**M4 (ab ≥ 3 Monaten Daten):** Quantile-Gradient-Boosting (τ = .05…​.95) auf
[Stunde, DoW, Feiertag, Zeit-seit-Sprung, Abstand zum Stadtmedian, Offsetᵢ].

**Ensemble:** inverse-**MASE**-Gewichte aus 21-Tage-Rolling-Backtest,
täglich neu; Benchmark = Persistenz. Abnahme: **MASE(24 h) < 0,8**.

### 3.3 Konfidenz: Intervalle mit verteilungsfreier Garantie

1. Residuen-Block-Bootstrap (Block = Resttag, B = 500) → Quantile
   q̂.05…q̂.95 → 80 %/95 %-Bänder.
2. **Adaptive Conformal Inference:** Nonkonformitäts-Scores
   s(t) = max(q̂_lo − y, y − q̂_hi) über die letzten 14 Tage; die
   Intervallbreite folgt einem Update mit Lernrate η, sodass die empirische
   Überdeckung zum Nominalniveau konvergiert — ohne Verteilungsannahme und
   adaptiv bei Regimewechseln (z. B. volatile Wochen).
3. **Monitoring:** 7-Tage-Rolling-PICP je Station als „Konfidenz-Badge" im
   Dashboard (grün ≥ Nominal − 2 pp, gelb ±5 pp, rot < → Hinweistext
   „Prognose derzeit unsicher").

### 3.4 Horizonte & ehrlich bezifferte Genauigkeit

| Horizont | Inhalt | erwartbarer MAE* | Intervall |
|---|---|---|---|
| **Heute 0–24 h** | Nowcast: Position im Tageszyklus + aktueller Sprung-Status | 0,8–1,5 ct punktuell; ≈0,5 ct im Tagesmittel | 95 %-KI ≈ ±2–3 ct |
| **+3 Tage** | Saison + Trend, Sprung-Wahrscheinlichkeit | 1,5–2,5 ct | ±3–5 ct |
| **+7 Tage** | v. a. Wochenmuster/Tagesform; Trend nur gedämpft | 2–4 ct | ±4–7 ct |

\* Literatur-Größenordnungen für den deutschen Markt; die stationsspezifischen
Werte werden per Rolling-Origin-Backtest (Cutoff täglich 00:00, Training
42 Tage) nachgewiesen: MAE, RMSE, MASE, sMAPE, PICP, MPIW, Pinball, CRPS.

**Grenzen (bewusst):** Preissprünge sind Betreiber-Entscheidungen —
nicht deterministisch punktvorhersagbar. Die Engine sagt *Fenster +
Wahrscheinlichkeit* („mit 78 % ist 18–21 h günstiger als der Tagesmedian")
statt „um 20:15 exakt 1,632". Das ist die mathematisch korrekte Aussageform.

---

## 4. Polling-Fenster: Reicht 08:00–24:00 Uhr? — Empirisch beantwortet

Skript `analysis/window_analysis.py` rechnet die Frage auf den historischen
Daten nach (statt sie zu schätzen). Ergebnis auf dem Demo-Datensatz —
Bericht `docs/analysis/report_window.md`:

| Kennzahl | Fenster 08–24 | Fenster 06–24 |
|---|---:|---:|
| Anteil Tage, deren **Preis-Minimum im Fenster** liegt | **98,1 %** | 98,1 % |
| Median \|δ̂-Bias\| der Niveau-Schätzung | 0,30 ct/L | 0,20 ct/L |
| 95 %-Quantil \|δ̂-Bias\| | 0,84 ct/L | 0,68 ct/L |
| Median Fehler „billigste Stunde" | 0,5 h | 0,5 h |
| 95 %-Quantil Fehler „billigste Stunde" | **8,7 h** ⚠ | 8,5 h ⚠ |
| Median R² des harmonischen Fits | 0,97 | 0,96 |

**Interpretation:**

- **Für die Tankstellen-Auswahl reicht 08–24 völlig** (δ̂-Bias ≤ 0,3 ct im
  Median; zudem weitgehend *systematisch*, d. h. rangordnungsneutral, weil
  das fehlende Morgenhochpreis-Segment alle Stationen ähnlich trifft).
- **Für die Zeitreihen-Engine ist 08–24 knapp ausreichend, aber mit einer
  Lücke:** der Morgensprung (≈ 05:30–07:30) wird nie beobachtet. Die Phase
  der Tageskurve lässt sich aus dem Rest des Tages zurückschließen
  (2 Harmonische ≪ 32 Halbstunden-Bins → identifiziert), doch genau die
  Stationen, deren Extremum in der Nacht/frühen Früh liegt (Typ
  *24h-Discounter an Ausfallstraßen*), werden mit bis zu ~9 h Fehler falsch
  datiert — das p95 oben sind fast ausschließlich diese Stationen.
- **00:00–06:00** liefert bei regulären Stationen ohnehin nur eingefrorene
  Preise (`status: closed`) — echter Informationsgehalt fast null.
- **Empfehlung: Poll-Fenster 06:00–24:00** (216 Requests/Tag, unverändert
  im Limit). Sichert den Morgensprung komplett und praktisch alle
  Tagesminima, ignoriert nur die tote Phase. Der Scheduler wertet die
  `isOpen`-Historie je Station aus und **erweitert das Fenster automatisch
  auf 00–06 für Stationen mit 24h-Betrieb** (per-station adaptive Fenster;
  Kriterium: ≥ 10 % der Tagesminima dieser Station lagen historisch vor
  08:00 Uhr).

---

## 5. Visualisierung & Frontend

- **ApexCharts (MIT-Lizenz)** als Chart-Bibliothek — exakt die geforderte
  Optik (Area-Fills, Annotationen, Tooltips, Dark Theme); Heatmap-Serien
  nativ (`type: 'heatmap'`). Framework-freie statische PWA → Pi-tauglich,
  installierbar auf dem Handy.
- **Dashboard-Kacheln:**
  1. **Prognose-Fan-Chart** je Favoriten-Station: Historie + 80 %/95 %-Bänder,
     Sprung-Marker, „Jetzt günstig?"-Badge (P(p ≤ Tagesmedian)).
  2. **Heatmap Preisniveau** (DoW × Stunde, Median 6 Wochen, grün→rot).
  3. **Heatmap Cheap-Probability** (DoW × Stunde, P(p ≤ Stadtmedian)) — die
     handlungsrelevante Karte „wann tanken".
  4. **Top-10-Ranking** mit δ̂-Balken + Bootstrap-KI-Whiskern (Stil wie
     `docs/analysis/figures/top_selection.png`).
  5. **Konfidenz-Badge** (Rolling-PICP, §3.3) + Puffer-/System-Status.
- **Google Maps Navigation:** kostenfreie Universal-Links, **kein API-Key**:
  `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>&travelmode=driving`
  (iOS-Fallback `comgooglemaps://?daddr=…`). Karten-*Embed* bewusst nicht
  geplant (Key/Kosten/DSGVO); Station-Karte optional über freies
  OpenStreetMap/Leaflet(s) ohne Key.

---

## 6. Systemarchitektur: Aufgabenverteilung Pi ↔ NAS

### 6.1 Rollen & Datenfluss

| Aufgabe | Gerät | Begründung |
|---|---|---|
| Collector (Poll alle 5 min, Fenster 06–24) | **Pi** | muss 24/7 bereit sein |
| Kurzzeit-Puffer | **Pi: tmpfs** `/dev/shm/tankapp` | RAM statt SD → **SD-Schonung** wie bei deiner Temperatur-Lösung |
| Langzeit-Speicher | **NAS: InfluxDB (Docker)** | Plattenplatz, Retention-Policies |
| Hosting TankPuls-API + Frontend | **Pi** | FastAPI + statische Dateien, autark auch bei NAS-Ausfall |
| Historie für Engine | NAS primär; Pi hält lokale Cache-Aggregate (Parquet) | degradierter Modus ohne NAS |

1. Collector appended je Poll eine JSON-Zeile an
   `/dev/shm/tankapp/YYYY-MM-DD.jsonl`.
2. Ringpuffer: Dateien > 7 Tage werden gelöscht.
3. Uploader pingt NAS (TCP 8086) alle 60 s; bei Erreichbarkeit Batch-Transfer
   unbestätigter Zeilen als Line Protocol; Ack via `meta.synced_until`.
   **Idempotent** (s. §1.2) → kein Dubletten-Problem nach Reconnects.
4. NAS-Ausfall: bis zu **7 Tage** Puffertiefe (Urlaubssicher); bei Überlauf
   FIFO + Dashboard-Alarm.

### 6.2 Ressourcen-Rechnung (mit deinen `free -h`-Werten)

Gegeben: **RAM 921 Mi total / 571 Mi verfügbar**, Swap 920 Mi (44 Mi belegt).

| Posten | Bedarf |
|---|---|
| Collector + Uploader (Python) | ~40–60 MiB RSS |
| FastAPI/uvicorn (TankPuls) + statisches Frontend | ~60–80 MiB |
| tmpfs-Ringpuffer (Limit 32 M) | ≤ 32 MiB |
| **Summe** | **< 180 MiB → ~390 MiB Reserve** |

**Datenvolumen:** JSONL ≈ 2,5 kB pro Poll (10 Stationen) → 216 Polls ≈
**0,6 MB/Tag ≈ 4 MB/Woche** (tmpfs-Limit 32 M = 8-fache Reserve; selbst 100
Stationen blieben unproblematisch). InfluxDB: 5 760 Punkte/Tag à ~20–60 B
TSM-komprimiert → **≤ 0,4 MB/Tag ≈ 150 MB/Jahr**.

**Urteil: Der Ansatz reicht aus — mit komfortabler Reserve.** Er ist exakt
das gleiche bewährte Muster wie deine Temperatur-Anzeige, nur mit einem
Ack-basierten Idempotenz-Protokoll zum NAS obendrauf.

### 6.3 SD-Karten-Härtung & Betrieb

```ini
# /etc/fstab
tmpfs  /dev/shm/tankapp  tmpfs  defaults,noatime,size=32M,mode=0755  0  0
# /etc/sysctl.d/99-tankapp.conf
vm.swappiness=10
vm.vfs_cache_pressure=50
```
- `log2ram` (oder journald-Limits) für `/var/log`, `noatime` auf `/`.
- systemd-Units (collector, uploader, api) mit `WatchdogSec=30`,
  `Restart=always`; **NTP ist Pflicht** (Timestamp = Primärschlüssel).
- NAS als Docker: `influxdb:2` + Volume; Retention z. B. 5 Jahre;
  wöchentliches Influx-Backup auf Share. Pi hostet via uvicorn auf 0.0.0.0,
  CORS eng; externer Zugriff optional via Caddy (TLS).
- Keys (Tankerkönig, TankPuls-Privatkeys) nur in `/etc/tankapp/env`
  (chmod 600), nie im Repo.

### 6.4 Hardware-Bewertung NAS/RPC (Stand: Anfrage Hardware-Vergleich)

| Kandidat | Eignung für InfluxDB + Grafana | Urteil |
|---|---|---|
| **NAS: Intel Pentium Silver J5040 (4 Kerne, 2.0 GHz), 16 GB RAM** | InfluxDB-Ingest: 5 760 Punkte/Tag → CPU-Last praktisch 0; RAM-Bedarf InfluxDB ≈ 1–2 GB, Grafana ≈ 0,3 GB → 16 GB massig; Docker-fähig (sofern NAS-OS Container zulässt: UGREEN/TerraMaster-TOS/TrueNAS/OMV ja) | ✅ **Reicht völlig aus — Empfehlung** |
| Privat-PC: Ryzen 7 5700X, 32 GB, RX 9070 XT | Fachlich ebenfalls völlig ausreichend, aber für diese Aufgabe ~20× überdimensioniert; **Idle-Stromverbrauch ~50–90 W** (GPU-System) vs. NAS ≈ 10–15 W → bei 24/7 grob **85–150 €/Jahr Strom vs. ~30–40 €** (bei ~0,30–0,40 €/kWh) | ❌ unnötig & teuer im Dauerbetrieb; GPU bringt hier nichts (kein GPU-Training; LightGBM-Backtests laufen in Sekunden auf CPU) |

**Empfehlung: NAS (J5040).** Die Kombination „Pi = 24/7-Collector + Hosting,
NAS = Zeitreihen-Datenbank" ist die Architektur mit der niedrigsten
jeweils nötigen Leistung je Rolle. Der PC kann optional für rechenintensive
*Einmal-Analysen* (große Backtest-Serien, Jupyter) dienen — muss dann aber
nicht dauerhaft laufen; WOL (Wake-on-LAN) am NAS ausreichend.

---

## 7. Fahrzeugparameter — wichtig oder nicht?

**Ja, wichtig — als Entscheidungs-/Ökonomie-Parameter, nicht als
Prognose-Input.** Drei konkrete Stellen:

1. **Kraftstoffart** wählt die Preisreihe. E5↔E10 korrekt vergleichen heißt
   *äquivalenter Preis*: E10 verbraucht ~1–2 % mehr → E5 lohnt erst bei
   p_E5 ≤ ~1,015·p_E10 (≈ 4–5 ct Differenz).
2. **Tankvolumen V / Tankmenge L** skaliert die Ersparnis linear:
   €/Füllung = Δp·L → bei 40 L zählt jeder ct ≈ 0,40 €. Parameter der
   Selektion (§2) und der API (§8).
3. **Umweg-Ökonomie:** Netto = Δp·L − K(Umweg), mit
   **K = d·(c/100)·p + (d/v)·z** —
   d = Umweg **gesamt** (Hin+Rück) in km, c = Verbrauch L/100 km,
   v = Durchschnittsgeschwindigkeit, z = Zeitwert €/h.
   Kritische Preisdifferenz **Δp\* = K/L**: ein Umweg lohnt erst, wenn der
   Preisvorteil diese Schwelle übersteigt.
   Beispiel: einfacher Umweg 6 km → d = 12 km gesamt, c = 7, p = 1,65 €/L,
   v = 50 km/h, z = 12 €/h ⇒ K = 12·0,07·1,65 + (12/50)·12 =
   1,39 € Sprit + 2,88 € Zeit = **4,27 €** ⇒ bei L = 40 L lohnt sich der
   Umweg erst ab **Δp\* ≈ 10,7 ct/L** — und der Zeitwert dominiert.

   **Zwei Betriebsmodi, beide in der Pipeline implementiert** (`--trip-mode`):
   - `dedicated` (Extrafahrt von zuhause): fast nie lohnend — im Demo-Lauf
     ist bei 12 €/h Zeitwert **keine** Station netto positiv. Das ist ein
     ehrliches Ergebnis: Spritsparen per Extrafahrt ist meist ein Verlustgeschäft.
   - `onroute` (Tanken ist ohnehin unterwegs; nur der Mehrweg gegenüber der
     nächstgelegenen Station zählt): der realistische Alltagsfall; hier
     entscheiden δ̂ und Entfernung gemeinsam.
   Die Selektion liefert je Station P(Netto > 0) aus der Bootstrap-Verteilung
   von δ̂ und das konservative Flag „Netto-KI-Untergrenze > 0".
   ⇒ Tankvolumen + Verbrauch + typische Tankmenge + Referenzpunkt gehören ins
   Fahrzeugprofil; genau damit rechnen `analysis/station_selection.py
   (--home/--consumption/--value-of-time/--trip-mode)` und API-Endpunkt
   `/v1/route/evaluate`.

---

## 8. TankPuls — öffentliche API (5 Endpunkte)

Auth: anonym (**60/min, 10 000/Tag**) oder Header `X-Api-Key`
(**300/min, 50 000/Tag**). JSON/UTF-8, Zeiten Europe/Berlin,
`Cache-Control` an `/v1/health` aus. Implementierung: FastAPI auf dem Pi.

### `GET /v1/stations` *(vorgegeben)*
Tankstellen im Umkreis, sortiert nach Preis oder Entfernung.

| Parameter | Typ | Bedeutung |
|---|---|---|
| `lat`, `lon` | number | Zentrum (WGS84), Pflicht |
| `radius` | number | km, Default 5, **max 25** |
| `fuel` | enum | `E5` · `E10` · `Diesel`, Default `E10` |
| `sort` | enum | `price` · `distance`, Default `price` |

Antwort: `[{id, name, brand, lat, lon, dist, price, is_open, stale_minutes,
maps_url}]` — `maps_url` ist der Google-Deep-Link aus §5.

### `GET /v1/stations/{id}/forecast`
`?fuel=E10&horizon=0|3|7` → Zeitreihe `[{t, yhat, lo80, hi80, lo95, hi95}]`
+ `{mase_24h, picp_7d, confidence_badge, fitted_at}`.

### `GET /v1/heatmap`
`?station_id=…&fuel=E10&kind=level|probability&weeks=6` → Matrix
`dow × hour` (Mediane bzw. Cheap-Probabilities) + Farbskalen-Grenzen.

### `GET /v1/route/evaluate`
`?station_id=…&liters=40&detour_km=6&consumption=7.0&value_of_time=12` →
`{delta_ct, gross_eur, detour_cost_eur, net_eur, worth_it}` (Formeln §7).

### `GET /v1/health`
Collector-Stand, NAS-Erreichbarkeit, tmpfs-Füllstand & -Oldest-Age,
Stations-Coverage, letzte Fehler.

---

## 9. Noch nicht gestellte, aber wichtige Fragen (Lücken-Checkliste)

Priorisiert: **P0** = muss vor/direkt nach M1 geklärt sein, **P1** = vor
Rollout, **P2** = Verbesserung später. Zu jedem Punkt: warum er zählt und
wie das Konzept ihn abfängt.

### Daten & Markt

| P | Frage | Warum wichtig | Abdeckung im Konzept |
|---|---|---|---|
| **P0** | **Woher kommen die historischen Daten der 3 Städte — Auflösung, Zeitraum, Quelle (MTS-K-Rohdaten)?** | Die Selektion braucht ≥ 6–8 Wochen und idealerweise ≤ 15-Min-Auflösung; stündliche Daten schwächen die Harmonischen-Fits, Lücken < 85 % Coverage → Stations-Ausschluss | CSV-Schema (`analysis/README.md`), Coverage-Gate; bei Grob-Auflösung: Pipeline läuft trotzdem, aber R²/beste-Stunde-Aussagen schwächer — im Report sichtbar |
| **P0** | **Sind die 20+ Stationen der Historie überhaupt meine real erreichbaren?** | Die Analyse rankt nur, was im Datensatz ist; Pendelrouten/Fernstraßen müssen im Sampling enthalten sein | `--home` je Stadt + `onroute`-Modus; vor Sichtung: Liste mit `--rank-by score` prüfen |
| **P0** | **E10-Verträglichkeit des Autos?** | Wenn das Fahrzeug kein E10 darf (ältere Modelle), ist die ganze E10-Selektion wertlos — dann Analyse mit `--fuel E5` wiederholen | Pipeline-Parameter; Konzept §7 Punkt 1 (Äquivalenzpreis) |
| **P1** | **Rabatt-/Kartenprogramme (Payback bei Aral, DeutschlandCard, ADAC-, Firmen- oder Flottenkarten)?** | 2–4 ct äquivalenter Rabatt können das Stations-Ranking **umdrehen** — größer als viele δ̂ | persönlicher Rabatt je Marke als Parameter (geplant: `--brand-rebate "ARAL:0.02;HEM:0.0"`); heute: Top-10 der eigenen Karten-Marke gesondert betrachten |
| **P1** | **Wann tanke ich wirklich?** (echtes Wochen-/Tagesprofil) | AV-Score und Heatmaps nutzen ein Default-Pendlerprofil; Schichtdienst/Homeoffice ändern die optimale Station | Gewichtungsprofil w(h) als Config (TODO: CLI-Flag), Empfehlung aus eigenen Tankbelegen kalibrieren |
| **P1** | **Lebenszyklus der Stationen** (Umbau, Betreiberwechsel, Schließung) | δ̂ ist nur so lange gültig, wie die Preispolitik stabil ist | Re-Selektions-Kadenz vierteljährlich (Skript ist idempotent), CUSUM-Change-Alarm in der Engine (Backlog), `status: no prices`-Alarm nach 7 Tagen |

### Mathematik

| P | Frage | Warum wichtig | Abdeckung |
|---|---|---|---|
| **P0** | **Selektionsbias („Winner's Curse"): Die beste von 54 Stationen ist immer auch die mit dem glücklichsten Zufall — wie ehrlich ist ihr δ̂?** | Ohne Validierung überschätzt man die Top-10 typischerweise | **implementiert:** Split-Half-Spearman-ρ je Stadt im Report; zusätzlich Out-of-Sample-Re-Check nach 4 Wochen Live-Betrieb |
| **P1** | Reicht der Stadtmedian als Referenz, oder zählt die **lokale Konkurrenz** (3–5-km-Ring)? | Preisniveau ist räumlich korreliert; ‚günstig für Auerbach-Nord‘ ≠ ‚günstig für Auerbach‘ | Backlog: LOO-Median über k-nächste Nachbarn statt ganzer Stadt; heute: pro Stadtteil getrennte `city`-Werte möglich |
| **P2** | Interaktionen zwischen Stationen (Preisführerschaft, Edgeworth-Zyklen) | Erklärt Sprung-Timing; verbessert Nowcast um Minuten/Stunden | Backlog: Cross-Correlation/Granger-Screening; M2-AR-Nachlauf fängt das Gröbste |

### Technik & Betrieb

| P | Frage | Warum wichtig | Abdeckung |
|---|---|---|---|
| **P0** | **Zeitzone/Sommerzeit + Pi ohne RTC** | 5-Min-Raster mit DST-Doppelstunden korrupt, wenn in Lokalzeit gespeichert; falscher Start ohne NTP | Collector speichert **UTC**, Darstellung erst im Frontend Europe/Berlin; NTP-Wait im systemd-Unit (`After=time-sync.target`) |
| **P1** | Monitoring von Pi **und** NAS (nicht nur die App) | „Still ausgefallen" ist der schlimmste Fehler (Datenlücke statt Fehlermeldung) | `/v1/health` + externer Watchdog (z. B. Uptime-Kuma-Container auf dem NAS), optional ntfy.sh-/Telegram-Push |
| **P1** | Stromausfall/Boot-Reihenfolge | Pi muss nach Stromausfall allein sauber hochkommen | Units `WantedBy=multi-user.target`, tmpfs neu gemountet, Backfill ab NAS, Read-only-/overlayfs für `/` optional |
| **P2** | NAS nur bei Bedarf an: Strom € vs. Komfort | Die Architektur verträgt ein ausgeschaltetes NAS bis zur Puffertiefe | 7-Tage-FIFO, WOL-fähig; Sync-Intervall in Config |

### Recht, Kosten & Produkt

| P | Frage | Warum wichtig | Abdeckung |
|---|---|---|---|
| **P1** | **CC BY 4.0 Namensnennung** sichtbar? | Lizenzpflicht bei MTS-K-Daten | Fußzeile „Daten: MTS-K via tankerkoenig.de (CC BY 4.0)" im Frontend; Lizenz-Feld wird in API-Responses mitgegeben |
| **P1** | Öffentliche API exponieren? | Rate-Limits schützen vor Missbrauch, aber der Pi ist ein schwaches Glied bei Angriffen | Rate-Limiting + Key-Zwang für externe Nutzer, nur lesende Endpunkte, TLS via Caddy, Fail2ban |
| **P2** | Benachrichtigungen („Jetzt 4 ct unter Tagesmedian")? | Höchster Praxisnutzen, aber Push-Infrastruktur nötig | Backlog: ntfy.sh (self-hostbar auf NAS) oder Telegram-Bot; Trigger aus ACI-Band + Schwellenregel |
| **P2** | Historie vergolden: eigene Tankbelege | Ermöglicht echte €-Bilanz vs. Prognose | Backlog: `POST /v1/fillups` + jährliche Effektiv-Bilanz im Dashboard |

---

## 10. Roadmap

| Meilenstein | Inhalt | Fertig-Kriterium |
|---|---|---|
| M1 | Collector + tmpfs-Ringpuffer + NAS-Uploader laufen 14 d | Datenlücken < 2 %, Ack-Protokoll fehlerfrei |
| M2 | **Selektion mit echten Historien der 3 Städte** (Pipeline fertig in `analysis/`) | Top-10 gewählt, q < 0.05, Report archiviert |
| M3 | Zeitreihen-Engine M1–M3 + ACI + Backtest | MASE(24 h) < 0,8 und PICP(95 %) ∈ [90, 98] % |
| M4 | PWA-Dashboard (Fan, 2 Heatmaps, Top-10, Maps-Links) | Lighthouse > 90 |
| M5 | TankPuls: 5 Endpunkte + Rate-Limits + Keys | OpenAPI-Doku + Tests grün |
