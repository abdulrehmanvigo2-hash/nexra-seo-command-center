import type { Confirmation } from "@/lib/agent-runs/spend-confirm";
import type { ArticleProposalStateView } from "@/lib/content/articles/proposals/service";
import { LIVE_ORIGIN, type PublishMode } from "@/lib/publishing/contract";
import { latestFor, MODE_EXPLANATION, publishOutcome, requestOutcome, type PublicationEntry } from "@/lib/publishing/presenter";
import type { ArticleApprovalState } from "@/types/content-article-approval";

/**
 * OC1 — One-Click Article, PR 7: Gate 2, *Approve & publish* (docs/roadmap/OC1-one-click-article.md, Stage C).
 *
 * Once every check unit of the current version passed, one confirmation runs the three existing steps in order, each
 * through its own route or Server Action and each re-checked by the server and the database: the C5 article approval
 * (with the owner's attestation tick when the version attests paragraphs — never ticked on their behalf), the C6
 * publication proposal to the project's registered destination, the P-L2 *Request publication* (published date chosen
 * here, no cross-link), then one *Publish* press. Steps already done are skipped, so a repeat press resumes. It stops at
 * the first refusal. `NEXRA_PUBLISH_MODE` is unchanged (decision D6): in `off` nothing is published, in `dry-run` the
 * pull request waits for the owner's merge on GitHub and *Check status* continues it, in `merge` it merges once its
 * checks are green.
 */

export const GATE2_LABEL = "Approve & publish…";

export type Gate2Snapshot = {
  readonly approval: ArticleApprovalState;
  readonly proposal: ArticleProposalStateView;
  readonly mode: PublishMode;
  readonly configured: boolean;
  readonly publications: readonly PublicationEntry[];
};

export type Gate2Step = "approve" | "propose" | "request" | "publish";

export type Gate2View =
  /** Not every unit passed (or the check is unfinished): Gate 2 is not offered. */
  | { readonly state: "not-checked" }
  /** Something a press cannot fix; the reason, for the owner to act on from the project screen. */
  | { readonly state: "blocked"; readonly reason: string }
  | { readonly state: "ready"; readonly steps: readonly Gate2Step[]; readonly needsAttestation: boolean; readonly attestedCount: number }
  /** A publication is under way: Check status presses Publish again. */
  | { readonly state: "in-progress"; readonly publicationId: string; readonly status: string; readonly pullRequestUrl: string | null }
  | { readonly state: "live"; readonly url: string };

export function liveUrl(slug: string): string {
  return `${LIVE_ORIGIN}/blog/${slug}`;
}

/** Search Console's URL inspection, where the owner presses *Request indexing* (the property is chosen there). */
export function indexingLink(url: string): string {
  return `https://search.google.com/search-console/inspect?id=${encodeURIComponent(url)}`;
}

export function gate2View(snapshot: Gate2Snapshot): Gate2View {
  const { approval, proposal } = snapshot;
  const latest = latestFor(snapshot.publications, approval.articleId);
  if (latest?.publication.status === "live") return { state: "live", url: liveUrl(latest.publication.slug) };
  if (latest !== null && (latest.publication.status === "publishing" || latest.publication.status === "pull-request-open" || latest.publication.status === "merged")) {
    return { state: "in-progress", publicationId: latest.publication.id, status: latest.publication.status, pullRequestUrl: latest.publication.pullRequestUrl };
  }

  const counts = approval.unitCounts;
  if (counts.total === 0 || counts.passed !== counts.total) return { state: "not-checked" };
  if (proposal.liveSlug !== null) return { state: "blocked", reason: `This article is already live as /blog/${proposal.liveSlug}.` };

  const steps: Gate2Step[] = [];
  if (approval.eligibility.status === "blocked") {
    return { state: "blocked", reason: `The approval rule refuses this version (${approval.eligibility.blocks.length} ${approval.eligibility.blocks.length === 1 ? "reason" : "reasons"}); see Approval on the project screen.` };
  }
  if (approval.eligibility.status === "eligible") steps.push("approve");

  if (proposal.activeProposal !== null && proposal.activeProposalCurrent === false) {
    return { state: "blocked", reason: "An older proposal of this article is still active: withdraw it on the project screen first." };
  }
  if (proposal.activeProposal === null) {
    if (proposal.destination === null) return { state: "blocked", reason: "The project has no registered website to publish to." };
    steps.push("propose");
  }
  if (!(latest !== null && latest.ready)) steps.push("request");
  steps.push("publish");
  const needsAttestation = steps.includes("approve") && approval.attestedCount > 0;
  return { state: "ready", steps, needsAttestation, attestedCount: approval.attestedCount };
}

const STEP_WORDS: Readonly<Record<Gate2Step, string>> = {
  approve: "approve this version",
  propose: "record its publication proposal",
  request: "request publication",
  publish: "press Publish",
};

