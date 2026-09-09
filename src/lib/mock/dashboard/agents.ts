import { minutesBefore, randInt } from "@/lib/mock/dashboard/core";
import type {
  AgentId,
  AgentOperation,
  AgentOpsStatus,
  DashboardProject,
  DateRange,
  Status,
} from "@/types/dashboard";

/**
 * The operating state of the twelve specialist agents (CLAUDE.md §13).
 *
 * The agents are mocked in this milestone: these are realistic run records,
 * not the output of any runtime. Each agent owns a fixed discipline and stage
 * in the orchestration loop; which task it is currently on, what state it is
 * in, and how much it has produced vary with the selected project and window.
 */

/**
 * Presentation for each operational state.
 *
 * Every value maps onto an existing lifecycle `Status` so the badge primitive
 * is reused rather than a second colour vocabulary being invented, and the
 * label spells the meaning out — colour never carries it alone.
 */
export const AGENT_STATUS_META: Record<
  AgentOpsStatus,
  { readonly label: string; readonly status: Status }
> = {
  active: { label: "Active", status: "active" },
  working: { label: "Working", status: "running" },
  waiting: { label: "Waiting", status: "queued" },
  completed: { label: "Completed", status: "complete" },
  "needs-review": { label: "Needs review", status: "review" },
  blocked: { label: "Blocked", status: "failed" },
};

/** Filter order for the status control above the roster. */
export const AGENT_STATUS_ORDER: readonly AgentOpsStatus[] = [
  "working",
  "active",
  "waiting",
  "needs-review",
  "blocked",
  "completed",
];

/**
 * A fixed mix of states across the roster.
 *
 * Rotating this array by a project-derived offset gives each project a
 * different assignment while keeping the overall balance realistic — a control
 * centre where every agent is blocked, or none is, would not be.
 */
const STATUS_MIX: readonly AgentOpsStatus[] = [
  "working",
  "active",
  "working",
  "completed",
  "working",
  "needs-review",
  "active",
  "waiting",
  "working",
  "waiting",
  "blocked",
  "completed",
];

type AgentSeed = {
  readonly agent: AgentId;
  readonly name: string;
  readonly discipline: string;
  /** Position in the orchestration loop, 1-12. */
  readonly stage: number;
  readonly outputLabel: string;
  /** Artifacts produced in a 30-day window at portfolio scale. */
  readonly outputBase: number;
  /** Three candidate tasks; the selected project picks one. */
  readonly tasks: readonly [string, string, string];
};

