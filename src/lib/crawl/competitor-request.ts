/**
 * Asking for a crawl of one recorded competitor domain, as plain data.
 *
 * The panel around this owns a button per domain and some markup. What could
 * misrepresent a competitor crawl lives here: which domains may be offered at
 * all (only the ones the server recorded for the project at intake), what the
 * request body is, how a refusal reads, and what a recorded crawl of a
 * rival's site is allowed to claim.
 *
 * Two rules the wording follows. A competitor crawl is a fetch of a site the
 * agency does not control, so every line says whose site it is and never
 * calls it "the project". And nothing here reviews anything: a recorded
 * competitor crawl is evidence collected, not a finding, and no agent is
 * offered on it in this milestone.
 */

import { canonicalCompetitorHost, recordedCompetitorHost, resolveCompetitorTarget } from "@/lib/crawl/competitor-target";
import { REFUSAL_MESSAGE, STATUS_LABEL, startRefusal, type CrawlRunState } from "@/lib/crawl/panel-state";
import type { Crawl, CrawlFailureReason } from "@/types/crawl";

export type CompetitorCrawlPayload = {
  readonly projectId: string;
  readonly competitorDomain: string;
};

export type CompetitorQueueability =
  | { readonly ok: true; readonly payload: CompetitorCrawlPayload; readonly host: string }
  | { readonly ok: false; readonly why: string };

/**
 * The competitor domains the panel may offer: the recorded list, canonical,
 * with anything that is not a usable hostname or that is the project's own
 * site left out. The server applies the same rule again on every request.
 */
export function offeredCompetitorHosts(projectDomain: string, recorded: readonly string[]): readonly string[] {
  const hosts: string[] = [];
  for (const entry of recorded) {
    // A stored entry is reduced to its host first; the host then has to pass
    // the same rule a request would, so what is offered is what the server
    // would accept.
    const host = recordedCompetitorHost(entry);
    if (host === null) continue;
    const target = resolveCompetitorTarget({ competitorDomain: host, projectDomain, recordedCompetitorDomains: recorded });
    if (target.ok && !hosts.includes(target.host)) hosts.push(target.host);
  }
  return hosts;
}

/**
 * Whether this domain can be asked for, and the body that would ask.
 *
 * The same rule the server applies, so the control explains itself instead
 * of being clicked and refused. The server remains the gate: it re-reads the
 * project's recorded list at request time and checks the allow-list.
 */
export function competitorCrawlRequest(
  projectId: string | null,
  projectDomain: string,
  competitorDomain: string,
  recorded: readonly string[],
): CompetitorQueueability {
  if (!projectId) return { ok: false, why: "No project is selected." };
  const target = resolveCompetitorTarget({ competitorDomain, projectDomain, recordedCompetitorDomains: recorded });
  if (!target.ok) return { ok: false, why: REFUSAL_MESSAGE[target.reason] };
  return { ok: true, host: target.host, payload: { projectId, competitorDomain: target.host } };
}

/** The existing list endpoint, filtered to this project and this competitor host. */
export function competitorCrawlsUrl(projectId: string, host: string, limit = 1): string {
  const params = new URLSearchParams({ project: projectId, competitor: host, limit: String(limit) });
  return `/api/crawls?${params.toString()}`;
}

/**
 * Refusal wording for a competitor crawl.
 *
 * The shared messages say "this project's domain" where the host in question
 * is the rival's, so the two reasons that name a host are reworded; every
 * other reason means the same thing for either target.
 */
const COMPETITOR_WORDING: Readonly<Partial<Record<CrawlFailureReason, string>>> = {
  "host-not-allowed":
    "This competitor's host is not on the server's crawl allow-list, so no request was made. An operator must add it before it can be crawled.",
  "no-domain": "This project has no usable website domain, so no competitor can be told apart from it.",
};

export function competitorStartRefusal(httpStatus: number, body: unknown): CrawlRunState {
  const state = startRefusal(httpStatus, body);
  if (state.status !== "refused") return state;
  return { ...state, message: COMPETITOR_WORDING[state.reason] ?? state.message };
}

/**
 * How a recorded competitor crawl reads, in one line.
 *
 * Counts and status only. A crawl of a rival's site establishes what that
 * site's pages returned to this crawler and nothing about how the rival
 * performs; the wording never calls it more than that.
 */
export function describeCompetitorCrawl(crawl: Crawl): {
  readonly label: string;
  readonly tone: (typeof STATUS_LABEL)[Crawl["status"]]["tone"];
  readonly detail: string;
} {
  const status = STATUS_LABEL[crawl.status];
  const counts =
    crawl.status === "running"
      ? "In progress."
      : `${crawl.pagesFetched} page${crawl.pagesFetched === 1 ? "" : "s"} fetched, ${crawl.pagesFailed} failed, ${crawl.pagesDiscovered} discovered.`;
  return {
    label: status.label,
    tone: status.tone,
    detail: `${counts} Recorded pages of ${crawl.hostScope} only; nothing here measures the competitor.`,
  };
}

/** The host a recorded crawl fetched, for a list keyed by competitor. */
export function competitorHostOf(crawl: Pick<Crawl, "hostScope">): string | null {
  return canonicalCompetitorHost(crawl.hostScope);
}
