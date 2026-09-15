import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import type { AgentRunFailure } from "@/lib/agent-runs/service";
import { AgentRunRowError } from "@/lib/agent-runs/supabase/schema";
import { AgentRunStoreError } from "@/lib/agent-runs/supabase/store";

/**
 * What the agent-run route handlers share: how a request body is read, how a
 * service answer becomes an HTTP answer, and how a failure is logged.
 *
 * Every response is private and uncached. No response carries an exception's
 * text: the server log gets the store's own messages, which name the query and
 * the Postgres error but never the row's values; the caller gets a fixed code.
 */

export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/** The largest request body the agent-run endpoints read, in bytes. */
export const MAX_BODY_BYTES = 16_384;

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function errorResponse(error: string, status: number): NextResponse {
  return json({ error }, status);
}

/**
 * Writes come from this site's own pages only. Session cookies are SameSite=Lax,
 * so a cross-site form cannot carry them anyway; this refuses a cross-site
 * request outright instead of relying on that alone.
 */
export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return origin
    ? origin === request.nextUrl.origin
    : request.headers.get("sec-fetch-site") === "same-origin";
}

export type BodyResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly response: NextResponse };

/** A bounded JSON body, or the response refusing it. */
export async function readJsonBody(request: NextRequest): Promise<BodyResult> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    return { ok: false, response: errorResponse("unsupported-media-type", 415) };
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return { ok: false, response: errorResponse("payload-too-large", 413) };
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    return { ok: false, response: errorResponse("payload-too-large", 413) };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: errorResponse("bad-request", 400) };
  }
}

const FAILURE_STATUS: Readonly<Record<AgentRunFailure["reason"], number>> = {
  invalid: 400,
  "unknown-project": 422,
  "unknown-agent": 422,
  "unknown-task-type": 422,
  "task-not-allowed": 422,
  "not-found": 404,
  conflict: 409,
  unavailable: 503,
};

export function failureResponse(failure: AgentRunFailure): NextResponse {
  const body =
    failure.reason === "invalid"
      ? { error: failure.reason, message: failure.message }
      : failure.reason === "conflict"
        ? { error: failure.reason, status: failure.status, message: failure.message }
        : { error: failure.reason };
  return json(body, FAILURE_STATUS[failure.reason]);
}

export function logFailure(route: string, error: unknown): void {
  console.error(
    `${route}:`,
    error instanceof AgentRunStoreError || error instanceof AgentRunRowError
      ? `${error.name}: ${error.message}`
      : error instanceof Error
        ? error.name
        : "unknown error",
  );
}
