"use server";

import { revalidatePath } from "next/cache";
import { getOperator } from "@/lib/auth/session";
import { articleApprovalService } from "@/lib/content/articles/approvals";
import type { ApproveArticleResult } from "@/lib/content/articles/approvals/service";
import { appRateLimiter } from "@/lib/security/app-rate-limit";

/**
 * Approves one exact article version (Stage 5, milestone C5).
 *
 * The same shape as every write here: a Server Action is reachable by a
 * direct POST, so the caller must be an operator, confirmed with the Auth
 * server, before the service or its credentials are touched; every
 * argument is `unknown`; and the service decides from its own records. The
 * browser names the project, the article and the version number it saw —
 * never a hash, a version row id, a unit, a status or an operator. The
 * operator and the time are the server's and the database's.
 *
 * Writes are limited per operator: one approval at a time per process, and
 * counted in Postgres on the database deployment.
 *
 * Approval only. It proposes nothing and publishes nothing.
 */

export type ApproveArticleVersionActionResult =
  | ApproveArticleResult
  | { readonly ok: false; readonly reason: "unauthorized" }
  | { readonly ok: false; readonly reason: "rate-limited"; readonly retryAfterSeconds: number };

const APPROVALS = { limit: 30, windowSeconds: 10 * 60 } as const;
const inFlight = new Set<string>();

export async function approveArticleVersion(projectId: unknown, articleId: unknown, articleVersion: unknown): Promise<ApproveArticleVersionActionResult> {
  const operator = await getOperator();
  if (!operator) return { ok: false, reason: "unauthorized" };
  if (typeof projectId !== "string" || typeof articleId !== "string" || typeof articleVersion !== "number") {
    return { ok: false, reason: "invalid" };
  }

  if (inFlight.has(operator.id)) return { ok: false, reason: "rate-limited", retryAfterSeconds: 1 };

  inFlight.add(operator.id);
  let result: ApproveArticleResult;
  try {
    const allowance = await appRateLimiter("articles.approve", APPROVALS).consume(operator.id);
    if (!allowance.allowed) {
      return { ok: false, reason: "rate-limited", retryAfterSeconds: Math.max(1, Math.ceil(allowance.retryAfterMs / 1_000)) };
    }
    result = await articleApprovalService().approve({ projectId, articleId, articleVersion, operatorId: operator.id });
  } catch (error) {
    // The detail stays in the server log; the browser learns only that it failed.
    console.error("approveArticleVersion:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
    return { ok: false, reason: "failed" };
  } finally {
    inFlight.delete(operator.id);
  }

  if (result.ok && result.approved) revalidatePath(`/projects/${projectId}`);
  return result;
}
