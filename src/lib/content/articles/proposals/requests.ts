/**
 * The request handling behind the article proposal route and Server Actions
 * (Stage 5, milestone C6, Checkpoint 3), with its dependencies passed in —
 * the same shape as `applyCompetitorDomainsUpdate` — so the order of every
 * check can be tested without Next.js, cookies or a database.
 *
 * The order is fixed and fail-closed:
 * 1. the operator, confirmed by the caller with the Auth server; without one
 *    nothing else is touched — not the service, not a store, not a limiter;
 * 2. every argument's type (`unknown` from the browser);
 * 3. for a write, the exact confirmation token of its confirmation step;
 * 4. for a write, one at a time per operator and the rate limit;
 * 5. the service, which decides from its own records.
 *
 * The browser never supplies an operator, a version row, a hash, an
 * approval, a slug or a preview: the operator is the confirmed one, and the
 * rest is the server's. A thrown failure is logged here and reported as
 * `failed` — never as success, and never with its detail.
 *
 * There is one authorization level (CLAUDE.md §2: operator or nobody);
 * project scoping is the service's: every read and database call names the
 * project, and another project's article or proposal is `not-found`.
 *
 * Record-only. Nothing here approves, publishes, or deletes.
 */

import { RECORD_PROPOSAL_CONFIRMATION, WITHDRAW_PROPOSAL_CONFIRMATION } from "@/lib/content/articles/proposals/confirmation";
import type { ArticleProposalService, ArticleProposalStateView, RecordArticleProposalResult, WithdrawArticleProposalResult } from "@/lib/content/articles/proposals/service";

type Operator = { readonly id: string };

export type RateLimited = { readonly ok: false; readonly reason: "rate-limited"; readonly retryAfterSeconds: number };

export type RecordArticleProposalActionResult = RecordArticleProposalResult | { readonly ok: false; readonly reason: "unauthorized" | "unconfirmed" } | RateLimited;

export type WithdrawArticleProposalActionResult = WithdrawArticleProposalResult | { readonly ok: false; readonly reason: "unauthorized" | "unconfirmed" } | RateLimited;

export type ProposalWriteDependencies = {
  readonly operator: Operator | null;
  /** Called only after the operator, the arguments and the confirmation are accepted. */
  readonly service: () => ArticleProposalService;
  /** The per-operator rate limit. */
  readonly allow: (operatorId: string) => Promise<{ readonly ok: true } | RateLimited>;
  /** Operators with a write in progress in this process. */
  readonly inFlight: Set<string>;
  readonly log: (message: string) => void;
};

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
}

async function write<T>(dependencies: ProposalWriteDependencies, operator: Operator, label: string, run: (service: ArticleProposalService) => Promise<T>): Promise<T | RateLimited | { readonly ok: false; readonly reason: "failed" }> {
  if (dependencies.inFlight.has(operator.id)) return { ok: false, reason: "rate-limited", retryAfterSeconds: 1 };
  dependencies.inFlight.add(operator.id);
  try {
    const allowance = await dependencies.allow(operator.id);
    if (!allowance.ok) return allowance;
    return await run(dependencies.service());
  } catch (error) {
    // The detail stays in the server log; the browser learns only that it failed.
    dependencies.log(`${label}: ${describe(error)}`);
    return { ok: false, reason: "failed" };
  } finally {
    dependencies.inFlight.delete(operator.id);
  }
}

export async function recordArticleProposalRequest(
  dependencies: ProposalWriteDependencies,
  projectId: unknown,
  articleId: unknown,
  articleVersion: unknown,
  destination: unknown,
  confirmation: unknown,
): Promise<RecordArticleProposalActionResult> {
  const operator = dependencies.operator;
  if (!operator) return { ok: false, reason: "unauthorized" };
  if (typeof projectId !== "string" || typeof articleId !== "string" || typeof articleVersion !== "number" || typeof destination !== "string") {
    return { ok: false, reason: "invalid" };
  }
  if (confirmation !== RECORD_PROPOSAL_CONFIRMATION) return { ok: false, reason: "unconfirmed" };
  return write(dependencies, operator, "recordArticleProposal", (service) =>
    service.record({ projectId, articleId, articleVersion, destination, operatorId: operator.id }),
  );
}

export async function withdrawArticleProposalRequest(
  dependencies: ProposalWriteDependencies,
  projectId: unknown,
  articleId: unknown,
  proposalId: unknown,
  confirmation: unknown,
): Promise<WithdrawArticleProposalActionResult> {
  const operator = dependencies.operator;
  if (!operator) return { ok: false, reason: "unauthorized" };
  if (typeof projectId !== "string" || typeof articleId !== "string" || typeof proposalId !== "string") return { ok: false, reason: "invalid" };
  if (confirmation !== WITHDRAW_PROPOSAL_CONFIRMATION) return { ok: false, reason: "unconfirmed" };
  return write(dependencies, operator, "withdrawArticleProposal", (service) =>
    service.withdraw({ projectId, articleId, proposalId, operatorId: operator.id }),
  );
}

export type ProposalReadResponse = { readonly status: 200; readonly body: { readonly proposal: ArticleProposalStateView } } | { readonly status: 400 | 401 | 404 | 500 | 503; readonly error: string };

/** The GET route's answer: 401 without an operator, 400 for bad input, 404 not found, 503 unavailable, 500 failed. */
export async function articleProposalStateRequest(
  dependencies: { readonly operator: Operator | null; readonly service: () => ArticleProposalService; readonly log: (message: string) => void },
  query: { readonly project: string | null; readonly article: string | null; readonly destination: string | null },
): Promise<ProposalReadResponse> {
  if (!dependencies.operator) return { status: 401, error: "unauthorized" };
  if (query.project === null || query.article === null) return { status: 400, error: "invalid" };
  try {
    const result = await dependencies.service().getState(query.project, query.article, query.destination ?? undefined);
    if (!result.ok) {
      const status = result.reason === "invalid" ? 400 : result.reason === "unavailable" ? 503 : result.reason === "failed" ? 500 : 404;
      return { status, error: result.reason };
    }
    return { status: 200, body: { proposal: result.state } };
  } catch (error) {
    dependencies.log(`content-article-proposals read: ${describe(error)}`);
    return { status: 500, error: "failed" };
  }
}
