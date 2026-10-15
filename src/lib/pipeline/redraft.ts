import type { DailyUsage } from "@/lib/agent-runs/daily-usage";
import type { AssembledDraft } from "@/lib/briefs/assemble-article";
import type { ArticlePart } from "@/lib/briefs/article-part";
import type { ExecuteOutcome } from "@/lib/crawl/review-request";
import { writeOutcome } from "@/lib/evidence/presenter";
import type { Confirmation } from "@/lib/agent-runs/spend-confirm";
import { capRoom, partLabel, partRequests, PART_REQUEST } from "@/lib/briefs/draft-presenter";
import type { ParsedBrief } from "@/lib/briefs/brief";
import { MAX_REDRAFTS } from "@/lib/pipeline/plan";
import { partsEstimate } from "@/lib/pipeline/gate1";
import type { AgentRun } from "@/types/agent-run";
import type { ArticleCheckUnitView, ArticleVersionChecks } from "@/types/content-article-check";

/**
 * OC1 — One-Click Article, PR 6c: re-draft the parts whose check did not pass (docs/roadmap/OC1-one-click-article.md,
 * Stage B step 8; decision D4: at most MAX_REDRAFTS per part, then the owner decides).
 *
 * Pure. A check unit belongs to one Writer part: the metadata and the lead and introduction to the opening, each H2
 * section to its section part (the n-th section block of the version is section-n, as the brief's outline orders
 * them), the FAQ and the call to action to the closing. A part needs a re-draft when one of its units was recorded
 * `needs-review`; a `failed` unit is a check that did not finish (a malformed answer), so *Check all* runs it again first. The re-draft queues a fresh `article-part-draft` run for the part — the same request as
 * *Draft article…* — which the writing loop runs; the newest completed run is the one assembled, and the article is
 * saved as its next version. Unchanged units are then carried by F8 at the next *Check all*, so only the re-drafted
 * parts cost a check run again.
 *
 * Honest limit: the Writer's part task does not read the check's notes, so a re-draft is a fresh attempt from the same
 * brief and evidence. It helps where the failure was a wording the checker reads two ways (the 6.10b variance finding);
 * a missing record will fail again, and then the owner edits the part or admits evidence.
 */

export function partOfUnit(unit: Pick<ArticleCheckUnitView, "kind" | "block">, sectionBlocks: readonly string[]): ArticlePart | null {
  switch (unit.kind) {
    case "metadata":
    case "lead-introduction":
      return "opening";
    case "faq":
    case "cta":
      return "closing";
    case "section": {
      const n = sectionBlocks.indexOf(unit.block);
      return n < 0 || n > 5 ? null : (`section-${n + 1}` as ArticlePart);
    }
    default:
      return null;
  }
}

/** The section blocks of a version, in article order. */
export function sectionBlocks(units: readonly ArticleCheckUnitView[]): readonly string[] {
  const blocks: string[] = [];
  for (const unit of [...units].sort((a, b) => a.index - b.index)) if (unit.kind === "section" && !blocks.includes(unit.block)) blocks.push(unit.block);
  return blocks;
}

/** Parts with a unit recorded needs-review, in article order. */
export function failingParts(checks: ArticleVersionChecks): readonly ArticlePart[] {
  const blocks = sectionBlocks(checks.units);
  const parts = new Set<ArticlePart>();
  for (const unit of checks.units) {
    const status = unit.record?.status;
    if (status !== "needs-review") continue;
    const part = partOfUnit(unit, blocks);
    if (part !== null) parts.add(part);
  }
  const order: readonly ArticlePart[] = ["opening", "section-1", "section-2", "section-3", "section-4", "section-5", "section-6", "closing"];
  return order.filter((part) => parts.has(part));
}

/** Re-drafts already made for a part: its completed model runs for this brief beyond the first. */
export function redraftsMade(writerRuns: readonly AgentRun[], briefRunId: string, part: ArticlePart): number {
  const id = briefRunId.toLowerCase();
  const done = writerRuns.filter(
    (run) => run.taskType === PART_REQUEST.taskType && String(run.input.briefRunId ?? "").toLowerCase() === id && run.input.part === part && run.status === "completed" && run.executor === "ai",
  ).length;
  return Math.max(0, done - 1);
}

