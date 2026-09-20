/**
 * What the server allows a crawl to do.
 *
 * Off unless switched on, and then only against hosts named explicitly. Two
 * separate gates, because they answer different questions: `CRAWL_ENABLED`
 * says whether this deployment may make outbound requests to client sites at
 * all, and `CRAWL_ALLOWED_HOSTS` says which sites. A deployment that acquires
 * the first without the second still cannot crawl anything.
 *
 * The allow-list is also the current mitigation for the DNS-rebinding gap
 * documented in `./network-guard`: while that gap is open, this crawler must
 * only ever be pointed at hosts the operator controls and has named.
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
};

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
 * An unreadable page budget is an error rather than a silent fallback: a
 * deployment that meant to cap a crawl at 10 pages and typed it wrongly should
 * be told, not quietly given 50.
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

  let maxPages = DEFAULT_BUDGET.maxPages;
  const rawMaxPages = env[CRAWL_MAX_PAGES_VARIABLE]?.trim() ?? "";
  if (rawMaxPages !== "") {
    const parsed = Number(rawMaxPages);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PAGES_CEILING) {
      throw new CrawlConfigurationError(
        `${CRAWL_MAX_PAGES_VARIABLE} is "${rawMaxPages}"; expected a whole number between 1 and ${MAX_PAGES_CEILING}.`,
      );
    }
    maxPages = parsed;
  }

  const userAgent = env[CRAWL_USER_AGENT_VARIABLE]?.trim() || DEFAULT_USER_AGENT;

  return {
    enabled: readFlag(env[CRAWL_ENABLED_VARIABLE]),
    allowedHosts: readHosts(env[CRAWL_ALLOWED_HOSTS_VARIABLE]),
    userAgent,
    budget: { ...DEFAULT_BUDGET, maxPages },
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
