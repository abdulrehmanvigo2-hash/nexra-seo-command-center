import type { AgentTask, CreateAgentTaskInput, CreateAgentTaskOutcome, ListAgentTasksFilter } from "@/lib/agent-tasks/contract";

/**
 * What the task service needs from wherever tasks are kept. Storage-agnostic,
 * like the triage store: the one write is the database's own
 * `nexra_agent_task_create`, which re-checks the project, the owning agent,
 * the source's provenance, the title and the priority before anything is
 * written; the one read is bounded and scoped to one project.
 */
export type AgentTaskStore = {
  /** Whether this store keeps tasks. The fixture data source does not. */
  readonly storesTasks: boolean;
  /** The project's tasks, newest first (created_at, then id), at most the bound, optionally one status. Never another project's. */
  listForProject(filter: ListAgentTasksFilter): Promise<readonly AgentTask[]>;
  /** One task, through the one database function. */
  create(input: CreateAgentTaskInput): Promise<CreateAgentTaskOutcome>;
};

/** The store used when tasks are not persisted anywhere. It refuses rather than pretends. */
export const unavailableAgentTaskStore: AgentTaskStore = {
  storesTasks: false,
  async listForProject() {
    return [];
  },
  async create() {
    return { status: "project-not-found" };
  },
};
