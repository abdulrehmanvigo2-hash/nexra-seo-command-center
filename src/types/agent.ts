/**
 * Shapes for the AI Agents module (CLAUDE.md §14, Phase 4).
 *
 * The twelve agents already existed before this phase: the Command Center
 * renders their operating state, and every project carries the subset assigned
 * to it. This file does not introduce a second definition of an agent — it
 * describes the registry those two modules now read from, and the operational
 * records built on top of it.
 *
 * Three aliases below point at types other modules already own rather than
 * restating them:
 *  - `AgentStatus` is the dashboard's `AgentOpsStatus`, so a status means the
 *    same six things on the dashboard, on a project, and here.
 *  - `AgentOperation` is the per-project run record the dashboard builds.
 *  - `AgentActivity` is the dashboard's `ActivityEvent`, so the agents feed
 *    renders through the same component the Command Center uses.
 *
 * Everything typed here is served by `src/lib/mock/agents` — fixtures, not
 * live data. Nothing in this milestone executes an agent (CLAUDE.md §4).
 */
import type { IconName } from "@/components/icons";
import type { NavHref } from "@/config/navigation";
import type {
  ActivityEvent,
  AgentOperation,
  AgentOpsStatus,
  MetricHealth,
  MetricTrend,
  Priority,
} from "@/types/dashboard";
import type { AgentId } from "@/types/seo";
import type { ProjectStatus } from "@/types/project";

export type { AgentId, AgentOperation };

/** The six operational states, defined once for the whole product. */
export type AgentStatus = AgentOpsStatus;

/** An event in the agents feed — the same record the Command Center renders. */
export type AgentActivity = ActivityEvent;

// ---------------------------------------------------------------------------
// Registry: who each agent is
// ---------------------------------------------------------------------------

/**
 * Where an agent sits in the team.
 *
 * Used to group the roster and to filter it, so a user can ask for "the
 * content agents" without knowing the pipeline order by heart.
 */
export type AgentCategory =
  | "leadership"
  | "intelligence"
  | "content"
  | "optimisation"
  | "growth";

/** One capability an agent is staffed for. Free text, matched by search. */
export type AgentSpecialty = string;

/**
 * The operating brief shown on an agent's workspace.
 *
 * A plain description of what the agent is for, written for the person running
 * the account: what it takes in, what it produces, what it checks before
 * handing work on, and when it stops and asks. It is not a system prompt and
 * carries nothing private (Phase 4 scope §18).
 */
export type AgentBrief = {
  readonly mission: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly qualityChecks: readonly string[];
  readonly escalation: readonly string[];
};

/**
 * The canonical record of an agent.
 *
 * This is the single definition of the twelve agents in the product. The
 * Command Center's operations board and every project's team are derived from
 * these records, so an agent's name, discipline, and place in the pipeline are
 * written in exactly one file.
 */
export type Agent = {
  readonly id: AgentId;
  readonly name: string;
  /** Short discipline, e.g. "Strategy and orchestration". */
  readonly title: string;
  /** One line: what this agent is for. */
  readonly description: string;
  /** The single sentence of accountability — what it owns. */
  readonly responsibility: string;
  readonly responsibilities: readonly string[];
  readonly specialties: readonly AgentSpecialty[];
  readonly category: AgentCategory;
  /** Position in the orchestration loop (CLAUDE.md §13), 1-12. */
  readonly stage: number;
  readonly icon: IconName;
  /** Two-letter monogram, authored rather than derived from the name. */
  readonly initials: string;
  /** The module this agent's work surfaces in — always a real route. */
  readonly module: NavHref;
  /** Agents whose output this one consumes. */
  readonly upstream: readonly AgentId[];
  /** Agents this one hands finished work to. */
  readonly downstream: readonly AgentId[];
  /** What this agent produces, e.g. "briefs". */
  readonly outputLabel: string;
  /** Artifacts produced in a 30-day window at portfolio scale. */
  readonly outputBase: number;
  /** Kinds of deliverable this agent files. */
  readonly outputKinds: readonly string[];
  /** Three candidate tasks; a project picks one deterministically. */
  readonly tasks: readonly [string, string, string];
  readonly brief: AgentBrief;
  /** Tasks this agent will hold at once before work queues behind it. */
  readonly capacity: number;
  readonly defaultPriority: Priority;
  /** Whether a person signs the agent's output off before it moves on. */
  readonly reviewRequired: boolean;
  /** Seeds this agent's deterministic figures. */
  readonly seed: number;
};

