import { CRAWL_SOURCE, type GroundingReader } from "@/lib/agent-runs/ai-executor";
import { readRunGrounding, type AgentRunReader } from "@/lib/agent-runs/run-grounding";
import { getTaskType } from "@/lib/agent-runs/task-types";
import { readCrawlGrounding, type CrawlGroundingReader } from "@/lib/crawl/grounding";
import { readProjectGrounding, type ProjectGroundingReaders } from "@/lib/projects/grounding";
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
 * run's own project and the window in its input (`search-query-review`); one
 * declaring `evidence: "agent-run"` is given one other agent's completed,
 * grounded review from the same project (`priority-review`); one declaring
 * `evidence: "project"` is given the run's own stored project record and an
 * inventory of the evidence this product holds for it (`intake-review`);
 * every other task gets none. In every case the project is the run's: a
 * crawl id or a source run id is checked against it, a report is fetched for
 * it, and a record is read by it, so nothing a caller writes can reach
 * another client's data.
 *
 * Pure apart from the readers it is handed, so the same dispatch runs against
 * Supabase and Google in the application and in-memory fakes in a test.
 */
export type TaskGroundingReaders = {
  readonly crawls: CrawlGroundingReader;
  readonly searchConsole: SearchConsoleReportReader;
  /** The run store itself satisfies this; a test hands in a map. */
  readonly runs: AgentRunReader;
  /** The project repository, crawl service, Search Console and run store, each read by project id. */
  readonly projects: ProjectGroundingReaders;
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

      case "agent-run": {
        const sourceRunId = task.input.sourceRunId;
        if (typeof sourceRunId !== "string") return { ok: false, reason: "source-run-id-missing" };

        const result = await readRunGrounding(readers.runs, { sourceRunId, projectId: task.project.id });
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

      case "project": {
        // No input is read: the project is the run's own, and nothing else.
        const result = await readProjectGrounding(readers.projects, { projectId: task.project.id });
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
