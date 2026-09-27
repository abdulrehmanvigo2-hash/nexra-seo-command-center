import type { AddKeywordInput, AddKeywordOutcome, CuratedKeyword, CuratedKeywordStatus, KeywordActionInput, KeywordActionOutcome, KeywordEvent } from "@/lib/keywords/contract";

/**
 * What the curated keyword service needs from wherever keywords are kept.
 * Every write is one of the database's own functions (migration
 * 20261006120000), which re-check the project, the keyword's project, the
 * target's host and every field; every read is bounded.
 */
export type KeywordStore = {
  /** Whether this store keeps curated keywords. The fixture data source does not. */
  readonly storesKeywords: boolean;
  /** The project's keywords, newest first, at most KEYWORD_READ_LIMIT, optionally one status. Never another project's. */
  listForProject(projectId: string, status: CuratedKeywordStatus | null): Promise<readonly CuratedKeyword[]>;
  /** One keyword by its id, whatever its project, or null; the caller checks the project. */
  getById(keywordId: string): Promise<CuratedKeyword | null>;
  /** The keyword's history, oldest first by `seq`, bounded. Never another project's. */
  listEvents(projectId: string, keywordId: string): Promise<readonly KeywordEvent[]>;
  /** One add, through `nexra_keyword_add`. */
  add(input: AddKeywordInput): Promise<AddKeywordOutcome>;
  /** One change, through `nexra_keyword_set_status`, `_set_group`, `_set_target` or `_set_note`. */
  act(input: KeywordActionInput): Promise<KeywordActionOutcome>;
};

/** The store used when keywords are not persisted anywhere. It refuses rather than pretends. */
export const unavailableKeywordStore: KeywordStore = {
  storesKeywords: false,
  async listForProject() {
    return [];
  },
  async getById() {
    return null;
  },
  async listEvents() {
    return [];
  },
  async add() {
    return { status: "project-not-found" };
  },
  async act() {
    return { status: "keyword-not-found" };
  },
};
