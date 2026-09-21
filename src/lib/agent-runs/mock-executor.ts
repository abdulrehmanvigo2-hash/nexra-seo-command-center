import type { AgentExecutor } from "@/lib/agent-runs/executor";
import type { JsonObject } from "@/types/agent-run";

/**
 * The only executor in this milestone: it simulates a task and says so.
 *
 * No network, no model, no credentials, no side effects. Its summary states
 * plainly that nothing was analysed, and its metadata carries
 * `simulated: true`, so a mock result can never be read as a finding. The
 * run's `executor` column records `mock` for the same reason.
 */
export const mockAgentExecutor: AgentExecutor = {
  id: "mock",

  async execute(task, signal) {
    if (signal.aborted) throw new Error("aborted");

    const subject = `${task.agent.name} for ${task.project.domain}`;

    switch (task.taskType) {
      case "project-review": {
        const focus = typeof task.input.focus === "string" ? task.input.focus : null;
        const metadata: JsonObject = {
          simulated: true,
          taskType: task.taskType,
          attempt: task.attempt,
          focus,
        };
        return {
          summary: `Simulated project review by ${subject}${focus ? `, focused on "${focus}"` : ""}. The mock executor performed no analysis; this is placeholder output.`,
          metadata,
        };
      }
      case "crawl-review":
      case "on-page-review": {
        const crawlId = typeof task.input.crawlId === "string" ? task.input.crawlId : null;
        const metadata: JsonObject = {
          simulated: true,
          // The mock executor reads no crawl. Saying otherwise here would put
          // `grounded: true` on a run that looked at nothing.
          grounded: false,
          taskType: task.taskType,
          attempt: task.attempt,
          crawlId,
        };
        const kind = task.taskType === "crawl-review" ? "crawl review" : "on-page review";
        return {
          summary: `Simulated ${kind} by ${subject}. The mock executor read no crawl and analysed nothing; this is placeholder output.`,
          metadata,
        };
      }
      case "search-query-review": {
        const range = typeof task.input.range === "string" ? task.input.range : null;
        const metadata: JsonObject = {
          simulated: true,
          // The mock executor reads no report. `grounded: false` for the same
          // reason as the crawl reviews: it looked at nothing.
          grounded: false,
          taskType: task.taskType,
          attempt: task.attempt,
          range,
        };
        return {
          summary: `Simulated search query review by ${subject}. The mock executor read no Search Console data and analysed nothing; this is placeholder output.`,
          metadata,
        };
      }
      case "priority-review": {
        const sourceRunId = typeof task.input.sourceRunId === "string" ? task.input.sourceRunId : null;
        const metadata: JsonObject = {
          simulated: true,
          // The mock executor reads no upstream run. `grounded: false`, as for
          // every simulated result: it looked at nothing and ranked nothing.
          grounded: false,
          taskType: task.taskType,
          attempt: task.attempt,
          sourceRunId,
        };
        return {
          summary: `Simulated priority review by ${subject}. The mock executor read no upstream review and ranked nothing; this is placeholder output.`,
          metadata,
        };
      }
      case "keyword-research": {
        const seeds = Array.isArray(task.input.seedKeywords) ? task.input.seedKeywords.length : 0;
        const metadata: JsonObject = {
          simulated: true,
          taskType: task.taskType,
          attempt: task.attempt,
          seedKeywordCount: seeds,
        };
        return {
          summary: `Simulated keyword research by ${subject} from ${seeds} seed keyword${seeds === 1 ? "" : "s"}. The mock executor looked nothing up; this is placeholder output.`,
          metadata,
        };
      }
    }
  },
};
