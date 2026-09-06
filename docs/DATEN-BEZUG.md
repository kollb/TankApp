# Datenbezug – Tankerkönig-Historie (Anleitung, Stand 2026-09-06)

Kurzfassung für die drei Fragen aus der Anfrage:

| Frage | Antwort |
|---|---|
| **Gesamtes Repo klonen?** | **Nein.** ~100 GB Arbeitsbaum + ~25–50 GB `.git` → 125–150 GB, ~1,5 h Download bei 25 MB/s (bei 5 MB/s: ein Tag), und >99 % davon brauchst du nicht. |
| **Reicht 2025/2026?** | **Ja — aber nicht per git.** `git sparse-checkout` verkleinert nur den Arbeitsbaum (mit `--no-checkout` auch den Platzbedarf), **nicht den Download**; und Gitea unterstützt `git clone --filter=blob:none` (Partial Clone) standardmäßig nicht. Richtig: die Tagesdateien **direkt per HTTP** holen → 613 Tage (2025-01-01…2026-09-05) ≈ **12,6 GB**, als `.gz` **≈ 1,5 GB**. |
| **Wo ausführen?** | **Erst am PC (20 Min.), dann als Cron auf dem NAS.** Der Pi 2 ist dafür die falsche Maschine (1 GB RAM, 512 kB Cache, SD-Kartenverschleiß); er bleibt Collector. |

**Dein erster Schritt ist ein Befehl, kein Commit:** `git pull` dein TankApp-Repo, Zugangsdaten in `~/.netrc` legen, dann
`python3 data-tools/fetch_history.py --since 2025-01-01 --dry-run` — das zeigt dir **die echten Dateigrößen und die
Rechengröße deines Anschlusses**, ohne etwas zu laden (Kapitel 4).

---

## 1. Was im Datenrepo liegt (und was es wiegt)

Struktur (pro Tag genau **eine** Datei, bundesweit):

```
prices/YYYY/MM/YYYY-MM-DD-prices.csv        date,station_uuid,diesel,e5,e10,dieselchange,e5change,e10change
stations/YYYY/MM/YYYY-MM-DD-stations.csv     uuid,name,brand,street,house_number,post_code,city,latitude,longitude
```

Zwei Eigenschaften bestimmen die ganze Strategie:

1. **Änderungsprotokoll, kein Zeitreihen-Schnappschuss.** Eine Zeile existiert, wenn sich *irgendein* Kraftstoff einer
   Station geändert hat; die übrigen Spalten tragen den alten Preis (`*change = 0`). 2019 waren das
   **~390 000 Zeilen/Tag bei ~20,6 MB** (30 Tage November 2019, öffentlicher Spiegel
   `gustavz/tankerkoenig_dataset`, per GitHub-API nachgemessen) — im Schnitt also **~28 Preisereignisse je Station und Tag**, ≈ alle 30–40 min eines.
   → Deine Historie ist **dünn besetzt**. `analysis/station_selection.py` misst Abdeckung auf einem 5-min-Raster; für
   übernommene Historie gehört deshalb `--step-min 30` gesetzt (Kapitel 5.3).
2. **Kein Selektionsfilter im Rohformat.** Du lädst 14 000 Stationen, um ~150 zu brauchen. Der Filter läuft bei dir
   (Kapitel 5.2) — das ist der eigentliche Datensparsamkeits-Hebel: **12 GB laden, ~150 MB behalten.**

Größenordnung (Hochrechnung aus der Messung; ±25 % sind egal, `--dry-run` liefert deine echten Zahlen):

