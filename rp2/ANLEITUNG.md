# TankApp RP2 Fallback-GUI – Anleitung

**Ziel:** 24/7 Verfügbarkeit der TankApp über **eine einzige Adresse** — den RP2
(Port 8000). Das NAS ist online → der RP2 leitet transparent zur **vollen
NAS-GUI** weiter. Das NAS ist offline → dieselbe Adresse zeigt die
**Fallback-GUI** (Live-Preise + gecachte Prognosen).

---

## 📋 Übersicht

| Komponente | Gerät | Aufgabe |
|------------|-------|---------|
| **Collector + Uploader** | RP2 | Sammelt Live-Preise, uploadet zu NAS (wie bisher) |
| **Prognose-Berechnung** | NAS | Berechnet Prognosen täglich nach Mitternacht |
| **Vollwertige GUI** | NAS (über RP2-Proxy) | Zeigt alles an (wenn online) — erreichbar unter `<RP2-IP>:8000` **und** `<NAS-IP>:1355` |
| **Fallback-GUI** | RP2 | Zeigt Live-Preise + gecachte Prognosen (24/7), inkl. Dark Mode |
| **Forecast Cache** | RP2 | Lädt Prognosen vom NAS und cached sie |

**Ergebnis:**
- ✅ **F2 (Hier oder woanders?):** Immer verfügbar (Live-Preise aus RP2-Puffer)
- ✅ **F1 (Jetzt oder warten?):** Verfügbar mit gecachten Prognosen (max. 24h alt)
- ✅ **F3 (Heute oder später?):** Verfügbar mit gecachten Prognosen (max. 24h alt)
- ✅ **Eine Adresse:** `http://<RP2-IP>:8000` zeigt automatisch NAS- oder Fallback-GUI

---

## 🛠️ Voraussetzungen

### Auf dem NAS:
- ✅ Private Konfiguration liegt vor (`polling.json`, `data/influx.env`,
  für Prognosen zusätzlich `data/_netrc`) — Prüfung: `bash ops/nas/preflight.sh`
- ✅ TankApp bereits mit `python3 tankapp.py nas-up` gestartet
- ✅ NAS läuft mindestens 6h/Tag (für Prognose-Berechnung)
- ✅ Port 1355 ist erreichbar (Standard-GUI-Port)

### Auf dem RP2:
- ✅ Python 3.11+ installiert (keine pip-Pakete nötig — nur Standardbibliothek)
- ✅ RP2 läuft 24/7 (bereits der Fall)
- ✅ Collector + Uploader bereits aktiv (`tankapp-collector`, `tankapp-uploader`)
- ✅ `/dev/shm/tankapp` als tmpfs gemountet (bereits der Fall)
- ✅ `polling.json` liegt unter `~/TankApp/docs/analysis/stations/polling.json`
  (wie für den Collector, [INSTALL.md](../docs/INSTALL.md) §2.2) — **ohne diese
  Datei fehlen in der Fallback-GUI Stationennamen, Marken und Navigation**
  (die UUID wird angezeigt)

---

## 📥 Schritt 1: NAS aktualisieren

Der API-Endpunkt `/api/v1/last_forecasts` muss auf dem NAS laufen, sonst hat
der RP2 nichts zu cachen.

### 1a) Private Konfigurationsdateien bereitstellen

**Wichtig:** `git clone`/`git pull` liefert nur den Code. Die privaten
Konfigurationsdateien sind gitignored und **müssen einmalig manuell** aufs
NAS — sonst bricht `nas-up` ab. Details und Herkunft: siehe
[docs/INSTALL.md](../docs/INSTALL.md), Abschnitt „Danach auf dem NAS“.

| Datei auf dem NAS | Pflicht? | Woher |
|---|---|---|
| `docs/analysis/stations/polling.json` | **ja** | vom **Pi** (aktives Set nach `activate-polling`) |
| `data/influx.env` | **ja** | selbst anlegen: InfluxDB-Nur-Lese-Zugang |
| `data/_netrc` | für Prognosen | vorhandener Tankerkönig-**Archiv**-Zugang |

`data/apikey.txt` gehört **nicht** aufs NAS — das ist der Collector-Key des Pi.

