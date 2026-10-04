import type { ActionPolicy } from "@/lib/agent-runs/action-policy";
import { COMPETITOR_COMPARISON_INSTRUCTIONS } from "@/lib/crawl/comparison-grounding";
import { canonicalCompetitorHost } from "@/lib/crawl/competitor-target";
import {
  ANSWER_READINESS_REVIEW_INSTRUCTIONS,
  CRAWL_REVIEW_INSTRUCTIONS,
  ON_PAGE_REVIEW_INSTRUCTIONS,
} from "@/lib/crawl/grounding";
import { PROJECT_PRIORITY_REVIEW_INSTRUCTIONS } from "@/lib/agent-runs/director-bundle";
import { PRIORITY_REVIEW_INSTRUCTIONS } from "@/lib/agent-runs/run-grounding";
import {
  ARTICLE_REVISION_DRAFT_INSTRUCTIONS,
  COMPETITOR_PAGE_GAP_REVIEW_INSTRUCTIONS,
  CONTENT_REFRESH_REVIEW_INSTRUCTIONS,
  FINDING_HISTORY_REVIEW_INSTRUCTIONS,
  INTERNAL_LINK_REVIEW_INSTRUCTIONS,
  KEYWORD_OPPORTUNITY_REVIEW_INSTRUCTIONS,
  LEARNING_REVIEW_INSTRUCTIONS,
  PAGE_QUERY_ALIGNMENT_REVIEW_INSTRUCTIONS,
  SCHEMA_ENTITY_REVIEW_INSTRUCTIONS,
} from "@/lib/agent-runs/second-tasks";
import { looksLikeSecret } from "@/lib/agent-runs/safety";
import { OUTBOUND_LINK_REVIEW_INSTRUCTIONS } from "@/lib/authority/link-grounding";
import { EVIDENCE_EXTRACT_INSTRUCTIONS } from "@/lib/evidence/extract";
import { ARTICLE_PART_INSTRUCTIONS, ARTICLE_PARTS, isArticlePart } from "@/lib/briefs/article-part";
import { OPPORTUNITY_BRIEF_INSTRUCTIONS } from "@/lib/briefs/brief";
import { ARTICLE_CHECK_UNIT_INSTRUCTIONS } from "@/lib/content/article-check-prompt";
import { MAX_SECTION_INDEX, SECTION_DRAFT_INSTRUCTIONS } from "@/lib/content/draft-grounding";
import { FACT_CHECK_INSTRUCTIONS } from "@/lib/content/drafts/fact-check-grounding";
import { CONTENT_PLAN_INSTRUCTIONS } from "@/lib/content/plan-instructions";
import { TASK_PLAN_REVIEW_INSTRUCTIONS } from "@/lib/agent-tasks/grounding";
import { INTAKE_REVIEW_INSTRUCTIONS } from "@/lib/projects/grounding";
import { EVIDENCE_PACK_INSTRUCTIONS } from "@/lib/research/evidence-pack";
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
   * it was written over. `agent-runs` tasks are given the latest completed,
   * grounded review of each supported specialist task on the run's own
   * project, selected on the server by fixed rules and never named by a
   * caller — the same kind of advice, labelled per source, with a missing
   * source stated as missing. `project` tasks are given the run's own stored
   * project record and an inventory of the evidence this product holds for
   * it — agency-entered text, labelled unverified, never a measurement.
   * `competitor-comparison` tasks are given two crawls this product recorded
   * — the project's own site and one recorded competitor's public site, each
   * labelled as whose it is — and the competitor's side is page declarations
   * only, never a measurement of the competitor. `evidence-pack` tasks are
   * given the records this product holds for the run's own project — its
   * newest own-site crawl, its Search Console window where connected, and
   * which competitor crawls exist — with intake notes, earlier reviews and
   * competitor pages excluded, and no source outside the product.
   * `content-draft` tasks are given one completed content plan — another
   * agent's model-generated proposal, quoted as data and labelled as such —
   * beside the evidence pack it was written over, re-read now; the reader
   * refuses when the plan is not this project's, not completed, simulated,
   * ungrounded, or written over a crawl that is no longer the newest.
   * `crawl-links` tasks are given the link edges one crawl of the project's
   * own site recorded — what its pages link to, grouped by target host,
   * recorded and never fetched — and no backlink, referring domain or
   * authority record, because this product holds none.
   * `draft-version` tasks are given one saved draft version — text a model
   * or a person wrote, quoted as data and named as the thing under check,
   * never a source — beside the evidence pack, re-read now; the reader
   * refuses when the draft is not this project's, is archived, has no such
   * version, or that version already carries a recorded check.
   * `article-unit` tasks are given one check unit of one saved article
   * version — regenerated on the server from the version's stored canonical
   * text, quoted as data and named as the thing under check, never a source
   * — beside the evidence pack, re-read now; the reader refuses when the
   * article is not this project's or is archived, the version number and
   * row id disagree, the unit index is missing or out of range, the unit is
   * over its size bounds, or the unit already carries a final result.
   * `task` tasks are given the open tasks an operator recorded for the run's
   * own project — intentions to act, each with its status, priority, owner
   * and what became of its newest handoff, titles screened and quoted as
   * data — and never a source reference or a measurement.
   * `evidence-source` tasks (M4) are given one outside page this product
   * fetched and stored for an accepted opportunity — its visible text, quoted
   * as a third party's data — and the opportunity's topic; the reader refuses
   * a source that is not the project's or holds no text.
   * `opportunity` tasks (M5) are given one accepted opportunity of the run's
   * own project — its scored lines, cluster and keywords (provider figures
   * labelled as estimates), Google's newest listing (the provider's text),
   * the admitted outside evidence, the matching Search Console rows and the
   * newest crawl's paths; the reader refuses another project's opportunity.
   */
  readonly evidence:
    | "none"
    | "crawl"
    | "search-console"
    | "agent-run"
    | "agent-runs"
    | "project"
    | "competitor-comparison"
    | "evidence-pack"
    | "content-draft"
    | "crawl-links"
    | "draft-version"
    | "article-unit"
    | "task"
    | "evidence-source"
    | "opportunity"
    | "brief";
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
 * Review the answer-engine readiness of one crawl's pages.
 *
 * The same evidence as `crawl-review` and `on-page-review`, read by the AI
 * Visibility agent with a third question: whether each page's recorded
 * declarations — structured data, h1, title, description, canonical, robots
 * directive — are shaped for an answer engine to retrieve and cite. It takes
 * the same single input, is bounded to the same pages, and like every task
 * here changes nothing. What no crawl can observe about AI engines is named
 * in its instructions as not established.
 */
