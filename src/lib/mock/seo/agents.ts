import type { AgentTask } from "@/types/seo";

/**
 * Live work carried out by the twelve specialist agents.
 *
 * Demo fixtures — the agents are mocked in this milestone (CLAUDE.md §13), so
 * these are realistic run records, not the output of any runtime.
 */

/**
 * Display names for the twelve agents, keyed by id.
 *
 * Re-exported from the agent registry rather than written again here: the
 * registry is the one place an agent's name is defined, so a name shown on a
 * project chip is the same string shown on the agent's own workspace.
 */
export { AGENT_NAMES } from "@/lib/mock/agents/registry";

/** Current board, one representative task per agent. */
export const AGENT_ACTIVITY: readonly AgentTask[] = [
  {
    id: "task-01",
    agent: "seo-director",
    project: "Halcyon Fintech",
    task: "Re-prioritise the Q4 roadmap from the latest analytics feedback",
    status: "running",
    progress: 62,
    priority: "critical",
    startedAt: "2026-09-08T07:40:00Z",
    completedAt: null,
  },
  {
    id: "task-02",
    agent: "project-manager",
    project: "Verdant Home",
    task: "Confirm September delivery scope and reschedule two milestones",
    status: "complete",
    progress: 100,
    priority: "medium",
    startedAt: "2026-09-08T06:15:00Z",
    completedAt: "2026-09-08T07:02:00Z",
  },
  {
    id: "task-03",
    agent: "market-intelligence",
    project: "Orbit Logistics",
    task: "Map the SERP competitor set for the freight-management cluster",
    status: "running",
    progress: 38,
    priority: "medium",
    startedAt: "2026-09-08T08:05:00Z",
    completedAt: null,
  },
  {
    id: "task-04",
    agent: "keyword-intent",
    project: "Halcyon Fintech",
    task: "Cluster 412 newly discovered keywords by search intent",
    status: "complete",
    progress: 100,
    priority: "high",
    startedAt: "2026-09-07T21:30:00Z",
    completedAt: "2026-09-08T01:12:00Z",
  },
  {
    id: "task-05",
    agent: "content-strategist",
    project: "Meridian Clinics",
    task: "Draft the topical map for the treatment-comparison hub",
    status: "running",
    progress: 74,
    priority: "high",
    startedAt: "2026-09-08T05:20:00Z",
    completedAt: null,
  },
  {
    id: "task-06",
    agent: "research-evidence",
    project: "Halcyon Fintech",
    task: "Verify 38 regulatory claims in the compliance guide",
    status: "review",
    progress: 100,
    priority: "critical",
    startedAt: "2026-09-07T18:44:00Z",
    completedAt: null,
  },
  {
    id: "task-07",
    agent: "writer",
    project: "Skyline Outdoors",
    task: "Draft eight product-comparison pages against approved briefs",
    status: "running",
    progress: 45,
    priority: "medium",
    startedAt: "2026-09-08T04:10:00Z",
    completedAt: null,
  },
  {
    id: "task-08",
    agent: "on-page-seo",
    project: "Verdant Home",
    task: "Rewrite titles and meta descriptions for 126 category pages",
    status: "queued",
    progress: 0,
    priority: "medium",
    startedAt: null,
    completedAt: null,
  },
  {
    id: "task-09",
    agent: "technical-seo",
    project: "Skyline Outdoors",
    task: "Resolve duplicate canonical tags across paginated archives",
    status: "running",
    progress: 81,
    priority: "critical",
    startedAt: "2026-09-08T03:55:00Z",
    completedAt: null,
  },
  {
    id: "task-10",
    agent: "ai-visibility",
    project: "Orbit Logistics",
    task: "Audit answer-readiness on the top 40 landing pages",
    status: "queued",
    progress: 0,
    priority: "high",
    startedAt: null,
    completedAt: null,
  },
  {
    id: "task-11",
    agent: "authority-backlink",
    project: "Meridian Clinics",
    task: "Qualify 60 digital-PR prospects for the annual report campaign",
    status: "paused",
    progress: 27,
    priority: "low",
    startedAt: "2026-09-06T14:20:00Z",
    completedAt: null,
  },
  {
    id: "task-12",
    agent: "analytics-learning",
    project: "Halcyon Fintech",
    task: "Attribute August ranking gains back to the actions that caused them",
    status: "failed",
    progress: 64,
    priority: "high",
    startedAt: "2026-09-07T23:10:00Z",
    completedAt: "2026-09-08T00:03:00Z",
  },
];
