# 📊 Vergleich: Richtige GUI vs. Fallback GUI

> **Archiviert — Mockup-Vergleich aus der Zeit vor der `web/`-GUI.**
> Technik-Angaben (Flask, Next.js) und Funktionsumfang stimmen nicht mehr:
> live sind `web/` (NAS-GUI, Vite/React) und `rp2/fallback_gui.py`
> (Standardbibliothek). Beschrieben in [../RP2.md](../RP2.md), Design-Basis in
> [../GUI-VORLAGEN.md](../GUI-VORLAGEN.md). Die HTML-Mockups liegen in
> [mockups/](mockups/richtige_gui.html). Archiv-Übersicht: [README.md](README.md).

Hier siehst du den **visuellen Unterschied** zwischen der vollwertigen GUI (NAS) und der Fallback-GUI (RP2).

---

## 🎯 **Zusammenfassung**

| Aspekt | **Richtige GUI** (NAS, Port 1355) | **Fallback GUI** (RP2, Port 8000) |
|--------|--------------------------------|--------------------------------|
| **Zweck** | Vollwertige Anwendung | Notfall-Lösung für NAS-Offline |
| **Technologie** | Next.js/React/TypeScript | Python Flask + HTML |
| **Design** | Professionell (Slate-950, Emerald) | Einfach & funktional |
| **Funktionen** | ✅ Alle (F1/F2/F3 + Heatmaps + Top10) | ✅ Wichtigste (F1/F2/F3 + Stationen) |
| **Daten** | Live + Prognosen | Live-Preise + gecachte Prognosen |
| **Offline-Unterstützung** | ✅ (Service Worker) | ✅ (Cache + Hinweis) |

---

## 🖼️ **Mockups zum Vergleich**

### 1. **Richtige GUI** (NAS, Port 1355)
🔗 **[Mockup anzeigen](mockups/richtige_gui.html)**

**Screenshot-Vorschau:**
```
┌─────────────────────────────────────────────────────────────┐
│  ⛽ TankApp v4     NAS: ✅ Online    Stand: 14:35       │
│  Mathematisch harte Selektion & kalibriertes System           │
├─────────────────────────────────────────────────────────────┤
│  🧭 Entscheidungs-Kompass    📈 Prognose    🔥 Heatmap ...   │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  🟢 WARTEN BIS 18–20 UHR (+1,80 €) 82% sicher                 │
│  Shell Hauptbahnhof · 1,649 €/L · 📍 Navigation               │
│                                                               │
│  Begründung: Preis fällt heute Abend um 3–4 ct/L             │
├─────────────────────────────────────────────────────────────┤
│  🔄 Alternativen in der Nähe                                   │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Station          │ Preis  │ Netto (40L) │ Sicherheit │ 📍 │ │
│  ├─────────────────────────────────────────────────────────┤ │
│  │ Shell Hbf        │ 1,649 €│ +0,00 €    │ —         │ 📍 │ │
│  │ Aral Stadtmitte │ 1,679 €│ +1,20 €    │ 82%       │ 📍 │ │
│  │ Esso Industrie   │ 1,689 €│ +0,80 €    │ 75%       │ 📍 │ │
│  └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  📅 Heute später                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                      │
│  │ 🏆 19–21 │ │ 🥈 20–22 │ │ 🥉 06–08 │                      │
│  │ 1,629 €  │ │ 1,635 €  │ │ 1,645 €  │                      │
│  │ -2,40 €  │ │ -2,00 €  │ │ -1,20 €  │                      │
│  └──────────┘ └──────────┘ └──────────┘                      │
├─────────────────────────────────────────────────────────────┤
│  🔥 24h-Heatmap (Preisniveau)                                    │
│  [■■■■■■■■□□□□□□□□□□□□□□] (dunkel = günstig)         │
│  00:00                                           23:00           │
├─────────────────────────────────────────────────────────────┤
│  📋 Top-10 Selektion (Frankfurt, 6/2/2)                         │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Rang │ Station          │ δ̂      │ Verfügbarkeit │    │ │
│  │ 1    │ Shell Hbf        │ -3,8 ct│ 98%          │    │ │
│  │ 2    │ Aral Stadtmitte │ -3,2 ct│ 95%          │    │ │
│  └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  🛡️ Daten: MTS-K via tankerkoenig.de (CC BY 4.0)                │
│  TankApp v4 · Top-3-Trefferquote: 93,3%                          │
└─────────────────────────────────────────────────────────────┘
```

