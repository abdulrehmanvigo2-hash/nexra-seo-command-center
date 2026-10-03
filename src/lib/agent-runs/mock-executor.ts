import type { AgentExecutor } from "@/lib/agent-runs/executor";
import type { JsonObject } from "@/types/agent-run";

/**
 * The default executor (`NEXRA_AGENT_EXECUTOR` unset or `mock`): it simulates a
 * task and says so; the `ai` executor is `./ai-executor`.
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
      case "on-page-review":
      case "answer-readiness-review": {
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
        const kind =
          task.taskType === "crawl-review"
            ? "crawl review"
            : task.taskType === "on-page-review"
              ? "on-page review"
              : "answer-readiness review";
        return {
          summary: `Simulated ${kind} by ${subject}. The mock executor read no crawl and analysed nothing; this is placeholder output.`,
          metadata,
        };
      }
      case "search-query-review":
      case "performance-review": {
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
        const kind = task.taskType === "search-query-review" ? "search query review" : "performance review";
        return {
          summary: `Simulated ${kind} by ${subject}. The mock executor read no Search Console data and analysed nothing; this is placeholder output.`,
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
      case "project-priority-review": {
        const metadata: JsonObject = {
          simulated: true,
          // The mock executor reads no specialist review. `grounded: false`,
          // as for every simulated result: it looked at nothing and ranked
          // nothing.
          grounded: false,
          taskType: task.taskType,
          attempt: task.attempt,
        };
        return {
          summary: `Simulated project Director review by ${subject}. The mock executor read no specialist review or recorded finding and ranked nothing; this is placeholder output.`,
          metadata,
        };
      }
      case "intake-review": {
        const metadata: JsonObject = {
          simulated: true,
          // The mock executor reads no project record. `grounded: false`, as
          // for every simulated result: it looked at nothing.
          grounded: false,
          taskType: task.taskType,
          attempt: task.attempt,
        };
        return {
          summary: `Simulated intake review by ${subject}. The mock executor read no project record or evidence inventory and analysed nothing; this is placeholder output.`,
          metadata,
        };
      }
      case "task-plan-review": {
        const metadata: JsonObject = {
          simulated: true,
          // The mock executor reads no task. `grounded: false`, as for every
          // simulated result: it looked at nothing and ordered nothing.
          grounded: false,
          taskType: task.taskType,
          attempt: task.attempt,
        };
        return {
          summary: `Simulated task plan review by ${subject}. The mock executor read no task and ordered nothing; this is placeholder output.`,
          metadata,
        };
      }
      case "competitor-comparison-review": {
        const competitorDomain = typeof task.input.competitorDomain === "string" ? task.input.competitorDomain : null;
        const metadata: JsonObject = {
          simulated: true,
          // The mock executor reads neither crawl. `grounded: false`, as for
          // every simulated result: it looked at nothing and compared nothing.
          grounded: false,
          taskType: task.taskType,
          attempt: task.attempt,
          competitorDomain,
        };
        return {
          summary: `Simulated competitor comparison review by ${subject}. The mock executor read no crawl of either site and compared nothing; this is placeholder output.`,
          metadata,
        };
      }
      case "evidence-pack-review": {
        const metadata: JsonObject = {
          simulated: true,
          // The mock executor reads no record. `grounded: false`, as for
          // every simulated result: it looked at nothing and packed nothing.
          grounded: false,
          taskType: task.taskType,
          attempt: task.attempt,
        };
        return {
          summary: `Simulated evidence pack by ${subject}. The mock executor read no crawl, no Search Console report and no competitor record, and compiled nothing; this is placeholder output, not evidence.`,
          metadata,
        };
      }
      case "content-plan-review": {
        const metadata: JsonObject = {
          simulated: true,
          // The mock executor reads no record. `grounded: false`, as for
          // every simulated result: it looked at nothing and planned nothing.
          grounded: false,
          taskType: task.taskType,
          attempt: task.attempt,
        };
        return {
          summary: `Simulated content plan by ${subject}. The mock executor read no crawl, no Search Console report and no competitor record, and planned nothing; this is placeholder output, not a grounded plan.`,
          metadata,
        };
      }
      case "section-draft": {
        const metadata: JsonObject = {
          simulated: true,
          // The mock executor reads no plan and no record. `grounded: false`,
          // as for every simulated result: it looked at nothing and drafted
          // nothing.
          grounded: false,
          taskType: task.taskType,
          attempt: task.attempt,
          planRunId: typeof task.input.planRunId === "string" ? task.input.planRunId : null,
          sectionIndex: typeof task.input.sectionIndex === "number" ? task.input.sectionIndex : null,
        };
        return {
          summary: `Simulated section draft by ${subject}. The mock executor read no plan and no record, and drafted nothing; this is placeholder output, not a draft.`,
          metadata,
        };
      }
      case "outbound-link-review": {
        const crawlId = typeof task.input.crawlId === "string" ? task.input.crawlId : null;
        const metadata: JsonObject = {
          simulated: true,
          // The mock executor reads no crawl and no link record. `grounded:
          // false`, as for every simulated result: it looked at nothing.
          grounded: false,
          taskType: task.taskType,
          attempt: task.attempt,
          crawlId,
        };
        return {
          summary: `Simulated outbound link review by ${subject}. The mock executor read no crawl and no link record, and reviewed nothing; this is placeholder output, not a link review.`,
          metadata,
        };
      }
      case "draft-fact-check": {
        const metadata: JsonObject = {
          simulated: true,
          // The mock executor reads no draft and no record. `grounded:
          // false`, as for every simulated result: it looked at nothing and
          // checked nothing, so nothing here can be recorded on a version.
          grounded: false,
          taskType: task.taskType,
          attempt: task.attempt,
          draftId: typeof task.input.draftId === "string" ? task.input.draftId : null,
          version: typeof task.input.version === "number" ? task.input.version : null,
        };
        return {
          summary: `Simulated draft fact-check by ${subject}. The mock executor read no draft version and no record, and checked nothing; this is placeholder output, not a fact-check.`,
          metadata,
        };
      }
      case "article-check-unit": {
        const metadata: JsonObject = {
          simulated: true,
          // The mock executor reads no article and no record. `grounded:
          // false`, as for every simulated result: it looked at nothing and
          // checked nothing, so nothing here can be recorded on a unit.
          grounded: false,
          taskType: task.taskType,
          attempt: task.attempt,
          articleId: typeof task.input.articleId === "string" ? task.input.articleId : null,
          articleVersion: typeof task.input.articleVersion === "number" ? task.input.articleVersion : null,
          unitIndex: typeof task.input.unitIndex === "number" ? task.input.unitIndex : null,
        };
        return {
          summary: `Simulated article check unit by ${subject}. The mock executor read no article version and no record, and checked nothing; this is placeholder output, not a fact-check.`,
          metadata,
        };
      }
      case "keyword-opportunity-review":
      case "content-refresh-review":
      case "article-revision-draft":
      case "page-query-alignment-review":
      case "finding-history-review":
      case "learning-review":
      case "competitor-page-gap-review":
      case "schema-entity-review":
      case "internal-link-review": {
        // The second grounded tasks (checkpoints 6.5 and 6.6): the mock executor reads
        // no record of any kind, so `grounded: false`, as for every simulated
        // result; the revision draft drafts nothing.
        const metadata: JsonObject = {
          simulated: true,
          grounded: false,
          taskType: task.taskType,
          attempt: task.attempt,
        };
        return {
          summary: `Simulated ${task.taskType.replace(/-/g, " ")} by ${subject}. The mock executor read no record and analysed nothing; this is placeholder output.`,
          metadata,
        };
      }
      case "opportunity-brief": {
        // M5: the mock executor reads no opportunity and briefs nothing.
        const metadata: JsonObject = { simulated: true, grounded: false, taskType: task.taskType, attempt: task.attempt };
        return {
          summary: `Simulated opportunity brief by ${subject}. The mock executor read no record and proposed nothing; this is placeholder output.`,
          metadata,
        };
      }
      case "evidence-extract": {
        // M4: the mock executor reads no outside page and extracts nothing. Its answer is not in the
        // unit format and the database refuses units from a simulated run, so nothing it writes can
        // become evidence.
        const metadata: JsonObject = { simulated: true, grounded: false, taskType: task.taskType, attempt: task.attempt };
        return {
          summary: `Simulated evidence extraction by ${subject}. The mock executor read no outside page and extracted nothing; this is placeholder output, never evidence.`,
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
