/**
 * Asking an agent to review a crawl, as plain data.
 *
 * The panel around this owns a button and some markup. Everything that could
 * misrepresent what happened lives here: whether a crawl is reviewable at
 * all, what the request body is, and — the part that matters most — the
 * difference between a run that was *queued* and a run that *found something*.
 *
 * Queueing is not analysis. This deployment's worker claims queued runs on a
 * schedule, so a run sits in `queued` until it is picked up, and a panel that
 * showed a tick the moment the request returned would be lying about work
 * that has not started.
 *
 * Two reviews read one crawl: the Technical SEO agent's `crawl-review` and the
 * On-Page SEO agent's `on-page-review`. They are the same request shape with
 * a different agent and task, so one set of rules serves both, and the pair
 * of ids that names each review lives in `CRAWL_REVIEWS` and nowhere else.
 */

import {
  describeUpstreamEvidence,
  handoffRefusal,
  isUpstreamTaskType,
  type RunGroundingRefusal,
} from "@/lib/agent-runs/run-grounding";
import { DRAFT_SOURCE_TASK_TYPE, draftSourceRefusal, resolveSection, type DraftGroundingRefusal } from "@/lib/content/draft-grounding";
import { resolveCompetitorTarget, type CompetitorTargetRefusal } from "@/lib/crawl/competitor-target";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";
import type { AgentRun, AgentRunStatus, JsonObject } from "@/types/agent-run";
import type { Crawl } from "@/types/crawl";
import type { RangeId } from "@/types/dashboard";
import type { SearchConsoleReport } from "@/types/search-console";

/** The only agent the crawl review is allowed to run on. Mirrors the task type. */
export const REVIEW_AGENT_ID = "technical-seo";
export const REVIEW_TASK_TYPE = "crawl-review";

export type CrawlReviewKind = typeof REVIEW_TASK_TYPE | "on-page-review" | "answer-readiness-review";
export type SearchConsoleReviewKind = "search-query-review" | "performance-review";
export type ReviewTaskType =
  | CrawlReviewKind
  | SearchConsoleReviewKind
  | "priority-review"
  | "intake-review"
  | "competitor-comparison-review"
  | "evidence-pack-review"
  | "content-plan-review"
  | "section-draft"
  | "outbound-link-review"
  | "draft-fact-check";

/** One review an operator can queue: which agent, which task, and how the control reads. */
export type ReviewSpec = {
  readonly taskType: ReviewTaskType;
  readonly agentId:
    | typeof REVIEW_AGENT_ID
    | "on-page-seo"
    | "ai-visibility"
    | "keyword-intent"
    | "analytics-learning"
    | "seo-director"
    | "project-manager"
    | "market-intelligence"
    | "research-evidence"
    | "content-strategist"
    | "writer"
    | "authority-backlink";
  /** The agent's display name, as the registry has it. */
  readonly agentName: string;
  /** The button label. Says "analyze", and the note beside it says "queues". */
  readonly action: string;
  /** What the review reads, in one sentence, for the section under the button. */
  readonly summary: string;
  /** What a grounded result was grounded in, for the provenance line: "this crawl's recorded pages". */
  readonly groundedIn: string;
};

export const CRAWL_REVIEWS: Readonly<Record<CrawlReviewKind, ReviewSpec>> = {
  "crawl-review": {
    taskType: REVIEW_TASK_TYPE,
    agentId: REVIEW_AGENT_ID,
    agentName: "Technical SEO",
    action: "Analyze with Technical SEO Agent",
    summary:
      "Queues a read-only review of the pages above. The agent reads this crawl's recorded readings; it changes nothing and fetches nothing.",
    groundedIn: "this crawl's recorded pages",
  },
  "on-page-review": {
    taskType: "on-page-review",
    agentId: "on-page-seo",
    agentName: "On-Page SEO",
    action: "Analyze with On-Page SEO Agent",
    summary:
      "Queues a read-only review of the titles, descriptions, headings, canonicals and links recorded above. Proposes changes for you to apply; it edits and publishes nothing.",
    groundedIn: "this crawl's recorded pages",
  },
  "answer-readiness-review": {
    taskType: "answer-readiness-review",
    agentId: "ai-visibility",
    agentName: "AI Visibility / AEO",
    action: "Analyze with AI Visibility Agent",
    summary:
      "Queues a read-only answer-readiness review of the structured data, headings, titles, descriptions, canonicals and robots directives recorded above. It judges page declarations only — not AI crawler access, citations or visibility, which no crawl can observe — and changes nothing.",
    groundedIn: "this crawl's recorded pages",
  },
};

/**
 * The Authority & Backlink agent's review of one crawl's outbound links.
 *
 * The same crawl as the three reviews above, the same request shape and the
 * same refusals, read by a reader of its own over the crawl's stored edges.
 * It is offered beneath the project's own-site crawl only — a competitor
 * crawl panel never renders it — and it describes what the client's pages
 * link to, never who links to them: no inbound backlink, referring domain
 * or authority record exists for it to read, and its wording says so.
 */
export const OUTBOUND_LINK_REVIEW: ReviewSpec = {
  taskType: "outbound-link-review",
  agentId: "authority-backlink",
  agentName: "Authority & Backlink",
  action: "Review outbound links with Authority Agent",
  summary:
    "Queues a read-only review of the outbound links this crawl recorded on the project's own pages: which outside hosts they link to, how many edges, and the rel declarations as written. It reads recorded edges only — it fetches no host, contacts no one, and has no inbound backlink, referring domain or authority record to read, because this product holds none — and changes nothing.",
  groundedIn:
    "this crawl's recorded outbound links — what the project's own pages link to, never who links to them; no inbound backlink record exists",
};

/**
 * The Keyword & Search Intent agent's review of one Search Console window.
 *
 * The request carries a range and nothing else. The property read is the
 * project's own, resolved on the server, and the queries come from Google —
 * an operator supplies no keyword here, which is what separates this from
 * `keyword-research`.
 */
export const SEARCH_QUERY_REVIEW: ReviewSpec = {
  taskType: "search-query-review",
  agentId: "keyword-intent",
  agentName: "Keyword & Search Intent",
  action: "Analyze with Keyword & Search Intent Agent",
  summary:
    "Queues a read-only review of the totals and top queries Google reported for this window. The agent reads the Search Console figures above; it changes nothing and fetches nothing beyond that report.",
  groundedIn: "this project's Search Console report",
};

