import {
  TASK_READ_DEFAULT_LIMIT,
  TASK_READ_LIMIT,
  type AgentTask,
  type AgentTaskEvent,
  type ChangeTaskOwnerInput,
  type ChangeTaskOwnerOutcome,
  type ChangeTaskStatusInput,
  type ChangeTaskStatusOutcome,
  type CreateAgentTaskInput,
  type CreateAgentTaskOutcome,
  type HandoffRequestInput,
  type ListAgentTasksFilter,
} from "@/lib/agent-tasks/contract";
import { handoffFor, handoffInput, handoffRecordKind, type HandoffRecord, type HandoffRecordKind } from "@/lib/agent-tasks/handoff";
import { latestLinkedRunId, outcomeMismatch, presentTaskRunOutcome, type TaskRunOutcome } from "@/lib/agent-tasks/outcome";
import type { AgentTaskStore } from "@/lib/agent-tasks/store-contract";
import { canonicalCompetitorHost } from "@/lib/crawl/competitor-target";
import { logEvent } from "@/lib/observability/log";
import type { AgentRun } from "@/types/agent-run";

/**
 * The task service: bounded reads per project and operator-triggered writes,
 * each one database function. It holds no rule the database does not also
 * hold — the functions re-check everything — and it never executes anything:
 * a status or owner change tells no agent anything, and a handoff creates at
 * most one queued run through the run path, which the scheduled worker or an
 * operator's separate "Run now" executes later.
 */

export type CreateAgentTaskResult = CreateAgentTaskOutcome | { readonly status: "unavailable" };

export type ListAgentTasksResult =
  | { readonly status: "listed"; readonly tasks: readonly AgentTask[] }
  | { readonly status: "unavailable" };

export type ReadAgentTaskResult =
  | { readonly status: "found"; readonly task: AgentTask; readonly events: readonly AgentTaskEvent[] }
  | { readonly status: "task-not-found" }
  | { readonly status: "unavailable" };

export type ChangeTaskStatusResult = ChangeTaskStatusOutcome | { readonly status: "unavailable" };
export type ChangeTaskOwnerResult = ChangeTaskOwnerOutcome | { readonly status: "unavailable" };

export type HandoffTaskResult =
  /** One run was created and linked. `duplicate` says the run path found an identical active run instead of inserting. */
  | { readonly status: "handed-off"; readonly task: AgentTask; readonly run: AgentRun; readonly duplicate: boolean }
  | { readonly status: "task-not-found" }
  | { readonly status: "terminal"; readonly task: AgentTask }
  | { readonly status: "handoff-active"; readonly task: AgentTask; readonly runId: string }
  /** The owning agent has no supported executable task; nothing was recorded. */
  | { readonly status: "handoff-unsupported"; readonly task: AgentTask }
  /** The run path refused; the request is in the history, no run exists. */
  | { readonly status: "run-refused"; readonly task: AgentTask; readonly reason: string }
  /** The owner's review reads one record and none was chosen; nothing was recorded. */
  | { readonly status: "record-required"; readonly task: AgentTask; readonly kind: HandoffRecordKind }
  /** A record was sent for an owner whose review takes none, or of the other kind; nothing was recorded. */
  | { readonly status: "record-not-accepted"; readonly task: AgentTask }
  /** The record is not one of the project's own-site crawls or recorded competitor domains; nothing was recorded. */
  | { readonly status: "record-invalid"; readonly task: AgentTask }
  | { readonly status: "unavailable" };

/** One of the project's own-site crawls, as the handoff confirmation lists it. */
export type HandoffCrawlChoice = {
  readonly id: string;
  readonly status: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly pagesFetched: number;
};

/** What the operator may choose for a task's handoff, read from the same records the check uses. */
export type HandoffChoicesResult =
  | { readonly status: "none"; readonly task: AgentTask }
  | { readonly status: "crawl"; readonly task: AgentTask; readonly crawls: readonly HandoffCrawlChoice[] }
  | { readonly status: "competitor"; readonly task: AgentTask; readonly domains: readonly string[] }
  | { readonly status: "task-not-found" }
  | { readonly status: "unavailable" };