// ---------------------------------------------------------------------------
// Workload
// ---------------------------------------------------------------------------

export type WorkloadBand = "low" | "normal" | "high" | "overloaded";

/** How much an agent is carrying, and whether it can take more. */
export type AgentWorkload = {
  readonly band: WorkloadBand;
  /** Share of capacity in use, 0-100. Can exceed 100 when overloaded. */
  readonly percent: number;
  readonly activeTasks: number;
  readonly queuedTasks: number;
  readonly reviewQueue: number;
  /** Tasks the agent will hold at once. */
  readonly capacity: number;
  /** One line on what the agent can take next. */
  readonly availability: string;
};

// ---------------------------------------------------------------------------
// Roster rows
// ---------------------------------------------------------------------------

/** One agent as it appears in the grid and the table. */
export type AgentListItem = {
  readonly id: AgentId;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly category: AgentCategory;
  readonly stage: number;
  readonly icon: IconName;
  readonly initials: string;
  readonly specialties: readonly AgentSpecialty[];
  readonly href: string;
  readonly status: AgentStatus;
  /** What the agent is on right now. */
  readonly currentFocus: string;
  /** The project that work belongs to, or null when nothing is in flight. */
  readonly currentProject: { readonly id: string; readonly name: string } | null;
  /** Completion of the current task, 0-100. */
  readonly progress: number;
  /** Output quality index, 0-100. */
  readonly quality: number;
  readonly qualityHealth: MetricHealth;
  readonly workload: AgentWorkload;
  /** Ids of the projects this agent is staffed on. */
  readonly projects: readonly string[];
  /** Artifacts filed in the last 30 days. */
  readonly completedOutputs: number;
  readonly outputLabel: string;
  /** ISO 8601 timestamp of the last recorded action. */
  readonly lastActivity: string;
  /** Open blockers and reviews sitting against this agent. */
  readonly blockers: number;
  /** True where a person has to decide something before work continues. */
  readonly attention: boolean;
  /** Daily output volume behind the row's mini trend line. */
  readonly spark: readonly number[];
};

/** One summary number above the agent roster. Renders as a `MetricTile`. */
export type AgentMetric = {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  readonly detail: string;
  readonly icon: IconName;
  readonly trend?: MetricTrend;
  readonly health?: MetricHealth;
};

/** The health of the AI team as a whole (Phase 4 scope §5). */
export type TeamHealth = {
  /** Composite 0-100 index across capacity, throughput, and quality. */
  readonly score: number;
  readonly health: MetricHealth;
  readonly summary: string;
  readonly metrics: readonly AgentMetric[];
  readonly totalAgents: number;
  readonly workingAgents: number;
  readonly blockedAgents: number;
  readonly reviewAgents: number;
  readonly activeTasks: number;
  readonly completedOutputs: number;
  readonly averageQuality: number;
  /** ISO 8601 timestamp of the last orchestration pass. */
  readonly lastOrchestration: string;
};

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

/** An agent's record over the selected window (Phase 4 scope §9). */
export type AgentPerformance = {
  readonly tasksCompleted: number;
  readonly tasksInProgress: number;
  /** Mean hours from a task starting to it being accepted. */
  readonly averageCompletionHours: number;
  /** Output quality index, 0-100. */
  readonly quality: number;
  /** Share of outputs accepted at first review, 0-100. */
  readonly reviewPassRate: number;
  /** Share of outputs sent back for revision, 0-100. */
  readonly reworkRate: number;
  readonly outputVolume: number;
  readonly projectsSupported: number;
  readonly trend: {
    readonly quality: MetricTrend;
    readonly throughput: MetricTrend;
    readonly completionTime: MetricTrend;
  };
  /** Output volume across the window, oldest first. */
  readonly series: readonly number[];
  /** Bucket labels for the series, same length. */
  readonly labels: readonly string[];
};

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

