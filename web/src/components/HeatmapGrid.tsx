// D1: Ausgelagerter Baustein aus Dashboard.tsx — die Wochentags×Stunden-Heatmap
// inklusive Tages-Zusammenfassungen (E5 Zeiträume, B12 Vergleichs-Basis,
// belastbare Zellen ab MIN_HEATMAP_POINTS).

import {
  MIN_HEATMAP_CELLS_PER_DAY,
  MIN_HEATMAP_POINTS,
  type Heatmap,
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
  const cellCount = (dIdx: number, h: number): number | null => {
    const row = heatmap.counts?.[dIdx];
    return row?.[h] ?? null;
  };
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

  const fmtVal = (v: number | null) => {
    if (v === null || !Number.isFinite(v)) return "—";
    if (isProb) return `${Math.round(v)}%`;
    return v.toFixed(3);
  };

  // C10: Tages-Zusammenfassung je Wochentag — Median + günstigste Stunde.
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

  const summaries = days
    .map((dayName, dIdx) => {
      const row = matrix[dIdx] ?? [];
      const vals = row.filter((v, h): v is number =>
        cellOk(v, dIdx, hours[h] ?? h),
      );
      // Unter 3 belastbaren Zellen bleibt die Zeile ehrlich leer — kein
      // Median und keine „günstigste Stunde“ aus 1–2 Nacht-Zellen.
      if (vals.length < MIN_HEATMAP_CELLS_PER_DAY) return null;
      const sorted = [...vals].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      let bestHour = hours[0] ?? 0;
      let bestValue = isProb ? -Infinity : Infinity;
      row.forEach((v, h) => {
        const hour = hours[h] ?? h;
        if (!cellOk(v, dIdx, hour)) return;
        if (isProb ? v > bestValue : v < bestValue) {
          bestValue = v;
          bestHour = hour;
        }
      });
      return { day: dayName, median, bestHour, bestValue, index: dIdx };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  const bestDay = summaries.length
    ? summaries.reduce((acc, s) =>
        isProb
          ? s.median > acc.median
            ? s
            : acc
          : s.median < acc.median
            ? s
            : acc,
      )
    : null;

  const blockLabel = (h: number) =>
    `${String(h).padStart(2, "0")}–${String((h + 2) % 24).padStart(2, "0")}`;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-center text-[10px] font-mono">
          <thead>
            <tr className="text-slate-500">
              <th className="p-1 text-left font-sans text-xs font-normal">Tag</th>
              <th className="p-1 text-left font-sans text-[10px] font-normal text-slate-600">
                Median
              </th>
              <th className="p-1 text-left font-sans text-[10px] font-normal text-slate-600">
                Günstigste Std.
              </th>
              {hours.map((h) => (
                <th key={h} className="p-1 font-normal">
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
                        ? `${Math.round(summary.median)} %`
                        : `${summary.median.toFixed(3)}`
                      : "—"}
                  </td>
                  <td className="p-1 text-left font-sans text-[10px] text-slate-400">
                    {summary ? blockLabel(summary.bestHour) : "—"}
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
                        title={`${dayName} ${String(h).padStart(2, "0")}:00 Uhr: ${thin ?? (isProb ? (shown !== null ? `${shown.toFixed(1)} % Chance günstiger als ${referenceLabel}` : "keine Daten") : (shown !== null ? `${shown.toFixed(3)} €/L Median` : "keine Daten"))}`}
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
      {bestDay && (
        <p className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs leading-relaxed text-slate-300">
          <span className="font-semibold text-slate-200">
            Typisch am günstigsten:
          </span>{" "}
          {bestDay.day} {blockLabel(bestDay.bestHour)} Uhr —{" "}
          {isProb
            ? `${Math.round(bestDay.bestValue)} % Chance günstig`
            : `Median ${bestDay.bestValue.toFixed(3)} €/L`}
          .
        </p>
      )}
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
        Zellen mit weniger als {MIN_HEATMAP_POINTS} Preisen (·) zählen nicht —
        sonst würde ein einzelner Nacht-Preis die „günstigste Stunde“
        bestimmen.
      </p>
    </div>
  );
}