/**
 * The records a handoff may name, read by project id (checkpoint 2.3). The
 * operator chooses; this only lists and checks. A crawl is choosable when it
 * is the project's and of the project's own site (never a competitor's); a
 * competitor domain when the project recorded it at intake.
 */
export type HandoffRecordReader = {
  listOwnCrawls(projectId: string): Promise<readonly HandoffCrawlChoice[]>;
  isOwnCrawl(projectId: string, crawlId: string): Promise<boolean>;
  /** The recorded competitor hosts, canonical, never the project's own site. */
  recordedCompetitors(projectId: string): Promise<readonly string[]>;
};

export type HandoffTaskInput = HandoffRequestInput & { readonly record?: HandoffRecord | null };

/**
 * What the outcome read needs from the run path: the existing read of one
 * run by id. Read-only: nothing here queues, retries or executes a run.
 */
export type TaskRunReader = {
  getRun(runId: string): Promise<{ readonly ok: true; readonly run: AgentRun } | { readonly ok: false; readonly reason: string }>;
};

/** What the handoff needs from the run path: the existing create, with provenance. */
export type HandoffRunCreator = {
  createRun(
    operatorId: string,
    request: { readonly projectId: string; readonly agentId: string; readonly taskType: string; readonly input: Record<string, unknown> },
    options: { readonly sourceTaskId: string },
  ): Promise<{ readonly ok: true; readonly run: AgentRun; readonly duplicate: boolean } | { readonly ok: false; readonly reason: string }>;
};

export type AgentTaskService = {
  /** The project's tasks, newest first, at most TASK_READ_LIMIT. Never another project's. */
  listTasks(filter: ListAgentTasksFilter): Promise<ListAgentTasksResult>;
  /** Records one task through the database function. Dispatches nothing. */
  createTask(input: CreateAgentTaskInput): Promise<CreateAgentTaskResult>;
  /** One task of one project with its history, oldest first. */
  readTask(projectId: string, taskId: string): Promise<ReadAgentTaskResult>;
  /** One transition along the fixed map. Tells no agent anything. */
  changeStatus(input: ChangeTaskStatusInput): Promise<ChangeTaskStatusResult>;
  /** One owner change to a registry agent. Queues nothing. */
  changeOwner(input: ChangeTaskOwnerInput): Promise<ChangeTaskOwnerResult>;
  /**
   * Records the request, creates at most one queued run for the owning agent, links it. Executes nothing.
   * A record-reading owner's record is checked against the project first; a refusal writes nothing.
   */
  handoff(input: HandoffTaskInput): Promise<HandoffTaskResult>;
  /** What the operator may choose for this task's handoff. Reads only. */
  handoffChoices(projectId: string, taskId: string): Promise<HandoffChoicesResult>;
  /**
   * What became of the task's newest handoff, computed now from the linked
   * run (checkpoint 2.2). Writes nothing and never throws: a run that cannot
   * be read, or is not provably this task's, answers `unavailable`.
   */
  readOutcome(task: AgentTask, events: readonly AgentTaskEvent[]): Promise<TaskRunOutcome>;
};

function refuseRecord(status: "record-not-accepted" | "record-invalid", task: AgentTask): HandoffTaskResult {
  // Ids and the refusal name only: never the crawl id or domain the operator sent.
  logEvent("warn", "agent_tasks.handoff", { projectId: task.projectId, runId: task.id, agentId: task.owningAgent, outcome: status });
  return { status, task };
}

