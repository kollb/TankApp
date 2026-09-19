# Befund 19.09.2026 — Tankrabatt und Spritpreisdeckel: was die Engine wirklich trifft

> Stand: 19.09.2026 · App-Version **0.55.1** · lebt in `docs/`, solange die
> Punkte offen sind; nach Abschluss von A14–A16/H6–H10 wandert das Dokument nach
> `docs/archiv/` (Hausregel für datierte Befunde, wie
> [archiv/BEFUND-12-UHR-REGEL-2026-09-18.md](archiv/BEFUND-12-UHR-REGEL-2026-09-18.md)
> nach B30). Arbeitspunkte: [../TODO.md](../TODO.md) A14–A16 (Fachlich) und
> H6–H10 (Mathematik), offene Punkte mit Grund in
> [LUECKEN.md](LUECKEN.md#bewusst-offen-backlog-mit-grund).
>
> Anlass: Einigung der Koalition auf
> Tankrabatt (−17 ct/L ab 01.10.2026, befristet bis 31.12.2026) und Spritpreisdeckel
> (spätestens 01.01.2027), plus Prüfung einer Übergewinnsteuer.
> Prüfgegenstand: der vorgelegte Fahrplan-Entwurf „Interventions-Schicht
> (Regime-Handling)" und die Frage, was davon am Code-Stand 0.55.1 trägt.
> Methode: **gegen den Code gelesen und nachgerechnet**, nicht nur gelesen. Alle
> Zahlen dieses Befunds stammen aus Rolling-Origin-Läufen mit der echten
> `engine.models.fit`/`predict`-Kette auf synthetischen Reihen, die auf die
> eigenen Messwerte aus
> [archiv/BEFUND-12-UHR-REGEL-2026-09-18.md](archiv/BEFUND-12-UHR-REGEL-2026-09-18.md)
> kalibriert sind (Tagesspanne 17 ct, Tief Median 7 Uhr, Hoch Median 12 Uhr,
> 44 % Mittagssprünge ≥ 2 ct). **Keine Zahl stammt aus dem Echtbestand** — der
> liegt auf dem NAS und war hier nicht erreichbar. Reproduktion:
> [analysis/regime_check.py](../analysis/regime_check.py) `--simulate`.
> Dieser Befund ist eine Diskussionsvorlage wie
> [BEFUND-UX-MATH-2026-09-19.md](BEFUND-UX-MATH-2026-09-19.md); er ändert kein
> Konzept und keine Zusage.

## Inhaltsverzeichnis

- [0. Kurzfassung: Urteil über den Entwurf](#0-kurzfassung-urteil-über-den-entwurf)
- [1. Was der Entwurf richtig sieht](#1-was-der-entwurf-richtig-sieht)
- [2. Fünf Korrekturen, gemessen](#2-fünf-korrekturen-gemessen)
  - [2.1 Der Punkt heilt — die Verteilung heilt nicht](#21-der-punkt-heilt--die-verteilung-heilt-nicht)
  - [2.2 „17 Cent abziehen“ ist der falsche Mechanismus](#22-17-cent-abziehen-ist-der-falsche-mechanismus)
  - [2.3 Die 12-Uhr-Projektion frisst den Regime-Sprung](#23-die-12-uhr-projektion-frisst-den-regime-sprung)
  - [2.4 Der Deckel ist keine Konstante, und das Clipping sitzt an der falschen Stelle](#24-der-deckel-ist-keine-konstante-und-das-clipping-sitzt-an-der-falschen-stelle)
  - [2.5 Der 42-Tage-Bezug ist nicht das eigentliche Problem](#25-der-42-tage-bezug-ist-nicht-das-eigentliche-problem)
- [3. Was der Entwurf nicht sieht](#3-was-der-entwurf-nicht-sieht)
  - [3.1 Der 1. Januar ist die gefährliche Richtung](#31-der-1-januar-ist-die-gefährliche-richtung)
  - [3.2 Der gepoolte Feiertags-Fit ist heute schon verfälscht](#32-der-gepoolte-feiertags-fit-ist-heute-schon-verfälscht)
  - [3.3 Das Qualitäts-Gate wird durch den Bruch grüner, nicht roter](#33-das-qualitäts-gate-wird-durch-den-bruch-grüner-nicht-roter)
  - [3.4 Der Schwellenregler lernt aus einem Steuergeschenk](#34-der-schwellenregler-lernt-aus-einem-steuergeschenk)
  - [3.5 Der Verstößezähler meldet am 1. Januar Verstöße, die keine sind](#35-der-verstößezähler-meldet-am-1-januar-verstöße-die-keine-sind)
  - [3.6 Die WO-Seite ist immun, die WANN-Seite nicht](#36-die-wo-seite-ist-immun-die-wann-seite-nicht)
- [4. Konzept: Regime-Kante statt Regime-Korrektur](#4-konzept-regime-kante-statt-regime-korrektur)
  - [R1 Regime-Kalender als Daten](#r1-regime-kalender-als-daten)
  - [R2 Schritt als Dummy mit geschätzter Kante und geschätztem Betrag](#r2-schritt-als-dummy-mit-geschätzter-kante-und-geschätztem-betrag)
  - [R3 Erlaubte Sprungzeitpunkte in der bestehenden Projektion](#r3-erlaubte-sprungzeitpunkte-in-der-bestehenden-projektion)
  - [R4 Deckel als bewegliche Schranke vor der Projektion](#r4-deckel-als-bewegliche-schranke-vor-der-projektion)
  - [R5 Ehrliche Degradation statt falscher Zuversicht](#r5-ehrliche-degradation-statt-falscher-zuversicht)
  - [Schema, Umschalter, Tests](#schema-umschalter-tests)
- [5. Strategie: drei Phasen gegen drei Termine](#5-strategie-drei-phasen-gegen-drei-termine)
  - [Phase 0 — bis 30.09.2026 (11 Tage)](#phase-0--bis-30092026-11-tage)
  - [Phase 1 — Oktober bis Dezember 2026](#phase-1--oktober-bis-dezember-2026)
  - [Phase 2 — bis 31.12.2026](#phase-2--bis-31122026)
  - [Warum diese Reihenfolge und nicht die des Entwurfs](#warum-diese-reihenfolge-und-nicht-die-des-entwurfs)
- [6. Einordnung in den Batch-Plan B0–B6](#6-einordnung-in-den-batch-plan-b0b6)
- [7. Abnahme: welcher Beweis zählt](#7-abnahme-welcher-beweis-zählt)
- [8. Offen, ehrlich benannt](#8-offen-ehrlich-benannt)
- [Anhang A: Messtabellen](#anhang-a-messtabellen)
- [Anhang B: Grenzen der Messung](#anhang-b-grenzen-der-messung)

---

## 0. Kurzfassung: Urteil über den Entwurf

**Der Entwurf hat recht mit dem Anlass und unrecht mit der Konstruktion.** Drei
seiner vier Aussagen tragen, eine ist falsch, und die wichtigste Auswirkung
fehlt ganz.

| Aussage des Entwurfs | Urteil | Beleg |
|---|---|---|
| Der Huber-Schätzer bleibt über einem Niveau-Sprung „in der Mitte hängen“ und liefert „wochenlang falsche Prognosen“ | **Halb richtig, falsch lokalisiert** | Der Punkt heilt in 2–3 Wochen; die **Verteilung** heilt 5+ Wochen nicht, und sie ist es, die die Entscheidung trägt (§2.1) |
| Fix: 17 ct von den September-Trainingsdaten abziehen | **Falscher Mechanismus** | Er vertauscht in der Übergangszeit ein +16-ct- gegen ein −14-ct-Problem und bläht das Intervall dauerhaft, weil der angekündigte Termin nicht der Wirksamkeits-Termin ist (§2.2) |
| Der Deckel braucht ein hartes `min(Preis, DECKEL)` nach Bootstrap und AR(2) | **Richtige Idee, falsche Stelle** | Nach der Projektion erzeugt ein bewegter Deckel einen **illegalen** Preisanstieg; und `LEGAL_CAP` als Konstante ist das belgische/luxemburgische Modell nicht (§2.4) |
| Das Beta-Binomial-Update heilt sich von selbst, nichts zu tun | **Richtig, aber zu billig** | Der Ledger rollt über 30 Tage (`app/feedback.py`), heilt also — und verfüttert in diesen 30 Tagen verzerrte Trefferquoten an den M7-Schwellenregler und das Kalibrierungs-Gate (§3.4) |
| *(fehlt)* Die 12-Uhr-Projektion löscht den Regime-Sprung | — | Am 01.01.2027 wird ein +16,9-ct-Schritt von der bestehenden PAVA-Projektion auf **+0,00 ct** gepoolt, 231 von 288 Punkten des Segments werden verbogen — **auch bei perfekter Regime-Korrektur** (§2.3) |
| *(fehlt)* Der 1. Januar ist die gefährliche Richtung | — | `P_besser` steigt auf **0,92–1,00**, während das wahre Fenster 10 ct *über* dem Anker liegt: Die App empfiehlt „warten“ mit hoher Zuversicht in eine +17-ct-Erhöhung (§3.1) |
| *(fehlt)* Der gepoolte Feiertags-Fit ist **heute** verfälscht | — | `holiday_beta` = +4,48 ct statt +5,96 ct, weil 1. Mai, Himmelfahrt, Pfingstmontag und Fronleichnam 2026 in den Mai-Juni-Rabatt fielen: **−1,5 ct/L an jedem Feiertag**, mehr als die Entscheidungsschwelle θ = 1,0 ct (§3.2) |
| *(fehlt)* Das Qualitäts-Gate wird durch den Bruch leichter grün | — | Der MASE-Nenner wächst um 27–33 % (`mase_scale`), im Ensemble-Validierungsfenster um das 2,4-Fache: `mase_24h_below_0_95` kann **wegen** des Schocks erfüllt sein (§3.3) |

**Strategie in einem Satz.** Nicht das Niveau korrigieren, sondern **die Kante
kennen**: Regime-Termine als Daten, der Schritt als Dummy in der Designmatrix
mit *geschätzter* Kante und *geschätztem* Betrag (die Ankündigung ist der Prior,
nicht die Wahrheit), die Regime-Kante als zusätzlicher erlaubter Sprungzeitpunkt
in der bestehenden 12-Uhr-Projektion, der Deckel als bewegliche Schranke
*vor* der Projektion — und in den ersten Tagen nach einer Kante ehrliche
Degradation statt falscher Zuversicht (§4).

**Reihenfolge in einem Satz.** Der Rabatt ist transient (nach 42 Tagen ist er
aus dem Fenster) und der Deckel ist permanent — der Entwurf investiert die
Architektur in das transiente Problem und erledigt das permanente mit einem
`min()`; es muss umgekehrt sein, und weil am 01.10. in 12 Tagen nichts
Validiertes mehr steht, beginnt Phase 0 mit dem, was schon im Archiv liegt:
dem **Rabatt-Ende am 01.07.2026**, derselbe Schock in derselben Richtung wie
der 01.01.2027 (§5, §7).

---

## 1. Was der Entwurf richtig sieht

Fair zuerst — vier Punkte tragen und werden hier nicht wiederholt diskutiert:

1. **Ein dauerhafter Niveau-Sprung ist für einen M-Schätzer ein anderes Problem
   als ein Ausreißer.** Richtig. Huber-IRLS begrenzt den Einfluss einzelner
   Punkte, nicht den eines Regimes; `engine/models.py::huber_fit` hat keine
   Bruchstelle im Design.
2. **Die Tagesrhythmen bleiben intakt, das Niveau nicht.** Richtig und wichtig:
   Harmonische, Wochentags-Dummies und der Mittags-Schritt müssen nicht neu
   gelernt werden. Der Eingriff gehört an den Level-Term, nicht an die Form.
3. **Die 12-Uhr-Projektion ist der richtige Anbauort für eine weitere
   juristische Regel.** Richtig — nur nicht als `min()` dahinter, sondern als
   zweite erlaubte Sprungkante *davor* (§2.3, §2.4).
4. **Am Beta-Binomial-Update selbst ist algorithmisch nichts zu ändern.**
   Richtig. `(hits+5)/(n+10)` ist der Posterior-Mittelwert eines Beta(5,5), die
   Grundgesamtheit rollt über 30 Tage; der Schätzer heilt. Was nicht heilt, ist
   das, was *aus ihm folgt* (§3.4).

---

## 2. Fünf Korrekturen, gemessen

### 2.1 Der Punkt heilt — die Verteilung heilt nicht

Der Entwurf warnt vor „wochenlang falschen Prognosen“ des Punktwerts. Gemessen
ist es umgekehrt verteilt: **der Punkt ist nach 2–3 Wochen durch, das Intervall
nach 5 Wochen noch nicht** — und das Intervall ist es, aus dem die App ihre
Entscheidung zieht (`app/pside.py` rechnet `P_besser`, `P_lohnt` und die
Fenster-P ausschließlich aus den Draws).

Szenario A, Bruch −17,0 ct/L um 00:00 am 01.10.2026, sofort und vollständig
durchgereicht, Status quo (vollständige Tabelle in Anhang A):

| Cutoff | Bias q50 | Breite q975−q025 | `P_besser` | Wahrheit: Fenstermin. − Anker |
|---|---|---|---|---|
| 30.09. | −2,2 ct | 7,8 ct | 1,000 | −6,3 ct |
| 02.10. | **+17,7 ct** | **23,1 ct** | **0,000** | −3,9 ct |
| 05.10. | **+17,9 ct** | **23,6 ct** | **0,136** | −11,5 ct |
| 12.10. | +13,2 ct | 24,6 ct | **0,448** | −8,8 ct |
| 16.10. | +5,1 ct | **26,4 ct** | 0,570 | −12,4 ct |
| 29.10. | −0,0 ct | **25,9 ct** | 0,682 | −6,6 ct |
| 08.11. | +1,4 ct | 15,7 ct | 0,842 | −6,7 ct |

Drei getrennte Schäden mit drei getrennten Zeitskalen:

- **Punktniveau: ~2–3 Wochen.** Der Huber-Intercept folgt dem neuen Regime,
  sobald es die Mehrheit des 42-Tage-Fensters stellt; ab dem 16.10. liegt der
  Bias unter 5 ct, am 29.10. bei null. Das ist ärgerlich, aber begrenzt und
  selbstheilend.
- **Intervallbreite: 5+ Wochen.** Die Residuen-Tagesblöcke enthalten beide
  Niveaus. Blöcke aus dem Alt-Regime tragen ±17 ct in jede Ziehung, und die
  exponentiellen Ziehgewichte (Halbwertszeit 14 Tage, `exp_block_weights`)
  dämpfen sie nur: 23–26 ct Breite statt 7,8 ct, also das **3-Fache**, noch am
  29.10. Ein zu breites Intervall ist ehrlich, aber nutzlos — und es ist nicht
  neutral, siehe nächster Punkt.
- **`P_besser`: ~2 Wochen entscheidungsfalsch.** `p_better` vergleicht die
  Fenster-Minima der Draws mit dem **live beobachteten** Anker
  (`app/decide.py`: `anchor = chosen_station["price"]`). Nach einem Preissturz
  steht der Anker im neuen (billigen) Regime, die Draws stehen noch im alten
  (teuren) — also ist `Anker − Draw` systematisch negativ und `P_besser`
  kollabiert auf **0,000–0,448**, während die Wahrheit sagt: ja, es gibt ein
  Fenster 4–12 ct unter dem jetzigen Preis. Die App beantwortet die
  Hauptfrage „jetzt oder warten?“ in genau diesen Wochen mit „jetzt“, und zwar
  mit der Zuversicht einer Zahl, die sie für eine Wahrscheinlichkeit hält.

**Konsequenz für den Entwurf.** Sein Kapitel 1 zielt auf den Punktwert
(„Prognosen“), gemessen ist der Punktwert der am schnellsten heilende Teil.
Ziel der Maßnahme muss die **Verteilung** sein, denn sie trägt die
Entscheidungstabelle — und das ist derselbe Befund M1 aus
[BEFUND-UX-MATH-2026-09-19.md](BEFUND-UX-MATH-2026-09-19.md) („die
Wahrscheinlichkeiten sind bauartbedingt unkalibriert, fließen aber ungefiltert
in die €-P-Entscheidungstabelle"), nur mit einem harten Termin daran.

### 2.2 „17 Cent abziehen“ ist der falsche Mechanismus

Der Entwurf beschreibt die richtige Semantik — *„der Vorhersage-Tag liegt im
Rabatt-Regime, die Trainingsdaten aus dem September aber nicht"* — und wählt
dafür den falschen Mechanismus: eine Vorverarbeitung der Trainingsdaten. Vier
Gründe, alle messbar.

**(a) Die Semantik gehört in die Designmatrix, nicht in die Daten.** Was der
Entwurf beschreibt, ist ein Schritt-Dummy `D(t) = 1{t ≥ Kante}` mit Koeffizient
γ. Genau dieses Muster hat die Engine schon einmal gebaut: der Mittags-Schritt
`after_law & (hour ≥ 12)` in `engine/models.py::features` trägt das eigene
Nachmittag-Niveau der 12-Uhr-Regel ab. Ein Regime-Dummy ist dieselbe
Konstruktion, eine Spalte mehr, vom selben Huber-IRLS geschätzt, und er gilt
**automatisch für Training und Prognose** — weil `predict` die Features für das
Prognoseraster neu baut. Ein Datenabzug gilt nur für die Seite, an die man
gedacht hat.

**(b) Der angekündigte Termin ist nicht der Wirksamkeits-Termin.** Szenario B:
Durchgabe 2 Tage verzögert und zu 85 % (also −14,5 ct ab dem 03.10.) — beides
ist das, was man aus 2022 und aus jedem Kartellamtsbericht erwartet, nicht das,
was eine Pressemitteilung sagt. Hartkodiert auf den 01.10.:

| Cutoff | Status quo | hartkodiert −17 ct ab 01.10. | Kante **und** Betrag geschätzt |
|---|---|---|---|
| 01.10. | +4,2 ct / 6,6 / 0,730 | **−12,8 ct** / 6,6 / 1,000 | −12,8 ct / 6,6 / 1,000 |
| 02.10. | +0,9 ct / 7,6 / 1,000 | **−14,5 ct** / 14,9 / 1,000 | −14,5 ct / 14,9 / 1,000 |
| 03.10. | +16,0 ct / 7,8 / 1,000 | +1,3 ct / **18,4** / 0,956 | +1,3 ct / **18,4** / 0,956 |
| 08.10. | +14,3 ct / 19,9 / 0,192 | −0,1 ct / **18,4** / 0,922 | −0,9 ct / **7,6** / 1,000 |
| 16.10. | +6,0 ct / 20,9 / 0,510 | −1,6 ct / **18,0** / 0,940 | −0,9 ct / **8,0** / 1,000 |
| 22.10. | +7,7 ct / 21,0 / 0,660 | +4,4 ct / **16,1** / 0,954 | +3,8 ct / **7,3** / 1,000 |

*(Format: Bias q50 / Breite q975−q025 in ct / `P_besser`.)*

Die hartkodierte Korrektur **tauscht einen +16-ct-Fehler gegen einen
−14,5-ct-Fehler** an den Tagen, an denen die Tankstellen noch nicht gesenkt
haben. Nutzer sähen eine Prognose von 1,58 €/L an einer Tafel mit 1,72 €/L —
der teuerste Vertrauensfehler, den diese App machen kann, und er wäre
hausgemacht. Und die Breite bleibt den ganzen Oktober über bei 15–18 ct statt
7 ct: **eine Korrektur zum falschen Termin injiziert einen künstlichen Bruch in
die Trainingsdaten** und bläht damit genau die Verteilung, die sie retten
sollte. Nur die Variante mit geschätzter Kante bringt die Breite am 08.10. auf
7,6 ct zurück, also auf Vor-Bruch-Niveau.

**(c) Brutto ist nicht netto, und die 17 ct sind nicht die Steuer.** Die
Meldung nennt 14 ct Energiesteuer und 3 ct Mehrwertsteuer-Effekt. Das ist keine
Addition, sondern eine Multiplikation: 14 ct × 1,19 = 16,7 ct ≈ 17 ct. Für die
Engine folgt daraus zweierlei. Erstens ist der Bruttopreis eine **multiplikative**
Funktion des Nettopreises — ein Eingriff, der als additiver ct-Betrag modelliert
wird, ist nur bei vollständiger Durchgabe exakt. Zweitens hängt der Betrag je
Sorte an einem anderen Steuersatz (Energiesteuer Benzin 65,45 ct/L, Diesel
47,04 ct/L); die Engine führt E5/E10/Diesel getrennt (`--fuel`), eine einzige
globale Zahl „17 ct“ ist für mindestens eine Sorte falsch. 2022 waren es
29,55 ct/L für Benzin und 14,04 ct/L für Diesel — die „14 ct“ dieser Meldung
sind auffällig nah am damaligen Diesel-Wert.

**(d) δ̂ aus den Daten ist nicht kostenlos, aber billiger als die Annahme.** Der
slot-gematchte robuste Unterschied (Median je 5-Minuten-Slot nach minus vor,
dann Median über die Slots — entfernt die Tagesform, weil je Slot verglichen
wird) liefert in Szenario A −18,4 bis −20,0 ct statt der wahren −17,0 ct, also
1,4–3,0 ct Überschwinger aus der Niveau-Drift. In Szenario B findet er −14,5
bis −15,5 ct, also fast exakt die wahren −14,5 ct. **Folgerung: nicht
entweder/oder, sondern Shrinkage** — die Ankündigung als Prior-Mittelwert mit
einer Durchgabe-Unsicherheit (±3 ct sind aus 2022 gut begründbar), δ̂ als
Likelihood, präzisionsgewichtet kombiniert. Das ist dasselbe Muster wie die
×0,9-Stabilitätsschrumpfung in `fit_ar2` und das Beta(5,5)-Prior im Ledger:
dieses Repo schrumpft schon überall sonst.

**Drei Betriebsfehler des Schätzers, im Lauf gefunden** (alle drei gehören ins
Konzept, nicht in die Fußnote):

1. **Zu wenig Nach-Daten.** Am 05.10. — zwei Tage nach der Kante — schätzte der
   Lauf die Kante auf den 30.09. und δ̂ auf −4,4 ct; Ergebnis Bias +9,3 ct,
   `P_besser` 0,044. Ab fünf Nach-Tagen trägt die Schätzung.
2. **Kante einen Tag daneben.** Am 04.01.2027 (Szenario C) fand der Lauf
   t̂ = 31.12. statt 01.01. und δ̂ = +14,4 ct statt +17,0: Bias −5,8 ct und
   Breite **20,6 ct statt 8,1**. Dieselbe Wirkung wie ein falscher
   angekündigter Termin (§2.2b) — eine um einen Tag versetzte Kante injiziert
   einen künstlichen Bruch und bläht die Verteilung. Ab dem 06.01. ist t̂ exakt
   und die Breite zurück auf 8,1 ct.
3. **Alternde Kante.** Am 29.10. war der Bruch aus dem 21-Tage-Suchfenster
   herausgerutscht, der Schätzer lieferte nichts und fiel auf die hartkodierte
   Annahme zurück (Breite wieder 15,5 ct).

**Folgerung: Ein erkanntes Regime muss persistiert werden, nicht je Lauf neu
detektiert.** Dazu zwei Schwellen, die beide auf den *verwendeten* Betrag prüfen
müssen, nicht auf die Teststatistik: Im Lauf fiel am 31.12.2026 eine
falsch-positive Kante aus Weihnachts-Rauschen an (Tageskontrast über der
Schwelle, slot-gematchter Betrag nur +1,2 ct), und sie kippte den 02.01. auf
−14,9 ct Bias. Erst die Prüfung „Kontrast **und** |δ̂| ≥ 2 ct“ nimmt sie
zurück — in `analysis/regime_check.py` als `MIN_STEP_CT` an beiden Stellen
umgesetzt und im Lauf nachgewiesen.

### 2.3 Die 12-Uhr-Projektion frisst den Regime-Sprung

Das ist der wichtigste Code-Befund, und er steht in keinem der beiden Papiere.
`noon_law_projection` projektiert jeden Verlauf je Segment [12:00 Uhr, nächste
12:00 Uhr) auf *nicht-steigend* (PAVA, exakte L2-Projektion). Ein
Steuer-Schritt um Mitternacht liegt **mitten in einem solchen Segment**.

Gemessen, 288-Punkte-Segment [31.12. 12:00, 01.01. 12:00), reale Tagesform,
Regime-Dummy +17 ct ab 00:00:

| | Sprung über die Kante | verbogene Punkte | größter Fehler |
|---|---|---|---|
| ohne Projektion (was das Gesetz am 01.01. tut) | +16,89 ct | — | — |
| **mit bestehender Projektion** | **+0,00 ct** | **231 von 288** | **+9,83 ct** zu hoch vor der Kante, **−7,06 ct** zu niedrig danach, \|Fehler\|-Mittel 3,03 ct |
| mit Regime-Kante als zusätzlicher Segmentgrenze | +16,89 ct | 0 von 288 | 0,00 ct |

Die Projektion **löscht den Schritt vollständig** und verteilt ihn über fast das
ganze Segment: Der Silvesterabend wird bis zu 10 ct zu teuer prognostiziert, der
Neujahrsmorgen bis zu 7 ct zu billig. Das passiert **auch dann, wenn die
Regime-Korrektur perfekt ist** — sie passiert *wegen* ihr, weil der Dummy den
Sprung in die Struktur legt und die Projektion ihn dort wieder herausnimmt.

Die Asymmetrie ist juristisch begründet und deshalb nicht wegkonfigurierbar:
Senkungen sind jederzeit erlaubt, also geht der −17-ct-Schritt am 01.10.
unbeschadet durch (gemessen: 0 von 288 Punkten betroffen, −17,11 ct bleiben
−17,11 ct). **Nur der Anstieg am 01.01.2027 wird zerstört** — der Termin, an dem
die Richtung ohnehin die gefährliche ist (§3.1).

Der Fix ist klein und liegt in gut getestetem Code: `_segment_bounds` bekommt
zusätzliche erlaubte Sprungzeitpunkte aus dem Regime-Kalender (R1/R3). Die
Segment-Logik ist seit B15 vektorisiert und wird je Lauf einmal für alle
Bootstrap-Pfade berechnet; ein oder zwei zusätzliche Kanten pro Prognose kosten
nichts Messbares.

**Offene Rechtsfrage, die vorher geklärt sein muss** (§8): Darf eine
Tankstellenpreis-Erhöhung, die ausschließlich eine gesetzlich wirksame
Steueränderung durchreicht, um 00:00 Uhr erfolgen — oder gilt die 12-Uhr-Regel
auch dann? Die Antwort entscheidet, ob die Regime-Kante eine *erlaubte*
Sprungkante ist (dann R3 wie oben) oder ob die Projektion recht hat und die
Stationen die Erhöhung tatsächlich erst um 12:00 Uhr zeigen dürfen. Beides ist
modellierbar; raten darf die Engine es nicht. Solange die Antwort fehlt, ist der
ehrliche Zustand: Kante als **zulässige** Sprungkante führen und im Artefakt
ausweisen, dass sie aus einer Steuermaßnahme und nicht aus einer Beobachtung
stammt.

### 2.4 Der Deckel ist keine Konstante, und das Clipping sitzt an der falschen Stelle

Der Entwurf nennt `predicted_price = min(model_price, LEGAL_CAP)` mit
„z. B. 1,80 €“ und setzt es „nach dem Bootstrap und nach dem AR(2)-Nachlauf“,
also ans Ende der Kette. Beides hält nicht.

**(a) Die genannten Vorbilder haben keinen festen Deckel.** Belgien setzt
Höchstpreise aus einem Referenzproduktkurs (ARA-Notierungen über ein
rollierendes Fenster) plus gesetzlich fixierten Kosten- und Margenkomponenten
zusammen; Luxemburg arbeitet mit staatlich festgesetzten Höchstpreisen über
Verordnungen. In beiden Fällen **bewegt sich der Deckel**, teils täglich, und er
bewegt sich mit dem Rohöl- und Produktmarkt — nicht mit der Politik. Für die
Engine heißt das: `cap(t)` ist eine **Zeitreihe**, keine Konstante, und sie
braucht eine Quelle. Ein `min()` gegen eine Zahl, die vor drei Wochen stimmt
war, ist eine stille Lüge — genau das, was dieses Repo mit
„Datenqualität statt stiller Korrektur“ ausschließt.

**(b) Die Reihenfolge ist falsch, und zwar nachweisbar.** Ein bewegter Deckel,
der um 00:00 Uhr steigt (Referenzkurs hoch), zusammen mit `min()` **nach** der
12-Uhr-Projektion:

| Reihenfolge | Ergebnis |
|---|---|
| Projektion → `min(·, cap(t))` | **illegaler Anstieg von +5,0 ct um Mitternacht** — die 12-Uhr-Regel ist verletzt, und zwar in der veröffentlichten Kurve |
| `min(·, cap(t))` → Projektion | legal (max. Anstieg 0,00 ct), aber der Deckelsprung wird um −2,5 ct verflacht |
| Deckel-Wechsel als erlaubte Sprungkante → `min` → Projektion | legal **und** exakt |

`min(x, c)` ist monoton, deshalb bleibt eine *konstante* Schranke harmlos — der
Entwurf hat mit dem statischen Beispiel recht. Sobald `cap(t)` selbst steigt,
erzeugt punktweises Abschneiden einen Anstieg an der Deckel-Kante. Also gehört
der Deckel-Wechsel in dieselbe Liste erlaubter Sprungzeitpunkte wie die
Regime-Kante (R3), und das Clipping gehört **vor** die Projektion.

**(c) Ein bindender Deckel zensiert die Trainingsdaten — das ist mehr als
Abschneiden.** Liegt der Marktpreis am Deckel, sind die Beobachtungen
top-censored. Drei Folgen, die der Entwurf nicht behandelt:

1. Die Residuen am Deckel sind künstlich klein. Der Tagesblock-Bootstrap zieht
   sie und **unterschätzt die Unsicherheit des unzensierten Preises** — das
   Modell wird ausgerechnet dann zu selbstsicher, wenn der Markt unter Spannung
   steht. Beim Wegfall oder Anheben des Deckels ist die Prognose systematisch
   zu niedrig.
2. Die Streuung *zwischen* Stationen kollabiert: Wenn alle am Deckel stehen,
   gibt es kein „wo ist es billiger“ mehr. Damit fällt der Kern der
   Umweg-Ökonomie (`app/route.py`, `elsewhere_net_eur`) auf null, und
   `P_lohnt` wird zur Scheingenauigkeit über zwei identische Preise. Das ist
   eine **Produktaussage**, keine Randnotiz: Die App muss dann sagen „Der Deckel
   bindet: Timing und Ort bringen nichts", statt weiterhin Sterne und
   Wahrscheinlichkeiten zu zeigen.
3. Umgekehrt wird die Prognose *besser*, nicht schlechter: Ein Formeldeckel ist
   eine deterministische Funktion veröffentlichter Referenzkurse. Wer die Formel
   und die Kurse hat, kann den Deckel genauer vorhersagen als jeden
   Wettbewerbspreis. **Das ist eine Chance**: „Der Deckel morgen: 1,78 €/L
   (Referenzkurs gefallen)" ist eine ehrlichere und nützlichere Auskunft als
   jede Bootstrap-Wolke. Voraussetzung ist R4 mit Quelle, nicht `LEGAL_CAP`.

Richtig am Entwurf ist die Verteilungs-Aussage: Pfade über der Schranke gehören
auf die Schranke, und die Masse am Limit ist die korrekte Abbildung. Sie muss
nur **ausgewiesen** werden (`p_at_cap` je Fenster), sonst liest niemand, dass
das 90-%-Quantil eine Kante und keine Schätzung ist.

### 2.5 Der 42-Tage-Bezug ist nicht das eigentliche Problem

Der Entwurf macht das Fenster zum Tatort („wieder zerreißt es dein
42-Tage-Trainingsfenster"). Gemessen ist das Fenster nicht der Hebel:
`train_days = 14` heilt den Punkt schneller (ab dem 08.10. statt ab dem 16.10.),
löst aber weder die erste Woche noch die Verteilung —

| Cutoff | Bias | Breite | `P_besser` |
|---|---|---|---|
| 02.10. | +18,4 ct | 18,4 ct | **0,000** |
| 05.10. | +20,3 ct | 20,8 ct | **0,000** |
| 08.11. | +6,4 ct | 10,7 ct | **0,044** |

— und destabilisiert den Fit danach (08.11.: `P_besser` 0,044 bei einer
Wahrheit von −6,7 ct; bei 14 Tagen liegt der Fit nahe an `min_train_days = 28`
bzw. unter ihr, ein einziger Collector-Ausfalltag lässt ihn mit `ValueError`
scheitern). Die in [ENGINE.md](ENGINE.md) offen gehaltene 90-vs-42-Entscheidung
darf deshalb **nicht** im Oktober getroffen werden: Jede Messung in diesem
Monat misst den Bruch, nicht das Fenster (§3.3, §7).

---

## 3. Was der Entwurf nicht sieht

### 3.1 Der 1. Januar ist die gefährliche Richtung

Beide Brüche sind gleich groß und **ungleich gefährlich**. Am 01.10. fällt der
Preis: Ein zu hoch liegendes Modell sagt „jetzt tanken“, der Nutzer tankt zu
früh und ärgert sich über verpasste 10 ct. Am 01.01. steigt der Preis: Ein zu
niedrig liegendes Modell sagt „warten“ — und der Nutzer läuft in die Erhöhung
hinein. Genau das benennt `app/thresholds.py` als den teuren Fehler
(„Falsches WARTEN ist der teure Fehler“), und
[archiv/GUTACHTEN-2026-09-10.md](archiv/GUTACHTEN-2026-09-10.md) nennt es
asymmetrisch („Warten und in eine 10-Cent-Erhöhung laufen, kostet massiv
Vertrauen").

Gemessen, +17,0 ct am 01.01.2027 um 00:00, Status quo:

| Cutoff | Bias q50 | Breite | `P_besser` | Wahrheit: Fenstermin. − Anker |
|---|---|---|---|---|
| 31.12. | +1,3 ct | 7,6 ct | 1,000 | −7,7 ct |
| **01.01.** | **−15,4 ct** | 7,7 ct | **0,920** | **+10,0 ct** |
| 04.01. | −19,2 ct | 19,1 ct | 1,000 | −6,9 ct |
| 06.01. | −17,8 ct | 22,4 ct | 1,000 | −14,3 ct |
| 10.01. | −16,0 ct | 24,1 ct | 1,000 | −9,9 ct |

Am 01.01. liegt das billigste Fenster der nächsten 24 Stunden **10 ct über** dem
jetzigen Preis — es gibt kein günstigeres Fenster, die richtige Antwort ist
`P_besser = 0`. Die Engine liefert **0,920**. Mit Schritt-Dummy: Bias +1,6 ct,
Breite 7,7 ct, `P_besser` **0,000** — korrekt.

Das ist kein Restrisiko, sondern ein **datierter, richtungssicherer, hoher
Fehler** am ersten Tag eines Jahres, an dem die App ohnehin im Fokus steht.
Dazu kommt §2.3: Selbst ein perfekter Dummy würde am 01.01. von der
PAVA-Projektion auf null gepoolt. **Der 01.01.2027 braucht R2 und R3 zusammen,
oder er wird der schlechteste Tag dieser App.**

### 3.2 Der gepoolte Feiertags-Fit ist heute schon verfälscht

Der Feiertags-Koeffizient γ wird bewusst **nicht** im 42-Tage-Fenster geschätzt,
sondern gepoolt über bis zu `holiday_pool_days = 365` — korrekt begründet
(„0–1 Feiertage je 6-Wochen-Fenster wären unidentifizierbar“). Das Pool-Fenster
reicht damit bis September 2025 zurück (`docs/API.md`: `archive_since
2025-09-09`) und **enthält den Mai-Juni-Tankrabatt 2026 vollständig**. Von den
11 Feiertagen im Pool (NW) fallen vier in das Rabatt-Fenster: 01.05., 14.05.
(Himmelfahrt), 25.05. (Pfingstmontag), 04.06. (Fronleichnam). Der
Rabatt-Anteil an allen Pool-Tagen beträgt 16,8 %.

Gemessen mit `huber_fit` auf den echten `features()`-Spalten, kontrollierter
Vergleich mit und ohne Rabatt im Pool:

| | `holiday_beta` | Verfehlung |
|---|---|---|
| Referenz (Pool ohne Rabatt) | **+5,96 ct/L** | — |
| Pool mit Mai-Juni-Rabatt (NW) | +4,48 ct/L | **−1,47 ct/L** |
| Pool mit Mai-Juni-Rabatt (BY) | +4,64 ct/L | −1,24 ct/L |

Der Feiertagszuschlag ist um rund ein Viertel zu klein, weil Pfingsten und
Himmelfahrt zufällig in eine Steuererleichterung fielen. **Einordnung: θ = 1,0
ct/L ist die Signifikanzschwelle der Entscheidung** (`app/pside.py::THETA_CT`),
und `wait_eur_high = 2,00 €` sind bei 50 L rund 4 ct/L. Eine Feiertags-
Verfehlung von 1,5 ct/L ist also größer als die Schwelle, ab der die App
überhaupt einen Unterschied zählt, und knapp 40 % der Warten-Schwelle.

Das ist **kein Oktober-Problem, sondern ein Zustand der heute veröffentlichten
Artefakte.** Und es wiederholt sich: Im neuen Rabatt-Fenster liegen der
03.10. (Tag der Deutschen Einheit), der 01.11. (Allerheiligen, u. a. NW) und
der 25./26.12. — erneut vier von elf Feiertagen im Pooljahr, erneut in einem
fremden Regime.

**Folgerung:** Die Regime-Normalisierung muss **beide** Fits bedienen, den
42-Tage-Fit *und* den Pool-Fit. Der Entwurf spricht nur vom 42-Tage-Fenster.
Kurzfristig und ohne Regime-Schicht hilft schon die billigste Maßnahme: den
Pool um deklarierte Regime-Fenster kürzen (`holiday_pool_days` bleibt, aber die
Pool-Stützstellen aus Regime-Zeiten fallen aus) — ehrlich ausgewiesen über
`holiday_pool_days` und `holiday_source`, die das Artefakt schon trägt.

### 3.3 Das Qualitäts-Gate wird durch den Bruch grüner, nicht roter

MASE teilt den Modellfehler durch die saisonale Naive
(`seasonal_scale`: mittlerer |p(t) − p(t−288)|). Ein 17-ct-Schritt liegt in
genau einem Tagespaar und **bläht den Nenner**:

| Cutoff | `mase_scale` | Naive-MAE im 14-Tage-Validierungsfenster | MASE harmonisch | MASE Profil |
|---|---|---|---|---|
| 20.09. | 1,98 ct | 2,42 ct | 0,146 | 0,158 |
| 30.09. | 2,21 ct | 2,47 ct | 0,144 | 0,166 |
| 05.10. | 2,78 ct | **6,30 ct** | **0,125** | **0,115** |
| 12.10. | 2,80 ct | 5,88 ct | 0,226 | 0,225 |
| 16.10. | 2,92 ct | 4,50 ct | 0,287 | 0,331 |
| 22.10. | 2,94 ct | 2,55 ct | **0,375** | **0,515** |

Zwei getrennte Schäden. Erstens: Der Nenner des Backtest-Gates wächst um
**27–33 %**, im Ensemble-Validierungsfenster (`ensemble_detail`, 14 Tage) um
das **2,4-Fache** — jede MASE wird um denselben Faktor besser, `mase_24h_below_0_95`
ist also **leichter zu erfüllen, während das Modell 17 ct daneben liegt**. Ein
Schock kann ein Gate grün schalten. Zweitens: Die Kennzahl ist um den Bruch
herum **nicht monoton in der echten Güte** — am 05.10. meldet sie 0,115
(blendend), am 22.10. meldet sie 0,375/0,515 (schlecht), obwohl das Niveau am
22.10. schon fast geheilt ist und am 05.10. noch voll daneben lag.

**Folgerung für die Governance, nicht für die Mathematik:** Jede
Parameter-Entscheidung, jede A/B-Messung und jede Gate-Freigabe im Zeitraum
01.10.2026–15.11.2026 ist uninterpretierbar, solange Brüche im Fenster nicht
ausgewiesen sind. Der Backtest-Report braucht ein Feld
`regime_breaks_in_window` (Anzahl, Termin, Betrag, Quelle), und die
Ensemble-Gewichte brauchen dieselbe Kennzeichnung — sonst wird im Oktober jemand
`train_days` senken, weil die Messung es nahelegt, und overfittet den Bruch.
Das ist exakt die M7-Prozessregel aus
[BEFUND-UX-MATH-2026-09-19.md](BEFUND-UX-MATH-2026-09-19.md) („jede
Parameteränderung nur mit dokumentiertem Ablations-Backtest") — sie braucht
jetzt eine Ausnahme-Klausel: **kein Ablations-Backtest über eine Regime-Kante.**

### 3.4 Der Schwellenregler lernt aus einem Steuergeschenk

`app/thresholds.py` zieht die Entscheidungsschwellen **deterministisch aus dem
Ledger** nach: `hit_wait` über Ziel + 10 pp → „WARTEN erleichtern“. Im Oktober
werden Warten-Empfehlungen aus dem September durch den Preissturz massenhaft zu
Treffern — nicht weil Warten klug war, sondern weil der Staat gesenkt hat. Der
Regler kann einen Steuereffekt nicht von einer Modellgüte unterscheiden und
würde die Warten-Gates lockern, genau wenn das Warten (Richtung Januar)
gefährlich wird. Der H3-Oszillationsschutz (MIN_N = 25, Rauschband ±2 SE,
Totband) dämpft das, verhindert es aber nicht: 30 Tage × mehrere Empfehlungen
pro Tag sind weit über MIN_N, und der Effekt ist kein Rauschen, sondern ein
Bias.

**Folgerung:** Settlements, deren Bewertungsintervall eine deklarierte
Regime-Kante schneidet, müssen im Ledger **gekennzeichnet und aus der
Regler-Grundgesamtheit ausgeschlossen** werden — nicht gelöscht (Ehrlichkeit:
der Nutzer hat die Empfehlung gesehen und das Geld wirklich ausgegeben), aber
nicht als Evidenz für die Schwellen gezählt. Dasselbe gilt für das
M7-Kalibrierungs-Gate (`n ≥ 100`, `brier < 0.25`, ausschließlich über
P aus der Verteilung): Eine Übergangswoche mit `P_besser = 0,000` bei
eingetretenem Ereignis treibt den Brier-Anteil dieser Tage gegen 1,0 und kann
**das Gate auf Monate schließen**. Der Schaden des Bruchs ist dann nicht eine
schlechte Prognose, sondern eine App, die weiterhin `no_advice` sagt — der
Bruch kostet den Produktstart, nicht die Genauigkeit.

### 3.5 Der Verstößezähler meldet am 1. Januar Verstöße, die keine sind

`law_rise_outside_noon` zählt Erhöhungen ≥ 1 ct, deren 5-Minuten-Intervall
keinen erlaubten 12:00-Uhr-Punkt enthält — als Datenqualitätssignal, ausdrücklich
nicht als stille Korrektur. Eine Steuer-Erhöhung, die um 00:00 Uhr durchgereicht
wird, erfüllt genau dieses Muster. Gemessen: **1 gezähltes Intervall je Station
und Sorte** am Sprungtag; im Live-Bestand mit ~20 Stationen also ~40
„Regelverstöße“ in einem einzigen Bericht, im Archivbestand (282 Stationen)
dreistellig. Der Report würde am 01.01.2027 aussehen wie ein flächendeckender
Rechtsbruch der Tankstellen.

**Folgerung:** Der Zähler braucht eine zweite Kategorie
`rise_at_regime_boundary` (gleiches Muster, aber das Intervall enthält eine
deklarierte Regime-Kante). Dieselbe Trennung, dieselbe Ehrlichkeit, keine
gelöschten Punkte — nur kein Fehlalarm. `analysis/noon_rule_check.py` zählt
analog und braucht denselben Ausschluss, sonst „beweist“ der Check am 02.01.
einen Regelverstoß.

### 3.6 Die WO-Seite ist immun, die WANN-Seite nicht

Die App hat zwei Hälften, und der Bruch trifft nur eine:

- **Selektion/WO** (`engine/selection.py`) arbeitet auf δ̂, dem Abstand einer
  Station zum Stadt-Median — einer **Differenz**. Eine einheitliche Steuersenkung
  kürzt sich heraus. Dazu hat diese Hälfte den Strukturbruch-Schutz schon:
  EW-Median mit 7 Tagen Halbwertszeit und `cusum_break`/`break_flag`
  (Issue 48 / Befund F5). Getroffen wird sie nur von **ungleichmäßiger**
  Durchgabe — und genau dafür ist der CUSUM-Flag da.
- **Prognose/WANN** (`engine/models.py`) arbeitet auf **absoluten Niveaus** und
  ist voll exponiert.

Das ist die eigentliche Architektur-Aussage, und sie ist billiger als eine neue
Schicht: **Die Engine hat schon einen Regime-Detektor — nur in der falschen
Hälfte.** R2 sollte denselben Mechanismus nutzen (Tages-Mediane + CUSUM/
Zweiteilung), statt einen zweiten zu erfinden, und die WANN-Seite sollte wo
immer möglich auf **Differenzen gegen den live beobachteten Anker** rechnen
statt auf modellierten Niveaus. Das ist nicht neu, sondern Empfehlung B1 /
Befund M5 aus
[BEFUND-UX-MATH-2026-09-19.md](BEFUND-UX-MATH-2026-09-19.md): den Nowcast am
Live-Preis konditionieren. `P_besser` tut das schon (Anker = Live-Preis),
`P_lohnt` nicht (beide Seiten kommen aus Modell-Draws:
`app/model_jobs.py::_draws` veröffentlicht `nowcast = paths[:, 0]`). **B1 ist
damit keine UX-Feinheit, sondern die billigste verfügbare Regime-Maßnahme für
F2** — und sie war ohnehin geplant.

---

## 4. Konzept: Regime-Kante statt Regime-Korrektur

Keine neue Schicht *neben* der Pipeline, sondern vier Anbauten an bestehende,
getestete Funktionen. Leitbild: **Der Rohbestand bleibt unverändert** (wie bei
der 12-Uhr-Bodenkante B30 wird nichts umgeschrieben), die Regime-Information
liegt als Daten vor, wird im Modell als Dummy getragen, in der Projektion als
erlaubte Kante respektiert und im Artefakt ausgewiesen.

### R1 Regime-Kalender als Daten

`engine/regimes.py` (Standardbibliothek + pandas, wie `app/law.py`): eine Liste
von Interventionen, je Eintrag

```text
kind            tax_step | price_cap
fuel            E5 | E10 | DIESEL            (je Sorte, nie global — §2.2c)
announced_local ISO-Zeitpunkt (Europa/Berlin), darf fehlen
announced_value ct/L brutto, darf fehlen     (Prior, nicht Wahrheit)
effective_local nachgewiesener Zeitpunkt     (aus den Daten, §R2)
effective_value nachgewiesener Betrag ct/L
status          announced | detected | in_force | unknown
source          Deklaration (Gesetz/Presse) oder Schätzung mit Beleg
```

Durchgereicht wie `price_law_local`: `Settings` → `app/config.py::engine_config`
→ `Config` (neues Feld `regimes`, `to_dict`/`__hash__` mitziehen, damit
`Config` hashbar bleibt und Artefakte reproduzierbar sind). Ein eigener
Umschalter `TANKAPP_REGIME=0` schaltet die Schicht für Gegenmessungen ab —
dasselbe Muster wie `TANKAPP_LAW_FLOOR`, `TANKAPP_SHARED_DRAWS`,
`TANKAPP_DAYPAIR`. Mehrdeutige/nicht existente Wanduhrzeiten werden abgelehnt,
nicht verschoben (`parse_price_law` ist die Vorlage).

**Warum als Daten und nicht als Code:** Der Deckel kommt spätestens 2027, seine
Ausgestaltung ist offen, und die Übergewinnsteuer-Prüfung kann weitere
Maßnahmen bringen. Ein Kalender, den der Betrieb pflegt, schlägt jede
Hardcodierung in `features()`.

### R2 Schritt als Dummy mit geschätzter Kante und geschätztem Betrag

1. `features()` bekommt je aktiver `tax_step`-Intervention eine Spalte
   `1{t ≥ effective_local}` (vor der Detektion: `announced_local`, mit
   `status`-Kennung im Artefakt). Der Koeffizient wird vom bestehenden
   Huber-IRLS mitgeschätzt — 14 statt 13 Spalten, `SCHEMA_VERSION = 3`.
2. **Kante und Betrag werden geschätzt, nicht geglaubt.** Tages-Mediane über ein
   Suchfenster (21 Tage), Zweiteilungs-Argument (kleinste absolute
   Binnen-Streuung) für t̂, slot-gematchte robuste Differenz für δ̂
   (Median je 5-Minuten-Slot, dann Median über Slots — entfernt die
   Tagesform). Beides nur aus Daten **strikt vor dem Cutoff**.
3. **Shrinkage gegen die Ankündigung:** δ = w·δ̂ + (1−w)·δ_announced mit
   w aus den Präzisionen (Ankündigung als Prior mit ±3 ct Durchgabe-Streuung,
   δ̂ mit seinem Bootstrap-Standardfehler). Bei `n_post < 5 Tagen` ist w = 0
   (Vorbehalt gilt, ausgewiesen), danach wächst w.
   **Der Standardfehler gehört zum Schätzer, nicht zur Differenz der Niveaus.**
   Gezogen werden muss innerhalb jeder Seite getrennt (Vor-Tage unter sich,
   Nach-Tage unter sich), sonst mischt der Bootstrap beide Regimes in eine
   Median-Statistik und meldet die Regime-Differenz als Unsicherheit. Im Lauf
   auf dem Juli-Testbestand gemessen: ein Topf für beide Seiten gibt
   `se = 6,6 ct` bei δ̂ = 17,45 ct — Durchgabe „102,6 % ± 39 %", also unlesbar;
   je Seite gezogen sind es `se = 0,62 ct`, Durchgabe 102,6 % ± 3,6 %. Genau
   diese Zahl trägt das Gewicht w, ein falscher SE macht die Shrinkage
   wirkungslos (w ≈ 0 für immer) oder leichtsinnig (w ≈ 1 trotz Rauschen).
   Umsetzung und Regressionstest: `analysis/regime_check.py::day_block_se`,
   `tests/test_regime_check.py::test_standard_error_bootstraps_day_blocks_per_side`.
4. **Ein detektiertes Regime wird persistiert**, nicht je Lauf neu gesucht
   (§2.2, alle drei gefundenen Betriebsfehler). Speicherort: das Modell-Artefakt
   (`regimes_detected`) plus der Kalender als Quelle.
5. **Der Pool-Fit wird mit normalisiert** (§3.2): `holiday_beta` wird auf
   regime-bereinigten Preisen geschätzt; `holiday_pool_days`,
   `holiday_source` und neu `holiday_regime_points_excluded` weisen aus, was
   passiert ist.

*Äquivalenz-Hinweis für die Umsetzung:* δ auf die Nach-Kante-Preise anzuwenden
und die Prognose für Zeiten im neuen Regime um δ zu verschieben, ist exakt ein
Schritt-Dummy. Der Dummy in der Designmatrix ist die saubere Form — aber **er
muss vor der Projektion liegen**, siehe R3.

### R3 Erlaubte Sprungzeitpunkte in der bestehenden Projektion

`_segment_bounds` bekommt eine optionale Liste zusätzlicher Kanten (Regime-Termine,
Deckel-Wechsel). Damit wird

- der +17-ct-Schritt am 01.01. **nicht mehr gepoolt** (gemessen: +16,89 ct
  bleiben, 0 von 288 Punkten verbogen — §2.3),
- der Deckel-Wechsel legal abgebildet (§2.4b),
- die Deduplizierung von `project_paths` (B15) unverändert nutzbar: sie arbeitet
  je Segment, und mehr Segmente bedeuten nur kürzere.

Die Projektion bleibt eine **Garantie, keine Reparatur**: Wo die Rechtslage
unklar ist (§8, Frage 1), wird die Kante geführt und im Artefakt als
`regime_jump_assumed: true` ausgewiesen, damit niemand sie für eine Beobachtung
hält.

### R4 Deckel als bewegliche Schranke vor der Projektion

1. `cap(t)` als Zeitreihe aus R1 (`kind = price_cap`), je Sorte. Quelle offen
   (§8, Frage 2); ohne Quelle **kein** Clipping und ein ehrliches
   `cap_status: unknown` — nie ein `min()` gegen eine veraltete Zahl.
2. Reihenfolge in `predict`: **Clip auf `cap(t)` → Projektion (mit R3-Kanten) →
   Quantile → Ordnungsnetz → Clip der Quantile.** Monotonie-Beweis: `min(·, c)`
   ist monoton, erhält also „nicht-steigend“ und die Quantilsordnung
   q025 ≤ … ≤ q975 (beides numerisch bestätigt, §2.4).
3. **Zensierungs-Kennzeichnung:** Beobachtungen am Deckel (|p − cap| ≤ 1 ct)
   werden im Fit als `at_cap_points` gezählt und im Backtest ausgewiesen — wie
   `law_rise_outside_noon`. Sie bleiben im Modell (keine stille Löschung), aber
   die Residuen-Blöcke dieser Tage bekommen ein Flag, damit die
   Intervallbreite am Deckel nicht als echte Marktstreuung gelesen wird.
4. **Ausweis der Masse am Limit:** `p_at_cap` je Fenster in der
   Draw-Veröffentlichung, damit die P-Seite sagen kann „Unsicherheit nach oben
   ist gesetzlich begrenzt" statt eine Wolke zu zeigen, die es nicht geben darf.
   Der Entwurf hat diesen Punkt richtig gesehen; er gehört nur in die
   Veröffentlichung, nicht nur in die Rechnung.
5. **Produktfolge bei bindendem Deckel:** Kollabiert die Stationsstreuung
   (alle am Deckel), muss die Umweg-Empfehlung denselben Weg gehen wie heute bei
   fehlender Evidenz: `no_advice` mit Grund „Der Deckel bindet: Ort und
   Zeitpunkt bringen messbar nichts" — nicht `refuel_elsewhere` mit
   `P_lohnt = 0,50` über zwei identischen Preisen.

### R5 Ehrliche Degradation statt falscher Zuversicht

Die ersten Tage nach einer Kante sind ex-ante unsicherbar — kein Schätzer der
Welt weiß am 01.10. um 00:05, ob und wie stark die Station vor der Tür gesenkt
hat. Drei Bausteine:

1. **Szenario-Mischung in den Draws statt Punkt-Korrektur.** Je Draw ein
   Szenario-Bit: Durchgabe erfolgt (δ angewendet) / nicht erfolgt (δ = 0), mit
   einem Gewicht aus der gemessenen Durchgabe-Verzögerung (§7). Die
   Wahrscheinlichkeit wird dann breit und mittig — also ehrlich — statt
   falsch und schmal. Anschlussfähig an `shared_day_uniforms`: die Szenario-Bits
   müssen stationsübergreifend gemeinsam gezogen werden (A11), sonst fällt der
   Marktgleichlauf heraus und `P_lohnt` wird wieder zu selbstsicher.
2. **`no_advice` mit eigenem Grund** für das Übergangsfenster (`regime_transition`
   als `reason_code` neben `no_anchor`, `no_forecast`, `no_window`,
   `gray_zone`). Die Infrastruktur dafür steht (`app/decide.py`,
   `_gate_safe_reason`, MICROCOPY-Regelwerk) — es fehlt nur der Code und ein
   Text nach Tonfall „ehrlich, knapp, handlungsleitend“.
3. **Kennzeichnung statt Löschung** überall, wo der Bruch in eine Messung
   hineinreicht: Backtest-Report (`regime_breaks_in_window`), Ledger
   (Settlements über einer Kante zählen, aber nicht in den Regler), Heatmap und
   Tagesstreifen (Regime-Kante als sichtbare Marke), Labor (Karte im
   Parameterschrank, wie B5 sie für die Kalibrierung vorsieht).

### Schema, Umschalter, Tests

- `SCHEMA_VERSION = 3`; `validate_model` prüft `beta.shape == (14,)` und die
  neuen Felder, bleibt aber **zu Schema-2-Artefakten kompatibel** (Fallback:
  keine Regime-Spalte, `regimes_active: false`, ausgewiesen) — dasselbe Muster,
  das B2 für `calibrated` vorsieht. `decision_ready` bleibt `False`.
- Umschalter `TANKAPP_REGIME=0` für die Gegenmessung; `TANKAPP_REGIME_CAP=0`
  trennt Deckel- von Steuer-Schicht, weil beide unterschiedliche Termine haben.
- Tests (Vorbild `tests/test_b30_law_floor.py` und
  `tests/test_noon_rule_check.py`): (i) Dummy-Spalte trägt den Schritt, Prognose
  bitgleich bei `regimes = []`; (ii) PAVA-Projektion erhält einen Regime-Sprung,
  wenn die Kante als Segmentgrenze deklariert ist, und poolt ihn, wenn nicht;
  (iii) Clip-vor-Projektion ist legal, Clip-nach-Projektion fällt als
  Gegenprobe auf; (iv) δ̂-Schätzer findet einen bekannten Schritt auf ±1 ct und
  nutzt nur Daten vor dem Cutoff (Zukunftsleck-Test wie
  `test_no_future_leakage_in_fit`); (v) `law_rise_outside_noon` zählt eine
  deklarierte Regime-Kante nicht als Verstoß; (vi) `holiday_beta` auf
  regime-bereinigtem Pool gleich Referenz-Pool ohne Rabatt.
- Leistung: R2 läuft einmal je Fit und Station (21 Tages-Mediane + 288
  Slot-Mediane), R3 kostet je Lauf ein bis zwei Segmente mehr. Gegen die
  B11-Kaltlauf-Messung (2,6 min für 19 Stationen) ist das vernachlässigbar;
  gemessen wird es trotzdem, weil das NAS das Limit ist.

---

## 5. Strategie: drei Phasen gegen drei Termine

Heute ist der 19.09.2026. Bis zum 01.10. sind es **12 Tage**, bis zum 31.12.
**15 Wochen**, bis zum Deckel **≤ 15 Wochen bei unbekannter Ausgestaltung**.
Daraus folgt die Reihenfolge — nicht aus der Architektur.

### Phase 0 — bis 30.09.2026 (11 Tage)

Ziel: **Nichts Falsches sagen und nichts kaputtmessen.** Kein Modell-Umbau, der
nicht mehr validiert werden kann.

| # | Maßnahme | Deckt | Größe |
|---|---|---|---|
| 0.1 | `analysis/regime_check.py`: Durchgabe-Messung auf dem eigenen Archiv für das **Rabatt-Ende 01.07.2026** und den **Rabatt-Start 01.05.2026** — je Station und Sorte: Betrag, Verzögerung, Vollständigkeit, Streuung | §7, Grundlage für alles Weitere | 1 Tag |
| 0.2 | R3 allein: Regime-Kante als erlaubter Sprungzeitpunkt in `_segment_bounds`, Kanten aus einem minimalen Kalender (Config-Feld, zwei Termine) | §2.3 | 1 Tag |
| 0.3 | Gate- und Regler-Schutz: `regime_breaks_in_window` im Backtest-Report, Settlement-Kennzeichnung über einer Kante, Regler-Grundgesamtheit ohne diese Zeilen, M7-Gate ebenso | §3.3, §3.4 | 1–2 Tage |
| 0.4 | Pool-Fit-Schutz: Feiertags-Pool-Stützstellen aus deklarierten Regime-Fenster fallen aus, ausgewiesen über `holiday_regime_points_excluded` | §3.2 | 0,5 Tage |
| 0.5 | `rise_at_regime_boundary` als zweite Zählerkategorie (Engine + `analysis/noon_rule_check.py`) | §3.5 | 0,5 Tage |
| 0.6 | R5.2: `reason_code = regime_transition` + MICROCOPY für das Übergangsfenster | §2.1, §3.1 | 1 Tag |
| 0.7 | B1/M5 vorziehen: `P_lohnt` konditioniert den Referenzpreis am Live-Preis | §3.6 | 1–2 Tage (war ohnehin geplant) |

Summe ≈ 6–8 Entwicklungstage. Das ist in 11 Tagen machbar **und** jeder Punkt ist
für sich abnehmbar, ohne die anderen. 0.2 und 0.3 sind die beiden, die
wirklich vor dem 01.10. stehen müssen: 0.2 weil der Sprung sonst von der
eigenen Projektion gelöscht wird, 0.3 weil sonst der Oktober jede Messung
vergiftet.

### Phase 1 — Oktober bis Dezember 2026

Ziel: **Den echten Bruch als Trainingsmaterial benutzen.** Der Oktober ist kein
Betriebsunfall, sondern die einzige Gelegenheit, R2 an einem realen
Steuer-Schock zu messen, bevor der Deckel kommt.

- R1 vollständig (Kalender, Config-Plumbing, Umschalter, Artefakt-Felder).
- R2 mit Shrinkage; Validierung **am 01.07.2026 im Archiv** (Rolling-Origin
  über die Kante, Status quo vs. Dummy), Nachmessung am echten 01.10.
- R5.1 Szenario-Mischung, sobald 0.1 eine gemessene Verzögerungsverteilung
  liefert (vorher wäre das Gewicht geraten).
- Ablations-Dokumentation je Hyperparameter (M7-Prozessregel) — **außer** über
  einer Kante (§3.3).
- Ab November: der in B6 geplante Sonder-Backtest „erster Regel-Winter“ bekommt
  eine zweite Achse „Vor-/Nach-Regime“, sonst werden Winterbewegung und
  Steuerbruch zu einem Fehler vermengt (M8).

### Phase 2 — bis 31.12.2026

Ziel: **Den permanenten Zustand bauen.** Der Deckel bleibt, der Rabatt geht.

- R4, sobald die Ausgestaltung bekannt ist — und **keine Zeile davor**: Ohne
  Formel, Referenz und Quelle ist jeder `LEGAL_CAP`-Wert geraten. Solange gilt
  `cap_status: unknown` und kein Clipping.
- Deckel-Prognose als eigenes Produktmerkmal prüfen (Formeldeckel aus
  veröffentlichten Referenzkursen ist genauer vorhersagbar als jeder
  Wettbewerbspreis, §2.4c).
- Produktregel für den bindenden Deckel (Streuungs-Kollaps → `no_advice` mit
  Grund, §R4.5), inkl. GUI-Texte nach MICROCOPY.

### Warum diese Reihenfolge und nicht die des Entwurfs

Der Entwurf baut die Interventions-Schicht für Oktober–Dezember (transient: nach
42 Tagen ist der Rabatt aus jedem Trainingsfenster, gemessen heilt der Punkt
selbst ohne Eingriff in 2–3 Wochen) und erledigt den Deckel (permanent,
strukturverändernd, zensierend, produktverändernd) mit einer Zeile `min()`.
**Die Aufwandsverteilung ist genau verkehrt.** Dazu kommt der Termin: Für den
01.10. lässt sich in 12 Tagen keine validierte Schätzung bauen — wohl aber
ehrliche Degradation, Gate-Schutz und die Projektions-Kante. Und der Deckel
lässt sich heute gar nicht bauen, weil seine Ausgestaltung offen ist; was sich
heute bauen lässt, ist die *Aufnahmefähigkeit* dafür (R1, R3, R4-Schnittstelle).

---

## 6. Einordnung in den Batch-Plan B0–B6

Der Batch-Plan aus
[BEFUND-UX-MATH-2026-09-19.md](BEFUND-UX-MATH-2026-09-19.md) bleibt gültig; dieser
Befund hängt sich ein, statt ihn zu ersetzen.

| Batch | Auswirkung | Begründung |
|---|---|---|
| **B0** Messgrundlagen | **ergänzen**: PIT-Paare brauchen einen Regime-Marker, `regime_breaks_in_window` als Zähler | PIT-Paare aus dem Übergangsfenster sind der Trainingsstoff von B2 — unmarkiert trainiert die Kalibrierung auf einem Schock |
| **B1** Eine Sprache für € und % | **vorziehen auf Phase 0** (0.7) | M5 (Nowcast am Live-Preis) ist die billigste Regime-Maßnahme für F2, §3.6 |
| **B2** Kalibrierungsschicht | **Termin-Gate**: keine Freigabe auf Daten aus 01.10.–15.11. | Eine isotone Rekalibrierung, die auf Bruch-Daten lernt, kalibriert den Schock ein — dauerhaft |
| **B3** Mehrtage & Kerne | **nachziehen**: Day-Pair-Bootstrap erst nach R2 | Mehrtages-Draws über eine Kante sind ohne Dummy doppelt falsch (§2.1, §3.1); die Ensemble-Gewichte sind im Oktober unbrauchbar (§3.3) |
| **B4** Navigation 3+1 | unberührt | keine Kopplung |
| **B5** Labor-Umbau | **eine Karte mehr**: „Regime & Rechtslagen“ im Parameterschrank (Kette: Kalender → δ̂/t̂ → Dummy → Projektions-Kante → Deckel → Zensierung) | Die Regime-Schicht braucht einen Anzeigeort, sonst landet sie im 1760-Zeilen-Akkordeon |
| **B6** Betriebsbeweis | **zweite Achse** Vor-/Nach-Regime im Sonder-Backtest | sonst werden Winter und Steuerbruch vermengt (M8) |
| **neu B7** Regime-Schicht | Phase 0 (0.1–0.7) → Phase 1 (R1/R2/R5.1) → Phase 2 (R4) | hängt an B0 (Marker) und B1 (Anker); B2/B3 hängen an B7 |

```text
        0.1 Messung ──┬── B7-Phase1 (R1/R2) ──┬── B7-Phase2 (R4, Deckel)
        0.2 R3 Kante ─┘                       │
        0.3 Gate-Schutz ──── B0 (+Marker) ────┤
        B1/M5 (0.7) ──────── B2 (erst ab 16.11.) ── B3 ── B5 (+Karte) ── B6 (+Achse)
```

---

## 7. Abnahme: welcher Beweis zählt

**Der wichtigste Punkt dieses Befunds, und er kostet nichts:** Dieser Bruch ist
nicht der erste. Das eigene Archiv (`archive_since 2025-09-09`) enthält den
Mai-Juni-Tankrabatt 2026 mit **beiden** Kanten — Start am 01.05. (−) und Ende am
01.07. (+). Das Rabatt-**Ende** ist derselbe Schock in derselben Richtung wie
der 01.01.2027 (§3.1), mit echter Durchgabe, echten Verzögerungen und echter
Streuung je Station. Wer den Oktober vorbereiten will, misst den Juli.

**Abnahme Phase 0** (vor dem 01.10.):

1. `analysis/regime_check.py` auf dem Archiv-Export 15.06.–15.07.2026, je
   Station und Sorte: δ̂, t̂, Vollständigkeit in %, Verzögerung in Tagen,
   Streuung über Stationen. Bericht nach `data/analysis/`, wie beim
   12-Uhr-Check.
2. Rolling-Origin-Backtest über den 01.07.2026 (`engine backtest --until
   2026-07-15 --at …`, Rezept in [ENGINE.md](ENGINE.md)): Status quo vs. R3 vs.
   R2 — drei Läufe, dieselben Tage. **Zielgrößen:** Bias q50 am Sprungtag
   ≤ 3 ct/L, Breite q975−q025 ≤ 1,5× Vor-Bruch-Basiswert, `P_besser` am
   Sprungtag in Richtung der Wahrheit (Szenario C: von 0,920 auf ≤ 0,20).
3. Invarianz-Nachweis: ohne deklarierte Regime ist die Prognose **bitgleich**
   (Muster aus B0).
4. Gegenmessung dokumentiert: `TANKAPP_REGIME=0` liefert den Vor-Zustand.
5. `law_rise_outside_noon` am 01.07.2026: ohne 0.5 dreistellig, mit 0.5 null —
   und die echten Verstöße bleiben stehen.

**Abnahme Phase 1/2:** PICP je Quantilstufe über die Kante (nicht nur 95 %),
Brier auf dem Ledger getrennt nach „Settlement schneidet eine Kante“ und
„schneidet keine“, MASE **nur** auf bruchfreien Fenstern, und für den Deckel:
`p_at_cap` gegen den Anteil der Beobachtungen am Deckel (Soll: deckungsgleich,
sonst ist die Schranke falsch gesetzt).

**Was ausdrücklich nicht als Beweis zählt:** eine Messung im Zeitraum
01.10.–15.11.2026 ohne `regime_breaks_in_window`-Kennzeichnung (§3.3), und jede
`train_days`-Änderung, die auf Oktober-Daten begründet wird (§2.5).

---

## 8. Offen, ehrlich benannt

1. **Rechtsfrage (blockiert R3 für den 01.01.):** Darf eine
   Tankstellenpreis-Erhöhung, die nur eine gesetzliche Steueränderung
   durchreicht, um 00:00 Uhr wirksam werden, oder gilt die 12-Uhr-Regel auch
   dann? Solange das ungeklärt ist, führt die Engine die Regime-Kante als
   erlaubte Sprungkante und weist sie als Annahme aus (`regime_jump_assumed`).
   Eine stillschweigend gepoolte Kurve (§2.3) ist die schlechteste der drei
   Antworten, weil sie niemand sieht.
2. **Deckel-Ausgestaltung unbekannt (blockiert R4):** feste Zahl, Formel aus
   Referenzkursen, je Sorte, je Region, je Station? Mit welcher Quelle und
   welcher Veröffentlichungs-Verzögerung? Ohne Antwort ist jeder `LEGAL_CAP`
   geraten; die Engine liefert dann `cap_status: unknown` und clippt nicht.
3. **Betrag je Sorte offen:** Die Meldung nennt eine Zahl für „Sprit“. Die
   Energiesteuersätze unterscheiden sich je Sorte deutlich (Benzin 65,45 ct/L,
   Diesel 47,04 ct/L), 2022 wurde je Sorte unterschiedlich gesenkt. R1 führt
   den Betrag deshalb **je Sorte**; eine globale Zahl wäre für mindestens eine
   Sorte falsch.
4. **Durchgabe-Verhalten ist eine Marktfrage, keine Modellfrage:** Wie stark
   weiten Stationen ihre Marge, wenn die Steuer sinkt? 0.1 misst das am
   eigenen Bestand für Mai/Juni 2026. Bis dahin ist jede Zahl — auch die hier
   verwendete — eine Annahme.
5. **Übergewinnsteuer:** Für die Engine ohne direkte Wirkung (sie betrifft
   Gewinne, nicht Endpreise). Indirekt denkbar als Marginendruck in
   Hochpreisphasen; nicht modelliert, nicht geraten, hier nur benannt.
6. **Keine Zahl dieses Befunds stammt aus dem Echtbestand.** Alle Messungen
   laufen auf synthetischen Reihen, die auf die eigenen Messwerte aus
   [archiv/BEFUND-12-UHR-REGEL-2026-09-18.md](archiv/BEFUND-12-UHR-REGEL-2026-09-18.md)
   kalibriert sind (Anhang B). Sie belegen **Mechanismen und Vorzeichen**, nicht
   Beträge für den eigenen Stationsbestand. Die Beträge liefert 0.1.

---

## Anhang A: Messtabellen

Rolling-Origin, echte `engine.models.fit`/`predict`-Kette, `train_days = 42`,
`min_train_days = 28`, `bootstrap_samples = 500` (entspricht
`engine.probabilities.DECISION_DRAWS`), `bootstrap_ew_half_life_days = 14`,
`decision_hour`-unabhängig (Cutoff jeweils 00:00 lokal), `P_besser` gerechnet
wie `app/pside.py::p_better` mit θ = 1 ct gegen den live beobachteten Anker.
Reproduktion: `python analysis/regime_check.py --simulate`.

### A.1 Szenario A — Bruch −17,0 ct/L am 01.10.2026, sofort und vollständig

| Cutoff | Status quo Bias / Breite / P | Schritt-Dummy Bias / Breite / P | Kurzfenster 14 d Bias / Breite / P |
|---|---|---|---|
| 25.09. | +0,8 / 7,8 / 1,000 | +0,8 / 7,8 / 1,000 | +1,2 / 8,1 / 1,000 |
| 30.09. | −2,2 / 7,8 / 1,000 | −2,2 / 7,8 / 1,000 | −1,3 / 7,4 / 0,946 |
| 01.10. | **+19,1** / 7,9 / 1,000 | +2,1 / 7,9 / 1,000 | +19,2 / 8,0 / 1,000 |
| 02.10. | +17,7 / **23,1** / **0,000** | +0,5 / 7,9 / 0,736 | +18,4 / 18,4 / **0,000** |
| 03.10. | +17,3 / 23,5 / **0,000** | +0,2 / 7,7 / 0,732 | +18,6 / 19,7 / **0,000** |
| 05.10. | +17,9 / 23,6 / **0,136** | +0,8 / 8,4 / 1,000 | +20,3 / 20,8 / **0,000** |
| 08.10. | +13,2 / 24,3 / **0,270** | −3,2 / 8,1 / 1,000 | −2,0 / 23,0 / 0,506 |
| 12.10. | +13,2 / 24,6 / **0,448** | −1,9 / 7,7 / 1,000 | +5,6 / 21,8 / 0,368 |
| 16.10. | +5,1 / **26,4** / 0,570 | −1,5 / 7,7 / 1,000 | −0,8 / 16,1 / 1,000 |
| 22.10. | +3,1 / 25,3 / 0,706 | +1,6 / 7,8 / 1,000 | +3,5 / 5,8 / 1,000 |
| 29.10. | −0,0 / **25,9** / 0,682 | −0,6 / 7,2 / 1,000 | −0,2 / 6,2 / 0,950 |
| 08.11. | +1,4 / 15,7 / 0,842 | −0,8 / 6,7 / 1,000 | +6,4 / 10,7 / **0,044** |

Wahrheit (Fensterminimum − Anker, ct/L): 30.09. −6,3 · 01.10. −31,8 ·
02.10. −3,9 · 03.10. −5,9 · 05.10. −11,5 · 08.10. −8,8 · 12.10. −8,8 ·
16.10. −12,4 · 22.10. −15,0 · 29.10. −6,6 · 08.11. −6,7.
Der hartkodierte Daten-Abzug aus dem Entwurf liefert in Szenario A
**dieselben** Werte wie der Schritt-Dummy (bei sofortiger, vollständiger,
terminrichtiger Durchgabe sind beide äquivalent) — der Unterschied zeigt sich
erst in Szenario B.

### A.2 Szenario B — Bruch −14,5 ct/L am 03.10.2026 (2 Tage spät, 85 % Durchgabe)

| Cutoff | Status quo | hartkodiert −17 ab 01.10. | δ̂ geschätzt (Termin angekündigt) | t̂ und δ̂ geschätzt |
|---|---|---|---|---|
| 01.10. | +4,2 / 6,6 / 0,730 | **−12,8** / 6,6 / 1,000 | −12,8 / 6,6 / 1,000 | −12,8 / 6,6 / 1,000 |
| 02.10. | +0,9 / 7,6 / 1,000 | **−14,5** / 14,9 / 1,000 | −14,5 / 14,9 / 1,000 | −14,5 / 14,9 / 1,000 |
| 03.10. | +16,0 / 7,8 / 1,000 | +1,3 / 18,4 / 0,956 | +1,3 / 18,4 / 0,956 | +1,3 / 18,4 / 0,956 |
| 05.10. | +12,3 / 19,3 / **0,044** | −2,4 / 17,9 / 0,908 | +4,9 / 12,8 / 0,576 (δ̂ −9,4) | **+9,3** / 15,2 / **0,044** (t̂ 30.09., δ̂ −4,4) |
| 08.10. | +14,3 / 19,9 / 0,192 | −0,1 / 18,4 / 0,922 | +1,1 / 16,8 / 0,922 (δ̂ −15,5) | −0,9 / **7,6** / 1,000 (t̂ 03.10., δ̂ −15,5) |
| 12.10. | +8,9 / 21,0 / 0,382 | −5,9 / 17,9 / 0,934 | −5,0 / 16,4 / 0,934 (δ̂ −15,4) | −4,7 / **6,6** / 1,000 (t̂ 03.10.) |
| 16.10. | +6,0 / 20,9 / 0,510 | −1,6 / 18,0 / 0,940 | −0,2 / 15,8 / 0,940 (δ̂ −14,5) | −0,9 / **8,0** / 1,000 (t̂ 03.10.) |
| 22.10. | +7,7 / 21,0 / 0,660 | +4,4 / 16,1 / 0,954 | +4,9 / 14,5 / 0,954 (δ̂ −14,5) | +3,8 / **7,3** / 1,000 (t̂ 04.10.) |
| 29.10. | +4,0 / 21,6 / 0,482 | +1,6 / 15,5 / 0,854 | +2,1 / 14,8 / 0,826 | +1,6 / **15,5** / 0,854 (Rückfall: Bruch aus dem Suchfenster) |
| 08.11. | −1,9 / 17,5 / 0,900 | −4,3 / 8,5 / 0,980 | −3,8 / 7,8 / 0,980 | −4,3 / 8,5 / 0,980 |

*(Bias q50 in ct / Breite q975−q025 in ct / `P_besser`.)*

### A.3 Szenario C — Bruch +17,0 ct/L am 01.01.2027 (Rabatt-Ende)

| Cutoff | Status quo Bias / Breite / P | Schritt-Dummy Bias / Breite / P | t̂ und δ̂ geschätzt Bias / Breite / P | Wahrheit: Fenstermin. − Anker |
|---|---|---|---|---|
| 28.12. | −1,4 / 7,6 / 1,000 | −1,4 / 7,6 / 1,000 | −1,4 / 7,6 / 1,000 (keine Kante) | −15,0 ct |
| 31.12. | +1,3 / 7,6 / 1,000 | +1,3 / 7,6 / 1,000 | +1,3 / 7,6 / 1,000 (Fehlalarm von der δ̂-Schwelle zurückgenommen) | −7,7 ct |
| **01.01.** | **−15,4** / 7,7 / **0,920** | +1,6 / 7,7 / **0,000** | +1,6 / 7,7 / **0,000** (Ankündigung, noch keine Nach-Daten) | **+10,0 ct** |
| 02.01. | −15,9 / 15,5 / 1,000 | +0,2 / 7,8 / 0,728 | +0,2 / 7,8 / 0,728 | −4,0 ct |
| 04.01. | −19,2 / 19,1 / 1,000 | −3,2 / 8,0 / 1,000 | **−5,8 / 20,6** / 1,000 (t̂ 31.12., δ̂ +14,4 — einen Tag daneben) | −6,9 ct |
| 06.01. | −17,8 / 22,4 / 1,000 | −1,8 / 8,1 / 1,000 | −2,9 / **8,1** / 1,000 (t̂ 01.01., δ̂ +15,6) | −14,3 ct |
| 10.01. | −16,0 / 24,1 / 1,000 | −2,8 / 7,3 / 1,000 | −3,4 / **7,4** / 1,000 (t̂ 01.01., δ̂ +15,9) | −9,9 ct |
| 15.01. | −3,6 / 23,4 / 0,956 | −2,7 / 7,7 / 1,000 | −2,8 / **7,5** / 1,000 (t̂ 01.01., δ̂ +16,3) | −6,6 ct |

### A.4 Projektions- und Deckel-Lemmata

| Prüfung | Ergebnis |
|---|---|
| Regime-Anstieg +17 ct um 00:00 innerhalb eines 12-Uhr-Segments, bestehende `noon_law_projection` | Sprung +16,89 ct → **+0,00 ct**; 231/288 Punkte verbogen; +9,83 ct zu hoch vor der Kante, −7,06 ct danach |
| Regime-Senkung −17 ct um 00:00, bestehende Projektion | Sprung −17,11 ct → **−17,11 ct**; 0/288 Punkte betroffen (Senkungen sind jederzeit erlaubt) |
| Regime-Kante als zusätzliche Segmentgrenze | Sprung +16,89 ct → **+16,89 ct**; 0/288 Punkte betroffen |
| `min(·, cap(t))` **nach** der Projektion, Deckel steigt um 00:00 | **illegaler Anstieg +5,0 ct** — 12-Uhr-Regel verletzt |
| `min(·, cap(t))` **vor** der Projektion | legal (max. Anstieg 0,00 ct), Deckelsprung um −2,5 ct verflacht |
| `min(·, c)` auf die Quantile q025…q975 | Ordnung bleibt erhalten (1,70/1,75/1,80/1,90/2,00 → 1,70/1,75/1,78/1,78/1,78) |
| `law_rise_outside_noon` bei deklarierter Steuer-Erhöhung um 00:00 | zählt **1 Verstoß** je Station und Sorte |

### A.5 MASE-Nenner und Ensemble-Gewichte (Szenario A)

Siehe Tabelle in §3.3. `mase_scale` 1,98–2,21 ct (September) → 2,71–2,94 ct
(Oktober/November), +27 bis +33 %. Naive-MAE im 14-Tage-Validierungsfenster des
Ensembles 2,42–2,73 ct → **6,30 ct** am 05.10. (2,4×). Die Ensemble-Gewichte
bleiben über den gesamten Zeitraum nahe 50/50 — sie tragen im Bruch keine
Information, sehen aber gültig aus.

## Anhang B: Grenzen der Messung

Ehrlichkeit vor Zeigen, wie in
[archiv/BEFUND-12-UHR-REGEL-2026-09-18.md](archiv/BEFUND-12-UHR-REGEL-2026-09-18.md)
§2.3:

1. **Synthetische Reihen, keine Echtbestands-Messung.** Der Generator ist auf
   die eigenen Live-Messwerte kalibriert (Tagesspanne 17 ct, Tief Median 7 Uhr
   mit 84 % im Block 6–12, Hoch Median 12 Uhr mit 97 % im Block 12–18,
   Mittagssprung Median 0 ct mit 44 % ≥ 2 ct), plus langsames Niveau (±1 ct),
   Wochenend-Anteil (+0,4 ct) und AR(1)-Rauschen auf dem 5-Minuten-Raster. Er
   kennt **keine** Schließzeiten, keine Nachtlücken, keine Hampel-Artefakte,
   keine Collector-Ausfälle und keine Betreiberwechsel — alles Effekte, die im
   Echtbestand die Breite zusätzlich treiben. Die gemessenen **Mechanismen und
   Vorzeichen** sind belastbar, die absoluten ct-Beträge sind es für den
   eigenen Bestand nicht.
2. **Eine Station, eine Sorte, ein Samen je Szenario.** Die Streuung über
   Stationen (die für die Durchgabe-Verteilung in R5.1 gebraucht wird) ist
   nicht gemessen; das liefert Maßnahme 0.1 auf dem Archiv.
3. **Das Modell ist gegen den Generator gut spezifiziert.** Die Tagesform ist
   harmonischen-freundlich gewählt, damit der Bruch isoliert messbar wird. Im
   Echtbestand kommt Fehlspezifikation dazu; sie wirkt auf alle Varianten
   gleich, vergrößert aber die Basisbreite (hier 6,6–8,1 ct) gegenüber dem, was
   das Labor zeigen wird.
4. **Die Dummy-Varianten sind als Niveau-Verschiebung emuliert**, nicht als
   zusätzliche Spalte in `features()`. Beides ist algebraisch äquivalent
   (Schritt-Dummy = Verschiebung der Nach-Kante-Preise plus Rückverschiebung der
   Prognose), aber die Emulation teilt die Kante nicht mit dem Huber-IRLS — die
   gemeinsame Schätzung von γ und Intercept ist leicht stabiler als die hier
   gemessene zweistufige Form. Die gemessenen Unterschiede zwischen den
   Varianten sind deshalb **konservativ**.
5. **`P_besser` ist gegen eine deterministische Wahrheit gerechnet.** Die
   synthetische Zukunft ist bekannt, also ist die wahre Antwort 0 oder 1;
   `wahr_fenster_ct` nennt den Abstand des echten Fensterminimums zum Anker. Im
   Echtbetrieb ist die Wahrheit eine Verteilung — die Bewertung über den Ledger
   (§3.4) bleibt der maßgebliche Nachweis.
6. **Die Feiertags-Messung (§3.2) nutzt einen konstruierten Feiertagseffekt von
   +6 ct/L.** Gemessen wird die **Differenz** zwischen Pool mit und Pool ohne
   Rabatt bei sonst identischen Daten; die Größe des konstruierten Effekts geht
   in diese Differenz nur über die Kollinearität ein. Für einen kleineren echten
   Feiertagseffekt ist die absolute Verfehlung kleiner, ihr Verhältnis zum
   Effekt (hier −25 %) bleibt in derselben Größenordnung.
