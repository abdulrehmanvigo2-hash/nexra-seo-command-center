import { randInt } from "@/lib/mock/dashboard/core";
import { PROJECTS } from "@/lib/mock/projects/roster";
import { getBasePages } from "@/lib/mock/technical/pages";
import { severityFor } from "@/lib/mock/technical/scoring";
import type {
  AgentAccessSummary,
  AgentDirective,
  AiAgentId,
  AiAgentRecord,
  ProjectAgentDirective,
} from "@/types/technical";

/**
 * Whether generative crawlers can reach the site at all.
 *
 * The gap this closes: an answer engine that cannot fetch a page cannot quote
 * it, however well the page is written. Nothing else in this product modelled
 * that — general crawlability covers Googlebot and its peers, and the robots
 * meta directive covers indexing, but neither says anything about the agents
 * that fetch pages to ground a generated answer.
 *
 * Two rules keep this honest.
 *
 * **No crawl events are invented.** This models what a site's robots.txt says,
 * which is a static file and a decision somebody made. It does not claim any
 * agent visited, when it last did, or what it took away — none of which this
 * product could know without a log feed.
 *
 * **Training and retrieval are not the same thing.** Blocking GPTBot is a
 * licensing decision that costs nothing in answer visibility; blocking
 * OAI-SearchBot means the page cannot appear in ChatGPT's answers at all. The
 * weights below say so, and the summary copy says so in words, because a tool
 * that scored them alike would push an account team to reverse a deliberate
 * and correct decision.
 */

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export const AI_AGENT_REGISTRY: readonly AiAgentRecord[] = [
  {
    id: "OAI-SearchBot",
    label: "OAI-SearchBot",
    vendor: "OpenAI",
    purpose: "answer-retrieval",
    note: "Fetches pages to ground ChatGPT search answers. Blocking it removes the site from those answers; it is not the training crawler.",
  },
  {
    id: "PerplexityBot",
    label: "PerplexityBot",
    vendor: "Perplexity",
    purpose: "answer-retrieval",
    note: "Fetches pages to build cited answers. Perplexity attributes its sources, so access here maps directly to being credited.",
  },
  {
    id: "Google-Extended",
    label: "Google-Extended",
    vendor: "Google",
    purpose: "both",
    note: "Governs whether Gemini and AI Overviews may use the site for training and for grounding. The one directive that cuts both ways.",
  },
  {
    id: "GPTBot",
    label: "GPTBot",
    vendor: "OpenAI",
    purpose: "training",
    note: "Collects pages for model training. Blocking it is a licensing position and does not affect whether ChatGPT can cite the site.",
  },
  {
    id: "ClaudeBot",
    label: "ClaudeBot",
    vendor: "Anthropic",
    purpose: "training",
    note: "Collects pages for model training. A blocking decision worth making deliberately rather than by default.",
  },
  {
    id: "CCBot",
    label: "CCBot",
    vendor: "Common Crawl",
    purpose: "training",
    note: "Feeds the open crawl that many models train on, so one rule here reaches further than one vendor.",
  },
  {
    id: "Applebot-Extended",
    label: "Applebot-Extended",
    vendor: "Apple",
    purpose: "training",
    note: "Controls use of the site for Apple Intelligence training, separately from Applebot's search crawling.",
  },
];

const BY_ID = new Map(AI_AGENT_REGISTRY.map((agent) => [agent.id, agent]));

export function getAgent(id: AiAgentId): AiAgentRecord {
  const agent = BY_ID.get(id);
  if (!agent) throw new Error(`Unknown AI agent: ${id}`);
  return agent;
}

/** Agents that fetch at answer time. Blocking one of these costs visibility. */
export const RETRIEVAL_AGENTS: readonly AiAgentId[] = AI_AGENT_REGISTRY.filter(
  (agent) => agent.purpose !== "training",
).map((agent) => agent.id);

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * What each directive is worth.
 *
 * `unspecified` scores below `allowed` without being close to `disallowed`:
 * the agent may crawl, so nothing is lost today, but the site has taken no
 * position and a default can change under it.
 */
export const DIRECTIVE_VALUE: Readonly<Record<AgentDirective, number>> = {
  allowed: 100,
  unspecified: 85,
  partial: 55,
  disallowed: 0,
};

/** How much each purpose counts toward the access score. */
export const PURPOSE_WEIGHT = {
  "answer-retrieval": 3,
  both: 2,
  training: 1,
} as const;

// ---------------------------------------------------------------------------
// Directives
// ---------------------------------------------------------------------------

/**
 * The sections of a site a partial rule could shut an agent out of.
 *
 * Read from the project's own URLs rather than invented. A robots.txt rule
 * against `/resources/` on a site with no resources section is a rule that
 * blocks nothing, and a directive that blocks nothing is not a finding — it is
 * noise that would make this whole reading look busier than it is.
 */
function sectionsOf(paths: readonly string[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const [first] = path.split("/").filter(Boolean);
    if (first === undefined) continue;
    counts.set(`/${first}/`, (counts.get(`/${first}/`) ?? 0) + 1);
  }
  // Biggest sections first, so a partial rule lands somewhere that matters.
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([section]) => section);
}

