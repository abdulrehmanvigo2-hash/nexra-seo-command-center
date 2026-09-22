"use server";

import { revalidatePath } from "next/cache";
import { getOperator } from "@/lib/auth/session";
import { draftService } from "@/lib/content/drafts";
import type { ApproveVersionResult, RecordFactCheckResult, SaveVersionResult, SaveWriterRunResult } from "@/lib/content/drafts/service";
import { appRateLimiter } from "@/lib/security/app-rate-limit";

/**
 * Saves one completed Writer section draft as draft version 1.
 *
 * The only path from the browser to a draft write. A Server Action is
 * reachable by a direct POST, not only through the control, so nothing here
 * trusts its caller or its arguments: the caller must be an operator,
 * confirmed with the Auth server, before the service or its credentials are
 * touched; both arguments are treated as `unknown`; and the draft's text is
 * never taken from the request — the service re-reads the Writer run from
 * the runtime's own store and decides from that record alone.
 *
 * Saving is idempotent: the same run saved twice returns the same draft.
 * Writes are limited per operator: one at a time per process, and 30 per
 * ten minutes counted in Postgres on the database deployment. The action
 * calls no provider, queues no run, crawls nothing and publishes nothing.
 */

export type SaveWriterRunAsDraftResult =
  | SaveWriterRunResult
  /** Not signed in as an operator; nothing was read or written. */
  | { readonly ok: false; readonly reason: "unauthorized" }
  | { readonly ok: false; readonly reason: "rate-limited"; readonly retryAfterSeconds: number };

const SAVES = { limit: 30, windowSeconds: 10 * 60 } as const;
const inFlight = new Set<string>();

