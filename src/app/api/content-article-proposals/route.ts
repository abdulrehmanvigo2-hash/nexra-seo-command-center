import type { NextRequest } from "next/server";
import { errorResponse, json } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { articleProposalService } from "@/lib/content/articles/proposals";
import { articleProposalStateRequest } from "@/lib/content/articles/proposals/requests";

/**
 * Article publication proposals, read side (Stage 5, milestone C6).
 *
 *   GET /api/content-article-proposals?project=<id>&article=<uuid>[&destination=<key>]
 *     → { proposal: { eligibility, preview, activeProposal, history, … } }
 *
 * The current version's proposal state — its eligibility under the rule in
 * `lib/content/articles/proposals/eligibility`, with every blocking reason
 * and the D2 warning, the read-only preview and its SHA-256 when eligible,
 * the active proposal and whether it is still current, and the article's
 * immutable proposal history. Reads, never writes: nothing here can record,
 * withdraw, approve or publish anything, and a proposal is not a
 * publication. Operators only, private, uncached. A failed read is `failed`
 * or `unavailable`, never an empty history. The order of checks is in
 * `lib/content/articles/proposals/requests`. Recording and withdrawing go
 * through the Server Actions in `app/(app)/projects/article-proposal-actions`.
 */

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const response = await articleProposalStateRequest(
    { operator: await getOperator(), service: articleProposalService, log: (message) => console.error(message) },
    { project: params.get("project"), article: params.get("article"), destination: params.get("destination") },
  );
  return response.status === 200 ? json(response.body) : errorResponse(response.error, response.status);
}