| Zeitraum | Tage | roh | als `.gz` | Download @100 Mbit | @10 Mbit |
|---|---:|---:|---:|---:|---:|
| 2014-06 … 2026-09 (Alles) | ~4 470 | ~90 GB | ~11 GB | ~1,5 h | ~17 h |
| 2024 … 2026 | ~980 | ~20 GB | ~2,5 GB | 35 min | 5,5 h |
| **2025-01-01 … 2026-09-05** | **613** | **~12,6 GB** | **~1,5 GB** | **21 min** | **3,4 h** |
| **60-Tage-Fenster (Minimum)** | **60** | **~1,2 GB** | **~150 MB** | **2 min** | **20 min** |

Das Repo-README selbst spricht von 50 GB (2021) bzw. über 100 GB (heute) für den voll ausgepackten Arbeitsbaum —
konsistent mit ~7,5–10 GB/Jahr bei genau einer Datei pro Tag. Nach oben gilt: Preisereignisse nehmen zu (mehr Stationen, aggressiveres Repricing), die Größen
wachsen also leicht.

## 2. Option A/B/C — warum A

| | A) HTTP-Tagesdateien (`data-tools/fetch_history.py`) | B) git clone + sparse-checkout (2025/2026) | C) git clone (voll) |
|---|---|---|---|
| Geladene Daten | **nur was du bestellst** (~1,5 GB + Overhead) | ~ganzer Repo-Inhalt (Packs aller Jahre), dann Entpacken von 613 Dateien | alles, doppelt (Pack + Arbeitsbaum) |
| Platte danach | 1,5 GB (gz) | 12,6 GB + `.git` (10–40 GB) | ~100 GB + `.git` |
| Dauer Erstanlauf | 20 min–3 h (leitungsfähig, **fortsetzbar**) | Stunden | Stunden, 2× |
| Unterbrechung/Resume | Datei für Datei, setzt automatisch fort | Retry des ganzen Transfers | Retry |
| Tägliches Update | 1 Datei, 20 MB, 5 s | `git pull` (nur neue Blobs, ok) | `git pull` |
| Benötigt | nur Python 3.8+, Standardbibliothek | git ≥ 2.25 + funktionierende Auth gegen Gitea | wie B, plus Platz |
| Stolperstein | — | **sparse entpackt, was du willst — lädt aber alles**; Gitea ignoriert `--filter` (Partial Clone), das Repo liefert >20 GB unnütze Objekte | SD/Platte voll, 50 GB Pack-Arbeit beim ersten `git pull` |

**B ist nicht falsch, wenn du sowieso alles willst und das NAS 120+ GB frei hat** — dann ist sparse-checkout die
saubere Betriebstechnik, weil `git pull` danach minimal überträgt. Fürs **Erste Mal** ist A schneller, bruchsicherer
und du behältst nur komprimierte Rohkost, statt einen halben Baum zu horten.

Wenn du es trotzdem mit B testen willst (Kapitel 9.2) — in zwei Minuten geprüft, ob der Server Partial Clone
überhaupt annimmt:

```bash
git clone --filter=blob:none --no-checkout https://data.tankerkoenig.de/tankerkoenig-organization/tankerkoenig-data.git /tmp/probe
du -sh /tmp/probe      # >1 GB? Abbruch (Strg-C) — der Server schickt dir die ganze Historie
```

## 3. Zugangsdaten: einmal richtig ablegen

Der API-Key aus der Mail ist **persönlich** und landete bisher in einem Chat-Fenster — bitte im Datenportal neu
erzeugen/rotieren, bevor du automatisierst. Nicht in die Shell-History, nicht ins Repo
(dein `.gitignore` schützt `config.local.json`, aber keine URL mit `user:token@...` in irgendwelchen Logs).

```bash
# PC/NAS: netrc statt Token-in-URL (chmod schützt vor Mitlesen, Skripte brauchen keine Secrets mehr)
cat > ~/.netrc <<'NETRC'
machine data.tankerkoenig.de
  login koll.bernhard_gmail.com
  password <NEUER-API-KEY>
NETRC
chmod 600 ~/.netrc
```