/**
 * The Analytics & Learning agent's review of the same window, as a
 * measurement.
 *
 * The same request shape as the search query review with a different agent
 * and task: what the figures did between two windows, and what to measure
 * next. It reads the report the panel shows and nothing else, and it is the
 * stage that closes the loop, so its completed run may be handed to the
 * Director like any other specialist review.
 */
export const PERFORMANCE_REVIEW: ReviewSpec = {
  taskType: "performance-review",
  agentId: "analytics-learning",
  agentName: "Analytics & Learning",
  action: "Analyze with Analytics & Learning Agent",
  summary:
    "Queues a read-only performance review of the totals and top queries Google reported for this window against the previous one. The agent reads the Search Console figures above as a measurement; it changes nothing and fetches nothing beyond that report.",
  groundedIn: "this project's Search Console report",
};

/** The two reviews that read the Search Console panel's report. */
export const SEARCH_CONSOLE_REVIEWS: Readonly<Record<SearchConsoleReviewKind, ReviewSpec>> = {
  "search-query-review": SEARCH_QUERY_REVIEW,
  "performance-review": PERFORMANCE_REVIEW,
};

/**
 * The SEO Director's priority review of one completed agent review — the
 * first hand-off between agents.
 *
 * The request carries the upstream run's id and nothing else. The Director
 * reads that agent's written review, never the crawl or the report behind
 * it, and the server re-checks the run's project, state and provenance at
 * execution time. An operator queues it; nothing queues it automatically.
 */
export const PRIORITY_REVIEW: ReviewSpec = {
  taskType: "priority-review",
  agentId: "seo-director",
  agentName: "SEO Director",
  action: "Hand off to SEO Director",
  summary:
    "Queues a read-only priority review of the completed review above. The Director reads that agent's written review only — not the crawl or report behind it — and ranks the actions it supports. It assigns nothing and changes nothing.",
  groundedIn: "one upstream agent's completed review",
};

/**
 * The Project Manager's intake review of the project record itself.
 *
 * The request carries no input at all: the project is the run's own, read
 * on the server from the persisted run, so there is nothing to name and
 * nothing a caller could point elsewhere. The agent reads what the agency
 * recorded and an inventory of what evidence exists — never the evidence —
 * and proposes one next step. It is not a hand-off source: a record is the
 * agency's own entries, not a finding about the site for the Director to
 * rank.
 */
export const INTAKE_REVIEW: ReviewSpec = {
  taskType: "intake-review",
  agentId: "project-manager",
  agentName: "Project Manager",
  action: "Review intake with Project Manager Agent",
  summary:
    "Queues a read-only intake review of this project's stored record: the recorded goal and details, the agency's intake notes and competitor domains (unverified), and which evidence this product holds. It proposes one next step for you; it assigns nothing, schedules nothing, and changes nothing.",
  groundedIn: "this project's stored record and evidence inventory",
};

/**
 * The Market & Competitor Intelligence agent's comparison of the project's
 * site with one recorded competitor's site.
 *
 * The request carries the competitor's hostname and nothing else. Which
 * crawls are compared is decided on the server at execution time: the newest
 * recorded crawl of the project's own site and the newest recorded crawl of
 * that competitor, after the domain is matched against the project's stored
 * record. The competitor's side is what its public pages declared to this
 * product's crawler, and the wording never calls it more than that. It is
 * not a hand-off source in this milestone: the runtime does not accept it as
 * one, and the control follows the runtime.
 */
export const COMPETITOR_COMPARISON_REVIEW: ReviewSpec = {
  taskType: "competitor-comparison-review",
  agentId: "market-intelligence",
  agentName: "Market & Competitor Intelligence",
  action: "Analyze competitor with Market Intelligence Agent",
  summary:
    "Queues a read-only comparison of this project's newest recorded site crawl with this competitor's newest recorded crawl. The agent reads the page declarations both crawls recorded — titles, descriptions, headings, canonicals, structured data — and nothing about either site's traffic, rankings, links or performance. It proposes one next step for you; it fetches nothing and changes nothing.",
  groundedIn: "this project's recorded site crawl and this competitor's recorded crawl (page declarations only)",
};

/**
 * The Research & Evidence agent's evidence pack for the project itself.
 *
 * The request carries no input at all: the project is the run's own, and
 * every record the pack reads — the newest own-site crawl, the default
 * Search Console window, which competitor crawls exist — is found on the
 * server from it. The agent organises what those records establish and
 * consults nothing outside the product; the wording never calls the result
 * more than that. It is not a hand-off source: the runtime does not accept
 * it as one, and the control follows the runtime.
 */
export const EVIDENCE_PACK_REVIEW: ReviewSpec = {
  taskType: "evidence-pack-review",
  agentId: "research-evidence",
  agentName: "Research & Evidence",
  action: "Compile evidence pack with Research & Evidence Agent",
  summary:
    "Queues a read-only evidence pack from the records this product holds for this project: the newest site crawl above, the Search Console window where connected, and which competitor crawls exist. The agent says what those records establish and cannot establish, each claim tagged with the record it rests on; it consults no outside source, invents no citation, and changes nothing.",
  groundedIn: "records this product holds for this project (advice organising that evidence, not a new measurement)",
};

/**
 * The Content Strategist's plan for one page of the project itself.
 *
 * The same request shape as the evidence pack — no input, the project is
 * the run's own — and the same records, read on the server through the
 * same reader. The agent proposes one page over what the records establish
 * and tags every recorded fact; it reads no earlier agent's output, no
 * fixture brief and no keyword data, because none of those is a record.
 * It is not a hand-off source: the runtime does not accept it as one, and
 * the control follows the runtime.
 */
export const CONTENT_PLAN_REVIEW: ReviewSpec = {
  taskType: "content-plan-review",
  agentId: "content-strategist",
  agentName: "Content Strategist",
  action: "Create grounded content plan with Content Strategist Agent",
  summary:
    "Queues a read-only plan for one page from the records this product holds for this project: the newest site crawl above, the Search Console window where connected, and which competitor crawls exist. Every recorded fact in the plan is tagged with its record and every unsupported section is marked as needing evidence; it names no volume, difficulty, ranking or competitor figure, reads no earlier agent's output, and changes nothing.",
  groundedIn:
    "records this product holds for this project — a proposed content plan over that evidence, not a measurement",
};

