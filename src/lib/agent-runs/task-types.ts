import type { ActionPolicy } from "@/lib/agent-runs/action-policy";
import { CRAWL_REVIEW_INSTRUCTIONS, ON_PAGE_REVIEW_INSTRUCTIONS } from "@/lib/crawl/grounding";
import { PRIORITY_REVIEW_INSTRUCTIONS } from "@/lib/agent-runs/run-grounding";
import { looksLikeSecret } from "@/lib/agent-runs/safety";
import { isRangeId } from "@/lib/search-console/date-windows";
import {
  PERFORMANCE_REVIEW_INSTRUCTIONS,
  SEARCH_QUERY_REVIEW_INSTRUCTIONS,
} from "@/lib/search-console/grounding";
import type { AgentId } from "@/types/agent";
import type { AgentTaskType, JsonObject } from "@/types/agent-run";

/**
 * The tasks an agent can be asked to run, and the input each accepts.
 *
 * Deliberately few, and all read-only: a task here asks an agent to look and
 * report. Nothing publishes, sends, builds links, or changes a site — those
 * need review gates the runtime does not have yet. Each task declares its
 * action policy (`@/lib/agent-runs/action-policy`), and the runtime refuses to
 * run one whose policy needs approval.
 *
 * `instructions` is what a model-backed executor is asked to produce. It is
 * fixed per task type: an operator supplies only the validated input fields,
 * never free-form instructions, so a request cannot rewrite the task.
 *
 * Each task type parses its input strictly: an unknown field is refused, not
 * ignored, so nothing the caller did not mean to store is stored.
 */

export type TaskInputResult =
  | { readonly ok: true; readonly value: JsonObject }
  | { readonly ok: false; readonly error: string };

export type TaskTypeDefinition = {
  readonly id: AgentTaskType;
  readonly label: string;
  readonly description: string;
  /** The agents allowed to run it, or every agent. */
  readonly agents: readonly AgentId[] | "any";
  readonly policy: ActionPolicy;
  /**
   * What this product's own records the task is grounded in, or none.
   *
   * The runtime reads the evidence, not the executor, and it decides which
   * reader to use from this field rather than from the task's name — so a
   * second task over the same records is one declaration here, not a second
   * reader. `none` tasks reach the model with the validated input alone.
   * `agent-run` tasks are given one other agent's completed, grounded review
   * — model-generated advice, labelled as such, never the recorded evidence
   * it was written over.
   */
  readonly evidence: "none" | "crawl" | "search-console" | "agent-run";
  /** What a model-backed executor must produce, in plain text. */
  readonly instructions: string;
  parseInput(input: unknown): TaskInputResult;
};