Das fetch-Skript liest `~/.netrc` automatisch (Alternative: `TK_LOGIN`/`TK_TOKEN`, oder `--login/--token` für
Einmallauf, oder `~/.config/tankapp/env` per `EnvironmentFile` im systemd-Unit — Keys gehören wie in KONZEPT.md §9.3
nach `/etc/tankapp/env` mit `chmod 600`).

## 4. Schritt 0 — dry-run: dein Anschluss, deine Zahlen

Vom PC im Heimnetz (der Pi kann das auch, ist aber die falsche Maschine dafür):

```bash
cd ~/dev/TankApp && git pull
python3 data-tools/fetch_history.py --since 2025-01-01 --dry-run
# # data.tankerkoenig.de  auth als koll.bernhard_gmail.com
# # 613 Dateien im Bereich 2025-01-01..2026-09-05, davon 613 zu laden
#   prices   2026-09-04     21.4 MB
#   prices   2026-09-05     20.9 MB
# # Ø 21.1 MB/Datei → Hochrechnung: 12.9 GB Download, ≈ 1.6 GB auf der Platte (gz)
# #   bei 15.0 MB/s ≈ 9.7 h (inkl. 0.4s Pause/Datei: +0.07 h)
```

Die Zeile mit der Hochrechnung entscheidet über deinen weiteren Abend: alles unter ~30 min → direkt los (Schritt 1).
Darüber → erst 60-Tage-Fenster laden (Schritt 1b) und den Rest über Nacht nachziehen.

## 5. Schritt 1 — laden (PC), Schritt 2 — Ingest, Schritt 3 — Selektion

### 5.1 Schritt 1: 60-Tage-Beweis, dann Vollausbau

```bash
cd ~/dev/TankApp

# 1a) Anprobieren: 5 Tage, dauert <1 min — prüft Auth, Format, Platte
python3 data-tools/fetch_history.py --since 2026-07-01 --until 2026-08-31 --only 5
ls -lh data/raw/prices/*/*/            # ~2–3 MB pro .gz-Datei
zcat data/raw/prices/2026/08/*-prices.csv.gz | head -2   # Header: date,station_uuid,diesel,e5,e10,…

# 1b) Kurzfrist-Historie: 60 Tage reichen für Coverage-Gate + erste δ̂-Schätzung
python3 data-tools/fetch_history.py --since 2026-07-08 --until 2026-09-05

# 1c) Voll: 2025/2026 — läuft nebenher, jederzeit Ctrl-C, beim nächsten Run geht's weiter
python3 data-tools/fetch_history.py --since 2025-01-01 --until 2026-09-05
# 1d) optional, wenn Platte da ist und du Zyklen über Jahre sehen willst: 2024 … 2026
python3 data-tools/fetch_history.py --since 2024-01-01 --until 2024-12-31
```

Dazu die **eine** Tankstellenliste (Name, Marke, PLZ, Koordinaten — brauchst du für die Radius-Selektion):

```bash
python3 data-tools/fetch_history.py --stations-latest     # ~10–15 MB, eine Datei
```

> Kein `--until today`: die Datei für „heute" erscheint erst morgen früh (nächtlicher Export). Der Loader zählt
> fehlende Tage als `nicht gefunden` und bricht nicht ab — aber sauberer ist `yesterday` als Obergrenze.

### 5.2 Schritt 2: aus 12 GB Rohkost ~150 MB Analysefutter machen

```bash
# Privatdaten bleiben in der gitignorierten Config (analysis/config.local.json, Vorlage: config.local.example.json)
python3 data-tools/ingest_history.py \
    --config analysis/config.local.json \
    --anchor "Muenchen:48.1374,11.5755" --anchor "Koeln:50.9375,6.9603" \
    --radius 25 --resample 30 --density 60 --city campaign \
    --out data/ready --qa data/ready/QA.md
```

