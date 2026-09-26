/**
 * robots.txt, as this crawler reads it.
 *
 * Pure. Follows the rules search engines actually apply (now RFC 9309): group
 * records by user-agent, pick the most specific matching group, and within it
 * let the longest matching path pattern win, with `Allow` beating `Disallow`
 * on a tie.
 *
 * A file that cannot be read at all is *not* treated as permission. The caller
 * gets `unavailable` and decides; the engine records `robotsTxtAllowed` as null
 * for every page and crawls on, so the operator sees that permission was never
 * checked rather than a claim either way.
 */

/** The largest robots.txt this crawler will read, in bytes. */
export const MAX_ROBOTS_BYTES = 512_000;

type Rule = {
  readonly allow: boolean;
  readonly pattern: string;
};

export type RobotsGroup = {
  readonly agents: readonly string[];
  readonly rules: readonly Rule[];
  readonly crawlDelaySeconds: number | null;
};

export type RobotsFile = {
  readonly groups: readonly RobotsGroup[];
  /** Absolute sitemap URLs declared in the file. */
  readonly sitemaps: readonly string[];
};

/**
 * Parses robots.txt.
 *
 * Unknown directives are ignored rather than treated as errors — the format
 * is extensible and a `Host:` line is not a reason to stop obeying the
 * `Disallow:` lines around it.
 */
export function parseRobots(text: string): RobotsFile {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];

  let agents: string[] = [];
  let rules: Rule[] = [];
  let crawlDelay: number | null = null;
  // A run of consecutive `User-agent:` lines heads one group; the first rule
  // line after them closes the run.
  let collectingAgents = false;

  const closeGroup = (): void => {
    if (agents.length > 0) {
      groups.push({ agents, rules, crawlDelaySeconds: crawlDelay });
    }
    agents = [];
    rules = [];
    crawlDelay = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (!collectingAgents) closeGroup();
      collectingAgents = true;
      if (value !== "") agents.push(value.toLowerCase());
      continue;
    }

    if (field === "sitemap") {
      if (value !== "") sitemaps.push(value);
      continue;
    }

    collectingAgents = false;
    if (field === "disallow") {
      // "Disallow:" with an empty value allows everything in the group. It is
      // not a rule against the empty path.
      if (value !== "") rules.push({ allow: false, pattern: value });
      continue;
    }
    if (field === "allow") {
      if (value !== "") rules.push({ allow: true, pattern: value });
      continue;
    }
    if (field === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) crawlDelay = seconds;
    }
  }
  closeGroup();

  return { groups, sitemaps };
}

/**
 * The group that governs `userAgent`.
 *
 * Most specific wins: an exact-ish match on the product token beats `*`. The
 * comparison is on a lower-cased substring, which is how the specification
 * defines it — a group for `nexrabot` governs `NexraBot/0.1 (+...)`.
 */
export function groupFor(file: RobotsFile, userAgent: string): RobotsGroup | null {
  const agent = userAgent.toLowerCase();
  let best: RobotsGroup | null = null;
  let bestLength = -1;
  let wildcard: RobotsGroup | null = null;

  for (const group of file.groups) {
    for (const candidate of group.agents) {
      if (candidate === "*") {
        wildcard ??= group;
        continue;
      }
      if (agent.includes(candidate) && candidate.length > bestLength) {
        best = group;
        bestLength = candidate.length;
      }
    }
  }
  return best ?? wildcard;
}

/**
 * Whether a pattern matches a path, with `*` as any run of characters and a
 * trailing `$` anchoring the end. Returns the matched length, or -1.
 */
function matchLength(pattern: string, path: string): number {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;

  if (!body.includes("*")) {
    if (anchored) return path === body ? body.length : -1;
    return path.startsWith(body) ? body.length : -1;
  }

  const escaped = body
    .split("*")
    .map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const expression = new RegExp(`^${escaped}${anchored ? "$" : ""}`);
  return expression.test(path) ? body.length : -1;
}

/**
 * Whether `pathWithQuery` may be fetched under this group.
 *
 * The longest matching pattern decides. `Allow` wins ties, which is what makes
 * the common "disallow a directory, allow one file inside it" pair work.
 */
export function isAllowed(group: RobotsGroup | null, pathWithQuery: string): boolean {
  if (group === null) return true;

  let decision = true;
  let decidedLength = -1;
  for (const rule of group.rules) {
    const length = matchLength(rule.pattern, pathWithQuery);
    if (length < 0) continue;
    if (length > decidedLength || (length === decidedLength && rule.allow)) {
      decision = rule.allow;
      decidedLength = length;
    }
  }
  return decision;
}

/** The path-and-query robots rules are matched against. */
export function robotsPath(url: URL): string {
  return `${url.pathname}${url.search}`;
}
