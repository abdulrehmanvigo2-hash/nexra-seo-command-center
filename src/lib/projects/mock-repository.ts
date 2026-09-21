import "server-only";

import {
  PROJECTS_AS_OF,
  getProjectDetail,
  getProjectIds,
  getProjectList,
  getProjectRecord,
} from "@/lib/mock/projects";
import type { ProjectRepository } from "@/lib/projects/contract";

/**
 * The project repository, answered from the fixture roster.
 *
 * A thin adapter: every record comes from `@/lib/mock/projects`, which stays
 * the only project dataset in the product, so this returns exactly what the
 * screens rendered before the boundary existed. It adds no delay and no
 * storage of its own — which is why `createProject` reports the store as
 * unavailable rather than pretending to keep what it was given.
 */
export const mockProjectRepository: ProjectRepository = {
  storesProjects: false,

  async listProjectIds() {
    return getProjectIds();
  },

  async getProjectById(id) {
    return getProjectRecord(id) ?? null;
  },

  async listProjects() {
    return { projects: getProjectList(), asOf: PROJECTS_AS_OF };
  },

  async getProjectDetail(id, rangeId) {
    return getProjectDetail(id, rangeId);
  },

  /** The fixtures record no intake entries, and none are invented. */
  async getProjectIntake() {
    return null;
  },

  async createProject() {
    return { ok: false, reason: "unavailable" };
  },

  /** The fixtures cannot be written to, and no write is pretended. */
  async updateProjectCompetitors() {
    return { ok: false, reason: "unavailable" };
  },
};