const answerReadinessReview: TaskTypeDefinition = {
  id: "answer-readiness-review",
  label: "Answer-readiness review",
  description:
    "Review whether one completed crawl's pages are structured to be retrieved and cited by answer engines.",
  agents: ["ai-visibility"],
  policy: "read-only",
  evidence: "crawl",
  instructions: ANSWER_READINESS_REVIEW_INSTRUCTIONS,
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

/**
 * The SEO Director's project-level priority review over the latest eligible
 * completed review of each supported specialist task (M5).
 *
 * The second hand-off between agents, and the first with more than one
 * source. The input names nothing: the project is the run's own, and which
 * runs are read is decided on the server, at execution time, by the fixed
 * rules in `@/lib/agent-runs/director-bundle` — one slot per supported task,
 * the newest run of it on the project that is completed, executed by a
 * model and grounded, among that agent's newest runs. A caller cannot name a
 * source, widen the set, or reach another project. Read-only, like every
 * task here: it proposes one bounded plan, assigns nothing, and changes
 * nothing. Operator-triggered only; nothing queues it automatically.
 */
const projectPriorityReview: TaskTypeDefinition = {
  id: "project-priority-review",
  label: "Project Director review",
  description:
    "Rank the actions the latest completed Technical SEO, On-Page SEO and Keyword & Search Intent reviews of this project support into one bounded plan.",
  agents: ["seo-director"],
  policy: "read-only",
  evidence: "agent-runs",
  instructions: PROJECT_PRIORITY_REVIEW_INSTRUCTIONS,
  parseInput(input): TaskInputResult {
    const object = objectWithOnly(input, []);
    if (!object.ok) return object;
    return { ok: true, value: {} };
  },
};

/**
 * The Project Manager's intake review of the run's own project.
 *
 * The first task grounded in what the agency recorded rather than in what
 * this product observed. It takes no input at all: the project is the run's,
 * read on the server from the persisted run, so there is nothing a caller
 * could name and nothing to smuggle. The reader in `@/lib/projects/grounding`
 * supplies the stored record, the intake entries (quoted, unverified, and
 * screened for credentials) and an inventory of which evidence exists — never
 * the evidence itself. Read-only, like every task here: it proposes one next
 * step for an operator, assigns nothing, schedules nothing, and changes
 * nothing. Operator-triggered only; nothing queues it automatically.
 */
const intakeReview: TaskTypeDefinition = {
  id: "intake-review",
  label: "Intake review",
  description:
    "Review what the agency recorded about this project and which evidence this product holds for it, and suggest one next step.",
  agents: ["project-manager"],
  policy: "read-only",
  evidence: "project",
  instructions: INTAKE_REVIEW_INSTRUCTIONS,
  parseInput(input): TaskInputResult {
    const object = objectWithOnly(input, []);
    if (!object.ok) return object;
    return { ok: true, value: {} };
  },
};

/**
 * The Project Manager's plan review of the run's own project's open tasks
 * (Phase 2, checkpoint 2.4).
 *
 * Like the intake review it takes no input: the project is the run's, read
 * on the server from the persisted run. The reader in
 * `@/lib/agent-tasks/grounding` supplies the open tasks — at most 25, ordered
 * by priority, age and id, titles screened for credentials and quoted as
 * data, each with what became of its newest handoff. Read-only: it proposes
 * an order for an operator, who applies what they accept through the task's
 * own status, owner and priority actions; nothing is recorded from it, and
 * nothing queues it automatically.
 */
const taskPlanReview: TaskTypeDefinition = {
  id: "task-plan-review",
  label: "Task plan review",
  description:
    "Propose an order for this project's open tasks, from their recorded status, priority, owner and handoff outcome, and name what blocks them.",
  agents: ["project-manager"],
  policy: "read-only",
  evidence: "task",
  instructions: TASK_PLAN_REVIEW_INSTRUCTIONS,
  parseInput(input): TaskInputResult {
    const object = objectWithOnly(input, []);
    if (!object.ok) return object;
    return { ok: true, value: {} };
  },
};

/**
 * The Market & Competitor Intelligence agent's comparison of the project's
 * site with one recorded competitor's site.
 *
 * The first task that reads a competitor crawl. The input names one
 * competitor domain and nothing else, as a bare hostname; which crawls are
 * read is decided on the server at execution time, by the reader in
 * `@/lib/crawl/comparison-grounding`: the domain must be one the run's own
 * project lists in its stored record, and both crawls are the newest this
 * product recorded of each site, found by the server rather than named by
 * the caller. A URL, a path, an address, or a bare word is refused here,
 * before anything is stored; a domain the project never recorded, or the
 * project's own site, is refused at execution, against the stored record.
 * Read-only, like every task here: it proposes one next step for an
 * operator and changes nothing. Operator-triggered only; nothing queues it
 * automatically, and its completed run is not a hand-off source.
 */
const competitorComparisonReview: TaskTypeDefinition = {
  id: "competitor-comparison-review",
  label: "Competitor comparison review",
  description:
    "Compare the recorded crawl of this project's site with the recorded crawl of one competitor's public site, as page declarations only.",
  agents: ["market-intelligence"],
  policy: "read-only",
  evidence: "competitor-comparison",
  instructions: COMPETITOR_COMPARISON_INSTRUCTIONS,
  parseInput(input): TaskInputResult {
    const object = objectWithOnly(input, ["competitorDomain"]);
    if (!object.ok) return object;
    const host = canonicalCompetitorHost(object.value.competitorDomain);
    if (host === null) {
      return { ok: false, error: "competitorDomain must be a bare domain this project has recorded as a competitor." };
    }
    return { ok: true, value: { competitorDomain: host } };
  },
};

/**
 * The Research & Evidence agent's evidence pack for the run's own project.
 *
 * The first task for that agent, and the first grounded in more than one
 * kind of record at once. It takes no input at all: the project is the
 * run's, read on the server from the persisted run, and the reader in
 * `@/lib/research/evidence-pack` finds the newest own-site crawl, the
 * default Search Console window and the competitor crawls on record by
 * itself — nothing a caller names, nothing to smuggle. Read-only, like every
 * task here: it organises what is recorded, tags each supportable claim with
 * the record it rests on, and consults nothing outside the product.
 * Operator-triggered only; nothing queues it automatically, and its
 * completed run is not a hand-off source.
 */
const evidencePackReview: TaskTypeDefinition = {
  id: "evidence-pack-review",
  label: "Evidence pack",
  description:
    "Compile what the records this product holds for this project establish and cannot establish, each claim tagged with the record it rests on.",
  agents: ["research-evidence"],
  policy: "read-only",
  evidence: "evidence-pack",
  instructions: EVIDENCE_PACK_INSTRUCTIONS,
  parseInput(input): TaskInputResult {
    const object = objectWithOnly(input, []);
    if (!object.ok) return object;
    return { ok: true, value: {} };
  },
};

/**
 * The Content Strategist's plan for one page of the run's own project.
 *
 * The second task to read the evidence pack block, and the first for this
 * agent. It declares the same evidence kind the Research & Evidence pack
 * declares, so the runtime hands it the same records through the same
 * reader — the newest own-site crawl, the default Search Console window
 * where connected, which competitor crawls exist — and nothing else: no
 * earlier agent's output, no intake note, no fixture brief or cluster. It
 * takes no input at all. Read-only, like every task here: it proposes a
 * plan for a person to take up, tags every recorded fact with its record,
 * and changes nothing. Operator-triggered only; nothing queues it
 * automatically, and its completed run is not a hand-off source.
 */
const contentPlanReview: TaskTypeDefinition = {
  id: "content-plan-review",
  label: "Content plan",
  description:
    "Plan one page for this project from the records this product holds, every recorded fact tagged with its record and every unsupported section marked as needing evidence.",
  agents: ["content-strategist"],
  policy: "read-only",
  evidence: "evidence-pack",
  instructions: CONTENT_PLAN_INSTRUCTIONS,
  parseInput(input): TaskInputResult {
    const object = objectWithOnly(input, []);
    if (!object.ok) return object;
    return { ok: true, value: {} };
  },
};

/**
 * The Writer's first task, and the first task here whose policy is `draft`
 * rather than `read-only`: it produces text a person may later use, but it
 * publishes nothing, edits nothing, and sends nothing anywhere. Its input
 * names a completed content plan on the run's own project and, as a
 * required zero-based `sectionIndex`, the one outline section the operator
 * chose to draft; the reader
 * (`@/lib/content/draft-grounding`) checks that the plan is this project's,
 * completed, model-generated over recorded evidence, and written over the
 * crawl that is still the newest, and refuses before any provider call
 * otherwise. The plan is quoted as a proposal, never as evidence; the
 * records it was written over are re-read through the evidence-pack reader,
 * unchanged, and resolves the chosen section in the plan's own outline,
 * refusing a missing, out-of-range or untagged choice with no fallback to
 * the first line. One section per run, chosen by the operator, so that the whole
 * draft stays under the runtime's output ceiling. Operator-triggered only;
 * nothing queues it automatically, and its completed run is not a hand-off
 * source.
 */
const sectionDraft: TaskTypeDefinition = {
  id: "section-draft",
  label: "Section draft",
  description:
    "Draft one section of a planned page from a completed content plan and the records it was written over, every claim traced to a record.",
  agents: ["writer"],
  policy: "draft",
  evidence: "content-draft",
  instructions: SECTION_DRAFT_INSTRUCTIONS,
  parseInput(input): TaskInputResult {
    const object = objectWithOnly(input, ["planRunId", "sectionIndex"]);
    if (!object.ok) return object;
    const planRunId = object.value.planRunId;
    if (typeof planRunId !== "string" || !UUID.test(planRunId)) {
      return { ok: false, error: "planRunId must be the id of a completed content plan on this project." };
    }
    // Required, and never defaulted: the operator chooses which outline
    // section to draft. Whether the plan has that section is the reader's
    // question, answered against the plan's own text before execution.
    const sectionIndex = object.value.sectionIndex;
    if (sectionIndex === undefined) {
      return { ok: false, error: "sectionIndex is required: choose the outline section of the plan to draft." };
    }
    if (typeof sectionIndex !== "number" || !Number.isInteger(sectionIndex) || sectionIndex < 0 || sectionIndex > MAX_SECTION_INDEX) {
      return { ok: false, error: `sectionIndex must be a whole number from 0 to ${MAX_SECTION_INDEX}: the zero-based position of one outline section.` };
    }
    return { ok: true, value: { planRunId: planRunId.toLowerCase(), sectionIndex } };
  },
};

/**
 * The Authority & Backlink agent's first task: the outbound links one crawl
 * of the project's own site recorded.
 *
 * The same single input as the crawl reviews, checked by the same rule, and
 * read by a reader of its own (`@/lib/authority/link-grounding`) over the
 * crawl's stored edges: which outside hosts the client's pages link to, how
 * many edges, and the rel declarations as written. It is the one thing this
 * product records about links, and it points outward only: no inbound
 * backlink, referring domain, authority figure, anchor text or placement is
 * recorded anywhere, and the task says so in fixed words. Read-only, like
 * every review here: it fetches no host, contacts no one, and changes
 * nothing. Operator-triggered only; nothing queues it automatically, and
 * its completed run is not a hand-off source.
 */
const outboundLinkReview: TaskTypeDefinition = {
  id: "outbound-link-review",
  label: "Outbound link review",
  description:
    "Review the outbound links one completed crawl recorded on the project's own pages: the hosts they point to and the rel declarations as written, never a backlink.",
  agents: ["authority-backlink"],
  policy: "read-only",
  evidence: "crawl-links",
  instructions: OUTBOUND_LINK_REVIEW_INSTRUCTIONS,
  parseInput: parseCrawlIdInput,
};

/**
 * The Research & Evidence agent's second task: one saved draft version
 * checked against the records this product holds.
 *
 * Two inputs name the version exactly — the draft's id and the version
 * number — and the reader (`@/lib/content/drafts/fact-check-grounding`)
 * reads that version by project, id and number, so a check of version 2 is
 * a check of version 2's text whatever is saved afterwards, and a draft of
 * another project is not found. The version is quoted as the thing under
 * check, never as evidence; the records are re-read through the evidence
 * pack reader, unchanged; and the answer places every sentence under one
 * of five headings, a supported one ending with the record it rests on.
 * Read-only, like every review here: the run writes nothing to the draft.
 * Recording its result on the version is the operator's separate, explicit
 * action, and that recording re-reads this run and verifies every tag.
 * Operator-triggered only; nothing queues it automatically, its completed
 * run is not a hand-off source, and nothing here approves or publishes.
 */
const draftFactCheck: TaskTypeDefinition = {
  id: "draft-fact-check",
  label: "Draft fact-check",
  description:
    "Check one saved draft version, sentence by sentence, against the records this product holds: what they support, support in part, do not hold, or cannot reach.",
  agents: ["research-evidence"],
  policy: "read-only",
  evidence: "draft-version",
  instructions: FACT_CHECK_INSTRUCTIONS,
  parseInput(input): TaskInputResult {
    const object = objectWithOnly(input, ["draftId", "version"]);
    if (!object.ok) return object;
    const draftId = object.value.draftId;
    const version = object.value.version;
    if (typeof draftId !== "string" || !UUID.test(draftId)) {
      return { ok: false, error: "draftId must be the id of a saved content draft on this project." };
    }
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > 32_767) {
      return { ok: false, error: "version must be the number of one of the draft's saved versions." };
    }
    return { ok: true, value: { draftId: draftId.toLowerCase(), version } };
  },
};

