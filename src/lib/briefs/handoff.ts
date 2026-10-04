import type { AssembledDraft, EvidenceStatus } from "@/lib/briefs/assemble-article";
import { importText } from "@/lib/briefs/assemble-article";

/**
 * M6, PR 5: the hand-off from an assembled draft to the article editor. Pure and client-safe. *Open in editor* goes to
 * the project screen with `?importBrief=<brief run id>`; the editor reads the same assembled draft and puts its JSON in
 * the Import box, where the operator presses *Fill the form* and then Create. Nothing is saved automatically.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const IMPORT_BRIEF_PARAM = "importBrief";

export function draftUrl(projectId: string, briefRunId: string): string {
  return `/api/briefs/draft?${new URLSearchParams({ project: projectId, brief: briefRunId }).toString()}`;
}

export function editorHref(projectId: string, briefRunId: string): string {
  return `/projects/${encodeURIComponent(projectId)}?${IMPORT_BRIEF_PARAM}=${encodeURIComponent(briefRunId)}`;
}

/** The brief run id a project screen was opened with, or null. */
export function importBriefParam(search: string): string | null {
  const value = new URLSearchParams(search).get(IMPORT_BRIEF_PARAM);
  return value !== null && UUID.test(value) ? value.toLowerCase() : null;
}

export function statusCounts(draft: AssembledDraft): Readonly<Record<EvidenceStatus, number>> {
  const counts: Record<EvidenceStatus, number> = { unsupported: 0, record: 0, opinion: 0, connective: 0 };
  for (const entry of draft.evidenceMap) counts[entry.status] += 1;
  return counts;
}

export const STATUS_LABELS: Readonly<Record<EvidenceStatus, string>> = {
  unsupported: "Unsupported — check or rewrite before saving",
  record: "Rests on a record",
  opinion: "Our view — attested",
  connective: "States no fact",
};

/** Whether the draft can be opened in the editor: every part drafted and the content valid. */
export function openable(draft: AssembledDraft): boolean {
  return draft.content !== null && draft.issues.length === 0;
}

export type HandoffNote = { readonly text: string; readonly tone: "neutral" | "warning" };

/** What the editor says when it was opened from a brief, and the JSON for its Import box (null when there is none). */
export function handoff(draft: AssembledDraft | null, httpStatus: number): { readonly note: HandoffNote; readonly json: string | null } {
  if (draft === null) {
    const text = httpStatus === 404 ? "The brief is not a completed brief of this project, so nothing was filled." : httpStatus === 503 ? "Agent runs are not kept on this deployment, so nothing was filled." : "The assembled draft could not be read, so nothing was filled.";
    return { note: { text, tone: "warning" }, json: null };
  }
  if (draft.content === null) return { note: { text: "Not every part of the brief is drafted yet, so nothing was filled.", tone: "warning" }, json: null };
  if (draft.issues.length > 0) return { note: { text: `The assembled draft has ${draft.issues.length} validation ${draft.issues.length === 1 ? "issue" : "issues"} (listed on the Evidence tab), so nothing was filled.`, tone: "warning" }, json: null };
  const unsupported = statusCounts(draft).unsupported;
  const lead = `The Writer's draft of brief ${draft.briefRunId.slice(0, 8)} is in the Import box: press Fill the form, review every field, choose the plan run and sources, then Create. Nothing is saved until then.`;
  return {
    note: unsupported === 0 ? { text: lead, tone: "neutral" } : { text: `${lead} ${unsupported} ${unsupported === 1 ? "line is" : "lines are"} unsupported and still in the text — check each before saving.`, tone: "warning" },
    json: importText(draft),
  };
}
