import type { AgentTask } from "@/lib/agent-tasks/contract";
import type { CuratedKeyword, CuratedKeywordStatus, KeywordActionInput, KeywordActionOutcome, KeywordEvent } from "@/lib/keywords/contract";
import { observedLinkFor, type ObservedHistory, type ObservedLink } from "@/lib/keywords/observed";
import type { KeywordStore } from "@/lib/keywords/store-contract";
import type { KeywordIntelligence } from "@/lib/search-console/keywords/inventory";

/**
 * The curated keyword service (checkpoint 3.5). It composes the keyword
 * store with three read-only sources the caller wires: the project's stored
 * Search Console rows (joined by exact query text), the project's tasks
 * (those whose keyword source is the exact query) and the stored project.
 * Nothing here writes anywhere but through the store's database functions,
 * and nothing reaches an agent: curated keywords are not grounding (Q6).
 */

export type KeywordObservedReader = {
  /** The project's observed inventory; null when this deployment keeps no snapshots. */
  inventory(projectId: string): Promise<KeywordIntelligence | null>;
  /** Per-window figures and pages for one exact query; null when this deployment keeps no snapshots. */
  history(projectId: string, query: string): Promise<ObservedHistory | null>;
};

export type KeywordTaskReader = {
  /** The project's tasks recorded from this exact query; null when tasks are not kept. */
  tasksForQuery(projectId: string, query: string): Promise<readonly AgentTask[] | null>;
};

export type KeywordProject = { readonly id: string; readonly name: string; readonly domain: string };
export type KeywordProjectReader = { get(projectId: string): Promise<KeywordProject | null> };

export type CuratedKeywordRow = { readonly keyword: CuratedKeyword; readonly observed: ObservedLink };

export type ListKeywordsResult = { readonly status: "unavailable" } | { readonly status: "listed"; readonly keywords: readonly CuratedKeywordRow[] };

export type AddKeywordsResult =
  | { readonly status: "unavailable" }
  | { readonly status: "project-not-found" }
  | {
      readonly status: "recorded";
      readonly results: readonly { readonly query: string; readonly outcome: "added" | "exists" | "target-off-host"; readonly keywordId: string | null }[];
    };

export type ReadKeywordResult =
  | { readonly status: "unavailable" }
  | { readonly status: "not-found" }
  | {
      readonly status: "found";
      readonly keyword: CuratedKeyword;
      readonly project: KeywordProject;
      readonly events: readonly KeywordEvent[];
      readonly observed: ObservedLink;
      /** "not-kept": no snapshots on this deployment; "unreadable": the stored rows could not be read. */
      readonly history: ObservedHistory | "not-kept" | "unreadable";
      /** Null when tasks are not kept or could not be read. */
      readonly tasks: readonly AgentTask[] | null;
    };

export type KeywordActionResult = { readonly status: "unavailable" } | KeywordActionOutcome;

export type KeywordService = {
  listKeywords(projectId: string, status: CuratedKeywordStatus | null): Promise<ListKeywordsResult>;
  addKeywords(
    projectId: string,
    entries: readonly { readonly query: string; readonly groupLabel: string | null; readonly note: string | null; readonly targetPage: string | null }[],
    operatorId: string,
  ): Promise<AddKeywordsResult>;
  readKeyword(keywordId: string): Promise<ReadKeywordResult>;
  act(input: KeywordActionInput): Promise<KeywordActionResult>;
};

export function createKeywordService(
  store: KeywordStore,
  sources: { readonly observed: KeywordObservedReader; readonly tasks: KeywordTaskReader; readonly projects: KeywordProjectReader },
): KeywordService {
  async function inventoryOf(projectId: string): Promise<KeywordIntelligence | null | "unreadable"> {
    try {
      return await sources.observed.inventory(projectId);
    } catch {
      return "unreadable";
    }
  }

  return {
    async listKeywords(projectId, status) {
      if (!store.storesKeywords) return { status: "unavailable" };
      const [keywords, inventory] = await Promise.all([store.listForProject(projectId, status), inventoryOf(projectId)]);
      return {
        status: "listed",
        // Belt and braces: the store filters by project; a row that is not the project's is dropped.
        keywords: keywords.filter((k) => k.projectId === projectId).map((keyword) => ({ keyword, observed: observedLinkFor(keyword.query, inventory) })),
      };
    },

    async addKeywords(projectId, entries, operatorId) {
      if (!store.storesKeywords) return { status: "unavailable" };
      const results: { query: string; outcome: "added" | "exists" | "target-off-host"; keywordId: string | null }[] = [];
      // One function call per query, in order: each is its own decision with its own event.
      for (const entry of entries) {
        const outcome = await store.add({ projectId, ...entry, operatorId });
        if (outcome.status === "project-not-found") return { status: "project-not-found" };
        if (outcome.status === "target-off-host") results.push({ query: entry.query, outcome: "target-off-host", keywordId: null });
        else results.push({ query: entry.query, outcome: outcome.status, keywordId: outcome.keyword.id });
      }
      return { status: "recorded", results };
    },

    async readKeyword(keywordId) {
      if (!store.storesKeywords) return { status: "unavailable" };
      const keyword = await store.getById(keywordId);
      if (keyword === null) return { status: "not-found" };
      const project = await sources.projects.get(keyword.projectId);
      if (project === null || project.id !== keyword.projectId) return { status: "not-found" };

      const [events, inventory, history, tasks] = await Promise.all([
        store.listEvents(project.id, keyword.id),
        inventoryOf(project.id),
        sources.observed.history(project.id, keyword.query).then(
          (value): ObservedHistory | "not-kept" => value ?? "not-kept",
          (): "unreadable" => "unreadable",
        ),
        sources.tasks.tasksForQuery(project.id, keyword.query).catch(() => null),
      ]);
      return {
        status: "found",
        keyword,
        project,
        events: events.filter((e) => e.keywordId === keyword.id),
        observed: observedLinkFor(keyword.query, inventory),
        history,
        tasks: tasks === null ? null : tasks.filter((t) => t.projectId === project.id && t.sourceKind === "keyword" && t.sourceRef === keyword.query),
      };
    },

    async act(input) {
      if (!store.storesKeywords) return { status: "unavailable" };
      return store.act(input);
    },
  };
}
