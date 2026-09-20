# ADR 0002: Produktumfang und bewusst unterlassene Optimierungen

- **Status:** angenommen; keine Wiedereröffnung geschlossener Aufgaben.
- **Stand:** 18.09.2026 · dokumentiert 20.09.2026 · App 0.59.1.

## Inhaltsverzeichnis

- [Kontext](#kontext)
- [Entscheidung](#entscheidung)
- [Konsequenzen](#konsequenzen)
- [Wiederaufnahme](#wiederaufnahme)

## Kontext

TankApp dient einem deutschsprachigen Haushalt im eigenen LAN. Entwicklung
soll reale Fehlentscheidungen oder beobachtete Bedienprobleme lösen, nicht
abgeschlossene Aufgaben allein wegen alter Entwürfe wiederholen.

## Entscheidung

| Thema | Entscheidung und Grund |
|---|---|
| Öffentlicher Mehrnutzerbetrieb | Kein Login-/Rollen-/SSO-System, keine öffentliche Skalierung, keine weitere Sprache im vereinbarten Umfang; Eingabevalidierung bleibt notwendig |
| B22: weniger Draws/Nacht-Raster | Kein Eingriff in MASE/PICP/MPIW für eine Laufzeitersparnis am unproblematischen Nachtlauf |
| C12: Desktop-Zweispalter | Keine flächendeckende Umgestaltung ohne Bedienbedarf; einspaltiger Desktop bleibt zulässig |
| C13: mobile Steuerzeilen | Kein zusätzliches Verstecken wichtiger Steuerungen hinter einem Blattmenü nur zur Höhenreduktion |
| Preis-Ticker | System- und Empfehlungsfenster-Meldungen genügen; keine zusätzliche Meldung ohne Handlungsempfehlung |
| Stations-Tausch | Bestätigter Tausch statt automatischer Polling-Ausschluss; sonst wäre Wiedererkennung nicht mehr möglich |
| Top-3-Trefferquote | Nur wirklich veröffentlichte Fenster messen, keine Kandidaten erfinden |
| OpenAPI | Markdown-Vertrag genügt zunächst; Generierung erst bei weiterem Verbraucher neu bewerten |
| B30: zusätzlicher Bodenkanten-Backtest | Kein produktiver Mischbestand über beide Rechtslagen mehr; der Schalter `TANKAPP_LAW_FLOOR=0` bleibt für begründete Gegenmessungen verfügbar |
| Nachträgliche Laufzeit-/Hardware-Häkchen | Keine nachgereichte Abnahme ohne Entscheidungsbedarf; vorhandener Betrieb ersetzt dabei keine neue Messbehauptung |
| Lighthouse-Performance | Warnbudget auf geteiltem CI-Runner beibehalten; kein pauschaler Umbau auf hartes 0,90-Gate |

## Konsequenzen

Diese Punkte erscheinen nicht als offene Arbeit im TODO. LAN-only bedeutet
nicht, dass Eingaben beliebig vertraut oder Dienste öffentlich exponiert
werden dürfen. Die ausgelagerten Studio-Bereiche bleiben zugänglich; die
3+1-Navigation hebt die C13-Entscheidung nicht rückwirkend auf.

## Wiederaufnahme

Eine neue Betriebsanforderung, echte Beschwerde, zweite API-Verbraucherin oder
Messung kann eine neue Entscheidung begründen. Dann Kontext und Abnahme neu
formulieren, nicht eine historische Checkliste ungeprüft reaktivieren.

Belege: [Release-Historie](../releases/CHANGELOG.md),
[Qualitätsbudgets](../entwicklung/QUALITAET.md#budgets),
[UI](../produkt/UI.md), [Projektstand](../planung/LUECKEN.md).