export type RedraftPlan = {
  /** Every unit is recorded and none needs a re-draft, or the check has not finished: nothing to do. */
  readonly state: "nothing" | "unfinished" | "ready" | "limit";
  readonly parts: readonly { readonly part: ArticlePart; readonly attempt: number }[];
  /** Failing parts that already had MAX_REDRAFTS re-drafts: the owner decides (edit, admit evidence). */
  readonly overLimit: readonly ArticlePart[];
};

export function redraftPlan(checks: ArticleVersionChecks, writerRuns: readonly AgentRun[], briefRunId: string): RedraftPlan {
  if (checks.counts.unchecked > 0 || checks.counts.pending > 0 || checks.counts.failed > 0) return { state: "unfinished", parts: [], overLimit: [] };
  const failing = failingParts(checks);
  if (failing.length === 0) return { state: "nothing", parts: [], overLimit: [] };
  const parts: { part: ArticlePart; attempt: number }[] = [];
  const overLimit: ArticlePart[] = [];
  for (const part of failing) {
    const made = redraftsMade(writerRuns, briefRunId, part);
    if (made >= MAX_REDRAFTS) overLimit.push(part);
    else parts.push({ part, attempt: made + 1 });
  }
  return { state: parts.length > 0 ? "ready" : "limit", parts, overLimit };
}

export function redraftConfirmation(projectId: string, brief: ParsedBrief, plan: RedraftPlan): Confirmation {
  const estimate = partsEstimate(plan.parts.length);
  return {
    title: `Re-draft ${plan.parts.length} ${plan.parts.length === 1 ? "part" : "parts"} that did not pass?`,
    facts: [
      { label: "Project", value: projectId },
      { label: "Parts", value: plan.parts.map(({ part, attempt }) => `${partLabel(part, brief)} (re-draft ${attempt} of ${MAX_REDRAFTS})`).join("; ") },
      { label: "Estimate", value: `about $${estimate.low.toFixed(2)}–$${estimate.high.toFixed(2)} for the writing, then the check of the changed parts` },
    ],
    consequence:
      "Queues one fresh Writer run per part and runs them now — each a paid model call — then saves the article as its next version. The Writer drafts again from the same brief and evidence; it does not read the check's notes, so a part that failed for a missing record may fail again. Keep this page open. Then press Check all units: unchanged parts are carried, only the re-drafted ones are checked. Publishes nothing.",
    confirmLabel: `Re-draft ${plan.parts.length}`,
    dismissLabel: "Go back",
    usage: "created",
    tone: "primary",
  };
}

export type RedraftIo = {
  readonly usage: () => Promise<DailyUsage | null>;
  /** POST /api/agent-runs with one part request; the answer's `run.id` is the run to execute. */
  readonly queue: (body: Readonly<Record<string, unknown>>) => Promise<{ readonly status: number; readonly body: unknown }>;
  readonly execute: (runId: string) => Promise<ExecuteOutcome>;
  readonly readRun: (runId: string) => Promise<AgentRun | null>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly stopRequested: () => boolean;
  readonly onProgress?: (part: ArticlePart, done: number, total: number) => void;
  readonly readDraft: () => Promise<AssembledDraft | null>;
  /** saveArticleVersion with no source draft (migration 20261030120000). */
  readonly saveVersion: (content: NonNullable<AssembledDraft["content"]>) => Promise<{ readonly ok: true; readonly version: number } | { readonly ok: false; readonly reason: string }>;
};

export type RedraftOutcome = {
  readonly ended: "saved" | "stopped" | "halted";
  /** Parts re-drafted by this press. */
  readonly ran: readonly ArticlePart[];
  readonly version: number | null;
  readonly text: string;
  readonly tone: "neutral" | "warning";
};

const DEFAULTS = { pollMs: 3_000, maxPolls: 100 } as const;

/**
 * Queues and runs one fresh Writer run per part, one at a time, then saves the assembled draft as the next version. The
 * run cap is checked first; the first refusal, failed or cancelled run, timeout or Stop ends it before the save, so the
 * article keeps its current version and every run made stays recorded (a repeat press counts it as a re-draft made).
 */