### 1b) Vorab prüfen, was fehlt

```bash
cd /mnt/user/appdata/tankapp
git pull
bash ops/nas/preflight.sh
```

Das Skript sagt dir vor dem Start, welche Datei fehlt, ob ein Schlüssel in
`influx.env` fehlt und ob die Influx-URL fälschlich auf `localhost` zeigt
(aus dem Container nicht erreichbar). Es liest keine Token aus.

### 1c) Starten

```bash
python3 tankapp.py nas-up
# Unraid: python3 tankapp.py nas-up --uid 99 --gid 100 --archive-dir /mnt/user/data/tankapp
```

Prüfen, dass der Endpunkt antwortet:

```bash
curl -s http://localhost:1355/api/v1/last_forecasts | head -c 300
```

**`"count": 0` ist am Anfang normal, kein Fehler.** Der Endpunkt liefert nur,
was bereits berechnet und veröffentlicht wurde. Bis Archiv und Modelle
durchgelaufen sind, ist die Liste leer — die Fallback-GUI zeigt dann
Live-Preise, aber keine Warte-Empfehlungen. Ohne `data/_netrc` (Archivzugang)
bleibt `count` **dauerhaft** 0.

---

## 📥 Schritt 2: Code auf den RP2 holen

Am einfachsten per `git` direkt auf dem RP2 — dann geht ein späteres Update
mit `git pull`:

```bash
# Auf dem RP2
git clone https://github.com/kollb/TankApp.git ~/TankApp   # nur beim ersten Mal
cd ~/TankApp && git pull
```

Alternativ per `scp` von deinem PC:

```bash
scp -r ~/TankApp/rp2 pi@<RP2-IP>:~/TankApp/
```

---

## ⚙️ Schritt 3: NAS-IP konfigurieren

**Kein `sed` in den Quelldateien!** Die IP wird als Umgebungsvariable gesetzt,
sonst überschreibt der nächste `git pull` deine Änderung.

Die Skripte lesen `NAS_IP` (optional auch `NAS_PORT`, Standard `1355`).

Erst nach Schritt 4 (Services installieren) setzt du die IP dauerhaft.
Zum schnellen Ausprobieren vorab:

```bash
NAS_IP=192.168.178.50 python3 ~/TankApp/rp2/cache_forecasts.py
```

Fehlt `NAS_IP`, beendet sich das Skript sofort mit einer klaren Meldung,
statt endlos ins Leere zu laufen.

---

## 📦 Schritt 4: Abhängigkeiten

**Es sind keine zu installieren.** Beide Skripte nutzen ausschließlich die
Python-Standardbibliothek (`http.server`, `urllib`). Kein `flask`, kein
`requests`, kein `pip`.

Nur prüfen, dass Python vorhanden ist:

```bash
python3 --version   # 3.11+ erwartet
```

---

## 🚀 Schritt 5: Services einrichten

```bash
# Auf dem RP2
sudo cp ~/TankApp/rp2/tankapp-forecast-cache.service /etc/systemd/system/
sudo cp ~/TankApp/rp2/tankapp-fallback-gui.service /etc/systemd/system/
sudo systemctl daemon-reload
```

### NAS-IP als Drop-in hinterlegen

Ein Drop-in liegt außerhalb des Git-Repos und überlebt jedes Update:

```bash
sudo systemctl edit tankapp-forecast-cache
```

Im Editor eintragen (IP anpassen!):

```ini
[Service]
Environment=NAS_IP=192.168.178.50
```

Dasselbe für die GUI (damit sie den Online/Offline-Status erkennt):

```bash
sudo systemctl edit tankapp-fallback-gui
```

```ini
[Service]
Environment=NAS_IP=192.168.178.50
```

### Starten

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tankapp-forecast-cache
sudo systemctl enable --now tankapp-fallback-gui
```

### Läuft der Benutzer richtig?

Die Service-Dateien nutzen `User=pi` und `/home/pi/TankApp/rp2`. Heißt dein
Benutzer anders (z.B. `bkoll`), passe beides an:

```bash
whoami   # zeigt deinen Benutzernamen
sudo sed -i "s|User=pi|User=$(whoami)|; s|/home/pi/|$HOME/|g" \
  /etc/systemd/system/tankapp-forecast-cache.service \
  /etc/systemd/system/tankapp-fallback-gui.service
