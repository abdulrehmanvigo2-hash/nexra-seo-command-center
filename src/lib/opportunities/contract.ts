import { ACTIONS, type OpportunityAction, type OpportunityPriority, type ScoreResult, type Signal } from "@/lib/opportunities/score";

/**
 * Content opportunities (M2, PR 5): the application's view of what migration 20261021120000 keeps — the accepted
 * opportunities — beside the list scored on read, and the shapes the route reads and answers. Pure and client-safe.
 */

/** One accepted opportunity, as the table holds it. */
export type AcceptedOpportunity = {
  readonly id: string;
  readonly projectId: string;
  readonly mapId: string;
  readonly clusterId: string;
  readonly action: OpportunityAction;
  readonly findingKey: string | null;
  readonly title: string;
  readonly score: number;
  readonly rulesVersion: number;
  readonly priority: OpportunityPriority;
  readonly signals: readonly Signal[];
  readonly gscEndDate: string | null;
  readonly crawlId: string | null;
  readonly taskId: string;
  readonly acceptedBy: string;
  readonly acceptedAt: string;
};

/** The most accepted opportunities one read returns for a map. */
export const ACCEPTED_READ_LIMIT = 200;

export type OpportunitiesView =
  | { readonly projectId: string; readonly state: "no-approved-map" }
  | {
      readonly projectId: string;
      readonly state: "scored";
      readonly map: { readonly id: string; readonly approvedAt: string | null; readonly clusters: number };
      readonly result: ScoreResult;
      /** The opportunities of this map already accepted, newest first. */
      readonly accepted: readonly AcceptedOpportunity[];
    };

/** The key a scored opportunity and an accepted row share. */
export function opportunityKey(entry: { readonly clusterId: string; readonly action: OpportunityAction; readonly findingKey: string | null }): string {
  return entry.action === "fix" ? `${entry.clusterId}:fix:${entry.findingKey ?? ""}` : `${entry.clusterId}:${entry.action}`;
}

// ---------------------------------------------------------------------------
// Requests. Shape only: whether the map is approved and the opportunity exists is the server's and the database's
// decision.

const PROJECT_ID = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const CLUSTER_ID = /^[A-Za-z0-9-]{1,64}$/;
const FINDING_KEY = /^[A-Za-z0-9:._-]{1,200}$/;

export function isOpportunityProjectId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 2 && value.length <= 64 && PROJECT_ID.test(value);
}

export type AcceptRequest =
  | { readonly ok: true; readonly projectId: string; readonly clusterId: string; readonly action: OpportunityAction; readonly findingKey: string | null }
  | { readonly ok: false; readonly error: "bad-request" };

const ACCEPT_FIELDS = ["project", "clusterId", "action", "findingKey"];

/** POST /api/opportunities { project, clusterId, action, findingKey? } — a finding key for a fix only. */
export function parseAcceptRequest(body: unknown): AcceptRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "bad-request" };
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !ACCEPT_FIELDS.includes(key))) return { ok: false, error: "bad-request" };
  const { project, clusterId, action, findingKey } = fields;
  if (!isOpportunityProjectId(project)) return { ok: false, error: "bad-request" };
  if (typeof clusterId !== "string" || !CLUSTER_ID.test(clusterId)) return { ok: false, error: "bad-request" };
  const known = ACTIONS.find((candidate) => candidate === action);
  if (known === undefined) return { ok: false, error: "bad-request" };
  if (known === "fix") {
    if (typeof findingKey !== "string" || !FINDING_KEY.test(findingKey)) return { ok: false, error: "bad-request" };
    return { ok: true, projectId: project, clusterId, action: known, findingKey };
  }
  if (findingKey !== undefined && findingKey !== null) return { ok: false, error: "bad-request" };
  return { ok: true, projectId: project, clusterId, action: known, findingKey: null };
}

export function opportunitiesUrl(projectId: string): string {
  return `/api/opportunities?${new URLSearchParams({ project: projectId }).toString()}`;
}
