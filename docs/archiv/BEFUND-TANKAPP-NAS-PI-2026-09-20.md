# Kurzfassung (Executive Summary)

**TankApp: Architektur-, Sicherheits- und Modellbefund für NAS, Raspberry Pi und deren Übergänge**

> Stand: 20.09.2026 · Version **0.59.1** · geprüfter Commit
> **da04d463dc8158027edfed9c9aac1958e6b81c57**.
> Status: historischer Prüfbericht zum geprüften Commit, **keine aktuelle Betriebsfreigabe**.
> Nachfolger für offene Korrekturen: [TODO](../planung/TODO.md#n1-naspi-integrationsfehler-beheben)
> und [Projektstand](../planung/LUECKEN.md#offene-arbeit).
> Dieser Bericht ersetzt keine aktuelle Betriebsanleitung und keine Hardwareabnahme.

**Gesamturteil:** Die grundsätzliche Arbeitsteilung ist sinnvoll: Der NAS rechnet
und führt den persönlichen Datenbestand; der Pi sammelt Preise, puffert und
übernimmt eine reduzierte Anzeige. Die Implementierung hält aber mehrere ihrer
wesentlichen Konsistenz-, Sicherheits- und Qualitätsversprechen nicht ein.
**Als privates Preis-Dashboard ist das System brauchbar. Als verlässlich
durchgängiges Beratungs- und Belegsystem würde ich diesen Stand nicht freigeben.**

Die wichtigsten Ergebnisse:

1. **Der Pi ist kein zweiter Prognoseserver.** Auf ihm laufen im vorgesehenen
   Betrieb weder Huber-Fit noch PAVA über Bootstrap-Pfade. Eine pauschale
   Forderung, dort die Bootstrap-Ziehungen zu reduzieren, würde am tatsächlichen
   System vorbeigehen.
2. **Der Failover erhält die Anzeige, nicht dieselbe fachliche Entscheidung.**
   Der Pi verwendet eine andere, schwächere Heuristik. Im Gegenversuch empfiehlt
   er „Warten“ bei einer veralteten ausgewählten Preismeldung und einem
   Prognosepaket mit roten Qualitätsmerkmalen.
3. **Die Veröffentlichung ist nicht als Gesamtheit atomar.** Nach einem
   injizierten Schreibfehler bleibt der alte Index unverändert, verweist aber
   bereits auf eine neue Stationsdatei neben einer alten. Der Leser meldet
   diesen Mischstand als lesbar.
4. **Die Offline-Warteschlange kann Belege verlieren und trotzdem „vorgemerkt“
   melden.** Nachgewiesen sind verlorene parallele Einträge, falsche
   Erfolgsbestätigungen bei vollem/gesperrtem Speicher und das endgültige
   Entfernen bei HTTP 429.
5. **Die reguläre 24-h-PIT-Kalibrierung verwirft ihre eigenen Backtestdaten.**
   Die Engine kennzeichnet sie mit `horizon_hours=0`; der NAS-Kandidat filtert
   auf `24`. Im echten Engine-Gegenlauf werden aus 1.512 Bewertungszeilen null
   Kalibrierungswerte.
6. **Der optionale Leseschutz ist nicht durchgängig wirksam.** Die öffentliche
   Statistik liefert den letzten Tankbeleg. Der Pi entfernt den
   Authorization-Header. Das ausgelieferte Compose-File reicht
   `TANKAPP_READ_TOKEN` nicht durch.
7. **Der Service Worker enthält reale Browserfehler.** Mit aktiviertem Worker
   scheitert der erste erfolgreiche API-Netzabruf wegen eines gesperrten
   Response-Streams. Der Cache liefert danach private Daten ohne Token sowie
   bei Netzausfall auch 24 Stunden alte Daten. Das betrifft Betriebsformen, in
   denen Service Worker tatsächlich aktiv sind, insbesondere HTTPS/PWA.
8. **Der automatische Rückwechsel ist fachlich gebrochen.** Nach NAS-Wiederkehr
   zeigt die bereits geladene Pi-Oberfläche „NAS nicht konfiguriert“ und
   „Noch kein frischer Preis“, obwohl der NAS sechs frische Stationspreise
   liefert. Erst ein Reload stellt die passende Oberfläche her.

**Es gibt keinen nachgewiesenen normalen Zwei-Schreiber-Split-Brain des Ledgers.**
Das ist ein Vorteil der Architektur. Die realen Probleme sind unterschiedliche
angezeigte Wahrheiten, unzuverlässiges Nachreichen von Schreibaktionen und
inkonsistente Veröffentlichungen — nicht ein fehlender Konsensalgorithmus
zwischen zwei gleichberechtigten Datenbanken.

## Inhaltsverzeichnis

- [Prüfverfahren und Aussagegrenzen](#prüfverfahren-und-aussagegrenzen)
- [1. Technische Architektur und Infrastruktur](#1-technische-architektur-und-infrastruktur)
- [2. Fachliche Logik und Erhalt des Kernnutzens](#2-fachliche-logik-und-erhalt-des-kernnutzens)
- [3. Mathematische Modelle und Performance](#3-mathematische-modelle-und-performance)
- [4. Inkonsistenzen, Schnittstellen und Synchronisierung](#4-inkonsistenzen-schnittstellen-und-synchronisierung)
- [5. Bugs, Randfälle und Sicherheit](#5-bugs-randfälle-und-sicherheit)
- [6. Konkrete, priorisierte Empfehlungen](#6-konkrete-priorisierte-empfehlungen)

## Prüfverfahren und Aussagegrenzen

### Evidenzklassen

- **R — reproduziert:** Verhalten mit unverändertem Anwendungscode und
  kontrollierten synthetischen Daten ausgelöst. Je nach Befund: Funktions-,
  HTTP-, Fehler-Injektions- oder echter Chromium-Test.
- **S — statisch belegt:** Kontrollfluss oder Konfiguration ist im geprüften
  Stand eindeutig. Die konkrete Auswirkung im Produktivbetrieb wurde nicht
  gemessen.
- **O — offen:** Erfordert Zielhardware, reale Betriebsdaten, einen Restore
  oder einen längeren Lastversuch.

**Prioritäten:** **P0** = vor einer Freigabe des betroffenen Sicherheits- oder
Integritätsversprechens beheben; **P1** = vor einer belastbaren Failover- oder
Qualitätsabnahme; **P2** = anschließende Härtung. Eine Priorität ist keine
Behauptung, dass jeder Fehler in jeder Installation bereits eingetreten ist.

### Tatsächlich ausgeführte Prüfungen der Audit-Sitzung

| Prüfung | Ergebnis |
|---|---|
| Python-Suite | **1.238 bestanden**, 227,67 s |
| Ruff, exakt im CI-Prüfumfang | Check und Formatprüfung bestanden |
| Web-Unit-Tests | **1.233 Tests in 45 Dateien bestanden** |
| TypeScript/Vite-Build | bestanden |
| Reguläre Playwright-Suite | **38 bestanden** |
| Playwright gegen den echten Demo-App-Server | **45 bestanden, 14 übersprungen, 1 fehlgeschlagen** |
| Wiederholung des fehlgeschlagenen Tests | erneut fehlgeschlagen: Labor-Inhalt bei 320 px überläuft um ca. 7 px |
| Zusätzliche Gegenproben | unter anderem Veröffentlichung, Ledger, Auth/Proxy, Pi-Empfehlung, Queue, echter Service Worker, echter Pi→NAS-Rückwechsel, Backtest/Kalibrierung, DST, Worker-Signal |

Browser: Chromium **153.0.8010.0**, über `@sparticuz/chromium` bereitgestellt,
weil der normale Playwright-Download nicht erreichbar war. Sandbox:
**x86_64, Python 3.11.2, NumPy 2.4.6, pandas 3.0.6, Node 22.22.3**.
Der Layoutbefund gilt für diese gemessene Browser-/Fontumgebung; er ist kein
Beweis für ein identisches Ergebnis auf jedem Endgerät.

**Nicht erfolgt:** Docker-Image-Abnahme, Messung am tatsächlichen NAS oder Pi,
Prüfung von Netzsegmentierung/TLS im Heimnetz, Stromausfalltest, echter
Influx-Restore, Langzeit-Leak-Test oder Qualitätsvergleich mit privaten
Felddaten. Historische Dokumentation und synthetische Demo-Ergebnisse ersetzen
diese Nachweise nicht. Kein Anwendungscode wurde im Zuge dieses Audits verändert.

Die regulären Browserläufe prüfen den Service Worker nicht im normalen
Produktivmodus: [`web/src/main.tsx:17–22`][sw-main] verhindert seine Registrierung
bei `navigator.webdriver`. Die gesonderte Chromium-Gegenprobe registrierte
explizit den unveränderten Worker. Eine grüne UI-Suite schließt dessen Fehler
somit nicht aus.

### Nachvollziehbarkeit

Der versionierte Text wurde für diesen PR aus den festgehaltenen Ergebnissen
der vorangegangenen Audit-Sitzung rekonstruiert. Das ursprüngliche externe
Bericht-/Rohbelegpaket stand dabei nicht mehr im Workspace zur Verfügung;
die zusätzlichen Gegenproben wurden für diesen PR nicht erneut ausgeführt.

Die Quellenverweise sind auf den geprüften Commit gepinnt. Die folgenden
Abschnitte halten die wesentlichen Eingaben, Fehler-Injektionspunkte und
beobachteten Ausgaben der Gegenproben fest. Die Audit-Sitzung erzeugte außerdem
separate temporäre Diagnose-Skripte und JSON-Protokolle; diese sind **nicht
Bestandteil der versionierten Befunddokumentation** und keine bereits integrierte
Regressionstestsuite. Bei einer Korrektur müssen die beschriebenen Gegenproben
als dauerhafte Tests aufgenommen werden. Spätere PR-Prüfläufe sind von den
oben festgehaltenen historischen Audit-Ergebnissen zu unterscheiden.

## 1. Technische Architektur und Infrastruktur

### 1.1 Tatsächliche Rollenverteilung

```text
Preisanbieter
    │
    ▼
Pi: Collector → RAM-JSONL-Puffer → Uploader ─────→ NAS: InfluxDB
    │                                               │
    │                                               ▼
    │                                   Archiv + Training + Backtests
    │                                   Huber / AR(2) / PAVA / Bootstrap
    │                                               │
    │                           Prognoseexport ← Veröffentlichung
    │                                  │
    ▼                                  ▼
Pi: Livepreise + Prognosecache + Proxy / reduzierte Oberfläche
    │                                  │
    └──────── Browser: NAS-UI oder Pi-UI; lokale Offline-Queue
                                       │
                          NAS allein: Belege, Profile, Episoden,
                          Qualitätsauswertung und aktive Schwellen
```

**Positiv:** Ein führender persönlicher Datenbestand, ausgelagerte Numerik,
getrennte Worker, BLAS auf einen Thread begrenzt, begrenzte Logs, atomare
Ersetzung einzelner Dateien und idempotente Beleg-IDs sind vernünftige
Entscheidungen.

**Grenze:** Das ist ein **Degradationssystem**, kein hochverfügbarer
Zwei-Knoten-Cluster. Wer den NAS direkt im Browser anspricht, erhält durch
einen zweiten Pi-Server noch keinen automatischen Adress-Failover. Wer immer
die Pi-Adresse verwendet, macht den Pi zum einzigen Eintrittspunkt. Ein
Pi-Ausfall betrifft dann GUI-Einstieg und Collector zugleich. Ein gemeinsamer
Router-/Stromausfall wird nicht redundant abgefangen.

### 1.2 A1 — Atomare Dateien ergeben noch keine atomare Veröffentlichung · P0 / R

**Quelle:** [`app/data.py:154–213`][pub-writer], [`891–953`][pub-reader].

Stationsdateien heißen stabil `<UUID>.<fuel>.json`. Der Writer ersetzt diese
Dateien nacheinander und schreibt erst anschließend `current.json`. Die
behauptete Commit-Zeiger-Eigenschaft funktioniert damit nicht: Der alte Zeiger
referenziert bereits überschriebene Inhalte.

**Reproduktion:**

1. Zwei Stationen veröffentlichen: A mit 1,70 €/L, B mit 1,80 €/L.
2. Neuen Lauf beginnen: A soll 1,50, B 1,60 liefern.
3. Nach Ersetzen von A einen Schreibfehler für B injizieren.
4. Den bisherigen Index unverändert lassen und den Leser neu aufbauen.

**Ergebnis:** Index unverändert; geladen werden **A=1,50 und B=1,80** aus
unterschiedlichen Läufen. `publication_status` meldet `readable=true`.

Zusätzlich hängt die Memoisierung nur am Index. Ein warmer Prozess kann den
alten konsistenten Stand weitersehen, ein kalter Leser bereits den Mischstand.
Das ist eine konkrete Quelle widersprüchlicher NAS-/Pi-Antworten.

**Korrekturrichtung:** Unveränderliche, generations- oder inhaltsadressierte
Dateien; erst danach ein atomar gewechseltes Manifest. Inhalte mit
Hash/Schema/Identität prüfen. Alte Generationen erst löschen, wenn sie nicht
mehr benötigt werden. Absichtlich übernommene alte Modelle dürfen ein altes
Modell-Origin haben, müssen aber explizit als `retained_previous` im neuen,
konsistenten Manifest stehen. Modell-Origin und Veröffentlichungs-Generation
sind nicht dasselbe.

### 1.3 A2 — Erreichbarkeit wird mit Einsatzbereitschaft verwechselt · P1 / R+S

**Quelle:** [`rp2/fallback_gui.py:505–541`][pi-health], [`768–842`][pi-proxy].

- Ein HTTP-200-Healthcheck mit nicht parsebarem Inhalt wird als online
  akzeptiert. Bei fehlender Content-Length wird zunächst gar kein Body gelesen;
  auch das kann als online gelten. **Mit beliebigem Text reproduziert.**
- Ein NAS, dessen Healthcheck 200 liefert, dessen Fach-API aber 503 antwortet,
  bleibt aus Pi-Sicht online. Der 503 wird durchgereicht, ohne auf den
  vorhandenen lokalen Preisbestand auszuweichen. **Reproduziert.**
- Die Probe läuft außerhalb der Sperre. Mehrere gleichzeitig ausgelöste
  Prüfungen können sich überholen und ältere Ergebnisse einen jüngeren Zustand
  überschreiben.
- Ein Fehler nach Beginn der Proxy-Antwort kann in einen anschließenden
  Fallback-Versuch führen. Auf einer bereits begonnenen HTTP-Antwort darf aber
  keine zweite Antwort angehängt werden.

Die Defaults von 2 s Health-Timeout, 15 s Proxy-Timeout und 15/30 s Health-TTL
sind **keine garantierte Umschaltzeit**. Browsercache, Polling und
Fehlerklassifikation kommen hinzu.

**Korrekturrichtung:** Zustände wie `nas_ready`, `nas_degraded`,
`pi_prices_only`, `pi_forecast_valid`, `recovering`; fachbezogene Readiness
statt nur HTTP-Liveness; deduplizierte Health-Probe, geordnete Zustandswechsel
und Hysterese. Erst nach vollständiger Prüfung der Ersatzantwort entscheiden,
woher eine Antwort kommt.

### 1.4 A3 — Pi-Risiko: I/O, Parallelität und Rückstau, nicht Huber · P1/P2 / S+O

| Ressource | Befund |
|---|---|
| CPU | JSONL lesen/parsen, mehrere HTTP-Verbindungen, Proxy und Rückstau-Uploader; keine reguläre schwere Engine-Numerik. Der 5-s-Snapshotcache mit Lock verhindert immerhin paralleles Mehrfachlesen desselben Snapshots. |
| RAM | Der Uploader lädt sämtliche unbestätigten Zeilen, baut zusätzlich Line-Protocol-Strings und einen gemeinsamen Request-Body. Ein 32-MiB-Puffer bedeutet nicht 32 MiB Prozessbedarf. Python-Objekte und Kopien kommen hinzu. |
| HTTP-Threads | Der Pi nutzt einen Thread pro Verbindung ohne entsprechenden Idle-Timeout und ohne explizites Parallelitätsbudget. Der NAS hat dagegen einen 65-s-Handler-Timeout, aber ebenfalls keinen harten Gesamt-Threaddeckel. |
| Datenträger | Der dokumentierte Preis-Puffer liegt im tmpfs und schont die SD. **`/tmp/tankapp_cache` ist durch seinen Namen nicht automatisch tmpfs.** Die mitgelieferten Cache-/GUI-Units sichern diesen Mount nicht ab. |
| Reboot / langer Ausfall | Nicht hochgeladene tmpfs-Daten gehen beim Neustart verloren. Der Collector entfernt nach sieben Tagen auch unbestätigte alte Dateien. Das ist begrenzte Pufferung, keine dauerhafte Queue. |
| Watchdog | Die dokumentierte Uploader-Unit hat 30 s Watchdog; ein einzelner Influx-Write darf bereits 30 s blockieren. Ping, Webhook und Schleifenarbeit kommen hinzu. Ein Restart-Zyklus bei langsamem NAS ist plausibel, aber am Zielsystem nicht geprüft. |

**Quellen:** [`read_unsynced`][upload-read], [`run_upload`][upload-run],
[`ring_prune`][ring-prune], [Pi-Unit][pi-unit],
[Betriebsanleitung/Watchdog][watchdog].

**Wichtig zur SD-Abwägung:** „RAM schont die Karte“ ist richtig, „damit gehen
keine Daten verloren“ nicht. Bei einem NAS-Ausfall ist gerade der noch nicht
hochgeladene Bestand die einzige Kopie. Die Verlustgrenze muss ausdrücklich
entschieden werden. Falls diese Daten erhalten bleiben müssen: begrenzte,
gebündelte persistente Spool auf geeignetem Medium und gegebenenfalls USV —
nicht einfach alle fünf Sekunden mehr auf dieselbe SD schreiben.

### 1.5 A4 — NAS-Deployment und Sicherung sind noch nicht betrieblich abgenommen · P1 / S+O

**Gut:** Nicht-root, Capabilities entfernt, `no-new-privileges`, Logrotation,
`init`, read-only Konfigurationsmounts. [Compose][compose]

**Lücken:**

- Keine expliziten CPU-/RAM-/PID-Limits. Automatisch bis zu acht Modellprozesse
  können mit API und Influx um dieselben Ressourcen konkurrieren.
  `shm_size: 256m` ist kein RAM-Limit des Containers.
- Das Deployment verwendet `up --build --force-recreate`; eine Warnung vor
  laufenden Jobs verhindert deren Abbruch nicht. Ein getesteter transaktionaler
  Rollback ist dadurch nicht gegeben.
- Das dokumentierte Influx-Backup sichert ein laufendes Datenbankvolume per
  `tar`, ohne Datenbank-Backup-Protokoll oder Quiescing. Das kann einen
  inkonsistenten Stand erzeugen; es ist **nicht** bewiesen, dass jedes solche
  Tar unbrauchbar wäre. Auch die Restore-Anweisung enthält kein ausdrückliches
  vorheriges Stoppen. [Backup-Anleitung][backup-doc]
- `ops/nas/backup.sh` schreibt direkt auf den endgültigen Tagesnamen. Die
  Überwachung prüft Dateizustand/Alter, nicht Wiederherstellbarkeit. Ein
  frischer, unvollständiger Sicherungsstand kann damit den falschen Eindruck
  vermitteln, die Sicherung sei erfolgreich. [Skript][backup-script]

**Erforderlich:** Datenbankkonsistente Sicherung, temporärer Dateiname bis zur
erfolgreichen Validierung, Manifest/Prüfsummen und echter Restore-Test. Alter
ist ein Betriebsindikator, kein Integritätsnachweis.

## 2. Fachliche Logik und Erhalt des Kernnutzens

### 2.1 Was im Fallback tatsächlich erhalten bleibt

| Fähigkeit | NAS | Pi bei NAS-Ausfall |
|---|---|---|
| Live-Preisvergleich | Influx-/API-basiert | lokal gepufferte Collector-Meldungen |
| Kalibrierte Fenster-/Stationsentscheidung | Decision Layer mit Draws, Qualitäts- und Produktregeln | andere Quantil-Heuristik; keine identische Entscheidung |
| Mehrtage-Prognosen / vollständige Draws | vorhanden | beim Export entfernt |
| Beleg-/Episodenbuchung | führender Store | kein lokaler führender Store; Server-Schreibversuch 503 |
| Profile / Reserve / Deadline / individuelle Nutzung | NAS-Geschäftszustand | nicht als gleichwertiger Entscheidungszustand repliziert |
| Aktive Schwellen | aus NAS-Regeln/Ledger, Nachzug optional | feste Pi-Schwelle, unter anderem 1 € fürs Warten |
| Nachreichen offline erfasster Eingaben | Browser sendet an NAS | abhängig von dieser einen Browser-Queue |

**Quelle:** [`last_forecasts`][pi-export], [`Pi-Entscheidung`][pi-decide],
[`NAS-Schwellen`][thresholds].

Der Export setzt bewusst `decision_ready=false` und entfernt alle Draws sowie
3-/7-Tage-Punkte. Aus fünf marginalen Quantilen lässt sich die gemeinsame
Verteilung von Fensterminima und Stationsdifferenzen **nicht eindeutig
rekonstruieren**. Das ist eine Informationsgrenze, nicht lediglich eine Frage
der Implementierungsgeschwindigkeit.

**Fachliches Fazit:** Wenn der Kernnutzen „Preise noch sehen“ heißt, ist der
Fallback sinnvoll. Wenn er „dieselbe verlässliche Entscheidung unter denselben
persönlichen Randbedingungen“ heißt, ist er nicht erhalten.

### 2.2 F1 — Der Pi wird gerade im schlechter informierten Zustand entscheidungsfreudiger · P1 / R

**Reproduktion:**

- Station A: 1,70 €/L, Meldung 40 Minuten alt.
- Station B: 1,80 €/L, Meldung eine Minute alt.
- Prognose für A: `decision_ready=false`, `calibrated=false`,
  `stale_data_at_origin=true`, rotes Rolling-PICP-Merkmal.

**Ergebnis:** A wird gewählt; `fresh=false` bleibt ein Hinweisfeld. Der Pi
antwortet trotzdem mit **`recommendation="wait"`**, Preis-Score 50 % und
erwarteter Ersparnis 1 € bei 40 L.

Die Oberfläche relativiert die Empfehlung erst, wenn **das ganze Set** keine
frischen Preise mehr hat. Eine frische teurere Station reicht deshalb, um die
Empfehlung für die veraltete billigere Station nicht zu verhindern.
[`rp2/fallback_gui.py:1195–1221`][pi-decide], [`2380–2419`][pi-render]

Die Bezeichnung „keine kalibrierte Wahrscheinlichkeit“ ist eine sinnvolle
Warnung, neutralisiert aber keinen imperativen Satz wie „Warten lohnt sich“.
Ebenso wenig ersetzt sie Reserve, Deadline, Umwegkosten oder das NAS-Qualitätsgate.

**Notwendige Invariante:** Ein Fallback darf durch weniger Informationen keine
Aktion freigeben, die im Hauptsystem wegen fehlender Qualität oder
Randbedingungen gesperrt wäre.

### 2.3 F2 — „Erwartete Ersparnis“ bezeichnet unterschiedliche mathematische Größen · P1 / R+S

Der Pi modelliert innerhalb `q025..q975` eine Gleichverteilung. Sein
Ersparniswert entspricht dort sinngemäß:

`E[max(heutiger Preis − späterer Preis, 0)]`.

Das ist der positive Teil eines Vorteils, **nicht** der erwartete Nettoeffekt
einer fest geplanten späteren Betankung:

`E[heutiger Preis − späterer Preis]`.

**Gegenbeispiel:** Späterer Preis gleichverteilt zwischen 1,60 und 1,80 €/L;
heute 1,70. Der signierte Erwartungswert beträgt **0 €**. Der Pi meldet
**2,5 ct/L**, also **1 € für 40 L**, und erreicht damit seine Warteschwelle.
Mögliche Mehrkosten werden auf null gesetzt. Eine entsprechende kostenlose
Rückgriffsmöglichkeit auf den heutigen Preis ist fachlich nicht garantiert.

Der NAS verwendet in `expected_saving` wiederum eine nach unten bei null
abgeschnittene **Medianersparnis der Fensterminima**. Auch das ist kein
arithmetischer Erwartungswert. Diese Kennzahl kann als typische/günstige
Fensteraussicht sinnvoll sein, muss aber so benannt und bewertet werden.
[Pi-Rechnung][pi-score], [NAS-Rechnung][nas-saving]

Zusätzliche Einschränkungen:

- Die äußeren 5 % der Verteilung werden durch die Pi-Gleichverteilung nicht
  modelliert.
- Aus zwei Randquantilen und einem Median folgt keine allgemeine kleine
  Fehlerschranke für die CDF. Eine pauschale Prozentpunkte-Garantie ist ohne
  Verteilungsannahme nicht begründet.
- Einzelne günstige 5-Minuten-Punkte sind keine robusten, voneinander getrennten
  Tankfenster.
- Das nachträglich beobachtete Fensterminimum ist eine andere Zielgröße als der
  Preis, den ein Nutzer mit realer Anfahrt/Verfügbarkeit erzielt. Das muss im
  operativen Nutzenvergleich getrennt bleiben.

### 2.4 F3 — Retention entfernt den persönlichen Langzeitnutzen aus den Berechnungen · P1 / R

**Quelle:** [`app/feedback.py:585–648`][ledger-load],
[`Wallet-Bilanz`][wallet-balance].

Fills, Episoden und Settlements werden nach 90 Tagen aus dem aktiven JSON-Store
in `archive.jsonl` verschoben. Die betrachteten Bilanz-, Statistik- und
Gate-Pfade lesen den aktiven Store; ein entsprechender Archiv-Lesepfad für die
Allzeit-/Jahresberechnung wurde nicht gefunden.

**Reproduktion:** Ein 100 Tage alter Beleg zählt zunächst in `n_fills_total`.
Nach einer gesperrten Store-Operation existiert zwar die Archivdatei, aber die
aktive Bilanz fällt von **1 auf 0**.

Folgen:

- „Allzeit“ und Jahresbilanz sind keine belastbare Allzeit-/Jahresgrundgesamtheit.
- Auch der als Allzeit beschriebene M7-Nachweis kann historische Evidenz verlieren.
- Ein Backup kann den Rohbeleg retten; es repariert nicht dessen Auslassung in
  der laufenden Fachlogik.

**Korrekturrichtung:** Dauerhafter Ereignisbestand mit expliziten
Auswertungsfenstern, oder ein transaktional gepflegtes Archiv-/Aggregatmodell.
Speicherbegrenzung des Hot Stores und fachliche Aufbewahrung sind getrennte
Anforderungen.

## 3. Mathematische Modelle und Performance

### 3.1 Einordnung der Verfahren

**Huber-M-Schätzung:** IRLS mit MAD-basierter Skalierung, Huber-Konstante 1,345
und maximal 30 Iterationen ist grundsätzlich eine vernünftige robuste
Regressionsimplementierung. Robustheit gegen einzelne Residuen ist aber kein
Schutz gegen Zukunftsinformation, falsche Quellenzuordnung oder systematische
Regimewechsel. Bei ausgeschöpften Iterationen wird das letzte Ergebnis
zurückgegeben; daraus allein folgt keine nachgewiesene Konvergenz.
[`engine/models.py:323–336`][huber]

**Zwei verschiedene isotone Aufgaben:**

1. PAVA projiziert Preisverläufe auf die modellierte Monotonie zwischen lokalen
   Mittagsgrenzen.
2. Isotone PIT-Rekalibrierung korrigiert die prognostizierte Verteilung.

Eine gute Formprojektion beweist keine gute Wahrscheinlichkeitskalibrierung.
Eine marginal gut kalibrierte Verteilung beweist umgekehrt keine korrekte
gemeinsame Fenster-/Stationsverteilung.

**Bootstrap:** Tagesblöcke, zeitliche Gewichtung, geteilte Stationsziehungen
und Day-Pairs sind wesentlich sinnvoller als unabhängiges Ziehen einzelner
Ticks. Sie lösen aber nicht automatisch Datenlecks, fehlende Herkunftsbindung
oder einen falsch definierten Holdout.

### 3.2 M1 — Die 24-h-Rekalibrierung bekommt null Daten · P1 / R

**Quelle:** [`engine/backtest.py:638`][horizon-engine] gegenüber
[`app/model_jobs.py:332–345`][horizon-consumer].

Die Engine schreibt für die erste Tagesprognose `horizon_hours=0`. Der NAS
selektiert für seinen 24-h-Kandidaten nur Zeilen mit `horizon_hours==24`.

**Echter Engine-Gegenlauf:** 1.512 Backtestzeilen, ausschließlich Horizont 0.
Im NAS-Kandidaten danach:

```json
{"status":"insufficient_pit","n_pit":0,"min_pit_samples":500}
```

Das ist weder zu wenig Rechenleistung noch zu wenig Historie.
**Die Produzenten-/Konsumentenverträge widersprechen sich.** Mehr Tage, mehr
Ziehungen oder ein stärkerer NAS beheben diesen Fehler nicht. Rohprognosen
können weiterhin entstehen; die erwartete technische 24-h-Rekalibrierung wird
dadurch nicht erreicht.

**Abnahme:** Echter Engine-Backtest muss bis in den NAS-Kandidaten durchlaufen.
Vorlauf des Zieltags und Länge des Prognosehorizonts müssen getrennt bzw.
eindeutig definiert werden; nicht nur eine weitere passende Test-Fixture bauen.

### 3.3 M2 — Zentrierter Hampel-Filter verletzt die zeitliche Trennung · P1 / R

**Quelle:** [`engine/data.py:147–168, 187–205`][hampel], danach Backtest-Cutoff.

Die Ausreißermaske wird zentriert auf dem gesamten gelieferten
Beobachtungsbestand berechnet, bevor die Backtest-Folds ihre Vergangenheit
abschneiden.

**Reproduktion:** Ein bereits vergangener Punkt ist im Datenpräfix als
Ausreißer markiert. Nach Anhängen späterer Nachbarwerte ist derselbe vergangene
Punkt nicht mehr markiert.

Damit hängt die Trainings-/Bewertungsmenge eines früheren Cutoffs von späteren
Beobachtungen ab. Ein bloßes Abschneiden der bereits gefilterten Reihe beseitigt
dieses Leck nicht. Eine zentrierte Zeilenzahl ist zudem nicht zwingend ein
festes Zeitfenster: Bei 10-Minuten-Polls oder Lücken verändert sich die zeitliche
Spannweite.

**Abnahme:** Ein zukünftiger Suffix darf weder vorbereitete Trainingswerte noch
Masken eines früheren Cutoffs ändern. Für Live-/Backtest-Parität kausale
Aufbereitung oder explizit pro Fold nur verfügbare Daten verwenden.
Retrospektive Datenqualitätsdiagnostik davon getrennt halten.

### 3.4 M3 — Sommerzeit erzeugt eine falsche Monotoniegrenze · P1 / R

**Quelle:** [`engine/models.py:194–227`][dst].

`normalize() + Timedelta(hours=12) − Timedelta(days=1)` verwendet verstrichene
Stunden auf zeitzonenbehafteten Zeitstempeln statt lokaler Kalenderarithmetik.

**Reproduktion, Europe/Berlin:** 25.10.2026, 23:55 → 26.10.2026, 00:00.
Der Segmentierer erzeugt zwei verschiedene Mittags-Schlüssel, 11:00 und 12:00.
Ein Verlauf **1,50 → 1,70 €/L** bleibt deshalb unverändert, obwohl Mitternacht
laut eigenem Modell keine erlaubte Anhebungsgrenze ist.

Das ist ein Formfehler der ausgelieferten Prognose, keine bloß falsche
Beschriftung. Die nächste entsprechende Herbstumstellung liegt nach dem
Prüfdatum am **25.10.2026**. Dies ist eine Kalendergrenze, keine Bestätigung
ungeklärter steuer-/preisrechtlicher Annahmen aus dem Regime-Plan.

**Abnahme:** Mittagsgrenzen auf lokalem Datum konstruieren, dann lokalisieren.
Testen: 23-/25-Stunden-Tage, beide Übergänge über Mitternacht, echte
Mittagsgrenze und vollständige Mehrtagspfade.

### 3.5 M4 — Der Standard-Profilkern verliert einen modellierten Feiertagseffekt · P2 / R

**Quelle:** [`engine/models.py:772–816`][holiday-fit],
[`1497–1558`][holiday-predict].

Beim Fit wird der gepoolte Feiertagseffekt abgezogen. Der harmonische
Prognosezweig addiert ihn wieder hinzu; der `profile_ar2`-Punktpfad nicht.

**Kontrollierte Sensitivitätsprobe:** Auf dem Feiertag 03.10.2026 wird
ausschließlich `holiday_beta` im gefitteten Modell um 0,05 €/L erhöht.
Der harmonische Median steigt um 0,05, der Profilmedian um **0,00**.

Das betrifft einen tatsächlich von null verschiedenen, konfigurierten
Feiertagseffekt. Ohne `city_subdivs` bzw. mit `holiday_beta=0` entsteht daraus kein
entsprechender Preiseffekt. Da `profile_ar2` der NAS-Default ist, sollte die
gemeinsame Modellkomponente trotzdem nicht still fehlen.

### 3.6 M5 — Das M7-Gate lässt systematischen Wahrscheinlichkeitsbias durch · P1 / R

**Quelle:** [`app/feedback.py:2138–2169`][m7-gate].

Die Reliability-Prüfung betrachtet die Steigung, nicht zugleich den
Achsenabschnitt bzw. die Kalibrierung im Mittel.

**Gegenprobe:** 400 synthetische Vorhersagen in 20 Tagesblöcken:

| Ausgegebene Wahrscheinlichkeit | Tatsächliche Häufigkeit |
|---:|---:|
| 20 % | 30 % |
| 60 % | 70 % |

Beide Gruppen liegen um **10 Prozentpunkte** daneben. Trotzdem: Brier 0,22
gegenüber Basis 0,25, Reliability-Steigung 1,0 mit Intervall [1,0; 1,0],
**`calibrated=true`**.

Eine Steigung von eins ist mit `E[Y|p]=p+0,1` vereinbar. Guter Skill gegen eine
schwache Referenz ist ebenfalls keine vollständige Kalibrierung.

**Korrekturrichtung:** Kalibrierung im Mittel/Intercept, Reliability über den
relevanten Wahrscheinlichkeitsbereich und proper scoring getrennt prüfen.
Die Skill-Differenz gegen Referenzen gemeinsam blockweise resamplen, statt nur
ein Modellintervall gegen feste Referenzpunkte zu halten. Keine Freigabe allein
anhand dieses konstruierten Beispiels; es zeigt die logische Lücke des aktuellen
Statistikgates, nicht eine bestandene Produktfreigabe.

### 3.7 M6 — Provenienz und Validierung sind noch unvollständig · P1 / R+S

- Der Kandidat speichert `day_pair`; die Aktivierung prüft nur Modellkern und
  `shared_draws`. **Reproduziert:** Ein akzeptierter Kandidat mit
  `day_pair=false` wird aktiviert, ohne dass der Aktivierungsvertrag diesen
  Verteilungsparameter überhaupt entgegennehmen kann. Ein Wechsel des
  Day-Pair-Modus kann damit vorübergehend eine alte Kurve auf eine andere
  Verteilung anwenden. [`calibration_envelope`][cal-envelope]
- Der zeitlich getrennte PIT-Holdout ist positiv. Seine Quantilbänder verwenden
  aber Tick-Fallzahlen; benachbarte Preise sind nicht unabhängige
  Bernoulli-Versuche. Die effektive Stichprobe muss in Tages-/Regimeblöcken
  beurteilt werden. [`assess_candidate`][cal-assess]
- Eine Prüfung transformierter PITs ist noch kein vollständiger Replay aller
  späteren Pfadtransformationen und der tatsächlichen Fensterentscheidungen.
  Die finale Ausgabe nach Rekalibrierung/Formkorrektur muss selbst
  out-of-sample bewertet werden.
- Der Backtest arbeitet mit Tages-Cutoffs; operative Neuveröffentlichungen und
  Nutzerentscheidungen haben andere Zeitpunkte und Datenalter. Das
  veröffentlichte `operational_replay=false` ist insofern ehrlich. Die
  vorliegenden Tests liefern keinen Ersatz für diesen fehlenden operativen
  Qualitätsnachweis.

**Empfehlung:** Ein Modell-/Kalibrierungs-Fingerprint muss mindestens
Modellkern, Day-Pair-/Shared-Modus, relevante Konfiguration, Horizontdefinition,
Daten-Cutoff und Verfalls-/Regimebezug abdecken.

### 3.8 Was die Verfahren tatsächlich kosten

Für eine Float64-Pfadmatrix gilt näherungsweise:

`Speicher = Ziehungen B × Zeitpunkte H × 8 Byte`.

Bei 5-Minuten-Raster und 7 Tagen: `H=2016`. Für `B=2000` sind das **30,76 MiB
allein für eine Matrix**. Dazu kommen DataFrames, Residuen, Projektionen,
Quantile, temporäre Arrays und weitere Prozesse. Ein 24-h-Pfad benötigt bei
gleicher Ziehungszahl 4,39 MiB.

**Eigene Sandbox-Mikromessung — ausdrücklich kein NAS-/Pi-Benchmark:** eine
synthetische Station, 45 Tage 5-Minuten-Daten, 42-Tage-Fit, `profile_ar2`,
Shared-/Day-Pair-Modus, BLAS=1; pro Tabellenzeile ein eigener Prozess.
Keine Voll-Refresh-/Backtest-/Influx-Messung.

| Horizont | Draws | Prognoseberechnung | Pfadmatrix | Prozess-Peak-RSS einschließlich Python/pandas/Fit |
|---|---:|---:|---:|---:|
| 24 h | 500 | 0,124 s | 1,10 MiB | 101,68 MiB |
| 24 h | 1.000 | 0,134 s | 2,20 MiB | 103,93 MiB |
| 24 h | 2.000 | 0,176 s | 4,39 MiB | 115,89 MiB |
| 7 d | 500 | 0,620 s | 7,69 MiB | 104,95 MiB |
| 7 d | 1.000 | 1,070 s | 15,38 MiB | 117,19 MiB |
| 7 d | 2.000 | 1,625 s | 30,76 MiB | 142,47 MiB |

Der Fit lag in diesem kleinen Versuch bei ungefähr 0,15–0,17 s. Daraus lässt
sich weder eine Pi-Laufzeit noch die Dauer des vollständigen Modelljobs
ableiten. Die Messung zeigt aber: **Ziehungen reduzieren verkleinert den
Draw-Anteil; Training verkürzen ist ein anderer Eingriff.**

Ein weiterer relevanter NAS-Pfad ist nicht die Engine: `compute_advice_stats`
führt synchron jeweils 1.000 Resamples für Brier und Reliability aus. Mit
1.000 synthetischen Snapshots dauerte ein Aufruf **0,367 s**, mit 5.000
**2,082 s**. Der Statistik-/Entscheidungspfad verwendet diese Berechnung ohne
einen hier erkennbaren ergebnisversionsgebundenen Cache. Mehrere Poller können
somit teuer werden, obwohl der Fit korrekt im Hintergrund läuft.

### 3.9 Draws oder Trainingsfenster verkleinern: erwartbare Folgen

**Draws:** Für eine Monte-Carlo-Wahrscheinlichkeit gilt bei unabhängigen
Ziehungen ungefähr `SE = sqrt(p(1−p)/B)`. Bei `p=0,5`:

| B | Standardfehler | Ungefähre 95-%-Monte-Carlo-Spanne |
|---:|---:|---:|
| 500 | 2,24 Prozentpunkte | ±4,38 Prozentpunkte |
| 1.000 | 1,58 Prozentpunkte | ±3,10 Prozentpunkte |
| 2.000 | 1,12 Prozentpunkte | ±2,19 Prozentpunkte |

Das ist **nur Ziehungsrauschen**, nicht die gesamte Prognoseunsicherheit.
Datenabhängigkeit, Modellfehler und Auswahl eines besonders günstigen Fensters
sind darin nicht enthalten. Am 2,5-%-Rand entsprechen 500 Draws nur ungefähr
12–13 Randziehungen. Die NAS-Veröffentlichung begrenzt Decision-Draws ohnehin
auf **500**; 2.000 Engine-Pfade bedeuten deshalb nicht automatisch 2.000
unabhängige Informationen in jeder angezeigten Aktionswahrscheinlichkeit.
[`_draws`][draws]

**Trainingsfenster:** 42 → 28 Tage reduziert nicht nur CPU, sondern verändert
die statistische Grundlage, die Verteilung der Tagesblöcke und die
Schätzstabilität. Einzelne Wochen-/Feiertags-/Regimeeffekte können schlechter
identifizierbar werden. Mehr Draws aus weniger historischen Tagen ersetzen
die verlorenen Tage nicht.

**Meine Empfehlung:** Auf dem Pi keine Fits ergänzen, nur um anschließend deren
Qualität herunterzudrehen. Falls eine eigenständige Notfall-Inferenz später
wirklich benötigt wird: bereits gefittetes, versioniertes NAS-Modell oder
kompakte gemeinsame Draw-Zusammenfassung übernehmen; zunächst 24 h und ein
Prozess; 500/1.000 Draws gegen 2.000 prüfen. Das 42-Tage-Training vorerst auf dem
NAS behalten. Eine konkrete Verschlechterung von MAE/PICP/Brier lässt sich
ohne echten gepaarten Qualitätsvergleich nicht seriös beziffern.

## 4. Inkonsistenzen, Schnittstellen und Synchronisierung

### 4.1 I1 — Die Browser-Queue ist derzeit keine verlässliche Übergabe · P0 / R+S

**Quelle:** [`web/src/offline-queue.ts:125–182, 201–232`][queue],
[`web/src/data.ts:1488–1544`][queue-callers].

| Gegenprobe | Tatsächliches Ergebnis | Fachliche Folge |
|---|---|---|
| Queue mit 50 Einträgen; weiterer Beleg bei 503 | Antwort `queued=true`, Länge bleibt 50 | Neuer Beleg wird als vorgemerkt bestätigt, obwohl er nicht aufgenommen wurde. |
| `localStorage.setItem` scheitert | Antwort `queued=true`, persistierte Einträge: 0 | Speicherung wird behauptet, obwohl nichts haltbar gespeichert ist. |
| A wird gesendet; während `await` wird B eingereiht | Währenddessen `[A,B]`, danach `[]`; nur A gesendet | Ein neuer Beleg geht durch Zurückschreiben eines alten Snapshots verloren. |
| Nachreichversuch erhält 429 | Eintrag als endgültig abgelehnt entfernt | Ein temporäres Rate-Limit vernichtet den automatischen Retry. |
| Eintrag älter als sieben Tage | still aus der Rückgabeliste entfernt; kein `rejected`-Eintrag | Kein verlässlicher sichtbarer Abschluss für den Nutzer. |

Zwei weitere Schnittstellenprobleme:

- Auto-Flush erfolgt bei Mount und Browser-`online`. Ein NAS-Neustart im
  weiterhin funktionierenden WLAN erzeugt normalerweise kein
  Browser-`online`-Ereignis. Automatisches Nachreichen ist damit nicht
  zuverlässig an die tatsächliche NAS-Wiederkehr gekoppelt.
  [`overview.tsx:365–372`][queue-trigger]
- `localStorage` ist originbezogen. NAS-Adresse und Pi-Adresse sind getrennte
  Speicher, ebenso andere Browser/Geräte. „Auf dem anderen Gerät ist der NAS
  wieder da“ synchronisiert keine dort liegenden Belege.

Der Pi-Proxy bündelt die Clients zudem hinter seiner NAS-seitig sichtbaren IP.
Das dortige Schreibbudget kann daher mehrere Browser gemeinsam treffen. Eine
längere Queue sofort abzuarbeiten und dabei 429 als endgültige Ablehnung zu
löschen, ist gerade beim Wiederanlauf die falsche Kombination.

**Was bereits richtig ist:** Der Client vergibt vor dem Versand eine Beleg-ID
und einen Tankzeitpunkt; der NAS dedupliziert die ID. Das schützt Wiederholung,
aber nicht Verlust **vor** dem Versand.

**Korrekturrichtung:** Transaktionale Outbox, beispielsweise IndexedDB;
Zustand pro Eintrag (`pending/sending/acked/retry/rejected`); Bestätigung erst
nach erfolgreicher lokaler Persistenz; IDs statt alter Gesamtliste löschen;
Mehrtab-Koordination; 429/temporäre Konflikte mit Backoff und Retry-After.
Nicht nachreichbare/abgelaufene Einträge sichtbar und exportierbar halten.

### 4.2 I2 — NAS-Wiederkehr wechselt die API, nicht die bereits geladene Oberfläche · P1 / R

**Quelle:** [Pi-Routing][pi-routing], [Pi-Renderer][pi-render],
[NAS-Decision-Vertrag][nas-decision].

Der Pi schaltet pro Request auf die NAS-API um. Die noch geöffnete
Pi-HTML-Oberfläche erwartet aber weiterhin Felder wie `available`, `f1`, `f2`
und `health.nas`; die NAS-Antwort hat unter anderem `primary` und einen anderen
Health-Vertrag. Auch `/api/v1/forecasts` ist nicht derselbe NAS-Pfad.

**Echter Browser, echte Handler, synthetischer Bestand:**

```text
Vorher:       „Aktueller Preisvergleich“ / „NAS offline“
NAS-Check:    online=true
Nächster Pi-UI-Refresh:
              „Noch kein frischer Preis.“ / „NAS nicht konfiguriert“
NAS-API:      6 Stationen, 6 Preise
Nach Reload:  NAS-React-Oberfläche vorhanden, Pi-Template ersetzt
```

Der manuelle Reload-Pfad funktioniert. Ein normal weiterlaufender Tab ist aber
während der automatischen Rückkehr nicht vertragssicher.

**Korrekturrichtung:** Entweder ein versionierter einheitlicher API-Vertrag für
beide Oberflächen oder Sitzung an einen Modus binden und einen ausdrücklich
koordinierten Reload anbieten. Kein ungekennzeichneter Schemawechsel unter
einer laufenden UI. Queue und Eingabestatus müssen den Wechsel nachweislich
überleben.

### 4.3 I3 — Rückstau-Upload ist nur unter Zusatzannahmen idempotent · P1 / R+S

**Quelle:** [`data-tools/upload_influx.py:150–184`][upload-read],
[`220–241`][upload-tags].

1. **ACK ist eine Uhrzeit, keine Ereignissequenz.** Ausgewählt wird
   ausschließlich `fetched_at > ack`. In der Gegenprobe wird eine neue,
   ungesendete Zeile mit Zeitstempel vor dem ACK nicht ausgewählt. Ein
   Rücksprung der Uhr oder eine nachträglich ergänzte ältere Zeile verletzt
   die Vollständigkeit.
2. **Veränderliche Metadaten sind Teil des Influx-Tagsatzes.** Stationsname
   und Stadt sind Tags. Derselbe fachliche Messpunkt erhält nach einer
   Namens-/Labeländerung einen anderen Line-Protocol-Serienschlüssel. Der
   Zeitstempel allein garantiert damit keinen idempotenten Replay. Die
   Änderung des Schlüssels wurde geprüft; ein tatsächlicher Influx-Doppelpunkt
   wurde hier mangels Influx-Instanz nicht erzeugt.
3. **Catch-up ist nicht begrenzt gebatcht.** Normaler Upload baut den gesamten
   Rückstau in einem Request auf. RAM- und Zeitbedarf steigen gerade bei
   Wiederkehr des NAS, wenn gleichzeitig UI und Modelljobs wieder anlaufen.

**Korrekturrichtung:** Monotone lokale Sequenz bzw. bestätigte Dateioffsets
zusätzlich zur fachlichen Ereigniszeit; stabile physische Identität im
Serien-/Idempotenzschlüssel; veränderliche Metadaten separat; begrenzte Batches
mit nachvollziehbarer Einzel-/Bereichsbestätigung.

### 4.4 I4 — Lücken werden erzeugt „geschlossen“, anschließend aber wieder entfernt · P1 / R+S

**Quelle:** [`app/refresh.py:256–337`][gap-refresh],
[`engine/bootstrap.py:82–126`][gap-bootstrap].

`fill_gaps` schreibt Archivereignisse mit `source=history`. `refresh` lädt
diese gemeinsam mit Live- und Archivdaten und reicht sie an `bootstrap`
weiter. Dort werden Nicht-Live-Zeilen nach der ersten Live-Beobachtung
ausgeschlossen; im `live_only`-Modus werden sie vollständig ausgeschlossen.

**Gegenprobe:** Eine historische Füllzeile zwischen zwei Live-Zeilen wird
eingelesen, aber `history_rows_used=0`; im Ergebnis bleiben nur die beiden
Live-Preise.

Damit widerspricht die nachgelagerte Eigentumsregel dem Zweck der
Lückenfüllung. Eine Erfolgsmeldung „Lücke geschlossen“ belegt nicht, dass der
Fit diese Werte verwendet. Der vollständige Aufrufpfad wurde im Quellcode
nachvollzogen; die Gegenprobe isoliert den entscheidenden Merge-/Bootstrap-Schritt.

**Korrekturrichtung:** Priorität pro Verfügbarkeits-Bucket statt pauschal für
die gesamte Zeit nach `first_live`: echte Live-Zustände einschließlich
„geschlossen/kein Preis“ haben Vorrang; nur wirklich fehlende Buckets dürfen
gezielt durch gekennzeichnete Gapfill-Ereignisse ergänzt werden. Zähler am
**tatsächlich verwendeten** Trainingsbestand ausweisen.

### 4.5 I5 — Ein während des Modelllaufs eintreffender Trigger wird entkräftet · P1 / R

**Quelle:** [`app/server.py:358–394`][scheduler].

Nach Ende von `run_once` wird das Wake-Event pauschal gelöscht. Die Begründung,
der Job habe „ja gerade gerechnet“, ignoriert seinen früheren Eingabe-Cutoff.

**Reproduktion:** Während des laufenden Jobs wird eine neuere Watermark
eingetragen und Wake gesetzt. Nach Ende verbleibt `pending={models:999}`,
aber **`wake_is_set=false`**. Ohne weiteren Trigger kann die Bearbeitung bis
zum regulären nächsten Lauf warten.

**Korrekturrichtung:** Eingangs-Watermark pro Lauf festhalten; nach Abschluss
höchste noch nicht verarbeitete Watermark vergleichen; genau einen
koaleszierten Folgelauf anfordern. Pending-Watermarks monoton zusammenführen.
Ein Refresh darf nicht behaupten, Daten verarbeitet zu haben, die erst nach
seinem Eingabe-Snapshot ankamen.

## 5. Bugs, Randfälle und Sicherheit

### 5.1 S1 — Der Leseschutz ist ein unvollständiger Vertrag · P0 bei Schutzbedarf / R+S

**a) Informationsleck trotz gesetztem Token — R.**
`/api/v1/stats/summary` fehlt in der Personal-Route-Liste. Die Antwort enthält
aber Wallet, letztes Tanken, Tankmenge und persönliche Auswertungen. Mit
konfiguriertem Token liefert `/fills` ohne Token 401, die Statistik ohne Token
dagegen **200 plus letzten Beleg inklusive Stationsname, Zeitpunkt, Litern
und Preis**. [`server.py:35–61`][auth-list],
[`stats_summary.py:456–507`][stats-personal]

Auch andere aggregierende Antworten, etwa `/decide` mit `personal_stats`,
müssen bei einer vollständigen Datenklassifikation berücksichtigt werden.
Eine handgepflegte Liste vermeintlich persönlicher URLs ist dafür zu schwach.

**b) Leseinhalt über Schreibendpunkt — R.**
`POST /fills` mit einer bekannten bestehenden ID gibt vor der weiteren
Validierung den vollständigen vorhandenen Beleg zurück. Der Endpunkt ist
absichtlich nicht durch den Lesetoken geschützt. Ein reiner GET-Schutz kann
so umgangen werden; das ist kein Erraten sämtlicher IDs, sondern ein
nachgewiesener Bypass für bekannte IDs.
[`feedback.py:1244–1249`][fill-idempotency]

**c) Pi entfernt Credentials — R.**
Derselbe berechtigte `GET /fills` liefert direkt am NAS 200, über den Pi
**401**, weil der Proxy Authorization nicht weiterreicht. Auch `If-None-Match`
und `Accept-Encoding` werden nicht entsprechend übertragen;
Sicherheitsantwortheader werden nur teilweise weitergereicht. Im Test
verschwindet `X-Content-Type-Options: nosniff`. [Proxy][pi-proxy]

**d) Docker-Konfiguration reicht das Secret nicht durch — S.**
`compose.yml` enthält eine explizite Environment-Liste mit Webhook-Token,
aber ohne `TANKAPP_READ_TOKEN`. Ein bloß im Host-Shell-Prozess gesetztes
Secret wird nicht automatisch Container-Environment. Die Betriebsanweisung
suggeriert hier eine Schutzwirkung, die der ausgelieferte Compose-Pfad nicht
herstellt. [Compose][compose], [Anleitung][token-doc]

**e) Writes bleiben offen — bewusste Entscheidung, aber Integritätsrisiko.**
Die Dokumentation benennt dies ausdrücklich. Es wäre falsch, daraus eine
heimlich eingeführte Authentifizierung zu behaupten. Es ist aber ebenso falsch,
ein Schreibbudget als Integritätsschutz zu behandeln. In der HTTP-Gegenprobe
akzeptiert der Server einen Profil-POST mit fremdem `Origin` und
`Content-Type: text/plain`. Der JSON-Parser prüft beides nicht. Ein
vollständiger Angriff aus einer beliebigen Internetseite ist damit noch
nicht bewiesen; Browser-/Private-Network-Regeln hängen von der konkreten
Installation ab. Der serverseitige Schutz fehlt unabhängig davon. [Parser][payload]

**Empfehlung:** Ein klarer LAN-/Benutzer-Vertrauensentscheid; bei Schutzbedarf
Authentisierung für Reads **und** Mutationen, serverseitige
Origin-/Content-Type-Policy, Proxy-Headervertrag, TLS und negative
Integrationstests auf der tatsächlich genutzten Pi-Adresse.

### 5.2 S2 — Service Worker: Streamfehler, Token-Cache und wirkungslose harte Altersgrenze · P0/P1 bei aktivem Worker / R

**Quelle:** [`web/public/sw.js:55–83`][sw].

Drei getrennte Fehler wurden mit dem unveränderten Worker im echten Chromium
reproduziert:

1. **Erster API-Netzabruf scheitert:** Der Worker verwendet `response.body`
   für eine neue Response, klont diese für den Cache und gibt anschließend
   die ursprüngliche Response zurück. Deren Body ist nun gesperrt. Der Browser
   meldet `TypeError: Failed to fetch`, obwohl der Server erfolgreich
   geantwortet hat. Die Gegenprobe bestätigt explizit
   `original_body_locked_after_clone=true`.
2. **Tokenwechsel trennt den Cache nicht:** Die autorisierte Antwort wird
   gespeichert. Derselbe Browser erhält danach ohne Token HTTP 200 mit dem
   privaten Beleg aus dem Cache, obwohl der Netzwerkaufruf unautorisiert ist.
   `Cache-Control: no-store` hilft nicht, weil der Worker ausdrücklich in
   CacheStorage schreibt. Eine entsprechende Credential-Partition oder
   Löschung bei Tokenänderung fehlt.
3. **Die 30-Minuten-Grenze ist keine harte Grenze:** Unterhalb der Grenze
   kommt zunächst die Cache-Antwort, auch bei funktionierendem Netz. Oberhalb
   der Grenze fällt `network || cached` bei Netzausfall weiterhin auf den
   alten Cache zurück. Eine **24 Stunden alte** private Antwort wurde
   erfolgreich geliefert.

Das betrifft den Cache im jeweiligen Browser/Origin, nicht automatisch fremde
Browser. Auf gewöhnlichen HTTP-LAN-IP-Adressen sind Service Worker normalerweise
gar nicht verfügbar; dort besteht dieses konkrete Worker-Verhalten nicht,
aber auch keine daraus abgeleitete PWA-Offline-Garantie. HTTPS/PWA und
HTTP-LAN müssen getrennt abgenommen werden.

**Korrekturrichtung:** Original-Netzantwort unangetastet zurückgeben, getrennten
Clone cachen; persönliche APIs standardmäßig nicht cachen oder explizit
geschützten Offline-Datenvertrag schaffen; 401/403 und Tokenwechsel müssen alte
persönliche Antworten entwerten. Dynamische Zustands-/Health-/Decision-Antworten
brauchen Network-first bzw. klar gekennzeichnete, hart begrenzte Ersatzdaten.

### 5.3 S3 — Beschädigter Ledger wird als neuer leerer Ledger behandelt · P0 / R

**Quelle:** [`app/feedback.py:617–648`][ledger-load],
[`locked_store:548–555`][ledger-lock].

Lesefehler und ungültiges JSON werden auf `raw=None` reduziert; daraus entsteht
ein leerer Store. Die nächste erfolgreiche Mutation speichert diesen Zustand
über den bisherigen Bestand.

**Reproduktion:** Vorhandene beschädigte Belegdatei → `load_store().fills=[]`
→ neue Audit-Mutation → gültige neue Store-Datei ohne den bisherigen Inhalt.

Das ist ein **stiller Datenverlustpfad**, kein hilfreicher Fallback.
„Datei fehlt bei Erstinstallation“ und „bestehende Datei kann nicht korrekt
gelesen werden“ sind unterschiedliche Zustände. Die Profilpersistenz verwendet
ein ähnliches Muster; diese Analogie ist statisch belegt, nicht separat
beschädigt durchgetestet. [Profile][profiles-read]

**Korrekturrichtung:** Korruption/Lesefehler fail-closed; Schreibsperre mit
erkennbarem Fehlercode; beschädigten Stand unverändert quarantänisieren;
validierte letzte Sicherung anbieten. Für den dauerhaften persönlichen Zustand
ist eine kleine transaktionale Datenbank eine sachlich begründete
Vereinfachung — nicht wegen Datenmenge, sondern wegen Integrität, Migration
und Archivierung. Die konkrete Speichertechnik bleibt eine gesonderte
Entscheidung; der nachgewiesene Überschreibpfad muss unabhängig davon weg.

### 5.4 S4 — SIGTERM protokolliert Abbruch, beendet aber die Arbeit nicht · P1 / R

**Quelle:** [`app/worker.py:186–212, 246–279`][worker].

Der Signalhandler schreibt `aborted`, kehrt anschließend aber zurück.
Der laufende Code kann fortfahren und später über `finish` wieder `success`
schreiben.

**Kontrollierter echter SIGTERM an den installierten Worker-Handler:** Zustand
unmittelbar danach `aborted`, weiterer Code wird ausgeführt, abschließender
Zustand **`success`**, Exitcode 0. Die eigentliche Modellarbeit war für diesen
Test durch einen harmlosen Stub ersetzt; es wurde kein Produktivjob signalisiert.

Der Scheduler kann den Prozess später hart beenden. Das beseitigt weder das
Zwischenfenster für weitere Veröffentlichungen noch den widersprüchlichen
Status. Zusammen mit A1 ist dies beim Container-Recreate besonders ungünstig.

**Korrekturrichtung:** Gemeinsames Cancellation-Flag bzw. definierter
Abbruchpfad bis zu allen Commit-Stellen; nach Abbruch keine erfolgreiche
Veröffentlichung mehr. Grace-Period, Worker-Pool und Status müssen denselben
Vertrag erfüllen.

### 5.5 Weitere relevante Risiken, ohne überzogene Beweisbehauptung

- **Cache-Ersetzung:** Der Pi-Cache akzeptiert jede Antwort mit `forecasts`
  als Liste, auch eine leere. Schema, Generation, Alter und Mindestvollständigkeit
  werden nicht hinreichend geprüft. Ein formal gültiger Leerstand kann den
  letzten brauchbaren Cache ersetzen. Ob ein ausdrücklich leerer Bestand
  gewollt ist, muss über einen Vertrag statt über Listenform entschieden werden.
  [`cache_forecasts.py:85–114`][cache-writer]
- **Proxy-Speicherlimit:** Im HTTPError-Pfad wird erst `exc.read()` vollständig
  ausgeführt und danach auf 32 MiB abgeschnitten. Das ist kein tatsächliches
  Leselimit. Im erfolgreichen Pfad kann nach Überschreiten der Grenze eine
  bereits angefangene Antwort mit ursprünglicher Content-Length abgeschnitten
  werden. [Proxy][pi-proxy]
- **Wertvalidierung:** Der Pi-Test `is_number` schließt bool aus, aber nicht
  allgemein NaN/Unendlich oder zukünftige Zeitstempel. Strenge finite-/Zeit-/
  Schema-Prüfungen sollten vor Ranking und Frischebewertung gelten.
- **Lecks:** Kein Langzeit-Speicherleck am Zielgerät nachgewiesen. Offene
  Threads, Rückstau-Objekte und unbudgetierte Parallelität sind Ressourcenrisiken;
  sie als gemessenen „Memory Leak“ zu verkaufen wäre unredlich.
- **UI:** Der reproduzierte 320-px-Labor-Überlauf ist ein roter Abnahmepunkt
  dieser Browserumgebung, aber deutlich nachrangig gegenüber Belegverlust,
  falschen Schutzversprechen und falscher fachlicher Freigabe. Er war beim
  geprüften Stand als B5 offen. **Nachtrag:** Die gesonderte Layoutkorrektur
  ist im [Release 0.59.2](../releases/CHANGELOG.md#0592--2026-09-20) dokumentiert;
  die historischen Audit-Ergebnisse bleiben unverändert.

## 6. Konkrete, priorisierte Empfehlungen

### 6.1 Must-Fix für den Failover und die Datenintegrität

| Reihenfolge | Maßnahme | Verbindliche Abnahme |
|---:|---|---|
| **P0–1** | Falsche Speicherbestätigung und Queue-Verlust beseitigen. | Voller/gesperrter Speicher bestätigt nichts als gespeichert. A senden + B parallel einreihen verliert B nicht. Mehrere Tabs deduplizieren. 429 bleibt retryfähig. Jeder Eintrag hat einen sichtbaren Abschluss. |
| **P0–2** | Beschädigten Ledger fail-closed behandeln. | Ungültige Datei, Permission-Fehler und abgeschnittener Inhalt lassen sich durch keinen API-Write überschreiben. Wiederherstellung behält IDs und Summen. |
| **P0–3** | Unveränderliche Publikationsgenerationen und atomaren Manifestwechsel einführen. | Nach Fehler/SIGTERM an jeder Schreibposition sehen kalte und warme Leser ausschließlich die komplette alte oder komplette neue Generation; kein ungekennzeichneter Mischstand. |
| **P0–4** | Schutzvertrag einschließlich Compose, Pi-Proxy, aggregierten Reads und Post-Rückgaben schließen. | Mit aktivem Schutz erhält ein unautorisierter Client keine persönlichen Daten; autorisierte Reads funktionieren direkt und über Pi. Eine Schreibauthentisierung setzt eine ausdrückliche Änderung des bisherigen LAN-Vertrauensmodells voraus. |
| **P0–5** | Aktiven Service Worker reparieren oder bis zur Abnahme persönliche/dynamische API-Caches abschalten. | Cold-cache-Erstaufruf funktioniert; Tokenentzug beendet den Zugriff; harte Altersgrenze wird eingehalten. Test mit tatsächlich aktivem Worker, nicht nur `webdriver`-Normalpfad. |
| **P1–1** | Pi zunächst ehrlich auf frischen Preisvergleich bzw. begrenzte Prognoseanzeige zurückstufen. | Keine Tank-/Warteaktion bei veraltetem ausgewähltem Preis, abgelaufenem Paket oder fehlenden harten persönlichen Constraints. Reduzierte Qualität kann keine neue Freigabe erzeugen. |
| **P1–2** | NAS↔Pi-API-Modus und Rückwechsel versionieren. | Ein bereits geöffneter Tab überlebt NAS aus/an, ohne falschen „nicht konfiguriert“-Status, Schemafehler oder verschwundene Eingaben. |
| **P1–3** | Wake-/Watermark- und Uploader-Verträge korrigieren. | Daten während eines Fits erzeugen genau einen erforderlichen Folgelauf. Uhr-Rücksprung, Stationsumbenennung und Upload-Retry verlieren/duplizieren keine Ereignisse. |

**Architekturentscheidung:** Das NAS als einzigen Ledger-Schreiber beibehalten.
Nicht als erste Reparatur einen zweiten beschreibbaren Pi-Ledger und ein
Merge-Verfahren hinzufügen. Zunächst den bestehenden Ein-Schreiber-/Outbox-Vertrag
zuverlässig machen.

Für ein späteres erweitertes Fallback-Paket mindestens festlegen:

`schema_version`, `publication_generation`, `model_signature`, `generated_at`,
`valid_until`, unterstützte Consumer-Version, Stationsidentität, Qualitätsgründe
und explizit erlaubte Fähigkeiten. Bei persönlichen Policies deren Version
und Gültigkeit mitführen — oder bewusst keine personalisierte Entscheidung
erlauben.

### 6.2 Mathematische Anpassung für den Pi — und notwendige NAS-Korrekturen

**Vor jeder Optimierung:**

1. **Horizontvertrag reparieren** und echten Backtest → Kandidat → Aktivierung
   → finale Prognose testen.
2. **Zeitliche Kausalität herstellen:** zukünftige Daten dürfen frühere
   Fits/Filtermasken nicht verändern.
3. **DST-Segmentierung vor dem 25.10.2026 korrigieren.**
4. **Gapfill bis zum tatsächlich verwendeten Trainingsbestand prüfen.**
5. **M7 um Bias-/Kalibrierungsprüfung ergänzen;** Day-Pair-/Konfigurationsprovenienz
   vollständig binden; Feiertagskomponente zwischen Modellkernen harmonisieren.

**Für den Pi selbst:**

- **Bevorzugt:** keine lokale Schätzung; kompakte, validierte NAS-Ergebnisse
  plus frische lokale Preise. Das ist die größte und statistisch sauberste
  Ressourceneinsparung.
- **Falls unabhängige Inferenz wirklich nötig ist:** zunächst 24 h, ein Prozess,
  begrenzte Stationen, vorab gefittetes Modell bzw. gemeinsame kompakte Draws.
  500/1.000 Ziehungen als **zu prüfende Varianten**, nicht als bereits
  freigegebene Einstellung.
- **Nicht blind 42 auf 14 Tage kürzen.** Training bleibt zunächst NAS-Aufgabe.
  Fensterverkürzung und Draw-Reduktion getrennt untersuchen, damit Ursachen von
  Qualitätsverlusten identifizierbar bleiben.
- **Keine Quantil-Gleichverteilung als Ersatz für die gemeinsame Verteilung
  verkaufen.** Entweder konservative Anzeige ohne Aktionsfreigabe oder denselben
  klar definierten, datenminimalen Decision-Kernel verwenden.

**Abnahmeversuch:** identische historische Cutoffs, identische Regime-/DST-/
Ausfalltage und identische Seeds bzw. gemeinsame Zufallszahlen für die
Varianten. Messen: MASE/MAE, Quantil-Score bzw. CRPS, PICP und Intervallbreite,
Brier/Kalibrierung der tatsächlichen Ereignisse, Wechsel der empfohlenen
Aktion nahe den Schwellen und realisierte Nettoersparnis/Regret.
Konfidenzintervalle über Tage/Episoden, nicht über vermeintlich unabhängige
5-Minuten-Ticks. Akzeptanzmargen vor dem Versuch festlegen.

### 6.3 Betrieblich notwendige Härtung

1. **NAS-Budgets messen und setzen:** cgroup-Speicherspitze/PSS, Workerzahl,
   CPU-/I/O-Prioritäten; API-Latenz während vollständigem Fit und Catch-up
   messen. Nicht die Summe einzelner RSS-Werte als exakten Poolbedarf verwenden.
2. **Pi-Budgets setzen:** begrenzte Request-Gleichzeitigkeit, Read-/Idle-Timeouts,
   begrenzte Upload-Batches, konsistentes Watchdog-Budget. `MemoryMax`/`TasksMax`
   anhand gemessener Spitzen plus Reserve, nicht anhand einer erfundenen
   Pi-Laufzeit wählen.
3. **Speichermedium prüfen:** Mounttyp von `/tmp/tankapp_cache`, tatsächliche
   Schreibmengen und Journald-Modus feststellen. Die dokumentierte
   tmpfs-Annahme maschinell prüfen.
4. **RPO/RTO festlegen:** für Preise, Prognosen und persönliche Belege getrennt.
   „Sieben Tage FIFO“ ist nur eine Obergrenze bei ausreichendem Platz und ohne
   Pi-Reboot, keine garantierte Verlustfreiheit.
5. **Backups restaurieren:** Influx und persönlichen Bestand in eine leere
   Testumgebung zurückspielen; IDs, Summen, Zeitbereiche und referenzierte
   Publikationsdateien vergleichen. Erst danach „Backup erfolgreich“ melden.
6. **Teure Advice-Statistik versionsgebunden vorrechnen/cachen.** Invalidierung
   an Ledger-/Policy-Version binden; dieselben Bootstraps nicht für jeden
   Poller neu rechnen.
7. **Jahres-/Allzeitdaten fachlich dauerhaft halten.** Retention darf die Bilanz
   nicht rückwirkend verkürzen.

### 6.4 Mindestmatrix für eine belastbare Freigabe

| Szenario | Erwartete Zusicherung |
|---|---|
| NAS-Prozess aus, Pi und WLAN an | Frische lokale Preise bleiben sichtbar; kein erfundener Schreib-Erfolg. |
| NAS-Health 200, Fach-API 503 oder falsches Schema | Gezielter Degradationsmodus statt falscher Online-/Bereit-Aussage. |
| NAS kehrt bei geöffnetem Tab zurück | Vertragssicherer UI-Wechsel; alle wartenden Einträge bleiben erhalten und werden nachvollziehbar abgearbeitet. |
| NAS-Update während Fit/Veröffentlichung | Keine Mischgeneration, kein nach SIGTERM unerlaubter Commit. |
| Browser offline/online, 429, voller Speicher, zwei Tabs | Kein stiller Belegverlust; eindeutige Pending-/Ack-/Fehlerzustände. |
| Token ändern/entziehen, direkt und über Pi, Worker aktiv | Keine alte persönliche Antwort aus Cache oder Nebenroute. |
| Pi-Reboot während NAS-Ausfall | Verlustgrenze entspricht erklärtem RPO; keine falsche Behauptung vollständiger Synchronisierung. |
| Uhr zurück, Stationsname ändern, altes Segment erneut senden | Vollständiger und idempotenter Ereignisbestand. |
| DST, Feiertag, Regimewechsel und zukünftiger Datensuffix | Kalender-/Kausalitätsinvarianten erfüllt; Qualität separat gemessen. |
| Restore in leere Umgebung | Persönliche Summen und relevante Datenstände reproduzierbar wiederhergestellt. |

**Priorisierte Schlussfolgerung:** Nicht zuerst mehr Modelle, mehr Ziehungen
oder eine komplexere Zwei-Knoten-Synchronisation bauen. Zuerst
**Belegpersistenz, Veröffentlichungsintegrität, Schutzgrenzen und ein ehrliches
Fallback** herstellen. Danach die nachgewiesenen mathematischen Vertragsfehler
beheben. Erst dann sind Hardware-Tuning und Aussagen zur Prognosequalität
sinnvoll belastbar.

[pub-writer]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/app/data.py#L154-L213
[pub-reader]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/app/data.py#L891-L953
[pi-health]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/rp2/fallback_gui.py#L505-L541
[pi-proxy]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/rp2/fallback_gui.py#L768-L842
[pi-unit]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/rp2/tankapp-fallback-gui.service
[watchdog]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/docs/betrieb/BETRIEB.md#L149-L170
[compose]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/ops/nas/app/compose.yml
[backup-doc]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/docs/betrieb/BETRIEB.md#L920-L954
[backup-script]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/ops/nas/backup.sh
[pi-export]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/app/data.py#L1806-L1834
[pi-decide]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/rp2/fallback_gui.py#L1186-L1311
[pi-render]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/rp2/fallback_gui.py#L2380-L2427
[pi-score]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/rp2/fallback_gui.py#L399-L474
[nas-saving]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/app/pside.py#L96-L120
[thresholds]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/app/thresholds.py#L52-L88
[ledger-load]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/app/feedback.py#L585-L648
[ledger-lock]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/app/feedback.py#L527-L557
[wallet-balance]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/app/feedback.py#L2496-L2548
[huber]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/engine/models.py#L323-L336
[horizon-engine]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/engine/backtest.py#L622-L638
[horizon-consumer]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/app/model_jobs.py#L313-L355
[hampel]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/engine/data.py#L147-L205
[dst]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/engine/models.py#L194-L227
[holiday-fit]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/engine/models.py#L772-L816
[holiday-predict]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/engine/models.py#L1497-L1558
[m7-gate]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/app/feedback.py#L2138-L2169
[cal-envelope]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/engine/calibration.py#L325-L377
[cal-assess]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/engine/calibration.py#L247-L321
[draws]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/app/model_jobs.py#L448-L495
[queue]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/web/src/offline-queue.ts#L125-L232
[queue-callers]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/web/src/data.ts#L1488-L1544
[queue-trigger]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/web/src/state/overview.tsx#L365-L372
[pi-routing]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/rp2/fallback_gui.py#L735-L758
[nas-decision]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/app/decide.py#L1276-L1352
[upload-read]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/data-tools/upload_influx.py#L150-L184
[upload-tags]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/data-tools/upload_influx.py#L220-L241
[upload-run]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/data-tools/upload_influx.py#L589-L678
[ring-prune]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/data-tools/collect_prices.py#L279-L315
[gap-refresh]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/app/refresh.py#L256-L337
[gap-bootstrap]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/engine/bootstrap.py#L82-L126
[scheduler]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/app/server.py#L358-L394
[auth-list]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/app/server.py#L35-L61
[stats-personal]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/app/stats_summary.py#L456-L507
[fill-idempotency]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/app/feedback.py#L1244-L1249
[token-doc]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/docs/betrieb/BETRIEB.md#L850-L885
[payload]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/app/server.py#L589-L607
[sw]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/web/public/sw.js#L55-L83
[sw-main]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/web/src/main.tsx#L17-L22
[profiles-read]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/app/profiles.py#L146-L173
[worker]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/app/worker.py#L186-L279
[cache-writer]: https://github.com/kollb/TankApp/blob/da04d463dc8158027edfed9c9aac1958e6b81c57/rp2/cache_forecasts.py#L85-L114