sudo systemctl daemon-reload
sudo systemctl restart tankapp-forecast-cache tankapp-fallback-gui
```

### Status prüfen

```bash
systemctl status tankapp-forecast-cache
systemctl status tankapp-fallback-gui
journalctl -u tankapp-forecast-cache -n 30
```

---

## 🌐 Schritt 5: Testen

### 1. Prüfe, ob der Cache funktioniert:
```bash
# Cache-Datei prüfen
cat /tmp/tankapp_cache/last_forecasts.json | python3 -m json.tool | head -20
```

### 2. Im Browser öffnen (immer dieselbe Adresse):
```
http://<RP2-IP>:8000
```
(Ersetze `<RP2-IP>` mit der IP deines RP2)

- **NAS online:** du siehst die **vollwertige NAS-GUI** (React, Live-Charts,
  System-Panel) — der RP2 proxyst das transparent weiter. Proxied ist, was
  auch unter `<NAS-IP>:1355` läuft.
- **NAS offline:** du siehst die **Fallback-GUI** (Markierung
  „FALLBACK · RP2“ oben rechts) mit:
  - Status-Pills: NAS-Status + echtes Alter der Preise („Preise: 7 min alt · 8/10 offen“)
  - Treibstoff-Umschalter **E10 / E5 / Diesel**, einstellbare Tankgröße (Default 40 L)
  - 🏆 Günstigste Station (Name, Marke, Entfernung, Navigation)
  - „Jetzt tanken oder warten?“ + beste Zeitfenster (aus gecachten Prognosen)
  - Stationentabelle mit Preisen, Datenalter und Ersparnis
  - Prognose-Sparklines (Median + q025/q975-Band, aktuelle Preislinie)
  - 🌙/☀️ Dark-Mode-Umschalter (Dark ist Default, Auswahl wird gespeichert)

### 3. NAS offline testen:
```bash
# NAS temporär stoppen (auf dem NAS)
docker stop tankapp  # oder den Container-Namen prüfen mit: docker ps
```

→ Die Fallback-GUI erscheint **ab dem nächsten Request** unter derselben
Adresse (`<RP2-IP>:8000`) — kein Neuladen nötig, aber ein Reload schadet
nicht. Alternativ erzwingst du sie auch bei NAS online mit
`http://<RP2-IP>:8000/?fallback=1`.

### 4. NAS wieder online:
```bash
# NAS wieder starten
docker start tankapp
```

→ Innerhalb von ~15 s (oder nach Klick auf **„🔄 NAS prüfen“** bzw.
`curl http://<RP2-IP>:8000/api/v1/nas-check`) zeigt dieselbe Adresse
automatisch wieder die volle NAS-GUI.

---

## 📊 Was du jetzt hast

| Funktion | NAS Online (proxied) | NAS Offline (Fallback) | Datenqualität |
|----------|----------------------|------------------------|---------------|
| **Vollständige NAS-GUI** (Charts, System) | ✅ unter `<RP2-IP>:8000` | ❌ bewusst reduziert | **Optimal** |
| **Live-Preise** | ✅ Live | ✅ aus Puffer, echte Datenalter | **Optimal** |
| **F2 (Günstigste Station)** | ✅ Voll | ✅ + Ersparnis je Liter & Tank | **Optimal** |
| **F1 (Jetzt/warten?)** | ✅ exakt (NAS-Logik) | ✅ vereinfachte Quantil-Logik | Gut (max. 24h alt) |
| **F3 (Heute/später?)** | ✅ exakt (NAS-Logik) | ✅ Top-3-Fenster aus Cache | Gut (max. 24h alt) |

---

## 🔧 Fehlersuche

### Problem: Cache funktioniert nicht
```bash
# Log prüfen
cat /tmp/tankapp_cache/cache.log

# Manuell testen
python3 ~/TankApp/rp2/cache_forecasts.py
```