| Flag | Was es dir bringt |
|---|---|
| `--radius 25` + `--anchor` | Datensparsamkeit: nur Stationen im Umfeld (Home aus `config.local.json`, Kampagnen per Flag). **Straße/Hausnummer werden nie eingelesen** — Adressen landen also nicht in `data/`. |
| `--resample 30` | ~28 Einzelereignisse/Tag → Median je halbe Stunde, Intraday-Zyklus bleibt erhalten. `0` = änderungsgenau. Größer als das Dichte-Raster zu setzen bringt nichts: die Ausgabe läuft immer über `max(resample, density)`. |
| `--density 60` | schreibt zusätzlich den **gültigen Stand auf einem Minuten-Raster** (max. `--max-hold 720` min alt, Nachtpausen werden nicht erfunden) — damit die dünne Änderungs-Historie nicht als Lücke zählt. Kosten gemessen: 60 min ≈ **+12 %** Zeilen, 30 min ≈ **+15 %**, 5 min ≈ **×12** (288 Zeilen/Station/Tag). |
| `--city campaign` | eine Kampagne = **ein Markt** (Frankfurt-Umland + Offenbach + Bad Homburg sind ein zusammenhängendes Preissystem; dein 25-km-Radius wird sonst zu 30 Kleinstädten mit je 1–2 Stationen, und die Selektion braucht ≥ 2 Stationen je `city`, sonst wirft sie die Stadt raus). |
| `--compress` | komprimiert zusätzlich die *fertigen* CSVs (≈8×). Die Rohdateien komprimiert `fetch_history.py`
     schon; pandas/parquet lesen `.csv.gz` transparent. |
| `--fuel e10` | nur die Primär-Sorte (Empfehlung für den ersten Lauf: 3× Platz und Zeit gespart). Diesel/E5 kannst du mit zweitem Lauf nachziehen, der Preis ist identisch. |

Der Lauf schreibt `data/ready/<kampagne>_hist.csv(.gz)` im **Schema aus `analysis/README.md`**
(`timestamp,station_id,station_name,brand,city,lat,lon,fuel,price`), dazu `manifest.json` (Zeilen, Tage, Stationen)
und `QA.md` (fehlende Tage, Coverage je Station×Kraftstoff, verworfene unplausible Preise).

Gemessene Kosten je Station×Kraftstoff (Demo-Rohdaten im echten Format, 21 Tage, `--fuel e10`):

| Ingest-Konfiguration | Zeilen/Station/Tag | 136 St. × 21 T | 136 St. × 365 T | 20 St. × 365 T (Top-N nach Selektion) |
|---|---:|---:|---:|---:|
| `--resample 0 --density 0` (nur Änderungen) | 16,5 | 6 MB | ~100 MB | ~15 MB |
| `--resample 30 --density 60` (Selektion, Default) | 25,6 | 8 MB | ~130 MB | ~19 MB |
| `--resample 0 --density 5` (Engine, lückenlos) | 307 | 95 MB | ~1,6 GB | ~230 MB |

→ Die Ready-Daten sind **kein** Platzproblem (130 MB für ein Jahr × 136 Stationen); die Rohdateien sind es.
Der teure Teil ist das **einmalige** Durchlesen von 613 × 20 MB: gemessen ~2 300 Zeilen/s pro Kern in der
Standardbibliothek (≈ 3 min je 100 Tage auf dem NAS, ≈ 1 min auf dem PC) — die Auswahl selbst kostet nichts.

Nützlich für späteres Backfill ohne Neuladen: `--since/--until` begrenzen den Ingest auf einen Zeitraum, die
Rohdateien bleiben unverändert liegen (Single Source of Truth = `data/raw/`).

### 5.3 Schritt 3: Selektion — und zwar gleich so

```bash
pip install -r analysis/requirements.txt          # numpy/pandas/matplotlib/holidays
python3 analysis/station_selection.py \
    --data data/ready/frankfurt_hist.csv.gz data/ready/muenchen_hist.csv.gz data/ready/koeln_hist.csv.gz \
    --fuel E10 --top 10 --step-min 30 \
    --config analysis/config.local.json --subdiv "Muenchen:BY;Koeln:NW"
```

