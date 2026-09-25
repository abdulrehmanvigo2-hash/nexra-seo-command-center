/**
 * A lexical search-intent hint for one observed query (milestone M4).
 *
 * Derived, not observed, and deterministic: fixed word lists over the
 * query's own words decide the hint, and the word that decided it is
 * returned beside it so a reader can see why. Search Console records what
 * was typed and clicked, never why, so a hint is a starting point for a
 * person or an agent — the Keyword & Search Intent agent still infers intent
 * in its own review — and never a classification of the searcher.
 *
 * Precedence, where more than one list matches: navigational (the query
 * names the brand) wins, then transactional, then local, then commercial,
 * then informational. "Unclassified" means no list matched; it is not a
 * fifth intent.
 */

import type { SearchIntent } from "@/types/seo";

export type IntentHint = SearchIntent | "unclassified";

/** The provenance every hint carries. A hint never says "observed". */
export const INTENT_PROVENANCE = "lexical hint, derived from the query's own words; not an observation";

const INFORMATIONAL = new Set(["how", "what", "why", "when", "where", "who", "which", "guide", "guides", "tutorial", "tutorials", "example", "examples", "meaning", "definition", "define", "explained", "tips", "ideas", "checklist", "learn", "vs", "versus", "difference", "is", "are", "does", "do", "can", "should"]);
const TRANSACTIONAL = new Set(["buy", "price", "prices", "pricing", "cost", "costs", "cheap", "cheapest", "discount", "deal", "deals", "coupon", "order", "hire", "quote", "quotes", "book", "booking", "subscribe", "subscription", "purchase", "download"]);
const LOCAL = new Set(["near", "nearby", "local", "in", "around"]);
const COMMERCIAL = new Set(["best", "top", "review", "reviews", "compare", "comparison", "alternative", "alternatives", "agency", "agencies", "service", "services", "company", "companies", "software", "tool", "tools", "platform", "platforms", "provider", "providers", "consultant", "consultants", "consultancy", "firm", "firms", "solution", "solutions", "vendor", "vendors"]);
const NAVIGATIONAL = new Set(["login", "signin", "log", "sign", "account", "dashboard"]);

/**
 * The query's words: lower-cased, Unicode-normalised, split on anything
 * that is not a letter or digit. Deterministic and locale-independent.
 */
export function tokensOf(query: string): readonly string[] {
  return query
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

/**
 * The words that name the project, for the navigational hint: the host's
 * registrable label (nexraagency.com → "nexraagency") and each word of the
 * project's name of at least four letters, so "seo" or "the" never marks a
 * query as navigational.
 */
/** Words a business name carries that name no brand: "agency" in "Nexra Agency" marks nothing as navigational. */
const GENERIC_NAME_WORDS = new Set(["agency", "agencies", "company", "group", "limited", "holdings", "services", "service", "studio", "studios", "media", "digital", "marketing", "consulting", "consultancy", "partners", "solutions", "software", "labs", "brands", "retail", "clinics", "clinic", "logistics", "legal", "industrial", "realty", "fintech", "home", "outdoors"]);

export function brandTokensOf(projectName: string, domainOrProperty: string): readonly string[] {
  const host = domainOrProperty
    .replace(/^sc-domain:/i, "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  const labels = host.split(".").filter((label) => label.length > 0 && label !== "www");
  const hostLabel = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  const nameTokens = tokensOf(projectName).filter((token) => token.length >= 4 && !GENERIC_NAME_WORDS.has(token));
  const brand = new Set<string>(nameTokens);
  if (hostLabel && hostLabel.length >= 4) brand.add(hostLabel);
  return [...brand].sort();
}

export type IntentHintResult = {
  readonly intent: IntentHint;
  /** The word that decided the hint, or null when unclassified. */
  readonly marker: string | null;
};

export function intentHintOf(query: string, brandTokens: readonly string[]): IntentHintResult {
  const tokens = tokensOf(query);
  const joined = tokens.join("");
  const brand = brandTokens.find((token) => tokens.includes(token) || (token.length >= 6 && joined.includes(token)));
  if (brand !== undefined) return { intent: "navigational", marker: brand };
  const pick = (list: ReadonlySet<string>) => tokens.find((token) => list.has(token));
  const navigational = pick(NAVIGATIONAL);
  if (navigational !== undefined && (navigational !== "log" || tokens.includes("in")) && (navigational !== "sign" || tokens.includes("in"))) {
    return { intent: "navigational", marker: navigational };
  }
  const transactional = pick(TRANSACTIONAL);
  if (transactional !== undefined) return { intent: "transactional", marker: transactional };
  const local = tokens.includes("near") && tokens.includes("me") ? "near me" : pick(LOCAL);
  // "in" alone is a preposition; it marks local intent only as "in <place>", which lexical rules cannot see, so it is skipped.
  if (local !== undefined && local !== "in" && local !== "around") return { intent: "local", marker: local };
  const commercial = pick(COMMERCIAL);
  if (commercial !== undefined) return { intent: "commercial", marker: commercial };
  const informational = pick(INFORMATIONAL);
  if (informational !== undefined) return { intent: "informational", marker: informational };
  return { intent: "unclassified", marker: null };
}