/**
 * How one project treats one agent.
 *
 * Drawn against the project's own posture rather than uniformly: an account
 * in recovery has usually never touched robots.txt, a publisher has usually
 * taken a firm position on training, and most sites sit between the two. The
 * draw is seeded, so a project's robots.txt reads the same on every render.
 */
function directiveFor(
  projectSeed: number,
  index: number,
  purpose: AiAgentRecord["purpose"],
  posture: number,
  sections: readonly string[],
): { directive: AgentDirective; paths: readonly string[] } {
  const draw = randInt(projectSeed, 700 + index, 0, 99);

  // Retrieval agents are blocked far less often, and deliberately so: most
  // sites that block AI crawlers are blocking training, not answers. A site
  // with a firm position blocks both, which is what posture raises.
  const disallowCeiling =
    purpose === "training"
      ? 14 + posture
      : purpose === "both"
        ? 9 + posture
        : 5 + Math.round(posture * 0.6);

  if (draw < disallowCeiling) return { directive: "disallowed", paths: [] };

  if (draw < disallowCeiling + 18 && sections.length > 0) {
    const take = sections.length > 1 && draw % 2 === 0 ? 2 : 1;
    const start = randInt(projectSeed, 730 + index, 0, sections.length - 1);
    return {
      directive: "partial",
      paths: Array.from(
        { length: Math.min(take, sections.length) },
        (_, offset) => sections[(start + offset) % sections.length],
      ),
    };
  }

  if (draw < disallowCeiling + 50) return { directive: "unspecified", paths: [] };
  return { directive: "allowed", paths: [] };
}

/** How firm a project is about blocking AI crawlers, 0-40. */
function postureOf(projectId: string, seed: number): number {
  // A publisher has a commercial reason to care; an account mid-recovery has
  // not got to it. Everything else is drawn.
  if (projectId === "fieldnote-media") return 40;
  if (projectId === "atlas-industrial") return 0;
  return randInt(seed, 690, 0, 12);
}

/**
 * Accounts that have opted out of generative answers on purpose.
 *
 * Written out rather than drawn, because it is the case this whole reading
 * exists to make legible: a publisher that disallows every answer-retrieval
 * agent has not got an AI visibility problem to fix, it has made a commercial
 * decision, and a tool that reported its readiness as a failing would be
 * telling the account team to undo it. One account on the roster does this so
 * that the state is reachable and visibly handled.
 */
const FULL_OPT_OUT: ReadonlySet<string> = new Set(["fieldnote-media"]);

function noteFor(
  agent: AiAgentRecord,
  directive: AgentDirective,
  paths: readonly string[],
): string {
  switch (directive) {
    case "allowed":
      return `robots.txt explicitly allows ${agent.id}.`;
    case "unspecified":
      return `No rule for ${agent.id}. It may crawl by default, and nobody has taken a position either way.`;
    case "partial":
      return `${agent.id} is disallowed from ${paths.join(" and ")} and may crawl the rest.`;
    case "disallowed":
      return agent.purpose === "training"
        ? `${agent.id} is disallowed site-wide. A training decision — it does not affect whether the site can be quoted in an answer.`
        : `${agent.id} is disallowed site-wide, so the site cannot appear in ${agent.vendor}'s generated answers at all.`;
  }
}

// ---------------------------------------------------------------------------
// Page-level access
// ---------------------------------------------------------------------------

/**
 * All this file needs of a page.
 *
 * Narrow on purpose: a directive is a fact about a project and a path, so
 * nothing here has to wait for the assembled inventory or the issue registry.
 */
export type PageRef = { readonly projectId: string; readonly path: string };

/** Whether one directive shuts one path out. */
export function pathBlocked(
  directive: ProjectAgentDirective,
  path: string,
): boolean {
  if (directive.directive === "disallowed") return true;
  if (directive.directive !== "partial") return false;
  return directive.disallowedPaths.some((prefix) => path.startsWith(prefix));
}

/**
 * Which answer-retrieval agents cannot fetch this page.
 *
 * Two readings come off this, and conflating them is the mistake worth
 * avoiding. Losing one engine is a finding an account team should see. Losing
 * every engine is a different statement — the page cannot appear in a
 * generated answer anywhere — and only that one should gate a score.
 */
export function retrievalBlockersFor(page: PageRef): readonly AiAgentId[] {
  return directivesForProject(page.projectId)
    .filter(
      (entry) =>
        RETRIEVAL_AGENTS.includes(entry.agent) && pathBlocked(entry, page.path),
    )
    .map((entry) => entry.agent);
}

/** At least one answer engine cannot reach this page. The finding. */
export function retrievalPartlyBlockedFor(page: PageRef): boolean {
  return retrievalBlockersFor(page).length > 0;
}

