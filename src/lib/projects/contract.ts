import type { RangeId } from "@/types/dashboard";
import type {
  Project,
  ProjectDetail,
  ProjectListItem,
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
 * Read-only, and only what a screen currently asks for. Projects created in
 * the intake flow are not written here: they live in the Projects screen's own
 * state for the session (see `@/lib/projects/session-drafts`), and giving this
 * contract a write method before there is anywhere to write to would imply
 * persistence that does not exist.
 */

/** The client roster and the instant its figures describe. */
export type ProjectRoster = {
  readonly projects: readonly ProjectListItem[];
  /** ISO timestamp the roster's figures are measured at. */
  readonly asOf: string;
};

export type ProjectRepository = {
  /** Every project with a workspace, by id. */
  listProjectIds(): Promise<readonly string[]>;

  /** One project's record, or null when the id matches no project. */
  getProjectById(id: string): Promise<Project | null>;

  /** The roster, one row per project. */
  listProjects(): Promise<ProjectRoster>;

  /**
   * Everything one project workspace renders over one reporting window, or
   * null when the id matches no project.
   */
  getProjectDetail(id: string, rangeId: RangeId): Promise<ProjectDetail | null>;
};