export function createAgentTaskService(
  store: AgentTaskStore,
  runs: HandoffRunCreator | null = null,
  runReader: TaskRunReader | null = null,
  records: HandoffRecordReader | null = null,
): AgentTaskService {
  /** The operator's record, canonical, when it is one the project holds of the kind the mapping reads; otherwise null. */
  async function projectRecord(projectId: string, kind: HandoffRecordKind, record: HandoffRecord): Promise<HandoffRecord | null> {
    if (records === null) return null;
    if (kind === "crawl") return "crawlId" in record && (await records.isOwnCrawl(projectId, record.crawlId)) ? record : null;
    if (!("competitorDomain" in record)) return null;
    const host = canonicalCompetitorHost(record.competitorDomain);
    return host !== null && (await records.recordedCompetitors(projectId)).includes(host) ? { competitorDomain: host } : null;
  }

  return {
    async listTasks(filter) {
      if (!store.storesTasks) return { status: "unavailable" };
      const requested = filter.limit ?? TASK_READ_DEFAULT_LIMIT;
      const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, TASK_READ_LIMIT) : TASK_READ_DEFAULT_LIMIT;
      const tasks = await store.listForProject({ ...filter, limit });
      // Belt and braces: the store filters by project; a row that is not the
      // project's is dropped rather than shown, and logged as a defect.
      const own = tasks.filter((task) => task.projectId === filter.projectId);
      if (own.length !== tasks.length) {
        logEvent("error", "agent_tasks.foreign_row_dropped", { projectId: filter.projectId, count: tasks.length - own.length });
      }
      return { status: "listed", tasks: own };
    },

    async createTask(input) {
      if (!store.storesTasks) return { status: "unavailable" };
      const outcome = await store.create(input);
      // Ids, names and outcomes only: never the title, which is an operator's own text.
      logEvent(outcome.status === "created" ? "info" : "warn", "agent_tasks.create", {
        projectId: input.projectId,
        reason: input.sourceKind,
        agentId: input.owningAgent,
        outcome: outcome.status,
        runId: outcome.status === "created" ? outcome.task.id : null,
      });
      return outcome;
    },

    async readTask(projectId, taskId) {
      if (!store.storesTasks) return { status: "unavailable" };
      const task = await store.getForProject(projectId, taskId);
      if (task === null || task.projectId !== projectId) return { status: "task-not-found" };
      const events = (await store.listEvents(projectId, taskId)).filter((event) => event.taskId === taskId && event.projectId === projectId);
      return { status: "found", task, events };
    },

    async changeStatus(input) {
      if (!store.storesTasks) return { status: "unavailable" };
      const outcome = await store.setStatus(input);
      logEvent(outcome.status === "transitioned" ? "info" : "warn", "agent_tasks.status", {
        projectId: input.projectId,
        runId: input.taskId,
        reason: input.status,
        outcome: outcome.status,
      });
      return outcome;
    },

    async changeOwner(input) {
      if (!store.storesTasks) return { status: "unavailable" };
      const outcome = await store.setOwner(input);
      logEvent(outcome.status === "owner-changed" ? "info" : "warn", "agent_tasks.owner", {
        projectId: input.projectId,
        runId: input.taskId,
        agentId: input.owningAgent,
        outcome: outcome.status,
      });
      return outcome;
    },

    async handoff(input) {
      if (!store.storesTasks || runs === null) return { status: "unavailable" };

      // The mapping is decided before anything is written: an unsupported
      // owner records no request.
      const current = await store.getForProject(input.projectId, input.taskId);
      if (current === null) return { status: "task-not-found" };
      const mapping = handoffFor(current.owningAgent);
      if (mapping === null) {
        logEvent("warn", "agent_tasks.handoff", { projectId: input.projectId, runId: input.taskId, agentId: current.owningAgent, outcome: "handoff-unsupported" });
        return { status: "handoff-unsupported", task: current };
      }

      // The operator's record, checked before anything is written: the owner's
      // review must read one of that kind, and it must be the project's.
      let record = input.record ?? null;
      if (mapping.record === undefined && record !== null) return refuseRecord("record-not-accepted", current);
      if (mapping.record !== undefined) {
        if (record === null) {
          logEvent("warn", "agent_tasks.handoff", { projectId: input.projectId, runId: input.taskId, agentId: current.owningAgent, outcome: "record-required" });
          return { status: "record-required", task: current, kind: mapping.record };
        }
        if (handoffRecordKind(record) !== mapping.record) return refuseRecord("record-not-accepted", current);
        if (records === null) return { status: "unavailable" };
        record = await projectRecord(current.projectId, mapping.record, record);
        if (record === null) return refuseRecord("record-invalid", current);
      }

      // Step 1: the request, under the task's lock; refused while a linked run is active.
      const requested = await store.handoffRequest(input);
      if (requested.status !== "requested") {
        logEvent("warn", "agent_tasks.handoff", { projectId: input.projectId, runId: input.taskId, agentId: current.owningAgent, outcome: requested.status });
        return requested;
      }
      const task = requested.task;

      // Step 2: one run through the run path, with the task as provenance.
      // The run path's own duplicate rule (same project, agent, task type and
      // input, including sourceTaskId) hands back an identical active run
      // rather than inserting a second.
      const created = await runs.createRun(
        input.operatorId,
        { projectId: task.projectId, agentId: task.owningAgent, taskType: mapping.taskType, input: handoffInput(mapping, record) },
        { sourceTaskId: task.id },
      );
      if (!created.ok) {
        logEvent("warn", "agent_tasks.handoff", { projectId: input.projectId, runId: input.taskId, agentId: task.owningAgent, outcome: "run-refused", reason: created.reason });
        return { status: "run-refused", task, reason: created.reason };
      }

      // Step 3: the link. A run the path handed back as a duplicate may
      // already be linked; that is recorded once and not an error.
      const linked = await store.handoffLink({ projectId: task.projectId, taskId: task.id, runId: created.run.id, operatorId: input.operatorId });
      logEvent(linked.status === "linked" || linked.status === "already-linked" ? "info" : "error", "agent_tasks.handoff", {
        projectId: input.projectId,
        runId: created.run.id,
        agentId: task.owningAgent,
        reason: mapping.taskType,
        outcome: created.duplicate ? `${linked.status}:duplicate-run` : linked.status,
      });
      if (linked.status === "task-not-found" || linked.status === "run-not-found") {
        // The run exists and is the operator's; the link is what failed. Say so rather than hide the run.
        throw new Error(`Task handoff: the run ${created.run.id} was created but could not be linked (${linked.status}).`);
      }
      return { status: "handed-off", task: linked.task, run: created.run, duplicate: created.duplicate };
    },

    async handoffChoices(projectId, taskId) {
      if (!store.storesTasks) return { status: "unavailable" };
      const task = await store.getForProject(projectId, taskId);
      if (task === null || task.projectId !== projectId) return { status: "task-not-found" };
      const kind = handoffFor(task.owningAgent)?.record;
      if (kind === undefined) return { status: "none", task };
      if (records === null) return { status: "unavailable" };
      if (kind === "crawl") return { status: "crawl", task, crawls: await records.listOwnCrawls(task.projectId) };
      return { status: "competitor", task, domains: await records.recordedCompetitors(task.projectId) };
    },

    async readOutcome(task, events) {
      const runId = latestLinkedRunId(events.filter((event) => event.taskId === task.id && event.projectId === task.projectId));
      if (runId === null) return { status: "none" };
      const unavailable = (reason: string): TaskRunOutcome => {
        // Ids and a reason name only: never the run's summary or input.
        logEvent("warn", "agent_tasks.outcome", { projectId: task.projectId, runId, reason, outcome: "unavailable" });
        return { status: "unavailable", runId };
      };
      if (runReader === null) return unavailable("read-failed");
      let read: Awaited<ReturnType<TaskRunReader["getRun"]>>;
      try {
        read = await runReader.getRun(runId);
      } catch {
        return unavailable("read-failed");
      }
      if (!read.ok) return unavailable(read.reason === "not-found" ? "run-not-found" : "read-failed");
      const mismatch = outcomeMismatch(task, runId, read.run);
      if (mismatch !== null) return unavailable(mismatch);
      return presentTaskRunOutcome(read.run);
    },
  };
}
