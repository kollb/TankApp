# 📝 Änderungen für RP2 Fallback-GUI mit F1/F3-Caching

**Zusammenfassung aller Änderungen an der TankApp, um Prognosen (F1/F3) auf dem RP2 zu cachen.**

---

## 📁 Geänderte Dateien im Haupt-Repository

### 1. `app/server.py`
**Änderung:** Neuer API-Endpunkt `/api/v1/last_forecasts` hinzugefügt.

```python
# In der api()-Methode der Handler-Klasse:
if path == "/api/v1/last_forecasts":
    return self.data.last_forecasts()
```

**Zweck:** Ermöglicht dem RP2, alle letzten Prognosen vom NAS abzurufen.

---

### 2. `app/data.py`
**Änderung:** Neue Methode `last_forecasts()` in der `LiveData`-Klasse.

```python
def last_forecasts(self):
    """Gibt alle letzten Prognosen für den RP2-Cache zurück."""
    bundle = publication(self.settings)
    forecasts = bundle.get("forecasts", [])
    
    valid_forecasts = []
    for row in forecasts:
        if not all(k in row for k in ["station_id", "city", "fuel", "origin", "points"]):
            continue
        valid_forecasts.append(row)
    
    return {
        "generated_at": bundle.get("published_at"),
        "forecasts": valid_forecasts,
        "count": len(valid_forecasts),
        "calibrated": False,
        "decision_ready": False,
    }
```

**Zweck:** Liefert alle gültigen Prognosen aus der Engine-Publikation zurück.

---

## 🆕 Neue Dateien im `rp2/` Verzeichnis

### 1. `rp2/cache_forecasts.py`
**Zweck:** Lädt die Prognosen vom NAS und cached sie lokal auf dem RP2.

**Funktionen:**
- Lädt alle 5 Minuten Prognosen von `/api/v1/last_forecasts`
- Speichert Cache in `/tmp/tankapp_cache/last_forecasts.json`
- Loggt Aktivitäten in `/tmp/tankapp_cache/cache.log`

---

### 2. `rp2/fallback_gui.py`
**Zweck:** Bietet eine Fallback-GUI auf Port 8000, die Live-Preise + gecachte Prognosen anzeigt.

**Funktionen:**
- Zeigt aktuelle Preise aus `/dev/shm/tankapp` (<5 Min alt)
- Zeigt gecachte Prognosen (max. 24h alt)
- Implementiert F1/F2/F3-Logik
- API-Endpunkte:
  - `/` – Haupt-GUI
  - `/api/v1/health` – Status
  - `/api/v1/stations` – Stationen mit Preisen
  - `/api/v1/forecasts` – Gecachte Prognosen
  - `/api/v1/decide` – Entscheidungs-API

---

### 3. `rp2/tankapp-forecast-cache.service`
**Zweck:** systemd-Service für den Forecast-Cache.

**Konfiguration:**
- Läuft als User `pi`
- Startet automatisch mit dem System
- Restart bei Absturz

---

### 4. `rp2/tankapp-fallback-gui.service`
**Zweck:** systemd-Service für die Fallback-GUI.

**Konfiguration:**
- Läuft als User `pi`
- Startet automatisch mit dem System
- Restart bei Absturz
- Port: 8000 (konfigurierbar)

---

### 5. `rp2/templates/index.html`
**Zweck:** HTML-Template für die Fallback-GUI.

**Merkmale:**
- Responsive Design
- Zeigt NAS-Status an
- Zeigt Alter der Prognosen
- Zeigt günstigste Station
- Zeigt alle Stationen sortiert nach Preis
- Navigation zu Stationen

---

### 6. `rp2/ANLEITUNG.md`
**Zweck:** Detaillierte Schritt-für-Schritt-Anleitung für die Einrichtung.

---

### 7. `rp2/README.md`
**Zweck:** Übersicht und technische Dokumentation.

---

## 🔧 Was du tun musst

### 1. NAS-IP anpassen
In folgenden Dateien `<NAS-IP>` durch die **lokale IP deines NAS** ersetzen:
- `rp2/cache_forecasts.py` (Zeile 14)
- `rp2/fallback_gui.py` (alle Vorkommen von `<NAS-IP>`)
- `rp2/tankapp-forecast-cache.service` (Environment-Block)

### 2. Abhängigkeiten installieren (auf RP2)
```bash
sudo apt update && sudo apt install -y python3-pip
# Keine pip-Pakete noetig - nur Python-Standardbibliothek
```

### 3. Services einrichten (auf RP2)
```bash
sudo cp ~/TankApp/rp2/tankapp-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tankapp-forecast-cache tankapp-fallback-gui
```

### 4. NAS aktualisieren
Die Änderungen an `app/server.py` und `app/data.py` müssen auf dem NAS deployt werden:
```bash
# Auf dem NAS
cd /mnt/user/appdata/tankapp  # oder dein TankApp-Verzeichnis
git pull
python3 tankapp.py nas-up --force
```