export async function saveWriterRunAsDraft(projectId: unknown, writerRunId: unknown): Promise<SaveWriterRunAsDraftResult> {
  const operator = await getOperator();
  if (!operator) return { ok: false, reason: "unauthorized" };
  if (typeof projectId !== "string" || typeof writerRunId !== "string") return { ok: false, reason: "invalid" };

  if (inFlight.has(operator.id)) return { ok: false, reason: "rate-limited", retryAfterSeconds: 1 };

  inFlight.add(operator.id);
  let result: SaveWriterRunResult;
  try {
    const allowance = await appRateLimiter("drafts.save", SAVES).consume(operator.id);
    if (!allowance.allowed) {
      return { ok: false, reason: "rate-limited", retryAfterSeconds: Math.max(1, Math.ceil(allowance.retryAfterMs / 1_000)) };
    }
    result = await draftService().saveWriterRun({ projectId, writerRunId, operatorId: operator.id });
  } catch (error) {
    // The detail stays in the server log; the browser learns only that it failed.
    console.error("saveWriterRunAsDraft:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
    return { ok: false, reason: "failed" };
  } finally {
    inFlight.delete(operator.id);
  }

  if (result.ok && result.created) revalidatePath(`/projects/${projectId}`);
  return result;
}

/**
 * Saves an operator's edit of a draft as its next immutable version.
 *
 * The same shape as saving the Writer's output, and the same rules: the
 * caller must be an operator, every argument is treated as `unknown`, and
 * the service decides — text bounds, ownership by project and id together,
 * the version the operator started from against the draft's current one,
 * and an unchanged edit — before the store writes version N+1 and advances
 * the pointer in one database transaction. Version 1 and every earlier
 * version are never touched. The action calls no provider, checks no fact,
 * approves nothing and publishes nothing.
 */

export type SaveDraftVersionActionResult =
  | SaveVersionResult
  | { readonly ok: false; readonly reason: "unauthorized" }
  | { readonly ok: false; readonly reason: "rate-limited"; readonly retryAfterSeconds: number };

const EDITS = { limit: 60, windowSeconds: 10 * 60 } as const;
const editsInFlight = new Set<string>();

export async function saveDraftVersion(
  projectId: unknown,
  draftId: unknown,
  expectedVersion: unknown,
  title: unknown,
  body: unknown,
): Promise<SaveDraftVersionActionResult> {
  const operator = await getOperator();
  if (!operator) return { ok: false, reason: "unauthorized" };
  if (
    typeof projectId !== "string" ||
    typeof draftId !== "string" ||
    typeof expectedVersion !== "number" ||
    typeof title !== "string" ||
    typeof body !== "string"
  ) {
    return { ok: false, reason: "invalid" };
  }

  if (editsInFlight.has(operator.id)) return { ok: false, reason: "rate-limited", retryAfterSeconds: 1 };

  editsInFlight.add(operator.id);
  let result: SaveVersionResult;
  try {
    const allowance = await appRateLimiter("drafts.edit", EDITS).consume(operator.id);
    if (!allowance.allowed) {
      return { ok: false, reason: "rate-limited", retryAfterSeconds: Math.max(1, Math.ceil(allowance.retryAfterMs / 1_000)) };
    }
    result = await draftService().saveVersion({ projectId, draftId, expectedVersion, title, body, operatorId: operator.id });
  } catch (error) {
    console.error("saveDraftVersion:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
    return { ok: false, reason: "failed" };
  } finally {
    editsInFlight.delete(operator.id);
  }

  if (result.ok && result.created) revalidatePath(`/projects/${projectId}`);
  return result;
}

/**
 * Records one completed Research & Evidence fact-check run on the exact
 * draft version it checked.
 *
 * The same shape as the two saves above: the caller must be an operator,
 * every argument is treated as `unknown`, and the service decides — the
 * draft by project and id, the version by number, the run by its own
 * metadata naming that draft and that version, the run's state and
 * provenance, and its output parsed and every tag verified — before the
 * result is written onto the version, once, with the text untouched. The
 * parent moves to `fact-checked` only for a pass of its still-current
 * version. Nothing here queues or runs an agent, approves anything, or
 * publishes anything; the run itself was queued and started through the
 * agent-run routes by the operator's own clicks.
 */

export type RecordDraftFactCheckActionResult =
  | RecordFactCheckResult
  | { readonly ok: false; readonly reason: "unauthorized" }
  | { readonly ok: false; readonly reason: "rate-limited"; readonly retryAfterSeconds: number };

const FACT_CHECKS = { limit: 30, windowSeconds: 10 * 60 } as const;
const factChecksInFlight = new Set<string>();

export async function recordDraftFactCheck(
  projectId: unknown,
  draftId: unknown,
  version: unknown,
  runId: unknown,
): Promise<RecordDraftFactCheckActionResult> {
  const operator = await getOperator();
  if (!operator) return { ok: false, reason: "unauthorized" };
  if (typeof projectId !== "string" || typeof draftId !== "string" || typeof version !== "number" || typeof runId !== "string") {
    return { ok: false, reason: "invalid" };
  }

  if (factChecksInFlight.has(operator.id)) return { ok: false, reason: "rate-limited", retryAfterSeconds: 1 };

  factChecksInFlight.add(operator.id);
  let result: RecordFactCheckResult;
  try {
    const allowance = await appRateLimiter("drafts.fact-check", FACT_CHECKS).consume(operator.id);
    if (!allowance.allowed) {
      return { ok: false, reason: "rate-limited", retryAfterSeconds: Math.max(1, Math.ceil(allowance.retryAfterMs / 1_000)) };
    }
    result = await draftService().recordFactCheck({ projectId, draftId, version, runId, operatorId: operator.id });
  } catch (error) {
    console.error("recordDraftFactCheck:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
    return { ok: false, reason: "failed" };
  } finally {
    factChecksInFlight.delete(operator.id);
  }

  if (result.ok && result.recorded) revalidatePath(`/projects/${projectId}`);
  return result;
}

/**
 * Approves one exact draft version.
 *
 * The same shape as the writes above: the caller must be an operator, every
 * argument is treated as `unknown`, and the service decides — the draft by
 * project and id, the version by number, the explicit policy over the
 * version's recorded fact-check (a pass, and only a pass), and then one
 * conditional statement that writes only while that version is still
 * current and the parent still fact-checked. The approver and the time are
 * the server's, never the browser's. Approval publishes nothing and sends
 * nothing anywhere.
 */

export type ApproveDraftVersionActionResult =
  | ApproveVersionResult
  | { readonly ok: false; readonly reason: "unauthorized" }
  | { readonly ok: false; readonly reason: "rate-limited"; readonly retryAfterSeconds: number };

const APPROVALS = { limit: 20, windowSeconds: 10 * 60 } as const;
const approvalsInFlight = new Set<string>();

export async function approveDraftVersion(
  projectId: unknown,
  draftId: unknown,
  version: unknown,
): Promise<ApproveDraftVersionActionResult> {
  const operator = await getOperator();
  if (!operator) return { ok: false, reason: "unauthorized" };
  if (typeof projectId !== "string" || typeof draftId !== "string" || typeof version !== "number") {
    return { ok: false, reason: "invalid" };
  }

  if (approvalsInFlight.has(operator.id)) return { ok: false, reason: "rate-limited", retryAfterSeconds: 1 };

  approvalsInFlight.add(operator.id);
  let result: ApproveVersionResult;
  try {
    const allowance = await appRateLimiter("drafts.approve", APPROVALS).consume(operator.id);
    if (!allowance.allowed) {
      return { ok: false, reason: "rate-limited", retryAfterSeconds: Math.max(1, Math.ceil(allowance.retryAfterMs / 1_000)) };
    }
    result = await draftService().approveVersion({ projectId, draftId, version, operatorId: operator.id });
  } catch (error) {
    console.error("approveDraftVersion:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
    return { ok: false, reason: "failed" };
  } finally {
    approvalsInFlight.delete(operator.id);
  }

  if (result.ok && result.approved) revalidatePath(`/projects/${projectId}`);
  return result;
}