/**
 * No answer engine can reach this page. The gate.
 *
 * Kept separate from the finding above because it carries a much stronger
 * claim: nothing this page says can reach a generated answer anywhere, so the
 * writing on it stops mattering until the rule changes.
 */
export function retrievalBlockedFor(page: PageRef): boolean {
  const retrieval = directivesForProject(page.projectId).filter((entry) =>
    RETRIEVAL_AGENTS.includes(entry.agent),
  );
  return (
    retrieval.length > 0 &&
    retrievalBlockersFor(page).length === retrieval.length
  );
}

/** How reachable one page is to generative crawlers, 0-100. */
export function agentReachFor(page: PageRef): number {
  const directives = directivesForProject(page.projectId);
  let weighted = 0;
  let total = 0;

  for (const entry of directives) {
    const weight = PURPOSE_WEIGHT[getAgent(entry.agent).purpose];
    const value = pathBlocked(entry, page.path)
      ? 0
      : DIRECTIVE_VALUE[entry.directive];
    weighted += value * weight;
    total += weight;
  }

  return total === 0 ? 0 : Math.round(weighted / total);
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

let directiveCache: readonly ProjectAgentDirective[] | null = null;

function build(): readonly ProjectAgentDirective[] {
  const rows: ProjectAgentDirective[] = [];
  // The base inventory, before findings are attached: a directive only needs
  // the project and the path, so reading it here keeps this file underneath
  // the issue registry and no cycle closes.
  const inventory = getBasePages();

  for (const project of PROJECTS) {
    const posture = postureOf(project.id, project.seed);
    const pages = inventory.filter((page) => page.projectId === project.id);
    const sections = sectionsOf(pages.map((page) => page.path));
    const optedOut = FULL_OPT_OUT.has(project.id);

    AI_AGENT_REGISTRY.forEach((agent, index) => {
      const { directive, paths } =
        optedOut && agent.purpose !== "training"
          ? ({ directive: "disallowed", paths: [] } as const)
          : directiveFor(
              project.seed,
              index,
              agent.purpose,
              posture,
              sections,
            );

      const blockedPages =
        directive === "disallowed"
          ? pages.length
          : directive === "partial"
            ? pages.filter((page) =>
                paths.some((prefix) => page.path.startsWith(prefix)),
              ).length
            : 0;

      rows.push({
        projectId: project.id,
        projectName: project.name,
        agent: agent.id,
        directive,
        disallowedPaths: paths,
        blockedPages,
        note: noteFor(agent, directive, paths),
      });
    });
  }

  return rows;
}

/** Every directive across the roster, built once. */
export function getAgentDirectives(): readonly ProjectAgentDirective[] {
  directiveCache ??= build();
  return directiveCache;
}

export function directivesForProject(
  projectId: string,
): readonly ProjectAgentDirective[] {
  return getAgentDirectives().filter((entry) => entry.projectId === projectId);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/** The access reading for one project, or for the whole portfolio. */
export function getAgentAccess(
  projectId: string,
  pages: readonly PageRef[],
): AgentAccessSummary {
  const directives =
    projectId === "portfolio"
      ? getAgentDirectives()
      : directivesForProject(projectId);

  let weighted = 0;
  let total = 0;
  for (const entry of directives) {
    const weight = PURPOSE_WEIGHT[getAgent(entry.agent).purpose];
    weighted += DIRECTIVE_VALUE[entry.directive] * weight;
    total += weight;
  }
  const score = total === 0 ? 0 : Math.round(weighted / total);

  const blockedIds = (purposeMatch: (agent: AiAgentRecord) => boolean) => [
    ...new Set(
      directives
        .filter(
          (entry) =>
            entry.directive === "disallowed" && purposeMatch(getAgent(entry.agent)),
        )
        .map((entry) => entry.agent),
    ),
  ];

  const retrievalBlocked = blockedIds((agent) => agent.purpose !== "training");
  const trainingBlocked = blockedIds((agent) => agent.purpose === "training");
  const unspecified = [
    ...new Set(
      directives
        .filter((entry) => entry.directive === "unspecified")
        .map((entry) => entry.agent),
    ),
  ];

  const unreachablePages = pages.filter(retrievalBlockedFor).length;

  const summary =
    retrievalBlocked.length > 0
      ? `${retrievalBlocked.join(", ")} cannot fetch this site, so it cannot appear in those engines' answers at all.`
      : unreachablePages > 0
        ? `${unreachablePages} pages sit under a path every answer-retrieval agent is disallowed from.`
        : trainingBlocked.length > 0
          ? `Training crawlers blocked (${trainingBlocked.join(", ")}); every answer-retrieval agent can still reach the site. That combination is a deliberate position, not a fault.`
          : unspecified.length > 0
            ? `No rule either way for ${unspecified.length} of ${AI_AGENT_REGISTRY.length} agents. They may crawl, but nobody has decided.`
            : "Every generative crawler is explicitly allowed.";

  return {
    projectId,
    score,
    severity: severityFor(score),
    directives,
    retrievalBlocked,
    trainingBlocked,
    unspecified,
    unreachablePages,
    summary,
  };
}
