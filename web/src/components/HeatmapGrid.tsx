// D1: Ausgelagerter Baustein aus Dashboard.tsx — die Wochentags×Stunden-Heatmap
// inklusive Tages-Zusammenfassungen (E5 Zeiträume, B12 Vergleichs-Basis,
// belastbare Zellen ab MIN_HEATMAP_POINTS).
//
// P0 12.09.2026: Die „günstigste Stunde“ war nicht wiederzufinden — das Label
// „06–08 Uhr“ nannte ein Zweistundenfenster, das es im Raster nicht gibt (eine
// Spalte = eine Stunde), und bei zwölf gleichauf grünen Zellen entschied der
// Zufall der Sortierung, welche Stunde genannt wurde. Dazu kam eine dünne
// Vergleichs-Basis: Vier Tage Bestand reichten für „100 % Chance günstig“, was
// Mechanik war, keine Aussage. Rechenlogik liegt als reine Funktionen in
// `data.ts` (heatmapDaySummaries, hourRunsLabel, heatmapCoverageNote …).

import {
  countLabel,
  euro,
  euroPerLiter,
  heatmapBestDay,
  heatmapCellCount,
  heatmapCoverage,
  heatmapCoverageNote,
  heatmapDaySummaries,
  heatmapRangeLabel,
  heatmapSampleLabel,
  hourBucketLabel,
  hourRunsLabel,
  MIN_HEATMAP_POINTS,
  MIN_HEATMAP_REFERENCE,
  percentLabel,
  type Heatmap,
  type HeatmapBest,
} from "../data";

