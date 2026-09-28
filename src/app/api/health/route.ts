import { NextResponse } from "next/server";
import { checkHealth, type DatabaseProbe } from "@/lib/health/health";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The public health check (checkpoint 5.5, decision Q8).
 *
 *   GET /api/health → 200 { status: "ok", time, database } | 503 { status: "degraded", time, database: "unreachable" }
 *
 * Public: the proxy lets exactly this path through for GET and HEAD without a
 * session (`HEALTH_PATH` in `@/lib/auth/access`). It reads nothing it returns:
 * the probe asks the database for at most one project id and discards the
 * answer. Never cached. A light per-instance cap (120 a minute) keeps it from
 * being used to load the database; over it the answer is 429 with Retry-After.
 */

export const dynamic = "force-dynamic";

const cap = createRateLimiter({ limit: 120, windowMs: 60_000 });
const HEADERS = { "Cache-Control": "no-store" } as const;

function databaseProbe(): DatabaseProbe | null {
  if (selectProjectDataSource(process.env) !== "supabase") return null;
  return async (signal) => {
    const client = createSupabaseServerClient(readSupabaseServerConfig(process.env));
    const { error } = await client.from("projects").select("id").limit(1).abortSignal(signal);
    if (error) throw new Error("database-error");
  };
}

export async function GET() {
  const allowance = cap.consume("health");
  if (!allowance.allowed) {
    return NextResponse.json({ error: "rate-limited" }, { status: 429, headers: { ...HEADERS, "Retry-After": String(Math.max(1, Math.ceil(allowance.retryAfterMs / 1_000))) } });
  }
  let probe: DatabaseProbe | null;
  try {
    probe = databaseProbe();
  } catch {
    // A database that is selected but not configured cannot answer.
    probe = async () => {
      throw new Error("not-configured");
    };
  }
  const answer = await checkHealth({ probe });
  return NextResponse.json(answer.body, { status: answer.httpStatus, headers: HEADERS });
}