/** The largest check unit index an article can yield: the 150-unit cap, less one (`MAX_ARTICLE_UNITS`). */
const MAX_ARTICLE_UNIT_INDEX = 149;

/**
 * The Research & Evidence agent's third task: one check unit of one saved
 * article version, checked against the records this product holds (Stage 5,
 * milestone C4).
 *
 * An article is never checked as one prompt. Four inputs name one unit
 * exactly — the article's id, the version number, that version's immutable
 * row id, and the zero-based unit index, all required and none defaulted —
 * and no text or hash: the reader
 * (`@/lib/content/articles/checks/grounding`) re-reads the article by
 * project and id, the version by number, checks the row id, regenerates the
 * units from the stored canonical text, and resolves the index among them,
 * refusing a missing or out-of-range unit, or a version refused whole (one
 * statement too large for a unit, or more than 150 units), with no fallback to
 * another. The unit is quoted as the thing under check, never as evidence;
 * the records are re-read through the evidence pack reader, unchanged; the
 * answer uses the draft fact-check's six headings. Read-only, like every
 * review here: the run writes nothing to the article. Recording its result
 * on the unit is the operator's separate, explicit action, and nothing here
 * approves or publishes. Operator-triggered only; nothing queues it
 * automatically, and its completed run is not a hand-off source.
 */
