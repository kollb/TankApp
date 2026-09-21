# Notwendige nächste Schritte

> Stand: 21.09.2026 · App-Version 0.62.1

## Inhaltsverzeichnis

- [A14: Rechts- und Terminbasis klären](#a14-rechts--und-terminbasis-klären)
- [N1: NAS/Pi-Integrationsfehler beheben](#n1-naspi-integrationsfehler-beheben)

### A14: Rechts- und Terminbasis klären

**P0 · vor weiteren Regime-Eingriffen.**

- [ ] Rabatt-/Deckel-Termine und Geltungsbereich aus dem
  [Regime-Plan](REGIME.md#annahmen-und-grenzen) anhand einer belastbaren
  amtlichen Quelle prüfen. Insbesondere klären, ob ein steuerbedingter
  Preisanstieg um 00:00 Uhr von der 12-Uhr-Regel ausgenommen ist.
- [ ] Quelle und Ergebnis in `REGIME.md` festhalten und die im Betrieb
  verwendeten `TANKAPP_REGIMES` mit dem bestätigten Stand abgleichen.

**Abnahme:** Bestätigte Regeln sind von bloßen Szenarien getrennt; ungeklärte
Termine werden nicht als geltendes Recht oder feste Entwicklungsfrist
behandelt. Erst danach lässt sich der notwendige Regime-Code verbindlich
beauftragen.

### N1: NAS/Pi-Integrationsfehler beheben

**P0/P1/P2 · Priorität je bestätigter Vertragsverletzung wie unten benannt.**

Grundlage ist der [NAS-/Pi-Befund vom 20.09.2026](../archiv/BEFUND-TANKAPP-NAS-PI-2026-09-20.md).
Die folgenden Punkte betreffen nachgewiesene Vertragsverletzungen, keine
neuen Features. NP1 ist umgesetzt (Release 0.60.0); NP2–NP6 sind noch offen. Alternative
Architekturen, neue Schreibauthentisierung, Hardwarebudgets und optionale
Pi-Inferenz sind damit nicht automatisch beauftragt.

NP1 (Belegpersistenz, Ledger-Integrität, Publikationskonsistenz — I1, S3, A1,
S4) ist mit [Release 0.60.0](../releases/CHANGELOG.md#0600--2026-09-20)
umgesetzt; die Gegenproben des Befunds laufen als dauerhafte
Regressionstests.

#### NP2 — P0: Bestehenden Leseschutz und Worker-Cache durchsetzen

- [ ] `TANKAPP_READ_TOKEN` im Compose-Pfad durchreichen, Authorization über
  den Pi erhalten und persönliche Inhalte in Aggregat-/Idempotenzantworten
  demselben Schutz unterstellen (S1). **Abnahme:** Negative Tests für
  `/stats/summary`, persönliche `/decide`-Felder und `POST /fills` mit
  bekannter ID; berechtigte Reads funktionieren direkt und über Pi.
- [ ] Service-Worker-Response korrekt klonen; persönliche Cache-Antworten bei
  fehlender/geänderter Berechtigung ausschließen und die Altersgrenze
  tatsächlich durchsetzen (S2). **Abnahme:** Cold-cache-Erstabruf,
  Tokenentzug und 24-h-Offline-Cache mit aktivem Worker im echten Browser
  testen; keine Abschaltung des Workers nur für diese Zusicherungen.

#### NP5 — P1: Nachreichen und langfristige Bilanz erhalten

- [ ] Während eines Jobs eintreffende höhere Watermarks zuverlässig
  nachverarbeiten (I5). **Abnahme:** Ein neuer Datenstand erzeugt genau
  einen notwendigen Folgelauf, keine verlorene Wake-Markierung.
- [ ] Uploader-ACK und Replay-Identität von rückspringender Uhr bzw.
  veränderlichen Stationsnamen trennen (I3). **Abnahme:** Neue Zeilen vor
  dem Zeit-ACK werden nicht übersprungen; Retry nach Namensänderung erzeugt
  keinen zweiten fachlichen Messpunkt.
- [ ] Archivierte Belege/Settlements in den zugesagten Jahres-/Allzeitbestand
  einbeziehen (F3). **Abnahme:** Die 90-Tage-Retention ändert weder
  Allzeitbelegzahl noch Jahressummen oder die definierte M7-Grundgesamtheit.

#### NP6 — P2: Feiertagseffekt im Profilkern erhalten

- [ ] Abgezogenen Feiertagseffekt im `profile_ar2`-Prognosezweig konsistent
  berücksichtigen (M4). **Abnahme:** Die dokumentierte Feiertags-Sensitivitätsprobe
  wirkt auch im Profilkern; `holiday_beta=0` und Tage ohne Feiertag bleiben stabil.
