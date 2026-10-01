import "server-only";

import type { NextResponse } from "next/server";
import { errorResponse, json } from "@/lib/agent-runs/http";
import { secondsUntilMidnightUtc } from "@/lib/keyword-snapshots/contract";
import type { RunResult } from "@/lib/keyword-snapshots/service";
import { describeCapRefusal } from "@/lib/providers/dataforseo/config";

/**
 * How a snapshot service answer becomes an HTTP answer. Every code is fixed
 * text; nothing from the provider or the database's error reaches the
 * caller. "Not set up" (no store, or the migration not applied) and "not
 * configured" (no credentials) are 503s the screen reads as calm states.
 */
export function runResultResponse(result: RunResult, now: Date = new Date()): NextResponse {
  switch (result.status) {
    case "finished":
      return json({ status: "finished", run: result.run, requests: result.requests }, 201);
    case "not-set-up":
      return errorResponse("not-set-up", 503);
    case "not-configured":
      return errorResponse("not-configured", 503);
    case "cap-invalid":
      return json({ error: "cap-invalid", message: describeCapRefusal(result.reason) }, 503);
    case "cap-reached": {
      const response = json(
        { error: "cap-reached", spentUsd: result.spentUsd, capUsd: result.capUsd, estimateUsd: result.estimateUsd, message: `Daily provider cap reached ($${result.spentUsd.toFixed(2)} of $${result.capUsd.toFixed(2)} used today); resets at midnight UTC.` },
        429,
      );
      response.headers.set("Retry-After", String(secondsUntilMidnightUtc(now)));
      return response;
    }
    case "run-active":
      return errorResponse("run-active", 409);
    case "project-not-found":
      return errorResponse("project-not-found", 404);
    case "run-not-found":
      return errorResponse("not-found", 404);
    case "run-not-partial":
      return errorResponse("run-not-partial", 409);
  }
}
