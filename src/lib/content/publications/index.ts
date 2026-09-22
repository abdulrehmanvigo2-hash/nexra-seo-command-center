import "server-only";

import { unavailableDraftStore } from "@/lib/content/drafts/contract";
import type { ContentDraftsDatabase } from "@/lib/content/drafts/supabase/schema";
import { createSupabaseDraftStore } from "@/lib/content/drafts/supabase/store";
import { unavailableProposalStore } from "@/lib/content/publications/contract";
import { createPublicationService, type PublicationService } from "@/lib/content/publications/service";
import type { ContentPublicationsDatabase } from "@/lib/content/publications/supabase/schema";
import { createSupabaseProposalStore } from "@/lib/content/publications/supabase/store";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The server's publication proposal service — the one place that wires it.
 *
 * Proposals live beside the drafts they bind: with
 * `PROJECTS_DATA_SOURCE=supabase` in `nexra_content_publication_proposals`,
 * read with the same server-only client and secret key as the drafts. With
 * the fixture roster there is nowhere to keep them, and every call answers
 * `unavailable`. No other credential exists here: nothing in this module
 * can reach a repository, a website or a deployment.
 */

function configuredService(): PublicationService {
  if (selectProjectDataSource(process.env) !== "supabase") {
    return createPublicationService({ drafts: unavailableDraftStore, proposals: unavailableProposalStore });
  }
  const config = readSupabaseServerConfig(process.env);
  return createPublicationService({
    drafts: createSupabaseDraftStore(createSupabaseServerClient<ContentDraftsDatabase>(config)),
    proposals: createSupabaseProposalStore(createSupabaseServerClient<ContentPublicationsDatabase>(config)),
  });
}

let service: PublicationService | null = null;

export function publicationService(): PublicationService {
  service ??= configuredService();
  return service;
}
