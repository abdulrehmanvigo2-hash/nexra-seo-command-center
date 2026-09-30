import type { NextRequest } from "next/server";
import { errorResponse, json, logFailure } from "@/lib/agent-runs/http";
import { readDailyUsage, supabaseRateLimitWindowReader, type RateLimitWindowsDatabase } from "@/lib/agent-runs/daily-usage";
import { getOperator } from "@/lib/auth/session";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { PROJECT_ID_PATTERN } from "@/lib/projects/intake-rules";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * Today's use of the daily agent-run caps (fix F3, audit A4-01).
 *
 *   GET /api/agent-runs/daily-usage?project=<id>
 *
 * Operators only. Read only: it SELECTs today's counter rows the caps write
 * (`daily-usage.ts`) and never consumes a hit, queues or runs anything. A
 * deployment that keeps no runs keeps no caps, and answers 503.
 */
export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const project = request.nextUrl.searchParams.get("project");
  if (project === null || project.length > 64 || !PROJECT_ID_PATTERN.test(project)) return errorResponse("invalid", 400);

  if (selectProjectDataSource(process.env) !== "supabase") return errorResponse("not-configured", 503);

  try {
    const reader = supabaseRateLimitWindowReader(createSupabaseServerClient<RateLimitWindowsDatabase>(readSupabaseServerConfig(process.env)));
    return json({ usage: await readDailyUsage(reader, project) });
  } catch (error) {
    logFailure("agent-runs daily-usage", error);
    return errorResponse("failed", 500);
  }
}
