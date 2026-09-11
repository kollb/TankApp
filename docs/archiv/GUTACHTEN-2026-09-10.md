# Gutachterliche Stellungnahme zur statistischen Methodik und Architektur der TankApp

> **Archiviert — gutachterliche Stellungnahme vom 10.09.2026.**
> Zweitmeinung zur statistischen Methodik (Befunde F1/F2/F5) inklusive des
> Repos-Nachtrags. Übernommene Punkte sind im Code; nicht übernommene
> Empfehlungen stehen begründet in [../LUECKEN.md](../LUECKEN.md) „Bewusst offen“.
> Archiv-Übersicht: [README.md](README.md).

**Stand:** 10. September 2026

## Management Summary

Das vorliegende Konzept für die TankApp zeugt von einer außergewöhnlich hohen analytischen und architektonischen Reife. Die statistische Methodik geht weit über übliche Consumer-Apps hinaus und wendet Verfahren (wie Huber-M-Schätzer für robuste Regression, PAVA für die 12-Uhr-Regel und Beta-Binomial-Updating) an, die in der Ökonometrie Best Practice sind. Die strikte Trennung von Produktivcode und unabhängigem Test-Code (Doppelimplementierung) ist ein exzellentes Qualitätsmerkmal. 

Aus mathematischer, statistischer und praktischer Sicht ist das Konzept absolut praxistauglich und hochgradig relevant. Es gibt jedoch einige mathematische Hürden (insbesondere bei der Signifikanzauflösung) sowie Optimierungspotenziale bei Strukturbrüchen und der Datenarchitektur, die vor einem Produktivbetrieb adressiert werden sollten.

---

## 1. Bewertung der statistischen Designentscheidungen (Sinnhaftigkeit)

* **Huber-IRLS & AR(2):** Eine exzellente Wahl. Tankstellenpreise sind stark autokorreliert und extrem anfällig für Ausreißer (Feiertage, Ferienbeginn). OLS (Least Squares) würde hier völlig versagen. Die Regularisierung der Yule-Walker-Gleichungen schützt zudem vor instabilen Invertierungen bei Datenlücken.
* **12-Uhr-Regel via PAVA (Isotone Regression):** Das ist die mathematisch eleganteste Lösung für das Problem der monoton fallenden Tagessegmente. Da PAVA eine $L_2$-Projektion ist, wird die gesetzliche Rahmenbedingung exakt und ohne heuristische "Wenn-Dann"-Regeln abgebildet.
* **Leave-one-out (LOO) Median für Stationsselektion:** Verhindert das "Self-Masking", bei dem eine Station ihren eigenen Vergleichs-Benchmark nach unten zieht. Mathematisch absolut wasserdicht.
* **Beta-Binomial-Posterior (M7-Gate):** Ein Prior von $\text{Beta}(5,5)$ ist pragmatisch und verhindert, dass die App bei den ersten zwei (zufälligen) Treffern eine 100%-Sicherheit ausgibt.

---

## 2. Harte Fehler und Konfigurationsprobleme (Korrekturbedarf)

### Befund F2 (Die B=200 Hürde im NAS-Job)
Das ist kein "kleines Auflösungsproblem", sondern ein harter mathematischer Blocker. 
Die Berechnung lautet: 
$$p_{min} = \frac{1}{B+1}$$
Bei $B=200$ ist $p_{min} = 0,00498$. 

Die Benjamini-Hochberg-Korrektur multipliziert diesen Wert im strengsten Fall mit der Anzahl der Hypothesen $m$. Wenn $m=11$ Stationen getestet werden, ist der kleinstmögliche q-Wert $0,00498 \times 11 = 0,0547$. 
Da $0,0547 > 0,05$ (Signifikanzniveau), ist es für die App bei 11 Stationen **mathematisch unmöglich**, jemals eine Empfehlung abzugeben, selbst wenn eine Station den Kraftstoff verschenkt.
* **Lösung:** Der NAS-Job muss zwingend auf $B \ge 2000$ konfiguriert werden. Die Laufzeit von 668 ms (aus Kapitel 4.3) ist für einen asynchronen Backend-Job absolut vernachlässigbar.