**Mögliche Ursachen:**
- `NAS_IP` nicht gesetzt oder falsch (prüfen: `systemctl show tankapp-forecast-cache -p Environment`)
- NAS liefert `"count": 0` — dann ist der Cache technisch in Ordnung, es gibt
  nur noch keine Prognosen. Auf dem NAS `bash ops/nas/preflight.sh` prüfen:
  meist fehlt `data/_netrc` (Archivzugang) → kein Archiv → keine Modelle.
- NAS ist nicht erreichbar (Firewall?)
- NAS-GUI läuft nicht auf Port 1355

### Problem: GUI zeigt keine Stationen
```bash
# Live-Preise prüfen
ls -la /dev/shm/tankapp/
tail -n 1 /dev/shm/tankapp/$(date +%F).jsonl | python3 -m json.tool
```

**Mögliche Ursachen:**
- Collector läuft nicht (`systemctl status tankapp-collector`)
- Polling-Set ist leer
- Nachts (00–06 Uhr) pollt der Collector nicht — die letzte Zeile von gestern
  wird dann angezeigt und hat entsprechend Datenalter

### Problem: UUIDs statt Stationennamen
```bash
ls -la ~/TankApp/docs/analysis/stations/polling.json
```

**Ursache:** `polling.json` fehlt auf dem Pi oder ist kaputt. Die
JSONL-Snapshots im Puffer enthalten bewusst nur UUID + Preis — Namen,
Marken und Koordinaten liefert `polling.json`. Datei ggf. neu vom NAS/PC
kopieren ([INSTALL.md](../docs/INSTALL.md) §2.2), dann
`sudo systemctl restart tankapp-fallback-gui`.

### Problem: Fallback-GUI statt NAS-GUI, obwohl NAS online
```bash
curl -s http://<RP2-IP>:8000/api/v1/nas-check
curl -s http://<NAS-IP>:1355/api/v1/health
```

**Mögliche Ursachen:**
- `NAS_IP` im Drop-in falsch/leer (`systemctl show tankapp-fallback-gui -p Environment`)
- `FORCE_FALLBACK=1` gesetzt
- `?fallback=1` in der URL
- NAS antwortet auf `/api/v1/health` nicht mit `{"app": "online"}`

### Problem: Port 8000 ist belegt
```bash
# Andere Services prüfen
ss -tulnp | grep 8000

# Port ändern per Drop-in:
#   sudo systemctl edit tankapp-fallback-gui
#   [Service]
#   Environment=FALLBACK_GUI_PORT=8080
# Dann: sudo systemctl daemon-reload && sudo systemctl restart tankapp-fallback-gui
```

---

## 📈 Prognose-Qualität

### Wie aktuell sind die gecachten Prognosen?
- **Maximales Alter:** 24 Stunden (wenn NAS um 00:01 offline geht)
- **Typisches Alter:** 6–12 Stunden (wenn NAS tagsüber läuft)
- **Aktualisierung:** Alle 5 Minuten vom RP2 geprüft

### Sind 24h alte Prognosen noch brauchbar?
**Ja!** Tankpreise ändern sich meist:
- **Langsam** über den Tag (Tagesgang)
- **Schnell** bei Sprüngen (z.B. morgens um 6 Uhr)

**→ Für F1/F3 sind 24h alte Prognosen immer noch deutlich besser als gar keine!**

---

## 🎯 Empfohlene Nutzung

### Alltag:
1. **Immer dieselbe Adresse:** `http://<RP2-IP>:8000`
2. **Wenn NAS online:** automatisch die vollwertige NAS-GUI (proxied)
3. **Wenn NAS offline:** automatisch Fallback mit Live-Preisen + gecachten Prognosen
4. **Fallback erzwingen** (z.B. zum Prüfen): `http://<RP2-IP>:8000/?fallback=1`

### Für beste Ergebnisse:
- **NAS mindestens 1x täglich starten** (z.B. 06:00–24:00)
- **Prognosen werden um Mitternacht berechnet** → NAS sollte dann online sein
- **RP2 läuft immer** → Cache bleibt aktuell

---

## 🔄 Updates

Dependabot öffnet **montags automatisch Update-PRs** — für Python-Pakete,
npm-Pakete, CI-Actions und die Docker-Basisimages (gesteuert über
`.github/dependabot.yml`). So gehst du vor:

### 1. Benachrichtigung bekommen

