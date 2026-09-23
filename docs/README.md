# Dokumentation

> Stand: 23.09.2026 · Repository-Version **0.68.1**
> Dieser Index ist kein pauschaler Prüfvermerk für alle verlinkten Dokumente.
> Technische Einzelreferenzen behalten ihren jeweiligen Prüfstand.

## Inhaltsverzeichnis

- [Einrichten und betreiben](#einrichten-und-betreiben)
- [Produkt und Architektur](#produkt-und-architektur)
- [Technische Referenz](#technische-referenz)
- [Entwicklung und Planung](#entwicklung-und-planung)
- [Historische Belege](#historische-belege)

## Einrichten und betreiben

| Dokument | Zuständigkeit |
|---|---|
| [Installation](betrieb/INSTALL.md) | Erstaufbau Pi → NAS → Browser |
| [Betrieb](betrieb/BETRIEB.md) | Dienste, Konfiguration, Backup, Alarme und Fehlersuche |
| [Betriebsabnahme](betrieb/BETRIEBSABNAHME.md) | NAS/Pi-Messrezept: Latenz, Pollkadenz, RPO/RTO (offen) |
| [RP2](betrieb/RP2.md) | NAS-Proxy und lesender Fallback |
| [Speicher](betrieb/SPEICHER.md) | RAM-Puffer, SSD/HDD und Aufbewahrung |
| [Stationen tauschen](betrieb/STATIONEN-TAUSCH.md) | Kontrollierter Austausch im Polling-Set |

## Produkt und Architektur

| Dokument | Zuständigkeit |
|---|---|
| [Konzept](produkt/KONZEPT.md) | Produktregeln, drei Fragen und ehrliche Grenzen |
| [UI](produkt/UI.md) | Aktuelle Navigation, Bereiche und Anzeigeprinzipien |
| [Microcopy](produkt/MICROCOPY.md) | Verbindliche Regeln für Nutzertexte |
| [GUI-Vorlagen](produkt/GUI-VORLAGEN.md) | Übernahme aus den geschützten Prototypen in `sample/` |
| [Architektur](architektur/ARCHITEKTUR.md) | Geräte, Datenfluss und Ressourcen |
| [ADRs](adr/README.md) | Entscheidungen mit Kontext und Konsequenzen |

## Technische Referenz

| Dokument | Zuständigkeit |
|---|---|
| [API](referenz/API.md) | Endpunkte, Payloads, Fehlercodes |
| [Analyse](referenz/ANALYSE.md) | Selektion, Modelle und Heatmaps |
| [Engine](referenz/ENGINE.md) | Fit, Backtest, Kalibrierung und Messrezepte |
| [Missingness](referenz/MISSINGNESS.md) | NaN-Residuen: Messung, Policies und Ablation |
| [Replay](referenz/REPLAY.md) | Walk-forward-/Operational-Replay und Akzeptanzmargen |
| [Datenwerkzeuge](referenz/DATENWERKZEUGE.md) | Collector, Import/Export und Offline-Prüfprogramme |

## Entwicklung und Planung

| Dokument | Zuständigkeit |
|---|---|
| [Mitwirken](../CONTRIBUTING.md) | Umgebung und Prüfsequenz |
| [Qualität](entwicklung/QUALITAET.md) | Demo-Stack, Browser-Prüfungen und Messbudgets |
| [Prüfstände](entwicklung/PRUEFSTAENDE.md) | Nicht gegen die aktuelle App-Version geprüfte Referenzen |
| [Gutachter-Prüfung](entwicklung/GUTACHTER-PRUEFUNG.md) | Prüfgrundlage für externe Verifikation von Texten, GUI und statistischem Modell |
| [Dokumentationspflege](entwicklung/DOKUMENTATION.md) | Ordnerstruktur, Aufräumprotokoll und Pflegekonventionen |
| [Projektstand](planung/LUECKEN.md) | Implementiert, unbewiesen oder bewusst begrenzt |
| [TODO](planung/TODO.md) | Offene Aufgaben mit Abhängigkeiten und Abnahmekriterien |
| [Regime-Plan](planung/REGIME.md) | Geplante Regime-Behandlung, Messstand und offene Rechtsfragen |

Empfohlene Lesereihenfolge: Installation → Betrieb; für Entwicklung zusätzlich
Konzept → Architektur → passende Referenz → Projektstand → TODO.
Die aktuelle App-Version wird in `app/version.py` geführt.

## Historische Belege

- [Release-Historie](releases/CHANGELOG.md): Änderungen je App-Version.
- [Archiv](archiv/README.md): datierte Prüfungen, Messbelege und alte Anleitungen.
- [NAS-/Pi-Befund vom 20.09.2026](archiv/BEFUND-TANKAPP-NAS-PI-2026-09-20.md):
  Architektur, Failover, Datenintegrität, Sicherheit und Modellgrenzen;
  reproduzierte Fehler getrennt von offenen Hardware-/Qualitätsnachweisen.

Ein Prüfbericht belegt seinen Stichtag, nicht den heutigen Zustand. Aktuelle
Regeln werden nicht aus der höchsten Versionsnummer eines alten Entwurfs
abgeleitet, sondern aus Code, gültigen Entscheidungen und offenen Abnahmen.
