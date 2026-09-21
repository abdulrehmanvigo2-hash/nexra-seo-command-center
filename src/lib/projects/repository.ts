import "server-only";

import { connection } from "next/server";
import type { ProjectRepository } from "@/lib/projects/contract";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { mockProjectRepository } from "@/lib/projects/mock-repository";
import { createSupabaseProjectGateway } from "@/lib/projects/supabase/gateway";
import type { ProjectsDatabase } from "@/lib/projects/supabase/schema";
import { createSupabaseProjectRepository } from "@/lib/projects/supabase-repository";
import {
  createSupabaseServerClient,
  readSupabaseServerConfig,
} from "@/lib/supabase/server";

export type {
  CreateProjectResult,
  ProjectRepository,
  ProjectRoster,
  UpdateCompetitorsResult,
} from "@/lib/projects/contract";

/**
 * Where project data comes from — the one place that decides.
 *
 * `PROJECTS_DATA_SOURCE` selects the store: unset or `mock` serves the fixture
 * roster, `supabase` reads the Postgres `projects` table and requires its
 * credentials to be configured. The choice is made once, when the server
 * starts, and a misconfigured Supabase selection stops it there with a message
 * naming what is missing (see `@/lib/projects/data-source`).
 *
 * Server-only. Routes read through this and hand the result to their screens
 * as props; a Client Component that imports it fails the build, which is what
 * keeps the store's credentials and queries off the browser.
 */
function configuredRepository(): ProjectRepository {
  switch (selectProjectDataSource(process.env)) {
    case "supabase": {
      const client = createSupabaseServerClient<ProjectsDatabase>(
        readSupabaseServerConfig(process.env),
      );
      return atRequestTime(
        createSupabaseProjectRepository(createSupabaseProjectGateway(client)),
      );
    }
    case "mock":
      return mockProjectRepository;
  }
}

/**
 * A table's contents are only true when read, so a page built from them must
 * be rendered when it is requested, not once at build time and replayed.
 * Each read waits for a request (`connection()`) before querying, which
 * excludes it from prerendering; the fixture roster, which cannot change,
 * stays prerendered.
 *
 * `listProjectIds` is left as it is: `generateStaticParams` calls it at build
 * time, outside any request, and the ids it returns only name routes — every
 * page for them still reads its project when requested.
 */
function atRequestTime(repository: ProjectRepository): ProjectRepository {
  return {
    storesProjects: repository.storesProjects,
    listProjectIds: () => repository.listProjectIds(),
    async getProjectById(id) {
      await connection();
      return repository.getProjectById(id);
    },
    async listProjects() {
      await connection();
      return repository.listProjects();
    },
    async getProjectDetail(id, rangeId) {
      await connection();
      return repository.getProjectDetail(id, rangeId);
    },
    async getProjectIntake(id) {
      await connection();
      return repository.getProjectIntake(id);
    },
    createProject: (input) => repository.createProject(input),
    updateProjectCompetitors: (id, domains) => repository.updateProjectCompetitors(id, domains),
  };
}

export const projectRepository: ProjectRepository = configuredRepository();