/**
 * The Writer's section draft, from a completed content plan.
 *
 * The first control here whose task is a `draft`, not a `read-only` review:
 * it produces text for a person to read, and nothing more. The plan on
 * screen is its input — quoted to the model as a proposal, never as
 * evidence — and the records the plan was written over are re-read by the
 * server. One section per run, chosen by the server's reader; every claim
 * carries its record; anything unsupported is a marked placeholder. There
 * is no publish, edit or approve control anywhere, because the product has
 * no such action, and the draft's own result offers no further step.
 */
export const SECTION_DRAFT: ReviewSpec = {
  taskType: "section-draft",
  agentId: "writer",
  agentName: "Writer",
  action: "Draft one section with Writer Agent",
  summary:
    "Queues a draft of the one outline section you choose. The Writer reads the completed plan above as a proposal — never as evidence — beside the records it was written over, drafts that section only, lists every claim with its record, and marks anything unsupported as a placeholder. The draft is for you to review; it is not published, not approved, and changes nothing.",
  groundedIn:
    "a completed content plan (a proposal) and the records it was written over — a draft for operator review, not a measurement and not published",
};

/**
 * The Research & Evidence agent's fact-check of one saved draft version.
 * Nested beneath the version it checks; its result is recorded on that
 * version by a separate, explicit click, never by the run itself.
 */
export const DRAFT_FACT_CHECK: ReviewSpec = {
  taskType: "draft-fact-check",
  agentId: "research-evidence",
  agentName: "Research & Evidence",
  action: "Run fact-check with Research & Evidence Agent",
  summary:
    "Queues a fact-check of this exact version. The Research & Evidence agent reads the version's text as the thing under check — never as evidence — beside the records this product holds, and places every sentence as supported, partly supported, unsupported or unverifiable, each supported one with its record. Absence from the records is reported as absence, never as falsehood. The check approves nothing and publishes nothing; recording its result on the version is a separate click.",
  groundedIn:
    "one saved draft version (the thing under check) and the records this product holds, re-read — a check for operator review, not a measurement, and not an approval",
};

export type ReviewPayload = {
  readonly projectId: string;
  readonly agentId: ReviewSpec["agentId"];
  readonly taskType: ReviewTaskType;
  readonly input:
    | { readonly crawlId: string }
    | { readonly range: RangeId }
    | { readonly sourceRunId: string }
    /** The comparison names a recorded competitor's hostname; the crawls are found on the server. */
    | { readonly competitorDomain: string }
    /** The section draft names the completed content plan it drafts from and the operator's chosen section, zero-based. */
    | { readonly planRunId: string; readonly sectionIndex: number }
    /** The fact-check names one saved draft and the exact version to check. */
    | { readonly draftId: string; readonly version: number }
    /** The intake review and the evidence pack name nothing: the project is the run's own. */
    | Record<string, never>;
};

export type Queueability =
  | { readonly ok: true; readonly payload: ReviewPayload }
  | { readonly ok: false; readonly why: string };

/**
 * Whether this crawl can be reviewed, and the body that would ask for it.
 *
 * `completed` and `partial` are the two real results: a crawl that stopped on
 * its budget observed everything it reports. A `running` crawl has readings
 * still arriving, and a `failed` or `cancelled` one has nothing worth
 * reading, so neither is offered rather than being offered and refused.
 */
const REVIEWABLE: readonly Crawl["status"][] = ["completed", "partial"];

export function reviewRequest(
  projectId: string,
  crawl: Crawl | null,
  review: ReviewSpec = CRAWL_REVIEWS[REVIEW_TASK_TYPE],
): Queueability {
  if (!projectId) return { ok: false, why: "No project is selected." };
  if (crawl === null) return { ok: false, why: "Run a crawl first: there is nothing to review." };
  if (crawl.status === "running") {
    return { ok: false, why: "This crawl is still running. It can be reviewed once it finishes." };
  }
  if (!REVIEWABLE.includes(crawl.status)) {
    return { ok: false, why: `This crawl ${crawl.status === "failed" ? "failed" : "was cancelled"}, so it recorded nothing worth reviewing.` };
  }
  if (!crawl.id) return { ok: false, why: "This crawl has no id to review." };

  return {
    ok: true,
    payload: {
      projectId,
      agentId: review.agentId,
      taskType: review.taskType,
      input: { crawlId: crawl.id },
    },
  };
}

/**
 * Whether the Search Console window on screen can be reviewed, and the body
 * that would ask for it.
 *
 * Offered only for a connected report with queries in it — the same
 * conditions the server's grounding reader refuses on, checked here so the
 * control explains itself instead of being clicked and refused. The server
 * remains the gate: it re-reads the report at execution time.
 */
export function searchQueryReviewRequest(
  projectId: string | null,
  report: SearchConsoleReport | null,
  rangeId: RangeId,
  review: ReviewSpec = SEARCH_QUERY_REVIEW,
): Queueability {
  if (!projectId) return { ok: false, why: "Choose a single project to review its search queries." };
  if (report === null) return { ok: false, why: "Search Console data has not loaded yet." };
  if (report.state !== "connected") {
    return { ok: false, why: "Search Console is not connected for this project, so there are no queries to review." };
  }
  if (report.partial.includes("queries-unavailable")) {
    return { ok: false, why: "Google did not return the top queries for this window, so there is nothing to review." };
  }
  if (report.queries.length === 0) {
    return { ok: false, why: "Search Console reported no queries for this window, so there is nothing to review." };
  }
  return {
    ok: true,
    payload: {
      projectId,
      agentId: review.agentId,
      taskType: review.taskType,
      input: { range: rangeId },
    },
  };
}

/**
 * Why a run cannot be handed off, in the operator's terms.
 *
 * The reasons are the runtime's own (`handoffRefusal`), worded here so the
 * control explains itself instead of being clicked and refused. None of them
 * is phrased as a fault: each is a rule about what counts as evidence.
 */
