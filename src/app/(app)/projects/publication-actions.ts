"use server";

import { revalidatePath } from "next/cache";
import { getOperator } from "@/lib/auth/session";
import { publicationService } from "@/lib/content/publications";
import type { ProposeResult, WithdrawResult } from "@/lib/content/publications/service";
import { appRateLimiter } from "@/lib/security/app-rate-limit";

/**
 * Prepares and withdraws publication proposals.
 *
 * The same shape as the draft writes: a Server Action is reachable by a
 * direct POST, so the caller must be an operator, confirmed with the Auth
 * server, before the service or its credentials are touched; every argument
 * is treated as `unknown`; and the service decides from its own records.
 * The approval, the text, the content hash that is stored and the operator
 * are the server's: the browser only names the draft, the version it was
 * shown, the destination key, the slug, and the hash it was shown, which is
 * compared and never stored. Next.js refuses a Server Action whose Origin
 * is not this site's host, which is the same-origin protection every other
 * write here relies on.
 *
 * Writes are limited per operator: one proposal write at a time per
 * process, and counted in Postgres on the database deployment.
 *
 * Neither action publishes, contacts GitHub or any repository, creates a
 * file, branch, commit or pull request, or deploys anything.
 */

type Limited =
  /** Not signed in as an operator; nothing was read or written. */
  | { readonly ok: false; readonly reason: "unauthorized" }
  | { readonly ok: false; readonly reason: "rate-limited"; readonly retryAfterSeconds: number };

export type PreparePublicationProposalActionResult = ProposeResult | Limited;
export type WithdrawPublicationProposalActionResult = WithdrawResult | Limited;

const PROPOSALS = { limit: 10, windowSeconds: 10 * 60 } as const;
const WITHDRAWALS = { limit: 20, windowSeconds: 10 * 60 } as const;
const inFlight = new Set<string>();

export async function preparePublicationProposal(
  projectId: unknown,
  draftId: unknown,
  version: unknown,
  destination: unknown,
  slug: unknown,
  expectedContentSha256: unknown,
): Promise<PreparePublicationProposalActionResult> {
  const operator = await getOperator();
  if (!operator) return { ok: false, reason: "unauthorized" };
  if (
    typeof projectId !== "string" ||
    typeof draftId !== "string" ||
    typeof version !== "number" ||
    typeof destination !== "string" ||
    typeof slug !== "string" ||
    typeof expectedContentSha256 !== "string"
  ) {
    return { ok: false, reason: "invalid" };
  }

  if (inFlight.has(operator.id)) return { ok: false, reason: "rate-limited", retryAfterSeconds: 1 };

  inFlight.add(operator.id);
  let result: ProposeResult;
  try {
    const allowance = await appRateLimiter("publications.propose", PROPOSALS).consume(operator.id);
    if (!allowance.allowed) {
      return { ok: false, reason: "rate-limited", retryAfterSeconds: Math.max(1, Math.ceil(allowance.retryAfterMs / 1_000)) };
    }
    result = await publicationService().propose({
      projectId,
      draftId,
      version,
      destination,
      slug,
      expectedContentSha256,
      operatorId: operator.id,
    });
  } catch (error) {
    // The detail stays in the server log; the browser learns only that it failed.
    console.error("preparePublicationProposal:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
    return { ok: false, reason: "failed" };
  } finally {
    inFlight.delete(operator.id);
  }

  if (result.ok && result.created) revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function withdrawPublicationProposal(
  projectId: unknown,
  draftId: unknown,
  proposalId: unknown,
): Promise<WithdrawPublicationProposalActionResult> {
  const operator = await getOperator();
  if (!operator) return { ok: false, reason: "unauthorized" };
  if (typeof projectId !== "string" || typeof draftId !== "string" || typeof proposalId !== "string") {
    return { ok: false, reason: "invalid" };
  }

  if (inFlight.has(operator.id)) return { ok: false, reason: "rate-limited", retryAfterSeconds: 1 };

  inFlight.add(operator.id);
  let result: WithdrawResult;
  try {
    const allowance = await appRateLimiter("publications.withdraw", WITHDRAWALS).consume(operator.id);
    if (!allowance.allowed) {
      return { ok: false, reason: "rate-limited", retryAfterSeconds: Math.max(1, Math.ceil(allowance.retryAfterMs / 1_000)) };
    }
    result = await publicationService().withdraw({ projectId, draftId, proposalId, operatorId: operator.id });
  } catch (error) {
    console.error("withdrawPublicationProposal:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
    return { ok: false, reason: "failed" };
  } finally {
    inFlight.delete(operator.id);
  }

  if (result.ok && result.withdrawn) revalidatePath(`/projects/${projectId}`);
  return result;
}
