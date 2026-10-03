import "server-only";

import { CALENDAR_ARTICLE_LIMIT } from "@/lib/calendar/contract";
import { createCalendarService, type CalendarService } from "@/lib/calendar/service";
import { unavailableCalendarStore } from "@/lib/calendar/store-contract";
import { createSupabaseCalendarStore, type CalendarDatabase } from "@/lib/calendar/supabase/store";
import { unavailableArticleStore } from "@/lib/content/articles/contract";
import { unavailableArticleProposalStore } from "@/lib/content/articles/proposals/contract";
import type { ArticleProposalsDatabase } from "@/lib/content/articles/proposals/supabase/schema";
import { createSupabaseArticleProposalStore } from "@/lib/content/articles/proposals/supabase/store";
import type { ContentArticlesDatabase } from "@/lib/content/articles/supabase/schema";
import { createSupabaseArticleStore } from "@/lib/content/articles/supabase/store";
import { destinationsForProject } from "@/lib/content/publications/destinations";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { appRateLimiter } from "@/lib/security/app-rate-limit";
import type { AsyncRateLimiter } from "@/lib/security/shared-rate-limit";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The server's calendar service — the one place that wires it. With `PROJECTS_DATA_SOURCE=supabase` the tasks, their
 * planned dates and article links live in the task tables (migration 20261022120000; a database without it answers
 * "not set up"), and the articles, proposals and live slugs come from the article records; with the fixture roster
 * there is nothing to plan. No agent reads the calendar.
 */

let service: CalendarService | null = null;

export function calendarService(): CalendarService {
  if (service !== null) return service;
  const inSupabase = selectProjectDataSource(process.env) === "supabase";
  const config = inSupabase ? readSupabaseServerConfig(process.env) : null;
  const store = config ? createSupabaseCalendarStore(createSupabaseServerClient<CalendarDatabase>(config)) : unavailableCalendarStore;
  const articles = config ? createSupabaseArticleStore(createSupabaseServerClient<ContentArticlesDatabase>(config)) : unavailableArticleStore;
  const proposals = config ? createSupabaseArticleProposalStore(createSupabaseServerClient<ArticleProposalsDatabase>(config)) : unavailableArticleProposalStore;

  service = createCalendarService(store, {
    async articles(projectId) {
      if (!articles.storesArticles) throw new Error("calendar: this deployment keeps no articles");
      return (await articles.listForProject(projectId, CALENDAR_ARTICLE_LIMIT)).map((article) => ({ id: article.id, status: article.status, createdAt: article.createdAt }));
    },
    async activeProposalSlug(projectId, articleId) {
      const list = await proposals.listProposals(projectId, articleId);
      return list.find((proposal) => proposal.status === "proposed")?.slug ?? null;
    },
    async liveOwners(projectId) {
      const destination = destinationsForProject(projectId)[0]?.key;
      if (destination === undefined) return [];
      const live = await proposals.listLiveArticles(destination);
      return live.filter((entry) => entry.articleId !== null).map((entry) => ({ slug: entry.slug, articleId: entry.articleId as string }));
    },
  });
  return service;
}

type LimitName = "read" | "write";

/** Planning a date or linking an article is a deliberate act: sixty per operator per ten minutes, as the task actions. */
const LIMITS: Record<LimitName, { readonly limit: number; readonly windowSeconds: number }> = {
  read: { limit: 120, windowSeconds: 600 },
  write: { limit: 60, windowSeconds: 600 },
};

export function calendarLimiter(name: LimitName): AsyncRateLimiter {
  return appRateLimiter(`calendar.${name}`, LIMITS[name]);
}
