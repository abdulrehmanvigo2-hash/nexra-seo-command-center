import "server-only";

import { unavailableArticleProposalStore } from "@/lib/content/articles/proposals/contract";
import type { ArticleProposalsDatabase } from "@/lib/content/articles/proposals/supabase/schema";
import { createSupabaseArticleProposalStore } from "@/lib/content/articles/proposals/supabase/store";
import { destinationsForProject } from "@/lib/content/publications/destinations";
import { crawlService } from "@/lib/crawl";
import { OVERVIEW_LINK_LIMIT } from "@/lib/crawl/overview/contract";
import { coverageBanner } from "@/lib/crawl/overview/present";
import type { InternalLinksView, TaskRequest } from "@/lib/internal-links/contract";
import { pathOf, suggestSiteLinks, type PagePhrase, type SuggestPage } from "@/lib/internal-links/suggest";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The internal-links read and write (M8, PR 5), server-side. The read takes the newest own-site crawl (the overview's
 * own rule), its pages, its recorded internal edges and its kept text, plus the phrases that name a page — live
 * article keywords and tracked curated keywords with a target page — and computes the suggestions on read. A phrase
 * source that cannot be read is said, and only h1s and titles are used. The write is the one database function.
 */

async function phrasesFor(projectId: string): Promise<{ readonly phrases: PagePhrase[]; readonly liveArticles: boolean; readonly curatedKeywords: boolean }> {
  const phrases: PagePhrase[] = [];
  let liveArticles = false;
  let curatedKeywords = false;
  const inSupabase = selectProjectDataSource(process.env) === "supabase";
  const config = inSupabase ? readSupabaseServerConfig(process.env) : null;
  const proposals = config ? createSupabaseArticleProposalStore(createSupabaseServerClient<ArticleProposalsDatabase>(config)) : unavailableArticleProposalStore;
  const destination = destinationsForProject(projectId)[0]?.key;
  if (destination !== undefined) {
    try {
      for (const live of await proposals.listLiveArticles(destination)) {
        for (const keyword of live.keywords ?? []) phrases.push({ path: `/blog/${live.slug}`, phrase: keyword, source: "live-article-keyword" });
      }
      liveArticles = true;
    } catch {
      liveArticles = false;
    }
  }
  try {
    const { keywordService } = await import("@/lib/keywords");
    const listed = await keywordService().listKeywords(projectId, "tracked");
    if (listed.status === "listed") {
      for (const row of listed.keywords) {
        if (row.keyword.targetPage !== null) phrases.push({ path: pathOf(row.keyword.targetPage), phrase: row.keyword.query, source: "curated-keyword" });
      }
      curatedKeywords = true;
    }
  } catch {
    curatedKeywords = false;
  }
  return { phrases, liveArticles, curatedKeywords };
}

export async function readInternalLinks(projectId: string): Promise<{ readonly status: "unavailable" } | InternalLinksView> {
  const service = crawlService();
  const overview = await service.getLatestCrawlOverview(projectId);
  if (overview.status === "unavailable") return { status: "unavailable" };
  if (overview.status === "none") return { status: "none" };
  const [links, texts, phrases] = await Promise.all([service.listCrawlLinks(overview.crawl.id, OVERVIEW_LINK_LIMIT), service.listPageTexts(overview.crawl.id, 500), phrasesFor(projectId)]);
  const textByUrl = new Map(texts.status === "read" ? texts.texts.map((entry) => [entry.url, entry.text]) : []);
  const fetched = overview.pages.filter((page) => page.fetchState === "fetched");
  const pages: SuggestPage[] = fetched.map((page) => ({
    url: page.url,
    title: page.title,
    firstH1: page.firstH1,
    ok: page.httpStatus === 200,
    noindex: page.robotsNoindex,
    inbound: page.internalLinksIn,
    text: textByUrl.get(page.url) ?? null,
  }));
  const edges = links.filter((link) => link.isInternal).map((link) => ({ from: link.fromUrl, to: link.toUrl }));
  return {
    status: "read",
    crawl: { id: overview.crawl.id, startedAt: overview.crawl.startedAt },
    banner: coverageBanner(overview.crawl, overview.pages, overview.links),
    textPages: pages.filter((page) => page.text !== null).length,
    fetchedPages: pages.length,
    texts: texts.status,
    suggestions: suggestSiteLinks({ pages, edges, phrases: phrases.phrases }),
    targets: pages.map((page) => ({ url: page.url, title: page.title, firstH1: page.firstH1, ok: page.ok, noindex: page.noindex, inbound: page.inbound })),
    phrases: phrases.phrases,
    phrasesRead: { liveArticles: phrases.liveArticles, curatedKeywords: phrases.curatedKeywords },
  };
}

export type TaskWriteResult =
  | { readonly status: "not-set-up" }
  | { readonly status: "created"; readonly taskId: string }
  | { readonly status: "project-not-found" | "crawl-not-found" | "page-not-found" | "same-page" | "invalid" };

export async function recordSuggestionTask(request: TaskRequest, operatorId: string): Promise<TaskWriteResult> {
  if (selectProjectDataSource(process.env) !== "supabase") return { status: "not-set-up" };
  const config = readSupabaseServerConfig(process.env);
  const client = createSupabaseServerClient(config);
  const { data, error } = await client.rpc("nexra_link_suggestion_task_create" as never, {
    p_project_id: request.projectId,
    p_crawl_id: request.crawlId,
    p_from_url: request.fromUrl,
    p_to_url: request.toUrl,
    p_anchor: request.anchor,
    p_created_by: operatorId,
  } as never);
  if (error) {
    // A function the database does not have yet: the migration is not applied.
    if (error.code === "PGRST202" || error.code === "42883") return { status: "not-set-up" };
    throw new Error(`record link suggestion task: ${error.code ?? "unknown"}`);
  }
  const answer = data as { outcome?: unknown; task?: { id?: unknown } } | null;
  switch (answer?.outcome) {
    case "created":
      return typeof answer.task?.id === "string" ? { status: "created", taskId: answer.task.id } : { status: "invalid" };
    case "project-not-found":
    case "crawl-not-found":
    case "page-not-found":
    case "same-page":
    case "invalid":
      return { status: answer.outcome };
    default:
      throw new Error("record link suggestion task: unexpected answer");
  }
}
