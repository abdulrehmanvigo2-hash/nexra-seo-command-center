import type { AssembledDraft } from "@/lib/briefs/assemble-article";
import { autoLinkNote, autoLinkRequest, AUTO_LINK_UNKNOWN, type HandoffNote } from "@/lib/briefs/handoff";
import type { ArticleHistory } from "@/types/content-article-record";

/**
 * OC1 — One-Click Article, PR 6b: save the written article and link it (docs/roadmap/OC1-one-click-article.md, Stage B
 * step 7; decision D2, allowed only after Gate 1).
 *
 * The same two writes *Open in editor* → *Fill the form* → *Create* makes, without the editor: the assembled draft of the
 * brief (`GET /api/briefs/draft`) is created as the article's version 1 with the brief as its plan and no source draft
 * (migration 20261030120000), then linked to the opportunity's task so its admitted evidence reaches the check. Nothing
 * is created when the draft is incomplete or does not validate — those go to the editor, as before. A second press
 * answers the article already created for the brief (one article per plan run). Calls are injected; nothing is checked,
 * approved or published here.
 */

export type DraftRead = { readonly status: number; readonly draft: AssembledDraft | null; readonly taskId: string | null };

export type CreateAnswer =
  | { readonly ok: true; readonly created: boolean; readonly history: ArticleHistory }
  | { readonly ok: false; readonly reason: string; readonly message: string };

export type SaveArticleIo = {
  readonly readDraft: () => Promise<DraftRead>;
  readonly create: (content: AssembledDraft["content"]) => Promise<CreateAnswer>;
  readonly link: (body: ReturnType<typeof autoLinkRequest>) => Promise<{ readonly status: number; readonly body: unknown }>;
};

export type SaveArticleOutcome =
  | { readonly ok: true; readonly created: boolean; readonly history: ArticleHistory; readonly link: HandoffNote | null }
  | { readonly ok: false; readonly reason: "draft-unread" | "incomplete" | "invalid" | "refused"; readonly text: string };

export async function saveArticle(io: SaveArticleIo, projectId: string): Promise<SaveArticleOutcome> {
  let read: DraftRead;
  try {
    read = await io.readDraft();
  } catch {
    return { ok: false, reason: "draft-unread", text: "The assembled draft could not be read, so nothing was saved." };
  }
  const { draft } = read;
  if (draft === null) return { ok: false, reason: "draft-unread", text: "The assembled draft could not be read, so nothing was saved." };
  if (draft.content === null) return { ok: false, reason: "incomplete", text: "Not every part is drafted yet, so nothing was saved." };
  if (draft.issues.length > 0) {
    return { ok: false, reason: "invalid", text: `The assembled draft has ${draft.issues.length} validation ${draft.issues.length === 1 ? "issue" : "issues"}, so nothing was saved. Open it in the editor to fix ${draft.issues.length === 1 ? "it" : "them"}.` };
  }

  let answer: CreateAnswer;
  try {
    answer = await io.create(draft.content);
  } catch {
    return { ok: false, reason: "refused", text: "The article could not be saved. Nothing is known to have been written." };
  }
  if (!answer.ok) return { ok: false, reason: "refused", text: answer.message };

  // Linked only when this press created it: an article already there was linked when it was made (or by the owner).
  if (!answer.created) return { ok: true, created: false, history: answer.history, link: null };
  if (read.taskId === null) return { ok: true, created: true, history: answer.history, link: AUTO_LINK_UNKNOWN };
  try {
    const linked = await io.link(autoLinkRequest(projectId, read.taskId, answer.history.article.id));
    return { ok: true, created: true, history: answer.history, link: autoLinkNote(linked.status, linked.body) };
  } catch {
    return { ok: true, created: true, history: answer.history, link: autoLinkNote(0, null) };
  }
}

/** The article already created for this brief, from the workspace's article list, or null. */
export function articleForBrief(articles: readonly ArticleHistory[], briefRunId: string): ArticleHistory | null {
  const id = briefRunId.toLowerCase();
  return articles.find((history) => history.article.sourcePlanRunId.toLowerCase() === id) ?? null;
}

/** The create action's refusal in words (the editor's own wording for the reasons a valid draft can still meet). */
export function createRefusalText(reason: string): string {
  switch (reason) {
    case "unauthorized":
      return "Your session has ended. Reload the page to sign in again.";
    case "rate-limited":
      return "Too many saves. Wait a moment and try again.";
    case "plan-run-invalid":
      return "The brief is not a completed brief of this project, so no article can be made from it.";
    case "invalid-sources":
    case "source-mismatch":
      return "The database refused the article without a source draft — its update for brief-written articles may not be applied yet.";
    case "invalid-content":
    case "content-mismatch":
      return "The article's content was refused by the validator. Open it in the editor to fix it.";
    case "unavailable":
      return "Articles are not stored on this deployment.";
    default:
      return "The article could not be saved. Nothing is known to have been written.";
  }
}