**Design-Merkmale:**
- 🎨 **Dunkler Hintergrund** (`#020617` – Slate-950)
- 🟢 **Emerald-Akzente** für aktive/positive Zustände
- 🔵 **Sky-Blau** für Kurven/Details
- 🟡 **Amber** für Warnungen
- ✨ **Abgerundete Karten** (rounded-2xl)
- 📱 **Responsive** (Tabs für Mobile)

---

### 2. **Fallback GUI** (RP2, Port 8000)
🔗 **[Mockup anzeigen](mockups/fallback_gui.html)**

**Screenshot-Vorschau:**
```
┌─────────────────────────────────────────────┐
│  🚗 TankApp - RP2 Fallback                    │
├─────────────────────────────────────────────┤
│  NAS: ❌ Offline │ Prognosen: 3h alt │ Preise: 2 Min │
├─────────────────────────────────────────────┤
│                                                               │
│  🏆 GÜNSTIGSTE STATION JETZT                                 │
│  1,649 €/L · Shell · Shell Hauptbahnhof · 3,2 km          │
│  📍 Navigation starten                                        │
│                                                               │
│  Empfehlung: 🟢 WARTEN BIS 18–20 UHR (+1,80 €, 82%)          │
├─────────────────────────────────────────────┤
│  📋 Alle Stationen (sortiert nach Preis)                     │
│  ┌─────────────────────────────────────────────┐          │
│  │ Station            │ Preis   │ Ersparnis │ Navigation │ │
│  ├─────────────────────────────────────────────┤          │
│  │ Shell Hbf         │ 1,649 € │ +0,00 €  │ 📍         │ │
│  │ Aral Stadtmitte   │ 1,679 € │ +1,20 €  │ 📍         │ │
│  │ Esso Industrie    │ 1,689 € │ +0,80 €  │ 📍         │ │
│  └─────────────────────────────────────────────┘          │
├─────────────────────────────────────────────┤
│  📅 Heute später (gecached)                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                      │
│  │ 🏆 19–21 │ │ 🥈 20–22 │ │ 🥉 06–08 │                      │
│  │ 1,629 €  │ │ 1,635 €  │ │ 1,645 €  │                      │
│  └──────────┘ └──────────┘ └──────────┘                      │
├─────────────────────────────────────────────┤
│  💡 Hinweis: Für volle Funktionen (Live-Prognosen, Heatmaps)  │
│     bitte das NAS starten.                                   │
└─────────────────────────────────────────────┘
```

**Design-Merkmale:**
- 🏔️ **Heller Hintergrund** (weiß/hellgrau)
- 🟢 **Grüne Akzente** für positive Zustände
- 📱 **Einfaches, funktionales Design**
- ⚡ **Leichtgewichtig** (läuft auf RP2)

---

## 🎨 **Design-Vergleich**

| Element | **Richtige GUI** | **Fallback GUI** |
|---------|------------------|------------------|
| **Hintergrund** | Slate-950 (`#020617`) | Weiß (`#ffffff`) |
| **Primärfarbe** | Emerald-500 (`#10b981`) | Grün (`#4CAF50`) |
| **Karten** | Abgerundet (1.5rem) | Leicht abgerundet (8px) |
| **Schriftart** | Inter, System Sans | Arial, sans-serif |
| **Navigation** | Tabs oben | Keine Tabs |
| **Datenvisualisierung** | Heatmaps, Fan-Charts | Einfache Listen |
| **Status-Anzeige** | Integriert | Separate Leiste |

