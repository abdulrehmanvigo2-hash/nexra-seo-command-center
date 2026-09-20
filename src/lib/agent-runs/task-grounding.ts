import { CRAWL_SOURCE, type GroundingReader } from "@/lib/agent-runs/ai-executor";
import { getTaskType } from "@/lib/agent-runs/task-types";
import { readCrawlGrounding, type CrawlGroundingReader } from "@/lib/crawl/grounding";
import {
  readSearchConsoleGrounding,
  type SearchConsoleReportReader,
} from "@/lib/search-console/grounding";

/**
 * Which evidence a task is allowed to see, decided by what its task type
 * declares rather than by its name.
 *
 * The runtime reads the evidence, not the executor, which reaches no system of
 * its own. A task type declaring `evidence: "crawl"` is given one crawl this
 * product recorded (`crawl-review`, `on-page-review`); one declaring
 * `evidence: "search-console"` is given the Search Console report for the
 * run's own project and the window in its input (`search-query-review`);
 * every other task gets none. In both cases the project is the run's: a crawl
 * id is checked against it, and a report is fetched for it, so nothing a
 * caller writes can reach another client's data.
 *
 * Pure apart from the readers it is handed, so the same dispatch runs against
 * Supabase and Google in the application and in-memory fakes in a test.
 */
export type TaskGroundingReaders = {
  readonly crawls: CrawlGroundingReader;
  readonly searchConsole: SearchConsoleReportReader;
};

export function createTaskGrounding(readers: TaskGroundingReaders): GroundingReader {
  return async (task) => {
    const definition = getTaskType(task.taskType);
    if (!definition) return { ok: true, grounding: null };

    switch (definition.evidence) {
      case "none":
        return { ok: true, grounding: null };

      case "crawl": {
        const crawlId = task.input.crawlId;
        if (typeof crawlId !== "string") return { ok: false, reason: "crawl-id-missing" };

        const result = await readCrawlGrounding(readers.crawls, { crawlId, projectId: task.project.id });
        if (!result.ok) return { ok: false, reason: result.reason };

        return {
          ok: true,
          grounding: {
            text: result.grounding.text,
            summary: { ...result.grounding.summary },
            source: CRAWL_SOURCE,
          },
        };
      }

      case "search-console": {
        const result = await readSearchConsoleGrounding(readers.searchConsole, {
          projectId: task.project.id,
          rangeId: task.input.range,
        });
        if (!result.ok) return { ok: false, reason: result.reason };

        return {
          ok: true,
          grounding: {
            text: result.grounding.text,
            summary: { ...result.grounding.summary },
            source: result.grounding.source,
          },
        };
      }
    }
  };
}