function objectWithOnly(
  input: unknown,
  allowed: readonly string[],
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, value: {} };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Task input must be an object." };
  }
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Task input has fields this task does not accept: ${unknown.slice(0, 5).join(", ")}.`,
    };
  }
  return { ok: true, value: input as Record<string, unknown> };
}

/** Collapses whitespace; refuses control characters and credential-like text. */
function cleanText(value: unknown, field: string, max: number): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: `${field} must be text.` };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    return { ok: false, error: `${field} contains control characters.` };
  }
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length > max) return { ok: false, error: `${field} must be ${max} characters or fewer.` };
  if (looksLikeSecret(text)) {
    return { ok: false, error: `${field} looks like it contains a credential. Remove it.` };
  }
  return { ok: true, value: text };
}

const projectReview: TaskTypeDefinition = {
  id: "project-review",
  label: "Project review",
  description: "Review the project from this agent's discipline and summarise what it finds.",
  agents: "any",
  policy: "read-only",
  evidence: "none",
  instructions:
    "Review the project from your discipline. Give the three to five most important observations or risks, each with one concrete recommended next step. You have no live data about the site: say where a conclusion depends on data you would need to check, and do not invent metrics.",
  parseInput(input): TaskInputResult {
    const object = objectWithOnly(input, ["focus"]);
    if (!object.ok) return object;
    if (object.value.focus === undefined) return { ok: true, value: {} };
    const focus = cleanText(object.value.focus, "Focus", 300);
    if (!focus.ok) return focus;
    if (!focus.value) return { ok: true, value: {} };
    return { ok: true, value: { focus: focus.value } };
  },
};

const MAX_SEED_KEYWORDS = 25;

const keywordResearch: TaskTypeDefinition = {
  id: "keyword-research",
  label: "Keyword research",
  description: "Expand seed keywords into candidates with search intent.",
  agents: ["keyword-intent"],
  policy: "read-only",
  evidence: "none",
  instructions:
    "Expand the seed keywords into up to fifteen candidate keywords. For each give the likely search intent (informational, commercial, transactional, or navigational) and a one-line rationale. You have no search-volume data: do not state volumes or difficulty scores.",
  parseInput(input): TaskInputResult {
    const object = objectWithOnly(input, ["seedKeywords"]);
    if (!object.ok) return object;
    const seeds = object.value.seedKeywords;
    if (!Array.isArray(seeds) || seeds.length === 0) {
      return { ok: false, error: "seedKeywords must list at least one keyword." };
    }
    if (seeds.length > MAX_SEED_KEYWORDS) {
      return { ok: false, error: `seedKeywords can list at most ${MAX_SEED_KEYWORDS} keywords.` };
    }
    const keywords: string[] = [];
    for (const seed of seeds) {
      const keyword = cleanText(seed, "A seed keyword", 80);
      if (!keyword.ok) return keyword;
      const normalised = keyword.value.toLowerCase();
      if (normalised.length === 0) return { ok: false, error: "A seed keyword is empty." };
      if (!keywords.includes(normalised)) keywords.push(normalised);
    }
    return { ok: true, value: { seedKeywords: keywords } };
  },
};

/** A crawl id is a uuid the store generated; nothing else is accepted. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The one input a crawl-grounded task takes: a crawl id and nothing else.
 *
 * Shared by every task that reads a crawl, so the rule that no caller can
 * present text of their own as something this product observed is written
 * once. The observations come from the stored crawl record, read server-side
 * and checked against the run's own project.
 */
function parseCrawlIdInput(input: unknown): TaskInputResult {
  const object = objectWithOnly(input, ["crawlId"]);
  if (!object.ok) return object;
  const crawlId = object.value.crawlId;
  if (typeof crawlId !== "string" || !UUID.test(crawlId)) {
    return { ok: false, error: "crawlId must be the id of a crawl this project has run." };
  }
  return { ok: true, value: { crawlId: crawlId.toLowerCase() } };
}

/**
 * Review one crawl this product already ran.
 *
 * Read-only, like every task here: it reports on a crawl that already
 * happened and starts nothing.
 */
const crawlReview: TaskTypeDefinition = {
  id: "crawl-review",
  label: "Crawl review",
  description: "Review the observed pages of one completed crawl.",
  agents: ["technical-seo"],
  policy: "read-only",
  evidence: "crawl",
  instructions: CRAWL_REVIEW_INSTRUCTIONS,
  parseInput: parseCrawlIdInput,
};

/**
 * Review the on-page elements of one crawl's pages.
 *
 * The same evidence as `crawl-review`, read by the On-Page SEO agent with a
 * different question. It takes the same single input, is bounded to the same
 * pages, and like every task here changes nothing: what comes back is a
 * proposed change for a person to apply, never an applied one.
 */
const onPageReview: TaskTypeDefinition = {
  id: "on-page-review",
  label: "On-page review",
  description: "Review titles, descriptions, headings, canonicals and links of one completed crawl's pages.",
  agents: ["on-page-seo"],
  policy: "read-only",
  evidence: "crawl",
  instructions: ON_PAGE_REVIEW_INSTRUCTIONS,
  parseInput: parseCrawlIdInput,
};

/**
 * The one input a Search Console-grounded task takes: a range id and nothing
 * else.
 *
 * Shared by every task that reads the report, as `parseCrawlIdInput` is by
 * the crawl tasks, so the rule that no caller can name a property or a query
 * is written once.
 */
function parseRangeInput(input: unknown): TaskInputResult {
  const object = objectWithOnly(input, ["range"]);
  if (!object.ok) return object;
  const range = object.value.range;
  if (!isRangeId(range)) {
    return { ok: false, error: "range must be one of the reporting windows the product offers." };
  }
  return { ok: true, value: { range } };
}

/**
 * Review one Search Console window for the run's own project.
 *
 * The input names a range and nothing else. Which property is read follows
 * from the run's project on the server, so no caller can point this task at
 * another client's data, and no caller can supply a query of their own: the
 * queries come from Google. Read-only, like every task here — it reads a
 * report this product already fetches for the screen and starts nothing.
 */
const searchQueryReview: TaskTypeDefinition = {
  id: "search-query-review",
  label: "Search query review",
  description: "Review the top queries and totals Search Console reported for one window.",
  agents: ["keyword-intent"],
  policy: "read-only",
  evidence: "search-console",
  instructions: SEARCH_QUERY_REVIEW_INSTRUCTIONS,
  parseInput: parseRangeInput,
};

/**
 * Review one Search Console window as a measurement.
 *
 * The same evidence as `search-query-review`, read by the Analytics &
 * Learning agent with a different question: what the figures did between two
 * windows, and what to measure next. It takes the same single input, is
 * bounded to the same report, and like every task here changes nothing.
 */
const performanceReview: TaskTypeDefinition = {
  id: "performance-review",
  label: "Performance review",
  description: "Review what the totals and top queries Search Console reported did over one window.",
  agents: ["analytics-learning"],
  policy: "read-only",
  evidence: "search-console",
  instructions: PERFORMANCE_REVIEW_INSTRUCTIONS,
  parseInput: parseRangeInput,
};

/**
 * The SEO Director's priority review of one other agent's completed review.
 *
 * The first hand-off between agents. The input names one run and nothing
 * else; which run may be read is decided on the server, at execution time,
 * against the Director's own project and against the rules in
 * `@/lib/agent-runs/run-grounding` — completed, executed by a model, grounded
 * in recorded evidence, and of a task whose output may be handed off. The
 * Director never re-reads that evidence: it ranks the actions the upstream
 * review supports, each traced to the finding it comes from. Read-only, like
 * every task here: it proposes an order, assigns nothing, and changes nothing.
 * Operator-triggered only; nothing queues it automatically.
 */
const priorityReview: TaskTypeDefinition = {
  id: "priority-review",
  label: "Priority review",
  description: "Rank the actions one completed agent review supports into a queue for this project.",
  agents: ["seo-director"],
  policy: "read-only",
  evidence: "agent-run",
  instructions: PRIORITY_REVIEW_INSTRUCTIONS,
  parseInput(input): TaskInputResult {
    const object = objectWithOnly(input, ["sourceRunId"]);
    if (!object.ok) return object;
    const sourceRunId = object.value.sourceRunId;
    if (typeof sourceRunId !== "string" || !UUID.test(sourceRunId)) {
      return { ok: false, error: "sourceRunId must be the id of a completed run on this project." };
    }
    return { ok: true, value: { sourceRunId: sourceRunId.toLowerCase() } };
  },
};

export const TASK_TYPES: readonly TaskTypeDefinition[] = [
  projectReview,
  keywordResearch,
  crawlReview,
  onPageReview,
  searchQueryReview,
  performanceReview,
  priorityReview,
];

export function getTaskType(id: unknown): TaskTypeDefinition | undefined {
  return TASK_TYPES.find((definition) => definition.id === id);
}

export function isAgentTaskType(value: unknown): value is AgentTaskType {
  return getTaskType(value) !== undefined;
}

export function agentMayRun(definition: TaskTypeDefinition, agentId: AgentId): boolean {
  return definition.agents === "any" || definition.agents.includes(agentId);
}
