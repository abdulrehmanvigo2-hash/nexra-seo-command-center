import "server-only";

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
      return createSupabaseProjectRepository(createSupabaseProjectGateway(client));
    }
    case "mock":
      return mockProjectRepository;
  }
}

export const projectRepository: ProjectRepository = configuredRepository();