const AGENTS: readonly AgentSeed[] = [
  {
    agent: "seo-director",
    name: "SEO Director",
    discipline: "Strategy and orchestration",
    stage: 1,
    outputLabel: "decisions",
    outputBase: 34,
    tasks: [
      "Re-prioritising the quarterly roadmap from the latest analytics feedback",
      "Arbitrating between the content and technical backlogs for next sprint",
      "Sequencing agent hand-offs for the new topical cluster rollout",
    ],
  },
  {
    agent: "project-manager",
    name: "Project Manager",
    discipline: "Scope, scheduling, delivery",
    stage: 2,
    outputLabel: "tasks",
    outputBase: 128,
    tasks: [
      "Confirming delivery scope and rescheduling two slipped milestones",
      "Reconciling the sprint board against the agreed statement of work",
      "Preparing the month-end delivery summary for client review",
    ],
  },
  {
    agent: "market-intelligence",
    name: "Market & Competitor Intelligence",
    discipline: "Landscape and share of voice",
    stage: 3,
    outputLabel: "reports",
    outputBase: 18,
    tasks: [
      "Mapping the SERP competitor set for the highest-value cluster",
      "Tracking a rival's share-of-voice gain across 240 shared terms",
      "Profiling two new entrants that appeared in the top ten this month",
    ],
  },
  {
    agent: "keyword-intent",
    name: "Keyword & Search Intent",
    discipline: "Discovery, clustering, intent",
    stage: 4,
    outputLabel: "clusters",
    outputBase: 96,
    tasks: [
      "Clustering 412 newly discovered keywords by search intent",
      "Re-classifying intent on terms whose SERPs changed shape",
      "Scoring the long-tail pool against the current conversion model",
    ],
  },
  {
    agent: "content-strategist",
    name: "Content Strategist",
    discipline: "Plans, briefs, topical maps",
    stage: 5,
    outputLabel: "briefs",
    outputBase: 42,
    tasks: [
      "Drafting the topical map for the comparison hub",
      "Rebuilding internal-linking paths across the resource library",
      "Turning the top twenty opportunities into prioritised briefs",
    ],
  },
  {
    agent: "research-evidence",
    name: "Research & Evidence",
    discipline: "Sources, facts, citations",
    stage: 6,
    outputLabel: "citations",
    outputBase: 310,
    tasks: [
      "Verifying 38 regulatory claims in the compliance guide",
      "Sourcing primary evidence for the annual industry report",
      "Re-checking statistics older than eighteen months across live pages",
    ],
  },
  {
    agent: "writer",
    name: "Writer",
    discipline: "Drafting against briefs",
    stage: 7,
    outputLabel: "drafts",
    outputBase: 38,
    tasks: [
      "Drafting eight comparison pages against approved briefs",
      "Rewriting three decaying guides to the refreshed outline",
      "Producing the FAQ blocks required for answer eligibility",
    ],
  },
  {
    agent: "on-page-seo",
    name: "On-Page SEO",
    discipline: "Titles, meta, entities, links",
    stage: 8,
    outputLabel: "pages",
    outputBase: 214,
    tasks: [
      "Rewriting titles and meta descriptions for 126 low-click pages",
      "Adding entity markup and internal links to the money pages",
      "Resolving heading-hierarchy defects flagged on the blog template",
    ],
  },
  {
    agent: "technical-seo",
    name: "Technical SEO",
    discipline: "Crawl, indexation, vitals, schema",
    stage: 9,
    outputLabel: "fixes",
    outputBase: 64,
    tasks: [
      "Resolving duplicate canonical tags across paginated archives",
      "Cutting redirect chains left behind by the template migration",
      "Restoring product schema fields dropped in the last release",
    ],
  },
  {
    agent: "ai-visibility",
    name: "AI Visibility / AEO / GEO",
    discipline: "Answer engines and citations",
    stage: 10,
    outputLabel: "optimisations",
    outputBase: 52,
    tasks: [
      "Auditing answer-readiness on the top 40 landing pages",
      "Structuring definitions and comparisons for generative retrieval",
      "Tracking citation share across six answer engines",
    ],
  },
  {
    agent: "authority-backlink",
    name: "Authority & Backlink",
    discipline: "Links, digital PR, authority",
    stage: 11,
    outputLabel: "prospects",
    outputBase: 88,
    tasks: [
      "Qualifying 60 digital-PR prospects for the annual report campaign",
      "Reclaiming links lost when three referring pages were retired",
      "Converting unlinked brand mentions on trade publications",
    ],
  },
  {
    agent: "analytics-learning",
    name: "Analytics & Learning",
    discipline: "Measurement and feedback",
    stage: 12,
    outputLabel: "insights",
    outputBase: 27,
    tasks: [
      "Attributing ranking gains back to the actions that caused them",
      "Modelling which content type returns fastest for this account",
      "Feeding the month's learnings back to the SEO Director",
    ],
  },
];

/** Progress and recency behave differently in each operational state. */
const STATE_SHAPE: Record<
  AgentOpsStatus,
  {
    readonly progress: readonly [number, number];
    /** Minutes since the last action, as a range. */
    readonly idle: readonly [number, number];
  }
> = {
  working: { progress: [22, 92], idle: [2, 40] },
  active: { progress: [45, 96], idle: [4, 75] },
  waiting: { progress: [0, 0], idle: [90, 420] },
  completed: { progress: [100, 100], idle: [45, 640] },
  "needs-review": { progress: [100, 100], idle: [55, 300] },
  blocked: { progress: [18, 68], idle: [180, 900] },
};

/** The twelve agents as they stand for the selected project and window. */
export function buildAgentOperations(
  project: DashboardProject,
  range: DateRange,
): readonly AgentOperation[] {
  const offset = randInt(project.seed, 1, 0, STATUS_MIX.length - 1);
  const windowScale = Math.max(0.35, range.days / 30);

  return AGENTS.map((seed, index) => {
    const status = STATUS_MIX[(index + offset) % STATUS_MIX.length];
    const shape = STATE_SHAPE[status];

    const progress = randInt(
      project.seed + index,
      2,
      shape.progress[0],
      shape.progress[1],
    );
    const idle = randInt(project.seed + index, 3, shape.idle[0], shape.idle[1]);
    const outputs = Math.max(
      1,
      Math.round(
        seed.outputBase *
          (project.portfolio ? 1 : project.scale * 1.9) *
          windowScale ** 0.75,
      ),
    );

    return {
      agent: seed.agent,
      name: seed.name,
      discipline: seed.discipline,
      status,
      currentTask: seed.tasks[randInt(project.seed + index, 4, 0, 2)],
      progress,
      lastActivity: minutesBefore(idle),
      outputs,
      outputLabel: seed.outputLabel,
      queue: status === "completed" ? 0 : randInt(project.seed + index, 5, 0, 6),
      attention: status === "needs-review" || status === "blocked",
      stage: seed.stage,
      project: project.name,
    };
  });
}
