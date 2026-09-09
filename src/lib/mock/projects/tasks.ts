import {
  DATA_AS_OF,
  daysBefore,
  pickSubset,
  randInt,
} from "@/lib/mock/dashboard/core";
import type { DashboardProject } from "@/types/dashboard";
import type { AgentId, Priority } from "@/types/seo";
import type {
  ProjectStatus,
  ProjectTask,
  ProjectTaskDue,
  ProjectTaskStatus,
} from "@/types/project";

/**
 * The delivery board for one project.
 *
 * A compact snapshot, not a task manager: enough to see what is in flight,
 * what has stalled, and who owns it. The full board arrives with its own
 * module — nothing here schedules or executes anything (CLAUDE.md §4).
 */

type TaskSeed = {
  readonly title: string;
  readonly priority: Priority;
  readonly agent: AgentId;
  /** Days from the reference instant the task is due; negative is past. */
  readonly dueInDays: number;
};

const POOL: readonly TaskSeed[] = [
  {
    title: "Sign off the Q4 keyword priority list",
    priority: "high",
    agent: "seo-director",
    dueInDays: -2,
  },
  {
    title: "Rebuild the internal linking map for the money pages",
    priority: "high",
    agent: "on-page-seo",
    dueInDays: 3,
  },
  {
    title: "Fix the 5xx responses on paginated category URLs",
    priority: "critical",
    agent: "technical-seo",
    dueInDays: 0,
  },
  {
    title: "Draft the buyer's guide for the top commercial cluster",
    priority: "medium",
    agent: "writer",
    dueInDays: 6,
  },
  {
    title: "Refresh the six guides flagged as decaying",
    priority: "medium",
    agent: "content-strategist",
    dueInDays: 11,
  },
  {
    title: "Verify sources and citations in the pending drafts",
    priority: "medium",
    agent: "research-evidence",
    dueInDays: 4,
  },
  {
    title: "Rewrite titles on the twenty-four lowest-CTR page-one results",
    priority: "medium",
    agent: "on-page-seo",
    dueInDays: 8,
  },
  {
    title: "Map the competitor content gap for the next two sprints",
    priority: "high",
    agent: "market-intelligence",
    dueInDays: 2,
  },
  {
    title: "Add FAQ and definition blocks to answer-eligible pages",
    priority: "medium",
    agent: "ai-visibility",
    dueInDays: 9,
  },
  {
    title: "Reclaim the referring domains lost in the partner redesign",
    priority: "high",
    agent: "authority-backlink",
    dueInDays: 14,
  },
  {
    title: "Cluster the new keyword export by intent",
    priority: "low",
    agent: "keyword-intent",
    dueInDays: 5,
  },
  {
    title: "Prepare the month-end performance summary for the client",
    priority: "medium",
    agent: "analytics-learning",
    dueInDays: 7,
  },
  {
    title: "Reschedule the two milestones that slipped this sprint",
    priority: "low",
    agent: "project-manager",
    dueInDays: -1,
  },
  {
    title: "Ship schema markup on the product and article templates",
    priority: "high",
    agent: "technical-seo",
    dueInDays: 12,
  },
  {
    title: "Feed last month's ranking learnings back to the Director",
    priority: "low",
    agent: "analytics-learning",
    dueInDays: 16,
  },
];

/**
 * A fixed mix of board states, rotated per project.
 *
 * Fixed rather than random so every project's board stays plausible: some
 * work finished, most in flight, one thing stuck.
 */
const STATUS_MIX: readonly ProjectTaskStatus[] = [
  "in-progress",
  "todo",
  "completed",
  "in-progress",
  "review",
  "todo",
  "blocked",
  "completed",
  "in-progress",
  "todo",
];

/** Progress range for each state, so the bar agrees with the badge. */
const PROGRESS_RANGE: Record<ProjectTaskStatus, readonly [number, number]> = {
  todo: [0, 0],
  "in-progress": [25, 80],
  review: [85, 95],
  blocked: [15, 55],
  completed: [100, 100],
};

const DAY_MS = 86_400_000;

function dueState(due: string, status: ProjectTaskStatus): ProjectTaskDue {
  if (status === "completed") return "delivered";

  const days = Math.round((Date.parse(due) - Date.parse(DATA_AS_OF)) / DAY_MS);
  if (days < 0) return "overdue";
  if (days === 0) return "due-today";
  if (days <= 7) return "this-week";
  return "scheduled";
}

/**
 * How the engagement's state constrains the board.
 *
 * A paused project cannot have work in flight, and one still in onboarding has
 * nothing far enough along to review or block. Applying this here keeps the
 * board consistent with the status shown on the project header instead of
 * contradicting it.
 */
function boardStatus(
  status: ProjectStatus | undefined,
  rolled: ProjectTaskStatus,
): ProjectTaskStatus {
  if (status === "paused") {
    return rolled === "completed" ? "completed" : "blocked";
  }
  if (status === "onboarding" && (rolled === "review" || rolled === "blocked")) {
    return "todo";
  }
  return rolled;
}

/** How much of the board an engagement in this state would carry. */
function taskCount(project: DashboardProject, status?: ProjectStatus): number {
  if (project.portfolio) return POOL.length;
  if (status === "paused") return 3;
  if (status === "onboarding") return 5;
  return randInt(project.seed, 3, 7, 10);
}

/** The delivery board for one project, most urgent first. */
export function buildProjectTasks(
  project: DashboardProject,
  projectStatus?: ProjectStatus,
): readonly ProjectTask[] {
  const selected = pickSubset(
    POOL,
    project.seed + 211,
    taskCount(project, projectStatus),
  );
  const offset = project.seed % STATUS_MIX.length;

  const tasks = selected.map((seed, index) => {
    const status = boardStatus(
      projectStatus,
      STATUS_MIX[(index + offset) % STATUS_MIX.length],
    );
    const [low, high] = PROGRESS_RANGE[status];
    const due = daysBefore(-seed.dueInDays);

    return {
      id: `${project.id}-task-${index + 1}`,
      title: seed.title,
      priority: seed.priority,
      agent: seed.agent,
      due,
      dueState: dueState(due, status),
      progress: low === high ? low : randInt(project.seed + 313, index, low, high),
      status,
    };
  });

  const DUE_RANK: Record<ProjectTaskDue, number> = {
    overdue: 0,
    "due-today": 1,
    "this-week": 2,
    scheduled: 3,
    delivered: 4,
  };

  return tasks.sort((a, b) => DUE_RANK[a.dueState] - DUE_RANK[b.dueState]);
}
