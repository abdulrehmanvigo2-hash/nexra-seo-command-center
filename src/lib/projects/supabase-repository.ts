import type { ProjectRepository } from "@/lib/projects/contract";
import {
  FIXTURE_ANALYTICS_AS_OF,
  fixtureDetail,
  fixtureListItem,
  fixtureRosterPosition,
  unmeasuredListItem,
  withFixtureAnalytics,
} from "@/lib/projects/fixture-analytics";
import { parseNewProjectInput, projectSlug } from "@/lib/projects/intake-rules";
import type { ProjectTableGateway } from "@/lib/projects/supabase/gateway";
import {
  PROJECT_ID_PATTERN,
  newProjectInsert,
  projectRowToRecord,
} from "@/lib/projects/supabase/schema";
import type { ProjectRecord } from "@/types/project";

/**
 * The project repository over the Postgres `projects` table.
 *
 * Records come from the table; reporting figures still come from the fixture
 * generator, joined by id in `fixture-analytics.ts`. A project with a stored
 * record but no figures appears in the roster as unmeasured and has no
 * workspace yet — the same answer the roster gives a project nobody has
 * crawled.
 */

/** Ids a new project may not take: the dashboard roll-up owns this one. */
const RESERVED_IDS: ReadonlySet<string> = new Set(["portfolio"]);

/** How many `-2`, `-3`, … suffixes to try before giving up on a name. */
const MAX_ID_ATTEMPTS = 20;

/** Canonical roster order first, then stored-only projects oldest first. */
function inRosterOrder(records: readonly ProjectRecord[]): ProjectRecord[] {
  return records
    .map((record, index) => ({ record, index, position: fixtureRosterPosition(record.id) }))
    .sort((a, b) => {
      if (a.position !== null && b.position !== null) return a.position - b.position;
      if (a.position !== null) return -1;
      if (b.position !== null) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.record);
}

export function createSupabaseProjectRepository(
  gateway: ProjectTableGateway,
  options: { readonly now?: () => Date } = {},
): ProjectRepository {
  const now = options.now ?? (() => new Date());

  const readAll = async () =>
    inRosterOrder((await gateway.selectAll()).map(projectRowToRecord));

  const readProject = async (id: string) => {
    // An id the table's own constraint would reject cannot be stored, so there
    // is nothing to ask the database about.
    if (!PROJECT_ID_PATTERN.test(id)) return null;
    const row = await gateway.selectById(id);
    return row ? withFixtureAnalytics(projectRowToRecord(row)) : null;
  };

  return {
    async listProjectIds() {
      return (await readAll())
        .filter((record) => withFixtureAnalytics(record) !== null)
        .map((record) => record.id);
    },

    async getProjectById(id) {
      return readProject(id);
    },

    async listProjects() {
      const projects = (await readAll()).map((record) => {
        const project = withFixtureAnalytics(record);
        return project ? fixtureListItem(project) : unmeasuredListItem(record);
      });
      return { projects, asOf: FIXTURE_ANALYTICS_AS_OF };
    },

    async getProjectDetail(id, rangeId) {
      const project = await readProject(id);
      return project ? fixtureDetail(project, rangeId) : null;
    },

    async createProject(input) {
      const parsed = parseNewProjectInput(input);
      if (!parsed.ok) return { ok: false, reason: "invalid", errors: parsed.errors };

      const base =
        [projectSlug(parsed.value.name), projectSlug(parsed.value.domain)].find(
          (slug) => slug.length >= 2,
        ) ?? "project";
      const today = now();

      for (let attempt = 1; attempt <= MAX_ID_ATTEMPTS; attempt += 1) {
        const id = attempt === 1 ? base : `${base}-${attempt}`;
        if (RESERVED_IDS.has(id)) continue;

        const outcome = await gateway.insert(newProjectInsert(parsed.value, id, today));
        if (outcome.status === "inserted") {
          return { ok: true, project: projectRowToRecord(outcome.row) };
        }
        if (outcome.on === "domain") return { ok: false, reason: "duplicate-domain" };
        // The id is taken by a different project with a similar name; try the next suffix.
      }

      throw new Error(
        `Projects store: no free id for "${base}" after ${MAX_ID_ATTEMPTS} attempts.`,
      );
    },
  };
}