### Befund F1 (Bug in der Prozentanzeige)
Ein klassischer Formatierungsfehler in Python (vermutlich wird der Float $0,5$ direkt als `%` formatiert statt $\times 100$). Muss vor dem M7-Gate zwingend behoben werden, um den Trust der Nutzer nicht zu zerstören.

---

## 3. Antworten auf die Gutachterfragen (Kapitel 8)

| Frage | Gutachterliche Einschätzung |
| :--- | :--- |
| **1. Block-Bootstrap vs. parametrisch & Trainingsfenster** | Der nichtparametrische Tagesblock-Bootstrap ist korrekt, da er die starke Intraday-Abhängigkeit erhält (was ein parametrisches Rauschen zerstören würde). Dass 42 Tage nur $\approx 92\%$ Abdeckung erreichen, liegt in der Natur begrenzter Atome. **Optimierung:** Statt das Fenster auf 84 Tage zu verlängern (was die Trägheit bei Preiswechseln erhöht), könnte ein **exponentiell gewichteter Bootstrap** helfen, bei dem neuere Tagesblöcke mit einer höheren Wahrscheinlichkeit gezogen werden als alte. |
| **2. P-Wert Konstruktion & B-Erhöhung** | Die Formel $\frac{1+\dots}{B+1}$ ist der Goldstandard (nach Davison/Hinkley) für Permutations-/Bootstrap-Tests unter $H_0$. Eine sequenzielle Erhöhung ("bis zur Signifikanz") ist statistisch unsauber (P-Hacking). **Lösung:** $B$ vorab fix auf 2000 (oder 5000) setzen. |
| **3. FDR vs. FWER (Mehrfachvergleich)** | Für diese Domäne ist **FDR (Benjamini-Hochberg)** absolut richtig. FWER (Bonferroni/Holm) kontrolliert den Fehler, als hinge ein Menschenleben davon ab. In einer TankApp ist eine "falsche Entdeckung" (FDP) lediglich eine Station, die 0 Cent statt $-2$ Cent Ersparnis bringt. Eine FWER-Kontrolle wäre viel zu konservativ und würde echte Sparpotenziale unterdrücken. |
| **4. Backtest-Gates & Asymmetrie** | Die aktuellen Metriken (MASE, PICP95) sind sehr akademisch. In der Praxis der Umweg-Ökonomie ist der Verlust asymmetrisch: Warten und in eine 10-Cent-Erhöhung laufen, kostet massiv Vertrauen. Zu früh tanken und 2 Cent verpassen, schmerzt weniger. Ein **asymmetrischer Pinball-Loss** (der Überschätzungen stärker bestraft) wäre zielführender. |
| **5. M7-Gate & Kalibrierung** | $n \ge 100$ und $\text{Brier} < 0,25$ sind robuste Startwerte. Ein Reliability-Diagramm ist für Data Science wertvoll, aber für die automatisierte Gate-Freigabe reicht der Brier-Score als quadratisches Fehlermaß völlig aus. |
| **6. Fallback-GUI (Gleichverteilung)** | Der Formfehler von bis zu 8,4 Prozentpunkten ist in einer Fallback-Situation vertretbar. Wichtig ist nur, dass das UI dies nicht "Wahrscheinlichkeit" nennt, sondern Begriffe wie "Preis-Score" oder "Historisches Quantil" verwendet. |

---

## 4. Konzeptuelle Schwächen und Optimierungspotenzial

### Regimewechsel (Befund F5)
Das Modell verwendet den Median über das gesamte Trainingsfenster (z.B. 42 Tage) für die Effektgröße $\hat{\delta}$. 
Wenn eine Station nach 21 Tagen den Betreiber wechselt oder die Preisstrategie ändert, ist der Median für weitere 21 Tage faktisch "blind", da er den Durchschnitt zweier unterschiedlicher Verteilungen bildet (wie in Kap 4.3 korrekt gemessen).
* **Praktische Optimierung:** Implementiere in der Pipeline einen simplen Strukturbruch-Test (z.B. CUSUM oder Chow-Test) auf den täglichen $\hat{\delta}$-Werten. Alternativ kann $\hat{\delta}$ als **Exponentially Weighted Moving Average/Median (EWMA)** berechnet werden. Das gibt den Preisen der letzten 5 Tage mehr Gewicht als den von vor 5 Wochen und macht die App reaktionsschneller auf echte Marktveränderungen.

