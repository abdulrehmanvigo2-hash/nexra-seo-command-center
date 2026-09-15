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
