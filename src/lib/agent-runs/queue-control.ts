import { CRAWL_REVIEWS, queueRefusal, type ReviewSpec } from "@/lib/crawl/review-request";
import { contentUrls } from "@/lib/content/studio";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";
import { RANGE_DAYS, isRangeId } from "@/lib/search-console/date-windows";
import { TASK_TYPES, type TaskTypeDefinition } from "@/lib/agent-runs/task-types";
import type { AgentId } from "@/types/agent";
import type { AgentTaskType, JsonObject } from "@/types/agent-run";
import type { ArticleCheckUnitView, ArticleVersionChecks } from "@/types/content-article-check";
import type { Crawl } from "@/types/crawl";
import type { RangeId } from "@/types/dashboard";

/**
 * "Queue a review" on an agent's page (Phase 6, checkpoint 6.6b): the
 * agent's grounded task types, read from the task registry, each with the
 * one record chooser its evidence needs. The control queues through the
 * existing `POST /api/agent-runs` and nothing else — it never executes a
 * run. Nothing is preselected: a task, then its record, must each be chosen
 * before the request can be built. Pure and client-safe; the screen is
 * `src/components/agents/queue-review-control.tsx`.
 */

/** Which record a task's evidence needs the operator to choose. */
export type ChooserKind =
  /** The project is the evidence: nothing else to choose. */
  | "none"
  /** One of the project's own completed or partial crawls. */
  | "crawl"
  /** One of the Search Console reporting windows. */
  | "range"
  /** One competitor domain the project recorded. */
  | "competitor"
  /** One article check unit whose recorded result needs review (the Writer's revision draft). */
  | "needs-review-unit"
  /** The task names a record chosen on the project screen, where its own control lives. */
  | "elsewhere";

export type QueueableTask = {
  readonly taskType: AgentTaskType;
  readonly label: string;
  readonly description: string;
  readonly chooser: ChooserKind;
  /** Draft-policy tasks only: what the result is. */
  readonly draftNote: string | null;
  /** `elsewhere` only: where on the project screen the task is queued. */
  readonly elsewhere: string | null;
};

export const DRAFT_NOTE = "Writes a draft for your review, publishes nothing.";

export const QUEUED_NOTE =
  "Queued, not run: nothing has been analysed yet. It appears in Run History below. Run now here, or the scheduled worker picks it up.";

/** Where each task that names a record chosen elsewhere is queued. */
const ELSEWHERE: Partial<Record<AgentTaskType, string>> = {
  "priority-review": "Queued from a completed specialist review on the project screen (the Director hand-off beneath it).",
  "section-draft": "Queued from a completed content plan on the project screen, where its section is chosen.",
  "draft-fact-check": "Queued from a saved draft version on the project screen.",
  "article-check-unit": "Queued from an article's check units on the project screen.",
  "evidence-extract": "Queued from a fetched source on Content Studio's Evidence tab.",
  "opportunity-brief": "Queued from an accepted opportunity on Content Studio's Evidence tab.",
  "article-part-draft": "Queued from a completed brief on Content Studio's Evidence tab (Draft article…).",
};

function chooserOf(task: TaskTypeDefinition): ChooserKind {
  switch (task.evidence) {
    case "project":
    case "evidence-pack":
    case "task":
    case "agent-runs":
      return "none";
    case "crawl":
    case "crawl-links":
      return "crawl";
    case "search-console":
      return "range";
    case "competitor-comparison":
      return "competitor";
    case "article-unit":
      return task.id === "article-revision-draft" ? "needs-review-unit" : "elsewhere";
    default:
      return "elsewhere";
  }
}

/** The agent's grounded task types, in registry order. A task open to any agent, or with no evidence, is not listed. */
export function queueableTasks(agentId: AgentId): readonly QueueableTask[] {
  return TASK_TYPES.filter((task) => task.evidence !== "none" && task.agents !== "any" && task.agents.includes(agentId)).map((task) => {
    const chooser = chooserOf(task);
    return {
      taskType: task.id,
      label: task.label,
      description: task.description,
      chooser,
      draftNote: task.policy === "draft" ? DRAFT_NOTE : null,
      elsewhere: chooser === "elsewhere" ? (ELSEWHERE[task.id] ?? "Queued from its own panel on the project screen.") : null,
    };
  });
}

// ---------------------------------------------------------------------------
// The records each chooser reads, through existing routes only
// ---------------------------------------------------------------------------

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const CRAWL_CHOICE_LIMIT = 10;

