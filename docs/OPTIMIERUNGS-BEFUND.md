# OPTIMIERUNGS-BEFUND — wo 0.43.2 noch Luft hat

> Stand: 16.09.2026 · App-Version **0.43.2** · Arbeitsdokument (Sichtung,
> keine Abnahme, kein Auftrag). Alle Zeilenangaben sind gegen 0.43.2
> nachgeprüft. Zweiter Durchgang am selben Tag: zwölf
> Dimensionen ergänzt, die in der Ausgangsfrage fehlten
> ([7](#7-dimensionen-die-in-der-aufzählung-fehlten), Befunde O33–O42), und
> alle 42 Befunde in Batches mit Priorität und Check gruppiert
> ([10](#10-batches-priorität-und-check)). Geprüft wurde der Bestand gegen sich selbst:
> `engine/`, `app/`, `web/src/`, `rp2/`, `ops/` und `data-tools/`, dazu
> Messungen am Demo-Stapel und an synthetischen 70-Tage-Daten — Protokoll und
> Grenzen in [8](#8-gemessen-statt-behauptet). Bewusst **nicht** wiederholt
> werden die offenen Aufgaben A–H aus [../TODO.md](../TODO.md), die
> archivierten Prüfberichte in [archiv/README.md](archiv/README.md) und die
> Text-Befunde T1–T13 aus [TEXT-BEFUND.md](TEXT-BEFUND.md). Wo ein Befund an
> eine bekannte offene Entscheidung rührt (B22 Nacht-Raster, C12 Desktop),
> steht der Querverweis dabei, kein zweiter Befund.

## Inhaltsverzeichnis

- [1. Ausgangslage und Abgrenzung](#1-ausgangslage-und-abgrenzung)
- [2. Kurzfassung](#2-kurzfassung)
- [3. Mathematik und Statistik](#3-mathematik-und-statistik)
- [4. UX und UI](#4-ux-und-ui)
- [5. Technik und Betrieb](#5-technik-und-betrieb)
- [6. Kundensicht](#6-kundensicht)
- [7. Dimensionen, die in der Aufzählung fehlten](#7-dimensionen-die-in-der-aufzählung-fehlten)
- [8. Gemessen statt behauptet](#8-gemessen-statt-behauptet)
- [9. Was schon richtig ist](#9-was-schon-richtig-ist)
- [10. Batches, Priorität und Check](#10-batches-priorität-und-check)

## 1. Ausgangslage und Abgrenzung

Die App ist an den Stellen stark, an denen sie sich selbst Regeln gegeben
hat: Ehrlichkeits-Regel (`calibrated=false`, `decision_ready=false` bis M7),
Formatter-Zwang für alle Zahlen, Ratchet-Tests für Mikrotext, ein
Alarm-Katalog mit Codes, ein Ledger mit Abrechnung statt Behauptung. Dieser
Befund sucht deshalb nicht nach fehlenden Features, sondern nach vier
Mustern, die trotz dieser Disziplin durchrutschen:

1. **Stille Degradation.** Eine Grenze wird überschritten, und der Code
   antwortet mit „keine Daten“ statt mit „Grund“ (O22, O16, O18).
2. **Zweckentfremdete Größen.** Eine Zahl wird korrekt gerechnet, aber für
   eine andere Frage benutzt, als sie beantwortet (O12, O13, O17, O19, O30).
3. **Zwei Wahrheiten.** Dasselbe Konzept ist zweimal implementiert oder
   zweimal konventioniert, und beide Fassungen sind grün (O7, O21, O28).
4. **Kosten ohne Nutzen.** Rechenzeit und Payload fließen, ohne dass jemand
   sie bestellt hat (O23, O25, O26, Nacht-Zellen in B22).

Abgrenzung, damit nichts doppelt läuft: B22 (Bootstrap-Samples, Nacht-Raster)
und C12 (Desktop-Zweispalter) sind offene Entscheidungen, keine neuen
Befunde; hier steht jeweils nur die Messung, die die Entscheidung erleichtert
(O22, O25). Das Ensemble-Problem (Gewichte aus In-Sample-MASE) ist in
[LUECKEN.md](LUECKEN.md) bereits mit denselben Zahlen dokumentiert und wird
hier nicht neu verkauft — es taucht nur als Querverweis in O6 auf, weil die
Brier-Schwelle dieselbe Schwäche erbt.

Seit dem ersten Durchgang ist **0.43.2** erschienen ([../CHANGELOG.md](../CHANGELOG.md)):
vier Nutzerbefunde sind dort behoben (Lernstand-Satz doppelt, Geometrie des
Tagesstreifens, Karten-Anker, Mobil-Robustheit mit eigener Browser-Suite).
Keiner davon wird hier wiederholt. Berührt ist allein O20: 0.43.2 hat die
**Geometrie** des Tagesstreifens gerichtet (feste 12-px-Spur, Spaltenzahl
folgt der Breite), die **Farbskala** und die Stunden-Zuordnung in
`web/src/strip.ts` sind unverändert — der Befund bleibt stehen, die Abgrenzung
steht bei O20.

**Kein Befund dieses Dokuments ist eine Aussage über Modellgüte.** Alles
Untenstehende betrifft Mechanik: was gerechnet, gesendet, angezeigt,
gespeichert und gemessen wird. `calibrated=false` bleibt stehen, bis M7
erreicht ist.

## 2. Kurzfassung

P0 = kann die Kernfunktion lautlos abschalten oder verfälscht den Ledger ab
dem ersten Beleg. P1 = verfälscht eine Anzeige oder verschwendet spürbar
Ressourcen. P2 = inkonsistent, aber folgenarm. P3 = Schliff.

| Befund | Prio | Kurz | Wirkung in einem Satz |
|---|---|---|---|
| [O1](#o1--jeder-gui-beleg-tankt-um-12-uhr) | P0 | `clock_hour` fehlt | Jeder GUI-Beleg wird als 12-Uhr-Tankung gebucht — das persönliche Zeitprofil lernt ab dem 8. Beleg aus einer erfundenen Uhrzeit. |
| [O22](#o22--die-veröffentlichung-passt-nicht-mehr-durch-das-leselimit) | P0 | Publikations-Klippe | Ab etwa 5 Stationen ist `current.json` größer als das 10-MB-Leselimit: Die App zeigt überall „keine Prognose“, der Job meldet weiter Erfolg. |
| [O4](#o4--das-güte-badge-kippt-bei-jedem-poll) | P1 | PICP-Badge flattert | Rolling-PICP poolt autokorrelierte 5-Minuten-Punkte; ±5 Prozentpunkte Standardfehler lassen das Badge ohne Hysterese kippen. |
| [O5](#o5--das-m7-gate-mischt-zwei-wahrscheinlichkeitsquellen) | P1 | Brier ohne `p_source` | Das M7-Gate verrechnet Verteilungs-P und selbstkalibrierte Basisrate in einer Zahl — es kann sich selbst erfüllen. |
| [O6](#o6--die-brier-schwelle-ist-ein-münzwurf-ohne-intervall) | P1 | 0,25 ohne Intervall | Die Gate-Schwelle 0,25 ist ohne Konfidenzintervall, Fenster und Hysterese das Niveau eines Münzwurfs. |
| [O16](#o16--der-laborbalken-für-den-hauspreis-bleibt-leer) | P1 | δ̂-Balken leer | Das Labor filtert auf ein Feld, das der Server nie sendet — die Balken bleiben dauerhaft leer, obwohl δ̂ samt KI längst im Browser liegt. |
| [O17](#o17--ein-tipp-bucht-den-prognosepreis-als-gezahlten-preis) | P1 | Belegpreis erfunden | „Ja, wie empfohlen“ bucht den Prognose-Median als `price_paid`: Die Wallet-Bilanz rechnet mit einem Preis, den niemand gezahlt hat. |
| [O23](#o23--der-healthcheck-parst-die-veröffentlichung-alle-30-sekunden) | P1 | Health parst alles | Docker-Healthcheck und GUI-Poll parsen die komplette Veröffentlichung, unkached, alle 30 Sekunden. |
| [O24](#o24--der-server-spricht-http10) | P1 | HTTP/1.0 | Ohne Keep-Alive zahlt jede der vielen parallelen GUI-Anfragen einen neuen TCP-Handshake — die Fallback-GUI auf dem Pi macht es längst richtig. |
| [O29](#o29--kein-hinweis-wenn-das-fenster-aufgeht) | P1 | kein Push | Das empfohlene Fenster öffnet sich, ohne dass jemand Bescheid weiß — obwohl Auslöser und Kanal vorhanden sind. |
| [O2](#o2--zwei-personalisierungen-eine-davon-hartkodiert) | P2 | zwei Zeitprofile | Die Fenstersuche nutzt die eigenen Belege ohne Wochentag, das Stations-Ranking nutzt eine hartkodierte Pendler-Annahme — die 25 % des Scores trägt. |
| [O3](#o3--die-profilschrumpfung-springt-am-achten-beleg) | P2 | Sprung bei n=8 | Die Schrumpfung des Zeitprofils kippt am 8. Beleg von 0 auf 1 — dieselbe Datenlage, sichtbar andere Reihenfolge. |
| [O7](#o7--drei-tie-konventionen-in-einem-ledger) | P2 | Tie-Zählung | Gleichstand zählt je Kennzahl anders (0,5 / Sieg / 0,5 / nicht gewertet) — dieselben Fälle, vier Antworten. |
| [O8](#o8--abrechnung-und-wahrscheinlichkeit-nutzen-andere-fenster) | P2 | Slack ≠ Fenster | Das Settlement erlaubt −30/+60 Minuten, die Wahrscheinlichkeit rechnet ±2 Stunden: `hit_wait` ist systematisch optimistisch. |
| [O9](#o9--umwegkosten-entscheiden-netto-und-rechnen-brutto) | P2 | brutto/netto | Abgerechnet wird ohne Umwegkosten, entschieden mit — der M7-Regler für `elsewhere_net_eur` ist verzerrt. |
| [O10](#o10--dünne-slots-liefern-rauschende-bandenden) | P2 | q025/q975 dünn | Slots mit 7 von 42 Tagen ziehen ihre Bandenden aus rund 83 Draws — die Enden rauschen stärker als die Mitte. |
| [O11](#o11--die-heatmap-bewertet-sich-mit-eigenen-preisen) | P2 | kein LOO | Die Heatmap-Wahrscheinlichkeit rechnet den Zellen-Median inklusive der eigenen Preise; die Selektion zeigt mit `_loo_baseline`, wie es geht. |
| [O12](#o12--die-fenstersterne-haben-keine-basisrate) | P2 | Sterne ohne Basis | Absolute Schwellen 75/55/35 auf einer 1-aus-7-Größe, dazu am Rand des Horizonts 1-aus-4 — gemessen faktisch binär. |
| [O13](#o13--die-laborbilanz-ist-zweimal-dieselbe-zahl) | P2 | `sum_best` ≡ `sum_always` | Zwei der vier Bilanzsummen sind dieselbe Zahl unter zwei Namen, die Beschriftung verspricht einen Vergleich. |
| [O14](#o14--umwegkilometer-sind-drei-verschiedene-größen) | P2 | `dist_km` gemischt | Straßenkilometer, Luftlinie und Pauschalfaktor laufen unter einem Feldnamen; eine Schwelle von 400 hängt an einem abgeleiteten Wert. |
| [O15](#o15--der-zeitwert-kippt-um-halb-fünf) | P2 | Stufe 16:30 | Der Zeitwert ist eine Stufe über der Uhrzeit — um 16:30 springt die Netto-Ersparnis, nicht um 16:29. |
| [O18](#o18--vier-laborwerkzeuge-sind-dauerhaft-stumm) | P2 | tote Werkzeuge | ε-Scan, Modellvergleich, Top-3 und CUSUM zeigen dauernd „zu wenig Daten“ mit Texten, die Besserung versprechen. |
| [O19](#o19--die-ersparnis-rechnet-gegen-die-teuerste-station) | P2 | falscher Anker | „Du sparst …“ rechnet gegen die teuerste Station im Set statt gegen die Haus- oder Jetzt-Alternative. |
| [O20](#o20--der-tagesstreifen-färbt-rückwirkend-um) | P2 | relative Farben | Der Tagesstreifen färbt nach Tages-Minimum/-Maximum: eine neue Meldung färbt den ganzen bisherigen Tag um. |
| [O21](#o21--das-scoring-lebt-doppelt-und-der-server-entscheidet-mit) | P2 | doppeltes Scoring | Dieselben Formeln leben in Python und TypeScript, und der Server rechnet mit festem 40-L-Profil gegen die GUI-Einstellung. |
| [O25](#o25--kompression-und-revalidierung-sind-zu-teuer-und-zu-selten) | P2 | gzip 6 | Kompressionsstufe 6 kostet gemessen das Vierfache von Stufe 1, und ETag/304 gibt es nur auf einem Endpunkt. |
| [O26](#o26--jeder-decide-poll-nimmt-die-schreibsperre) | P2 | Lock im Lesepfad | `GET /decide` nimmt bei jedem Poll die exklusive Store-Sperre, obwohl es nichts schreibt. |
| [O27](#o27--bild-und-pipeline-bauen-gegen-andere-versionen) | P2 | 3.14 vs 3.11 | Das Laufzeitbild nutzt andere Python- und Node-Versionen als die Pipeline; `package.json` nennt kein `engines`. |
| [O30](#o30--die-bilanz-zeigt-brutto-was-netto-gemeint-ist) | P2 | Bilanz brutto | Die persönliche Bilanz weist Ersparnis ohne Umwegkosten aus, während die Entscheidung netto rechnet. |
| [O31](#o31--die-woche-endet-ohne-zusammenfassung) | P2 | kein Wochenrückblick | Sieben Tage Empfehlungen, Abrechnungen und Lernstand enden ohne eine zusammenfassende Meldung. |
| [O28](#o28--kleine-unehrlichkeiten-in-kommentar-und-laufzeit) | P3 | Doku driftet | Zwei Docstrings behaupten, die gemeinsame Ziehung sei nicht umgesetzt — sie ist es; dazu eine All-NaN-Warnung. |
| [O32](#o32--die-belegmaske-zeigt-den-live-preis-nicht) | P3 | Prefill-Staleness | Die Belegmaske zeigt den Preis, mit dem sie vorbefüllt hat, nicht den aktuellen — der Nutzer sieht die Veraltung nicht. |
| [O33](#o33--die-backup-alterung-bleibt-unsichtbar) | P1 | Backup unsichtbar | Stirbt der Backup-Cron, meldet nichts; nach 14 Tagen Rotation ist jeder ältere gute Stand weg, und alles liegt auf einem Gerät. |
| [O35](#o35--live-preise-kennen-keine-plausibilitätsgrenze) | P1 | Live-Preis ungeprüft | Der Trainingspfad filtert 0,40–5,00 €/L und Hampel-Artefakte, der Live-Pfad nicht: ein API-Ausreißer sortiert sich an die Spitze und wird Empfehlung. |
| [O36](#o36--vier-konfigurationsflächen-und-eine-zahl-als-literal) | P1 | Konfig-Drift | Vier Konfigurationsflächen, davon eine statistisch begründete Zahl als Literal im Worker: B22 würde nur die halbe App ändern. |
| [O38](#o38--verstrichene-fenster-sind-unsichtbar) | P1 | Wirkung unsichtbar | Verstrichene Fenster werden erfasst, aber nie angezeigt — die App kann nicht sagen, ob sie geholfen hat. |
| [O34](#o34--historie-und-archiv-haben-keine-aufbewahrungsregel) | P2 | keine Aufbewahrung | Wöchentliche InfluxDB-Snapshots ohne Rotation, das Roharchiv in keiner Sicherung und ohne dokumentierte Entscheidung. |
| [O37](#o37--der-server-misst-sich-selbst-nicht) | P2 | keine Metriken | Keine Antwortzeiten, keine Parse-Dauer, kein Server-Budget: O23/O25/O26 sind unsichtbar und kommen wieder. |
| [O39](#o39--das-ledger-ist-im-lan-für-alle-lesbar) | P2 | LAN-Exposition | Jeder Rechner im LAN liest alle Belege mit Zeit, Ort und Preis; ein Token-Mechanismus ist vorhanden, die Entscheidung nicht dokumentiert. |
| [O42](#o42--der-push-grundsatz-kollidiert-mit-dem-preis-push) | P2 | Push-Regel offen | `notify.py` verbietet Preis- und Stationsdetails im Push — O29 braucht genau sie; die Kanal-Entscheidung steht nirgends. |
| [O40](#o40--die-diagramm-textalternative-nennt-keine-werte) | P3 | A11y-Rest | Diagramme tragen `role="img"` und `<desc>`, aber die Beschreibung nennt Reihen statt Werte, und `aria-label` ist überall „Diagramm“. |
| [O41](#o41--drei-normalisierungswege-für-ein-artefakt) | P3 | drei Formen | Zwei Schreiber, drei Normalisierungswege, tote Felder und kein Test für `read_selection`. |

Zwei Zahlen zum Einordnen: **14 der 42 Befunde sind P0/P1**, und die beiden
P0-Befunde teilen sich eine Ursache — ein Wert fehlt (O1) oder eine Grenze
greift (O22), und in beiden Fällen sagt niemand Bescheid.

## 3. Mathematik und Statistik

Befunde O1–O15. Alle Zeilenangaben gegen 0.43.2.

### O1 — Jeder GUI-Beleg tankt um 12 Uhr

**Beleg.** `app/feedback.py:820` liest die Tankuhrzeit aus dem Beleg:
`clock_hour = fill_data.get("clock_hour", 12.0)`, gespeichert in `:848`,
verwendet für das Zeitprofil in `:1437` (`h = int(f.get("clock_hour", 12.0))
% 24`). Der Snapshot-Pfad macht dasselbe (`:503`, `:647`). Die GUI sendet das
Feld nie: `web/src/data.ts:390` deklariert `clock_hour?: number | null`, und
beide Beleg-POSTs (`web/src/state/overview.tsx:1099–1106` und `:1144–1151`)
schicken `station_id`, `station_name`, `liters`, `price_paid`, `fuel`,
`source`, `episode_id` — keine Uhrzeit. `decide.py:1016` liefert `clock_hour`
zwar im Snapshot, aber nur für die Entscheidung, nicht für den Beleg.

**Wirkung.** Jeder über die GUI erfasste Beleg landet im Stunden-Histogramm
bei 12 Uhr. Ab `WH_MIN_FILLS = 8` Belegen (`app/feedback.py`) wird dieses
Histogramm zur Gewichtung `w(h)` der Fenstersuche (`app/decide.py:146–176`) —
die Personalisierung steht also ab dem achten Beleg auf einer Uhrzeit, die
nie gemessen wurde, und zwar mit der Mittagsspitze als künstlichem Zentrum.
Zwölf-Uhr ist zugleich die Projektionsregel der Engine
(`engine/config.py:decision_hour`), fällt also nicht als Ausreißer auf.

**DoD.** `clock_hour` wird aus `tanked_at` in Europe/Berlin abgeleitet —
serverseitig in `record_fill`, nicht als neue GUI-Pflicht (die GUI kennt die
Zeitzone nicht zuverlässig, und ein Beleg kann nachgetragen werden). Der
Default 12.0 bleibt nur für Belege ohne Zeitstempel und wird als solcher
ausgewiesen (`clock_hour_source: "beleg"|"abgeleitet"|"default"`), damit das
Histogramm seine Herkunft zeigt. Bestehende Belege werden nicht
stillschweigend umgeschrieben: entweder Migration mit Kennzeichnung oder
Neustart des Histogramms mit Hinweistext. Ratchet-Test: ein GUI-Beleg mit
`tanked_at` 18:40 erzeugt `clock_hour` 18, nicht 12.

### O2 — Zwei Personalisierungen, eine davon hartkodiert

**Beleg.** `w(h)` ist ein 24-Stunden-Vektor aus den eigenen Belegen
(`app/decide.py:146–176`, `_wh_weight` tastet ein 2-h-Fenster in
Viertelstunden ab); die Fenstersuche F3 rankt über sieben Tage
(`decide.py:274–320`, `_week_windows`). Die **Selektion** rechnet ihre eigene
Zeitgewichtung — fest verdrahtet, in `engine/selection.py:765–770`:

```python
w = np.zeros(24)
w[[6, 7, 8, 16, 17, 18, 19]] = 1.0
wd_weight, we_weight = 5 / 7, 2 / 7
w_weekday = w / w.sum() * wd_weight if w.sum() else np.zeros(24)
w_weekend = np.full(24, 1 / 24) * we_weight
w_user = w_weekday + w_weekend
```

Daraus entsteht `avail` (`:831–836`), und `avail` trägt **25 % des
Composite-Scores**, nach dem die Stationen sortiert und als `top_global`
publiziert werden (`:905–910`, `:930`, `:1044`):
`0.40·z(−Niveau) + 0.25·z(avail) + 0.15·z(cycle_r2) − 0.10·z(vol) −
0.10·z(rank_std)`. Dieselben sieben Zeilen stehen ein zweites Mal in
`analysis/station_selection.py:576–579`.

**Wirkung.** Zwei Hälften der App personalisieren unterschiedlich und ohne
Bezug zueinander: Die Fenstersuche nutzt die eigenen Belege (ab dem achten,
siehe O1/O3) und kennt keinen Wochentag; das Stations-Ranking kennt Werktag
und Wochenende, aber nur als Annahme (7 Pendler-Stunden, 5/7 zu 2/7), die
sich durch keinen Beleg ändert. Wer samstags um 10 Uhr tankt, wird im Ranking
weiter als Pendler mit Feierabendfenster behandelt — und ein Viertel der
Reihenfolge der empfohlenen Stationen hängt an dieser Annahme. Dazu kommt die
Verdopplung: Ändert sich das Gewicht, muss es an zwei Stellen geändert
werden (dieselbe Kategorie wie O21, nur Python gegen Python).

**DoD.** Eine Zeitgewichtung, eine Quelle: `w_user` aus den Belegen ableiten
(dasselbe Histogramm wie `w(h)`, mit Wochentagsklasse und Schrumpfung) und
die hartkodierte Fassung nur als Startwert nehmen, solange kein Beleg
vorliegt — ausdrücklich als solcher gekennzeichnet. Die Formel gehört an eine
Stelle (z. B. `engine/selection.py` als Funktion, von `analysis/` importiert)
und die Gewichte gehören in die Konfiguration statt in den Code. Ein Test,
der `avail` mit zwei verschiedenen Beleg-Profilen vergleicht, hält fest, dass
die Personalisierung wirklich ankommt.

### O3 — Die Profilschrumpfung springt am achten Beleg

**Beleg.** `WH_MIN_FILLS = 8` in `app/feedback.py`; unterhalb bleibt
`wh_weight` `None` (`decide.py:157`: „dann bleibt die Preisreihenfolge
stehen“), oberhalb greift das geschrumpfte Histogramm.

**Wirkung.** Zwischen Beleg 7 und 8 ändert sich die Reihenfolge der
Fenster sprunghaft, nicht allmählich — und zwar in beide Richtungen: Der
achte Beleg kann eine Stunde, die vorher vorn lag, nach hinten werfen. Für
einen einzelnen Nutzer ist das der Moment, in dem die App „plötzlich anders
empfiehlt“, ohne dass sich am Preis etwas geändert hat.

**DoD.** Die Schrumpfung kontinuierlich machen: Gewicht = `n/(n+k)` mit
`k = WH_MIN_FILLS`, also ab dem ersten Beleg ein wenig und ab acht Belegen
nahezu voll — statt eines Schalters. Alternativ den Schalter behalten und in
der GUI einen Hinweis zeigen, wenn die Personalisierung gerade aktiv wurde
(„seit deinem 8. Beleg berücksichtigt die App deine Tankzeiten“).

### O4 — Das Güte-Badge kippt bei jedem Poll

**Beleg.** `rolling_picp_7d` wird aus den Prognosepunkten des 7-Tage-Rasters
gebildet (`app/model_jobs.py:271`) und in der GUI als Badge angezeigt
(`web/src/views/Labor.tsx`, `web/src/data.ts`). Das Raster ist 5-minütig
(`engine/probabilities.py:31`, `BLOCK_MINUTES = 120` für Blöcke, Punkte auf
dem Beobachtungsraster).

**Wirkung.** Aufeinanderfolgende 5-Minuten-Punkte desselben Tages sind fast
vollständig autokorreliert (AR(2)-Struktur, `engine/models.py`). Wer sie als
unabhängige Stichprobe zählt, unterschätzt den Standardfehler massiv: Bei
einem 7-Tage-Fenster mit 72 wirksamen Tagesblöcken liegt der Standardfehler
einer Trefferquote um 0,9 bei rund ±5 Prozentpunkten — das Badge schwankt
also allein durch Rauschen über jede feste Schwelle, und zwar bei jedem Poll
in eine andere Richtung. `app/thresholds.py` kennt das Muster bereits
(`noise_band`), wendet es hier aber nicht an.

**DoD.** Auf Tages- oder Blockebene aggregieren (ein Wert je Tag, nicht je
5 Minuten) und eine Hysterese wie in `thresholds.py` vorsehen: Das Badge
wechselt erst, wenn die Schwelle um mehr als die halbe Bandbreite
überschritten ist. Zusätzlich die Fallzahl anzeigen („auf 7 Tagen“), damit
ein Badge mit n=7 nicht wie eines mit n=700 wirkt.

### O5 — Das M7-Gate mischt zwei Wahrscheinlichkeitsquellen

**Beleg.** `app/feedback.py:494–497` und `:521` bauen `p_correct` entweder
aus der Verteilung oder aus `estimate_p`; `estimate_p` ist in `:437–441` eine
Laplace-Basisrate derselben Aktion (`(wins+1)/(n+2)`). Ein Feld `p_source`
existiert nicht. [LUECKEN.md](LUECKEN.md) Zeile 520 beschreibt das Gate so,
als käme `p` ausschließlich aus der Verteilung.

**Wirkung.** Zwei Probleme in einer Zahl. Erstens: Verteilungs-P und
Basisrate sind nicht vergleichbar, der Brier-Score mischt sie — ein
Verbesserung über die Zeit kann von der Mischung kommen, nicht von besserer
Kalibrierung. Zweitens: `estimate_p` ist per Konstruktion selbstkalibriert
(eine Laplace-Rate eigener Treffer sagt eigene Treffer gut vorher). Wenn das
M7-Gate auf Brier über `p_correct` steht und `p_correct` teilweise
`estimate_p` ist, kann das Gate sich selbst erfüllen — genau die
Gate-Selbsttäuschung, die [archiv/GUI-UX-BEFUND.md](archiv/GUI-UX-BEFUND.md)
als U-Befund für die GUI beschrieben hat, hier auf der Rechenseite.

**DoD.** `p_source` je Ledger-Zeile (`"verteilung"|"basisrate"|"keine"`), der
Brier-Score wird je Quelle getrennt ausgewiesen, und das M7-Gate darf nur auf
Verteilungs-P stehen. `LUECKEN.md` Zeile 520 an den Code anpassen — oder den
Code an die Doku, je nachdem was gewollt ist; beides zusammen geht nicht.

### O6 — Die Brier-Schwelle ist ein Münzwurf ohne Intervall

**Beleg.** Die Gate-Bedingung „Brier < 0,25“ steht als feste Zahl im
Ledger-Pfad (`app/feedback.py`, Brier-Bildung `:1281`) und in
[KONZEPT.md](KONZEPT.md)/[LUECKEN.md](LUECKEN.md) als M7-Kriterium.

**Wirkung.** 0,25 ist der Brier-Score einer konstanten 50-Prozent-Vorhersage.
Ein Modell, das nichts weiß, besteht die Schwelle also fast — und mit
dreistelliger Fallzahl, aber starker Autokorrelation (O4) ist der
Standardfehler groß genug, dass ein echter Wert von 0,20 und ein echter Wert
von 0,28 nicht unterscheidbar sind. Ohne Intervall, ohne Fenster und ohne
Hysterese entscheidet eine Nachkommastelle über „kalibriert“.

**DoD.** Drei Dinge: (a) Block-Bootstrap-Konfidenzintervall über Tagesblöcke
(das Verfahren existiert bereits in `engine/models.py` für Residuen),
(b) Vergleich gegen zwei Referenzen statt gegen 0,25 — konstante Basisrate
und Klimatologie (gleiche Stunde, gleicher Wochentag), (c) das Gate besteht
erst, wenn die Obergrenze des Intervalls unter der Referenz liegt. Dieselbe
Logik gilt für die Ensemble-Gewichtung, die in
[LUECKEN.md](LUECKEN.md) Zeile 516 bereits als diskriminanzarm dokumentiert
ist (0,51/0,49) — dort steht der Befund, hier nur der Querverweis.

### O7 — Drei Tie-Konventionen in einem Ledger

**Beleg.** `app/feedback.py`: Trefferquote zählt Gleichstand als 0,5
(`:1289`), `hit_wait`/`hit_now` zählen nur echte Siege (`:1266–1276`),
`estimate_p` setzt bei Gleichstand 0,5 (`:437–441`), Brier rechnet den
Grenzfall als 0 (`:1281`). Vergleichbar: `app/pside.py:38` zählt
`anchor - value >= theta` als Treffer (Grenzfall „genau 1 ct“ gewinnt),
`:73` zählt `own <= min(environment)` (Gleichstand gewinnt).

**Wirkung.** Dieselben Fälle ergeben je Kennzahl eine andere Trefferquote.
Bei θ = 1 ct und Preisen auf zwei Nachkommastellen sind exakte Gleichstände
nicht selten (Preise wiederholen sich in 5-Minuten-Rastern), also ist der
Unterschied nicht akademisch: Wer „Trefferquote 62 %“ neben „hit_wait 58 %“
sieht, sucht nach einem Grund, wo nur eine Zählregel steht.

**DoD.** Eine Konvention, dokumentiert und geteilt: Gleichstand zählt als
halber Treffer — oder als keiner. Alle fünf Stellen ziehen mit, und
`MICROCOPY.md` bzw. das Glossar nennt die Regel, damit die GUI sie erklären
kann. Ein Test, der einen Fall mit exakt 1 ct Differenz durch alle fünf
Kennzahlen schickt und die erwartete Konvention festschreibt.

### O8 — Abrechnung und Wahrscheinlichkeit nutzen andere Fenster

**Beleg.** Das Settlement akzeptiert Belege im Bereich −30/+60 Minuten um das
empfohlene Fenster (`app/settlement.py`, Slack-Konstanten dort), die
Wahrscheinlichkeitsseite rechnet auf 2-h-Blöcken
(`engine/probabilities.py:31`, `app/pside.py:17`).

**Wirkung.** Ein Beleg 55 Minuten nach Fensterbeginn gilt als „im Fenster
getankt“ (`hit_wait` steigt), obwohl die Wahrscheinlichkeit für diesen
Zeitpunkt nie ausgewiesen wurde — der Block danach kann ein ganz anderer
sein. `hit_wait` wird damit systematisch optimistischer, je weiter der Slack
ist, und die Kennzahl, die M7 mitträgt, ist nicht die, die der Nutzer als
Versprechen gelesen hat.

**DoD.** Entweder den Slack auf das P-Fenster beziehen (Beleg muss in den
Block fallen, für den P ausgewiesen wurde) oder den Slack in der Abrechnung
kennzeichnen (`settled: "im_fenster"|"kulanz"`) und `hit_wait` nur aus
`im_fenster` bilden. Die Kulanz-Fälle bleiben sichtbar, zählen aber nicht in
die Güte.

### O9 — Umwegkosten entscheiden netto und rechnen brutto

**Beleg.** `p_lohnt` (`app/pside.py:85–110`) rechnet netto:
`netto = (p̂_ref − p̂_alt)·L − K` mit Spritanteil und Zeitwert. Die
Ledger-Abrechnung für „woanders getankt“ weist `elsewhere_net_eur` aus, ohne
die Umwegkosten der tatsächlich gefahrenen Alternative abzuziehen
(`app/feedback.py`, Settlement-Pfad über `app/settlement.py`).

**Wirkung.** Die Empfehlung sagt „netto lohnt es sich nicht“, die Abrechnung
sagt später „du hast X € verschenkt“ — mit einer Bruttozahl. Wer den Regler
für `elsewhere_net_eur` (M7) auf diese Zahlen kalibriert, kalibriert ihn auf
eine Größe, die anders definiert ist als die, mit der entschieden wurde.

**DoD.** Die Abrechnung rechnet dieselbe Netto-Formel wie `p_lohnt`, mit den
tatsächlich gefahrenen Kilometern und dem Zeitwert des Profils — oder das
Feld heißt `elsewhere_gross_eur` und die Netto-Variante kommt daneben. Ein
Name, eine Formel.

### O10 — Dünne Slots liefern rauschende Bandenden

**Beleg.** `engine/config.py`: `train_days=42`, `min_slot_days=7`; die Bänder
kommen aus dem Residuen-Tagesblock-Bootstrap mit `bootstrap_samples=2000`,
veröffentlicht werden `q025`/`q975` (`app/model_jobs.py:62`).

**Wirkung.** Ein Slot, der die Mindeststützung gerade so erreicht (7 von 42
Tagen), zieht seine 97,5-Prozent-Quantile aus wenigen Tagesblöcken — effektiv
rund 7 × 12 = 83 Block-Residuen je Horizontschritt. Die Mitte (q50) ist
robust, die Enden sind es nicht: Das Band ist dort am breitesten, wo die
Daten am dünnsten sind, also genau dann, wenn es am wenigsten aussagt. In der
GUI sieht das Band aber überall gleich vertrauenswürdig aus.

**DoD.** Die Stützung mitveröffentlichen (Anzahl Tage je Slot, `counts` gibt
es in `engine/selection.py` bereits) und in der GUI zeigen: dünne Slots
bekommen ein gestricheltes Band oder einen Hinweis, statt desselben Bands.
Zusätzlich die Quantilsgrenzen auf ganze 0,1 ct runden — ein Band, das auf
drei Nachkommastellen rauscht, behauptet Präzision, die nicht da ist.

### O11 — Die Heatmap bewertet sich mit eigenen Preisen

**Beleg.** `app/heatmap.py` bildet die Cheap-Probability aus dem Median über
die Zellen **einschließlich** der eigenen Preise; `reference_counts` und
`counts` werden mitgeliefert. `engine/selection.py` kennt `_loo_baseline`
(leave-one-out) und nutzt es für das δ̂-Ranking.

**Wirkung.** Eine Station, die fast immer billig ist, zieht den
Vergleichs-Median nach unten und erscheint dadurch weniger oft als „günstig“
— eine Station, die selten billig ist, hebt den Median und wirkt besser, als
sie ist. Die Heatmap beantwortet also „wie oft war diese Zelle unter dem
Median aller Stationen inklusive mir“, während die Selektion dieselbe Frage
leave-one-out beantwortet. Zwei Antworten auf eine Frage in zwei Ansichten.

**DoD.** Die Heatmap rechnet den LOO-Median (Muster aus
`engine/selection.py:_loo_baseline`), oder sie heißt in der GUI eindeutig
„Anteil unter dem Gesamtmedian“. Die GUI-Thinning-Regel
(`reference_counts`) bleibt davon unberührt.

### O12 — Die Fenstersterne haben keine Basisrate

**Beleg.** `web/src/week.ts:58–65` (`windowStars`): feste Schwellen 75/55/35
Prozent. Die Größe dahinter ist `window_p` (`app/pside.py:44–77`):
`P(Fenster-Minimum ≤ Minimum der ±6-h-Nachbarschaft)`, also ein Vergleich
gegen bis zu sechs Nachbarblöcke — unter `SURROUNDING_HOURS = 6.0` und
`block_hours = 2.0`. Am Rand des Horizonts schrumpft die Nachbarschaft
(`pside.py:59–63`, „am Rand wird das Umfeld entsprechend abgeschnitten“), und
der Horizont beginnt heute um 12 Uhr (`engine/config.py:decision_hour`).

**Messung.** Am Demo-Stapel (6 Stationen, 200 Draws, synthetische 70 Tage,
`ops/quality/demo_data.py`) über alle 85 Blöcke der 7-Tage-Draws:
`p`-Median **0,018**, Mittel 0,285, Maximum 1,000. Sterne-Verteilung:
**70 Blöcke mit 0 Sternen, 1 Block mit 1 Stern, 14 Blöcke mit 3 Sternen, kein
einziger mit 2**. Die mittleren Sprossen der Leiter sind in der Praxis tot —
das Raster ist faktisch binär. Dazu der Randeffekt: Block 0 hat 3
Konkurrenten (Basisrate 1/4 = 0,25), Block 3 hat 6 (Basisrate 1/7 = 0,14),
gemessene `p` 0,307 bzw. 0,349 — dieselbe Fensterqualität bekommt am Rand
also eine um den Faktor 1,8 höhere Wahrscheinlichkeit zugesprochen. Und
zwar betrifft die linke Kante genau **die heutigen Fenster**, die einzigen,
die man noch nutzen kann.

**Wirkung.** Die absolute Schwelle 35 % liegt über der Basisrate 14 % für
mittlere Blöcke, aber unter der Basisrate 25 % für Randblöcke. Ein Stern
bedeutet deshalb je Position im Horizont etwas anderes. Umgekehrt kann das
billigste Fenster der Woche 0 Sterne zeigen, weil ein Nachbarblock billiger
ist, der kein Kandidatenfenster ist.

**DoD.** `p` gegen seine Basisrate normieren (z. B. `p_norm = p · (k+1)` mit
`k` = Anzahl Konkurrenten, oder `p` als Quantil über alle Blöcke desselben
Horizonts ausdrücken) und die Sterne auf die normierte Größe legen — oder
die Nachbarschaft am Rand ergänzen statt abzuschneiden. Zusätzlich die
Leiter an die Verteilung anpassen: Mit dem gemessenen Verlauf ist eine
zweistufige Anzeige („Lokaltief ja/nein“ plus Preisabstand) ehrlicher als
vier Sprossen, von denen zwei nie erreicht werden. Ein Test, der `p` für
Rand- und Mittelblöcke bei identischer Datenlage vergleicht, hält den
Randeffekt fest.

### O13 — Die Laborbilanz ist zweimal dieselbe Zahl

**Beleg.** `app/stats_summary.py:129–143` (`_score_rows`, „Server-Spiegel von
`web/src/data.ts` scoreRows“) liefert `sum_best_eur` und `sum_always_eur`;
`web/src/views/Labor.tsx` zeigt beide in der Bilanz.

**Wirkung.** `sum_best` ist die Summe der jeweils besten Tageswahl,
`sum_always` die Summe derselben Wahl unter einer anderen Bezeichnung — in
der gebauten Fassung degenerieren beide auf dieselbe Größe, die Beschriftung
verspricht aber einen Vergleich („beste Wahl“ gegen „immer dieselbe
Station“). Eine Kennzahl, die gegen sich selbst null ergibt, liest sich wie
ein Ergebnis.

**DoD.** Entweder `sum_always` wirklich als „immer die Haus-Station“ rechnen
(dann ist der Abstand zu `sum_best` eine Aussage) oder die Zeile entfällt.
Die dritte Variante — `hit_freq` mit `s > 0` bei θ = 1 ct — braucht dieselbe
Klärung wie O7: `s > 0` ist nicht „mindestens 1 ct besser“.

### O14 — Umwegkilometer sind drei verschiedene Größen

**Beleg.** `app/data.py:246–300` und `:395–467` (`driving_km`,
`_build_station_metadata`): `dist_km` ist entweder OSRM-Straßenkilometer oder
rohe Luftlinie; `dist_mode` wird mitgeliefert, downstream aber nicht
ausgewertet. `app/decide.py:405–447` (`_detour_km`) rechnet einen
Umwegkilometer-Wert mit Pauschalfaktor; `app/route.py` führt eine eigene
Variante; eine Schwelle von 400 (km-Wert im Ausreißerpfad) hängt an einem
abgeleiteten Wert.

**Wirkung.** Dieselbe Feldname `dist_km` trägt je Station eine andere Größe
(Straße vs. Luftlinie), und die Umwegökonomie (`p_lohnt`, O9) multipliziert
darauf. Eine Station mit 3,0 km Luftlinie und 4,4 km Straße wird mit 3,0
gerechnet, eine andere mit echten Straßenkilometern — der Vergleich zwischen
beiden ist nicht mehr dieselbe Einheit. `dist_mode` liegt bereit, wird aber
nicht genutzt, um zu kennzeichnen oder zu vereinheitlichen.

**DoD.** `dist_mode` in der GUI ausweisen („Luftlinie“ vs. „Straße“) und in
der Umwegrechnung nur Straßenkilometer verwenden; wo keine vorliegen, den
Faktor explizit machen (`dist_km_est = luftlinie × CIRCUITY` mit genanntem
Faktor) und nie beide Varianten unter einem Namen führen. Die 400er-Schwelle
auf eine benannte Konstante mit Einheit ziehen.

### O15 — Der Zeitwert kippt um halb fünf

**Beleg.** `app/route.py:165–169` (`_auto_time_value`):
`is_peak = 16.5 <= hour <= 20.0`, dazu `app/route.py:10` als Regeltext:
„0 = Auto (16 €/h Peak 16:30–20:00, sonst 10 €/h)“. Genutzt wird der Wert in
`app/decide.py:732–737` und in `app/pside.py:117`
(`- (detour_km_total / speed) * z_used`).

**Wirkung.** Der Zeitwert springt um 16:30 von 10 auf 16 €/h — ein Sprung um
60 % in einem Summanden der Netto-Rechnung, ohne dass sich an Strecke oder
Preis etwas ändert. Bei 5 km Umweg und 40 km/h sind das 1,25 € gegen 2,00 €,
also 0,75 € Unterschied für dieselbe Fahrt; bei einer knappen Empfehlung
kippt dadurch die Antwort. Ein Nutzer, der um 16:25 und um 16:35 dieselbe
Frage stellt, bekommt unterschiedliche Ergebnisse aus einem Grund, den die
GUI nicht zeigt (`value_of_time_eur_h` steht zwar in der Antwort,
`app/decide.py:1155`, aber ohne Hinweis auf die Stufe).

**DoD.** Entweder linear interpolieren (Zeitwert als Funktion statt Stufe)
oder die Stufe in der Entscheidung erklären („ab 16:30 zählt deine Zeit
höher“). Beides ist besser als ein unsichtbarer Sprung.

## 4. UX und UI

Befunde O16–O21.

### O16 — Der Laborbalken für den Hauspreis bleibt leer

**Beleg.** `web/src/views/Labor.tsx:378–387` baut die Balken aus
`labData?.stationScores` und filtert `Number.isFinite(score.delta_ct)`. Der
Server baut dieselbe Liste in `app/stats_summary.py:223–234` aus
`station_id`, `name`, `brand`, `city`, `mae_ct`, `mase`, `picp_95` plus
`**score` — und `_score_rows` (`:129–143`) liefert `n`, `n_wait`, `hit_wait`,
`n_now`, `hit_now`, `sum_*_eur`, `avg_regret_*`, `p_avg`, `hit_freq`,
`pot_share`. **Kein `delta_ct`.** Der TypeScript-Typ
`BacktestStationScore` (`web/src/data.ts:701–719`) deklariert
`delta_ct: number` als Pflichtfeld.

Gleichzeitig liegt die echte Größe längst im Browser: Labor lädt
`/api/v1/selection` (`web/src/state/overview.tsx:923–929`, nur für
`tab === "labor" || "system"`), und `SelectionStation`
(`web/src/data.ts:284–308`) deklariert `delta_ct`, `ci_lo`, `ci_hi`,
`p_value`, `q_value`, `significant`, `avail`, `best_hour`, `vol_ct`,
`rank_std`. Der Server füllt sie (`engine/selection.py:840–867`:
`delta_ct=d_hat`, `ci_lo`, `ci_hi`, `p_value`, `break_flag`, `break_stat`,
`delta_ew_ct`, `delta_recent5_ct`). Labor nutzt davon genau eine Zeile:
`Auswahl-Set: {selection.data.stations?.length ?? 0} Stationen`
(`Labor.tsx:1221–1223`).

**Wirkung.** Der Balken, der den Hauspreis-Vergleich je Station zeigen soll,
ist dauerhaft leer, und der Leer-Text schiebt es auf die Datenlage statt auf
ein fehlendes Feld. [UI-NEUENTWURF.md](UI-NEUENTWURF.md) Zeilen 588–597
spezifizieren den Hauspreis-Vergleich, [LUECKEN.md](LUECKEN.md) Zeilen 476
und 489 führen δ̂-Auswahl und Stations-Labor als fertig. Kein Test liefert `stationScores`
mit `delta_ct` (kein Fixture in `web/src/views/Labor.test.tsx`,
`web/src/lab.test.ts`, `web/e2e/`), also ist die Suite grün über einem
Diagramm, das nie zeichnet.

**DoD.** Die Balken lesen aus `selection.data.stations` (bereits geladen,
bereits typisiert) statt aus `stationScores`; Konfidenzintervall als
Whisker aus `ci_lo`/`ci_hi`, Signifikanz aus `q_value`/`significant` — das
macht aus einem leeren Balken die informativste Grafik im Labor. Alternativ
`delta_ct` in `stats_summary` ergänzen, dann aber aus derselben Quelle wie
die Selektion (kein zweiter Rechenweg). Dazu: `BacktestStationScore.delta_ct`
optional machen oder entfernen (der Typ lügt heute), und ein Fixture-Test,
der die leere Liste ausschließt.

### O17 — Ein Tipp bucht den Prognosepreis als gezahlten Preis

**Beleg.** `web/src/state/overview.tsx:1085–1106`
(`handleConfirmRecommendedFill`):
`const targetPrice = snap?.expected_price ?? snap?.price_now ?? bestPrice ??
null;` und dann `postFill({ ..., price_paid: targetPrice, source: "prompt" })`.

**Wirkung.** Der schnellste Weg zum Beleg — ein Tipp auf „Ja, wie
empfohlen“ — trägt den **erwarteten** Preis ein, also den Median der
Prognose, nicht den Preis an der Zapfsäule. Damit fließt eine erfundene Zahl
in die Wallet-Bilanz, in `avg_regret`, in `elsewhere_net_eur` (O9) und in
die M7-Kennzahlen (O5, O6). Der Unterschied ist nicht klein: Die Prognose
ist eine 12-Uhr-Projektion, der reale Preis weicht je nach Zeitpunkt und
Station um mehrere ct/L ab — bei 40 L sind das Euro-Beträge je Beleg, und
Belege sind die einzige echte Messgröße der App.

Zusammen mit O1 ergibt sich die ungünstigste Kombination: Der Preis ist
prognostiziert und die Uhrzeit erfunden — beide Größen, aus denen die
Personalisierung lernt, stammen aus dem Modell, nicht aus der Welt.

**DoD.** Der Ein-Tipp-Beleg übernimmt den **aktuellen** Preis der Station
(`price_now`, frischer Poll) und markiert die Herkunft
(`price_source: "live"|"prognose"|"manuell"`); ist kein Live-Preis da, fragt
die Maske nach, statt den Median zu buchen. Die Wallet-Bilanz kennzeichnet
Belege mit Prognosepreis und rechnet sie nicht in die Güte-Kennzahlen — oder
nur in einer zweiten, ausdrücklich so benannten Spalte. Ratchet-Test: ein
prompt-Beleg ohne Live-Preis erzeugt keinen Beleg mit `expected_price`.

### O18 — Vier Laborwerkzeuge sind dauerhaft stumm

**Beleg.** `web/src/views/Labor.tsx` zeigt ε-Scan, Modellvergleich,
Top-3-Auswahl und CUSUM; die zugehörigen Felder kommen aus
`/api/v1/stats/summary` bzw. `/api/v1/selection`, und die Labor-Texte
versprechen Besserung mit mehr Daten.

**Wirkung.** Vier Bereiche, die in der Spezifikation Werkstätten sind, zeigen
im Dauerbetrieb „zu wenig Daten“. Für einen einzelnen Nutzer mit einer Stadt
und 11 Stationen ändert sich das nicht von allein — der Text verspricht also
einen Zustand, der nie eintritt. Das ist die teuerste Art von Leerfläche: Sie
kostet Vertrauen, weil sie wie ein Vorwurf an die eigene Nutzung klingt.

**DoD.** Je Werkzeug entscheiden: echte Datenquelle anschließen (CUSUM und
Top-3 liegen in `/api/v1/selection` bereit, siehe O16 — `break_flag`,
`break_stat`, `rank_std`), oder den Bereich entfernen, oder den Text auf den
Dauerzustand umstellen („Diese Werkstatt braucht mehrere Städte; für dein Set
ist sie abgeschaltet“). Nichts davon ist aufwendig — nur die aktuelle Mischung
ist es, weil sie jedes Mal neu erklärt werden muss.

### O19 — Die Ersparnis rechnet gegen die teuerste Station

**Beleg.** `web/src/now.ts` (`nowBestNow`) bildet die Ersparnis in € gegen
die teuerste Station im Set.

**Wirkung.** „Du sparst 3,20 €“ ist wahr, aber gegen eine Referenz, die
niemand wählen würde: Die teuerste Station ist kein Handlungsmaßstab. Der
ehrliche Vergleich ist die Haus-Station (Profil) oder der Jetzt-Preis an der
nächstgelegenen — beides Größen, die die Entscheidung selbst nutzt
(`p_lohnt` rechnet gegen `ref_nowcast`). So steht neben einer netto
gerechneten Entscheidung eine brutto gegen den Maximalwert gerechnete
Ersparnis, und die große Zahl gewinnt die Aufmerksamkeit.

**DoD.** Ersparnis gegen die im Profil hinterlegte Referenz (Haus-Station
oder „jetzt tanken“), mit der Referenz im Kleingedruckten benannt. Die
Spanne „billigste bis teuerste“ darf daneben stehen — aber als Spanne, nicht
als persönliche Ersparnis.

### O20 — Der Tagesstreifen färbt rückwirkend um

**Beleg.** `web/src/strip.ts:1–83`: Die Tonlagen der Stunden werden relativ
zum Minimum und Maximum **des Tages** gebildet; `byHour.set` überschreibt den
Eintrag je Stunde, also gewinnt die letzte Meldung.

**Wirkung.** Zwei Effekte, die zusammenkommen: (a) Kommt um 18 Uhr ein
günstigerer Preis dazu, ändert sich die Farbskala des ganzen Tages — alle
bisherigen Stunden werden heller, obwohl sich an ihnen nichts geändert hat.
Ein Nutzer, der morgens gesehen hat „10 Uhr war dunkel = billig“, findet
abends dieselbe Stunde heller vor. (b) Innerhalb einer Stunde zählt nur die
letzte Meldung, nicht die beste — der Streifen zeigt also „Stand am Ende der
Stunde“, während die Fenstersuche das Minimum der Stunde nutzt.

**Abgrenzung zu 0.43.2.** Dort ist der Streifen als Layout-Befund behandelt
(„Tagesstreifen auf einer Linie“: feste 12-px-Spur, Spaltenzahl nach Breite,
Ratchet in `web/src/a11y.test.ts`, Geometrie-Messung in `e2e/demo.spec.ts`).
Das ist erledigt und wird hier nicht wiederholt. Unverändert ist die
Tonlagen-Berechnung selbst: `web/src/strip.ts` wurde in 0.43.2 nicht
angefasst, also gilt der Befund zur relativen Skala und zum Überschreiben je
Stunde weiter.

**DoD.** Feste Farbskala über einen definierten Bezugszeitraum (z. B. die
letzten 7 Tage oder das Profilband) statt Tages-Min/Max, damit Farben
bedeutungsstabil bleiben; und je Stunde das Minimum speichern (`byHour` mit
`Math.min` statt `set`), damit Streifen und Fenstersuche dieselbe Größe
zeigen. Beides ist in `strip.test.ts` als Ratchet festhaltbar.

### O21 — Das Scoring lebt doppelt und der Server entscheidet mit

**Beleg.** `app/stats_summary.py:83` sagt es selbst: „Server-Spiegel von
`web/src/data.ts` scoreRows (gleiche Formeln)“. Die GUI hat eigene
Score-Funktionen (`web/src/data.ts`, `web/src/stations.ts`), und der Server rechnet mit
festen Werten (`stats_summary.py:177–178`: `default_eps = 1.0`,
`default_liters = 40.0`), während die GUI das aktive Profil nutzt. Die
Parameter stehen sogar in der Antwort (`stats_summary.py:257–258`,
`defaultEps`/`defaultLiters`, Typ in `web/src/data.ts:760–761`) — gelesen
werden sie nirgends: `web/src/Dashboard.tsx:437` gibt der Ansicht
`defaultLiters={liters}` aus dem Profil mit, und `web/src/views/Jetzt.tsx:555`
zeigt „Profil: … L“. Derselbe Name bedeutet also einmal 40 L fest und einmal
die persönliche Tankmenge.

**Wirkung.** Jede Formeländerung muss an zwei Stellen passieren, sonst
weichen Labor (Server) und Jetzt/Woche (GUI) voneinander ab — und O13 zeigt,
dass das bereits passiert ist. Dazu: Die Server-Kennzahlen gelten für 40 L
und ein festes ε, die GUI-Anzeige für die persönliche Tankmenge. Zwei Zahlen
nebeneinander, die nicht dieselbe Frage beantworten, ohne dass irgendwo steht,
wofür welche gilt.

Dritte Baustelle derselben Art: die Tankmenge. Das Profil erlaubt 10–100 L
(`app/profiles.py:50`, Default 40 in `:58`), der Server-Score rechnet fest
mit 40 L (`stats_summary.py:178`), und die Selektion rechnet ihre
Euro-Kennzahlen mit `SelectionConfig.tank_volume = 40.0`
(`engine/selection.py:35`, `:912–913`) — `app/selection.py:135–143` baut die
Konfiguration, ohne `tank_volume` aus dem Profil zu übergeben.
`saving_per_fill_eur` wird also für 40 L publiziert, egal was im Profil
steht, und die GUI liest das Feld nirgends (kein Treffer in `web/src`).

**DoD.** Eine Quelle: Der Server rechnet die Scores und liefert sie, die GUI
zeigt sie (oder umgekehrt — aber nicht beides). Die Tankmenge gehört dazu:
ein Wert aus dem Profil, durchgereicht bis in `SelectionConfig`, und die
Parameter je Score-Block mitgeliefert (`liters`, `eps`) plus angezeigt, wofür
die Zahl gilt. Ein Test, der beide Implementierungen mit denselben Eingaben
vergleicht, fängt die Drift ein, solange sie doppelt leben; ein zweiter, der
eine Profiländerung auf 60 L durch Score und Selektion verfolgt, fängt die
Tankmenge.

## 5. Technik und Betrieb

Befunde O22–O28.

### O22 — Die Veröffentlichung passt nicht mehr durch das Leselimit

**Beleg.** `app/data.py:304–310`:

```python
def read_json(path, default=None):
    try:
        if path.stat().st_size > 10_000_000:
            return default
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return default
```

`publication()` (`app/data.py:505–507`) ruft das mit `default={}`.
Geschrieben wird die Veröffentlichung in `app/refresh.py:605–620` über
`engine/storage.write_json` (`engine/storage.py:28–50`) mit
`indent=2`, ohne Größenprüfung danach; der Job meldet
`state: "success"`, wenn keine Fits fehlgeschlagen sind (`refresh.py:655`).
Die Zeile je Station enthält `points` (288 Zeilen), `points_3d` (864),
`points_7d` (2016) mit je sechs Schlüsseln (`app/model_jobs.py:62`,
`_records:294–300`), dazu `draws_24h` und `draws_7d` mit je 500
Draw-Zeilen (`model_jobs.py:324`, `engine/probabilities.py:29`
`DECISION_DRAWS = 500`) — und beide weiten Horizonte werden für **jede**
Station unbedingt gerechnet (`refresh.py:358–359`).

**Messung.** Eine Station mit Produktionskonfiguration
(`bootstrap_samples=2000`, `train_days=42`, 70 Tage synthetische Beobachtung,
Originalfunktionen `_records`/`_draws`):

| Fassung | Größe je Reihe | 5 Stationen | 11 Stationen |
|---|---|---|---|
| `indent=2` (so schreibt `write_json`) | **1,88 MB** | 9,4 MB | **20,6 MB** |
| kompakt (ohne `indent`) | 1,32 MB | 6,6 MB | 14,5 MB |
| kompakt + auf 4 Nachkommastellen gerundet | 0,75 MB | 3,8 MB | 8,3 MB |

Zum Vergleich der Demo-Stapel: 6 Stationen, 200 Draws, kompakt geschrieben
(`ops/quality/demo_data.py:337–338`) — **4,14 MB**, also schon 41 % des
Limits, aber weit genug darunter, dass keine Suite die Klippe sieht.
[ANALYSE.md](ANALYSE.md) Zeile 135 nennt die echte Konfiguration:
**m = 11 Stationen**, B = 2000 fest.

**Wirkung.** Bei etwa **5 Stationen** ist das Limit erreicht, bei den 11 des
Produktionssets läge die Datei bei rund 20 MB. `read_json` gibt dann `{}`
zurück — und `{}` ist überall der normale „noch keine Daten“-Zustand: keine
Prognosen, keine Fenster, keine Laborwerte, keine Gütekacheln, während
`/api/v1/jobs/models/log` Erfolg meldet und kein Alarm ausgelöst wird. Der
Alarm-Katalog (`app/alarms.py:54–251`) kennt `store_too_large` und
`store_growing` für den persönlichen Speicher, `job_failed`, `job_partial`,
`stations_dead`, `price_twins` — aber nichts für „Veröffentlichung zu groß
oder unlesbar“. Dieselbe stille Größenprüfung steht an vier weiteren Stellen
(`app/collector_status.py:31`, `app/alarms.py:167`, `app/profiles.py:162`,
`app/feedback.py:38`), also ist es Hauskonvention — nur ohne Hausmeldung.

Ob die Datei auf deinem NAS heute schon darüber liegt, zeigt ein Befehl:
`du -h data/runtime/engine/current.json`. Liegt sie darunter, ist der Befund
trotzdem gültig: Er ist eine Stationszahl oder eine Konfigurationsänderung
entfernt — und B22 („Bootstrap-Samples erhöhen“) ändert die Größe nicht
(die Veröffentlichung kappt bei 500 Draws), wohl aber jede zusätzliche
Station im Polling-Set.

**DoD.** Vier Maßnahmen, die zusammenwirken und einzeln schon helfen:
(a) **Laut werden** — nach dem Schreiben die Größe prüfen und bei über
einem Budget (z. B. 6 MB) einen Alarm `publication_large` auslösen, bei
über dem Leselimit einen Fehler `publication_unreadable` mit dem Grund;
`read_json` bekommt für die Veröffentlichung einen Pfad, der „zu groß“ von
„nicht da“ unterscheidet. (b) **Kompakt schreiben** — `indent=2` nur für
kleine, menschenlesbare Artefakte; gemessen −29 %. (c) **Runden** — vier
Nachkommastellen bei Preisen und Quantilen, gemessen −43 % gegenüber
kompakt; Preise haben zwei Stellen, Quantile brauchen keine sechs.
(d) **Aufteilen** — je Kraftstoff und Station eine Datei plus ein kleines
`current.json` als Index (Muster existiert: `refresh.py:637–646` schreibt die
Selektion bereits je Kraftstoff **und** kombiniert). Damit fällt die Klippe
weg und `/forecast` lädt nur, was die Ansicht braucht. Ein Test, der die
Größe einer Veröffentlichung mit Produktionsparametern begrenzt (z. B. unter
8 MB bei 11 Stationen), macht die Klippe zu einem roten Build statt zu einem
stummen Nachmittag.

### O23 — Der Healthcheck parst die Veröffentlichung alle 30 Sekunden

**Beleg.** `ops/nas/app/Dockerfile:26–27`:
`HEALTHCHECK --interval=30s --timeout=5s … urlopen('http://127.0.0.1:1355/api/v1/health')`.
`health()` (`app/data.py:906–918`) ruft `publication(self.settings)` (`:917`)
und `selection_publication(self.settings)` (`:918`) — beide gehen durch
`read_json`, also stat + read_text + `json.loads` über die komplette Datei.
Dazu kommt die GUI (`web/src/data.ts:34`, `:135`), die `/api/v1/health`
pollt, und `/api/v1/stats/summary`, das die Veröffentlichung über den
Provider (`app/data.py:539`) **dreimal** parst:
`_build_backtest_from_publication` (`stats_summary.py:149`),
`_quality_metrics_from_publication` (`:287`),
`_live_phase_from_publication` (`:348`). Weitere Leser:
`app/data.py:1056`, `:1099`, `:1845`, `app/decide.py:828`.

**Messung.** Ein Parse der Veröffentlichung in Demo-Größe (4,14 MB) kostet
auf dieser Maschine rund **175 ms**; mit einer 20-MB-Datei (O22) skaliert das
linear in Richtung einer Sekunde je Parse. Der Healthcheck läuft alle 30
Sekunden, also zwei Parses je Durchlauf, dauerhaft, auch nachts, auch während
ein Modell-Job rechnet.

**Wirkung.** Dieselbe Datei wird mehrfach je Anfrage und zweimal je
Healthcheck komplett geparst — auf dem Gerät, das nebenbei die Modelle fitet.
Der Kommentar in `health()` („must not depend on InfluxDB response times“)
zeigt, dass die Sorgfalt dem Netzwerk galt; die lokale Parse-Kosten sind
dieselbe Kategorie, nur ungemessen. Das Muster für die Lösung liegt im selben
Modul: `metadata()` ist memoisiert über `_metadata_stamp`
(`app/data.py:318–330`) mit Datei-Stempel statt TTL.

**DoD.** `publication()` und `selection_publication()` memoisieren über
`(mtime, size)` der Datei — ein Parse je Datenstand, nicht je Anfrage; das
ist die `_file_stamp`-Idee aus `data.py:236–237`, die dort bereits für den
ETag genutzt wird. Dazu `/stats/summary` einmal lesen und das Ergebnis an die
drei Baufunktionen durchreichen (der Provider-Mechanismus erlaubt das, ohne
einen circular import einzuführen). Ein Test, der die Parse-Anzahl je
Anfrage zählt, hält den Gewinn fest.

### O24 — Der Server spricht HTTP/1.0

**Beleg.** `app/server.py` setzt kein `protocol_version`; damit gilt der
Default von `BaseHTTPRequestHandler`, also `HTTP/1.0` — jede Antwort
schließt die Verbindung. `rp2/fallback_gui.py:634` setzt
`protocol_version = "HTTP/1.1"`: Auf dem Pi, dem schwächeren Gerät, ist es
längst richtig.

**Wirkung.** Die GUI lädt je Ansicht mehrere Ressourcen
(`/api/v1/overview`, `/decide`, `/stations`, `/heatmap`, `/health`,
`/selection`, …). Ohne Keep-Alive zahlt jede Anfrage einen neuen
TCP-Handshake plus TLS-freien Neuaufbau, und der Browser kann Verbindungen
nicht wiederverwenden. Im LAN sind das Millisekunden je Anfrage — aber es
ist die billigste Latenz im ganzen System, und HTTP/1.0 verhindert außerdem
sauberes Chunking bei großen Antworten (O22, O25).

**DoD.** `protocol_version = "HTTP/1.1"` in der Handler-Klasse, dazu
`Content-Length` auf allen Pfaden prüfen (Keep-Alive verlangt korrekte
Längen oder `Connection: close` bei Fehlern). Ein Test, der eine zweite
Anfrage auf derselben Verbindung stellt, sichert das Verhalten.

### O25 — Kompression und Revalidierung sind zu teuer und zu selten

**Beleg.** `app/server.py:168`: `gzip.compress(content, compresslevel=6)`.
ETag/304 gibt es nur für `/overview` (`server.py:395–396`, `:455–462`,
`:481–484`, `:574`).

**Messung.** Auf einer Antwort in Veröffentlichungsgröße: Stufe 6 rund
**547 ms**, Stufe 1 rund **122 ms** — Faktor 4,5 bei typischerweise wenigen
Prozent Größenunterschied. Eine große Prognose-Antwort wird also länger
komprimiert als übertragen.

**Wirkung.** Die CPU-Zeit fällt auf dem NAS an, bei jedem Poll, für jede
große Antwort. Und weil Revalidierung nur `/overview` kennt, laden
`/decide`, `/stations`, `/heatmap` und `/stats/summary` jedes Mal komplett —
obwohl sich ihr Datenstand über denselben `_file_stamp`-Mechanismus
(`data.py:236–237`) ausdrücken ließe, der den ETag bereits trägt.

**DoD.** `compresslevel=1` (oder `zlib`-Stufe 1) für API-Antworten, Stufe 6
nur für statische Assets, die selten gebaut werden; ETag/304 auf alle
read-only-Endpunkte ausweiten, die einen Datenstempel haben. Beides zusammen
nimmt dem NAS-Poll den größten Teil seiner Kosten. Messwert für
[QUALITAET.md](QUALITAET.md) nachziehen, damit das Budget nicht nur im
Browser steht.

### O26 — Jeder Decide-Poll nimmt die Schreibsperre

**Beleg.** `app/feedback.py:451–520` (`record_snapshot`): `locked_store`
wird bei jedem Aufruf genommen, der Schreibverzicht gilt nur bei
`_same_advice` — die Sperre bleibt. `GET /decide` löst einen Snapshot aus
(`app/decide.py`, Snapshot am Ende von `evaluate_decide`), und die GUI pollt
`/decide`.

**Wirkung.** Ein reiner Lesepfad nimmt eine exklusive Sperre auf den
persönlichen Speicher. Auf einem Ein-Nutzer-System ist der Konflikt selten —
aber wenn er auftritt, dann genau dann, wenn ein Beleg gebucht wird
(Schreibpfad) und die GUI gleichzeitig pollt: Der Beleg wartet hinter einem
Poll, der nichts schreibt. Zusammen mit O24 (neue Verbindung je Anfrage) und
O23 (mehrfache Parses) summiert sich das zu spürbarer Latenz beim Buchen.

**DoD.** Snapshot-Schreiben nur bei echter Änderung versuchen (Sperre erst
nach dem `_same_advice`-Check, oder optimistisch: lesen ohne Sperre,
schreiben mit Sperre und erneuter Prüfung). Der Poll-Pfad bleibt damit
sperrenfrei.

### O27 — Bild und Pipeline bauen gegen andere Versionen

**Beleg.** Das Laufzeitbild nutzt `python:3.14-slim` bzw. Node 26
(`ops/nas/app/Dockerfile`), die Pipeline prüft gegen Python 3.11/3.12
(`.github/workflows/`), und `web/package.json` hat kein `engines`-Feld.

**Wirkung.** Was grün getestet ist, läuft auf einer anderen
Interpreter-Version als die, die gebaut und getestet wurde. Bei einer
Anwendung, die `BaseHTTPRequestHandler`, `zoneinfo`, numpy/pandas und einen
Vite-Baum benutzt, sind das genau die Stellen, an denen Minor-Versionen
Unterschiede machen (DeprecationWarnings werden zu Fehlern,
`datetime`-Formatierung, `zoneinfo`-Datenstand). Dazu kommt die
All-NaN-Warnung in O28, die von solchen Versionswechseln typischerweise
sichtbarer wird.

**DoD.** Bild und Pipeline auf dieselbe Python- und Node-Linie ziehen
(entweder das Bild zurück oder die Pipeline hoch), `engines` in
`web/package.json` festhalten, und im Bild denselben `zoneinfo`-Datenstand
wie in der Pipeline sichern (`tzdata`-Paket). Ein Pipeline-Job, der das Bild
baut und die Suite **im Bild** laufen lässt, macht den Unterschied unmöglich.

### O28 — Kleine Unehrlichkeiten in Kommentar und Laufzeit

**Beleg.** (a) `engine/selection.py:763` (`P[:, hi] = np.nanmean(...)`)
erzeugt eine All-NaN-`RuntimeWarning`, wenn eine Stunde keinen verwertbaren
Wert hat — der Pfad ist erwartbar (Nachtzellen, tote Stationen), die Warnung
erscheint trotzdem: Der letzte Suite-Lauf zeigt sie in 18 Warnungen über
`tests/test_selection.py` und `tests/test_lifecycle_twins.py`. (b) `engine/probabilities.py:16` sagt,
die gemeinsame Ziehung über Stationen sei „noch nicht umgesetzt“, und
`app/pside.py:98–99` nennt sie „Abweichung (dokumentiert)“ — A11 ist
umgesetzt, und `_draws` weist es sogar aus (`app/model_jobs.py:311–312`: „`shared` sagt, ob
die Tagesblöcke stationsübergreifend gemeinsam gezogen wurden (A11)“).
(c) Die Demo-Veröffentlichung wird mit `json.dumps` ohne `allow_nan=False`
geschrieben (`ops/quality/demo_data.py:337–338`) und enthält gemessen
**51 480 `NaN`-Token** — für Python lesbar, für `jq` und jeden Browser-Parser
ungültig. Die Produktion ist sauber (`write_json` mit `json_safe`,
`engine/storage.py:41–43`), aber [STATIONEN-TAUSCH.md](STATIONEN-TAUSCH.md)
Zeile 293 empfiehlt genau `jq '.failures' data/runtime/engine/current.json`.

**Wirkung.** Drei kleine Stellen, an denen Code und Kommentar auseinander
laufen — dieselbe Kategorie wie O5, nur ohne Rechenschaft. Die
`NaN`-Datei ist praktisch: Wer die Anleitung am Demo-Stapel nachfährt,
bekommt einen Parser-Fehler und hält ihn für einen eigenen.

**DoD.** Docstrings an A11 anpassen; die All-NaN-Warnung in einen
erwartbaren Zweig mit `warnings.catch_warnings` oder eine explizite
`np.errstate`-Behandlung legen; `demo_data.py` schreibt über `write_json`
(dieselbe Funktion wie die Produktion — das ist der eigentliche Wert: Demo
und Produktion erzeugen dann byte-gleiche Strukturen).

## 6. Kundensicht

Der Nutzer ist eine Person, das Netz ist ein LAN, Anmeldung ist bewusst nicht
vorgesehen ([../TODO.md](../TODO.md), Rahmenbedingungen). Befunde O29–O32
sind deshalb aus der Perspektive „was fehlt mir im Alltag“ formuliert.

### O29 — Kein Hinweis wenn das Fenster aufgeht

**Beleg.** `app/notify.py` (ntfy-Kanal) ist vorhanden und wird für
Alarme genutzt (`app/alarms.py` baut die Meldungen, die GUI zeigt sie);
die Fenstersuche kennt Beginn und Ende des empfohlenen Fensters
(`app/decide.py:1088–1102`, `windows_today` mit `start`/`end`/`p`).
[LUECKEN.md](LUECKEN.md) Zeile 510 führt Preis-Push als bewusst offen
(„der Versand braucht eine Entscheidung, wer wann was aufs Handy bekommt“),
Zeile 498 als offenen Punkt der Produkt-KPIs.

**Wirkung.** Die App rechnet aus, wann es günstig wird — und sagt es niemandem.
Der Nutzer muss selbst nachsehen, und zwar genau dann, wenn er Zeit hat: Das
ist die einzige Anwendung, bei der ein 24/7-Gerät (Pi) und ein gerechnetes
Zeitfenster zusammenkommen, ohne dass etwas passiert. Für einen einzelnen
Nutzer ist die Regel, die sonst schwer ist („wen benachrichtigen, wie oft,
mit welcher Schwelle“), trivial: eine Person, eine Meldung je Fenster.

**DoD.** Eine Meldung über den bestehenden Kanal, wenn (a) ein Fenster mit
ausreichendem `p` öffnet, (b) es schließt, ohne genutzt worden zu sein, oder
(c) die Empfehlung kippt (anderes Fenster wird besser). Entduplizierung über
die Episode (`decide.py:1103–1108` liefert `episode.id`), Ruhezeiten aus dem
Profil, und derselbe Text wie in der GUI (MICROCOPY-Regel: Zahlen über
Formatter). Das ist kein neues Subsystem — es ist `notify.py` plus ein
Auslöser, den es schon gibt.

### O30 — Die Bilanz zeigt brutto was netto gemeint ist

**Beleg.** Wie O9, aus Nutzersicht: Die Wallet-Bilanz
(`app/feedback.py`, `compute_wallet_stats`) weist Ersparnis ohne Umwegkosten
aus; die Empfehlung rechnet netto (`app/pside.py:85–110`).

**Wirkung.** „Du hast diesen Monat 14,20 € gespart“ steht neben Entscheidungen,
die derselbe Nutzer mit Umwegkosten getroffen hat. Wer 3 km Umweg fährt, zahlt
rund 0,50–1 € an Sprit und Zeit — bei vier Tankvorgängen im Monat sind das
2–4 € von 14,20 €, also ein Siebtel bis ein Viertel der ausgewiesenen
Ersparnis. Die Zahl ist nicht falsch, aber sie ist nicht die, nach der
entschieden wurde.

**DoD.** Zwei Zeilen in der Bilanz: brutto und netto nach Umweg, mit dem
Zeitwert des Profils — oder eine Zeile netto und die Bruttozahl als
Aufschlüsselung dahinter. Dieselbe Formel wie `p_lohnt`, dieselben Parameter
wie im Profil (O21).

### O31 — Die Woche endet ohne Zusammenfassung

**Beleg.** Es gibt ein Tagebuch (`GET /api/v1/advice/diary`,
`web/src/views/Labor.tsx:389–395`) und Monats-/Jahresbilanzen
(`GET /api/v1/fills/summary`, `web/src/data.ts:518`), aber keine
wöchentliche Meldung.

**Wirkung.** Der Lernfortschritt der App — wie oft die Empfehlung passte, wie
sich `w(h)` verändert hat, welche Station sich verbessert hat — ist in
Einzelsichten verteilt. Für einen einzelnen Nutzer ist die Woche die
natürliche Einheit: sieben Tage, ein Tankvorgang, eine Abrechnung. Ohne
Zusammenfassung bleibt das Gefühl „die App empfiehlt irgendwas“, statt
„die App hat diese Woche dreimal richtig und einmal falsch gelegen“.

**DoD.** Eine Wochenmeldung über den Kanal aus O29, Inhalt aus vorhandenen
Größen: abgerechnete Empfehlungen (Treffer/Kulanz/Fehler je nach O8),
beste und schlechteste Station nach δ̂-Änderung (`delta_recent5_ct` liegt in
`engine/selection.py:854` bereit), Datenqualität (Aussetzer, Coverage),
Lernstand (`n` Belege, Personalisierung aktiv ja/nein). Keine neue Rechnung,
nur eine Zusammenfassung dessen, was schon da ist — und ein Ratchet, dass die
Zahlen über Formatter laufen.

### O32 — Die Belegmaske zeigt den Live-Preis nicht

**Beleg.** Die Belegmaske übernimmt einen Preis aus dem Snapshot
(`web/src/state/overview.tsx:1088–1089`, O17) und zeigt ihn im Feld; der aktuelle
Preis derselben Station liegt in `/api/v1/stations` vor.

**Wirkung.** Zwischen Empfehlung und Erfassung vergehen Minuten bis Stunden
(Offline-Queue: `web/src/data.ts:1207`, `:1212`). Der Nutzer sieht im
Preisfeld eine Zahl, die alt sein kann, und hat keinen Vergleich — also
entweder tippt er blind ab oder er sucht die Anzeige der Station, was zwei
Wege sind, wo einer genügt.

**DoD.** Neben dem Preisfeld der Live-Preis derselben Station mit Zeitstempel
(„jetzt 1,719 €/L, vor 3 min“), Abweichung markiert, wenn sie über einer
kleinen Schwelle liegt (Muster: `app/thresholds.py:noise_band`). Bleibt das
Feld vorbefüllt, sagt die Maske wenigstens, wofür.

## 7. Dimensionen, die in der Aufzählung fehlten

Die Ausgangsfrage nannte fünf Dimensionen (mathematisch, statistisch, UX, UI,
technisch) plus die Kundensicht. Zwölf weitere habe ich danach geprüft — mit
demselben Maßstab: Beleg am Code, kein Verdacht. Vier davon sind im
Wesentlichen erledigt und stehen deshalb in [9](#9-was-schon-richtig-ist),
acht haben Befunde ergeben (O33–O42).

| Dimension | Ergebnis der Prüfung |
|---|---|
| Datenhaltbarkeit und Backup | Befund [O33](#o33--die-backup-alterung-bleibt-unsichtbar), [O34](#o34--historie-und-archiv-haben-keine-aufbewahrungsregel): Ablauf und Restore-Übung sind vorbildlich dokumentiert, aber das Altern der Sicherung ist unsichtbar und alles liegt auf einem Gerät |
| Datenintegrität am Eintritt | Befund [O35](#o35--live-preise-kennen-keine-plausibilitätsgrenze): Der Trainingspfad filtert vorbildlich (Grenzen plus Hampel), der Live-Pfad nicht |
| Konfigurations-Kohärenz | Befund [O36](#o36--vier-konfigurationsflächen-und-eine-zahl-als-literal): vier Flächen, teilweise manuell kopiert, eine statistisch begründete Zahl als Literal |
| Beobachtbarkeit | Befund [O37](#o37--der-server-misst-sich-selbst-nicht): Alarm-Katalog stark, aber keine Latenz- oder Parse-Metriken |
| Wirkungsmessung (Outcome) | Befund [O38](#o38--verstrichene-fenster-sind-unsichtbar): Die App kann nicht sagen, wie oft ein gutes Fenster ungenutzt verstrichen ist; dazu wäre die Referenz aus O13/O30 nötig |
| Zugriff und Exposition im LAN | Befund [O39](#o39--das-ledger-ist-im-lan-für-alle-lesbar): Lesen ist ungeschützt, Schreiben hat ein Budget, ein Token-Mechanismus existiert bereits |
| Datenschutz bei externen Kanälen | Befund [O42](#o42--der-push-grundsatz-kollidiert-mit-dem-preis-push): Der Grundsatz in `notify.py` ist stark, kollidiert aber mit dem Preis-Push aus O29 |
| Barrierefreiheit | Befund [O40](#o40--die-diagramm-textalternative-nennt-keine-werte) als Rest: Grundlagen (Kontrast AA, Typografie-Ratchet, 44-px-Ziele, `role="img"` plus `<desc>`, `aria-live`, `prefers-reduced-motion`) sind gebaut und getestet |
| Wartbarkeit und Struktur | Befund [O41](#o41--drei-normalisierungswege-für-ein-artefakt) plus O21: doppelte und dreifache Implementierungen, große Module (`app/data.py` 1911 Zeilen, `web/src/data.ts` 3727, `rp2/fallback_gui.py` 3000) |
| Recht und Lizenz | **Kein Befund.** Die GUI nennt Quelle und Lizenz samt Abfrage-Regel (`web/src/Dashboard.tsx:615`: „Markttransparenzstelle für Kraftstoffe (MTS-K) über tankerkoenig.de — Lizenz CC BY 4.0 · Abfrage höchstens alle 5 Minuten“), `web/src/views/Settings.tsx:722` ebenso; Privatdaten und Schlüssel sind gitignored (`.gitignore`: `data/`, `polling.json`, `*.netrc`, `config.local.json`) |
| Zeit, DST, Uhr | **Kein Befund.** `engine/data.py:237` (`local_day_hours`) und `:257` (`dst_transition_days`) behandeln Umstellungstage, der Backtest weist sie aus (H5), und `tanked_at` wird serverseitig validiert (`app/feedback.py:736–751`, `invalid_tanked_at` als 400) — O1 kann darauf aufbauen |
| Sicherheit gegen Injection und Pfadzugriff | **Kein Befund.** Statische Auslieferung ist auf `settings.static` beschränkt und prüft `is_relative_to` (`app/server.py:695–696`), Schreib-Endpunkte haben ein Budget mit 429 (`:714–723`), Job-Log-Zeilen gehen durch `redact` (`app/data.py:883`), Fehlermeldungen durch `app/errors.public_detail` |
| Externe Abhängigkeiten und Ausfall | **Kein eigener Befund.** [BETRIEB.md](BETRIEB.md) deckt Collector-, Uploader-, GLIBC- und Preislücken-Fälle breit ab, die Alarm-Codes sind benannt, OSRM ist optional und selbst gehostet (`app/data.py:61–68`) |
| Skalierbarkeit | Läuft auf [O22](#o22--die-veröffentlichung-passt-nicht-mehr-durch-das-leselimit) hinaus: Die Grenze ist nicht die Rechenzeit, sondern die Publikationsgröße |

### O33 — Die Backup-Alterung bleibt unsichtbar

**Beleg.** `ops/nas/backup.sh:25–28` sichert `runtime/` täglich als Tar und
rotiert nach `KEEP_DAYS` (Default 14). Die Preishistorie wird wöchentlich
gesichert (`docs/BETRIEB.md:680–698`), die Pi-Dateien laut Tabelle
(`:651–678`). `BACKUP_DIR` ist „das vorhandene NAS-Backup“
(`ops/nas/backup.sh:16`), liegt also auf demselben Gerät wie die Daten. Der
Alarm-Katalog (`app/alarms.py:54–251`) kennt `collector_stale`, `job_failed`,
`store_too_large`, `stations_dead` — aber keinen Code für Backup.

**Wirkung.** Drei Lagen, die zusammenkommen: (a) Wenn der Cron-Job stirbt
(NAS-Update, Pfad geändert, Volume umbenannt), meldet nichts — der Verlust
fällt erst beim Restore auf. (b) Bei 14 Tagen Rotation ist jeder Stand, der
älter ist als zwei Wochen, weg: Ein Fehler, der langsam zerstört (ein
Wallet-Bug, eine stille Größen-Grenze wie O22), hat alle guten Sicherungen
überlebt, bevor er bemerkt wird. (c) Ein NAS-Ausfall nimmt Daten **und**
Sicherung mit; die einzigen unersetzbaren Bestände — die Tank-Bilanz
(`runtime/feedback/store.json`) und die privaten Anker-Koordinaten in
`polling.json` — haben keine zweite Kopie an einem anderen Ort.

**DoD.** Ein Alarm `backup_stale` (warn), wenn das neueste
`tankapp-runtime-*.tar.gz` älter als 36 Stunden ist — dieselbe Datei-Stat-Logik,
die `alarms.py` bereits für die Selektion nutzt, kein neuer Netz-Zugriff. Dazu
eine Aufbewahrungsregel, die zur Fehlererkennungs-Dauer passt (z. B. 14 Tage
täglich plus 6 Monatsstände), und in `BETRIEB.md` ein zweites Ziel auf einem
anderen Gerät oder Datenträger — ausdrücklich als Entscheidung, wenn es beim
einen Gerät bleiben soll.

### O34 — Historie und Archiv haben keine Aufbewahrungsregel

**Beleg.** Der InfluxDB-Cron in `docs/BETRIEB.md:684–688` schreibt
wöchentlich `influxdb-<datum>.tar.gz` in `ops/nas/influxdb/backup/` — ohne
Rotation (anders als `backup.sh:27–28`). Das Roharchiv (`--archive-dir`,
`docs/BETRIEB.md:285–288`) kommt in keiner Sicherung vor (`grep archive`
über `ops/nas/backup.sh` und `ops/nas/preflight.sh`: kein Treffer).

**Wirkung.** Die Wochen-Snapshots wachsen unbegrenzt und enthalten jeweils
die ganze Historie — nach einem Jahr 52 Kopien desselben Bestands. Das Archiv
dagegen ist die Trainingsgrundlage (`train_days=42`) und per `history-sync`
regenerierbar, aber nur innerhalb der API-Regeln (höchstens alle 5 Minuten,
`web/src/Dashboard.tsx:615`) — ein Wiederaufbau von Monaten kostet also
Tage und Quota. Beides ist keine Katastrophe, aber beides ist eine
ungetroffene Entscheidung.

**DoD.** Rotation für die Wochen-Snapshots (`find … -mtime +N -delete`, wie
in `backup.sh`) und ein Satz in `BETRIEB.md`, der das Archiv bewusst
einordnet: entweder „wird mitgesichert“ oder „bewusst nicht, weil per
`history-sync` regenerierbar — Wiederanlauf dauert X Tage“.

### O35 — Live-Preise kennen keine Plausibilitätsgrenze

**Beleg.** Der Trainingspfad prüft: `engine/data.py:76`
`valid_price = (price.between(0.4, 5.0) & np.isfinite(price))`, dazu
`:78` (Booleans als Preis werden verworfen) und der Hampel-Filter
`:147–168`, angewendet in `:204–205` — dessen Docstring nennt ausdrücklich
„ein API-Artefakt (Einzel-Poll mit falscher Dezimalstelle)“. Dieselben
Grenzen existieren als Konstanten für den Ledger
(`app/feedback.py:33–34`, `MIN_PRICE_PAID = 0.40`, `MAX_PRICE_PAID = 5.00`,
geprüft in `:805`). Der **Live-Pfad** hat nichts davon: `app/data.py:724–780`
(`stations()`) übernimmt `price = float(row["price"])`, filtert nur nach
Alter (≤ 30 min) und `status == "open"`, und sortiert die Liste mit
`key=lambda row: (row["price"] is None, row["price"] or 0, row["name"])`.

**Wirkung.** Ein einziger fehlerhafter API-Wert — 0,05 €/L aus einer
verrutschten Dezimalstelle — erscheint als aktueller Preis, sortiert sich an
die **Spitze** der Stationsliste, wird `bestPrice` und damit Anker der
Entscheidung: Die Empfehlung schickt den Nutzer zu einer Station, deren Preis
die Engine beim nächsten Training als Artefakt verwerfen würde. Die App
verteidigt sich also genau gegen den Fall, den sie selbst dokumentiert —
nur nicht dort, wo entschieden wird.

**DoD.** Dieselben Grenzen wie im Ledger auch in `stations()`: Werte außerhalb
0,40–5,00 €/L werden nicht als `price` veröffentlicht, sondern als
`implausible` gekennzeichnet (Station bleibt sichtbar, ohne Preis, mit Grund),
und die Sortierung überspringt sie. Dazu ein Zähler im Health-Payload und ab
einer kleinen Schwelle ein Alarm `price_implausible` — der Katalog aus
`alarms.py` und das `redact`-Muster sind vorhanden.

### O36 — Vier Konfigurationsflächen und eine Zahl als Literal

**Beleg.** `engine/config.py:9–46` (`Config`: `bootstrap_samples=2000`,
`bootstrap_ew_half_life_days=14.0`, `seed=42`, `step_minutes=5`,
`ffill_minutes=30`, `poll_start/poll_end`, `timezone`, `decision_hour`);
`engine/selection.py:29–57` (`SelectionConfig` mit eigenen Kopien:
`n_boot=2000`, `boot_ew_half_life_days=14.0`, `seed=42`, `step_min=5`,
`ffill_minutes=None`, `poll_start/poll_end`, `timezone`, `tank_volume=40.0`);
`app/config.py` (`Settings`, u. a. `decision_hour` aus
`TANKAPP_DECISION_HOUR`); `analysis/station_selection.py:89` (eigene
`Config` mit `tank_volume`). Verbunden wird das manuell:
`app/selection.py:135–143` übernimmt genau vier Knöpfe aus der
Engine-Konfiguration (`poll_start`, `poll_end`, `timezone`,
`dead_after_days`) — und `app/worker.py:100–104` ruft
`build_selection(settings, fuels=…, n_boot=2000, …)` mit der Zahl **als
Literal im Job-Dispatcher**.

**Wirkung.** `docs/ANALYSE.md:135` begründet B = 2000 statistisch
(„B=200 wäre ein Signifikanzblocker: p_min=1/(B+1) ergibt mit BH und m=11
Stationen q≥0,0547>0,05“) — eine tragende Konstante lebt also als Literal in
einem Worker-Aufruf, während die gleichnamige Engine-Größe
`bootstrap_samples` danebensteht. Wer B22 entscheidet („mehr Samples“) und
`engine/config.py` ändert, bekommt mehr Draws in den Modellen und
**unverändert 2000 in der Selektion** — ohne Fehlermeldung, ohne Hinweis.
`ffill_minutes` weicht heute schon ab (30 gegen `None`), also behandeln
Training und Selektion Lücken unterschiedlich.

**DoD.** Eine Quelle: `SelectionConfig.from_engine_config(cfg)` (oder eine
Fabrikfunktion in `engine/selection.py`), die alle gemeinsamen Knöpfe
übernimmt; `app/worker.py` reicht die Konfiguration durch statt einer Zahl.
Dazu ein Test, der `bootstrap_samples=4000` setzt und assertet, dass die
Selektion mit 4000 rechnet — und ein Ratchet, das Literale wie `n_boot=2000`
im Worker-Pfad verbietet. `ffill_minutes` bekommt einen bewussten Wert mit
Begründung, nicht `None` neben `30`.

### O37 — Der Server misst sich selbst nicht

**Beleg.** `app/server.py` nutzt `time.monotonic()` ausschließlich für
Trigger-Abstände und Budgets (`:146`, `:227`, `:257`, `:348`), ebenso
`app/data.py` für Staleness (`:88`, `:373`, `:584`). Es gibt keine
Antwortzeiten im Health-Payload, keinen `X-Process-Time`-Header, kein
Parse-Zeit-Feld. [QUALITAET.md](QUALITAET.md) führt Budgets für Lighthouse
und den Lastpfad gegen `/api/v1/overview` — also Browser-Seite, gemessen von
Hand.

**Wirkung.** O23 (Healthcheck parst alle 30 Sekunden), O25 (gzip Stufe 6) und
O26 (Sperre im Lesepfad) sind genau die Sorte Problem, die ohne Messung
wiederkommt: Niemand sieht, dass eine Antwort 900 ms braucht, weil eine
Datei gewachsen ist. Die gemessenen Zahlen in diesem Befund entstehen durch
Handmessung in einer Sandbox — auf dem NAS gibt es kein Äquivalent, also
auch keine Frühwarnung, wenn O22 sich langsam anschleicht.

**DoD.** Zwei billige Felder: `X-Process-Time` je Antwort (Header, keine
neue Infrastruktur) und im Health-Payload die letzte Parse-Dauer plus Größe
der Veröffentlichung — damit O22 und O23 sichtbar werden, bevor sie wehtun.
Ein Budget in `QUALITAET.md` (z. B. „/overview p95 < 300 ms im LAN“) und ein
Test, der die Felder erwartet.

### O38 — Verstrichene Fenster sind unsichtbar

**Beleg.** `app/feedback.py:486` und `:583` setzen
`ep["status"] = "expired"`, wenn ein Fenster verstreicht;
`web/src/data.ts:378` deklariert `EpisodeStatus = "open" | "waiting" | "due" |
"resolved" | "expired"`. In den Views kommt `expired` nicht vor (grep über
`web/src/views/*.tsx`: kein Treffer), und das Tagebuch zeigt Settlements
(`GET /api/v1/advice/diary`, `web/src/views/Labor.tsx:389–395`).

**Wirkung.** Die einzige Frage, die für einen einzelnen Nutzer im Alltag
zählt — „hat die App mir geholfen, oder habe ich die Fenster verpasst?“ —
bleibt unbeantwortet, obwohl der Zustand erfasst wird. Sichtbar sind nur die
Fälle, in denen getankt und abgerechnet wurde; die verstrichenen Empfehlungen
verschwinden. Damit fehlt auch die Gegenprobe zur Trefferquote: Eine hohe
Trefferquote bei wenigen Fällen kann bedeuten, dass nur die sicheren Fenster
genutzt wurden. Zusammen mit O13 (degenerierte Referenz) und O30
(brutto statt netto) hat die App derzeit **keine funktionierende
Wirkungsmessung** — drei Befunde, dieselbe Lücke.

**DoD.** Ein Zähler „Fenster verstrichen“ je Woche/Monat in „Ich“ oder
„Labor“, aus vorhandenen Daten (`episode.status`), plus eine Aufschlüsselung
der abgerechneten Fälle gegen die verstrichenen. Wenn O29 (Push) kommt, ist
das dieselbe Größe: „3 von 5 Fenstern genutzt“. Ein Test, der eine Episode
mit `status="expired"` durch die Zusammenfassung verfolgt.

### O39 — Das Ledger ist im LAN für alle lesbar

**Beleg.** `app/server.py:1045` und `:1050` binden `0.0.0.0:1355`. Das
anonyme Lese-Limit wurde in 0.12.0 entfernt (`:404–406`), Schreib-Endpunkte
haben ein Budget mit 429 (`:714–723`), und ein Token-Mechanismus existiert
bereits: `Authorization`-Prüfung für den Webhook (`:811–822`), Konfiguration
über `webhook_token` (`app/config.py:28–29`), dokumentiert in
[BETRIEB.md](BETRIEB.md) Zeilen 248–251.

**Wirkung.** Jeder Rechner im LAN — Gast-WLAN, ein Kompromittiertes Gerät,
ein neugieriger Router-Dienst — kann `GET /api/v1/fills` lesen: alle
Tankvorgänge mit Zeit, Ort, Preis und Menge, dazu Heimkoordinaten über das
Polling-Set. Das ist gegen die Rahmenbedingung „kein Login“ abgewogen
bewusst akzeptierbar, aber es ist heute eine **Nebenwirkung** der
Bind-Entscheidung, keine dokumentierte Entscheidung. Und es ist billig
änderbar, weil der Token-Pfad schon da ist.

**DoD.** Zwei Schritte, beide klein: (a) die Exposition in
[BETRIEB.md](BETRIEB.md) ausdrücklich benennen (was lesbar ist, für wen,
welches Netz) — damit die Rahmenbedingung „kein Login“ als Entscheidung
sichtbar bleibt und nicht als Übersehen wirkt; (b) optional ein
`TANKAPP_READ_TOKEN` für die Ledger-Endpunkte, derselbe Mechanismus wie beim
Webhook, leer = aus. Kein Login, keine Sitzung, keine Nutzer:innen — nur ein
Shared Secret für den persönlichen Datenbestand.

### O40 — Die Diagramm-Textalternative nennt keine Werte

**Beleg.** `web/src/components/LabCharts.tsx:36–48` baut die Beschreibung
aus den Reihennamen (`Liniendiagramm: A, B.`), `:96–101` setzt
`role="img"`, `aria-label="Diagramm"` und `<desc>`;
`web/src/components/LineChart.tsx:69`, `:219–221` ebenso. Die Karte trägt
Label und Alt-Text (`web/src/components/StationMap.tsx:17`, `:456`, `:874`).

**Wirkung.** Der Rest der Barrierefreiheit ist gebaut und getestet
(Kontrast AA, Typografie- und Radius-Ratchet, 44-px-Ziele, Tastaturzugang zu
Karten-Pins, `aria-live`/`role="status"`, `prefers-reduced-motion` —
`web/src/a11y.test.ts`, `web/src/styles.css:165`). Was fehlt, ist der Inhalt
der Textalternative: Ein Screenreader erfährt, **welche** Reihen ein Diagramm
zeigt, aber nicht wohin sie laufen — „Liniendiagramm: Erwarteter Preis,
Band.“ statt „erwarteter Preis fällt von 1,78 auf 1,71 €/L, tiefster Punkt
20 Uhr“. Dazu ist `aria-label` in beiden Diagrammbausteinen identisch
(„Diagramm“), also in einer Ansicht mit mehreren Charts nicht unterscheidbar.

**DoD.** `ariaDescription` je Aufruf mit den Zahlen füllen, die die Formatter
ohnehin liefern (Tendenz, Minimum, Maximum), und `aria-label` aus dem
Diagrammtitel bilden. Ein Test in `a11y.test.ts`, der verlangt, dass jede
Diagramminstanz eine Beschreibung mit mindestens einer formatierten Zahl
bekommt.

### O41 — Drei Normalisierungswege für ein Artefakt

**Beleg.** `app/selection.py:25–70` (`read_selection`) hat drei Pfade mit
drei Antwortformen: (1) `current.json` mit `by_fuel` → `count` wird
nachgerechnet, `raw` sonst unverändert zurückgegeben (kein `stations`);
(2) Einzeldateien je Kraftstoff → `stations`, `cities`, `count` werden
gebaut; (3) Fehlerfall → leere Listen. Der API-Pfad nutzt davon nur `by_fuel`:
`app/data.py:1277–1360` (`LiveData.selection`) baut `stations` selbst aus
`by_fuel[fuel]["cities"]`, sortiert nach `rank` und ergänzt `top_global`,
`cities`, `range_from/range_to`.

**Wirkung.** `stations`, `cities` und `count` aus `read_selection` konsumiert
niemand — sie sind tote Felder, die trotzdem bei jeder Anfrage gebaut
werden, und sie sind der Grund, warum die Form des Artefakts je nach
Schreiber variiert: `app/refresh.py:637–646` schreibt `{"generated_at",
"fuels", "by_fuel"}` (ohne `stations`), `app/worker.py:106` schreibt das
Ergebnis von `build_selection` (mit `stations`). Zwei Schreiber, zwei Formen,
ein Leser, der zum Glück normalisiert. Kein Test deckt `read_selection` ab
(kein Treffer in `tests/`), also bleibt die Dreifachheit unsichtbar.

**DoD.** Eine Form: entweder schreibt `refresh.py` dieselbe Struktur wie
`worker.py` (Factory-Funktion für beide), oder `read_selection` gibt nur
`by_fuel` zurück und die toten Felder entfallen. Dazu ein Test, der beide
Schreiber-Pfade gegen dieselbe erwartete Antwortform prüft.

### O42 — Der Push-Grundsatz kollidiert mit dem Preis-Push

**Beleg.** `app/notify.py:11–15` ist ausdrücklich: „**Keine Preis- oder
Stationsdetails im Text.** … Keine Koordinaten, keine Stationen, keine
Preise, keine Pfade, keine Zugangsdaten — die URL ist der einzige
Geheimnisträger und wird in jeder Ausgabe bereinigt (`app/errors.redact`).“
`app/config.py:30–33` bestätigt: Die ntfy-URL inklusive Topic ist der
einzige Geheimnisträger. O29 verlangt aber genau das Gegenteil: eine Meldung,
die sagt, **welche** Station **wann** zu **welchem** Preis — sonst ist der
Push wertlos, weil er nur „schau in die App“ bedeutet.

**Wirkung.** Zwei Dinge, die heute nicht entschieden sind. Erstens der
Inhalt: Wird O29 umgesetzt, ohne den Grundsatz anzufassen, entsteht entweder
ein nutzloser Push oder ein stiller Bruch einer dokumentierten Regel.
Zweitens der Kanal: Ein öffentliches ntfy-Topic (ntfy.sh) ist ein
Bearer-Secret — wer die URL hat, liest mit, und schon die **Zeitpunkte** der
Meldungen sind Metadaten über das eigene Tankverhalten. Selbst gehostet im
LAN ist das kein Thema; die Entscheidung steht nirgends.

**DoD.** Entscheidung dokumentieren und in `notify.py` festschreiben:
(a) selbst gehostetes ntfy im LAN → Preis, Station und Fenster dürfen in den
Push, die Regel wird entsprechend umformuliert; (b) öffentlicher Dienst →
Push bleibt bei Codes, und O29 meldet nur „Fenster offen“ ohne Details. Dazu
Dateirechte und Rotationshinweis für die URL, und ein Test, der den Payload
gegen die jeweils gewählte Regel prüft (heute: keine Preise — der Test
existiert in `web/src/notify.test.ts` für die GUI-Seite, nicht für den
Server-Payload).

## 8. Gemessen statt behauptet

Damit die Zahlen oben überprüfbar bleiben — und damit klar ist, welche
Aussagen auf Messung und welche auf Code-Lektüre beruhen.

**Umgebung.** Sandbox-Checkout von `TankApp`, Branch
`arena/01a0aa28-tankapp`. Die Messungen liefen auf dem Stand `cca0c2c`
(0.43.1); danach ist `main` auf **0.43.2** weitergegangen und wurde in diesen
Branch gemergt. Für die Messungen ist das ohne Belang: 0.43.2 ändert an
`engine/`, `app/`, `ops/`, `data-tools/`, `rp2/` und `tests/` ausschließlich
`app/version.py` (dazu zwei `requirements.txt`), alle zitierten und gemessenen
Pfade sind bytegleich. Die Zitate aus `web/src/` und `docs/LUECKEN.md` sind
gegen 0.43.2 nachgezogen. Python-Venv im Repo (`.venv/bin/python`). Keine
echten Preisdaten: Alle Messungen laufen auf `ops/quality/demo_data.py`
(synthetische 70 Tage, 6 Stationen) oder auf synthetischen Beobachtungen mit
Produktionskonfiguration (`engine/config.py`: `bootstrap_samples=2000`,
`train_days=42`, `min_slot_days=7`, `decision_hour=12`).

**Suite-Stand (gemergter Stand 0.43.2).** `pytest -q` mit
`OPENBLAS_NUM_THREADS=1`: **807 passed**; `ruff check` und
`ruff format --check` auf den CI-Pfaden grün (88 Dateien); `npm --prefix web
test`: **1064 passed** in 39 Dateien; `npm --prefix web run build` grün.
Die beiden Playwright-Suiten liefen lokal nicht — der Chromium-Download ist in
der Sandbox nicht erreichbar; in der CI des Pull Requests sind beide Suites
Teil des `web`-Jobs und dort grün. Kein Test ist rot, und keiner der Befunde
oben wird von der Suite gesehen — das ist Teil der Befunde (O16, O22).

**Messungen im Einzelnen.**

| Messung | Ergebnis | Quelle |
|---|---|---|
| Größe einer Veröffentlichungs-Reihe, Produktionsparameter | 1,88 MB (`indent=2`), 1,32 MB kompakt, 0,75 MB gerundet | Originalfunktionen `_records`/`_draws` aus `app/model_jobs.py`, `write_json`-Fassung |
| Demo-Veröffentlichung auf Platte | 4,14 MB bei 6 Stationen und 200 Draws | `ops/quality/demo_data.py` gebaut, Datei vermessen |
| `NaN`-Token in der Demo-Veröffentlichung | 51 480 | Textzählung, zusätzlich strikter Parse-Versuch |
| F3-Wahrscheinlichkeit über alle Blöcke | Median 0,018, Mittel 0,285, Maximum 1,000; 85 Blöcke | `app/pside.py:window_p` auf Demo-Draws |
| Sterne-Verteilung derselben Blöcke | 70 × 0 Sterne, 1 × 1, 14 × 3, 0 × 2 | `windowStars`-Schwellen aus `web/src/week.ts:58–65` |
| Randeffekt der Nachbarschaft | Block 0: 3 Konkurrenten, Basisrate 0,25, p 0,307; Block 3: 6 Konkurrenten, Basisrate 0,14, p 0,349 | `app/pside.py:59–63` |
| Ensemble-Gewichte | In-Sample-MASE ergibt rund 52/48 (0,173/0,185); echtes Out-of-Sample: Zweitmodell 1,64 ct gegen Hauptmodell 3,6 ct | `engine/models.py` auf synthetischen Daten — **bekannt**, in [LUECKEN.md](LUECKEN.md) Zeile 516 dokumentiert |
| Parse-Zeit einer Veröffentlichung | rund 175 ms für 4,14 MB | `json.loads` auf der Demo-Datei |
| gzip-Stufen | Stufe 6: rund 547 ms; Stufe 1: rund 122 ms | `gzip.compress` auf einer Antwort in Veröffentlichungsgröße |
| NaN-Serialisierung der API | kein Problem: `server.py:43–47` saniert NaN zu `None`, `:464–466` schreibt mit `allow_nan=False` | Code-Lektüre plus Parse-Prüfung |

**Nicht gemessen, aber strukturell belegt.** Die Wirkung von O22 auf einem
laufenden NAS mit 11 Stationen (dazu fehlt die echte Datei — ein `du -h` auf
dem NAS entscheidet es in einer Sekunde); die Darstellungen im Browser
(O16, O18–O21) ohne `node_modules`; das Verhalten auf RP2-Hardware (O24
betrifft nur den NAS-Server); Latenzgewinne aus O23–O26 unter Last. Wo ein
Befund auf synthetischen Daten beruht, steht das dabei — die Tageskurve des
Demo-Stapels ist rauschfrei, deshalb ist die O12-Sternenverteilung dort
binärer, als sie es mit echten Preisen wäre. Die Basisraten-Rechnung und der
Randeffekt sind davon unabhängig.

## 9. Was schon richtig ist

Ein Befund, der nur Mängel listet, ist halb. Diese Muster sind tragfähig und
werden oben als Vorbild zitiert:

- **`engine/storage.py`** schreibt atomar über Temp-Datei, `fsync` und
  `os.replace`, saniert NaN zu `None` und verbietet sie beim Schreiben
  (`allow_nan=False`) — die Veröffentlichung ist damit immer gültiges JSON.
  Nur die Demo umgeht das (O28c).
- **`app/data.py:318–330`** memoisiert Stations-Metadaten über einen
  Datei-Stempel statt über eine TTL — das Muster, das O23 braucht.
- **`app/thresholds.py`** denkt in Rauschbändern statt in festen Schwellen —
  das Muster, das O4, O6 und O32 brauchen.
- **`engine/selection.py:_loo_baseline`** rechnet leave-one-out — das Muster
  für O11.
- **`app/alarms.py`** hat einen Katalog mit Codes, Schweregraden und
  erklärenden Texten, inklusive `store_too_large` für den persönlichen
  Speicher — O22 braucht nur einen weiteren Code darin.
- **`app/pside.py`** unterscheidet `None` („keine Aussage“) strikt von `0.0`
  und sagt das im Docstring — die Ehrlichkeits-Regel auf Rechenebene.
- **`web/src/data.ts`** zwingt alle Zahlen durch Formatter, und
  `microcopy.test.ts`/`format-convention.test.ts` halten das als Ratchet.
  Jeder Anzeige-Befund oben ist deshalb billig zu beheben: Die Darstellung
  muss nur die richtige Größe bekommen.
- **`ops/nas/backup.sh`** und [BETRIEB.md](BETRIEB.md) Zeilen 649–727 sichern
  Laufzeitdaten täglich mit Rotation, die Preishistorie wöchentlich, und der
  Restore ist „durchgespielt, nicht nur aufgeschrieben“ — die Grundlage, auf
  der O33/O34 nur noch Lücken benennen.
- **`engine/data.py:76`, `:147–168`** prüfen Preise auf 0,40–5,00 €/L und
  filtern isolierte API-Artefakte mit einem Hampel-Filter samt 1-ct-Boden und
  Isolationsregel — genau die Verteidigung, die O35 für den Live-Pfad fordert.
- **`app/feedback.py:736–751`** validiert `tanked_at` gegen ein
  Plausibilitätsfenster und antwortet mit `invalid_tanked_at` (400) — O1 baut
  darauf auf, statt eine neue Prüfung zu erfinden.
- **`web/src/components/LabCharts.tsx:36–48`, `LineChart.tsx:69`** geben
  Diagrammen `role="img"`, `aria-label` und `<desc>` per `aria-describedby`,
  `web/src/a11y.test.ts` hält Kontrast, Typografie, Radius und 44-px-Ziele
  als Ratchet — O40 ist ein Rest, kein Neuanfang.
- **`web/src/Dashboard.tsx:615`** nennt Quelle, Lizenz und Abfrage-Regel
  (MTS-K über tankerkoenig.de, CC BY 4.0, höchstens alle 5 Minuten) — die
  Lizenzfrage ist damit erledigt, nicht offen.
- **`app/refresh.py:605`** ist ein einziger Publikationspunkt — Teildateien
  oder fehlgeschlagene Fits ersetzen die Veröffentlichung nie. Genau diese
  Klarheit macht O22 so reparaturfreundlich.

## 10. Batches, Priorität und Check

Acht Batches, nach Priorität gruppiert und innerhalb der Priorität nach
Zusammenhang. **Check** heißt: der Nachweis, dass die Wirkung eintritt — ein
Test, ein Befehl oder eine Beobachtung, nicht „Code geändert“. Aufwand ist
grob: **S** = unter einer Stunde, **M** = ein halber Tag, **L** = mehr.
Die Batches sind nach Priorität gruppiert; wo ein P1-Befund eine Entscheidung
aus einem P2-Befund braucht, steht der P2-Befund mit dem Vermerk „vorgezogen“
im selben Batch (einmal, bei O42).

Jeder Batch ist einzeln abnahmefähig. Die Suite muss nach jedem Batch grün
sein (`pytest`, `ruff check`, `ruff format --check`, `npm --prefix web test`,
`npm --prefix web build`, beide Playwright-Suiten), und kein Batch darf eine
Kennzahl ändern, ohne sie zu kennzeichnen — die Ehrlichkeits-Regel
(`calibrated=false`, `decision_ready=false` bis M7) bleibt stehen.

### Batch 1 — P0 · Nicht mehr still ausfallen

Zwei Befunde, dieselbe Ursache: Eine Grenze greift oder ein Wert fehlt, und
niemand sagt etwas.

| Befund | Aufwand | Check |
|---|---|---|
| [O22](#o22--die-veröffentlichung-passt-nicht-mehr-durch-das-leselimit) Publikations-Klippe | M | `du -h data/runtime/engine/current.json` liegt unter dem Budget (8 MB); neuer Test publiziert 11 Stationen mit `bootstrap_samples=2000` und prüft Größe **und** den Alarm `publication_large` in `/api/v1/health`; `jq -e .failures data/runtime/engine/current.json` läuft durch; Test, der eine künstlich zu große Datei anlegt und `publication_unreadable` mit Grund erwartet |
| [O1](#o1--jeder-gui-beleg-tankt-um-12-uhr) `clock_hour` fehlt | S | Test: Beleg mit `tanked_at` 18:40 Europe/Berlin ergibt `clock_hour == 18` und `clock_hour_source == "beleg"`; ein Beleg ohne Zeitstempel ergibt `12` und `"default"`; `curl -s localhost:1355/api/v1/fills \| jq '.fills[-1] \| {tanked_at, clock_hour, clock_hour_source}'` zeigt dasselbe; `w(h)`-Histogramm hat nach zwei Abendbelegen sein Gewicht bei 18, nicht bei 12 |

**Batch-Abnahme:** Die App kann nicht mehr lautlos in den „keine Daten“-Zustand
kippen, und die Personalisierung lernt aus einer gemessenen Uhrzeit. Nachweis:
beide Tests grün plus ein Health-Payload, der die Publikationsgröße nennt.

### Batch 2 — P1 · Die Zahlen, auf denen M7 steht

Ziel: Der Ledger misst, was er zu messen behauptet. Vor diesem Batch ist jede
M7-Aussage angreifbar (O5, O6), danach ist sie begründbar.

| Befund | Aufwand | Check |
|---|---|---|
| [O17](#o17--ein-tipp-bucht-den-prognosepreis-als-gezahlten-preis) Belegpreis erfunden | S | Playwright (Demo-Suite): „Ja, wie empfohlen“ mit frischem Live-Preis bucht `price_paid` = Live-Preis und `price_source="live"`; ohne Live-Preis öffnet sich die Maske und es wird **kein** Beleg angelegt; Unit-Test, dass `expected_price` nie als `price_paid` gesendet wird |
| [O5](#o5--das-m7-gate-mischt-zwei-wahrscheinlichkeitsquellen) Brier ohne `p_source` | M | Test: jede Ledger-Zeile trägt `p_source`; Brier wird je Quelle getrennt ausgewiesen; das Gate rechnet ausschließlich über Zeilen mit `p_source="verteilung"`; `LUECKEN.md` und Code sagen dasselbe (Doku-Link-Test bleibt grün) |
| [O6](#o6--die-brier-schwelle-ist-ein-münzwurf-ohne-intervall) 0,25 ohne Intervall | M | Test: Bei synthetischen Fällen mit bekannter Güte besteht das Gate erst, wenn die **Obergrenze** des Block-Bootstrap-Intervalls unter der Basisraten-Referenz liegt; die Antwort enthält Intervall, Fenstergröße und beide Referenzen |
| [O4](#o4--das-güte-badge-kippt-bei-jedem-poll) PICP-Badge flattert | M | Test: Rolling-PICP zählt je Tagesblock (n = Tage, nicht n = 5-Minuten-Punkte); zwei aufeinanderfolgende Werte innerhalb der Rauschbandbreite wechseln das Badge nicht (Hysterese); die Fallzahl steht in der Antwort |
| [O38](#o38--verstrichene-fenster-sind-unsichtbar) verpasste Fenster | S | Test: Eine Episode mit `status="expired"` erscheint im Wochen-/Monatszähler; die GUI zeigt „x von y Fenstern genutzt“; die Zahl läuft über die Formatter (`format-convention.test.ts` bleibt grün) |

**Batch-Abnahme:** Ein Ledger-Auszug zeigt je Kennzahl Quelle, Fallzahl und
Intervall; keine Kennzahl mehr, die ihre eigene Erfüllung misst.

### Batch 3 — P1 · Anzeigen, die leer sind oder das Falsche zeigen

Ziel: Was die GUI behauptet, ist belegt — und was sie empfehlen will, meldet
sich. O42 ist P2 und steht trotzdem hier, weil O29 ohne diese Entscheidung
nicht umsetzbar ist — der einzige vorgezogene Befund.

| Befund | Aufwand | Check |
|---|---|---|
| [O16](#o16--der-laborbalken-für-den-hauspreis-bleibt-leer) δ̂-Balken leer | S | Playwright/Labor: `stationDeltas.length > 0` mit Demo-Daten, Balken **mit** KI-Whisker; `curl -s 'localhost:1355/api/v1/selection?fuel=e10' \| jq '.stations[0] \| {delta_ct, ci_lo, ci_hi, q_value}'` liefert Werte; `BacktestStationScore.delta_ct` ist aus dem Typ entfernt oder wirklich gefüllt (Typ-Lauf `tsc` grün) |
| [O35](#o35--live-preise-kennen-keine-plausibilitätsgrenze) Live-Preis ohne Grenze | S | Test: Ein Influx-Wert 0,05 €/L und einer 9,90 €/L erscheinen nicht als `price`, die Station sortiert sich **nicht** an die Spitze, und `/api/v1/health` zählt `price_implausible`; dieselben Werte im Trainingspfad bleiben gefiltert (Regressionstest für `engine/data.py:76`) |
| [O29](#o29--kein-hinweis-wenn-das-fenster-aufgeht) kein Push | M | Test: Fensteröffnung mit `p` über der Schwelle erzeugt genau eine Meldung je `episode.id`; Wiederholung innerhalb der Ruhezeit erzeugt keine zweite; Schließen ohne Beleg erzeugt die Abschlussmeldung; Payload entspricht der in O42 gewählten Regel |
| [O42](#o42--der-push-grundsatz-kollidiert-mit-dem-preis-push) Push-Grundsatz (P2, vorgezogen) | S | Entscheidung steht in `notify.py`-Docstring und [BETRIEB.md](BETRIEB.md); Test prüft den Server-Payload gegen die gewählte Regel (öffentlich: keine Preise, keine Stationen; selbst gehostet: Preis und Station erlaubt, keine Koordinaten, keine Pfade) |

**Batch-Abnahme:** Das Labor zeigt die Selektionsstatistik, die längst
publiziert ist; ein unplausibler Preis kann keine Empfehlung mehr auslösen;
ein Fenster meldet sich.

### Batch 4 — P1 · Betrieb: Kosten, Haltbarkeit, Kohärenz

Ziel: Der Dauerbetrieb kostet messbar weniger und verliert nichts.

| Befund | Aufwand | Check |
|---|---|---|
| [O23](#o23--der-healthcheck-parst-die-veröffentlichung-alle-30-sekunden) Health parst alles | S | Test zählt die Parses: `/api/v1/stats/summary` → genau **ein** Parse, `/api/v1/health` bei unverändertem `(mtime, size)` → **kein** Parse; Messung: zwei aufeinanderfolgende Health-Antworten unter 20 ms |
| [O24](#o24--der-server-spricht-http10) HTTP/1.0 | S | Test: `protocol_version == "HTTP/1.1"` und jede Antwort trägt `Content-Length`; `curl -sv --http1.1 -o /dev/null localhost:1355/api/v1/health localhost:1355/api/v1/health` zeigt **eine** Verbindung (`Re-using existing connection`) |
| [O36](#o36--vier-konfigurationsflächen-und-eine-zahl-als-literal) Konfig-Drift | M | Test: `bootstrap_samples=4000` in der Engine-Konfiguration führt zu `n_boot == 4000` in der Selektion; `grep -n "n_boot=2000" app/worker.py` findet nichts mehr; `ffill_minutes` hat in beiden Flächen denselben Wert mit Begründung |
| [O33](#o33--die-backup-alterung-bleibt-unsichtbar) Backup-Alarm | S | Test legt ein 40 Stunden altes `tankapp-runtime-*.tar.gz` an und erwartet `backup_stale` (warn); mit frischem Tar bleibt der Alarm aus; zweites Backup-Ziel und Aufbewahrungsregel stehen in [BETRIEB.md](BETRIEB.md) |

**Batch-Abnahme:** Der Healthcheck kostet nichts mehr, Anfragen teilen sich
eine Verbindung, Backup-Alterung wird gelb, und eine Konfigurationsänderung
wirkt in der ganzen App.

### Batch 5 — P2 · Rechnung und Statistik im Einzelnen

Ziel: Jede Größe beantwortet die Frage, für die sie angezeigt wird.

| Befund | Aufwand | Check |
|---|---|---|
| [O12](#o12--die-fenstersterne-haben-keine-basisrate) Sterne ohne Basisrate | M | Test: identische Datenlage am Rand und in der Mitte des Horizonts ergibt dieselbe normierte Bewertung; die Sternenverteilung über die Demo-Draws belegt mindestens drei Stufen (heute: 70/1/0/14) |
| [O7](#o7--drei-tie-konventionen-in-einem-ledger) Tie-Konventionen | S | Test: ein Fall mit exakt 1,00 ct Differenz läuft durch `hit_rate`, `hit_wait`, `hit_now`, `estimate_p`, Brier und `p_better` — alle sechs mit derselben, dokumentierten Konvention |
| [O8](#o8--abrechnung-und-wahrscheinlichkeit-nutzen-andere-fenster) Slack ≠ Fenster | S | Test: Beleg 55 Minuten nach Fensterbeginn ergibt `settled="kulanz"`, `hit_wait` bleibt unverändert; Kulanz-Fälle sind in der Antwort sichtbar, aber nicht in der Güte |
| [O9](#o9--umwegkosten-entscheiden-netto-und-rechnen-brutto) brutto/netto | M | Test: `elsewhere_net_eur` entspricht der `p_lohnt`-Formel mit denselben Parametern (Kilometer, Verbrauch, Geschwindigkeit, Zeitwert) — gleiche Eingabe, gleiche Zahl |
| [O13](#o13--die-laborbilanz-ist-zweimal-dieselbe-zahl) doppelte Bilanz | S | Test: `sum_best` und `sum_always` unterscheiden sich (echte „immer dieselbe Station“-Referenz) oder die Zeile ist entfernt; Beschriftung und Rechnung stimmen überein |
| [O2](#o2--zwei-personalisierungen-eine-davon-hartkodiert) zwei Zeitprofile | M | Test: zwei Belegprofile (werktags 18 Uhr, samstags 10 Uhr) ergeben verschiedene `avail`- und `wh_weight`-Werte; die Gewichtsformel existiert nur noch an einer Stelle (grep-Ratchet gegen die Kopie in `analysis/`) |
| [O3](#o3--die-profilschrumpfung-springt-am-achten-beleg) Sprung bei n=8 | S | Test: über n = 1…12 ändert sich die Fensterreihenfolge stetig — kein Sprung zwischen 7 und 8 |
| [O10](#o10--dünne-slots-liefern-rauschende-bandenden) dünne Slots | S | Test: Bandenden sind auf 0,1 ct gerundet; `counts` je Slot steht in der Antwort; ein Slot mit 7 Tagen ist in der GUI als dünn gekennzeichnet |
| [O11](#o11--die-heatmap-bewertet-sich-mit-eigenen-preisen) kein LOO | M | Test: Skaliert man die Preise einer Station, ändert sich ihre eigene Cheap-Probability nicht mehr (LOO); Vergleichsrechnung gegen `_loo_baseline` aus `engine/selection.py` |
| [O14](#o14--umwegkilometer-sind-drei-verschiedene-größen) `dist_km` gemischt | M | Test: `dist_mode` steht in der Antwort und wird angezeigt; die Umwegrechnung verwendet ausschließlich Straßenkilometer, sonst einen benannten Schätzwert mit Faktor |
| [O15](#o15--der-zeitwert-kippt-um-halb-fünf) Stufe 16:30 | S | Test: 16:29 und 16:31 unterscheiden sich höchstens um den interpolationsschritt — oder die Stufe ist in der Antwort und in der GUI benannt |

**Batch-Abnahme:** Keine Kennzahl mehr, die gegen sich selbst null ergibt,
keine Schwelle ohne Basisrate, keine Einheit ohne Namen.

### Batch 6 — P2 · Anzeige und Alltag

Ziel: Die GUI sagt, wofür eine Zahl gilt, und der Alltag bekommt, was er
braucht.

| Befund | Aufwand | Check |
|---|---|---|
| [O19](#o19--die-ersparnis-rechnet-gegen-die-teuerste-station) falscher Anker | S | Test: Ersparnis wird gegen die Profil-Referenz gebildet und die Referenz im Text benannt; die Spanne bleibt als Spanne sichtbar |
| [O20](#o20--der-tagesstreifen-färbt-rückwirkend-um) relative Farben | S | Test in `strip.test.ts`: Eine neue, günstigere Meldung ändert die Farbe früherer Stunden nicht; je Stunde steht das Minimum, nicht der letzte Wert |
| [O21](#o21--das-scoring-lebt-doppelt-und-der-server-entscheidet-mit) doppeltes Scoring | M | Test: Python- und TypeScript-Score liefern bei gleichen Eingaben gleiche Werte; eine Profiländerung auf 60 L wirkt auf Score **und** Selektion (`tank_volume` durchgereicht) |
| [O18](#o18--vier-laborwerkzeuge-sind-dauerhaft-stumm) tote Werkzeuge | M | Je Werkzeug: entweder zeigt ein Test echte Daten (CUSUM aus `break_flag`/`break_stat`, Top-3 aus `rank_std`), oder der Text nennt den Dauerzustand — Microcopy-Ratchet gegen „zu wenig Daten“ ohne Datenpfad |
| [O30](#o30--die-bilanz-zeigt-brutto-was-netto-gemeint-ist) Bilanz brutto | S | Test: Die Bilanz zeigt eine Netto-Zeile, die mit O9 übereinstimmt; beide Zeilen sind benannt |
| [O31](#o31--die-woche-endet-ohne-zusammenfassung) Wochenrückblick | M | Test: Die Wochenmeldung enthält abgerechnete Fälle (inklusive Kulanz aus O8), δ̂-Änderung (`delta_recent5_ct`), Datenqualität und Lernstand; alle Zahlen über Formatter |
| [O39](#o39--das-ledger-ist-im-lan-für-alle-lesbar) LAN-Exposition | S | Die Exposition ist in [BETRIEB.md](BETRIEB.md) benannt; falls Read-Token gewählt: Test, dass `/api/v1/fills` ohne Token 401 antwortet, sobald `TANKAPP_READ_TOKEN` gesetzt ist, und unverändert offen bleibt, wenn nicht |

**Batch-Abnahme:** Jede Zahl nennt ihre Referenz, jedes Werkzeug hat entweder
Daten oder einen ehrlichen Text, und die persönliche Datenexposition ist eine
Entscheidung statt einer Nebenwirkung.

### Batch 7 — P2 · Betrieb, Rest

| Befund | Aufwand | Check |
|---|---|---|
| [O25](#o25--kompression-und-revalidierung-sind-zu-teuer-und-zu-selten) gzip 6 | S | Messung: dieselbe Antwort mit Stufe 1 unter 150 ms (vorher 547 ms); Test: zweite Anfrage mit `If-None-Match` auf `/decide`, `/stations`, `/heatmap`, `/stats/summary` ergibt 304 |
| [O26](#o26--jeder-decide-poll-nimmt-die-schreibsperre) Lock im Lesepfad | S | Test: `GET /decide` erhöht den Sperren-Zähler des Stores nicht; ein Beleg wird während laufender Polls ohne messbare Wartezeit gebucht |
| [O37](#o37--der-server-misst-sich-selbst-nicht) keine Metriken | S | Test: Antworten tragen `X-Process-Time`, `/api/v1/health` nennt Parse-Dauer und Publikationsgröße; Budget steht in [QUALITAET.md](QUALITAET.md) |
| [O34](#o34--historie-und-archiv-haben-keine-aufbewahrungsregel) Aufbewahrung | S | Der InfluxDB-Cron rotiert (`find … -mtime +N -delete` im Befehl); [BETRIEB.md](BETRIEB.md) nennt die Archiv-Entscheidung mit Begründung |
| [O27](#o27--bild-und-pipeline-bauen-gegen-andere-versionen) Versionsdrift | M | Ein Pipeline-Job baut das Bild und fährt die Suite **im Bild**; `web/package.json` hat `engines`; Bild und Pipeline nennen dieselbe Python-Linie |

**Batch-Abnahme:** Kosten sind messbar und budgetiert, Sperren sitzen nicht
mehr im Lesepfad, und was getestet wird, ist was läuft.

### Batch 8 — P3 · Schliff

| Befund | Aufwand | Check |
|---|---|---|
| [O28](#o28--kleine-unehrlichkeiten-in-kommentar-und-laufzeit) Kommentar driftet | S | Docstrings stimmen mit A11 überein; `demo_data.py` schreibt über `write_json`, also `jq -e . current.json` grün; ein Suite-Lauf mit `-W error::RuntimeWarning` für die Selektionstests bleibt grün |
| [O32](#o32--die-belegmaske-zeigt-den-live-preis-nicht) Prefill-Staleness | S | Test: Die Maske zeigt Live-Preis und Alter neben dem Feld; Abweichung über der Schwelle ist markiert |
| [O40](#o40--die-diagramm-textalternative-nennt-keine-werte) A11y-Rest | S | Test in `a11y.test.ts`: Jedes Diagramm hat eine Beschreibung mit mindestens einer formatierten Zahl und ein unterscheidbares `aria-label` |
| [O41](#o41--drei-normalisierungswege-für-ein-artefakt) drei Formen | S | Test: Beide Schreiber (`refresh.py`, `worker.py`) erzeugen dieselbe Form; die API-Antwort ist vor und nach der Änderung byte-identisch |

**Batch-Abnahme:** Kommentar, Demo-Artefakt und A11y-Text sagen, was der Code
tut.
