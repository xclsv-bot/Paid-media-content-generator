// Pure formatters — safe to import from client components (no server deps).

export const usd = (n: number | null | undefined): string =>
  n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export const num = (n: number | null | undefined): string =>
  n == null ? "—" : Number(n).toLocaleString();

// "2026-07-08" → "Jul 8". Bare ISO dates parse as UTC in JS, which renders
// the previous day in negative-offset timezones — pin to local midnight.
export const fmtDay = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const t = Date.parse(iso.includes("T") ? iso : `${iso}T00:00:00`);
  return Number.isNaN(t)
    ? iso
    : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
