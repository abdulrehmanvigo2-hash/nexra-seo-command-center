/**
 * Display formatting for metric values.
 *
 * Every formatter pins the `en-US` locale explicitly. The dashboard renders on
 * the server and hydrates in the browser, so a locale-dependent string would
 * risk a hydration mismatch; formatting decisions also stay in one place
 * instead of being re-derived inside each component.
 */

const NUMBER = new Intl.NumberFormat("en-US");
const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Thousands-separated integer, e.g. 184920 -> "184,920". */
export function formatNumber(value: number): string {
  return NUMBER.format(Math.round(value));
}

/**
 * Short form for dense tiles, e.g. 184920 -> "184.9k", 1240000 -> "1.24M".
 * Values below 1,000 are returned unabbreviated.
 */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 1_000_000) {
    return `${sign}${trimZero(abs / 1_000_000, abs >= 10_000_000 ? 1 : 2)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${trimZero(abs / 1_000, abs >= 100_000 ? 1 : 1)}k`;
  }
  return `${sign}${Math.round(abs)}`;
}

/** Whole-dollar currency, e.g. 412800 -> "$412,800". */
export function formatCurrency(value: number): string {
  return CURRENCY.format(Math.round(value));
}

/** Abbreviated currency for tiles, e.g. 412800 -> "$412.8k". */
export function formatCurrencyCompact(value: number): string {
  return `$${formatCompact(value)}`;
}

/** Percentage with a fixed number of decimals, e.g. 43.62 -> "43.6%". */
export function formatPercent(value: number, precision = 1): string {
  return `${value.toFixed(precision)}%`;
}

/** Signed value for deltas, e.g. 342 -> "+342", -18 -> "−18". */
export function formatSigned(value: number): string {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${formatNumber(Math.abs(value))}`;
}

function trimZero(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** "6 Sep" — UTC based, so it never shifts with the viewer's time zone. */
export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** "6 Sep 2026". */
export function formatFullDate(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "Sep 2026" — used for month buckets on the 12-month range. */
export function formatMonth(iso: string): string {
  const date = new Date(iso);
  return `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}`;
}

/** "08:45 UTC" — the fixed clock time a fixture was generated at. */
export function formatTimeUtc(iso: string): string {
  const date = new Date(iso);
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes} UTC`;
}

/**
 * Relative age of an event, measured against an explicit reference instant
 * rather than the wall clock — the fixtures are static, so "now" has to be a
 * value the caller supplies for the label to stay stable across renders.
 */
export function formatRelative(iso: string, referenceIso: string): string {
  const minutes = Math.round(
    (Date.parse(referenceIso) - Date.parse(iso)) / 60_000,
  );

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;

  return `${Math.round(days / 7)}w ago`;
}
