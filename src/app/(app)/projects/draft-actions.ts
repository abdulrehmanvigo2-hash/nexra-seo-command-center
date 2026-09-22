"use server";

import { revalidatePath } from "next/cache";
import { getOperator } from "@/lib/auth/session";
import { draftService } from "@/lib/content/drafts";
import type { SaveWriterRunResult } from "@/lib/content/drafts/service";
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
