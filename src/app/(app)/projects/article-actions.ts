"use server";

import { revalidatePath } from "next/cache";
import { getOperator } from "@/lib/auth/session";
import { articleService } from "@/lib/content/articles";
import type { CreateArticleResult, SaveArticleVersionResult } from "@/lib/content/articles/service";
import { appRateLimiter } from "@/lib/security/app-rate-limit";

/**
 * Creates articles and saves operator edits as new article versions.
 *
 * The same shape as the draft and proposal writes: a Server Action is
 * reachable by a direct POST, so the caller must be an operator, confirmed
 * with the Auth server, before the service or its credentials are touched;
 * every argument is `unknown`; and the service decides from its own records.
 * The canonical text, its hash, the source hashes that are stored and the
 * operator are the server's: the browser names the project, the plan run or
 * article, the version it started from, the content it wrote and the draft
 * versions it cites, and nothing it sends about hashes or identity is
 * trusted. Next.js refuses a Server Action whose Origin is not this site's
 * host.
 *
 * Writes are limited per operator: one article write at a time per process,
 * and counted in Postgres on the database deployment.
 *
 * Neither action fact-checks, approves, proposes or publishes anything.
 */

type Limited =
  /** Not signed in as an operator; nothing was read or written. */
  | { readonly ok: false; readonly reason: "unauthorized" }
  | { readonly ok: false; readonly reason: "rate-limited"; readonly retryAfterSeconds: number };

export type CreateArticleActionResult = CreateArticleResult | Limited;
export type SaveArticleVersionActionResult = SaveArticleVersionResult | Limited;

const CREATES = { limit: 10, windowSeconds: 10 * 60 } as const;
const SAVES = { limit: 60, windowSeconds: 10 * 60 } as const;
const inFlight = new Set<string>();

export async function createArticle(
  projectId: unknown,
  planRunId: unknown,
  content: unknown,
  sources: unknown,
): Promise<CreateArticleActionResult> {
  const operator = await getOperator();
  if (!operator) return { ok: false, reason: "unauthorized" };
  if (typeof projectId !== "string" || typeof planRunId !== "string") return { ok: false, reason: "invalid" };

  if (inFlight.has(operator.id)) return { ok: false, reason: "rate-limited", retryAfterSeconds: 1 };

  inFlight.add(operator.id);
  let result: CreateArticleResult;
  try {
    const allowance = await appRateLimiter("articles.create", CREATES).consume(operator.id);
    if (!allowance.allowed) {
      return { ok: false, reason: "rate-limited", retryAfterSeconds: Math.max(1, Math.ceil(allowance.retryAfterMs / 1_000)) };
    }
    result = await articleService().create({ projectId, planRunId, content, sources, operatorId: operator.id });
  } catch (error) {
    // The detail stays in the server log; the browser learns only that it failed.
    console.error("createArticle:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
    return { ok: false, reason: "failed" };
  } finally {
    inFlight.delete(operator.id);
  }

  if (result.ok && result.created) revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function saveArticleVersion(
  projectId: unknown,
  articleId: unknown,
  expectedVersion: unknown,
  content: unknown,
  sources: unknown,
): Promise<SaveArticleVersionActionResult> {
  const operator = await getOperator();
  if (!operator) return { ok: false, reason: "unauthorized" };
  if (typeof projectId !== "string" || typeof articleId !== "string" || typeof expectedVersion !== "number") {
    return { ok: false, reason: "invalid" };
  }

  if (inFlight.has(operator.id)) return { ok: false, reason: "rate-limited", retryAfterSeconds: 1 };

  inFlight.add(operator.id);
  let result: SaveArticleVersionResult;
  try {
    const allowance = await appRateLimiter("articles.save", SAVES).consume(operator.id);
    if (!allowance.allowed) {
      return { ok: false, reason: "rate-limited", retryAfterSeconds: Math.max(1, Math.ceil(allowance.retryAfterMs / 1_000)) };
    }
    result = await articleService().saveVersion({ projectId, articleId, expectedVersion, content, sources, operatorId: operator.id });
  } catch (error) {
    console.error("saveArticleVersion:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
    return { ok: false, reason: "failed" };
  } finally {
    inFlight.delete(operator.id);
  }

  if (result.ok) revalidatePath(`/projects/${projectId}`);
  return result;
}