const articleCheckUnit: TaskTypeDefinition = {
  id: "article-check-unit",
  label: "Article check unit",
  description:
    "Check one unit of one saved article version, sentence by sentence, against the records this product holds: what they support, support in part, do not hold, or cannot reach.",
  agents: ["research-evidence"],
  policy: "read-only",
  evidence: "article-unit",
  instructions: ARTICLE_CHECK_UNIT_INSTRUCTIONS,
  parseInput(input): TaskInputResult {
    const object = objectWithOnly(input, ["articleId", "articleVersion", "articleVersionId", "unitIndex"]);
    if (!object.ok) return object;
    const { articleId, articleVersion, articleVersionId, unitIndex } = object.value;
    if (typeof articleId !== "string" || !UUID.test(articleId)) {
      return { ok: false, error: "articleId must be the id of a stored article on this project." };
    }
    if (typeof articleVersion !== "number" || !Number.isInteger(articleVersion) || articleVersion < 1 || articleVersion > 32_767) {
      return { ok: false, error: "articleVersion must be the number of one of the article's saved versions." };
    }
    if (typeof articleVersionId !== "string" || !UUID.test(articleVersionId)) {
      return { ok: false, error: "articleVersionId must be the id of that saved article version." };
    }
    // Required, and never defaulted: the operator chooses which unit to
    // check. Whether the version has that unit is the reader's question,
    // answered against the version's own text before execution.
    if (unitIndex === undefined) {
      return { ok: false, error: "unitIndex is required: choose the check unit of the article version to check." };
    }
    if (typeof unitIndex !== "number" || !Number.isInteger(unitIndex) || unitIndex < 0 || unitIndex > MAX_ARTICLE_UNIT_INDEX) {
      return { ok: false, error: `unitIndex must be a whole number from 0 to ${MAX_ARTICLE_UNIT_INDEX}: the zero-based position of one check unit.` };
    }
    return {
      ok: true,
      value: { articleId: articleId.toLowerCase(), articleVersion, articleVersionId: articleVersionId.toLowerCase(), unitIndex },
    };
  },
};

