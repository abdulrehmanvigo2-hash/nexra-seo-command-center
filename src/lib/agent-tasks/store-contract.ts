import type {
  AgentTask,
  AgentTaskEvent,
  ChangeTaskOwnerInput,
  ChangeTaskOwnerOutcome,
  ChangeTaskStatusInput,
  ChangeTaskStatusOutcome,
  CreateAgentTaskInput,
  CreateAgentTaskOutcome,
  HandoffLinkInput,
  HandoffLinkOutcome,
  HandoffRequestInput,
  HandoffRequestOutcome,
  ListAgentTasksFilter,
} from "@/lib/agent-tasks/contract";

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
  /** One task of one project, or null. Never another project's. */
  getForProject(projectId: string, taskId: string): Promise<AgentTask | null>;
  /** The task's history, oldest first by `seq`, bounded. Never another project's. */
  listEvents(projectId: string, taskId: string): Promise<readonly AgentTaskEvent[]>;
  /** One status transition, through `nexra_agent_task_set_status`. */
  setStatus(input: ChangeTaskStatusInput): Promise<ChangeTaskStatusOutcome>;
  /** One owner change, through `nexra_agent_task_set_owner`. */
  setOwner(input: ChangeTaskOwnerInput): Promise<ChangeTaskOwnerOutcome>;
  /** Records the operator's handoff request, through `nexra_agent_task_handoff_request`. Creates no run. */
  handoffRequest(input: HandoffRequestInput): Promise<HandoffRequestOutcome>;
  /** Links the run the run path created, through `nexra_agent_task_handoff_link`. */
  handoffLink(input: HandoffLinkInput): Promise<HandoffLinkOutcome>;
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
  async getForProject() {
    return null;
  },
  async listEvents() {
    return [];
  },
  async setStatus() {
    return { status: "task-not-found" };
  },
  async setOwner() {
    return { status: "task-not-found" };
  },
  async handoffRequest() {
    return { status: "task-not-found" };
  },
  async handoffLink() {
    return { status: "task-not-found" };
  },
};
