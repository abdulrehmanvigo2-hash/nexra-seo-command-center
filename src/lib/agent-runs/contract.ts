import type {
  AgentExecutorId,
  AgentRun,
  AgentRunError,
  AgentRunSource,
  AgentRunStatus,
  AgentTaskType,
  JsonObject,
} from "@/types/agent-run";
import type { AgentId } from "@/types/agent";

/**
 * What the agent runtime needs from wherever runs are kept.
 *
 * Storage-agnostic, like the Projects repository contract: the service holds
 * the rules, a store holds rows. Every state change goes through `transition`,
 * which only applies when the run is still in the state the caller last saw,
 * so two requests racing to start or cancel the same run cannot both win.
 */

export type NewAgentRun = {
  readonly projectId: string;
  readonly agentId: AgentId;
  readonly taskType: AgentTaskType;
  readonly input: JsonObject;
  readonly inputHash: string;
  readonly source: AgentRunSource;
  readonly maxAttempts: number;
  readonly createdBy: string;
};

export type InsertRunOutcome =
  | { readonly status: "inserted"; readonly run: AgentRun }
  /** An identical run is already queued or running. */
  | { readonly status: "duplicate" }
  /** The project no longer exists. */
  | { readonly status: "missing-project" };

/** The fields a state change may set. Absent fields are left as they are. */
export type RunPatch = {
  readonly status: AgentRunStatus;
  readonly executor?: AgentExecutorId;
  readonly attemptCount?: number;
  readonly startedAt?: string | null;
  readonly finishedAt?: string | null;
  readonly resultSummary?: string | null;
  readonly resultMetadata?: JsonObject | null;
  readonly error?: AgentRunError | null;
  readonly cancelledBy?: string | null;
};

export type TransitionOutcome =
  | { readonly status: "updated"; readonly run: AgentRun }
  /** The run was not in the expected state, or does not exist. Nothing changed. */
  | { readonly status: "stale" }
  /** Re-queuing would duplicate a run that is already queued or running. */
  | { readonly status: "duplicate" };

export type AgentRunStore = {
  /** False where runs cannot be kept; the service then refuses every call. */
  readonly storesRuns: boolean;
  insert(run: NewAgentRun): Promise<InsertRunOutcome>;
  getById(id: string): Promise<AgentRun | null>;
  /** The queued or running run with this exact request, if there is one. */
  findActiveDuplicate(
    run: Pick<NewAgentRun, "projectId" | "agentId" | "taskType" | "inputHash">,
  ): Promise<AgentRun | null>;
  /** Newest first. */
  listByProject(projectId: string, limit: number): Promise<readonly AgentRun[]>;
  /** Newest first. */
  listByAgent(agentId: AgentId, limit: number): Promise<readonly AgentRun[]>;
  transition(id: string, from: AgentRunStatus, patch: RunPatch): Promise<TransitionOutcome>;
};

/** For a deployment with no database: the runtime is present but unavailable. */
export const unavailableAgentRunStore: AgentRunStore = {
  storesRuns: false,
  insert: () => Promise.reject(new Error("Agent runs are not stored in this deployment.")),
  getById: () => Promise.reject(new Error("Agent runs are not stored in this deployment.")),
  findActiveDuplicate: () => Promise.reject(new Error("Agent runs are not stored in this deployment.")),
  listByProject: () => Promise.reject(new Error("Agent runs are not stored in this deployment.")),
  listByAgent: () => Promise.reject(new Error("Agent runs are not stored in this deployment.")),
  transition: () => Promise.reject(new Error("Agent runs are not stored in this deployment.")),
};
