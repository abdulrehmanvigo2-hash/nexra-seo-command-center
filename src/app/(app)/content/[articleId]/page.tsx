import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleDetailView } from "@/components/content/observed-content";
import { getOperator } from "@/lib/auth/session";
import { articleService } from "@/lib/content/articles";
import { isArticleId } from "@/lib/content/studio";
import { isStorableProjectId } from "@/lib/projects/intake-rules";
import { projectRepository } from "@/lib/projects/repository";
import { projectOptionsFrom } from "@/lib/projects/selection";

type PageParams = {
  params: Promise<{ articleId: string }>;
  searchParams: Promise<{ project?: string | string[] }>;
};

export const metadata: Metadata = {
  title: "Article · Content Studio",
  description: "One stored article: its versions and source drafts, the current version's check units, and its approval and proposal state. Read only.",
};

/**
 * One stored article, keyed by its id (Phase 5, checkpoint 5.2, decision Q2),
 * replaced in place.
 *
 * Rendered on the server for every request — nothing is prerendered. The id
 * must be a uuid (a fixture content id is not, and is not found), the
 * operator is checked, and the article must be one a stored project holds:
 * the `?project=` one first, then the rest of the roster, each through the
 * article service's own project-scoped read. An unknown id is not found. The
 * page's client section reads the article and its checks, approval and
 * proposal state through the existing gated routes; nothing here writes.
 */
export default async function ArticleDetailPage({ params, searchParams }: PageParams) {
  const { articleId: raw } = await params;
  const articleId = decodeURIComponent(raw);
  if (!isArticleId(articleId)) notFound();

  const operator = await getOperator();
  if (!operator) notFound();

  const wanted = (await searchParams).project;
  const roster = projectOptionsFrom(await projectRepository.listProjects());
  const ordered =
    typeof wanted === "string" && isStorableProjectId(wanted) ? [...roster.filter((p) => p.id === wanted), ...roster.filter((p) => p.id !== wanted)] : [...roster];

  for (const project of ordered) {
    const workspace = await articleService().getWorkspace(project.id);
    if (!workspace.ok) continue;
    if (!workspace.workspace.articles.some((history) => history.article.id === articleId)) continue;
    return <ArticleDetailView projectId={project.id} projectName={project.name} articleId={articleId} />;
  }
  notFound();
}
