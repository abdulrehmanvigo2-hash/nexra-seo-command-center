/**
 * What the crawl panel shows, as plain data.
 *
 * The React component around this is a shell: it owns a fetch and some markup,
 * and everything that could be wrong — which refusal means what, whether a
 * crawl that stopped on its budget is a success, what a null robots state is
 * allowed to claim — lives here, where `node --test` can reach it without a
 * DOM and without a network.
 *
 * The rule the wording follows throughout: never upgrade an absence into a
 * fact. `unavailable` is "could not be read", not "allowed" and not "absent";
 * a page that was discovered and skipped is not a page that failed.
 */

import type {
  Crawl,
  CrawlDocumentState,
  CrawlFailureReason,
  CrawlStatus,
  CrawlStopReason,
} from "@/types/crawl";

/** How the panel's own run is going. Distinct from the crawl's own status. */
export type CrawlRunState =
  /** Nothing asked for yet in this session. */
  | { readonly status: "idle" }
  /** A POST is in flight. The crawl runs inside that request. */
  | { readonly status: "running" }
  /** The crawl ran. It may still have ended `failed` — see `crawl.status`. */
  | { readonly status: "finished"; readonly crawl: Crawl }
  /** The server declined to start one, with a reason it named. */
  | { readonly status: "refused"; readonly reason: CrawlFailureReason; readonly message: string }
  /** The request itself did not produce an answer we can read. */
  | { readonly status: "failed"; readonly message: string };

export type Tone = "neutral" | "accent" | "positive" | "warning" | "critical";

/**
 * Why the server would not start a crawl, in an operator's terms.
 *
 * Each of these is a deliberate server decision, so the wording says what to
 * change rather than apologising. None of them is a bug to retry into.
 */
export const REFUSAL_MESSAGE: Readonly<Record<CrawlFailureReason, string>> = {
  disabled: "Crawling is switched off on this server. CRAWL_ENABLED is not set.",
  "host-not-allowed":
    "This project's domain is not on the server's crawl allow-list, so no request was made.",
  "unknown-project": "No project with this id exists.",
  "no-domain": "This project has no usable website domain to crawl.",
  "blocked-by-robots": "robots.txt disallows this crawler from the site's start URL.",
  "start-unreachable": "The start URL did not answer, so no crawl was recorded.",
  "start-unsafe":
    "The start URL resolved to an address this crawler refuses to connect to.",
  unavailable: "Crawls are not stored on this deployment's data source.",
};

const REASONS = Object.keys(REFUSAL_MESSAGE) as readonly CrawlFailureReason[];

function isFailureReason(value: unknown): value is CrawlFailureReason {
  return typeof value === "string" && (REASONS as readonly string[]).includes(value);
}

/**
 * Turns a non-2xx start response into panel state.
 *
 * A reason the server named is preferred over anything inferred from the
 * status code, because the codes are shared: 403 is both a refused host and a
 * cross-origin POST, and telling an operator to change the allow-list when
 * their session is the problem wastes their afternoon.
 */
export function startRefusal(httpStatus: number, body: unknown): CrawlRunState {
  const reason = (body as { error?: unknown } | null)?.error;
  if (isFailureReason(reason)) {
    return { status: "refused", reason, message: REFUSAL_MESSAGE[reason] };
  }

  if (httpStatus === 401) {
    return { status: "failed", message: "Your session has ended. Reload the page to sign in again." };
  }
  if (httpStatus === 403) {
    return { status: "failed", message: "This request was refused. Reload the page and try again." };
  }
  if (httpStatus === 429) {
    return {
      status: "failed",
      message: "A crawl is already running, or too many have been started. Wait before asking again.",
    };
  }
  return { status: "failed", message: "The crawl could not be started." };
}

/** How a finished crawl reads. `partial` is a result, not a failure. */
export const STATUS_LABEL: Readonly<
  Record<CrawlStatus, { readonly label: string; readonly tone: Tone; readonly title: string }>
