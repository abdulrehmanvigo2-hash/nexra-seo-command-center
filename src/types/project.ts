/**
 * Shapes for the Projects module (CLAUDE.md §14, Phase 3).
 *
 * There is one project vocabulary in this product, not two. `DashboardProject`
 * in `src/types/dashboard.ts` describes what the deterministic generator needs
 * to derive a project's numbers; `Project` here is that same record plus the
 * client-facing detail an agency manages — who the client is, what market it
 * sells into, what the engagement is trying to achieve.
 *
 * Several shapes below are aliases rather than new declarations. A project's
 * health scores, its assigned agents, and its competitor set are structurally
 * the same records the Command Center already produces, so they are named in
 * the project vocabulary and reused instead of being restated — the Projects
 * module and the dashboard cannot disagree about a number they share.
 *
 * Everything typed here is served by `src/lib/mock/projects` — fixtures, not
 * live data (CLAUDE.md §4).
 */
import type { IconName } from "@/components/icons";
import type { NavHref } from "@/config/navigation";
import type {
  ActionArea,
  AgentId,
  AgentOperation,
  CompetitorRow,
  ContentSnapshot,
  DashboardProject,
  DateRange,
  KeywordSnapshot,
  Level,
  MetricHealth,
  MetricTrend,
  Priority,
  ProjectId,
  ScoreCardData,
  TechnicalSnapshot,
  TrendSeries,
} from "@/types/dashboard";

export type { ProjectId };

// ---------------------------------------------------------------------------
// The project record
// ---------------------------------------------------------------------------

/** Where the engagement currently stands. */
export type ProjectStatus =
  | "active"
  | "onboarding"
  | "monitoring"
  | "paused"
  | "needs-attention";

/** The kind of SEO programme being run. */
export type ProjectType =
  | "saas"
  | "ecommerce"
  | "local"
  | "lead-gen"
  | "publisher"
  | "enterprise"
  | "other";

/** What the engagement is trying to move. */
export type ProjectGoal =
  | "organic-traffic"
  | "leads"
  | "rankings"
  | "ecommerce-revenue"
  | "local-visibility"
  | "ai-visibility"
  | "technical-recovery";

/**
 * A client project.
 *
 * Extends `DashboardProject`, so every project in the roster can be selected
 * on the Command Center without a translation step, and the two modules derive
 * their numbers from the same `scale`, `healthOffset`, and `seed`.
 */
export type Project = DashboardProject & {
  /** The company the work is delivered for. */
  readonly client: string;
  readonly type: ProjectType;
  readonly status: ProjectStatus;
  /** Primary market, e.g. "United Kingdom". */
  readonly market: string;
  /** Primary content language, e.g. "English (UK)". */
  readonly language: string;
  readonly goal: ProjectGoal;
  /** Geographic target the rankings are measured in. */
  readonly targetLocation: string;
  /** ISO 8601 date the engagement started. */
  readonly startedAt: string;
  /** ISO 8601 timestamp of the last recorded change. */
  readonly updatedAt: string;
  /** One line of engagement context, shown on the project workspace. */
  readonly summary: string;
};

/**
 * What a store keeps about a project: `Project` without the four fields that
 * exist only for the mock analytics generator.
 *
 * `scale`, `healthOffset`, and `seed` parameterise simulated reporting data,
 * and `portfolio` marks the dashboard roll-up; none of them is a fact about a
 * client.
 */
export type ProjectRecord = Omit<
  Project,
  "portfolio" | "scale" | "healthOffset" | "seed"
>;

// ---------------------------------------------------------------------------
// Roster rows
// ---------------------------------------------------------------------------

/**
 * One row of the projects roster, flattened for display.
 *
 * Flat rather than wrapping a `Project`, because the list also carries
 * projects created in this session, which have no fixture record behind them.
 */
export type ProjectListItem = {
  /** The project's id; a generated id for a session draft. */
  readonly id: string;
  readonly name: string;
  readonly domain: string;
  readonly client: string;
  readonly industry: string;
  readonly initials: string;
  readonly type: ProjectType;
  readonly status: ProjectStatus;
  readonly market: string;
  readonly goal: ProjectGoal;
  /** Route of the project workspace, or null where there is not one yet. */
  readonly href: string | null;
  /** True for a project created in this session and not stored anywhere. */
  readonly draft: boolean;
  /**
   * False where nothing has measured the project yet — a session draft, or a
   * stored project with no reporting data. Every figure below is then zero and
   * has to be shown as absent, never as a reading.
   */
  readonly measured: boolean;
  /** SEO health index, 0-100. */
  readonly health: number;
  readonly healthState: MetricHealth;
  /** Technical health index, 0-100. */
  readonly technicalHealth: number;
  /** Search visibility index, 0-100. */
  readonly visibility: number;
  /** AI answer visibility index, 0-100. */
  readonly aiVisibility: number;
  /** Organic sessions over the last 30 days. */
  readonly organicTraffic: number;
  readonly trafficTrend: MetricTrend;
  readonly rankingKeywords: number;
  readonly conversions: number;
  readonly openIssues: number;
  readonly criticalIssues: number;
  readonly activeTasks: number;
  /** Agents assigned to this project. */
  readonly agents: readonly AgentId[];
  /** Daily organic sessions behind the row's mini trend line. */
  readonly spark: readonly number[];
  /** ISO 8601 timestamp of the last recorded change. */
  readonly updatedAt: string;
};

