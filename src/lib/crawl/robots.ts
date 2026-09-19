import type { RobotsGroup, RobotsPolicy, RobotsRule } from "@/types/crawl";

/**
 * robots.txt, as the crawler reads it.
 *
 * Pure: it turns the text of a file into rules and answers whether a path is
 * allowed. Fetching the file is the fetcher's job, and deciding what to do
 * about a site that will not serve one is `@/types/crawl`'s `RobotsPolicy`.
 *
 * Follows the behaviour search engines actually implement (RFC 9309), because
 * a site owner writes their file expecting that and not a stricter or looser
 * reading of it:
 *
 *   * groups are matched by the most specific user-agent token, not the first
 *     one that appears;
 *   * `*` matches any run of characters and a trailing `$` anchors the end;
 *   * the longest matching pattern wins, and `allow` wins a tie, so a broad
 *     `Disallow: /` with a narrow `Allow:` beneath it works as intended;
 *   * an empty `Disallow:` is a permission, not a prohibition;
 *   * unknown directives are ignored rather than treated as errors.
 */

/** How the crawler names itself, in robots.txt and in the request header. */
export const CRAWLER_TOKEN = "nexrabot";

/** Longest robots.txt the crawler will read. Beyond this it stops parsing. */
export const MAX_ROBOTS_BYTES = 512_000;

/** Bounds on how long a site may ask the crawler to wait between requests. */
export const MAX_CRAWL_DELAY_SECONDS = 30;

type Directive = { readonly field: string; readonly value: string };

function directiveOf(line: string): Directive | null {
  // A comment runs to the end of the line, wherever it starts.
  const withoutComment = line.split("#")[0];
  const separator = withoutComment.indexOf(":");
  if (separator === -1) return null;
  const field = withoutComment.slice(0, separator).trim().toLowerCase();
  const value = withoutComment.slice(separator + 1).trim();
  return field === "" ? null : { field, value };
}

/**
 * Parses the file into groups.
 *
 * Consecutive `user-agent` lines share the group that follows them; a rule line
 * closes the run, so the next `user-agent` starts a new group. `sitemap` is not
 * part of any group — it applies to the file as a whole, wherever it appears.
 */
export function parseRobots(text: string): RobotsPolicy {
  const body = text.length > MAX_ROBOTS_BYTES ? text.slice(0, MAX_ROBOTS_BYTES) : text;

  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];

  let agents: string[] = [];
  let rules: RobotsRule[] = [];
  let crawlDelaySeconds: number | null = null;
  let collectingAgents = false;

  const closeGroup = () => {
    if (agents.length > 0) {
      groups.push({ agents, rules, crawlDelaySeconds });
    }
    agents = [];
    rules = [];
    crawlDelaySeconds = null;
  };

  for (const line of body.split(/\r\n|\r|\n/)) {
    const directive = directiveOf(line);
    if (!directive) continue;

    switch (directive.field) {
      case "user-agent": {
        if (!collectingAgents) closeGroup();
        collectingAgents = true;
        const token = directive.value.toLowerCase();
        if (token.length > 0) agents.push(token);
        break;
      }
      case "allow":
      case "disallow": {
        collectingAgents = false;
        if (agents.length === 0) break; // A rule with no group above it applies to nobody.
        const allow = directive.field === "allow";
        // "Disallow:" with nothing after it permits everything, and is not a rule.
        if (!allow && directive.value === "") break;
        if (allow && directive.value === "") break;
        rules.push({ allow, pattern: directive.value });
        break;
      }
      case "crawl-delay": {
        collectingAgents = false;
        const seconds = Number(directive.value);
        if (Number.isFinite(seconds) && seconds >= 0) {
          crawlDelaySeconds = Math.min(seconds, MAX_CRAWL_DELAY_SECONDS);
        }
        break;
      }
      case "sitemap": {
        // Deliberately outside the group machinery: it is a file-level line and
        // must not close a group or be attributed to one.
        if (directive.value.length > 0) sitemaps.push(directive.value);
        break;
      }
      default:
        break;
    }
  }
  closeGroup();

  return { state: "parsed", groups, sitemaps };
}

/**
 * The group that applies to one user agent.
 *
 * The most specific match wins: the longest agent token that is a prefix of
 * ours, falling back to `*`. A file naming both `nexrabot` and `*` is telling
 * us to read the first and ignore the second.
 */
export function groupFor(
  policy: Extract<RobotsPolicy, { state: "parsed" }>,
  token: string = CRAWLER_TOKEN,
): RobotsGroup | null {
  const agent = token.toLowerCase();
  let best: { group: RobotsGroup; length: number } | null = null;
  let wildcard: RobotsGroup | null = null;

  for (const group of policy.groups) {
    for (const candidate of group.agents) {
      if (candidate === "*") {
        wildcard ??= group;
        continue;
      }
      if (agent.startsWith(candidate) && (best === null || candidate.length > best.length)) {
        best = { group, length: candidate.length };
      }
    }
  }

  return best?.group ?? wildcard;
}

/** Whether a robots pattern matches a path, honouring `*` and a trailing `$`. */
export function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;

  // Built from the pattern's own literal segments, so nothing in a site's file
  // can be read as regular-expression syntax.
  const source = body
    .split("*")
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");

  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
}

/**
 * Whether the crawler may fetch a path.
 *
 * Takes the path with its query string, which is what a pattern is written
 * against. A site with no rules for us, or no file at all, allows everything; a
 * site that could not tell us allows nothing (see `RobotsPolicy`).
 */
export function isAllowed(
  policy: RobotsPolicy,
  pathAndQuery: string,
  token: string = CRAWLER_TOKEN,
): boolean {
  if (policy.state === "missing") return true;
  if (policy.state === "unavailable") return false;

  const group = groupFor(policy, token);
  if (!group) return true;

  let decision: { allow: boolean; length: number } | null = null;
  for (const rule of group.rules) {
    if (!patternMatches(rule.pattern, pathAndQuery)) continue;
    const length = rule.pattern.length;
    if (
      decision === null ||
      length > decision.length ||
      // Equal specificity: the permission wins, as search engines resolve it.
      (length === decision.length && rule.allow)
    ) {
      decision = { allow: rule.allow, length };
    }
  }

  return decision?.allow ?? true;
}

/** How long to wait between requests, in milliseconds, or null if unstated. */
export function crawlDelayMs(
  policy: RobotsPolicy,
  token: string = CRAWLER_TOKEN,
): number | null {
  if (policy.state !== "parsed") return null;
  const seconds = groupFor(policy, token)?.crawlDelaySeconds;
  return seconds === null || seconds === undefined ? null : Math.round(seconds * 1_000);
}