> = {
  running: {
    label: "Running",
    tone: "accent",
    title: "The crawl is in progress.",
  },
  completed: {
    label: "Completed",
    tone: "positive",
    title: "Every reachable in-scope URL was visited within the budget.",
  },
  partial: {
    label: "Partial",
    tone: "positive",
    title: "A real result that stopped on its page or time budget. Everything reported was observed.",
  },
  failed: {
    label: "Failed",
    tone: "critical",
    title: "The crawl stopped on an error. See the recorded reason.",
  },
  cancelled: {
    label: "Cancelled",
    tone: "warning",
    title: "The crawl was cancelled before it finished.",
  },
};

const STOP_REASON: Readonly<Record<CrawlStopReason, string>> = {
  completed: "Every reachable in-scope URL was visited",
  "page-budget": "Stopped on the page budget",
  "time-budget": "Stopped on the time budget",
  error: "Stopped on an error",
  cancelled: "Cancelled",
};

const DOCUMENT_STATE: Readonly<Record<CrawlDocumentState, string>> = {
  fetched: "Read",
  absent: "Not present (404)",
  // Never "allowed", and never "none": nothing was established either way.
  unavailable: "Could not be read",
};

export type SummaryRow = {
  readonly label: string;
  readonly value: string;
  /** Hover text where the plain value could be over-read. */
  readonly title?: string;
};

/** Milliseconds a crawl took, or null when it has not finished. */
export function crawlDurationMs(crawl: Crawl): number | null {
  if (crawl.finishedAt === null) return null;
  const elapsed = Date.parse(crawl.finishedAt) - Date.parse(crawl.startedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * The recorded summary, in the order an operator reads it: what happened,
 * how much of the site it covers, and what the run was allowed to do.
 *
 * Pages are not listed here. The crawl API returns crawl rows, not page rows,
 * and inventing a page list in the browser from counts alone would be the one
 * thing this module exists to prevent.
 */
export function crawlSummary(crawl: Crawl): readonly SummaryRow[] {
  const duration = crawlDurationMs(crawl);

  return [
    { label: "Start URL", value: crawl.startUrl },
    {
      label: "Host scope",
      value: crawl.hostScope,
      title: "Every fetch was confined to this host or a subdomain of it.",
    },
    {
      label: "Outcome",
      value: crawl.stopReason === null ? "In progress" : STOP_REASON[crawl.stopReason],
    },
    {
      label: "URLs discovered",
      value: String(crawl.pagesDiscovered),
      title: "In-scope URLs this crawl knew about, including any it had no budget to reach.",
    },
    { label: "Pages fetched", value: String(crawl.pagesFetched) },
    {
      label: "Pages failed",
      value: String(crawl.pagesFailed),
      title: "Fetches that ended in an error. A URL skipped for budget is not counted here.",
    },
    {
      label: "robots.txt",
      value: DOCUMENT_STATE[crawl.robotsState],
      title: "\"Could not be read\" is never treated as permission.",
    },
    { label: "Sitemap", value: DOCUMENT_STATE[crawl.sitemapState] },
    {
      label: "Budget",
      value: `${crawl.budget.maxPages} pages · depth ${crawl.budget.maxDepth} · ${Math.round(
        crawl.budget.maxDurationMs / 1000,
      )} s`,
      title: "Server configuration for this run. The panel cannot change it.",
    },
    { label: "Duration", value: duration === null ? "—" : formatDuration(duration) },
    { label: "Crawl id", value: crawl.id },
  ];
}

/**
 * Whether the button may be pressed.
 *
 * One crawl at a time from this panel, matching the server, which holds an
 * in-flight set per operator and answers 429 to a second start. Refusing in
 * the browser too means an impatient double click is not a wasted round trip.
 */
export function canStart(run: CrawlRunState): boolean {
  return run.status !== "running";
}
