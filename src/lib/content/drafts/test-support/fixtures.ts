import type { AgentRun } from "@/types/agent-run";
import { WRITER_STATUS_LINE } from "@/lib/content/drafts/parse-writer-output";

/**
 * Shared fixtures for the draft tests: one Writer answer in the fixed five
 * sections, and one completed, grounded Writer run that holds it. Test
 * support only; nothing in the application imports this.
 */

export const PLAN_ID = "11111111-0000-4000-8000-000000000060";
export const CRAWL_ID = "8f1c0d2e-0000-4000-8000-000000000001";
export const WRITER_RUN_ID = "11111111-0000-4000-8000-000000000070";
export const OPERATOR_ID = "00000000-0000-4000-8000-00000000000a";

export const WRITER_OUTPUT = [
  "SECTION\nWhat automated lead follow-up does [crawl /]",
  "DRAFT\nNexra Agency's home page presents automated lead follow-up as the service it leads with. Its title names automation and its one heading repeats it, so a visitor arriving from search meets the same promise twice.\nThe page describes itself as the canonical address for that offer.",
  "CLAIMS USED\nThe home page title names automation. [crawl /]\nThe page has one h1. [crawl /]\nThe canonical points at itself. [crawl /]",
  "PLACEHOLDERS\n[NEEDS EVIDENCE: how quickly a lead is contacted]",
  `STATUS\n${WRITER_STATUS_LINE}`,
  "Every claim in this draft is listed above with the record it rests on; nothing here was published or sent anywhere.",
].join("\n\n");

export function writerRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: WRITER_RUN_ID,
    projectId: "nexra-agency",
    agentId: "writer",
    taskType: "section-draft",
    input: { planRunId: PLAN_ID },
    status: "completed",
    source: "operator",
    executor: "ai",
    attemptCount: 1,
    maxAttempts: 3,
    resultSummary: WRITER_OUTPUT,
    resultMetadata: {
      simulated: false,
      grounded: true,
      taskType: "section-draft",
      attempt: 1,
      provider: "anthropic",
      model: "test-model",
      inputTokens: 1_000,
      outputTokens: 300,
      evidence: {
        source: "content-draft",
        projectId: "nexra-agency",
        projectHost: "nexraagency.com",
        planRunId: PLAN_ID,
        planCompletedAt: "2026-09-22T09:00:00.000Z",
        planCrawlId: CRAWL_ID,
        crawlId: CRAWL_ID,
        section: "What automated lead follow-up does [crawl /]",
        sectionIndex: 1,
        outlineTagged: 4,
        outlineNeedingEvidence: 0,
        planTruncated: false,
        bytes: 9_000,
      },
    },
    error: null,
    createdBy: OPERATOR_ID,
    cancelledBy: null,
    createdAt: "2026-09-22T09:10:00.000Z",
    updatedAt: "2026-09-22T09:12:00.000Z",
    startedAt: "2026-09-22T09:11:00.000Z",
    finishedAt: "2026-09-22T09:12:00.000Z",
    nextAttemptAt: null,
    autoRetryCount: 0,
    ...overrides,
  };
}
