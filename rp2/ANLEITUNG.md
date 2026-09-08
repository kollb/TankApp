# TankApp RP2 Fallback-GUI – Anleitung

**Ziel:** 24/7 Verfügbarkeit von F1/F2/F3 durch Caching der NAS-Prognosen auf dem RP2.

---

## 📋 Übersicht

| Komponente | Gerät | Aufgabe |
|------------|-------|---------|
| **Collector + Uploader** | RP2 | Sammelt Live-Preise, uploadet zu NAS (wie bisher) |
| **Prognose-Berechnung** | NAS | Berechnet Prognosen täglich nach Mitternacht |
| **Vollwertige GUI** | NAS | Zeigt alles an (wenn online) |
| **Fallback-GUI** | RP2 | Zeigt Live-Preise + gecachte Prognosen (24/7) |
| **Forecast Cache** | RP2 | Lädt Prognosen vom NAS und cached sie |

**Ergebnis:** 
- ✅ **F2 (Hier oder woanders?):** Immer verfügbar (Live-Preise aus RP2-Puffer)
- ✅ **F1 (Jetzt oder warten?):** Verfügbar mit gecachten Prognosen (max. 24h alt)
- ✅ **F3 (Heute oder später?):** Verfügbar mit gecachten Prognosen (max. 24h alt)

---

## 🛠️ Voraussetzungen

### Auf dem NAS:
- ✅ TankApp bereits mit `python3 tankapp.py nas-up` gestartet
- ✅ NAS läuft mindestens 6h/Tag (für Prognose-Berechnung)
- ✅ Port 1355 ist erreichbar (Standard-GUI-Port)

### Auf dem RP2:
- ✅ Python 3.11+ installiert
- ✅ RP2 läuft 24/7 (bereits der Fall)
- ✅ Collector + Uploader bereits aktiv (`tankapp-collector`, `tankapp-uploader`)
- ✅ `/dev/shm/tankapp` als tmpfs gemountet (bereits der Fall)

---

## 📥 Schritt 1: Dateien auf den RP2 kopieren

### Von deinem PC/NAS:
```bash
# Kopiere die RP2-Dateien auf den Pi
scp -r /home/user/TankApp/rp2/* pi@<RP2-IP>:~/TankApp/rp2/
```

### Oder direkt auf dem RP2:
```bash
# Auf dem RP2 ausführen
mkdir -p ~/TankApp/rp2
cd ~/TankApp/rp2

# Dateien herunterladen (wenn GitHub-Zugriff)
git clone https://github.com/kollb/TankApp.git ~/TankApp 2>/dev/null || echo "Repo bereits vorhanden"
```

---

## ⚙️ Schritt 2: Konfiguration anpassen

### 1. NAS-IP in den Skripten eintragen

**In `cache_forecasts.py`:**
```python
NAS_URL = "http://<NAS-IP>:1355/api/v1/last_forecasts"
```
Ersetze `<NAS-IP>` mit der **lokalen IP deines NAS** (z.B. `192.168.178.50`).

**In `fallback_gui.py`:**
Suche alle Vorkommen von `<NAS-IP>` und ersetze sie mit deiner NAS-IP.

### 2. Service-Dateien anpassen

**In `tankapp-forecast-cache.service`:**
```ini
Environment=NAS_IP=<NAS-IP>
```

---

## 📦 Schritt 3: Abhängigkeiten installieren (RP2)

```bash
# Auf dem RP2 ausführen
sudo apt update
sudo apt install -y python3-pip

# Flask installieren (für Fallback-GUI)
python3 -m pip install flask requests
```

---

## 🚀 Schritt 4: Services einrichten und starten

### 1. Service-Dateien nach `/etc/systemd/system/` kopieren

```bash
# Auf dem RP2
sudo cp ~/TankApp/rp2/tankapp-forecast-cache.service /etc/systemd/system/
sudo cp ~/TankApp/rp2/tankapp-fallback-gui.service /etc/systemd/system/
```

### 2. Services laden und aktivieren