// ---------------------------------------------------------------------------
// Second grounded tasks, batch 1 (Phase 6, checkpoint 6.5). Each reads
// records this product already holds through an evidence kind that already
// exists; `task-grounding.ts` appends the one block each question needs.
// Read-only (the Writer's is a draft), operator-triggered, never queued
// automatically, and none is a hand-off source.
// ---------------------------------------------------------------------------

/**
 * Keyword & Search Intent: the operator's curated keywords against the
 * stored Search Console rows (decision Q5). The same single range input as
 * the search query review; the curated keywords are the run's own
 * project's, read on the server, never named by a caller.
 */
const keywordOpportunityReview: TaskTypeDefinition = {
  id: "keyword-opportunity-review",
  label: "Keyword opportunity review",
  description:
    "Review the operator's curated keywords against the stored Search Console rows: which are observed, which are not, and which observed queries no curated keyword covers.",
  agents: ["keyword-intent"],
  policy: "read-only",
  evidence: "search-console",
  instructions: KEYWORD_OPPORTUNITY_REVIEW_INSTRUCTIONS,
  parseInput: parseRangeInput,
};

/**
 * Content Strategist: which existing pages to refresh, over one own-site
 * crawl and the latest stored query × page pairs listed by page.
 */
const contentRefreshReview: TaskTypeDefinition = {
  id: "content-refresh-review",
  label: "Content refresh review",
  description:
    "Propose which existing pages to refresh, from what one completed crawl's pages declared and the queries Google showed each page for in the stored pairs.",
  agents: ["content-strategist"],
  policy: "read-only",
  evidence: "crawl",
  instructions: CONTENT_REFRESH_REVIEW_INSTRUCTIONS,
  parseInput: parseCrawlIdInput,
};