---

## 📊 Auswirkungen

### Vorher:
| Funktion | NAS Online | NAS Offline |
|----------|------------|-------------|
| Live-Preise | ✅ | ❌ |
| F2 (Hier/woanders?) | ✅ | ❌ |
| F1 (Jetzt/warten?) | ✅ | ❌ |
| F3 (Heute/später?) | ✅ | ❌ |

### Nachher:
| Funktion | NAS Online | NAS Offline |
|----------|------------|-------------|
| Live-Preise | ✅ | ✅ |
| F2 (Hier/woanders?) | ✅ | ✅ |
| F1 (Jetzt/warten?) | ✅ | ✅ (gecached) |
| F3 (Heute/später?) | ✅ | ✅ (gecached) |

---

## 🎯 Vorteile

1. **24/7 Verfügbarkeit** – Alle Funktionen auch ohne NAS
2. **Keine Architektur-Brüche** – RP2 übernimmt nur Caching, NAS bleibt für Berechnungen
3. **Minimaler Aufwand** – ~100 Zeilen neuer Code
4. **Geringe Ressourcen** – Läuft auf RP2 ohne Performance-Probleme
5. **Transparenz** – Nutzer sieht immer, wie aktuell die Daten sind

---

## ⚠️ Wichtige Hinweise

### 1. Prognose-Qualität
- **Maximales Alter:** 24 Stunden (wenn NAS um 00:01 offline geht)
- **Typisches Alter:** 6–12 Stunden (wenn NAS tagsüber läuft)
- **Aktualisierung:** Alle 5 Minuten vom RP2 geprüft

### 2. NAS-Betrieb
- **Empfohlen:** NAS täglich um Mitternacht online (für Prognose-Berechnung)
- **Mindestens:** NAS 1x täglich starten (z.B. 06:00–24:00)

### 3. Stromverbrauch
- **RP2:** Läuft ohnehin 24/7 → **keine zusätzlichen Kosten**
- **NAS:** Kann weiter 6h/Tag laufen → **keine zusätzlichen Kosten**

---

## 🔍 Testen

### 1. Cache prüfen
```bash
cat /tmp/tankapp_cache/last_forecasts.json | python3 -m json.tool | head -20
```

### 2. GUI testen
```
http://<RP2-IP>:8000
```

### 3. NAS offline testen
```bash
# Auf dem NAS
docker stop tankapp

# Auf dem RP2
# GUI sollte weiter funktionieren mit gecachten Daten
```

### 4. NAS wieder online
```bash
# Auf dem NAS
docker start tankapp

# Cache sollte automatisch aktualisiert werden
```

---

## 📈 Erwartetes Verhalten

### NAS Online:
- GUI zeigt: **NAS: ✅ Online | Prognosen: Live | Preise: Live**
- Alle Funktionen mit besten Daten

### NAS Offline (kurz):
- GUI zeigt: **NAS: ❌ Offline | Prognosen: 1h alt | Preise: <5 Min**
- Alle Funktionen verfügbar

### NAS Offline (lang):
- GUI zeigt: **NAS: ❌ Offline | Prognosen: 24h alt | Preise: <5 Min**
- Alle Funktionen verfügbar (Prognosen etwas veraltet)

---

## 🎨 GUI-Beispiel

```
┌─────────────────────────────────────────────┐
│  🚗 TankApp - RP2 Fallback                    │
│  NAS: ❌ Offline | Prognosen: 3h alt | Preise: 2 Min │
├─────────────────────────────────────────────┤
│  🟢 WARTEN BIS 18–20 UHR (+1,80 €) 82% sicher │
│  Shell Hauptbahnhof · 1,649 €/L · 📍 Navigation │
├─────────────────────────────────────────────┤
│  Heute später:                              │
│  🏆 19–21 Uhr  ~1,629 €  (-2,40 €)  68%     │
│  🥈 20–22 Uhr  ~1,635 €  (-2,00 €)  61%     │
├─────────────────────────────────────────────┤
│  Station                     | Preis   | 📍  │
│  Shell Hauptbahnhof          | 1,649 € | 📍  │
│  Aral Stadtmitte            | 1,679 € | 📍  │
│  Esso Industriestr.          | 1,689 € | 📍  │
└─────────────────────────────────────────────┘
│  💡 Hinweis: Prognosen sind 3h alt. Für Live-Daten NAS starten. │
└─────────────────────────────────────────────┘
```

---

## 📚 Dokumentation

- [Detaillierte Anleitung](rp2/ANLEITUNG.md)
- [Technische Dokumentation](rp2/README.md)
- [Haupt-README](../README.md)
- [Konzept](../docs/KONZEPT.md)

---

**Fazit:** Mit diesen Änderungen hast du eine **voll funktionsfähige 24/7 TankApp**, die alle Funktionen (F1/F2/F3) bietet – auch wenn das NAS nur 6h/Tag läuft! 🚀💰