export function gate2Confirmation(projectId: string, snapshot: Gate2Snapshot, steps: readonly Gate2Step[], publishedOn: string): Confirmation {
  const { approval, proposal } = snapshot;
  return {
    title: "Approve this article and publish it?",
    facts: [
      { label: "Project", value: projectId },
      { label: "Article", value: `${approval.articleId.slice(0, 8)} · version ${approval.currentVersion} · ${approval.unitCounts.passed} of ${approval.unitCounts.total} check units passed` },
      { label: "Website", value: proposal.destination === null ? "none registered" : `${proposal.destination.label} (${proposal.destination.host})` },
      { label: "Published date", value: publishedOn },
      { label: "Steps", value: steps.map((step) => STEP_WORDS[step]).join(" → ") },
      { label: "Publish mode", value: MODE_EXPLANATION[snapshot.mode] },
    ],
    consequence:
      "Runs the steps above in order, each checked again by the server and the database, and stops at the first refusal. Publish opens one pull request on the website's repository: in dry-run you merge it on GitHub, then press Check status here. No model run, no paid call.",
    confirmLabel: "Approve & publish",
    dismissLabel: "Go back",
    usage: null,
    tone: "primary",
  };
}

export type Gate2Io = {
  readonly approve: (attestationConfirmed: boolean) => Promise<{ readonly ok: boolean; readonly reason?: string }>;
  readonly readProposal: () => Promise<ArticleProposalStateView | null>;
  readonly propose: (destination: string, version: number) => Promise<{ readonly ok: boolean; readonly reason?: string }>;
  readonly request: (publishedOn: string) => Promise<{ readonly status: number; readonly body: unknown }>;
  readonly readPublications: () => Promise<readonly PublicationEntry[] | null>;
  readonly publish: (publicationId: string) => Promise<{ readonly status: number; readonly body: unknown }>;
};

export type Gate2Outcome = { readonly done: readonly Gate2Step[]; readonly text: string; readonly tone: "neutral" | "warning" | "positive" };

export async function runGate2(io: Gate2Io, snapshot: Gate2Snapshot, steps: readonly Gate2Step[], options: { attestationConfirmed: boolean; publishedOn: string }): Promise<Gate2Outcome> {
  const done: Gate2Step[] = [];
  const articleId = snapshot.approval.articleId;
  const version = snapshot.approval.currentVersion;
  const stop = (text: string): Gate2Outcome => ({ done, tone: "warning", text: `${done.length > 0 ? `Done: ${done.map((s) => STEP_WORDS[s]).join(", ")}. ` : ""}${text}` });

  try {
    if (steps.includes("approve")) {
      const answer = await io.approve(options.attestationConfirmed);
      if (!answer.ok) return stop(`The approval was refused (${answer.reason ?? "failed"}). Nothing more was done.`);
      done.push("approve");
    }
    if (steps.includes("propose")) {
      const state = await io.readProposal();
      if (state === null) return stop("The proposal state could not be read. Nothing more was done.");
      if (state.activeProposal === null) {
        if (state.destination === null || state.eligibility.status !== "eligible") return stop("The proposal is not eligible after the approval; see Publication proposal on the project screen.");
        const answer = await io.propose(state.destination.key, version);
        if (!answer.ok) return stop(`The proposal was refused (${answer.reason ?? "failed"}). Nothing more was done.`);
      }
      done.push("propose");
    }
    let publicationId: string | null = null;
    if (steps.includes("request")) {
      const answer = await io.request(options.publishedOn);
      const outcome = requestOutcome(answer.status, answer.body);
      if (outcome.approvalId === null) return stop(outcome.text);
      publicationId = (answer.body as { publication?: { id?: unknown } } | null)?.publication?.id as string;
      done.push("request");
    } else {
      const entries = await io.readPublications();
      const latest = entries === null ? null : latestFor(entries, articleId);
      if (latest === null || !latest.ready) return stop("The ready publication request could not be found. Press again to request it.");
      publicationId = latest.publication.id;
    }
    if (typeof publicationId !== "string") return stop("The request was recorded but its id was not returned; open it from the Command Center.");
    const published = await io.publish(publicationId);
    const outcome = publishOutcome(published.status, published.body);
    if (outcome.tone === "warning") return stop(outcome.text);
    done.push("publish");
    return { done, tone: outcome.tone, text: outcome.text };
  } catch {
    return stop("A request could not be sent. Check your connection; a repeat press resumes from what was recorded.");
  }
}

/** *Check status* on a publication under way: the same Publish press, which continues from its last recorded step. */
export async function checkStatus(io: Pick<Gate2Io, "publish">, publicationId: string): Promise<{ readonly text: string; readonly tone: "neutral" | "warning" | "positive" }> {
  try {
    const answer = await io.publish(publicationId);
    return publishOutcome(answer.status, answer.body);
  } catch {
    return { text: "The request could not be sent. Check your connection.", tone: "warning" };
  }
}