/** A project an agent is staffed on (Phase 4 scope §10). */
export type AgentAssignment = {
  readonly projectId: string;
  readonly projectName: string;
  readonly client: string;
  readonly initials: string;
  /** Route of the project workspace. */
  readonly href: string;
  readonly projectStatus: ProjectStatus;
  /** What this agent is accountable for on this project. */
  readonly responsibility: string;
  readonly currentTask: string;
  readonly progress: number;
  readonly agentStatus: AgentStatus;
  /** The project's SEO health index, 0-100. */
  readonly health: number;
  readonly healthState: MetricHealth;
  readonly openIssues: number;
  readonly attention: boolean;
};

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type AgentTaskStatus =
  | "queued"
  | "working"
  | "review"
  | "blocked"
  | "completed";

/** How the due date reads against the reference instant. */
export type AgentTaskDue =
  | "overdue"
  | "due-today"
  | "this-week"
  | "scheduled"
  | "delivered";

/** One unit of work on the agent task board (Phase 4 scope §7). */
export type AgentTask = {
  readonly id: string;
  readonly title: string;
  readonly agent: AgentId;
  readonly projectId: string;
  readonly projectName: string;
  readonly priority: Priority;
  readonly status: AgentTaskStatus;
  /** Completion percentage, 0-100. */
  readonly progress: number;
  /** ISO 8601 timestamp, or null while the task is still queued. */
  readonly startedAt: string | null;
  /** ISO 8601 date the task is due. */
  readonly due: string;
  readonly dueState: AgentTaskDue;
  /** The agent this task is waiting on, where it is waiting on one. */
  readonly dependency: AgentId | null;
  /** Who receives the work when this task is accepted. */
  readonly nextHandoff: AgentId | null;
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type AgentOutputStatus =
  | "draft"
  | "in-review"
  | "approved"
  | "delivered";

/** A deliverable an agent has filed (Phase 4 scope §11). */
export type AgentOutput = {
  readonly id: string;
  readonly title: string;
  readonly agent: AgentId;
  readonly projectId: string;
  readonly projectName: string;
  /** Kind of deliverable, e.g. "Content brief". */
  readonly type: string;
  readonly status: AgentOutputStatus;
  /** ISO 8601 timestamp. */
  readonly createdAt: string;
  /** Quality index for this artifact, 0-100. */
  readonly quality: number;
  /** The module this deliverable belongs to — always a real route. */
  readonly module: NavHref;
};

// ---------------------------------------------------------------------------
// Handoffs
// ---------------------------------------------------------------------------

export type HandoffStatus =
  | "ready"
  | "in-transfer"
  | "accepted"
  | "needs-revision"
  | "blocked";

/** Work moving from one agent to the next (Phase 4 scope §12). */
export type AgentHandoff = {
  readonly id: string;
  readonly from: AgentId;
  readonly to: AgentId;
  readonly projectId: string;
  readonly projectName: string;
  /** The artifact being handed over. */
  readonly workItem: string;
  readonly status: HandoffStatus;
  /** ISO 8601 timestamp of the last movement. */
  readonly at: string;
  /** Where the receiving agent has got to with it. */
  readonly reviewState: string;
};

// ---------------------------------------------------------------------------
// Blockers and the review queue
// ---------------------------------------------------------------------------

export type BlockerKind =
  | "blocked-task"
  | "failed-handoff"
  | "review-waiting"
  | "dependency"
  | "overdue";

/** Something stopping work, ranked by how much it is costing (§13). */
export type AgentBlocker = {
  readonly id: string;
  readonly kind: BlockerKind;
  readonly agent: AgentId;
  readonly projectId: string;
  readonly projectName: string;
  readonly issue: string;
  readonly severity: Priority;
  /** ISO 8601 timestamp of when this started. */
  readonly since: string;
  /** What to do about it. */
  readonly recommendedAction: string;
  /** Wording for the control that action maps to. */
  readonly actionLabel: string;
};

/**
 * Frontend-only resolution states for the queue.
 *
 * Acting on a blocker records a state in this session and nothing else — no
 * agent is retried, reassigned, or dispatched (CLAUDE.md §4).
 */
export type BlockerResolution =
  | "open"
  | "reviewed"
  | "retrying"
  | "reassigned"
  | "resolved";

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type WorkflowStageState =
  | "complete"
  | "active"
  | "review"
  | "blocked"
  | "pending";

export type WorkflowStage = {
  readonly agent: AgentId;
  readonly name: string;
  readonly initials: string;
  readonly stage: number;
  /** False where this project does not staff the agent at all. */
  readonly staffed: boolean;
  readonly state: WorkflowStageState;
  /** What happened, or is happening, at this stage. */
  readonly note: string;
  readonly progress: number;
  /** ISO 8601 timestamp of the last movement at this stage. */
  readonly at: string;
  /** True where the handoff into the next stage is stuck. */
  readonly handoffBlocked: boolean;
};

/** One project's pass through the twelve-stage loop (Phase 4 scope §6). */
export type AgentWorkflow = {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly client: string;
  /** Route of the project workspace. */
  readonly href: string;
  /** What this cycle is for. */
  readonly objective: string;
  readonly stages: readonly WorkflowStage[];
  /** Index into `stages` of the stage currently carrying the work. */
  readonly activeIndex: number;
  readonly completedStages: number;
  /** Share of the loop finished, 0-100. */
  readonly progress: number;
  /** ISO 8601 timestamp of the last movement anywhere in the loop. */
  readonly updatedAt: string;
};

// ---------------------------------------------------------------------------
// Collaboration
// ---------------------------------------------------------------------------

/** One row of the collaboration matrix (Phase 4 scope §15). */
export type AgentCollaboration = {
  readonly agent: AgentId;
  readonly name: string;
  readonly initials: string;
  readonly stage: number;
  readonly upstream: readonly AgentId[];
  readonly downstream: readonly AgentId[];
  /** Agents sharing the most projects with this one, most shared first. */
  readonly collaborators: readonly {
    readonly agent: AgentId;
    /** Projects both agents are staffed on. */
    readonly sharedProjects: number;
  }[];
  /** Workflows this agent is currently carrying work in. */
  readonly activeWorkflows: number;
  readonly openHandoffs: number;
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * The fields an agent's settings panel can edit.
 *
 * All operational and non-sensitive. There is deliberately nothing here about
 * model providers, credentials, or autonomous execution (Phase 4 scope §17).
 */
export type AgentConfiguration = {
  readonly displayName: string;
  readonly status: AgentStatus;
  readonly defaultPriority: Priority;
  /** Tasks the agent will hold at once, 1-12. */
  readonly maxConcurrent: number;
  /** Whether new projects staff this agent automatically. */
  readonly autoAssign: boolean;
  /** Whether a person signs output off before it moves downstream. */
  readonly reviewRequired: boolean;
};

// ---------------------------------------------------------------------------
// The assembled workspace
// ---------------------------------------------------------------------------

/** Everything one agent's workspace renders. */
export type AgentDetail = {
  readonly agent: Agent;
  readonly listItem: AgentListItem;
  /** ISO 8601 instant the fixtures represent. */
  readonly generatedAt: string;
  readonly rangeCaption: string;
  readonly performance: AgentPerformance;
  readonly assignments: readonly AgentAssignment[];
  readonly tasks: readonly AgentTask[];
  readonly outputs: readonly AgentOutput[];
  readonly activity: readonly AgentActivity[];
  readonly blockers: readonly AgentBlocker[];
  readonly incoming: readonly AgentHandoff[];
  readonly outgoing: readonly AgentHandoff[];
  readonly upstream: readonly Agent[];
  readonly downstream: readonly Agent[];
  readonly collaboration: AgentCollaboration;
  readonly configuration: AgentConfiguration;
};