/** One portfolio-level number above the roster. */
export type ProjectMetric = {
  readonly id: string;
  readonly label: string;
  /** Pre-formatted for display. */
  readonly value: string;
  readonly unit?: string;
  readonly detail: string;
  readonly icon: IconName;
  readonly trend?: MetricTrend;
  readonly health?: MetricHealth;
};

// ---------------------------------------------------------------------------
// Project workspace
// ---------------------------------------------------------------------------

/**
 * One health index on a project workspace.
 *
 * The same record the Command Center's health strip renders, so the score a
 * project shows is the score the dashboard shows for it.
 */
export type ProjectHealth = ScoreCardData;

/** An agent working on this project. Same record as the operations board. */
export type AssignedAgent = AgentOperation;

/** A competitor tracked for this project. Same record as the dashboard's. */
export type ProjectCompetitor = CompetitorRow;

/** Whether an entry is a defect to fix or an opening to take. */
export type ProjectIssueKind =
  | "critical"
  | "warning"
  | "opportunity"
  | "quick-win";

/** Local workflow state. Changing it is frontend-only in this milestone. */
export type ProjectIssueStatus =
  | "open"
  | "in-progress"
  | "monitoring"
  | "resolved";

export type ProjectIssue = {
  readonly id: string;
  readonly kind: ProjectIssueKind;
  readonly severity: Priority;
  /** Discipline that owns it, shared with the dashboard's action areas. */
  readonly category: ActionArea;
  readonly title: string;
  readonly description: string;
  /** Pre-formatted expected gain or exposure. */
  readonly impact: string;
  readonly impactLevel: Level;
  readonly effort: Level;
  readonly agent: AgentId;
  readonly status: ProjectIssueStatus;
  /** Module that owns the follow-up — always a real route. */
  readonly module: NavHref;
};

export type ProjectTaskStatus =
  | "todo"
  | "in-progress"
  | "review"
  | "blocked"
  | "completed";

/** How the due date reads against the reference instant. */
export type ProjectTaskDue =
  | "overdue"
  | "due-today"
  | "this-week"
  | "scheduled"
  | "delivered";

export type ProjectTask = {
  readonly id: string;
  readonly title: string;
  readonly priority: Priority;
  readonly agent: AgentId;
  /** ISO 8601 date the task is due. */
  readonly due: string;
  readonly dueState: ProjectTaskDue;
  /** Completion percentage, 0-100. */
  readonly progress: number;
  readonly status: ProjectTaskStatus;
};

export type ProjectNote = {
  readonly id: string;
  readonly body: string;
  readonly author: string;
  /** Role or discipline of the author, e.g. "Account lead". */
  readonly role: string;
  /** ISO 8601 timestamp. */
  readonly at: string;
  /** Whether a person or one of the agents wrote it. */
  readonly source: "team" | "agent";
};

/** The fields a project's settings tab can edit. All non-sensitive. */
export type ProjectSettings = {
  readonly name: string;
  readonly client: string;
  readonly domain: string;
  readonly industry: string;
  readonly market: string;
  readonly language: string;
  readonly goal: ProjectGoal;
  readonly status: ProjectStatus;
};

/** Everything a project workspace renders, for one project over one window. */
export type ProjectDetail = {
  readonly project: Project;
  readonly range: DateRange;
  /** ISO 8601 instant the fixtures represent. */
  readonly generatedAt: string;
  readonly health: readonly ProjectHealth[];
  readonly metrics: readonly ProjectMetric[];
  readonly trend: TrendSeries;
  readonly issues: readonly ProjectIssue[];
  readonly tasks: readonly ProjectTask[];
  readonly team: readonly AssignedAgent[];
  readonly keywords: KeywordSnapshot;
  readonly content: ContentSnapshot;
  readonly technical: TechnicalSnapshot;
  readonly competitors: readonly ProjectCompetitor[];
  /** Keywords rivals rank for that this project does not. */
  readonly contentGaps: number;
  /** Keywords contested by both this project and its rivals. */
  readonly sharedKeywords: number;
  readonly notes: readonly ProjectNote[];
};

// ---------------------------------------------------------------------------
// Create-project intake
// ---------------------------------------------------------------------------

/**
 * What the create-project flow collects. The dialog keeps it in session state;
 * a persistent store validates and saves it through `createProject`.
 */
export type NewProjectInput = {
  readonly name: string;
  readonly url: string;
  readonly client: string;
  readonly industry: string;
  readonly market: string;
  readonly language: string;
  readonly type: ProjectType;
  readonly goal: ProjectGoal;
  readonly targetLocation: string;
  /** Competitor domains, one per entry. */
  readonly competitors: readonly string[];
  readonly notes: string;
};
