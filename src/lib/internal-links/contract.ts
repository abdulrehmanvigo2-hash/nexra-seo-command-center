import type { LinkSuggestion, PagePhrase, SuggestPage } from "@/lib/internal-links/suggest";

/**
 * The internal-links read and write (M8, PR 5). Client-safe: the answer shapes, the request check and the words. The
 * read is the newest own-site crawl's suggestions, computed on read by fixed rules; the write records one suggestion as
 * a task. Nothing here edits a page or calls a model.
 */

export const SUGGESTIONS_NOTE = "Fixed rules over the newest crawl: a phrase that names one page, found in another page's text where no link exists yet. A phrase match, not a judgement.";
export const NO_TEXT_NOTE = "This crawl kept no page text, so there is nothing to match. Run an own-site crawl after M8 is set up.";

/** The pages an editor matches against: what the crawl declared, without the kept text. */
export type LinkTargetPage = Omit<SuggestPage, "text">;

export type InternalLinksView =
  | { readonly status: "none" }
  | {
      readonly status: "read";
      readonly crawl: { readonly id: string; readonly startedAt: string };
      readonly banner: string;
      /** Pages with kept text, of the fetched pages. */
      readonly textPages: number;
      readonly fetchedPages: number;
      /** `not-readable` when the kept text could not be read (the migration not applied, among others). */
      readonly texts: "read" | "not-kept" | "not-readable";
      readonly suggestions: readonly LinkSuggestion[];
      readonly targets: readonly LinkTargetPage[];
      readonly phrases: readonly PagePhrase[];
      /** Whether the live-article and curated-keyword phrases were read; false means only h1s and titles were used. */
      readonly phrasesRead: { readonly liveArticles: boolean; readonly curatedKeywords: boolean };
    };

export function internalLinksUrl(projectId: string): string {
  return `/api/internal-links?${new URLSearchParams({ project: projectId }).toString()}`;
}

export type TaskRequest = { readonly projectId: string; readonly crawlId: string; readonly fromUrl: string; readonly toUrl: string; readonly anchor: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseTaskRequest(body: unknown): { readonly ok: true; readonly value: TaskRequest } | { readonly ok: false; readonly error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "bad-request" };
  const fields = body as Record<string, unknown>;
  const extra = Object.keys(fields).filter((key) => !["project", "crawl", "from", "to", "anchor"].includes(key));
  if (extra.length > 0) return { ok: false, error: "bad-request" };
  const { project, crawl, from, to, anchor } = fields;
  const url = (value: unknown) => typeof value === "string" && value.length <= 2048 && /^https?:\/\/[^\s]+$/.test(value);
  if (typeof project !== "string" || !PROJECT.test(project) || project.length > 64) return { ok: false, error: "bad-request" };
  if (typeof crawl !== "string" || !UUID.test(crawl) || !url(from) || !url(to)) return { ok: false, error: "bad-request" };
  if (typeof anchor !== "string" || anchor.trim() === "" || anchor.trim().length > 200) return { ok: false, error: "bad-request" };
  return { ok: true, value: { projectId: project, crawlId: crawl.toLowerCase(), fromUrl: from as string, toUrl: to as string, anchor: anchor.trim() } };
}

export function taskOutcome(httpStatus: number, body: unknown): { readonly text: string; readonly tone: "neutral" | "warning" } {
  if (httpStatus >= 200 && httpStatus < 300) return { text: "Recorded as a backlog task for On-Page SEO. No page was changed.", tone: "neutral" };
  const error = (body as { error?: unknown } | null)?.error;
  switch (error) {
    case "not-set-up":
      return { text: "Not set up yet: the M8 migration is not applied on this deployment.", tone: "warning" };
    case "crawl-not-found":
      return { text: "That crawl is not this project's own-site crawl; nothing was recorded.", tone: "warning" };
    case "page-not-found":
      return { text: "One of the pages was not fetched by that crawl; nothing was recorded.", tone: "warning" };
    case "rate-limited":
      return { text: "Too many writes just now; try again in a few minutes.", tone: "warning" };
    default:
      return { text: httpStatus === 0 ? "The request could not be sent. Check your connection." : "The request was refused; nothing was recorded.", tone: "warning" };
  }
}

/** The confirmation *Record as task* opens: what is recorded, and that nothing is edited. */
export function taskConfirmation(suggestion: { readonly fromPath: string; readonly toPath: string; readonly anchor: string }, projectId: string): {
  readonly title: string;
  readonly facts: readonly { readonly label: string; readonly value: string }[];
  readonly consequence: string;
  readonly confirmLabel: string;
  readonly dismissLabel: string;
  readonly usage: null;
  readonly tone: "primary";
} {
  return {
    title: "Record this link as a task?",
    facts: [
      { label: "From", value: suggestion.fromPath },
      { label: "To", value: suggestion.toPath },
      { label: "Anchor", value: suggestion.anchor },
      { label: "Project", value: projectId },
    ],
    consequence: "This records one backlog task for On-Page SEO to add the link. It edits no page, calls no model and costs nothing. The task stays in the Project Manager's live tasks.",
    confirmLabel: "Record task",
    dismissLabel: "Go back",
    usage: null,
    tone: "primary",
  };
}