```bash
# systemd neu laden
sudo systemctl daemon-reload

# Services aktivieren und starten
sudo systemctl enable --now tankapp-forecast-cache
sudo systemctl enable --now tankapp-fallback-gui
```

### 3. Status prüfen

```bash
# Cache-Service
systemctl status tankapp-forecast-cache
journalctl -u tankapp-forecast-cache -f

# GUI-Service  
systemctl status tankapp-fallback-gui
journalctl -u tankapp-fallback-gui -f
```

---

## 🌐 Schritt 5: Testen

### 1. Prüfe, ob der Cache funktioniert:
```bash
# Cache-Datei prüfen
cat /tmp/tankapp_cache/last_forecasts.json | python3 -m json.tool | head -20
```

### 2. Fallback-GUI im Browser öffnen:
```
http://<RP2-IP>:8000
```
(Ersetze `<RP2-IP>` mit der IP deines RP2)

### 3. NAS offline testen:
```bash
# NAS temporär stoppen (auf dem NAS)
docker stop tankapp  # oder den Container-Namen prüfen mit: docker ps
```

→ Die Fallback-GUI sollte weiter funktionieren und anzeigen:
- **NAS: ❌ Offline**
- **Prognosen: Xh alt** (z.B. "3h alt")
- **Preise: <5 Min** (Live aus RP2-Puffer)
- **Günstigste Station** mit aktuellem Preis

### 4. NAS wieder online:
```bash
# NAS wieder starten
docker start tankapp
```

→ Die GUI sollte automatisch zur vollwertigen NAS-GUI umschalten (wenn du auf Port 1355 zugreifst).

---

## 📊 Was du jetzt hast

| Funktion | NAS Online | NAS Offline | Datenqualität |
|----------|------------|-------------|---------------|
| **Live-Preise** | ✅ Live | ✅ Live (<5 Min) | **Optimal** |
| **F2 (Hier/woanders?)** | ✅ Voll | ✅ Voll | **Optimal** |
| **F1 (Jetzt/warten?)** | ✅ Live-Prognose | ✅ Gecachte Prognose | Gut (max. 24h alt) |
| **F3 (Heute/später?)** | ✅ Live-Prognose | ✅ Gecachte Prognose | Gut (max. 24h alt) |

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
- Falsche NAS-IP in `cache_forecasts.py`
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

### Problem: Port 8000 ist belegt
```bash
# Andere Services prüfen
ss -tulnp | grep 8000

# Port ändern
# In tankapp-fallback-gui.service:
# Environment=FALLBACK_GUI_PORT=8080
# Dann: sudo systemctl restart tankapp-fallback-gui
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
1. **Immer auf RP2-GUI zugreifen:** `http://<RP2-IP>:8000`
2. **Wenn NAS online:** Vollwertige GUI mit Live-Prognosen
3. **Wenn NAS offline:** Fallback mit Live-Preisen + gecachten Prognosen

### Für beste Ergebnisse:
- **NAS mindestens 1x täglich starten** (z.B. 06:00–24:00)
- **Prognosen werden um Mitternacht berechnet** → NAS sollte dann online sein
- **RP2 läuft immer** → Cache bleibt aktuell

---

## 🔄 Updates

### Code aktualisieren:
```bash
# Auf dem RP2
cd ~/TankApp
git pull

# Services neu starten
sudo systemctl restart tankapp-forecast-cache
sudo systemctl restart tankapp-fallback-gui
```

---

## 📝 Changelog

| Version | Datum | Änderungen |
|---------|-------|-----------|
| 1.0 | 08.09.2026 | Erstellung: RP2 Fallback-GUI mit F1/F2/F3 |

---

## 🙏 Support

Bei Fragen oder Problemen:
1. Logs prüfen (`journalctl -u tankapp-forecast-cache -f`)
2. Cache-Datei prüfen (`cat /tmp/tankapp_cache/last_forecasts.json`)
3. NAS-GUI prüfen (`http://<NAS-IP>:1355`)

---

**Viel Erfolg! Mit dieser Lösung tankst du immer günstig – egal ob das NAS online ist oder nicht!** 🚀💰