`--step-min 30` passt zur Kadenz der übernommenen Historie (28 Ereignisse/Tag). Der Default (`5`) funktioniert
inzwischen auch — `to_matrix()` füllt Lücken automatisch bis zur dreifachen Median-Kadenz nach — aber ein
5-min-Raster auf 30-min-Daten ist nur teure Kosmetik (`--ffill-minutes` überschreibt die Automatik, z. B. `30`
fürs alte Verhalten: jede Lücke > 30 min gilt als unbekannt).

### 5.4 Abnahme-Kriterien für Schritt 1–3 (danach kennst du deine Datenqualität wirklich)

- `QA.md`: **fehlende Tage ≤ 1 %** des Zeitraums; Coverage-Median ≥ 85 % je Station×Kraftstoff; sonst `--min-coverage`
  **nicht** senken, sondern Zeitraum/Radius/Kadenz ändern (Kapitel 5.3).
- Rohdaten zählen: `zcat data/raw/prices/2026/08/2026-08-15-prices.csv.gz | wc -l` → **350 000…450 000** für einen
  normalen Tag 2026 (Messwert 2019: 390 000). Deutlich weniger = Download abgebrochen/Tag teilleer → `--force` für diesen Tag.
- Plausipreise: `zcat … | head -3` zeigt `1.789`-Form. Steht dort `178.9` oder `1789`, normalisiert der Ingest
  automatisch (Kapitel 10, Zeile Exportformat-Variante).
- Report: `docs/analysis/report_top10.md` hat ≥ 2 Städte, `q`-Spalte gefüllt, Split-Half-ρ ≥ 0,8 (sonst sind 60 Tage
  zu kurz — auf 180 Tage erweitern, Kapitel 7).
- **Erst danach** entscheidet sich M2 (M2-Meilenstein in KONZEPT.md §13) auf echten Daten.

## 6. Betrieb: tägliches Update (NAS), Engine-Futter monatlich

```bash
# /etc/cron.d/tankapp-history  (NAS, Root-Cron oder Benutzer-Cron mit Pfad zur netrc)
# 06:20 — Export des Vortags liegt seit ~01:00; --delay schont den Server
20 6 * * *   tank    TK_BASE=https://data.tankerkoenig.de/tankerkoenig-organization/tankerkoenig-data HOME=/home/tank \
              /usr/bin/python3 /srv/tankapp/TankApp/data-tools/fetch_history.py --since yesterday --quiet \
              >> /srv/tankapp/data/raw/fetch.log 2>&1
# 1. im Monat: Ingest nachziehen (30 neue Tage à 20 MB — dauert Minuten)
10 4 1 * *   tank    /usr/bin/python3 /srv/tankapp/TankApp/data-tools/ingest_history.py \
              --config /srv/tankapp/TankApp/analysis/config.local.json --radius 25 \
              --resample 30 --density 60 --out /srv/tankapp/data/ready --quiet >> /srv/tankapp/data/raw/ingest.log 2>&1
```

Synology/QNAP: Aufgabentyp **Geplantes Skript** (root) mit demselben Inhalt; `python3` existiert auf DSM nur mit
Python3-Paket — sonst Skript auf dem PC per SSH abfeuern (`ssh nas 'python3 …'`), NAS-Idle ist trotzdem niedriger als
PC-Dauerbetrieb (KONZEPT.md §9.4).

**Warum nicht `git pull`?** Wenn du Option B/C fährst, ist `git pull` natürlich korrekt (1 Tag ≈ 20 MB, minimaler
Delta-Overhead). Option A/A' braucht nur den Cron — und hat keinen 50-GB-Repo als Betriebsrisiko.

