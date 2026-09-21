/**
 * Which site a crawl may be aimed at besides the project's own, and how a
 * recorded crawl is told apart afterwards.
 *
 * The project's own site is the only target the crawler took until now, and
 * the host has always come from the stored project record, never from a
 * request. A competitor crawl keeps that rule in a different form: an
 * operator may name a domain, but only one the agency recorded for the
 * project at intake, matched on the server against the stored list after the
 * same canonicalisation the crawler applies to the project's own domain. A
 * URL, a path, a port, an address, or a domain the project never recorded is
 * refused here, before the allow-list is consulted and before anything is
 * fetched.
 *
 * Nothing is stored to say whose site a crawl was. The row carries the host it
 * was confined to, and that host either sits inside the project's own host
 * scope or it does not, which is a fact the row already holds. Deriving the
 * target from it means an old row and a new row are classified by one rule,
 * and no column can drift from the host it describes.
 *
 * Pure, with no server-only import, so the request builder in the browser
 * and the service on the server apply exactly the same rule.
 */

import { hostScopeFromDomain, isWithinHostScope } from "@/lib/crawl/url-policy";
import type { Crawl, CrawlFailureReason, CrawlTarget } from "@/types/crawl";

/** The longest hostname the DNS allows. Anything longer is not a domain. */
export const MAX_COMPETITOR_HOST_LENGTH = 253;

export type CompetitorTargetRefusal = Extract<
  CrawlFailureReason,
  "competitor-invalid" | "competitor-not-recorded" | "competitor-is-project-site" | "no-domain"
>;

export type CompetitorTargetResult =
  | { readonly ok: true; readonly host: string }
  | { readonly ok: false; readonly reason: CompetitorTargetRefusal };

/**
 * The host a requested competitor domain names, or null.
 *
 * A plain hostname only, as the crawler's own domain rule defines it: no
 * scheme, no path, no query, no port, no address, no whitespace. The length
 * ceiling is checked before the pattern so a pathological input costs
 * nothing.
 */
export function canonicalCompetitorHost(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_COMPETITOR_HOST_LENGTH) return null;
  const host = hostScopeFromDomain(trimmed);
  // The crawler's domain rule accepts any dotted labels, and the network guard
  // would refuse a private address at fetch time. A competitor is a website,
  // never an address, so a dotted number is refused here, before any of that:
  // a name whose last label is all digits is an IPv4 literal, not a domain.
  if (host === null || /^\d+$/.test(host.slice(host.lastIndexOf(".") + 1))) return null;
  return host;
}

/**
 * The host a recorded intake entry names, or null.
 *
 * Intake stores a competitor as a canonical domain that may still carry a
 * path (`rival.example/blog`), and older entries may carry a scheme. The host
 * is what a crawl is confined to, so the entry is reduced to it before it is
 * compared. This leniency is for the stored record only: a request must name
 * a bare hostname, and `canonicalCompetitorHost` refuses anything else.
 */
export function recordedCompetitorHost(entry: unknown): string | null {
  if (typeof entry !== "string") return null;
  const host = entry.trim().replace(/^https?:\/\//i, "").split(/[/?#]/, 1)[0] ?? "";
  return canonicalCompetitorHost(host);
}

/**
 * Whether a requested competitor domain may be crawled for this project, and
 * the host it resolves to.
 *
 * Checked in this order, each before the next: the request is a hostname; the
 * project's own domain is usable; the host is not the project's own site or
 * inside its scope, in either direction; the host is one the project recorded
 * at intake. The recorded list is canonicalised with the same rule as the
 * request, so `https://Rival.example/` at intake and `rival.example` here are
 * one host, and an entry that is not itself a hostname can never match.
 */
export function resolveCompetitorTarget(request: {
  readonly competitorDomain: unknown;
  readonly projectDomain: string;
  readonly recordedCompetitorDomains: readonly string[];
}): CompetitorTargetResult {
  const host = canonicalCompetitorHost(request.competitorDomain);
  if (host === null) return { ok: false, reason: "competitor-invalid" };

  const projectHost = hostScopeFromDomain(request.projectDomain);
  if (projectHost === null) return { ok: false, reason: "no-domain" };

  if (isWithinHostScope(host, projectHost) || isWithinHostScope(projectHost, host)) {
    return { ok: false, reason: "competitor-is-project-site" };
  }

  const recorded = request.recordedCompetitorDomains
    .map((entry) => recordedCompetitorHost(entry))
    .filter((entry): entry is string => entry !== null);
  if (!recorded.includes(host)) return { ok: false, reason: "competitor-not-recorded" };

  return { ok: true, host };
}

/**
 * Whose site a recorded crawl fetched, from its host scope and the project's
 * stored domain.
 *
 * A crawl whose host is the project's own host or a subdomain of it is the
 * project's site. Anything else is a competitor's. A project whose domain is
 * not a usable hostname owns no site crawl, so every crawl of its is
 * classified as a competitor's — the conservative answer for every consumer,
 * because a competitor crawl is the one the project's own reviews must never
 * read.
 */
export function crawlTarget(crawl: Pick<Crawl, "hostScope">, projectDomain: string): CrawlTarget {
  const projectHost = hostScopeFromDomain(projectDomain);
  if (projectHost === null) return "competitor-site";
  return isWithinHostScope(crawl.hostScope, projectHost) ? "project-site" : "competitor-site";
}

export function isProjectSiteCrawl(crawl: Pick<Crawl, "hostScope">, projectDomain: string): boolean {
  return crawlTarget(crawl, projectDomain) === "project-site";
}
