// Pure formatters — safe to import from client components (no server deps).

export const usd = (n: number | null | undefined): string =>
  n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export const num = (n: number | null | undefined): string =>
  n == null ? "—" : Number(n).toLocaleString();
