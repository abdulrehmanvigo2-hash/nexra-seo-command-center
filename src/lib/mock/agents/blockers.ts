import { daysBefore } from "@/lib/mock/dashboard/core";
import { AGENT_REGISTRY, getAgentRecord } from "@/lib/mock/agents/registry";
import { operationsFor } from "@/lib/mock/agents/operations";
import { getProjectRecord } from "@/lib/mock/projects/roster";
import { getAgentHandoffs } from "@/lib/mock/agents/handoffs";
import { getAgentTasks } from "@/lib/mock/agents/tasks";
import type {
  AgentBlocker,
  AgentId,
  AgentTask,
  BlockerKind,
} from "@/types/agent";
import type { Priority } from "@/types/dashboard";

/**
 * Everything currently stopping work, in one queue.
 *
 * Assembled from records that already exist rather than authored separately: a
 * blocked task on the agent board, a handoff that cannot complete, an output
 * waiting on a decision, work that is going to be late. If a task's state
 * changes, the queue changes with it, because it is reading the same task.
 *
 * One item per cause. A task that is both blocked and overdue is a blocked
 * task — listing it twice would inflate the queue and make the count useless
 * as a measure of how much is actually stuck.
 *
 * The queue also reads the operations board directly, not only the task board.
 * Those are two different records: a project's board can show an agent stopped
 * without a specific task being marked blocked, and that is what the Command
 * Center and the project's team panel display. If the queue ignored it, an
 * agent could read "Blocked" on its own workspace while its blocker list sat
 * empty — a contradiction the roster status would then be unable to explain.
 *
 * The controls this feeds are frontend state only. Nothing here retries,
 * reassigns, or dispatches anything (CLAUDE.md §4).
 */

const SEVERITY_RANK: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** One step down the priority scale, for causes that are not yet failures. */
const SOFTENED: Record<Priority, Priority> = {
  critical: "high",
  high: "medium",
  medium: "medium",
  low: "low",
};

const KIND_RANK: Record<BlockerKind, number> = {
  "blocked-task": 0,
  "failed-handoff": 1,
  "review-waiting": 2,
  dependency: 3,
  overdue: 4,
};

const REMEDY: Record<
  BlockerKind,
  { readonly action: string; readonly label: string }
> = {
  "blocked-task": {
    action: "Clear the upstream dependency, then retry the run.",
    label: "Retry",
  },
  "failed-handoff": {
    action: "Return the work item to the sending agent, or reassign it.",
    label: "Reassign",
  },
  "review-waiting": {
    action: "Review the output and release it to the next stage.",
    label: "Mark reviewed",
  },
  dependency: {
    action: "Chase the upstream agent or re-sequence this stage.",
    label: "Reassign",
  },
  overdue: {
    action: "Re-plan the due date, or escalate it to the Project Manager.",
    label: "Resolve",
  },
};

/** Where a task's trouble started. Falls back to its due date. */
function since(task: AgentTask): string {
  return task.startedAt ?? task.due;
}

function dependencyName(agent: AgentId | null): string {
  if (!agent) return "an upstream stage";
  return getAgentRecord(agent)?.name ?? "an upstream stage";
}

let cache: readonly AgentBlocker[] | null = null;

/** The blocker and review queue, most severe first. */
export function getAgentBlockers(): readonly AgentBlocker[] {
  cache ??= build();
  return cache;
}