const HANDOFF_REFUSAL: Readonly<Record<RunGroundingRefusal, string>> = {
  "source-run-not-found": "That run no longer exists on the server.",
  "source-run-not-in-project": "That run belongs to a different project, so the Director cannot read it here.",
  "source-task-not-allowed":
    "The SEO Director takes hand-offs from crawl reviews, on-page reviews, answer-readiness reviews, search query reviews and performance reviews only.",
  "source-run-unfinished": "This review has not finished, so there is nothing to hand off yet.",
  "source-run-not-completed": "This review did not complete, so it has no result to hand off.",
  "source-run-no-result": "This review stored no result, so there is nothing to hand off.",
  "source-run-simulated":
    "Simulated output cannot be handed off: the mock executor analysed nothing, so there is nothing in it to prioritise.",
  "source-run-not-grounded":
    "This result was not grounded in recorded evidence, so the Director would be ranking advice built on nothing.",
};

/**
 * Whether the completed review on screen can be handed to the Director, and
 * the body that would ask for it.
 *
 * Offered only for a run the runtime's own reader would accept — the same
 * project, a hand-off task, completed, executed by a model, grounded —
 * checked here so the control explains itself. The server remains the gate:
 * it re-reads the run at execution time.
 */
export function handoffRequest(projectId: string | null, source: AgentRun | null): Queueability {
  if (!projectId) return { ok: false, why: "No project is selected." };
  if (source === null) return { ok: false, why: "Complete a review first: there is nothing to hand off." };
  if (source.projectId !== projectId) return { ok: false, why: HANDOFF_REFUSAL["source-run-not-in-project"] };

  const refusal = handoffRefusal(source);
  if (refusal !== null) return { ok: false, why: HANDOFF_REFUSAL[refusal] };

  return {
    ok: true,
    payload: {
      projectId,
      agentId: PRIORITY_REVIEW.agentId,
      taskType: PRIORITY_REVIEW.taskType,
      input: { sourceRunId: source.id },
    },
  };
}

/**
 * Why a plan on screen cannot be drafted from, in the operator's words.
 *
 * The reasons are the reader's own (`draftSourceRefusal`), the ones it can
 * give from the run alone; the rest — records unreadable, a newer crawl —
 * are found by the server at execution time and reported on the run.
 */
const DRAFT_REFUSAL: Readonly<Record<Exclude<DraftGroundingRefusal, "plan-run-not-found">, string>> = {
  "plan-run-not-in-project": "That plan belongs to a different project, so the Writer cannot draft from it here.",
  "plan-task-not-allowed": "The Writer drafts from a completed content plan only.",
  "plan-run-unfinished": "This plan has not finished, so there is nothing to draft from yet.",
  "plan-run-not-completed": "This plan did not complete, so it has no result to draft from.",
  "plan-run-no-result": "This plan stored no result, so there is nothing to draft from.",
  "plan-run-simulated": "Simulated output cannot be drafted from: the mock executor planned nothing.",
  "plan-run-not-grounded": "This plan was not grounded in recorded evidence, so a draft would rest on nothing.",
  "plan-provenance-missing": "This plan recorded no crawl it was written over, so its claims cannot be checked.",
  "plan-records-changed": "This project has a newer site crawl than the one this plan was written over.",
  "project-not-found": "That project no longer exists on the server.",
  "no-domain": "This project records no domain, so its records cannot be found.",
  "project-crawl-missing": "This project's own site has not been crawled, so there are no records to draft over.",
  "project-crawl-unfinished": "This project's newest site crawl is still running.",
  "project-crawl-not-reviewable": "This project's newest site crawl recorded no pages to draft over.",
  "crawl-not-readable": "This project's newest site crawl could not be read.",
  "section-index-missing": "Choose the outline section of the plan to draft.",
  "section-index-invalid": "That section choice is not a valid outline position.",
  "plan-outline-missing": "This plan has no outline sections to choose from.",
  "section-out-of-range": "This plan has no outline section at that position.",
  "section-not-draftable": "That outline section names no record, so a draft of it would rest on nothing. Choose a section with a record tag.",
  "section-malformed": "That outline section has no heading to draft.",
};

/**
 * Whether the completed plan on screen can be drafted from by the Writer, and
 * the body that would ask for it.
 *
 * Offered only for a run the server's own reader would accept from the run
 * alone — the same project, a content plan, completed, executed by a model,
 * grounded, with the crawl it was written over recorded — checked here so
 * the control explains itself. The server remains the gate: it re-reads the
 * plan and the records at execution time, and refuses a plan whose crawl is
 * no longer the newest.
 *
 * The section is the operator's explicit choice, zero-based. Nothing is
 * chosen for them: with no choice the control explains itself and asks for
 * one, and a choice the plan does not support is refused with the reader's
 * own reason, never replaced by another section.
 */
export function draftRequest(projectId: string | null, plan: AgentRun | null, sectionIndex: number | null): Queueability {
  if (!projectId) return { ok: false, why: "No project is selected." };
  if (plan === null) return { ok: false, why: "Complete a content plan first: there is nothing to draft from." };
  if (plan.projectId !== projectId) return { ok: false, why: DRAFT_REFUSAL["plan-run-not-in-project"] };

  const refusal = draftSourceRefusal(plan);
  if (refusal !== null && refusal !== "plan-run-not-found") return { ok: false, why: DRAFT_REFUSAL[refusal] };

  const section = resolveSection(plan.resultSummary ?? "", sectionIndex);
  if (!section.ok) return { ok: false, why: DRAFT_REFUSAL[section.reason] };

  return {
    ok: true,
    payload: {
      projectId,
      agentId: SECTION_DRAFT.agentId,
      taskType: SECTION_DRAFT.taskType,
      input: { planRunId: plan.id, sectionIndex: section.target.sectionIndex },
    },
  };
}

/**
 * Whether one saved draft version can be fact-checked, and the body that
 * would ask for it.
 *
 * Offered for the current version of a live draft that carries no result
 * yet — the same conditions the server's reader refuses on, checked here so
 * the control explains itself. The server remains the gate: it re-reads
 * the draft and the exact version at execution time.
 */
export function factCheckRequest(
  projectId: string | null,
  draft: { readonly id: string; readonly status: string; readonly currentVersion: number } | null,
  version: { readonly version: number; readonly factCheck: JsonObject | null } | null,
): Queueability {
  if (!projectId) return { ok: false, why: "No project is selected." };
  if (draft === null || version === null) return { ok: false, why: "Save a draft first: there is nothing to check." };
  if (draft.status === "archived") return { ok: false, why: "This draft is archived, so it is not checked." };
  if (version.factCheck !== null) return { ok: false, why: "This version already carries a fact-check; a version is checked once." };
  if (version.version !== draft.currentVersion) {
    return { ok: false, why: `Only the current version can be checked; version ${draft.currentVersion} is current.` };
  }
  return {
    ok: true,
    payload: {
      projectId,
      agentId: DRAFT_FACT_CHECK.agentId,
      taskType: DRAFT_FACT_CHECK.taskType,
      input: { draftId: draft.id, version: version.version },
    },
  };
}

