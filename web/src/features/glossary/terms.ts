export type GlossaryTerm = {
  id: string;
  term: string;
  de: string;
  short: string;
  long: string;
  anchor?: string;
};

/** C7: Fachbegriffe ohne Erklärung in der App — hier mit deutscher Primärzeile. */
export const GLOSSARY: readonly GlossaryTerm[] = [
  {
    id: "delta",
    term: "δ̂ (delta-hat)",
    de: "Preis-Abstand",
    short: "Median der Differenz einer Station zum Median der übrigen Stationen der Stadt — in ct/L, negativ heißt günstiger als die Umgebung.",
    long: "Für jeden 5-Minuten-Zeitpunkt wird der Median der Vergleichsstationen (Leave-One-Out) abgezogen; über alle Zeitpunkte gemittelt ergibt das δ̂. Ein Wert von −4,2 ct/L bedeutet: Die Station lag im Mittel 4,2 ct/L unter dem Stadtmedian. Das Konfidenzintervall kommt aus dem Tages-Block-Bootstrap (B=2000, 95 %, Benjamini-Hochberg-korrigierter q-Wert).",
    anchor: "relative-preislage-δ",
  },
  {
    id: "mase",
    term: "MASE",
    de: "Vergleich zur saisonalen Naive",
    short: "MASE = Fehler des Modells geteilt durch den Fehler der saisonalen Naive. Unter 1,0 heißt besser als die einfache Vergleichsmethode. Die App rechnet zwei MASE: 1 Schritt und 24 Stunden — sie messen verschiedene Horizonte und stehen nie ohne ihren Namen da.",
    long: "Mean Absolute Scaled Error: Der Fehler des Modells, geteilt durch den Fehler der saisonalen Naive (Preis des Vortags zur selben Uhrzeit). MASE 0,7 heißt 30 % weniger Fehler als „nimm den gestrigen Preis“. Weil der Nenner derselbe bleibt, der Horizont aber nicht, gibt es zwei Maßzahlen mit zwei Namen: „MASE 1 Schritt“ (Eine-Schritt-Validierung, trägt die Ensemble-Gewichte) und „MASE 24 Stunden“ (Roll-Backtest auf das 24-h-Fenster, trägt die Güte-Aussage). Beide sind unter 1,0 gut — vergleichen lassen sie sich nicht miteinander.",
    anchor: "mase-fehler-gegen-die-naive",
  },
  {
    id: "mase-1step",
    term: "MASE_1step",
    de: "MASE 1 Schritt",
    short: "Fehler der Eine-Schritt-Prognose gegen die saisonale Naive — gemessen im Fit auf den Validierungstagen, und die Grundlage der Ensemble-Gewichte.",
    long: "Verglichen wird die Eine-Schritt-Prognose (eine Rasterstufe voraus, AR(2)-Zustand aus den beiden Vorpunkten) beider Modellkerne auf dem Validierungsfenster des Fits; Nenner ist der Fehler der saisonalen Naive desselben Slots am Vortag. Die Gewichte sind ∝ 1/MASE 1 Schritt — der Kern mit dem kleineren Fehler zieht stärker. Ein Wert unter 1,0 heißt: besser als die Naive auf dieser kurzen Strecke. Er sagt nichts über das 24-Stunden-Fenster, für das die Empfehlung entsteht.",
    anchor: "mase-1-schritt-eine-schritt-validierung-des-ensembles",
  },
  {
    id: "mase-24h",
    term: "MASE_24h",
    de: "MASE 24 Stunden",
    short: "Fehler der 24-Stunden-Prognose gegen die saisonale Naive — gemessen im Roll-Backtest außerhalb der Stichprobe.",
    long: "Der Rolling-Origin-Backtest prognostiziert das 24-h-Fenster und teilt seinen MAE durch den MAE der saisonalen Naive (Vortagespreis zur selben Uhrzeit). Gezählt werden abgeschlossene Prüftage aus echten Beobachtungen, im NAS-Lauf 21 Tage. Unter 1,0 heißt besser als die Naive, über 1,0 schlechter — dann ist der Vor-Tages-Preis die bessere Prognose. Eine Variante nur für Tage ohne Preissprung weist die Engine bewusst nicht aus: Ohne Sprunglabel wäre sie erfunden.",
    anchor: "mase-24-stunden-roll-backtest-auf-das-24-h-fenster",
  },
  {
    id: "picp",
    term: "PICP 95 %",
    de: "Trefferquote des 95-%-Bandes",
    short: "Anteil echter Preise, die im 95-%-Band des Backtests lagen. Zielbereich 90–98 %.",
    long: "Prediction Interval Coverage Probability: Wie oft liegt der echte Preis im vorhergesagten 95-%-Band? Bei perfekter Kalibrierung etwa 95 % der Zeit. Darunter ist das Band zu schmal (zu siegessicher), darüber zu breit (zu vorsichtig). Gezählt werden nur Zeitpunkte mit echtem Preis, geschlossene Meldungen zählen nicht als Bandverfehlung.",
    anchor: "picp-band-trefferquote",
  },
  {
    id: "brier",
    term: "Brier",
    de: "Treffergenauigkeit der Prozentzahlen",
    short: "Mittlerer quadratischer Abstand zwischen behaupteter Prozentzahl P und eingetretenem Ergebnis (0/1). Kleiner heißt ehrlicher.",
    long: "Der Brier-Score vergleicht jede Empfehlungs-Prozentzahl P(„Warten lohnt“) mit dem tatsächlich eingetretenen „hat Warten einen Vorteil gebracht?“ (Ja=1, Nein=0). 0 wäre perfekt, 0,25 entspricht Raten. Die Freigabe des Kalibrierungs-Gates fordert mindestens 100 abgeschlossene Empfehlungen, deren Brier-Intervall (Obergrenze) unter Basis- und Klima-Referenz liegt (§0.4); 0,25 ist nur das Münz-Niveau zum Einordnen.",
    anchor: "brier-score-treffergenauigkeit-der-prozentzahlen",
  },
  {
    id: "eps",
    term: "ε (epsilon)",
    de: "Handlungsschwelle",
    short: "Mindest-Ersparnis in ct/L, ab der die Regel „Warten“ empfiehlt statt „Jetzt tanken“. Schalter im Labor, Produktion rechnet mit kalibrierter Entscheidungstabelle.",
    long: "Die Labor-Regel des Backtests: Warten nur, wenn die im Training geschätzte erwartete Ersparnis μ mindestens ε erreicht. ε = 1,0 ct/L heißt: Erwarte ich weniger als einen Cent Vorteil, bleibe ich bei „Jetzt“. Die Produktion nutzt die kalibrierte Entscheidungstabelle (§4.1/§4.2), der Slider dient nur der Was-wäre-wenn-Analyse.",
    anchor: "epsilon-schwelle-des-labor-vergleichs",
  },
  {
    id: "regret",
    term: "Regret / Mehrkosten",
    de: "Mehrkosten zum perfekten Timing",
    short: "Durchschnittlicher Abstand der Regel zum Orakel — wie viel Cent je Liter die Regel mehr kostet als der beste Zeitpunkt im Fenster.",
    long: "Regret = (Preis der Regel − Preis des Orakels) je Entscheidung, gemittelt. Das Orakel kennt den ganzen Tagesverlauf vorher und tankt immer im günstigsten Fenster — es ist die unerreichbare Referenz. Die Regel-€ (smart), Orakel-€ (best) und „immer warten“-€ (always) stehen daneben: Geholtes Potenzial = Regel-€ / Orakel-€.",
    anchor: "regret-mehrkosten-zum-perfekten-timing",
  },
  {
    id: "qvalue",
    term: "q-Wert",
    de: "Falscher-Alarm-korrigiert",
    short: "Benjamini-Hochberg-korrigierter p-Wert über alle Stationen der Stadt. Signifikant günstiger bei q < 0,05.",
    long: "Der q-Wert korrigiert die vielen Einzeltests (jede Station gegen ihre Stadt) gegen falsche Entdeckungen. q = 0,03 heißt: Unter allen als signifikant markierten Stationen sind höchstens 3 % Fehlalarme erwartet. 95-%-KI und q-Wert kommen aus demselben Tages-Block-Bootstrap.",
    anchor: "bootstrap-ki--fdr",
  },
  {
    id: "avscore",
    term: "AV-Score / Ampel-Stärke",
    de: "Gewichtete Verfügbarkeit bei 3 günstigsten",
    short: "Gewichtete Wahrscheinlichkeit, dass die Station zu den drei günstigsten der Stadt gehört — gewichtet mit dem Tankzeitprofil.",
    long: "Für jede Stunde wird gemessen, wie oft die Station unter den drei günstigsten Preisen lag; über die 24 Stunden gewichtet mit dem Tankzeitprofil w(h) (Default Pendlerprofil, ab 8 Belegen personalisiert). Eine hohe Ampel-Stärke sagt: Zu den typischen Tankzeiten liegt die Station oft unter den drei günstigsten.",
    anchor: "av-score--billigste-stunde",
  },
  {
    id: "lifecycle",
    term: "Lebenszyklus",
    de: "Zustand der Station für diesen Kraftstoff",
    short: "aktiv, temporär geschlossen, führt den Kraftstoff nicht oder tot (seit Tagen kein Preis) — nur tote verlieren den Vergleichsplatz.",
    long: "Die API liefert je Station „open“, „closed“ oder „false“ (Sorte nicht geführt). Kein verwertbarer Preis in den letzten 7 Kalendertagen (Europe/Berlin, konfigurierbar) gilt als „tot“ und verliert den Vergleichsplatz im Ranking — anders als „geschlossen“ (vorübergehend) oder „führt nicht“ (offen, aber Sorte fehlt). Gepollt wird weiter, bis das Polling-Set per Tausch-Anleitung bereinigt ist.",
    anchor: "lebenszyklus-der-stationen",
  },
  {
    id: "twins",
    term: "Preis-Zwillinge",
    de: "Stationen mit identischem Preisverlauf",
    short: "Zwei Stationen, deren Preise über 28 Tage bei ≥ 90 % Überlappung zu ≥ 99 % innerhalb 0,1 ct/L übereinstimmen — Warnung, nie automatische Entfernung.",
    long: "Kriterien: mind. 28 Tage mit je ≥ 12 gemeinsamen Zeitpunkten, ≥ 90 % Überlappung, ≥ 99 % Übereinstimmung innerhalb 0,1 ct/L. Solche Paare sind oft Doppel-Source oder Franchise-Überlappung. Die Warnung steht im Selektions-Artefakt und im System-Tab; das Polling-Set wird nie automatisch umgebaut — das braucht Bestätigung.",
    anchor: "preis-zwillinge",
  },
] as const;

export function glossaryById(id: string): GlossaryTerm | undefined {
  return GLOSSARY.find((g) => g.id === id);
}