### Architektur & Systemdesign (Ergänzung)
Obwohl das System eine hervorragende "Separation of Concerns" aufweist, sollten folgende strukturelle Aspekte vor dem Go-Live verfeinert werden:
* **Datenbank-Trennung:** Während InfluxDB für die 5-Minuten-Zeitreihen perfekt ist, müssen die transaktionalen Daten des Feedback-Ledgers (`app/feedback.py`) strikt davon getrennt in einer relationalen Datenbank (z.B. SQLite oder PostgreSQL) abgelegt werden, um ACID-Konformität zu gewährleisten.
* **Event-Pipeline statt Polling:** Um Race Conditions zwischen dem Dateneingang (Poller) und der Verarbeitung (Inferenz-Cronjob) zu vermeiden, sollte die Architektur auf ein event-getriebenes Modell (z.B. Trigger via Webhook) umgestellt werden, sobald InfluxDB neue Datenpunkte sicher geschrieben hat.
* **Fallback-UI:** Alternativ zum Betrieb eines redundanten Webservers für den Fallback (`rp2/fallback_gui.py`) bietet sich die Umsetzung als leichtgewichtiges PyQt6-Desktop-Widget an, das die Quantil-Daten ressourcenschonend und direkt im lokalen Umfeld visualisiert.

---

## Nachtrag des Repos (10.09.2026 — nicht Teil der Stellungnahme)

Zur Einordnung: Dieses Gutachten entstand **vor** dem [Prüfstand](PRUEFSTAND-2026-09-10.md)
(10.09.2026). Für den Prüfstand wurden Befunde und Empfehlungen gegen den Code
gehalten — mit folgendem Ergebnis:

| Befund / Empfehlung | Befund am Code |
|---|---|
| **F2:** NAS-Job müsse zwingend auf B ≥ 2000 konfiguriert werden | Bereits umgesetzt: `engine/selection.py` rechnet fest mit B = 2000; [ANALYSE.md](../ANALYSE.md) dokumentiert den B=200-Blocker samt Begründung |
| **F1:** Bug in der Prozentanzeige (Float 0,5 als % formatiert) | Im aktuellen Code nicht reproduzierbar — alle Anzeigen rechnen korrekt ×100 (`web/src/Dashboard.tsx`, `app/feedback.py`) |
| Strukturbruch-Test (CUSUM) bzw. EW-Median auf δ̂ | Bereits implementiert: `delta_ew_ct` (EW-Median, HWZ 7 d) und `break_flag`/`break_stat` (CUSUM) in der Selektion |
| Asymmetrischer Pinball-Loss | Bereits Konzept §3.2 Kriterium 3 und `engine/backtest.py` (asym. τ = 0,75, 3× Strafe) |
| Event-getriebene Pipeline (Webhook statt Polling) | Bereits implementiert (Issue 50: `POST /api/v1/jobs/trigger`, Debounce + Idempotenz) |
| Feedback-Ledger in relationale DB (ACID) | Offen entschieden — Status quo ist der JSON-Store; siehe [LUECKEN.md](../LUECKEN.md) „Bewusst offen" und [Prüfstand §3.5](PRUEFSTAND-2026-09-10.md) (Retention als erster Handlungsbedarf) |
| Fallback-UI als PyQt6-Desktop-Widget | Nicht übernommen — der browserbasierte RP2-Fallback bleibt Konzept ([RP2.md](../RP2.md)) |
| Beta-Binomial-Posterior statt Laplace-Glättung | Offen dokumentiert in [LUECKEN.md](../LUECKEN.md) „Bewusst offen"; beide Schätzer sind priorsauber, ein Wechsel vor M7 bringt keinen messbaren Unterschied |

Die Verweise auf „Kapitel 4.3" (668 ms) und „Kapitel 8" (Gutachterfragen) lassen
sich keinem Repo-Dokument zuordnen (Referenzbruch); die Stellungnahme bleibt
sonst unverändert als historisches Arbeitspapier stehen. Offene Code-Aufgaben
aus der Prüfung stehen gebündelt im [Prüfstand §3/§7](PRUEFSTAND-2026-09-10.md).
