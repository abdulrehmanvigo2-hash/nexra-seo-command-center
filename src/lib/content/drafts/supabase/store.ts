import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { ContentDraftStore, CreateDraftOutcome } from "@/lib/content/drafts/contract";
import {
  CONTENT_DRAFT_READ_COLUMNS,
  CONTENT_DRAFT_VERSION_READ_COLUMNS,
  draftRowToDraft,
  draftToInsert,
  firstVersionInsert,
  versionRowToVersion,
  type ContentDraftsDatabase,
} from "@/lib/content/drafts/supabase/schema";
import type { ContentDraftVersion, DraftWithCurrentVersion } from "@/types/content-draft";

/**
 * The draft store over `nexra_content_drafts` and
 * `nexra_content_draft_versions`.
 *
 * A thin translation into Supabase calls, like the crawl store: the rules
 * live in the service, the tables' constraints and guard triggers enforce
 * them again for any writer that skips it. The typed client makes reaching
 * any other table a compile error.
 *
 * Creating a draft is two inserts. The unique writer-run key on the parent
 * is what makes the operation safe to repeat: a second save, or a
 * concurrent one, hits the key and is answered `exists` with nothing
 * written. If the version insert fails after the parent was written, the
 * parent is removed again so no draft ever exists without its version 1;
 * should that removal fail too, the parent stays and the next read of it
 * reports the missing version as an error rather than as an empty draft.
 */

export class ContentDraftStoreError extends Error {
  constructor(operation: string, cause: PostgrestError | Error) {
    const detail = "code" in cause ? `(${cause.code}): ${cause.message}` : cause.message;
    super(`Content draft store: ${operation} failed ${detail}`);
    this.name = "ContentDraftStoreError";
  }
}

const UNIQUE_VIOLATION = "23505";

export function createSupabaseDraftStore(client: SupabaseClient<ContentDraftsDatabase>): ContentDraftStore {
  async function versionOf(draftId: string, version: number): Promise<ContentDraftVersion | null> {
    const { data, error } = await client
      .from("nexra_content_draft_versions")
      .select(CONTENT_DRAFT_VERSION_READ_COLUMNS)
      .eq("draft_id", draftId)
      .eq("version", version)
      .maybeSingle();
    if (error) throw new ContentDraftStoreError("read draft version", error);
    return data === null ? null : versionRowToVersion(data);
  }

  async function withCurrentVersion(row: Parameters<typeof draftRowToDraft>[0]): Promise<DraftWithCurrentVersion> {
    const draft = draftRowToDraft(row);
    const version = await versionOf(draft.id, draft.currentVersion);
    if (version === null) {
      throw new ContentDraftStoreError(
        "read draft",
        new Error(`draft ${draft.id} names version ${draft.currentVersion}, which does not exist`),
      );
    }
    return { draft, version };
  }

  return {
    storesDrafts: true,

    async findByWriterRunId(projectId, writerRunId) {
      const { data, error } = await client
        .from("nexra_content_drafts")
        .select(CONTENT_DRAFT_READ_COLUMNS)
        .eq("project_id", projectId)
        .eq("source_writer_run_id", writerRunId)
        .maybeSingle();
      if (error) throw new ContentDraftStoreError("find draft by writer run", error);
      return data === null ? null : withCurrentVersion(data);
    },

    async getByProjectAndId(projectId, draftId) {
      const { data, error } = await client
        .from("nexra_content_drafts")
        .select(CONTENT_DRAFT_READ_COLUMNS)
        .eq("project_id", projectId)
        .eq("id", draftId)
        .maybeSingle();
      if (error) throw new ContentDraftStoreError("read draft", error);
      return data === null ? null : withCurrentVersion(data);
    },

    async createFromWriterRun(input): Promise<CreateDraftOutcome> {
      const parent = await client
        .from("nexra_content_drafts")
        .insert(draftToInsert(input))
        .select(CONTENT_DRAFT_READ_COLUMNS)
        .single();
      if (parent.error) {
        if (parent.error.code === UNIQUE_VIOLATION) return { status: "exists" };
        throw new ContentDraftStoreError("create draft", parent.error);
      }
      const draft = draftRowToDraft(parent.data);

      const first = await client
        .from("nexra_content_draft_versions")
        .insert(firstVersionInsert(draft.id, input))
        .select(CONTENT_DRAFT_VERSION_READ_COLUMNS)
        .single();
      if (first.error) {
        // Leave no parent without its version 1 behind.
        const removal = await client.from("nexra_content_drafts").delete().eq("id", draft.id);
        if (removal.error) {
          throw new ContentDraftStoreError(
            "create draft version (and the parent could not be removed)",
            first.error,
          );
        }
        throw new ContentDraftStoreError("create draft version", first.error);
      }

      return { status: "created", saved: { draft, version: versionRowToVersion(first.data) } };
    },

    async getCurrentVersion(draftId) {
      const { data, error } = await client
        .from("nexra_content_drafts")
        .select(CONTENT_DRAFT_READ_COLUMNS)
        .eq("id", draftId)
        .maybeSingle();
      if (error) throw new ContentDraftStoreError("read draft", error);
      if (data === null) return null;
      return versionOf(draftId, data.current_version);
    },
  };
}
