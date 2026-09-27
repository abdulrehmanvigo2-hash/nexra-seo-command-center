import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { KEYWORD_EVENT_READ_LIMIT, KEYWORD_READ_LIMIT } from "@/lib/keywords/contract";
import type { KeywordStore } from "@/lib/keywords/store-contract";
import {
  actionResultToOutcome,
  addResultToOutcome,
  eventRowToEvent,
  KEYWORD_EVENT_READ_COLUMNS,
  KEYWORD_READ_COLUMNS,
  keywordRowToKeyword,
  type KeywordsDatabase,
} from "@/lib/keywords/supabase/schema";

/**
 * The curated keyword store over `nexra_keywords` (migration
 * 20261006120000). A thin translation into Supabase calls: the five database
 * functions and the tables' constraints enforce the project, the exact
 * query, the field bounds and the target's host for any caller; every read
 * is bounded and, except the one by id, scoped to one project.
 */

export class KeywordStoreError extends Error {
  readonly code: string | null;

  constructor(operation: string, cause: PostgrestError | Error) {
    const code = "code" in cause && typeof cause.code === "string" ? cause.code : null;
    super(`Keyword store: ${operation} failed${code ? ` (${code})` : ""}: ${cause.message}`);
    this.name = "KeywordStoreError";
    this.code = code;
  }
}

export function createSupabaseKeywordStore(client: SupabaseClient<KeywordsDatabase>): KeywordStore {
  return {
    storesKeywords: true,

    async listForProject(projectId, status) {
      let query = client.from("nexra_keywords").select(KEYWORD_READ_COLUMNS).eq("project_id", projectId);
      if (status !== null) query = query.eq("status", status);
      const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(KEYWORD_READ_LIMIT);
      if (error) throw new KeywordStoreError("list keywords", error);
      return data.map(keywordRowToKeyword);
    },

    async getById(keywordId) {
      const { data, error } = await client.from("nexra_keywords").select(KEYWORD_READ_COLUMNS).eq("id", keywordId).maybeSingle();
      if (error) throw new KeywordStoreError("get keyword", error);
      return data === null ? null : keywordRowToKeyword(data);
    },

    async listEvents(projectId, keywordId) {
      const { data, error } = await client
        .from("nexra_keyword_events")
        .select(KEYWORD_EVENT_READ_COLUMNS)
        .eq("project_id", projectId)
        .eq("keyword_id", keywordId)
        .order("seq", { ascending: true })
        .limit(KEYWORD_EVENT_READ_LIMIT);
      if (error) throw new KeywordStoreError("list keyword events", error);
      return data.map(eventRowToEvent);
    },

    async add(input) {
      const { data, error } = await client.rpc("nexra_keyword_add", {
        p_project_id: input.projectId,
        p_query: input.query,
        p_group_label: input.groupLabel,
        p_note: input.note,
        p_target_page: input.targetPage,
        p_operator: input.operatorId,
      });
      if (error) throw new KeywordStoreError("add keyword", error);
      return addResultToOutcome(data);
    },

    async act(input) {
      const base = { p_project_id: input.projectId, p_keyword_id: input.keywordId, p_operator: input.operatorId };
      const call =
        input.action === "status"
          ? client.rpc("nexra_keyword_set_status", { ...base, p_status: input.value })
          : input.action === "group"
            ? client.rpc("nexra_keyword_set_group", { ...base, p_group_label: input.value })
            : input.action === "target"
              ? client.rpc("nexra_keyword_set_target", { ...base, p_target_page: input.value })
              : client.rpc("nexra_keyword_set_note", { ...base, p_note: input.value });
      const { data, error } = await call;
      if (error) throw new KeywordStoreError(`set keyword ${input.action}`, error);
      return actionResultToOutcome(input.action, data);
    },
  };
}
