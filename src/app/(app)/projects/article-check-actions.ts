"use server";

import { revalidatePath } from "next/cache";
import { getOperator } from "@/lib/auth/session";
import { articleCheckService } from "@/lib/content/articles/checks";
import type { CarryUnitResult, FreshUnitResult, RecordUnitResult } from "@/lib/content/articles/checks/service";
import { appRateLimiter } from "@/lib/security/app-rate-limit";

/**
 * Records one Research & Evidence run's outcome on one article check unit
 * (Stage 5, milestone C4).
 *
 * The same shape as the draft fact-check record: a Server Action is
 * reachable by a direct POST, so the caller must be an operator, confirmed
 * with the Auth server, before the service or its credentials are touched;
 * every argument is `unknown`; and the service decides from its own records.
 * The browser names the project, the article, the version number, the unit
 * index and the run — never a unit text, a hash, a version row id, a status
 * or a result. The operator and the time are the server's.
 *
 * Writes are limited per operator: one check record at a time per process,
 * and counted in Postgres on the database deployment.
 *
 * This records an article fact-check result only. It approves nothing,
 * proposes nothing and publishes nothing.
 */

export type RecordArticleCheckUnitActionResult =
  | RecordUnitResult
  | { readonly ok: false; readonly reason: "unauthorized" }
  | { readonly ok: false; readonly reason: "rate-limited"; readonly retryAfterSeconds: number };

const RECORDS = { limit: 120, windowSeconds: 10 * 60 } as const;
const inFlight = new Set<string>();

export async function recordArticleCheckUnit(
  projectId: unknown,
  articleId: unknown,
  articleVersion: unknown,
  unitIndex: unknown,
  runId: unknown,
): Promise<RecordArticleCheckUnitActionResult> {
  const operator = await getOperator();
  if (!operator) return { ok: false, reason: "unauthorized" };
  if (
    typeof projectId !== "string" ||
    typeof articleId !== "string" ||
    typeof articleVersion !== "number" ||
    typeof unitIndex !== "number" ||
    typeof runId !== "string"
  ) {
    return { ok: false, reason: "invalid" };
  }

  if (inFlight.has(operator.id)) return { ok: false, reason: "rate-limited", retryAfterSeconds: 1 };

  inFlight.add(operator.id);
  let result: RecordUnitResult;
  try {
    const allowance = await appRateLimiter("articles.check-record", RECORDS).consume(operator.id);
    if (!allowance.allowed) {
      return { ok: false, reason: "rate-limited", retryAfterSeconds: Math.max(1, Math.ceil(allowance.retryAfterMs / 1_000)) };
    }
    result = await articleCheckService().record({ projectId, articleId, articleVersion, unitIndex, runId, operatorId: operator.id });
  } catch (error) {
    // The detail stays in the server log; the browser learns only that it failed.
    console.error("recordArticleCheckUnit:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
    return { ok: false, reason: "failed" };
  } finally {
    inFlight.delete(operator.id);
  }

  if (result.ok && result.recorded) revalidatePath(`/projects/${projectId}`);
  return result;
}

/**
 * Fix F8: carries an earlier pass of the identical unit onto the current
 * version (no run, no model call), or clears a carried unit so a fresh run
 * may check it. Same gate as the record: operator, argument types, one write
 * in flight, the shared per-operator limit; the service decides the source,
 * the hashes and the evidence, and the database re-checks every rule. A fresh
 * check needs the explicit confirmation the screen asks for (`confirm: true`).
 */

type CarryActionGate = { readonly ok: false; readonly reason: "unauthorized" | "invalid" | "failed" } | { readonly ok: false; readonly reason: "rate-limited"; readonly retryAfterSeconds: number };

export type CarryArticleCheckUnitActionResult = CarryUnitResult | CarryActionGate;
export type FreshArticleCheckUnitActionResult = FreshUnitResult | CarryActionGate;

async function gated<T>(
  name: string,
  args: { readonly projectId: unknown; readonly articleId: unknown; readonly articleVersion: unknown; readonly unitIndex: unknown },
  call: (request: { projectId: string; articleId: string; articleVersion: number; unitIndex: number; operatorId: string }) => Promise<T>,
): Promise<T | CarryActionGate> {
  const operator = await getOperator();
  if (!operator) return { ok: false, reason: "unauthorized" };
  const { projectId, articleId, articleVersion, unitIndex } = args;
  if (typeof projectId !== "string" || typeof articleId !== "string" || typeof articleVersion !== "number" || typeof unitIndex !== "number") {
    return { ok: false, reason: "invalid" };
  }
  if (inFlight.has(operator.id)) return { ok: false, reason: "rate-limited", retryAfterSeconds: 1 };
  inFlight.add(operator.id);
  try {
    const allowance = await appRateLimiter("articles.check-record", RECORDS).consume(operator.id);
    if (!allowance.allowed) {
      return { ok: false, reason: "rate-limited", retryAfterSeconds: Math.max(1, Math.ceil(allowance.retryAfterMs / 1_000)) };
    }
    return await call({ projectId, articleId, articleVersion, unitIndex, operatorId: operator.id });
  } catch (error) {
    console.error(`${name}:`, error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
    return { ok: false, reason: "failed" };
  } finally {
    inFlight.delete(operator.id);
  }
}

export async function carryArticleCheckUnit(
  projectId: unknown,
  articleId: unknown,
  articleVersion: unknown,
  unitIndex: unknown,
): Promise<CarryArticleCheckUnitActionResult> {
  const result = await gated("carryArticleCheckUnit", { projectId, articleId, articleVersion, unitIndex }, (request) => articleCheckService().carry(request));
  if (result.ok) revalidatePath(`/projects/${String(projectId)}`);
  return result;
}

export async function freshArticleCheckUnit(
  projectId: unknown,
  articleId: unknown,
  articleVersion: unknown,
  unitIndex: unknown,
  confirm: unknown,
): Promise<FreshArticleCheckUnitActionResult> {
  const result = await gated("freshArticleCheckUnit", { projectId, articleId, articleVersion, unitIndex }, async (request): Promise<FreshUnitResult> =>
    confirm === true ? articleCheckService().fresh(request) : { ok: false, reason: "invalid" },
  );
  if (result.ok) revalidatePath(`/projects/${String(projectId)}`);
  return result;
}