export const queueUrls = {
  crawls: (project: string) => `/api/crawls?${q({ project, limit: String(CRAWL_CHOICE_LIMIT) })}`,
  competitors: (project: string) => `/api/crawls/competitor-overview?${q({ project })}`,
  articles: contentUrls.workspace,
  checks: contentUrls.checks,
  create: "/api/agent-runs",
};

export const RANGE_CHOICES: readonly { readonly id: RangeId; readonly label: string }[] = (Object.keys(RANGE_DAYS) as RangeId[]).map((id) => ({
  id,
  label: `${RANGE_DAYS[id]} days`,
}));

/** The crawls a crawl-grounded task may read: completed or partial, newest first as listed. */
export function reviewableCrawls(crawls: readonly Crawl[]): readonly Crawl[] {
  return crawls.filter((crawl) => crawl.status === "completed" || crawl.status === "partial");
}

export function crawlChoiceLabel(crawl: Crawl): string {
  return `Crawl ${crawl.id.slice(0, 8)} · ${crawl.startedAt.slice(0, 10)} · ${crawl.pagesFetched} of ${crawl.pagesDiscovered} pages fetched · ${crawl.status}`;
}

/** The units of one version whose recorded check needs review — the only ones a revision draft may read. */
export function needsReviewUnits(checks: ArticleVersionChecks): readonly ArticleCheckUnitView[] {
  return checks.units.filter((unit) => unit.record?.status === "needs-review");
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

/** What the operator has chosen so far; every field starts empty. */
export type QueueSelection = {
  readonly crawl: Crawl | null;
  readonly range: string | null;
  readonly competitor: string | null;
  readonly unit: { readonly articleId: string; readonly articleVersion: number; readonly articleVersionId: string; readonly unit: ArticleCheckUnitView } | null;
};

export const EMPTY_SELECTION: QueueSelection = { crawl: null, range: null, competitor: null, unit: null };

export type QueueBody = { readonly projectId: string; readonly agentId: AgentId; readonly taskType: AgentTaskType; readonly input: JsonObject };

export type QueueRequest = { readonly ok: true; readonly body: QueueBody } | { readonly ok: false; readonly why: string };

/** The body `POST /api/agent-runs` takes, or why Queue stays disabled. The server re-checks every field. */
export function queueRequest(projectId: string | null, agentId: AgentId, task: QueueableTask | null, selection: QueueSelection): QueueRequest {
  if (!projectId) return { ok: false, why: "Choose a project." };
  if (task === null) return { ok: false, why: "Choose a task." };
  const base = { projectId, agentId, taskType: task.taskType };
  switch (task.chooser) {
    case "none":
      return { ok: true, body: { ...base, input: {} } };
    case "crawl": {
      const crawl = selection.crawl;
      if (crawl === null) return { ok: false, why: "Choose a crawl." };
      if (crawl.projectId !== projectId || (crawl.status !== "completed" && crawl.status !== "partial")) {
        return { ok: false, why: "That crawl cannot be reviewed: it is not a finished crawl of this project." };
      }
      return { ok: true, body: { ...base, input: { crawlId: crawl.id } } };
    }
    case "range":
      if (!isRangeId(selection.range)) return { ok: false, why: "Choose a Search Console window." };
      return { ok: true, body: { ...base, input: { range: selection.range } } };
    case "competitor":
      if (!selection.competitor) return { ok: false, why: "Choose a recorded competitor." };
      return { ok: true, body: { ...base, input: { competitorDomain: selection.competitor } } };
    case "needs-review-unit": {
      const chosen = selection.unit;
      if (chosen === null) return { ok: false, why: "Choose an article and a unit whose check needs review." };
      if (chosen.unit.record?.status !== "needs-review") return { ok: false, why: "Only a unit whose recorded check needs review can be revised." };
      return {
        ok: true,
        body: { ...base, input: { articleId: chosen.articleId, articleVersion: chosen.articleVersion, articleVersionId: chosen.articleVersionId, unitIndex: chosen.unit.index } },
      };
    }
    case "elsewhere":
      return { ok: false, why: task.elsewhere ?? "Queued from its own panel on the project screen." };
  }
}

/** Why the create route refused, in the review controls' words (the daily cap included). */
export function queueFailure(httpStatus: number, body: unknown, agentId: AgentId, taskType: AgentTaskType): string {
  const spec = { ...CRAWL_REVIEWS["crawl-review"], agentName: AGENT_NAMES[agentId], taskType } as unknown as ReviewSpec;
  return queueRefusal(httpStatus, body, spec);
}
