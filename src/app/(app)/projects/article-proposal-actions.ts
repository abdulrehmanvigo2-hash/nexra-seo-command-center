"use server";

import { revalidatePath } from "next/cache";
import { getOperator } from "@/lib/auth/session";
import { articleProposalService } from "@/lib/content/articles/proposals";
import {
  recordArticleProposalRequest,
  withdrawArticleProposalRequest,
  type ProposalWriteDependencies,
  type RecordArticleProposalActionResult,
  type WithdrawArticleProposalActionResult,
} from "@/lib/content/articles/proposals/requests";
import { appRateLimiter } from "@/lib/security/app-rate-limit";

/**
 * Records and withdraws record-only article publication proposals (Stage 5,
 * milestone C6, Checkpoint 3).
 *
 * The same shape as every write here: a Server Action is reachable by a
 * direct POST, so the caller must be an operator, confirmed with the Auth
 * server, before the service or its credentials are touched; every
 * argument is `unknown`; and the service decides from its own records. The
 * browser names the project, the article, the version number it saw and a
 * destination key — or, to withdraw, a proposal id — and passes the
 * confirmation token its confirmation step gave. Never a version row id, a
 * hash, an approval, a slug, a preview or an operator: those are the
 * server's, and the database checks them again under its locks. The order
 * of checks is in `lib/content/articles/proposals/requests`.
 *
 * Writes are limited per operator: one at a time per process, and counted
 * in Postgres on the database deployment.
 *
 * Record-only. Nothing here approves, publishes, writes to a website or a
 * repository, or creates a pull request; withdrawal deletes nothing.
 */

export type { RecordArticleProposalActionResult, WithdrawArticleProposalActionResult };

const PROPOSALS = { limit: 30, windowSeconds: 10 * 60 } as const;
const inFlight = new Set<string>();

async function dependencies(): Promise<ProposalWriteDependencies> {
  return {
    operator: await getOperator(),
    service: articleProposalService,
    async allow(operatorId) {
      const allowance = await appRateLimiter("articles.propose", PROPOSALS).consume(operatorId);
      return allowance.allowed ? { ok: true } : { ok: false, reason: "rate-limited", retryAfterSeconds: Math.max(1, Math.ceil(allowance.retryAfterMs / 1_000)) };
    },
    inFlight,
    log: (message) => console.error(message),
  };
}

export async function recordArticleProposal(
  projectId: unknown,
  articleId: unknown,
  articleVersion: unknown,
  destination: unknown,
  confirmation: unknown,
): Promise<RecordArticleProposalActionResult> {
  const result = await recordArticleProposalRequest(await dependencies(), projectId, articleId, articleVersion, destination, confirmation);
  if (result.ok && result.recorded && typeof projectId === "string") revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function withdrawArticleProposal(projectId: unknown, articleId: unknown, proposalId: unknown, confirmation: unknown): Promise<WithdrawArticleProposalActionResult> {
  const result = await withdrawArticleProposalRequest(await dependencies(), projectId, articleId, proposalId, confirmation);
  if (result.ok && result.withdrawn && typeof projectId === "string") revalidatePath(`/projects/${projectId}`);
  return result;
}
