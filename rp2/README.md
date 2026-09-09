# RP2 Fallback-GUI für TankApp

**24/7 Verfügbarkeit von Tank-Entscheidungen (F1/F2/F3) durch Caching der NAS-Prognosen auf dem Raspberry Pi 2.**

## 🎯 Ziel

Dein NAS läuft nur 6h/Tag, aber der RP2 läuft 24/7. Diese Lösung ermöglicht dir:

- ✅ **F2 (Hier oder woanders?):** **Immer** verfügbar – zeigt die günstigste Station mit aktuellen Preisen
- ✅ **F1 (Jetzt oder warten?):** Verfügbar mit gecachten Prognosen (max. 24h alt)
- ✅ **F3 (Heute oder später?):** Verfügbar mit gecachten Prognosen (max. 24h alt)

**→ Du tankst immer günstig, auch wenn das NAS schläft!**

## 📁 Dateistruktur

```
rp2/
├── cache_forecasts.py      # Lädt Prognosen vom NAS und cached sie
├── fallback_gui.py        # Webserver für die Fallback-GUI (Port 8000)
├── templates/             # HTML-Templates (wird automatisch erstellt)
│   └── index.html         # Haupt-GUI-Template
├── tankapp-forecast-cache.service    # systemd-Service für Cache
├── tankapp-fallback-gui.service      # systemd-Service für GUI
├── ANLEITUNG.md           # Detaillierte Schritt-für-Schritt-Anleitung
└── README.md              # Diese Datei
```

## 🚀 Schnellstart

### 1. Dateien kopieren
```bash
# Auf dem RP2
mkdir -p ~/TankApp/rp2
# Kopiere alle Dateien aus diesem Verzeichnis nach ~/TankApp/rp2/
```

### 2. NAS-IP anpassen
In allen Dateien `<NAS-IP>` durch die **lokale IP deines NAS** ersetzen:
- `cache_forecasts.py` (Zeile 14)
- `fallback_gui.py` (alle Vorkommen)
- `tankapp-forecast-cache.service` (Environment-Block)

### 3. Abhängigkeiten installieren
```bash
sudo apt update && sudo apt install -y python3-pip
# Keine pip-Pakete noetig - nur Python-Standardbibliothek
python3 --version   # 3.11+
```

### 4. Services einrichten
```bash
sudo cp ~/TankApp/rp2/tankapp-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tankapp-forecast-cache tankapp-fallback-gui
```

### 5. Testen
```
# Cache prüfen
cat /tmp/tankapp_cache/last_forecasts.json | python3 -m json.tool | head -20

# GUI öffnen
http://<RP2-IP>:8000
```

## 📊 Funktionen

| Funktion | Beschreibung | Datenquelle |
|----------|--------------|-------------|
| **Live-Preise** | Aktuelle Preise aller Stationen | RP2-Puffer (`/dev/shm/tankapp`) |
| **Günstigste Station** | F2: Welche Station ist jetzt am günstigsten? | Live-Preise |
| **Jetzt oder warten?** | F1: Soll ich jetzt tanken oder warten? | Gecachte Prognosen |
| **Heute oder später?** | F3: Wann ist der beste Zeitpunkt heute? | Gecachte Prognosen |

## 🔧 Technische Details

### Cache-Mechanismus
- **Aktualisierungsintervall:** Alle 5 Minuten
- **Speicherort:** `/tmp/tankapp_cache/last_forecasts.json`
- **Maximales Alter:** 24 Stunden (wenn NAS um 00:01 offline geht)
- **Typisches Alter:** 6–12 Stunden (wenn NAS tagsüber läuft)

### Fallback-GUI
- **Port:** 8000
- **Technologie:** Python `http.server` (Standardbibliothek)
- **Daten:**
  - Live-Preise: Direkt aus `/dev/shm/tankapp` (<5 Min alt)
  - Prognosen: Aus Cache-Datei (max. 24h alt)
- **API-Endpunkte:**
  - `/` – Haupt-GUI
  - `/api/v1/health` – Status
  - `/api/v1/stations` – Stationen mit Preisen
  - `/api/v1/forecasts` – Gecachte Prognosen
  - `/api/v1/decide` – Entscheidungs-API (F1/F2/F3)

## 🎨 GUI-Beispiel