/**
 * Whether the project on screen can have its intake reviewed, and the body
 * that would ask for it.
 *
 * Offered for any stored project: the record is the evidence, so there is no
 * crawl or report to wait for. The server remains the gate — it re-reads the
 * record at execution time and refuses a project that no longer exists.
 */
export function intakeReviewRequest(projectId: string | null): Queueability {
  if (!projectId) return { ok: false, why: "No project is selected." };
  return {
    ok: true,
    payload: {
      projectId,
      agentId: INTAKE_REVIEW.agentId,
      taskType: INTAKE_REVIEW.taskType,
      input: {},
    },
  };
}

/**
 * Whether the project on screen can have its evidence packed, and the body
 * that would ask for it.
 *
 * Offered only when the project's newest own-site crawl is one the server's
 * reader would accept — present, finished, and not failed or cancelled —
 * because the crawl is the one record the pack cannot do without. Search
 * Console and competitor crawls are optional and never block the control. A
 * crawl not yet known (the list has not loaded) is not offered either. The
 * server remains the gate: it re-reads the record and the crawl at execution
 * time.
 */
export function evidencePackRequest(projectId: string | null, projectCrawl: Crawl | null | undefined): Queueability {
  if (!projectId) return { ok: false, why: "No project is selected." };
  const why = comparableSide(projectCrawl, {
    unknown: "This project's crawl history has not loaded yet.",
    missing: "Run a crawl of this project's own site first: the pack has nothing to read without one.",
    running: "This project's newest site crawl is still running. The pack can be queued once it finishes.",
    failed: "This project's newest site crawl failed, so there is no recorded page evidence to pack.",
    cancelled: "This project's newest site crawl was cancelled, so there is no recorded page evidence to pack.",
  });
  if (why !== null) return { ok: false, why };
  return {
    ok: true,
    payload: {
      projectId,
      agentId: EVIDENCE_PACK_REVIEW.agentId,
      taskType: EVIDENCE_PACK_REVIEW.taskType,
      input: {},
    },
  };
}

/**
 * Whether the project on screen can have a content plan made, and the body
 * that would ask for it.
 *
 * The same gate as the evidence pack, because the same records are read:
 * the newest own-site crawl must be one the server's reader would accept.
 * Search Console and competitor crawls never block the control, and no
 * earlier run — the evidence pack included — is required or read.
 */
export function contentPlanRequest(projectId: string | null, projectCrawl: Crawl | null | undefined): Queueability {
  if (!projectId) return { ok: false, why: "No project is selected." };
  const why = comparableSide(projectCrawl, {
    unknown: "This project's crawl history has not loaded yet.",
    missing: "Run a crawl of this project's own site first: a plan has nothing to rest on without one.",
    running: "This project's newest site crawl is still running. The plan can be queued once it finishes.",
    failed: "This project's newest site crawl failed, so there is no recorded page evidence to plan over.",
    cancelled: "This project's newest site crawl was cancelled, so there is no recorded page evidence to plan over.",
  });
  if (why !== null) return { ok: false, why };
  return {
    ok: true,
    payload: {
      projectId,
      agentId: CONTENT_PLAN_REVIEW.agentId,
      taskType: CONTENT_PLAN_REVIEW.taskType,
      input: {},
    },
  };
}

/**
 * Whether the competitor on screen can be compared with the project's site,
 * and the body that would ask for it.
 *
 * Offered only when the domain is one the project's stored record lists and
 * not the project's own site (the server's rule, applied here so the control
 * explains itself), and when each side's newest recorded crawl is one the
 * server's reader would accept: present, finished, and not failed or
 * cancelled. A side whose newest crawl is not yet known — the list has not
 * loaded — is not offered either, because a control that cannot say what it
 * would compare should not be clickable. The server remains the gate: it
 * re-reads the record and both crawls at execution time.
 */
export function competitorComparisonRequest(request: {
  readonly projectId: string | null;
  readonly projectDomain: string;
  readonly competitorDomain: string;
  /** The competitor domains recorded for the project, as the server stores them. */
  readonly recorded: readonly string[];
  /** The project's newest own-site crawl; null when none is recorded; undefined while not loaded. */
  readonly projectCrawl: Crawl | null | undefined;
  /** The competitor's newest recorded crawl; null when none is recorded; undefined while not loaded. */
  readonly competitorCrawl: Crawl | null | undefined;
}): Queueability {
  if (!request.projectId) return { ok: false, why: "No project is selected." };

  const target = resolveCompetitorTarget({
    competitorDomain: request.competitorDomain,
    projectDomain: request.projectDomain,
    recordedCompetitorDomains: request.recorded,
  });
  if (!target.ok) return { ok: false, why: COMPARISON_TARGET_REFUSAL[target.reason] };

  const competitor = comparableSide(request.competitorCrawl, {
    unknown: "This competitor's crawl history has not loaded yet.",
    missing: "Crawl this competitor's site first: there is nothing to compare.",
    running: "This competitor's newest crawl is still running. It can be compared once it finishes.",
    failed: "This competitor's newest crawl failed, so it recorded nothing to compare.",
    cancelled: "This competitor's newest crawl was cancelled, so it recorded nothing to compare.",
  });
  if (competitor !== null) return { ok: false, why: competitor };

  const project = comparableSide(request.projectCrawl, {
    unknown: "This project's crawl history has not loaded yet.",
    missing: "Crawl this project's own site first: there is nothing to compare the competitor with.",
    running: "This project's newest site crawl is still running. The comparison can be queued once it finishes.",
    failed: "This project's newest site crawl failed, so there is nothing to compare the competitor with.",
    cancelled: "This project's newest site crawl was cancelled, so there is nothing to compare the competitor with.",
  });
  if (project !== null) return { ok: false, why: project };

  return {
    ok: true,
    payload: {
      projectId: request.projectId,
      agentId: COMPETITOR_COMPARISON_REVIEW.agentId,
      taskType: COMPETITOR_COMPARISON_REVIEW.taskType,
      input: { competitorDomain: target.host },
    },
  };
}