Auf GitHub im Repo rechts oben **Watch → Custom → Pull requests** anhaken —
dann meldet sich GitHub bei jedem Update-PR. Optional in den
Repo-Einstellungen (*Settings → Security → Dependabot alerts*) zusätzlich
Sicherheitswarnungen aktivieren: Dann kommen kritische Updates auch
außerhalb des Montags-Rhythmus als eigene PRs.

### 2. PR prüfen und mergen

- **CI-Ampel abwarten:** Die Checks `engine`, `web` und `nas-image` müssen
  grün sein. Rot → nicht mergen, sondern erst schauen, was klemmt.
- **Patch/Minor** (z. B. `1.2.3` → `1.2.4` oder `1.3.0`) mit grüner CI:
  einfach mergen.
- **Major** (z. B. `1.x` → `2.0`): erst die im PR verlinkten Release-Notes
  auf „Breaking Changes“ prüfen, im Zweifel lokal testen
  (`pytest`, `npm --prefix web test`) und dann mergen.
- Mehrere offene Update-PRs nacheinander einzeln mergen, damit die CI
  jeden Stand prüft.

### 3. Nach dem Merge ausrollen

**NAS** — Python-, npm- und Docker-Updates wirken erst nach neuem
Image-Build (`nas-up` baut mit `--build` neu):

```bash
cd /mnt/user/appdata/tankapp   # dein Checkout-Pfad
git pull
python3 tankapp.py nas-up      # Unraid: Flags aus Schritt 1c mitgeben
```

Danach kurz prüfen: `http://<NAS-IP>:1355` lädt, `/api/v1/health` meldet
sich, und die Hintergrundjobs laufen (`nas-up` gibt Fehler im Log aus).

**RP2** — die RP2-Skripte nutzen nur die Python-Standardbibliothek,
Abhängigkeits-Updates ändern dort nichts. Nur bei geändertem RP2-Code:

```bash
# Auf dem RP2
cd ~/TankApp
git pull
sudo systemctl restart tankapp-forecast-cache tankapp-fallback-gui
```

**Nur CI-Actions im PR geändert?** Dann ist nach dem Merge nichts weiter
zu tun — das betrifft nur GitHubs Prüfläufe.

### 4. Wenn nach einem Update etwas klemmt

```bash
git log --oneline -5        # verdächtigen Merge finden
git revert <commit>         # Update zurückdrehen ...
python3 tankapp.py nas-up   # ... und auf dem NAS neu ausrollen
```

---

## 📝 Changelog

| Version | Datum | Änderungen |
|---------|-------|-----------|
| 2.0 | 09.09.2026 | **NAS-Proxy**: `<RP2-IP>:8000` zeigt bei NAS online automatisch die volle NAS-GUI (sonst Fallback; `?fallback=1` erzwingt Fallback, `FORCE_FALLBACK`-Env). Stationennamen/Marken/Navigation aus `polling.json` (bisher UUIDs). Neue Fallback-GUI: Dark/Light-Mode, E10/E5/Diesel, echte Datenalter je Station, Tankgröße, F1/F3 aus echten Quantil-Prognosen, Prognose-Sparklines, Auto-Refresh, „NAS prüfen“-Knopf. JSON-API: `health/stations/forecasts/decide/nas-check`. Template-Update per Inhalts-Hash (`index.html.old` als Backup) |
| 1.1 | 09.09.2026 | NAS-IP über `NAS_IP`-Env statt fest im Code; `requests`/Flask entfernt (nur Standardbibliothek); Cache schreibt atomar; NAS-Statusfarbe korrigiert |
| 1.0 | 08.09.2026 | Erstellung: RP2 Fallback-GUI mit F1/F2/F3 |

---

## 🙏 Support

Bei Fragen oder Problemen:
1. Logs prüfen (`journalctl -u tankapp-forecast-cache -f`)
2. Cache-Datei prüfen (`cat /tmp/tankapp_cache/last_forecasts.json`)
3. NAS-GUI prüfen (`http://<NAS-IP>:1355`)

---

**Viel Erfolg! Mit dieser Lösung tankst du immer günstig – egal ob das NAS online ist oder nicht!** 🚀💰
