import type { NewProjectErrors } from "@/lib/projects/intake-rules";
import type { RangeId } from "@/types/dashboard";
import type {
  NewProjectInput,
  ProjectDetail,
  ProjectListItem,
  ProjectRecord,
} from "@/types/project";

/**
 * What the Projects screens need from wherever project data is kept.
 *
 * Storage-agnostic on purpose. Today the implementation reads the fixture
 * roster; a database, an API, or any other store can replace it without a
 * screen changing, because screens never see the implementation — only these
 * shapes, which are the existing ones in `@/types/project`.
 *
 * Every method is asynchronous even though the current implementation answers
 * immediately. Any real store answers over I/O, and a synchronous contract
 * would have to change shape — and every caller with it — the day one exists.
 *
 * Reads are what the screens use today. The one write, `createProject`, is what
 * a persistent store needs next; no screen calls it yet. Projects created in the
 * intake flow still live in the Projects screen's own state for the session
 * (see `@/lib/projects/session-drafts`) until the dialog is wired to a store
 * that can be tested end to end.
 */

/** How an attempt to create a project ended. */
export type CreateProjectResult =
  | { readonly ok: true; readonly project: ProjectRecord }
  /** The submission broke an intake rule; nothing was written. */
  | { readonly ok: false; readonly reason: "invalid"; readonly errors: NewProjectErrors }
  /** Another project already has this website. */
  | { readonly ok: false; readonly reason: "duplicate-domain" }
  /** This store does not persist projects. */
  | { readonly ok: false; readonly reason: "unavailable" };

/** The client roster and the instant its figures describe. */
export type ProjectRoster = {
  readonly projects: readonly ProjectListItem[];
  /** ISO timestamp the roster's figures are measured at. */
  readonly asOf: string;
};

export type ProjectRepository = {
  /**
   * Whether `createProject` keeps what it is given. The fixture store does not;
   * the Projects screen then holds new projects for the session only, and says
   * so.
   */
  readonly storesProjects: boolean;

  /** Every project, measured or not, by id. */
  listProjectIds(): Promise<readonly string[]>;

  /**
   * One project's record, or null when the id matches no project. Identity
   * only: whether the project has reporting data is `getProjectDetail`'s
   * question, so a project nothing has measured still has a record.
   */
  getProjectById(id: string): Promise<ProjectRecord | null>;

  /** The roster, one row per project. */
  listProjects(): Promise<ProjectRoster>;

  /**
   * Everything one project workspace renders over one reporting window, or
   * null when there is no project or nothing has measured it.
   */
  getProjectDetail(id: string, rangeId: RangeId): Promise<ProjectDetail | null>;

  /**
   * Validates and stores a new project. Returns the stored record — not a
   * `Project`, because a project that has just been created has no reporting
   * data behind it yet.
   */
  createProject(input: NewProjectInput): Promise<CreateProjectResult>;
};
