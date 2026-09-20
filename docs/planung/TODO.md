# Notwendige nächste Schritte

> Stand: 20.09.2026 · App-Version 0.59.1

## Inhaltsverzeichnis

- [A14: Rechts- und Terminbasis klären](#a14-rechts--und-terminbasis-klären)
- [B5: Labor-Überlauf beheben](#b5-labor-überlauf-beheben)

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

### B5: Labor-Überlauf beheben

**P1 · reproduzierbarer Fehler in der Browser-Suite.**

- [ ] Den Textüberlauf der Regime-Karte im Labor bei 320 px beheben
  (`web/src/views/labor/Modell.tsx`, Kartentext aus `web/src/lab.ts`).
- [ ] Den bestehenden Test „Labor: alle sechs Abschnitte tragen ohne
  Querlauf“ im Playwright-Projekt `narrow` und anschließend die vollständige
  Demo-Browser-Suite ausführen; den Test nicht abschwächen.

**Abnahme:** Der Kartentext bleibt innerhalb seiner Box und
`npm --prefix web run test:e2e:demo` ist grün. Der Fehler ist auch auf dem
unveränderten Ausgangscommit `b1e60df` reproduziert (209 px Text in 202 px Box).