**Etikette gegenüber dem Daten-Server:** eine Datei nach der anderen (`--delay 0.4`), nachts ziehen, bei HTTP 429/503
automatischer Backoff (4 Versuche, exponentiell). Kein paralleles `curl`-Feuerwerk, kein Verteilen der CSVs oder des
Keys — die Lizenz (CC BY-NC-SA 4.0) verbietet kommerzielle Nutzung, und dein Key ist personengebunden.

## 7. Die entscheidende Reduktion: was du *wirklich* brauchst

| Zweck | Was reicht | Aufwand |
|---|---|---|
| **M2 Selektion (KONZEPT.md §13)** — δ̂, KI, FDR, Zyklusfit | 120–180 Tage × 25-km-Radius, `--resample 30 --density 60` | 2,5–3,7 GB Download, **~50–70 MB Ergebnis** |
| **Engine-Trainingsdaten (M3)** — 5-min-Reprisen für Nowcast | 365 Tage × Radius, `--resample 0 --density 5` | 7–12 GB Download, **~0,15–0,25 GB Ergebnis** (20 Stationen) / ~1,6 GB (alle 136) |
| **Feiertags-/Jahreszeiteneffekte** | 2 volle Jahre (2025/2026) | +6 GB |
| **Marktstruktur über Jahre (Option, Workshop-Modus)** | Vollhistorie ab 2014, nur `stations`-Snaps monatlich | ~12 GB gz, Stunden |
| **Live-Betrieb** | **nichts davon** — dein Collector (KONZEPT.md §1.2) erzeugt die Serie selbst; Historie = Kaltstart | 0 |

Konsequenz: **60–180 Tage reichen für den ersten M2-Lauf.** Alles darüber ist Komfort. Wenn die Leitung langsam ist,
lädt der Cron die Restjahre einfach über Wochen nebenher (fortsetzbar, idempotent) — du blockierst nichts.

## 8. Hardware — und warum der Pi 2 verliert