/**
 * Why a domain cannot be compared at all, in the operator's terms.
 *
 * The crawler's own reasons (`resolveCompetitorTarget`), worded for a
 * comparison rather than a crawl: nothing here says a request was made.
 */
const COMPARISON_TARGET_REFUSAL: Readonly<Record<CompetitorTargetRefusal, string>> = {
  "competitor-invalid": "This is not a plain hostname, so it cannot be compared.",
  "competitor-not-recorded":
    "This domain is not one of the competitor domains recorded for this project, so it cannot be compared.",
  "competitor-is-project-site": "That domain is this project's own site, not a competitor's, so there is nothing to compare.",
  "no-domain": "This project has no usable website domain, so no competitor can be told apart from it.",
};

/** Why one side of a comparison cannot be read, in the operator's terms, or null when it can. */
function comparableSide(
  crawl: Crawl | null | undefined,
  why: { readonly unknown: string; readonly missing: string; readonly running: string; readonly failed: string; readonly cancelled: string },
): string | null {
  if (crawl === undefined) return why.unknown;
  if (crawl === null) return why.missing;
  if (crawl.status === "running") return why.running;
  if (crawl.status === "failed") return why.failed;
  if (crawl.status === "cancelled") return why.cancelled;
  if (!REVIEWABLE.includes(crawl.status) || !crawl.id) return why.missing;
  return null;
}

/** Whether a completed run is one the Director hand-off control belongs under. */
export function offersHandoff(run: AgentRun): boolean {
  return run.status === "completed" && isUpstreamTaskType(run.taskType);
}

/**
 * Whether a completed run is one the Writer's draft control belongs under:
 * a completed content plan, and nothing else. A draft never offers a
 * further draft, and no plan queues one on its own.
 */
export function offersDraft(run: AgentRun): boolean {
  return run.status === "completed" && run.taskType === DRAFT_SOURCE_TASK_TYPE;
}

// ---------------------------------------------------------------------------
// What the panel shows
// ---------------------------------------------------------------------------

export type Tone = "neutral" | "accent" | "positive" | "warning" | "critical";

export type QueueState =
  | { readonly status: "idle" }
  /** The POST is in flight. Nothing has been queued yet. */
  | { readonly status: "queuing" }
  /**
   * A run exists. `duplicate` means this request matched one already queued;
   * `restored` means it was read back from the persisted runs after the page
   * loaded rather than queued in this page.
   */
  | { readonly status: "queued"; readonly run: AgentRun; readonly duplicate: boolean; readonly restored?: boolean }
  | { readonly status: "refused"; readonly message: string };

/**
 * How a run reads.
 *
 * `queued` is deliberately neutral and says what it is waiting for. Nothing
 * here describes a queued or running run as a result.
 */
export const RUN_STATUS: Readonly<
  Record<AgentRunStatus, { readonly label: string; readonly tone: Tone; readonly title: string }>
> = {
  queued: {
    label: "Queued",
    tone: "neutral",
    title: "Waiting to be claimed. Nothing has been analysed yet.",
  },
  running: {
    label: "Running",
    tone: "accent",
    title: "An attempt is in progress. There is no result yet.",
  },
  completed: {
    label: "Succeeded",
    tone: "positive",
    title: "The attempt finished and its output was stored.",
  },
  failed: {
    label: "Failed",
    tone: "critical",
    title: "The attempt failed. The recorded reason is shown.",
  },
  cancelled: {
    label: "Cancelled",
    tone: "warning",
    title: "An operator cancelled the run.",
  },
};

/** Whether a run has actually produced something to read. */
export function hasResult(run: AgentRun): boolean {
  return run.status === "completed" && run.resultSummary !== null;
}

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * What a grounded run was grounded in, read from the evidence summary its
 * own metadata recorded — so a run executed months ago still says what it
 * read, and a screen that lists every kind of run need not know which is
 * which.
 */
export function evidenceDescription(metadata: JsonObject): string | null {
  const evidence = isJsonObject(metadata.evidence) ? metadata.evidence : null;
  if (evidence === null) return null;
  if (evidence.source === "agent-run") return null;
  if (evidence.source === "project") return INTAKE_REVIEW.groundedIn;
  if (evidence.source === "crawl-links") {
    const crawlId = typeof evidence.crawlId === "string" ? evidence.crawlId : null;
    const external = typeof evidence.externalEdges === "number" ? evidence.externalEdges : null;
    const hosts = typeof evidence.externalHosts === "number" ? evidence.externalHosts : null;
    if (crawlId && external !== null && hosts !== null) {
      return `this crawl's recorded outbound links (crawl ${crawlId}: ${external} external edge${external === 1 ? "" : "s"} to ${hosts} host${hosts === 1 ? "" : "s"}, observed on the project's own pages and never fetched; no inbound backlink record exists)`;
    }
    return OUTBOUND_LINK_REVIEW.groundedIn;
  }
  if (evidence.source === "draft-version") {
    const draftId = typeof evidence.draftId === "string" ? evidence.draftId : null;
    const version = typeof evidence.version === "number" ? evidence.version : null;
    const crawlId = typeof evidence.crawlId === "string" ? evidence.crawlId : null;
    if (draftId && version !== null && crawlId) {
      return `one saved draft version (draft ${draftId}, version ${version}, the thing under check) and the records this product holds, re-read: crawl ${crawlId} (a check for operator review, not a measurement, and not an approval)`;
    }
    return DRAFT_FACT_CHECK.groundedIn;
  }
  if (evidence.source === "content-draft") {
    const planRunId = typeof evidence.planRunId === "string" ? evidence.planRunId : null;
    const crawlId = typeof evidence.crawlId === "string" ? evidence.crawlId : null;
    if (planRunId && crawlId) {
      const heading = typeof evidence.sectionHeading === "string" ? evidence.sectionHeading : null;
      const chosen = typeof evidence.selectedSectionIndex === "number" && heading ? `, section ${evidence.selectedSectionIndex} "${heading}"` : "";
      return `the Content Strategist's completed plan (run ${planRunId}, a proposal${chosen}) and the records it was written over, re-read: crawl ${crawlId} (a draft for operator review, not a measurement and not published)`;
    }
    return SECTION_DRAFT.groundedIn;
  }
  if (evidence.source === "evidence-pack") {
    const crawlId = typeof evidence.crawlId === "string" ? evidence.crawlId : null;
    const property = typeof evidence.property === "string" ? evidence.property : null;
    const start = typeof evidence.windowStart === "string" ? evidence.windowStart : null;
    const end = typeof evidence.windowEnd === "string" ? evidence.windowEnd : null;
    const search =
      evidence.searchConsole === "included" && property && start && end
        ? ` and Search Console for ${property}, ${start} to ${end}`
        : "";
    // The same records serve two tasks; the run's own task type says which
    // reading was made of them, so Run History can say so too.
    const reading =
      metadata.taskType === "content-plan-review"
        ? "a proposed content plan over that evidence, not a measurement"
        : "advice organising that evidence, not a new measurement";
    if (crawlId) return `records this product holds for this project: crawl ${crawlId}${search} (${reading})`;
    return metadata.taskType === "content-plan-review" ? CONTENT_PLAN_REVIEW.groundedIn : EVIDENCE_PACK_REVIEW.groundedIn;
  }
  if (evidence.source === "competitor-comparison") {
    const host = typeof evidence.competitorHost === "string" ? evidence.competitorHost : null;
    return host
      ? `this project's recorded site crawl and the recorded crawl of ${host} (page declarations only)`
      : COMPETITOR_COMPARISON_REVIEW.groundedIn;
  }
  if (evidence.source === "search-console") {
    const property = typeof evidence.property === "string" ? evidence.property : null;
    const start = typeof evidence.startDate === "string" ? evidence.startDate : null;
    const end = typeof evidence.endDate === "string" ? evidence.endDate : null;
    return property && start && end
      ? `this project's Search Console report for ${property}, ${start} to ${end}`
      : "this project's Search Console report";
  }
  if (typeof evidence.crawlId === "string") return "this product's recorded crawl";
  return null;
}