/**
 * Writer: a revision draft of one article check unit the Research & Evidence
 * check left needing review. The same four inputs as the check, all
 * required; the reader (`@/lib/content/articles/revision-grounding`) refuses
 * a unit whose recorded result is not needs-review. Draft policy: it writes
 * text for an operator and changes no saved version.
 */
const articleRevisionDraft: TaskTypeDefinition = {
  id: "article-revision-draft",
  label: "Article revision draft",
  description:
    "Draft a revision of one article check unit that needs review, from its recorded check and the records it was checked against, every revised claim traced to a record.",
  agents: ["writer"],
  policy: "draft",
  evidence: "article-unit",
  instructions: ARTICLE_REVISION_DRAFT_INSTRUCTIONS,
  parseInput(input): TaskInputResult {
    return articleCheckUnit.parseInput(input);
  },
};

/** On-Page SEO: whether each page's declarations use the words of the queries it was shown for. */
const pageQueryAlignmentReview: TaskTypeDefinition = {
  id: "page-query-alignment-review",
  label: "Page–query alignment review",
  description:
    "Review whether one completed crawl's titles, descriptions and h1s use the words of the queries Google showed each page for in the stored pairs.",
  agents: ["on-page-seo"],
  policy: "read-only",
  evidence: "crawl",
  instructions: PAGE_QUERY_ALIGNMENT_REVIEW_INSTRUCTIONS,
  parseInput: parseCrawlIdInput,
};

