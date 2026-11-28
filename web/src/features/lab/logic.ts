export interface ReliabilityBinView {
  range: string;
  predicted: number | null;
  observed: number | null;
  count: number;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function probabilityRange(low: number, high: number): string {
  const format = (value: number) => value.toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
  return `${format(low)}–${format(high)}`;
}

/** Map the API's gate reliability-bin schema to accessible chart labels. */
export function reliabilityBinView(bin: Record<string, unknown>, index: number): ReliabilityBinView {
  const low = finiteNumber(bin.lo);
  const high = finiteNumber(bin.hi);
  return {
    range: low != null && high != null
      ? probabilityRange(low, high)
      : String(bin.range ?? bin.bin ?? index + 1),
    predicted: finiteNumber(bin.p) ?? finiteNumber(bin.mean_p) ?? finiteNumber(bin.predicted),
    observed: finiteNumber(bin.rate) ?? finiteNumber(bin.empirical_hit_rate) ?? finiteNumber(bin.observed) ?? finiteNumber(bin.actual),
    count: finiteNumber(bin.n) ?? finiteNumber(bin.count) ?? 0,
  };
}
