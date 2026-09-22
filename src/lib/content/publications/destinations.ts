/**
 * Where a publication proposal may name as its destination: a registry of
 * one, kept in code, reviewed like code.
 *
 * The registry identifies the Nexra Agency website and nothing more. The
 * host and source repository are recorded from the site's hosting project
 * so a person can see which site is meant; neither is contacted, and there
 * is no credential here or anywhere in this milestone. The site's content
 * format has not been inspected, so the content path and format are
 * deliberately null: the final path a proposal would be written to is
 * unresolved until a later milestone reads the site and fills them in.
 *
 * A destination is chosen by key and only for the projects it lists. A key
 * from a request that is not here, or that names another project's site,
 * is refused before anything is read.
 *
 * Pure, with no server-only import: the panel shows the same entry the
 * server applies.
 */

import type { PublicationDestination } from "@/types/content-publication";

export const NEXRA_AGENCY_WEBSITE: PublicationDestination = {
  key: "nexra-agency-website",
  label: "Nexra Agency website",
  projectIds: ["nexra-agency"],
  host: "nexraagency.com",
  sourceRepository: "abdulrehmanvigo2-hash/nexra-ai",
  contentPath: null,
  contentFormat: null,
};

export const PUBLICATION_DESTINATIONS: readonly PublicationDestination[] = [NEXRA_AGENCY_WEBSITE];

/** The destinations a project's drafts may be proposed to. */
export function destinationsForProject(projectId: string): readonly PublicationDestination[] {
  return PUBLICATION_DESTINATIONS.filter((destination) => destination.projectIds.includes(projectId));
}

/** The registered destination with this key for this project, or null. */
export function findDestination(key: unknown, projectId: string): PublicationDestination | null {
  if (typeof key !== "string") return null;
  return destinationsForProject(projectId).find((destination) => destination.key === key) ?? null;
}