/** Technical SEO: how the recorded findings changed across the project's own crawls (derived history, 3.3). */
const findingHistoryReview: TaskTypeDefinition = {
  id: "finding-history-review",
  label: "Finding history review",
  description:
    "Review which recorded crawl findings persisted, appeared, changed, were resolved or were not re-checked across this project's own crawls.",
  agents: ["technical-seo"],
  policy: "read-only",
  evidence: "crawl",
  instructions: FINDING_HISTORY_REVIEW_INSTRUCTIONS,
  parseInput: parseCrawlIdInput,
};

/** Analytics & Learning: its own earlier readings against the stored movement between two windows (P4d). */
const learningReview: TaskTypeDefinition = {
  id: "learning-review",
  label: "Learning review",
  description:
    "Compare this agent's earlier performance readings with the recorded movement between two stored Search Console windows: borne out, contradicted, or not yet testable.",
  agents: ["analytics-learning"],
  policy: "read-only",
  evidence: "search-console",
  instructions: LEARNING_REVIEW_INSTRUCTIONS,
  parseInput: parseRangeInput,
};

// ---------------------------------------------------------------------------
// Second grounded tasks, batch 2 (checkpoint 6.6, decision Q4 option B — the
// scoped-down V1): Market compares crawled declarations, AI Visibility reads
// declared content, Authority reads link structure. Stored records only.
// ---------------------------------------------------------------------------

/** Market & Competitor Intelligence: what the competitor's fetched pages declare that the project's do not. */
const competitorPageGapReview: TaskTypeDefinition = {
  id: "competitor-page-gap-review",
  label: "Competitor page gap review",
  description:
    "Report which kinds of page, topic or structured data one recorded competitor's crawled pages declare that the project's crawled pages do not, as page declarations only.",
  agents: ["market-intelligence"],
  policy: "read-only",
  evidence: "competitor-comparison",
  instructions: COMPETITOR_PAGE_GAP_REVIEW_INSTRUCTIONS,
  parseInput(input): TaskInputResult {
    return competitorComparisonReview.parseInput(input);
  },
};

/** AI Visibility: the structured-data types and entities one crawl's pages declare. */
const schemaEntityReview: TaskTypeDefinition = {
  id: "schema-entity-review",
  label: "Schema and entity review",
  description:
    "Review the structured-data types each of one completed crawl's pages declares, any parse failure, and whether its title and h1 name the same entity.",
  agents: ["ai-visibility"],
  policy: "read-only",
  evidence: "crawl",
  instructions: SCHEMA_ENTITY_REVIEW_INSTRUCTIONS,
  parseInput: parseCrawlIdInput,
};

/** Authority & Backlink: the internal link structure one own-site crawl recorded, never backlinks. */
const internalLinkReview: TaskTypeDefinition = {
  id: "internal-link-review",
  label: "Internal link review",
  description:
    "Review the internal links one completed crawl recorded between the project's own pages: which receive few or none, and the anchor text pointing at them.",
  agents: ["authority-backlink"],
  policy: "read-only",
  evidence: "crawl-links",
  instructions: INTERNAL_LINK_REVIEW_INSTRUCTIONS,
  parseInput: parseCrawlIdInput,
};