function build(): readonly AgentBlocker[] {
  const blockers: AgentBlocker[] = [];

  const add = (
    id: string,
    kind: BlockerKind,
    agent: AgentId,
    projectId: string,
    projectName: string,
    issue: string,
    severity: Priority,
    at: string,
  ) => {
    blockers.push({
      id,
      kind,
      agent,
      projectId,
      projectName,
      issue,
      severity,
      since: at,
      recommendedAction: REMEDY[kind].action,
      actionLabel: REMEDY[kind].label,
    });
  };

  for (const task of getAgentTasks()) {
    if (task.status === "completed") continue;

    if (task.status === "blocked") {
      add(
        `blocker-${task.id}`,
        "blocked-task",
        task.agent,
        task.projectId,
        task.projectName,
        `"${task.title}" is stopped at ${task.progress}% and cannot continue.`,
        task.priority,
        since(task),
      );
      continue;
    }

    if (task.status === "review") {
      add(
        `blocker-${task.id}`,
        "review-waiting",
        task.agent,
        task.projectId,
        task.projectName,
        `"${task.title}" is finished and waiting on a decision.`,
        SOFTENED[task.priority],
        since(task),
      );
      continue;
    }

    // Only work that matters is worth calling a blocker: a low-priority task
    // running late is a scheduling note, not something holding the team up.
    const material = task.priority === "critical" || task.priority === "high";
    if (!material) continue;

    if (task.dueState === "overdue") {
      add(
        `blocker-${task.id}`,
        "overdue",
        task.agent,
        task.projectId,
        task.projectName,
        `"${task.title}" passed its due date and is still open.`,
        task.priority,
        since(task),
      );
      continue;
    }

    if (task.status === "queued" && task.dependency) {
      add(
        `blocker-${task.id}`,
        "dependency",
        task.agent,
        task.projectId,
        task.projectName,
        `"${task.title}" cannot start until ${dependencyName(task.dependency)} delivers.`,
        SOFTENED[task.priority],
        since(task),
      );
    }
  }

  // Agents stopped or awaiting a decision on the operations board itself.
  // Skipped where the task board has already reported that pair, so one stuck
  // agent on one project is one row, not two.
  const reported = new Set(
    blockers.map((blocker) => `${blocker.agent}:${blocker.projectId}`),
  );

  for (const agent of AGENT_REGISTRY) {
    for (const { projectId, operation } of operationsFor(agent.id)) {
      if (operation.status !== "blocked" && operation.status !== "needs-review") {
        continue;
      }
      if (reported.has(`${agent.id}:${projectId}`)) continue;

      const project = getProjectRecord(projectId);
      if (!project) continue;

      const stopped = operation.status === "blocked";

      add(
        `blocker-ops-${agent.id}-${projectId}`,
        stopped ? "blocked-task" : "review-waiting",
        agent.id,
        projectId,
        project.name,
        stopped
          ? `"${operation.currentTask}" is stopped at ${operation.progress}% and the agent cannot continue.`
          : `"${operation.currentTask}" is finished and waiting on a decision.`,
        stopped ? "high" : "medium",
        operation.lastActivity,
      );

      reported.add(`${agent.id}:${projectId}`);
    }
  }

  for (const handoff of getAgentHandoffs()) {
    if (handoff.status !== "blocked" && handoff.status !== "needs-revision") {
      continue;
    }

    const to = getAgentRecord(handoff.to)?.name ?? "the next stage";

    add(
      `blocker-${handoff.id}`,
      "failed-handoff",
      handoff.from,
      handoff.projectId,
      handoff.projectName,
      handoff.status === "blocked"
        ? `Work cannot transfer to ${to}: the sending stage is stopped.`
        : `${to} returned the work item for revision.`,
      handoff.status === "blocked" ? "critical" : "high",
      handoff.at,
    );
  }

  return blockers.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      Date.parse(a.since) - Date.parse(b.since),
  );
}

/** Blockers sitting against one agent. */
export function blockersForAgent(agentId: AgentId): readonly AgentBlocker[] {
  return getAgentBlockers().filter((blocker) => blocker.agent === agentId);
}

/** Age of a blocker in whole days against the reference instant. */
export function blockerAgeDays(blocker: AgentBlocker): number {
  const days = Math.round(
    (Date.parse(daysBefore(0)) - Date.parse(blocker.since)) / 86_400_000,
  );
  return Math.max(0, days);
}
