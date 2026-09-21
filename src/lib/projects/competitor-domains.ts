/**
 * The competitor domains an operator may record for a project, as one rule.
 *
 * Intake accepts a competitor as a canonical domain that may carry a path;
 * editing after intake is stricter, because the list is now what authorises
 * a competitor crawl (`@/lib/crawl/competitor-target`): a recorded entry is a
 * bare hostname and nothing else. The rule here is the crawler's own host
 * rule, so what is saved is exactly what a crawl may later be aimed at, and
 * the browser and the server apply it identically — the server's answer is
 * the one that counts.
 *
 * Pure, with no server-only import.
 */

import { canonicalCompetitorHost } from "@/lib/crawl/competitor-target";
import { hostScopeFromDomain, isWithinHostScope } from "@/lib/crawl/url-policy";
import { MAX_COMPETITORS } from "@/lib/projects/intake-rules";

/** The same ceiling intake applies and the table enforces. */
export const MAX_COMPETITOR_DOMAINS = MAX_COMPETITORS;

export type CompetitorDomainsProblem =
  /** The submission is not a list of text. */
  | "not-a-list"
  | "too-many"
  /** An entry is not a bare hostname: a URL, path, port, address, or bare word. */
  | "invalid-domain"
  /** An entry is the project's own site, a subdomain of it, or a parent of it. */
  | "own-site"
  /** Two entries name the same host once canonicalised. */
  | "duplicate"
  /** The project's own domain is not a usable hostname, so nothing can be told apart from it. */
  | "no-project-domain";

export type ParsedCompetitorDomains =
  | { readonly ok: true; readonly value: readonly string[] }
  | { readonly ok: false; readonly problem: CompetitorDomainsProblem; readonly index: number | null };

/** Fixed wording per problem, for the browser and for the action's answer. */
export const COMPETITOR_DOMAINS_MESSAGE: Readonly<Record<CompetitorDomainsProblem, string>> = {
  "not-a-list": "Competitor domains must be a list of domains.",
  "too-many": `Track at most ${MAX_COMPETITOR_DOMAINS} competitors.`,
  "invalid-domain": "Enter a bare domain, for example northpeak.example — no scheme, path, port or address.",
  "own-site": "That is this project's own site, not a competitor.",
  duplicate: "That domain is already in the list.",
  "no-project-domain": "This project has no usable website domain, so competitors cannot be told apart from it.",
};

/**
 * The whole list a project would be saved with, or the first problem in it.
 *
 * Every entry is canonicalised before it is compared, so `Rival.Example.`
 * and `rival.example` are one host, and one of them is refused as a
 * duplicate. The problem's `index` names the offending entry so a form can
 * point at it; nothing of the entry itself is echoed.
 */
export function parseCompetitorDomains(input: unknown, projectDomain: string): ParsedCompetitorDomains {
  if (!Array.isArray(input) || input.some((entry) => typeof entry !== "string")) {
    return { ok: false, problem: "not-a-list", index: null };
  }
  if (input.length > MAX_COMPETITOR_DOMAINS) return { ok: false, problem: "too-many", index: null };

  const projectHost = hostScopeFromDomain(projectDomain);
  if (projectHost === null) return { ok: false, problem: "no-project-domain", index: null };

  const value: string[] = [];
  for (const [index, entry] of (input as readonly string[]).entries()) {
    const host = canonicalCompetitorHost(entry);
    if (host === null) return { ok: false, problem: "invalid-domain", index };
    if (isWithinHostScope(host, projectHost) || isWithinHostScope(projectHost, host)) {
      return { ok: false, problem: "own-site", index };
    }
    if (value.includes(host)) return { ok: false, problem: "duplicate", index };
    value.push(host);
  }
  return { ok: true, value };
}

/**
 * One entry added to a draft list, or why it cannot be.
 *
 * The form's rule, built on the list rule: the new entry is checked on its
 * own and against what is already there, and the message names the problem
 * in the operator's terms.
 */
export function addCompetitorDomain(
  current: readonly string[],
  entry: string,
  projectDomain: string,
): { readonly ok: true; readonly value: readonly string[] } | { readonly ok: false; readonly message: string } {
  const trimmed = entry.trim();
  if (trimmed.length === 0) return { ok: false, message: "Enter a competitor domain to track." };
  const parsed = parseCompetitorDomains([...current, trimmed], projectDomain);
  if (!parsed.ok) return { ok: false, message: COMPETITOR_DOMAINS_MESSAGE[parsed.problem] };
  return { ok: true, value: parsed.value };
}

/** Whether two saved-form lists are the same list, in order. */
export function sameCompetitorDomains(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}
