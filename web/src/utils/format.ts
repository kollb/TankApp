const numberFormat = (digits: number) =>
  new Intl.NumberFormat("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Missing, invalid and non-finite values stay visibly missing. */
export function euroPerLiter(value: number | null | undefined, decimals = 3): string {
  return value == null || !Number.isFinite(value) ? "—" : `${numberFormat(decimals).format(value)} €/L`;
}

export function centsPerLiter(value: number | null | undefined, decimals = 1): string {
  return value == null || !Number.isFinite(value) ? "—" : `${numberFormat(decimals).format(value)} ct/L`;
}

export function euros(value: number | null | undefined, decimals = 2): string {
  return value == null || !Number.isFinite(value) ? "—" : `${numberFormat(decimals).format(value)} €`;
}

export function countLabel(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : Math.round(value).toLocaleString("de-DE");
}

export function clockLabel(stamp?: string | null): string {
  if (!stamp || !Number.isFinite(Date.parse(stamp))) return "—";
  return new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(new Date(stamp));
}

export function ageLabel(stamp?: string | null, now = Date.now()): string {
  if (!stamp) return "—";
  const time = Date.parse(stamp);
  if (!Number.isFinite(time)) return "—";
  const minutes = Math.max(0, Math.round((now - time) / 60_000));
  if (minutes < 1) return "gerade eben";
  if (minutes === 1) return "vor 1 Minute";
  if (minutes < 60) return `vor ${minutes} Minuten`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return "vor 1 Stunde";
  if (hours < 24) return `vor ${hours} Stunden`;
  const days = Math.round(hours / 24);
  return days === 1 ? "vor 1 Tag" : `vor ${days} Tagen`;
}

export function applyAppTheme(theme: "dark" | "light"): void {
  const root = document.documentElement;
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme === "dark");
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0E1113" : "#f5fbf5");
}