```
┌─────────────────────────────────────────────┐
│  🚗 TankApp - RP2 Fallback                    │
│  NAS: ❌ Offline | Prognosen: 3h alt | Preise: 2 Min │
├─────────────────────────────────────────────┤
│  🏆 GÜNSTIGSTE: Shell Hauptbahnhof            │
│     1,649 €/L · 📍 Navigation                   │
├─────────────────────────────────────────────┤
│  Station                     | Preis   | Ersparnis │
│  Aral Stadtmitte            | 1,679 € | +0,30 €   │
│  Esso Industriestr.          | 1,689 € | +0,40 €   │
│  Jet Tankstelle              | 1,699 € | +0,50 €   │
├─────────────────────────────────────────────┤
│  💡 Hinweis: Für volle Funktionen (Live-Prognosen) NAS starten. │
└─────────────────────────────────────────────┘
```

## 📈 Datenqualität

| Daten | Alter | Qualität |
|-------|-------|----------|
| Live-Preise | <5 Minuten | ⭐⭐⭐⭐⭐ Optimal |
| Prognosen | 0–6 Stunden | ⭐⭐⭐⭐⭐ Sehr gut |
| Prognosen | 6–12 Stunden | ⭐⭐⭐⭐ Gut |
| Prognosen | 12–24 Stunden | ⭐⭐⭐ Akzeptabel |

**→ Selbst 24h alte Prognosen sind besser als gar keine!**

## 🔄 NAS-Betrieb

### Empfohlener Zeitplan
| Uhrzeit | NAS-Status | Aktion |
|---------|------------|--------|
| 00:00–06:00 | ❌ Offline | Prognosen werden nicht aktualisiert |
| 06:00–24:00 | ✅ Online | Prognosen werden berechnet, Cache aktualisiert |

**→ Prognosen sind immer max. 24h alt!**

### Prognose-Berechnung
- **Wann:** Täglich nach Mitternacht
- **Trainingsfenster:** 42 Tage (6 Wochen)
- **Modelle:** M1 (Tagesform) + M2 (AR(2)) + M3 (UnobservedComponents)
- **Ensemble:** Gewichtet nach MASE (Mean Absolute Scaled Error)

## 🛠️ Anpassungen

### NAS-IP ändern
1. In allen Dateien `<NAS-IP>` durch die neue IP ersetzen
2. Services neu starten:
```bash
sudo systemctl restart tankapp-forecast-cache tankapp-fallback-gui
```

### Port ändern
In `tankapp-fallback-gui.service`:
```ini
Environment=FALLBACK_GUI_PORT=8080
```
Dann:
```bash
sudo systemctl restart tankapp-fallback-gui
```

### Prognose-Cache-Intervall ändern
In `cache_forecasts.py`:
```python
time.sleep(300)  # 300 Sekunden = 5 Minuten
```

## 📝 Changelog

| Version | Datum | Änderungen |
|---------|-------|-----------|
| 1.0 | 08.09.2026 | Initial: RP2 Fallback-GUI mit F1/F2/F3-Caching |

## 🙏 Troubleshooting

### Cache funktioniert nicht
```bash
# Log prüfen
cat /tmp/tankapp_cache/cache.log

# Manuell testen
python3 ~/TankApp/rp2/cache_forecasts.py

# NAS-Endpunkt testen
curl http://<NAS-IP>:1355/api/v1/last_forecasts
```

### GUI zeigt keine Daten
```bash
# Live-Preise prüfen
ls -la /dev/shm/tankapp/
tail -n 1 /dev/shm/tankapp/$(date +%F).jsonl | python3 -m json.tool

# Collector prüfen
systemctl status tankapp-collector
```

### Port ist belegt
```bash
# Belegte Ports prüfen
ss -tulnp | grep 8000

# Service stoppen und Port ändern
sudo systemctl stop tankapp-fallback-gui
# Port in Service-Datei ändern
# Dann neu starten
sudo systemctl start tankapp-fallback-gui
```

## 📚 Siehe auch

- [Detaillierte Anleitung](ANLEITUNG.md)
- [TankApp Haupt-Dokumentation](../README.md)
- [Konzept](../docs/KONZEPT.md)
- [Installation](../docs/INSTALL.md)

---

**Mit dieser Lösung hast du 24/7 Zugang zu allen Tank-Entscheidungen – auch wenn das NAS schläft!** 🚀💰
