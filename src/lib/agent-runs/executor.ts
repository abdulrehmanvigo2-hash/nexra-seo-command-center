import type { AgentId } from "@/types/agent";
import type { AgentExecutorId, AgentTaskType, JsonObject } from "@/types/agent-run";

/**
 * What carries a task out.
 *
 * The service hands an executor one attempt of one run and takes back a
 * summary and optional metadata, which it screens before anything is stored.
 * An executor never sees the run record, the operator, or a credential from a
 * run: anything it needs to reach a real system it reads from the server
 * environment itself.
 *
 * A thrown error or a timeout fails the attempt with a fixed message; the
 * error's own text is never stored or returned.
 */

export type ExecutionTask = {
  readonly runId: string;
  /** 1 for the first attempt. */
  readonly attempt: number;
  readonly agent: { readonly id: AgentId; readonly name: string };
  readonly project: { readonly id: string; readonly name: string; readonly domain: string };
  readonly taskType: AgentTaskType;
  /** Already validated against the task type. */
  readonly input: JsonObject;
};

export type ExecutionOutput = {
  readonly summary: string;
  readonly metadata?: JsonObject;
};

export type AgentExecutor = {
  readonly id: AgentExecutorId;
  /** Should stop work when `signal` aborts; the service stops waiting either way. */
  execute(task: ExecutionTask, signal: AbortSignal): Promise<ExecutionOutput>;
};
