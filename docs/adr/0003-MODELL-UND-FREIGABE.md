# ADR 0003: Modellpfad, Kalibrierung und Produktfreigabe trennen

- **Status:** angenommen; implementierte Entscheidungen konsolidiert.
- **Stand:** 21.09.2026 · App-Version 0.65.0 · dokumentiert 20.09.2026 ·
  erweitert 21.09.2026 (A21-B1.4).

## Inhaltsverzeichnis

- [Kontext](#kontext)
- [Entscheidung](#entscheidung)
- [Konsequenzen](#konsequenzen)
- [Wiederaufnahme](#wiederaufnahme)

## Kontext

Eine Gütezahl ist irreführend, wenn sie einen anderen Modellpfad bewertet als
den veröffentlichten. Eine technisch korrigierte Verteilung belegt außerdem
nicht automatisch, dass die Produktentscheidung auf echten Advice-Daten gut
kalibriert ist.

## Entscheidung

- Default ist `profile_ar2`; Backtest und Veröffentlichung verwenden denselben
  Pfad. `ensemble` und `harmonic_ar2` bleiben explizite Alternativen.
- Gemeinsame Ziehungen und Day-Pair sind im App-Default aktiv. Day-Pair
  respektiert deklarierte Kanten und fällt ohne zulässige Paare zurück.
- PIT-Rekalibrierung gilt nur für 24 h, mit zeitlichem Holdout,
  Herkunftsprüfung und Anwendung frühestens im Folgelauf. Regime-Blackout:
  45 lokale Tage.
- `calibrated` ist ein technischer Zustand; `decision_ready` benötigt
  zusätzlich das M7-Gate auf abgerechneten Advice-Daten.
- **Freigabekette (A21-B1.4, 0.64.0):** Auch ein bestandenes M7-Gate gibt
  keine Handlung frei, solange ein Glied der aktuellen Evidenz fehlt:
  frischer Preis (Preis ohne Nachweis bleibt gesperrt, `price_stale` — der
  `last_price`-Fallback darf Preisspanne zeigen, aber keine Aktion
  begründen), offene Station, frische Herkunft, ein höchstens 24 h altes
  Modell mit Zukunfts-Punkten, vollständige endliche Pfade und veröffentlichte
  Güte (≥ 3 Tage). Die gebrochenen Glieder stehen als
  `blocking_reasons` im Vertrag, das Gültigkeitsende einer Freigabe als
  `valid_until`; ein Cache darf abgelaufene Aktionen nicht erneut zeigen.
  PIT bleibt wie zuvor nur ein Zustand der Pfade — `raw` und `pit_24h`
  können freigeben, eine kaputte Hülle wird zu `raw`, eine unbekannte
  Herkunft sperrt. Physische Tankwarnungen (A2) bleiben davon unberührt.
- Der Schwellennachzug verändert keine Prozent-Gates, um Güte künstlich
  passend zu machen.
- 90 Tage Live-only-Handover bleiben vom M7-Zeitplan unabhängig. Eine Senkung
  würde M7 nicht beschleunigen, aber den Datenpuffer verkürzen.

## Konsequenzen

72-/168-h-Bänder bleiben unkalibriert. Ohne belastbaren Ledger bleibt die
Empfehlung gesperrt, obwohl aktuelle Preise und technische Prognosen existieren.
Seit A21-B1.4 gilt dasselbe für jede gebrochene Stelle der Evidenzkette: die
App zeigt die Tatsachen (Preisspanne, Fenster) und nennt den Sperrgrund,
statt aus einem Median-Potenzial eine Handlung abzuleiten. Horizontabhängige
Ensemble-Gewichte werden als nicht geschätzt ausgewiesen;
eine alternative Modellmischung darf nicht allein aus historischen Texten
als aktiver Default übernommen werden.

## Wiederaufnahme

Kernwechsel, zusätzliche Kalibrierung und Parameteränderung nur mit
Ablations-Backtest, vergleichbarem Bestand und dokumentierter Entscheidung.
Ungeklärte Regime-Rechtsfragen sind keine implizite Freigabe dieses ADRs.

Belege: [Konzept](../produkt/KONZEPT.md),
[Engine](../referenz/ENGINE.md),
[Releases 0.57.0/0.58.0](../releases/CHANGELOG.md),
[Regime-Plan](../planung/REGIME.md).
