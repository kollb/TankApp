# Notwendige nächste Schritte

> Stand: 24.09.2026 · App-Version 0.70.0

## Inhaltsverzeichnis

- [A14: Rechts- und Terminbasis klären](#a14-rechts--und-terminbasis-klären)
- [N1: NAS/Pi-Integrationsfehler beheben](#n1-naspi-integrationsfehler-beheben)

**Statusmodell:** Drei Zustände, keine vierte Liste. **Offen** sind A14 und
NP2 unten — die einzigen P0-Aufträge dieser Datei. **Zustandsgesperrt** ist
`decision_ready=false`, seit 0.70.0 dokumentierter Produkt-Blocker, kein
TODO-Punkt: Der Preisvergleich trägt „Jetzt“, die Sperrung ist in
`/v1/health` → `decision_availability` messbar, M7-Schnitte landen im Archiv
`runtime/m7/archive.jsonl`. **Abgeschlossen** ist die Audit-Arbeit A70 aus
dem Prüfbericht — Vertragsmatrix, Abnahme-Manifest, Lücken-Ablation,
Verfügbarkeitsmessung — mit
[Release 0.70.0](../releases/CHANGELOG.md#0700--2026-09-24) umgesetzt.
Betriebsnachweise, die nur Zeit oder Feldmessung brauchen, stehen in
[LUECKEN.md](LUECKEN.md#ausstehender-betriebsnachweis), nicht hier.

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
neuen Features. NP1 ist umgesetzt (Release 0.60.0), NP5 mit 0.63.0, NP6 mit 0.63.1; NP2 ist noch offen. Alternative
Architekturen, neue Schreibauthentisierung, Hardwarebudgets und optionale
Pi-Inferenz sind damit nicht automatisch beauftragt.

NP1 (Belegpersistenz, Ledger-Integrität, Publikationskonsistenz — I1, S3, A1,
S4) ist mit [Release 0.60.0](../releases/CHANGELOG.md#0600--2026-09-20)
umgesetzt; NP5 (Nachreichen, Upload-Identität, Langzeitbilanz — I5, I3, F3)
mit [Release 0.63.0](../releases/CHANGELOG.md#0630--2026-09-21); NP6 (Feiertagseffekt
im Profilkern — M4) mit [Release 0.63.1](../releases/CHANGELOG.md#0631--2026-09-21). Die
Gegenproben des Befunds laufen als dauerhafte Regressionstests.

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
