import type { GroundingReader } from "@/lib/agent-runs/ai-executor";
import { getTaskType } from "@/lib/agent-runs/task-types";
import { readCrawlGrounding, type CrawlGroundingReader } from "@/lib/crawl/grounding";

/**
 * Which evidence a task is allowed to see, decided by what its task type
 * declares rather than by its name.
 *
 * The runtime reads the evidence, not the executor, which reaches no system of
 * its own. A task type that declares `evidence: "crawl"` is given one crawl
 * this product recorded — `crawl-review` and `on-page-review` today — and
 * every other task gets none. The run's project decides which crawls are
 * readable: the crawl id in the input is checked against it, so naming
 * another project's crawl is refused rather than answered.
 *
 * Pure apart from the reader it is handed, so the same dispatch runs against
 * the Supabase crawl store in the application and an in-memory one in a test.
 */
export function createTaskGrounding(crawls: CrawlGroundingReader): GroundingReader {
  return async (task) => {
    const definition = getTaskType(task.taskType);
    if (!definition || definition.evidence !== "crawl") return { ok: true, grounding: null };

    const crawlId = task.input.crawlId;
    if (typeof crawlId !== "string") return { ok: false, reason: "crawl-id-missing" };

    const result = await readCrawlGrounding(crawls, { crawlId, projectId: task.project.id });
    if (!result.ok) return { ok: false, reason: result.reason };

    return {
      ok: true,
      grounding: { text: result.grounding.text, summary: { ...result.grounding.summary } },
    };
  };
}
