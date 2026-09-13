import type { IconName } from "@/components/icons";
import type { BadgeTone, Status } from "@/components/ui/badge";
import type { MeterTone } from "@/components/ui/meter";
import type {
  AgentCategory,
  AgentOutputStatus,
  AgentStatus,
  AgentTaskDue,
  AgentTaskStatus,
  BlockerKind,
  BlockerResolution,
  HandoffStatus,
  WorkflowStageState,
  WorkloadBand,
} from "@/types/agent";

/**
 * Presentation for every operational vocabulary the Agents module uses.
 *
 * Each state maps onto an existing lifecycle `Status`, `BadgeTone`, or
 * `MeterTone` rather than introducing a second colour system, and every entry
 * carries a label — colour never carries the meaning on its own.
 *
 * `AGENT_STATUS_META` lives here rather than in the dashboard fixture layer
 * because three modules read it: the Command Center's operations board, a
 * project's team panel, and this module's roster. It is re-exported from
 * `@/lib/mock/dashboard` so the components that already import it from there
 * keep working unchanged.
 */

// ---------------------------------------------------------------------------
// Operational status
// ---------------------------------------------------------------------------

export const AGENT_STATUS_META: Record<
  AgentStatus,
  {
    readonly label: string;
    readonly status: Status;
    /** What the state means, shown as a control title. */
    readonly description: string;
  }
> = {
  active: {
    label: "Active",
    status: "active",
    description: "Engaged on a project and moving work forward.",
  },
  working: {
    label: "Working",
    status: "running",
    description: "Executing a task right now.",
  },
  waiting: {
    label: "Waiting",
    status: "queued",
    description: "Idle until an upstream agent delivers.",
  },
  completed: {
    label: "Completed",
    status: "complete",
    description: "Finished its current assignment.",
  },
  "needs-review": {
    label: "In review",
    status: "review",
    description: "Output is waiting on a human decision.",
  },
  blocked: {
    label: "Blocked",
    status: "failed",
    description: "Stopped by a dependency or a failure.",
  },
};

/** Filter order for the status control above the roster. */
export const AGENT_STATUS_ORDER: readonly AgentStatus[] = [
  "working",
  "active",
  "waiting",
  "needs-review",
  "blocked",
  "completed",
];

/** States that mean somebody has to look at the agent. */
export const ATTENTION_STATUSES: readonly AgentStatus[] = [
  "needs-review",
  "blocked",
];

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

export const AGENT_CATEGORY_META: Record<
  AgentCategory,
  { readonly label: string; readonly icon: IconName; readonly description: string }
> = {
  leadership: {
    label: "Leadership",
    icon: "command-center",
    description: "Strategy, sequencing, and delivery.",
  },
  intelligence: {
    label: "Intelligence",
    icon: "search",
    description: "Market, competitor, and demand research.",
  },
  content: {
    label: "Content",
    icon: "content",
    description: "Plans, evidence, and drafting.",
  },
  optimisation: {
    label: "Optimisation",
    icon: "technical",
    description: "On-page and technical execution.",
  },
  growth: {
    label: "Growth",
    icon: "trend-up",
    description: "Visibility, authority, and measurement.",
  },
};

export const AGENT_CATEGORY_ORDER: readonly AgentCategory[] = [
  "leadership",
  "intelligence",
  "content",
  "optimisation",
  "growth",
];

// ---------------------------------------------------------------------------
// Workload
// ---------------------------------------------------------------------------

export const WORKLOAD_META: Record<
  WorkloadBand,
  {
    readonly label: string;
    readonly tone: BadgeTone;
    readonly meter: MeterTone;
    readonly description: string;
  }
> = {
  low: {
    label: "Low",
    tone: "neutral",
    meter: "neutral",
    description: "Well inside capacity and able to take more.",
  },
  normal: {
    label: "Normal",
    tone: "accent",
    meter: "accent",
    description: "Comfortably loaded.",
  },
  high: {
    label: "High",
    tone: "warning",
    meter: "warning",
    description: "Near capacity — new work will queue.",
  },
  overloaded: {
    label: "Overloaded",
    tone: "critical",
    meter: "critical",
    description: "Past capacity; work is queuing behind the current tasks.",
  },
};

export const WORKLOAD_ORDER: readonly WorkloadBand[] = [
  "low",
  "normal",
  "high",
  "overloaded",
];

/**
 * Band for a share of capacity in use.
 *
 * The thresholds are set where the roster actually separates: past capacity is
 * overloaded, two thirds or more is high, and anything under a third is an
 * agent with real headroom. Bands nobody ever falls into would make the
 * workload filter a control that does nothing.
 */