---

## 📊 **Funktions-Vergleich**

### **Gemeinsamkeiten** ✅
- **F1 (Jetzt oder warten?)** – Beide zeigen Empfehlung mit Wahrscheinlichkeit
- **F2 (Hier oder woanders?)** – Beide zeigen günstigste Station + Alternativen
- **F3 (Heute oder später?)** – Beide zeigen beste Zeitfenster
- **Live-Preise** – Beide zeigen aktuelle Preise (<5 Min alt)
- **Navigation** – Beide haben Maps-Links
- **NAS-Status** – Beide zeigen, ob NAS online/offline ist

### **Unterschiede**

| Funktion | **Richtige GUI** | **Fallback GUI** |
|----------|------------------|------------------|
| **Heatmaps** | ✅ 24h- und DoW-Heatmap | ❌ Nicht verfügbar |
| **Top-10 Selektion** | ✅ Vollständige Tabelle | ❌ Nicht verfügbar |
| **Umweg-Ökonomie** | ✅ Detaillierte Berechnung | ❌ Nicht verfügbar |
| **API Explorer** | ✅ Interaktiver Explorer | ❌ Nicht verfügbar |
| **System-Status** | ✅ Detaillierte Infos | ❌ Nur NAS-Status |
| **Kampagnen-Umschalter** | ✅ Frankfurt/München/Köln | ❌ Nicht verfügbar |
| **Kraftstoff-Umschalter** | ✅ E10/E5/Diesel | ❌ Nicht verfügbar |
| **Fan-Charts** | ✅ Prognose-Visualisierung | ❌ Nicht verfügbar |
| **Detaillierte Begründung** | ✅ Mit Modell-Infos | ❌ Einfache Begründung |

---

## 🎯 **Wann wird welche GUI verwendet?**

| Szenario | **Verwendete GUI** | Grund |
|----------|-------------------|-------|
| **NAS Online** | Richtige GUI (Port 1355) | Volle Funktionen, schönes Design |
| **NAS Offline** | Fallback GUI (Port 8000) | 24/7 Verfügbarkeit |
| **Mobiles Gerät** | Richtige GUI (responsive) | Tabs funktionieren auf Mobile |
| **AdGuard läuft auf Port 80** | Fallback GUI (Port 8000) | Kein Konflikt |

---

## 💡 **Zusammenfassung**

### **Richtige GUI (NAS)**
- **Für:** Hauptnutzung, wenn NAS online
- **Stärken:** Schönes Design, alle Funktionen, Heatmaps, detaillierte Analysen
- **Technologie:** Next.js/React/TypeScript (schwer für RP2)

### **Fallback GUI (RP2)**
- **Für:** Notfall, wenn NAS offline
- **Stärken:** 24/7 verfügbar, leichtgewichtig, einfache Bedienung
- **Technologie:** Python Flask + HTML (perfekt für RP2)

**→ Beide GUIs ergänzen sich perfekt!**
- **NAS online:** Nutzer sieht die schöne, vollwertige GUI
- **NAS offline:** Nutzer sieht die funktionale Fallback-GUI
- **Kein Datenverlust:** Live-Preise immer aktuell, Prognosen gecached

---

## 🚀 **Empfehlung**

**Behalte beide GUIs bei!**

1. **Haupt-GUI auf NAS** (Port 1355) – Für die normale Nutzung
2. **Fallback-GUI auf RP2** (Port 8000) – Für 24/7 Verfügbarkeit

**→ So hast du immer Zugang zu Tank-Entscheidungen – egal ob das NAS läuft oder nicht!** 🎉

---

## 📁 **Dateien**

| Datei | Beschreibung |
|-------|--------------|
| [richtige_gui.html](mockups/richtige_gui.html) | Mockup der vollwertigen GUI |
| [fallback_gui.html](mockups/fallback_gui.html) | Mockup der Fallback-GUI |

**→ Öffne die HTML-Dateien in deinem Browser, um den Unterschied live zu sehen!**