/**
 * What produced the output, in the operator's terms.
 *
 * Read from the run's own metadata rather than from configuration, so a run
 * executed months ago still says what it was. A simulated result is labelled
 * on the result itself, where it cannot be missed, because the one failure
 * mode that matters here is a placeholder being read as analysis.
 *
 * Three layers are kept apart in the wording: evidence this product recorded
 * or read; an agent's model-generated review of it; and, for a hand-off, the
 * Director's model-generated prioritisation of that review. Only the first is
 * measurement, and neither of the others is ever described as if it were.
 */
export function outputProvenance(
  run: AgentRun,
  groundedIn?: string,
): { readonly text: string; readonly tone: Tone } | null {
  const metadata = run.resultMetadata;
  if (metadata === null) return null;

  if (metadata.simulated === true) {
    return {
      text: "Simulated — the mock executor read no evidence and analysed nothing. This is placeholder output, not analysis.",
      tone: "warning",
    };
  }
  if (metadata.grounded === true) {
    const evidence = isJsonObject(metadata.evidence) ? metadata.evidence : null;
    if (evidence?.source === "agent-run") {
      const upstreamAgent =
        typeof evidence.agentId === "string" && evidence.agentId in AGENT_NAMES
          ? AGENT_NAMES[evidence.agentId as keyof typeof AGENT_NAMES]
          : "upstream";
      const upstreamRun = typeof evidence.runId === "string" ? ` (run ${evidence.runId})` : "";
      const upstreamEvidence = isJsonObject(evidence.upstreamEvidence) ? evidence.upstreamEvidence : null;
      return {
        text: `Model output by the SEO Director, prioritising the ${upstreamAgent} agent's completed review${upstreamRun}. That review was itself model-generated over ${describeUpstreamEvidence(upstreamEvidence)}, which the Director did not see. Two layers of advice, not measurement.`,
        tone: "neutral",
      };
    }
    // An explicit description wins, then what the run's own evidence summary
    // says; the crawl wording is the default this control has always had.
    const source = groundedIn ?? evidenceDescription(metadata) ?? CRAWL_REVIEWS[REVIEW_TASK_TYPE].groundedIn;
    return {
      text: `Model output, grounded in ${source}. Advice, not measurement.`,
      tone: "neutral",
    };
  }
  return {
    text: "Model output, not grounded in any recorded evidence. Advice, not measurement.",
    tone: "warning",
  };
}

/**
 * Why the server would not queue the run.
 *
 * Every one of these is a decision, not a fault to click through, so the
 * wording says what it means rather than apologising.
 */
export function queueRefusal(
  httpStatus: number,
  body: unknown,
  review: ReviewSpec = CRAWL_REVIEWS[REVIEW_TASK_TYPE],
): string {
  const error = (body as { error?: unknown; message?: unknown } | null)?.error;

  if (error === "approval-required") {
    const message = (body as { message?: unknown }).message;
    return typeof message === "string"
      ? message
      : "This task needs a person to approve each action, and there is no approval workflow yet.";
  }
  if (error === "task-not-allowed") {
    return `The ${review.agentName} agent is not allowed to run this task. That is a server rule, not a temporary problem.`;
  }
  if (error === "unknown-task-type") {
    return `This deployment does not know the ${review.taskType} task. It may be running an older build.`;
  }
  if (error === "unknown-project" || error === "unknown-agent") {
    return "The project or agent named in the request does not exist on this server.";
  }
  if (error === "unavailable") return "Agent runs are not stored on this deployment, so nothing can be queued.";
  if (error === "invalid") {
    const message = (body as { message?: unknown }).message;
    return typeof message === "string" ? message : "The request was refused as invalid.";
  }

  if (httpStatus === 401) return "Your session has ended. Reload the page to sign in again.";
  if (httpStatus === 403) return "This request was refused. Reload the page and try again.";
  if (httpStatus === 429) return "Too many requests, or one is already in flight. Wait a moment and try again.";
  return "The review could not be queued.";
}

/**
 * The line shown once a run exists.
 *
 * A duplicate is reported as such: asking twice for the same crawl returns
 * the run already queued rather than making a second one, and an operator who
 * is not told that will click again.
 */
export function queuedNote(state: {
  readonly run: AgentRun;
  readonly duplicate: boolean;
  readonly restored?: boolean;
}): string {
  if (state.duplicate) {
    return "This review was already queued; showing that run rather than starting a second one.";
  }
  if (state.restored) {
    return state.run.status === "queued"
      ? "Restored from run history. Waiting to be claimed; nothing has been analysed yet."
      : "Restored from run history.";
  }
  return state.run.status === "queued"
    ? "Queued. The scheduled worker picks runs up; nothing has been analysed yet."
    : "Queued.";
}