| Gerät | Rolle hier | Urteil |
|---|---|---|
| **PC Ryzen 7 5700X / 32 GB** | Erster Bulk-Download + Ingest (12 GB, 613 Dateien) | ✅ **einmalig genau dafür**: 613 × 20 MB in ~20 min, Ingest ~3 min, Selektionslauf (136 Spalten × ~1 000 Rasterzeilen, B = 2 000) in Sekunden |
| **NAS J5040 / 16 GB** | **Speicher** für `data/raw` (1,5–12 GB gz) + täglicher Cron + Ingest/Monat | ✅ dafür gebaut: 4 Kerne @10 W, Platte statt SD. Ingest von 613 × 20 MB dauert hier ~25–45 min (gut, wenn's nachts läuft) |
| **Pi 2 (ARMv7, 1 GB RAM)** | nix mit Bulk; bleibt Collector/API (KONZEPT.md §9) | ❌ 613 einzelne HTTPS-Requests = Stunden; deflate an der 512-kB-Cache-CPU bremst den ganzen Kasten; Ingest eines Jahres braucht mehrere GB Zwischenspeicher → Swap-Tod; und 12 GB auf der SD-Karte sind ein Schreibzyklus-Programm |
| Azure ≤ 5 €/Mon | Rand für Fernzugriff | ❌ kein Vorteil: Daten liegen zu Hause, Traffic kostet |

**Faustregel:** *einmal* am PC (20–60 min), *danach* NAS-Cron, *Pi* nie. Wenn du es doch auf dem Pi lassen willst:
`--raw-no-gzip` (kein Komprimieren auf der Pi-CPU), `--delay 2`, Zielverzeichnis auf NAS-Mount — nie auf die
SD-Karte — und den Ingest auf PC/NAS lassen.

## 9. Kochrezepte (Kopiervorlagen)

### 9.1 PC (Debian/Ubuntu, 2026-09-06)

```bash
# 0) Repo + Werkzeug
cd ~/dev && git clone <dein TankApp-Remote> && cd TankApp && git pull
python3 -V          # ≥ 3.8 nötig (nur Standardbibliothek im data-tools-Teil)

# 1) netrc (Kapitel 3), dann Größen-Check
python3 data-tools/fetch_history.py --since 2025-01-01 --dry-run

# 2) 5-Tage-Test → 60 Tage → Vollausbau (Ctrl-C erlaubt, setzt fort)
python3 data-tools/fetch_history.py --since 2026-07-01 --until 2026-08-31 --only 5
python3 data-tools/fetch_history.py --stations-latest
python3 data-tools/fetch_history.py --since 2026-07-08 --until 2026-09-05
python3 data-tools/fetch_history.py --since 2025-01-01 --until 2026-09-05     # ggf. über Nacht

# 3) Ingest + Selektion (Kapitel 5.2/5.3)
python3 data-tools/ingest_history.py --config analysis/config.local.json --radius 25 \
    --resample 30 --density 60 --city campaign --out data/ready --qa data/ready/QA.md
pip install -r analysis/requirements.txt
python3 analysis/station_selection.py --data data/ready/*.csv --fuel E10 --top 10 --step-min 30 \
    --config analysis/config.local.json --subdiv "Muenchen:BY;Koeln:NW"

# 4) Daten auf das NAS legen (data/ ist gitignored, wandert also nie mit ins Repo)
rsync -a --progress data/ nas:/srv/tankapp/data/
```

### 9.2 git-Alternative (nur wenn du die Vollhistorie willst)

```bash
# NAS/PC, 150 GB frei
git clone --no-checkout --filter=blob:none \
    https://data.tankerkoenig.de/tankerkoenig-organization/tankerkoenig-data.git tkdata
du -sh tkdata/.git        # >1 GB = Server ignoriert den Filter → Strg-C, Option A nehmen
cd tkdata && git sparse-checkout init --no-cone
git sparse-checkout set '/prices/2025/*' '/prices/2026/*' '/stations/2025/*' '/stations/2026/*'
git checkout master       # entpackt ~12 GB; Abbruch ist hier ärgerlich, aber kein Datenverlust
```

Tägliches Update danach: `git pull` (≈ 1 neuer Tag, wenige 10 MB). Vorteil gegenüber A: eine einzige Quelle, `git`
prüft Integrität. Nachteil: 25–50 GB `.git` auf Dauer, und der erste Schritt hängt an der Filter-Unterstützung.

## 10. Fehlerbilder (die tatsächlich auftauchen)

| Symptom | Ursache | Tun |
|---|---|---|
| `404 Page Not Found` im Browser, `Fehler HTTP 404` im Skript | Pfad/Zweig falsch oder **nicht auth** (private Repos antworten mit 404, nicht 401) | `--branch master` prüfen; netrc-Eintrag mit `machine data.tankerkoenig.de` (kein `https://`) |
| `Fehler HTTP 401/403` | Key rotiert/abgelaufen, oder User-Name falsch (`koll.bernhard_gmail.com` ist der Login aus der Mail, kein Tippfehler) | neu im Portal erzeugen, `~/.netrc` aktualisieren |
| `TLS/SSL connection has been closed` / Timeout | Proxy/Firewall (Firmennetz!), IPv6-Experiment, oder Server drosselt | anderes Netz testen; `--timeout 300`; `--delay 2`; Git: `git config --global http.lowSpeedLimit 0; http.lowSpeedTime 999999` |
| Ein Tag fehlt (`nicht gefunden 3`) | Export in dieser Nacht fehlgeschlagen (kommt vor) | Tag einzeln nachladen: `--since D --until D --force`; Lücke in `QA.md` dokumentieren |
| Selektion: `nur 0 Station nach dem Coverage-Gate` | Kadenz vs. Raster (Kapitel 5.3) | `--step-min 30` setzen, Ingest mit `--density 60`; `--min-coverage 0.7` **nur** zum Anschauen |
| Ingest: `Keine Station im Umkreis` | Anker-Koordinaten vertauscht (lat/lon!) oder Radius zu klein | `config.local.json` prüfen: `[lat, lon]`; `--radius 40` testweise |
| Preise wie `1789` oder `178.9` | Exportformat-Variante | macht `parse_price()` automatisch; mit `--price-min/--price-max` (Default 0.5–3.5 €/L) begrenzen |
| `price == 0` / `-1`-Zeilen | „Kraftstoff nicht geführt" (KONZEPT.md §1.2) | werden verworfen — niemals 0 in die Engine; `QA.md` zählt sie als `geprüfte/verworfene Werte` |
| Platz wird knapp | Rohdateien müssen nicht alle bleiben | `--compress` ist Default; alte Jahre löschen, die Ingest-CSV + `manifest.json` reichen als Rekonstruktionsbeleg |

## 11. Befehlsreferenz (Kurzform)

```text
data-tools/fetch_history.py
  --since/--until            Zeitraum, auch 'yesterday'/'today'/'YYYY-MM'/'YYYY'
  --kind prices|stations|both   --stations-latest
  --outdir data/raw          Ziel (auf NAS-Mount legen)
  --dry-run [--probe 5]      Größen + Zeitprojektion, lädt nichts
  --only N                   nur die letzten N Tage des Bereichs (Test)
  --delay 0.4 --retries 4    Server-Schonung + Backoff
  --raw-no-gzip              Platz gegen CPU (Pi)
  --force                    vorhandenen Tag neu laden
  Login:  ~/.netrc | TK_LOGIN+TK_TOKEN | --login/--token

data-tools/ingest_history.py
  --raw data/raw/prices --stations <pfad>   Eingang
  --config analysis/config.local.json      Home-Anker (gitignored)
  --anchor "Label:lat,lon" (mehrfach)      weitere Kampagnen
  --radius 25  --plz 60  --all-stations    Auswahl
  --since/--until                          Zeitraum-Fenster
  --resample 30  --density 60  --max-hold 720   Kadenz der Ausgabe
  --city campaign|station                  Markt-Gruppierung
  --fuel e10 (mehrfach)  --compress  --qa data/ready/QA.md
  → data/ready/<label>_hist.csv(.gz)  (Schema analysis/README.md) + manifest.json

data-tools/make_demo_raw.py --days 21 --outdir data/raw     Demo im echten Rohformat (offline-Test der Kette)
```

## 12. Was danach ansteht (Reihenfolge mit Sinn)

1. **Heute, 20 min:** `--dry-run`, 5-Tage-Test, `--stations-latest`. Du weißt dann: echte Dateigröße, Leitung, Format.
2. **Diese Woche, abends:** 60–180 Tage laden + Ingest + erster Selektionslauf. Ergebnis: echter Report statt Demo-Report.
3. **Parallel:** Collector (M1) anwerfen — die eigene Serie ist wichtiger als jede Historie, weil Historie nie dein
   Poll-Raster, deine `isOpen`-States und deine Fills kennt.
4. **Dann:** Rest 2025/2026 per Cron nachladen lassen, Engine-Fits (M3) mit `--resample 0 --density 5`-Ingest füttern.
5. **Danach (optional):** 2024/2023 für Saisonalität — oder bewusst nie, wenn die 2 Jahre reichen.

*Lizenz: Datensammlung CC BY-NC-SA 4.0 (nicht-kommerziell; kommerzielle Nutzung nur gegen Vertrag mit
info@tankerkoenig.de). Datenquellen-Fußzeile der App wie in KONZEPT.md §1.3 („Daten: MTS-K via tankerkoenig.de,
CC BY 4.0") — die Historie-Sammlung hat eine eigene, strengere Lizenz, beides getrennt nennen.*