export function workloadBandOf(percent: number): WorkloadBand {
  if (percent >= 100) return "overloaded";
  if (percent >= 66) return "high";
  if (percent >= 36) return "normal";
  return "low";
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const AGENT_TASK_STATUS_META: Record<
  AgentTaskStatus,
  { readonly label: string; readonly status: Status; readonly meter: MeterTone }
> = {
  queued: { label: "Queued", status: "queued", meter: "neutral" },
  working: { label: "Working", status: "running", meter: "accent" },
  review: { label: "In review", status: "review", meter: "warning" },
  blocked: { label: "Blocked", status: "failed", meter: "critical" },
  completed: { label: "Completed", status: "complete", meter: "positive" },
};

export const AGENT_TASK_STATUS_ORDER: readonly AgentTaskStatus[] = [
  "queued",
  "working",
  "review",
  "blocked",
  "completed",
];

export const AGENT_TASK_DUE_META: Record<
  AgentTaskDue,
  { readonly label: string; readonly tone: BadgeTone }
> = {
  overdue: { label: "Overdue", tone: "critical" },
  "due-today": { label: "Due today", tone: "warning" },
  "this-week": { label: "This week", tone: "accent" },
  scheduled: { label: "Scheduled", tone: "neutral" },
  delivered: { label: "Delivered", tone: "positive" },
};

// ---------------------------------------------------------------------------
// Handoffs
// ---------------------------------------------------------------------------

export const HANDOFF_STATUS_META: Record<
  HandoffStatus,
  {
    readonly label: string;
    readonly tone: BadgeTone;
    readonly description: string;
  }
> = {
  ready: {
    label: "Ready",
    tone: "accent",
    description: "Finished upstream and waiting to be picked up.",
  },
  "in-transfer": {
    label: "In transfer",
    tone: "accent",
    description: "The receiving agent has started reading it in.",
  },
  accepted: {
    label: "Accepted",
    tone: "positive",
    description: "Taken on by the receiving agent.",
  },
  "needs-revision": {
    label: "Needs revision",
    tone: "warning",
    description: "Sent back to the originating agent.",
  },
  blocked: {
    label: "Blocked",
    tone: "critical",
    description: "Cannot move until something upstream is resolved.",
  },
};

export const HANDOFF_STATUS_ORDER: readonly HandoffStatus[] = [
  "ready",
  "in-transfer",
  "accepted",
  "needs-revision",
  "blocked",
];

/** The states a handoff can be moved to from the queue, in reading order. */
export const HANDOFF_STATUS_CYCLE: readonly HandoffStatus[] =
  HANDOFF_STATUS_ORDER;

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export const OUTPUT_STATUS_META: Record<
  AgentOutputStatus,
  { readonly label: string; readonly status: Status }
> = {
  draft: { label: "Draft", status: "draft" },
  "in-review": { label: "In review", status: "review" },
  approved: { label: "Approved", status: "active" },
  delivered: { label: "Delivered", status: "complete" },
};

// ---------------------------------------------------------------------------
// Blockers
// ---------------------------------------------------------------------------

export const BLOCKER_KIND_META: Record<
  BlockerKind,
  { readonly label: string; readonly icon: IconName; readonly tone: BadgeTone }
> = {
  "blocked-task": { label: "Blocked task", icon: "alert", tone: "critical" },
  "failed-handoff": { label: "Failed handoff", icon: "link-off", tone: "critical" },
  "review-waiting": { label: "Review waiting", icon: "inbox", tone: "warning" },
  dependency: { label: "Dependency", icon: "layers", tone: "warning" },
  overdue: { label: "Overdue", icon: "clock", tone: "warning" },
};

export const BLOCKER_KIND_ORDER: readonly BlockerKind[] = [
  "blocked-task",
  "failed-handoff",
  "review-waiting",
  "dependency",
  "overdue",
];

export const BLOCKER_RESOLUTION_META: Record<
  BlockerResolution,
  { readonly label: string; readonly tone: BadgeTone }
> = {
  open: { label: "Open", tone: "critical" },
  reviewed: { label: "Reviewed", tone: "accent" },
  retrying: { label: "Retrying", tone: "accent" },
  reassigned: { label: "Reassigned", tone: "accent" },
  resolved: { label: "Resolved", tone: "positive" },
};

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export const WORKFLOW_STATE_META: Record<
  WorkflowStageState,
  {
    readonly label: string;
    readonly tone: BadgeTone;
    /** Ring around the stage marker on the pipeline. */
    readonly ring: string;
    /** Fill for the stage marker. */
    readonly dot: string;
    readonly icon: IconName;
  }
> = {
  complete: {
    label: "Completed",
    tone: "positive",
    ring: "border-positive/40",
    dot: "bg-positive",
    icon: "check",
  },
  active: {
    label: "Active",
    tone: "accent",
    ring: "border-accent/50",
    dot: "bg-accent",
    icon: "bolt",
  },
  review: {
    label: "In review",
    tone: "warning",
    ring: "border-warning/45",
    dot: "bg-warning",
    icon: "inbox",
  },
  blocked: {
    label: "Blocked",
    tone: "critical",
    ring: "border-critical/45",
    dot: "bg-critical",
    icon: "alert",
  },
  pending: {
    label: "Pending",
    tone: "neutral",
    ring: "border-border-strong",
    dot: "bg-fg-subtle",
    icon: "clock",
  },
};
