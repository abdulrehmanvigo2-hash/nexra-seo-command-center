/**
 * DataForSEO, the fixed facts (F0, PR 3; the design note is
 * docs/roadmap/F0-dataforseo-keyword-snapshot.md, §1 and §2). Pure and
 * client-safe: no credential, no environment read, no network.
 *
 * Mode: `sandbox` unless the mode variable holds exactly `live`. The sandbox
 * is free and answers dummy data in the real response structure; live charges
 * the account. The host follows the mode and nothing else.
 */

export const MODE_VARIABLE = "DATAFORSEO_MODE";
export const LOGIN_VARIABLE = "DATAFORSEO_LOGIN";
export const PASSWORD_VARIABLE = "DATAFORSEO_PASSWORD";
export const DAILY_CAP_VARIABLE = "DATAFORSEO_DAILY_CAP_USD";

export const PROVIDER = "dataforseo" as const;
export const SNAPSHOT_KIND = "keyword-snapshot" as const;

export type ProviderMode = "sandbox" | "live";

export const API_HOSTS: Readonly<Record<ProviderMode, string>> = {
  sandbox: "sandbox.dataforseo.com",
  live: "api.dataforseo.com",
};

/** Only the exact string "live" selects the live API; unset, empty or anything else is the sandbox. */
export function resolveMode(raw: string | undefined): ProviderMode {
  return raw === "live" ? "live" : "sandbox";
}

export const ENDPOINTS = {
  keywordOverview: "dataforseo_labs/google/keyword_overview/live",
  relatedKeywords: "dataforseo_labs/google/related_keywords/live",
} as const;
export type Endpoint = (typeof ENDPOINTS)[keyof typeof ENDPOINTS];

/** The related-keywords call's bounds: constants, never a request parameter (§1, worst case). */
export const RELATED_LIMIT = 20;
export const RELATED_DEPTH = 1;

/** Decision Q2: one location and language per run. */
export const LOCATION_CODE = 2840;
export const LANGUAGE_CODE = "en";
export const LOCATION_LABEL = "United States / English";

/** Decision Q1: the ten seed topics of F0 — since M1 PR 6 the default list an operator may change per run. */
export const SEED_TOPICS: readonly string[] = [
  "AI lead follow-up",
  "AI dead lead reactivation",
  "reactivate old CRM leads",
  "AI lead qualification",
  "automated lead follow-up",
  "AI SDR",
  "appointment booking automation",
  "WhatsApp lead automation",
  "AI receptionist for small business",
  "missed call text back",
];

/** Decision Q3: the default daily cap, and the SQL ceiling the database refuses any cap above. */
export const DEFAULT_DAILY_CAP_USD = 1.0;
export const DAILY_CAP_CEILING_USD = 5.0;

export type DailyCap = { readonly ok: true; readonly usd: number } | { readonly ok: false; readonly reason: "not-a-number" | "negative" | "above-ceiling" };

/**
 * The cap variable, parsed: unset or blank is the default; a value that will
 * not parse, is negative or is above the ceiling refuses every run rather
 * than falling back (the crawl configuration's rule).
 */
export function parseDailyCap(raw: string | undefined): DailyCap {
  const text = raw?.trim() ?? "";
  if (text === "") return { ok: true, usd: DEFAULT_DAILY_CAP_USD };
  if (!/^\d+(\.\d{1,4})?$/.test(text)) return { ok: false, reason: /^-/.test(text) ? "negative" : "not-a-number" };
  const usd = Number(text);
  if (usd > DAILY_CAP_CEILING_USD) return { ok: false, reason: "above-ceiling" };
  return { ok: true, usd };
}

/**
 * Public DataForSEO Labs prices after the ~20% rise of 1 Jul 2026, to be
 * re-confirmed on the provider's pricing page before any live run (§1).
 */
export const PRICE_PER_CALL_USD = 0.012;
export const PRICE_PER_ITEM_USD = 0.00012;
