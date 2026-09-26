/**
 * What the server allows a crawl to do.
 *
 * Off unless switched on, and then only against hosts named explicitly. Two
 * separate gates, because they answer different questions: `CRAWL_ENABLED`
 * says whether this deployment may make outbound requests to client sites at
 * all, and `CRAWL_ALLOWED_HOSTS` says which sites. A deployment that acquires
 * the first without the second still cannot crawl anything.
 *
 * The allow-list is a second line beside the pinned connection in
 * `./pinned-request`, which closes the DNS-rebinding gap documented in
 * `./network-guard`: this crawler is still only ever pointed at hosts the
 * operator controls and has named.
 *
 * Nothing here is a secret. No value carries a credential, so none of these
 * variables is one — but none carries a `NEXT_PUBLIC_` name either, because
 * an allow-list is server policy and has no business in a browser bundle.
 */

import type { CrawlBudget } from "@/types/crawl";

export const CRAWL_ENABLED_VARIABLE = "CRAWL_ENABLED";
export const CRAWL_ALLOWED_HOSTS_VARIABLE = "CRAWL_ALLOWED_HOSTS";
export const CRAWL_USER_AGENT_VARIABLE = "CRAWL_USER_AGENT";
export const CRAWL_MAX_PAGES_VARIABLE = "CRAWL_MAX_PAGES";
export const CRAWL_MAX_DEPTH_VARIABLE = "CRAWL_MAX_DEPTH";
export const CRAWL_CONCURRENCY_VARIABLE = "CRAWL_CONCURRENCY";

/**
 * How this crawler identifies itself.
 *
 * A descriptive token with a contact URL, never a browser's user agent string:
 * a site operator must be able to see who is fetching and tell us to stop.
 */
export const DEFAULT_USER_AGENT = "NexraBot/0.1 (+https://nexraagency.com/bot)";

/**
 * Budgets sized for a crawl that runs inside one request.
 *
 * The time budget is the binding one: execution happens in the invoking
 * request, so it must finish well inside the platform's function limit.
 */
export const DEFAULT_BUDGET: CrawlBudget = {
  maxPages: 50,
  maxDepth: 3,
  maxDurationMs: 60_000,
};

export const MAX_PAGES_CEILING = 500;
export const MAX_DEPTH_CEILING = 10;
export const MAX_DURATION_CEILING_MS = 300_000;

/**
 * How many requests may be in flight at once.
 *
 * Three by default, matching the engine's own default, so setting nothing
 * changes nothing. The ceiling is deliberately low: a crawl is aimed at one
 * host, and the limit that matters is what a client's server is asked to
 * absorb, not what this process could manage. Five concurrent requests to a
 * single origin is already assertive; more would make a crawl hard to tell
 * apart from an attack, which is not a thing to leave configurable.
 */
export const DEFAULT_CONCURRENCY = 3;
export const MAX_CONCURRENCY_CEILING = 5;
/** Depth 0 is a real setting: fetch the start URL and follow nothing. */
export const MIN_DEPTH = 0;

type Environment = Readonly<Record<string, string | undefined>>;

export class CrawlConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrawlConfigurationError";
  }
}

export type CrawlConfig = {
  readonly enabled: boolean;
  /** Hosts a crawl may target. Empty means none, never "any". */
  readonly allowedHosts: readonly string[];
  readonly userAgent: string;
  readonly budget: CrawlBudget;
  /**
   * Requests in flight at once.
   *
   * Not part of the budget, and not stored on the crawl row: the budget says
   * what a crawl was allowed to observe, and a reader of the record needs
   * that. How quickly we asked is a property of the run, not of the readings
   * it produced.
   */
  readonly concurrency: number;
};

/**
 * Reads a whole number within a range, or refuses.
 *
 * Out-of-range and unparseable values are errors, never clamped to something
 * workable. A deployment that meant depth 1 and typed depth 100 has a
 * different crawl in mind than the one clamping would give it, and a crawler
 * that quietly widened its own limits would be the worst possible thing to
 * discover after the fact. Absent stays absent, and takes the default.
 */
function readBoundedInteger(
  env: Environment,
  variable: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[variable]?.trim() ?? "";
  if (raw === "") return fallback;

  // `Number` accepts "1e3", " 12 " and "0x5"; a crawl limit is a plain
  // decimal integer and anything else is a typo worth reporting.
  const parsed = /^-?\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new CrawlConfigurationError(
      `${variable} is "${raw}"; expected a whole number between ${minimum} and ${maximum}.`,
    );
  }
  return parsed;
}

function readFlag(value: string | undefined): boolean {
  const text = value?.trim().toLowerCase() ?? "";
  return text === "true" || text === "1" || text === "yes";
}

function readHosts(value: string | undefined): readonly string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/\.$/, ""))
    .filter((entry) => entry !== "");
}

/**
 * Reads the server's crawl settings.
 *
 * Every numeric limit is an error rather than a silent fallback when it will
 * not parse or sits outside its range: a deployment that meant to cap a crawl
 * at 10 pages and typed it wrongly should be told, not quietly given 50. The
 * whole call throws, so a misconfigured server refuses to crawl at all rather
 * than crawling with limits nobody chose.
 */
export function readCrawlConfig(env: Environment): CrawlConfig {
  const exposed = Object.keys(env).filter(
    (name) => name.startsWith("NEXT_PUBLIC_") && name.includes("CRAWL"),
  );
  if (exposed.length > 0) {
    throw new CrawlConfigurationError(
      `${exposed.join(", ")} would be bundled into the browser. Crawl settings are server policy; remove the NEXT_PUBLIC_ prefix.`,
    );
  }

  const maxPages = readBoundedInteger(
    env,
    CRAWL_MAX_PAGES_VARIABLE,
    DEFAULT_BUDGET.maxPages,
    1,
    MAX_PAGES_CEILING,
  );
  const maxDepth = readBoundedInteger(
    env,
    CRAWL_MAX_DEPTH_VARIABLE,
    DEFAULT_BUDGET.maxDepth,
    MIN_DEPTH,
    MAX_DEPTH_CEILING,
  );
  const concurrency = readBoundedInteger(
    env,
    CRAWL_CONCURRENCY_VARIABLE,
    DEFAULT_CONCURRENCY,
    1,
    MAX_CONCURRENCY_CEILING,
  );

  const userAgent = env[CRAWL_USER_AGENT_VARIABLE]?.trim() || DEFAULT_USER_AGENT;

  return {
    enabled: readFlag(env[CRAWL_ENABLED_VARIABLE]),
    allowedHosts: readHosts(env[CRAWL_ALLOWED_HOSTS_VARIABLE]),
    userAgent,
    budget: { ...DEFAULT_BUDGET, maxPages, maxDepth },
    concurrency,
  };
}

/**
 * Whether a host may be crawled.
 *
 * Exact match only. A subdomain is not implied by its parent being listed:
 * naming `example.com` must not silently authorise `anything.example.com`,
 * because the operator may control one and not the other.
 */
export function isHostAllowed(config: CrawlConfig, host: string): boolean {
  return config.allowedHosts.includes(host.toLowerCase().replace(/\.$/, ""));
}