export function HeatmapGrid({ heatmap }: { heatmap: Heatmap }) {
  const { days, hours, matrix, kind } = heatmap;
  const isProb = kind === "probability";
  // B12: Spalten-Basis (Median derselben Stunde) — der Server liefert sie im
  // Payload zurück; ohne Station und bei Cheap-Probability ist sie wirksam.
  const byHour =
    isProb && !heatmap.station_id && (heatmap.basis ?? "overall") === "hour";
  const referenceLabel = isProb
    ? byHour
      ? "Median derselben Stunde"
      : heatmap.station_id
        ? "Stadtmedian dieser Zelle"
        : "Gesamtmedian"
    : "Median";

  // Zellen mit zu kleiner Stichprobe (n < 8) zählen nicht — weder für
  // Farben/Median noch für die „günstigste Stunde“. Ohne Zähler im Payload
  // (alte API) bleibt alles wie bisher.
  const cellCount = (dIdx: number, h: number): number | null =>
    heatmapCellCount(heatmap, dIdx, h);
  const cellOk = (v: number | null, dIdx: number, h: number): v is number => {
    if (v === null || !Number.isFinite(v)) return false;
    const n = cellCount(dIdx, h);
    return n === null || n >= MIN_HEATMAP_POINTS;
  };
  const allVals = matrix.flatMap((r, dIdx) =>
    r.filter((v, h): v is number => cellOk(v, dIdx, hours[h] ?? h)),
  );
  const minVal = allVals.length ? Math.min(...allVals) : 0;
  const maxVal = allVals.length ? Math.max(...allVals) : 1;

  const colorFor = (v: number | null) => {
    if (v === null || !Number.isFinite(v)) return "bg-slate-950 text-slate-700";
    if (isProb) {
      if (v >= 75) return "bg-emerald-500/40 text-emerald-200 font-semibold";
      if (v >= 55) return "bg-emerald-500/20 text-emerald-300";
      if (v >= 40) return "bg-amber-500/15 text-amber-300";
      if (v >= 25) return "bg-rose-500/20 text-rose-300";
      return "bg-rose-500/35 text-rose-200 font-semibold";
    }
    const span = maxVal - minVal || 0.01;
    const norm = (v - minVal) / span;
    if (norm <= 0.25) return "bg-emerald-500/40 text-emerald-200 font-semibold";
    if (norm <= 0.45) return "bg-emerald-500/20 text-emerald-300";
    if (norm <= 0.65) return "bg-amber-500/15 text-amber-300";
    if (norm <= 0.85) return "bg-rose-500/20 text-rose-300";
    return "bg-rose-500/35 text-rose-200 font-semibold";
  };

  // C9: de-DE durchgängig — „2,219 €/L“ statt „2.219“ (Punkt las sich als
  // Tausender-Trennzeichen) und „100 %“ statt „100%“.
  const fmtVal = (v: number | null) => {
    if (v === null || !Number.isFinite(v)) return "—";
    return isProb ? percentLabel(v) : euro(v, 3);
  };

  // C10: Tages-Zusammenfassung je Wochentag — Median + günstigste Stunde,
  // inklusive Gleichstand und Stichprobe der Vergleichs-Basis (P0).
  const todayIdx = (() => {
    try {
      const short = new Intl.DateTimeFormat("en-US", {
        timeZone: "Europe/Berlin",
        weekday: "short",
      }).format(new Date());
      const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const idx = order.indexOf(short);
      return idx >= 0 ? idx : null;
    } catch {
      return null;
    }
  })();

  const summaries = heatmapDaySummaries(heatmap);
  const bestDay = heatmapBestDay(summaries, kind);
  // Ein Label für den Bestwert, damit Niveau und Probability denselben Satz
  // benutzen (C9: €/L mit drei, Prozent ohne Nachkommastelle).
  const bestValueLabel = bestDay?.best
    ? isProb
      ? percentLabel(bestDay.best.value)
      : euroPerLiter(bestDay.best.value)
    : "—";
  const coverage = heatmapCoverage(heatmap);
  const coverageNote = heatmapCoverageNote(heatmap);
  const sampleLabel = heatmapSampleLabel(heatmap);
  const rangeLabel = heatmapRangeLabel(heatmap);

  const bestTitle = (day: string, best: HeatmapBest) =>
    [
      `${day}: günstigste Stunde(n) ${hourRunsLabel(best.runs, 24)} — ${
        best.hours.length
      } ${best.hours.length === 1 ? "Stunde" : "Stunden"}${
        best.tied ? " gleichauf" : ""
      }`,
      best.minCount === null
        ? null
        : `kleinste Zellen-Stichprobe n=${countLabel(best.minCount)}`,
      best.minReference === null
        ? null
        : `Vergleichs-Basis (${referenceLabel}) n=${countLabel(
            best.minReference,
          )}${best.thinReference ? ` — dünn, Mindestmaß ${MIN_HEATMAP_REFERENCE}` : ""}`,
    ]
      .filter(Boolean)
      .join("; ");

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-center text-[10px] font-mono">
          <thead>
            <tr className="text-slate-500">
              <th className="p-1 text-left font-sans text-xs font-normal">Tag</th>
              <th
                className="p-1 text-left font-sans text-[10px] font-normal text-slate-600"
                title={
                  isProb
                    ? "Median der belastbaren Cheap-Probability-Werte dieser Zeile"
                    : "Median der belastbaren Stunden-Mediane dieser Zeile (€/L)"
                }
              >
                Median
              </th>
              <th
                className="p-1 text-left font-sans text-[10px] font-normal text-slate-600"
                title="Eine Spalte = eine Stunde: „06–07 Uhr“ ist der Kasten 06:00–06:59. „dünn“ = die Vergleichs-Basis dieser Stunde trägt zu wenige Preise für eine Empfehlung."
              >
                Günstigste Std.
              </th>
              {hours.map((h) => (
                <th key={h} className="p-1 font-normal" title={hourBucketLabel(h)}>
                  {String(h).padStart(2, "0")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/40">
            {days.map((dayName, dIdx) => {
              const summary = summaries.find((s) => s.index === dIdx) ?? null;
              const isToday = todayIdx === dIdx;
              return (
                <tr
                  key={dayName}
                  className={isToday ? "bg-sky-500/[.07]" : undefined}
                >
                  <td
                    className={`p-1 text-left font-sans text-xs font-medium ${
                      isToday ? "text-sky-300" : "text-slate-300"
                    }`}
                    title={
                      summary
                        ? `${summary.cells} von ${hours.length} Stunden belastbar (n ≥ ${MIN_HEATMAP_POINTS})`
                        : `keine belastbare Zeile — weniger als 3 Stunden mit n ≥ ${MIN_HEATMAP_POINTS}`
                    }
                  >
                    {dayName}
                    {isToday ? (
                      <span className="ml-1 text-[9px] font-bold uppercase text-sky-400">
                        heute
                      </span>
                    ) : null}
                  </td>
                  <td className="p-1 text-left font-sans text-[10px] text-slate-400">
                    {summary
                      ? isProb
                        ? percentLabel(summary.median)
                        : euro(summary.median, 3)
                      : "—"}
                  </td>
                  <td className="p-1 text-left font-sans text-[10px] text-slate-400">
                    {summary?.best ? (
                      <span title={bestTitle(dayName, summary.best)}>
                        {hourRunsLabel(summary.best.runs)}
                        {summary.best.thinReference ? (
                          <span className="ml-1 text-[9px] font-semibold text-amber-400">
                            dünn
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  {hours.map((h) => {
                    const val = matrix[dIdx]?.[h] ?? null;
                    const n = cellCount(dIdx, h);
                    const ok = cellOk(val, dIdx, h);
                    const shown = ok ? val : null;
                    const thin =
                      val !== null && !ok && n !== null
                        ? `zu wenig Daten (n=${n}, min. ${MIN_HEATMAP_POINTS})`
                        : null;
                    return (
                      <td
                        key={h}
                        title={`${dayName} ${hourBucketLabel(h)}: ${thin ?? (isProb ? (shown !== null ? `${percentLabel(shown, 1)} Chance günstiger als ${referenceLabel}` : "keine Daten") : (shown !== null ? `${euroPerLiter(shown)} Median` : "keine Daten"))}`}
                        className={`p-1 transition-colors ${colorFor(shown)}`}
                      >
                        {thin ? "·" : fmtVal(shown)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {bestDay?.best ? (
        bestDay.best.thinReference ? (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[.07] p-3 text-xs leading-relaxed text-amber-200">
            <span className="font-semibold">
              Noch keine belastbare „günstigste Stunde“:
            </span>{" "}
            {bestDay.day} {hourRunsLabel(bestDay.best.runs, 3)} liegt bei{" "}
            {bestValueLabel}
            {bestDay.best.tied
              ? ` — ${bestDay.best.hours.length} Stunden gleichauf`
              : ""}
            . Aber die Vergleichs-Basis ({referenceLabel}) dieser Stunden trägt
            nur{" "}
            <span className="font-semibold">
              n={countLabel(bestDay.best.minReference)}
            </span>{" "}
            Preise, Mindestmaß {MIN_HEATMAP_REFERENCE}. Bei so wenigen
            Vergleichspreisen heißt der Wert lediglich: alle Preise dieser Zelle
            lagen unter einer Referenz, die selbst kaum Daten hat — Mechanik,
            keine Empfehlung.
          </p>
        ) : (
          <p className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-300">
            <span className="font-semibold text-slate-200">
              Typisch am günstigsten:
            </span>{" "}
            {bestDay.day} {hourRunsLabel(bestDay.best.runs, 3)} —{" "}
            {isProb
              ? `${percentLabel(bestDay.best.value)} der Preise unter dem ${referenceLabel}`
              : `${euroPerLiter(bestDay.best.value)} in dieser Stunde (Tagesmedian ${euroPerLiter(bestDay.median)})`}
            {bestDay.best.tied
              ? `, ${bestDay.best.hours.length} Stunden gleichauf`
              : ""}
            .
          </p>
        )
      ) : null}
      {sampleLabel || rangeLabel || coverageNote ? (
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          <span className="font-semibold text-slate-300">Datenreichweite:</span>{" "}
          {[sampleLabel, rangeLabel].filter(Boolean).join(" · ") || "—"}
          {coverage && coverage.complete
            ? ` · Fenster ${heatmap.weeks} Wochen abgedeckt`
            : null}
          {coverageNote ? (
            <span className="mt-1 block text-amber-300/90">{coverageNote}</span>
          ) : null}
        </p>
      ) : null}
      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        {isProb
          ? byHour
            ? "Cheap-Probability: Anteil der Preise, die günstiger waren als der Median derselben Stunde über alle Wochentage. "
            : heatmap.station_id
              ? "Cheap-Probability: Anteil der Preise dieser Station, die unter dem Median aller Stationen derselben Zelle lagen. "
              : "Cheap-Probability: Anteil der Preise, die günstiger als der Gesamtmedian des Zeitraums waren — dabei dominiert der Tagesgang die Farben, Wochentage sind dann nur bedingt vergleichbar. "
          : "Niveau: mittlerer Literpreis je Wochentag und Stunde. "}
        Die Heatmap zeigt die <span className="text-slate-400">Vergangenheit</span>{" "}
        (letzte {heatmap.weeks} Wochen), keine Prognose für die kommende Woche.
        Eine Spalte ist genau <span className="text-slate-400">eine</span> Stunde
        (06 = 06:00–06:59 Uhr), deshalb steht die günstigste Stunde als Bereich
        „06–07 Uhr“ da — so ist sie im Raster wiederzufinden. Zellen mit
        weniger als{" "}
        {MIN_HEATMAP_POINTS} Preisen (·) zählen nicht — sonst würde ein
        einzelner Nacht-Preis die „günstigste Stunde“ bestimmen. Gleichauf
        liegende Stunden werden zusammen genannt („06–18 Uhr, 12 Stunden
        gleichauf“), statt willkürlich eine davon herauszugreifen; „dünn“
        markiert Stunden, deren Vergleichs-Basis unter{" "}
        {MIN_HEATMAP_REFERENCE} Preisen bleibt.
      </p>
    </div>
  );
}