// ---------------------------------------------------------------------------
// M4: research and evidence with outside sources.
// ---------------------------------------------------------------------------

/** Research & Evidence: the claims one stored outside page makes, each with a quote copied from it. */
const evidenceExtract: TaskTypeDefinition = {
  id: "evidence-extract",
  label: "Evidence extraction",
  description:
    "List the factual claims one outside page fetched for an accepted opportunity makes on its topic, each with a quote copied word for word; an operator admits or rejects each.",
  agents: ["research-evidence"],
  policy: "read-only",
  evidence: "evidence-source",
  instructions: EVIDENCE_EXTRACT_INSTRUCTIONS,
  parseInput(input): TaskInputResult {
    const shape = objectWithOnly(input, ["sourceId"]);
    if (!shape.ok) return shape;
    const { sourceId } = shape.value;
    if (typeof sourceId !== "string" || !UUID.test(sourceId)) {
      return { ok: false, error: "sourceId must be the id of an outside source this project recorded." };
    }
    return { ok: true, value: { sourceId: sourceId.toLowerCase() } };
  },
};

/** M5 — Content Strategist: a brief for one accepted opportunity, which the Writer (M6) drafts from. */
const opportunityBrief: TaskTypeDefinition = {
  id: "opportunity-brief",
  label: "Opportunity brief",
  description:
    "Write a brief — angle, outline, FAQs, the evidence behind each section and what is still needed, internal links — for one accepted opportunity, from the records this product holds for it.",
  agents: ["content-strategist"],
  policy: "read-only",
  evidence: "opportunity",
  instructions: OPPORTUNITY_BRIEF_INSTRUCTIONS,
  parseInput(input): TaskInputResult {
    const shape = objectWithOnly(input, ["opportunityId"]);
    if (!shape.ok) return shape;
    const { opportunityId } = shape.value;
    if (typeof opportunityId !== "string" || !UUID.test(opportunityId)) {
      return { ok: false, error: "opportunityId must be the id of an opportunity this project accepted." };
    }
    return { ok: true, value: { opportunityId: opportunityId.toLowerCase() } };
  },
};

/**
 * M6 — Writer: one part of an article (the opening, one H2's body, or the closing) from a completed brief. Policy
 * `draft`: it writes text the operator may import into an article, and saves nothing — an article version exists only
 * when the operator presses Create or Save in the editor.
 */
const articlePartDraft: TaskTypeDefinition = {
  id: "article-part-draft",
  label: "Article part draft",
  description:
    "Draft one part of an article — the opening, one section, or the FAQ answers and call to action — from a completed brief and the records it was written over, every paragraph tagged with what it rests on.",
  agents: ["writer"],
  policy: "draft",
  evidence: "brief",
  instructions: ARTICLE_PART_INSTRUCTIONS,
  parseInput(input): TaskInputResult {
    const shape = objectWithOnly(input, ["briefRunId", "part"]);
    if (!shape.ok) return shape;
    const { briefRunId, part } = shape.value;
    if (typeof briefRunId !== "string" || !UUID.test(briefRunId)) {
      return { ok: false, error: "briefRunId must be the id of a completed opportunity brief on this project." };
    }
    if (!isArticlePart(part)) {
      return { ok: false, error: `part must be one of ${ARTICLE_PARTS.join(", ")}.` };
    }
    return { ok: true, value: { briefRunId: briefRunId.toLowerCase(), part } };
  },
};

export const TASK_TYPES: readonly TaskTypeDefinition[] = [
  projectReview,
  keywordResearch,
  crawlReview,
  onPageReview,
  answerReadinessReview,
  searchQueryReview,
  performanceReview,
  priorityReview,
  projectPriorityReview,
  intakeReview,
  taskPlanReview,
  competitorComparisonReview,
  evidencePackReview,
  contentPlanReview,
  sectionDraft,
  outboundLinkReview,
  draftFactCheck,
  articleCheckUnit,
  keywordOpportunityReview,
  contentRefreshReview,
  articleRevisionDraft,
  pageQueryAlignmentReview,
  findingHistoryReview,
  learningReview,
  competitorPageGapReview,
  schemaEntityReview,
  internalLinkReview,
  evidenceExtract,
  opportunityBrief,
  articlePartDraft,
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
