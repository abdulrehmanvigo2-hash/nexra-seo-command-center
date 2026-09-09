import { getAgentRecord } from "@/lib/mock/agents/registry";
import { operationFor } from "@/lib/mock/agents/operations";
import { getAgentTasks } from "@/lib/mock/agents/tasks";
import type { AgentOperation } from "@/types/dashboard";
import type {
  AgentHandoff,
  AgentId,
  AgentTask,
  HandoffStatus,
} from "@/types/agent";

/**
 * Work moving from one agent to the next.
 *
 * A handoff is a task that has reached the end of its own stage, read from the
 * point of view of the agent it goes to. Building it from the task board
 * rather than from a separate fixture means the work item named here is a task
 * that genuinely exists, on a project that genuinely has it, owned by the
 * agent the board says owns it -- and that the two views cannot drift apart.
 *
 * A task only appears once there is something to hand over: finished, waiting
 * on a decision, or far enough through that the next agent is already reading
 * it in. Anything earlier is work in progress, not a transfer.
 *
 * Where the handoff has got to is a question about the *receiving* agent, so
 * that is what decides the state: an idle receiver means the work is sitting
 * there ready to be picked up, a busy one means it has been taken on, and a
 * stopped one means it cannot move at all.
 */

const STATUS_RANK: Record<HandoffStatus, number> = {
  blocked: 0,
  "needs-revision": 1,
  ready: 2,
  "in-transfer": 3,
  accepted: 4,
};

const REVIEW_STATE: Record<HandoffStatus, string> = {
  ready: "Waiting to be picked up",
  "in-transfer": "Being read in by the receiving agent",
  accepted: "Taken on and in progress",
  "needs-revision": "Held for a decision before it can move on",
  blocked: "Cannot transfer until the receiving stage clears",
};

/** How far a task has to be before there is anything to hand over. */
function isHandoverReady(task: AgentTask): boolean {
  return (
    task.status === "completed" ||
    task.status === "review" ||
    (task.status === "working" && task.progress >= 78)
  );
}

function statusFor(
  task: AgentTask,
  receiver: AgentOperation | undefined,
): HandoffStatus {
  // Output still awaiting a decision has not been released to anybody yet.
  if (task.status === "review") return "needs-revision";

  switch (receiver?.status) {
    case "blocked":
      return "blocked";
    case "needs-review":
      return "needs-revision";
    case "waiting":
      return "ready";
    case undefined:
      // The receiving agent is not staffed on this engagement, so the work is
      // finished and sitting with nobody to take it.
      return "ready";
    case "working":
    case "active":
      return receiver.progress < 50 ? "in-transfer" : "accepted";
    default:
      return "accepted";
  }
}

let cache: readonly AgentHandoff[] | null = null;

/** Every handoff across the portfolio, most urgent first. */
export function getAgentHandoffs(): readonly AgentHandoff[] {
  cache ??= build();
  return cache;
}

function build(): readonly AgentHandoff[] {
  const handoffs: AgentHandoff[] = [];

  for (const task of getAgentTasks()) {
    if (!task.nextHandoff || !isHandoverReady(task)) continue;

    const receiver = operationFor(task.projectId, task.nextHandoff);
    const status = statusFor(task, receiver);
    const kind = getAgentRecord(task.agent)?.outputKinds[0] ?? "Completed work";

    handoffs.push({
      id: `handoff-${task.id}`,
      from: task.agent,
      to: task.nextHandoff,
      projectId: task.projectId,
      projectName: task.projectName,
      workItem: `${kind}: ${task.title}`,
      status,
      at: task.startedAt ?? task.due,
      reviewState: REVIEW_STATE[status],
    });
  }

  return handoffs.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      Date.parse(b.at) - Date.parse(a.at),
  );
}

/** Handoffs into an agent, and out of it. */
export function handoffsForAgent(agentId: AgentId): {
  readonly incoming: readonly AgentHandoff[];
  readonly outgoing: readonly AgentHandoff[];
} {
  const all = getAgentHandoffs();
  return {
    incoming: all.filter((handoff) => handoff.to === agentId),
    outgoing: all.filter((handoff) => handoff.from === agentId),
  };
}

/** Handoffs still to be resolved, touching this agent either way. */
export function openHandoffCount(agentId: AgentId): number {
  return getAgentHandoffs().filter(
    (handoff) =>
      (handoff.from === agentId || handoff.to === agentId) &&
      handoff.status !== "accepted",
  ).length;
}