export async function runRedraft(
  io: RedraftIo,
  projectId: string,
  briefRunId: string,
  parts: readonly ArticlePart[],
  options: { pollMs?: number; maxPolls?: number } = {},
): Promise<RedraftOutcome> {
  const { pollMs, maxPolls } = { ...DEFAULTS, ...options };
  const ran: ArticlePart[] = [];
  const halt = (text: string, ended: RedraftOutcome["ended"] = "halted"): RedraftOutcome => ({
    ended,
    ran,
    version: null,
    tone: ended === "stopped" ? "neutral" : "warning",
    text: `${ran.length > 0 ? `${ran.length} of ${parts.length} re-drafted; ` : ""}${text} The article keeps its current version.`,
  });

  try {
    const room = capRoom(await io.usage(), parts.length);
    if (!room.ok) return halt(room.why);
    const requests = partRequests(projectId, briefRunId, parts);
    for (const [n, request] of requests.entries()) {
      const part = parts[n]!;
      if (io.stopRequested()) return halt("Stopped.", "stopped");
      io.onProgress?.(part, n, parts.length);
      const queued = await io.queue(request);
      const runId = (queued.body as { run?: { id?: unknown } } | null)?.run?.id;
      if (queued.status < 200 || queued.status >= 300 || typeof runId !== "string") {
        return halt(`queueing was refused: ${writeOutcome(queued.status, queued.body, "").text || `HTTP ${queued.status}`}.`);
      }
      const started = await io.execute(runId);
      if (started.kind === "refused") return halt(`the run was refused: ${started.message}`);
      let settled: AgentRun | null = null;
      for (let polls = 0; ; polls += 1) {
        const run = await io.readRun(runId);
        if (run === null) return halt(`run ${runId.slice(0, 8)} could not be read back.`);
        if (run.status !== "queued" && run.status !== "running") {
          settled = run;
          break;
        }
        if (polls >= maxPolls) return halt(`run ${runId.slice(0, 8)} did not finish in time; it may still complete.`);
        await io.sleep(pollMs);
      }
      if (settled.status !== "completed") return halt(`run ${runId.slice(0, 8)} ${settled.status === "cancelled" ? "was cancelled" : `failed${settled.error?.message ? `: ${settled.error.message}` : ""}`}.`);
      ran.push(part);
    }

    const draft = await io.readDraft();
    if (draft === null) return halt("the assembled draft could not be read, so nothing was saved.");
    if (draft.content === null) return halt("a re-drafted part could not be read as its part format, so nothing was saved; re-draft it again or edit it.");
    if (draft.issues.length > 0) return halt(`the assembled draft has ${draft.issues.length} validation ${draft.issues.length === 1 ? "issue" : "issues"}, so nothing was saved. Open it in the editor to fix it.`);
    const saved = await io.saveVersion(draft.content);
    if (!saved.ok) return halt(saveRefusalText(saved.reason));
    return {
      ended: "saved",
      ran,
      version: saved.version,
      tone: "neutral",
      text: `${ran.length} ${ran.length === 1 ? "part" : "parts"} re-drafted and saved as version ${saved.version}. Press Check all units: unchanged parts are carried, only the re-drafted ones are checked.`,
    };
  } catch {
    return halt("a request could not be sent. Check your connection.");
  }
}

export function saveRefusalText(reason: string): string {
  switch (reason) {
    case "unchanged":
      return "the re-drafted text is the same as the current version, so nothing was saved.";
    case "stale":
      return "the article moved to a newer version meanwhile, so nothing was saved; reload and look again.";
    case "archived":
      return "the article is archived, so nothing was saved.";
    case "unauthorized":
      return "your session has ended; reload the page to sign in again.";
    case "rate-limited":
      return "too many saves; wait a moment and press again.";
    default:
      return `the save was refused (${reason}).`;
  }
}

/** The plan in words, for the article step. */
export function redraftNote(plan: RedraftPlan, brief: ParsedBrief): string | null {
  const names = (parts: readonly ArticlePart[]) => parts.map((part) => partLabel(part, brief)).join("; ");
  if (plan.state === "nothing" || plan.state === "unfinished") return null;
  const over = plan.overLimit.length > 0 ? ` Already re-drafted ${MAX_REDRAFTS} times, so yours to edit or to give more evidence: ${names(plan.overLimit)}.` : "";
  if (plan.state === "limit") return `Every part that did not pass was already re-drafted ${MAX_REDRAFTS} times — ${names(plan.overLimit)}. Edit it on the project screen, or admit more evidence.`;
  return `Did not pass: ${names(plan.parts.map((entry) => entry.part))}.${over}`;
}
