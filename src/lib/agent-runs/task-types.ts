import type { ActionPolicy } from "@/lib/agent-runs/action-policy";
import { COMPETITOR_COMPARISON_INSTRUCTIONS } from "@/lib/crawl/comparison-grounding";
import { canonicalCompetitorHost } from "@/lib/crawl/competitor-target";
import {
  ANSWER_READINESS_REVIEW_INSTRUCTIONS,
  CRAWL_REVIEW_INSTRUCTIONS,
  ON_PAGE_REVIEW_INSTRUCTIONS,
} from "@/lib/crawl/grounding";
import { PRIORITY_REVIEW_INSTRUCTIONS } from "@/lib/agent-runs/run-grounding";
import { looksLikeSecret } from "@/lib/agent-runs/safety";
import { OUTBOUND_LINK_REVIEW_INSTRUCTIONS } from "@/lib/authority/link-grounding";
import { SECTION_DRAFT_INSTRUCTIONS } from "@/lib/content/draft-grounding";
import { FACT_CHECK_INSTRUCTIONS } from "@/lib/content/drafts/fact-check-grounding";
import { CONTENT_PLAN_INSTRUCTIONS } from "@/lib/content/plan-instructions";
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
   * it was written over. `project` tasks are given the run's own stored
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
   */
  readonly evidence:
    | "none"
    | "crawl"
    | "search-console"
    | "agent-run"
    | "project"
    | "competitor-comparison"
    | "evidence-pack"
    | "content-draft"
    | "crawl-links"
    | "draft-version";
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
 * publishes nothing, edits nothing, and sends nothing anywhere. Its one
 * input names a completed content plan on the run's own project; the reader
 * (`@/lib/content/draft-grounding`) checks that the plan is this project's,
 * completed, model-generated over recorded evidence, and written over the
 * crawl that is still the newest, and refuses before any provider call
 * otherwise. The plan is quoted as a proposal, never as evidence; the
 * records it was written over are re-read through the evidence-pack reader,
 * unchanged. One section per run, chosen by the reader, so that the whole
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
    const object = objectWithOnly(input, ["planRunId"]);
    if (!object.ok) return object;
    const planRunId = object.value.planRunId;
    if (typeof planRunId !== "string" || !UUID.test(planRunId)) {
      return { ok: false, error: "planRunId must be the id of a completed content plan on this project." };
    }
    return { ok: true, value: { planRunId: planRunId.toLowerCase() } };
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

export const TASK_TYPES: readonly TaskTypeDefinition[] = [
  projectReview,
  keywordResearch,
  crawlReview,
  onPageReview,
  answerReadinessReview,
  searchQueryReview,
  performanceReview,
  priorityReview,
  intakeReview,
  competitorComparisonReview,
  evidencePackReview,
  contentPlanReview,
  sectionDraft,
  outboundLinkReview,
  draftFactCheck,
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
