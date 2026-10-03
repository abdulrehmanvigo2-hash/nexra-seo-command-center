import { calendarItems, type CalendarArticle } from "@/lib/calendar/calendar";
import type { CalendarView } from "@/lib/calendar/contract";
import { CalendarStoreNotSetUpError, type CalendarStore, type LinkArticleOutcome, type SetDateOutcome } from "@/lib/calendar/store-contract";

/**
 * The calendar service (M3, PR 3). A read gathers the project's tasks with their planned dates, the newest article
 * link of each, the project's articles, the active proposals and live slugs of the linked ones, and the accepted
 * opportunities' scores — and derives every item's stage (`calendar.ts`). The two writes go through the database's
 * functions. Nothing here runs an agent, changes an article or publishes anything; a database without migration
 * 20261022120000 answers "not set up", never a crash. A failed article or live read is said, never guessed.
 */

export type ArticleFacts = { readonly id: string; readonly status: CalendarArticle["status"]; readonly createdAt: string };

export type CalendarReaders = {
  /** The project's articles; throws when the read fails. */
  readonly articles: (projectId: string) => Promise<readonly ArticleFacts[]>;
  /** The slug of an article's active proposal, or null when it has none. */
  readonly activeProposalSlug: (projectId: string, articleId: string) => Promise<string | null>;
  /** The live slugs with the article each was published from; throws when the read fails. */
  readonly liveOwners: (projectId: string) => Promise<readonly { readonly slug: string; readonly articleId: string }[]>;
};

export type ReadResult = { readonly status: "not-set-up" } | { readonly status: "read"; readonly view: CalendarView };
export type SetDateResult = { readonly status: "not-set-up" } | SetDateOutcome;
export type LinkResult = { readonly status: "not-set-up" } | LinkArticleOutcome;

export type CalendarService = {
  read(projectId: string): Promise<ReadResult>;
  setDate(projectId: string, taskId: string, date: string | null, operatorId: string): Promise<SetDateResult>;
  linkArticle(projectId: string, taskId: string, articleId: string, operatorId: string): Promise<LinkResult>;
};

export function createCalendarService(store: CalendarStore, readers: CalendarReaders): CalendarService {
  async function guarded<T>(work: () => Promise<T>): Promise<T | { readonly status: "not-set-up" }> {
    if (!store.storesCalendar) return { status: "not-set-up" };
    try {
      return await work();
    } catch (error) {
      if (error instanceof CalendarStoreNotSetUpError) return { status: "not-set-up" };
      throw error;
    }
  }

  return {
    async read(projectId) {
      return (await guarded(async (): Promise<ReadResult> => {
        const tasks = await store.listTasks(projectId);
        const links = await store.listLinks(projectId);
        const opportunityIds = tasks.filter((task) => task.sourceKind === "opportunity").map((task) => task.sourceRef);
        const opportunities = await store.opportunities(projectId, opportunityIds);

        let articles: ArticleFacts[] | null;
        try {
          articles = [...(await readers.articles(projectId))];
        } catch {
          articles = null;
        }
        let liveOwners: readonly { readonly slug: string; readonly articleId: string }[] | null;
        try {
          liveOwners = await readers.liveOwners(projectId);
        } catch {
          liveOwners = null;
        }

        // Proposals are read only for the articles a task links to: one bounded read each.
        const linked = new Set(Object.values(links));
        const proposalSlugs = new Map<string, string | null>();
        for (const article of articles ?? []) {
          if (linked.has(article.id)) proposalSlugs.set(article.id, await readers.activeProposalSlug(projectId, article.id).catch(() => null));
        }
        const calendarArticles: CalendarArticle[] | null =
          articles === null
            ? null
            : articles.map((article) => ({
                id: article.id,
                status: article.status,
                slug: liveOwners?.find((entry) => entry.articleId === article.id)?.slug ?? proposalSlugs.get(article.id) ?? null,
                title: null,
              }));
        const proposedArticleIds = [...proposalSlugs].filter(([, slug]) => slug !== null).map(([id]) => id);

        const items = calendarItems({ tasks, links, articles: calendarArticles, proposedArticleIds, liveOwners: liveOwners ?? [], opportunities });
        const linkable = (articles ?? [])
          .filter((article) => article.status !== "archived")
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((article) => {
            const slug = calendarArticles?.find((entry) => entry.id === article.id)?.slug ?? null;
            return { id: article.id, label: `${slug ?? `Article ${article.id.slice(0, 8)}`} · ${article.status}` };
          });
        return { status: "read", view: { projectId, items, articlesUnread: articles === null, liveUnread: liveOwners === null, linkable } };
      })) as ReadResult;
    },

    async setDate(projectId, taskId, date, operatorId) {
      return (await guarded(() => store.setPlanDate(projectId, taskId, date, operatorId))) as SetDateResult;
    },

    async linkArticle(projectId, taskId, articleId, operatorId) {
      return (await guarded(() => store.linkArticle(projectId, taskId, articleId, operatorId))) as LinkResult;
    },
  };
}