// ---------------------------------------------------------------------------
// Restoring a review's run after the page loads
// ---------------------------------------------------------------------------

/**
 * The input that names one review's evidence: a crawl, a window, a run, a
 * competitor's hostname, or — for the intake review — nothing, because the
 * project itself is the evidence.
 */
export type ReviewInput = ReviewPayload["input"];

/** True when a stored run's input names exactly this evidence and nothing else. */
function sameInput(stored: JsonObject, input: ReviewInput): boolean {
  const wanted = input as Readonly<Record<string, string | number>>;
  const keys = Object.keys(wanted);
  return Object.keys(stored).length === keys.length && keys.every((key) => stored[key] === wanted[key]);
}

/**
 * The newest persisted run of this review over this evidence, or null.
 *
 * A run is the same review only when the agent, the task and the whole input
 * match: a crawl review of another crawl, an on-page review of this crawl, or
 * a search query review of another window is somebody else's run. Newest by
 * creation time, whatever order the list arrived in.
 */
export function latestReviewRun(
  runs: readonly AgentRun[],
  review: ReviewSpec,
  input: ReviewInput,
): AgentRun | null {
  let latest: AgentRun | null = null;
  for (const run of runs) {
    if (run.agentId !== review.agentId || run.taskType !== review.taskType) continue;
    if (!sameInput(run.input, input)) continue;
    if (latest === null || run.createdAt > latest.createdAt) latest = run;
  }
  return latest;
}

/** How many of the agent's newest runs on the project are read back. */
export const RESTORE_LIST_LIMIT = 25;

/** The existing list endpoint, filtered to this project and this review's agent. */
export function reviewRunsUrl(projectId: string, review: ReviewSpec): string {
  const params = new URLSearchParams({
    project: projectId,
    agent: review.agentId,
    limit: String(RESTORE_LIST_LIMIT),
  });
  return `/api/agent-runs?${params.toString()}`;
}

/** The part of `fetch` this needs, so a test can hand in a fake. */
export type ListFetch = (
  url: string,
  init: { readonly cache: "no-store"; readonly signal?: AbortSignal },
) => Promise<{ readonly ok: boolean; json(): Promise<unknown> }>;

/**
 * Reads the persisted runs and picks this review's newest, or null.
 *
 * A read, never a write: it only ever GETs the list endpoint, so restoring a
 * control after a page load can neither queue nor execute anything. Every
 * failure — a refused request, a bad body, a lost connection, an abort — is
 * answered with null, which leaves the control exactly as it was before this
 * existed: idle, with its queue button.
 */
export async function restoreReviewRun(
  projectId: string,
  review: ReviewSpec,
  input: ReviewInput,
  fetchList: ListFetch,
  signal?: AbortSignal,
): Promise<AgentRun | null> {
  try {
    const response = await fetchList(reviewRunsUrl(projectId, review), { cache: "no-store", signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { runs?: unknown } | null;
    const runs = body?.runs;
    if (!Array.isArray(runs)) return null;
    return latestReviewRun(runs as AgentRun[], review, input);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Running a queued run now
// ---------------------------------------------------------------------------

/**
 * Whether this run can be started by hand, and why not when it cannot.
 *
 * Only a queued run can be claimed — the server says so too, and answers 409
 * with the run's real state for anything else. Offering the control for a
 * run that cannot take it would turn a rule into an error message.
 */
export function executability(run: AgentRun | null): { readonly ok: boolean; readonly why: string | null } {
  if (run === null) return { ok: false, why: "Queue a review first." };
  if (run.status === "queued") return { ok: true, why: null };
  if (run.status === "running") return { ok: false, why: "An attempt is already in progress." };
  if (run.status === "completed") return { ok: false, why: "This run has already finished." };
  if (run.status === "cancelled") return { ok: false, why: "This run was cancelled." };
  return { ok: false, why: "This run failed. Retrying is a separate action." };
}

/**
 * What the execute request came back as — never what it means.
 *
 * `executed` says the request was accepted, and nothing more: what actually
 * happened is whatever the run says when it is read back. A 409 is not a
 * failure; it means something else claimed the run first, which is exactly
 * what the lease is for.
 */
export type ExecuteOutcome =
  | { readonly kind: "accepted" }
  | { readonly kind: "conflict" }
  | { readonly kind: "refused"; readonly message: string };

export function executeOutcome(httpStatus: number, body: unknown): ExecuteOutcome {
  if (httpStatus === 409) return { kind: "conflict" };
  if (httpStatus >= 200 && httpStatus < 300) return { kind: "accepted" };

  const error = (body as { error?: unknown; message?: unknown } | null)?.error;
  if (error === "not-found") {
    return { kind: "refused", message: "This run no longer exists on the server." };
  }
  if (error === "unavailable") {
    return { kind: "refused", message: "Agent runs are not stored on this deployment." };
  }
  if (httpStatus === 401) {
    return { kind: "refused", message: "Your session has ended. Reload the page to sign in again." };
  }
  if (httpStatus === 403) {
    return { kind: "refused", message: "This request was refused. Reload the page and try again." };
  }
  if (httpStatus === 429) {
    return {
      kind: "refused",
      message: "Too many worker requests, or one is already running. Wait a moment and try again.",
    };
  }
  return { kind: "refused", message: "The run could not be started." };
}

/**
 * What to say once the run has been read back.
 *
 * The badge carries the state; this carries only what the request adds to it.
 * A conflict whose run then reads `running` or `completed` is reported as
 * what it is — someone else got there first — and never as a failure, because
 * the work is happening or has happened.
 */
export function reconciledNote(
  outcome: ExecuteOutcome,
  run: AgentRun | null,
): { readonly text: string; readonly tone: Tone } | null {
  if (outcome.kind === "refused") return { text: outcome.message, tone: "warning" };

  if (outcome.kind === "conflict") {
    return run === null
      ? {
          text: "Already started elsewhere, and its current status could not be read. Refresh to see it.",
          tone: "warning",
        }
      : { text: "Already started elsewhere. Refreshing its current status.", tone: "neutral" };
  }

  return run === null
    ? {
        text: "The attempt was accepted, but its result could not be read back. Refresh to see the stored state.",
        tone: "warning",
      }
    : null;
}
