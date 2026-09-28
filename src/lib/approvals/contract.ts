import { createHash } from "node:crypto";

/**
 * Approval records (Phase 6, checkpoint 6.8, decision Q1 of the 6.1 note;
 * migration 20261009120000): an operator's decision — approve or refuse — on
 * one exact external action, recorded before the action and consumed once by
 * it. C7 only: the run-claim gate is unchanged and no agent task is
 * approval-required. There is no consumer yet; C7 (checkpoint 6.11) will be
 * the first, and it will call `consume` immediately before its one external
 * write, with the digest of the exact payload it is about to send.
 *
 * The database decides every outcome; this module names them, parses the
 * functions' answers fail-closed (an answer this product does not know is an
 * error, never a pass) and computes the payload digest the same way on both
 * sides of the approval.
 */

export const APPROVAL_ACTION_KINDS = ["article-publication"] as const;
export type ApprovalActionKind = (typeof APPROVAL_ACTION_KINDS)[number];

export const APPROVAL_DECISIONS = ["approve", "refuse"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** The lifetime bounds the database enforces, in minutes. */
export const APPROVAL_TTL_MIN_MINUTES = 1;
export const APPROVAL_TTL_MAX_MINUTES = 1440;

export type ApprovalRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly actionKind: ApprovalActionKind;
  readonly targetId: string;
  readonly payloadSha256: string;
  readonly decision: ApprovalDecision;
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly expiresAt: string;
  readonly usedAt: string | null;
  readonly usedBy: string | null;
};

export type RecordApprovalInput = {
  readonly projectId: string;
  readonly actionKind: ApprovalActionKind;
  readonly targetId: string;
  readonly payloadSha256: string;
  readonly decision: ApprovalDecision;
  readonly operatorId: string;
  readonly ttlMinutes: number;
};

export type RecordApprovalOutcome = { readonly status: "recorded"; readonly approval: ApprovalRecord } | { readonly status: "project-not-found" };

export type ConsumeApprovalInput = {
  readonly projectId: string;
  readonly approvalId: string;
  readonly actionKind: ApprovalActionKind;
  readonly targetId: string;
  readonly payloadSha256: string;
  readonly operatorId: string;
};

/** Every refusal the consume function can answer; each writes nothing. */
export const CONSUME_REFUSALS = ["approval-not-found", "refused", "action-mismatch", "digest-mismatch", "used", "expired", "superseded"] as const;
export type ConsumeRefusal = (typeof CONSUME_REFUSALS)[number];

export type ConsumeApprovalOutcome = { readonly status: "consumed"; readonly approval: ApprovalRecord } | { readonly status: ConsumeRefusal };

export class ApprovalAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalAnswerError";
  }
}

const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The digest an approval binds: the SHA-256, lowercase hex, of the UTF-8
 * text `nexra-approval-payload/1\n<kind>\n<target id>\n` followed by the
 * exact payload text. The kind and target are inside the digest so one
 * payload approved for one target never matches another.
 */
export function approvalPayloadSha256(actionKind: ApprovalActionKind, targetId: string, payload: string): string {
  return createHash("sha256").update(`nexra-approval-payload/1\n${actionKind}\n${targetId.toLowerCase()}\n${payload}`, "utf8").digest("hex");
}

/** Whether an input the store is about to send is one the database could accept; the database checks again. */
export function isRecordApprovalInput(input: RecordApprovalInput): boolean {
  return (
    (APPROVAL_ACTION_KINDS as readonly string[]).includes(input.actionKind) &&
    (APPROVAL_DECISIONS as readonly string[]).includes(input.decision) &&
    UUID.test(input.targetId) &&
    SHA256.test(input.payloadSha256) &&
    Number.isInteger(input.ttlMinutes) &&
    input.ttlMinutes >= APPROVAL_TTL_MIN_MINUTES &&
    input.ttlMinutes <= APPROVAL_TTL_MAX_MINUTES
  );
}

function object(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ApprovalAnswerError(`${what} is not an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) throw new ApprovalAnswerError(`${what} is missing.`);
  return value;
}

function nullableText(value: unknown, what: string): string | null {
  return value === null || value === undefined ? null : text(value, what);
}

export function approvalRowToRecord(row: unknown): ApprovalRecord {
  const r = object(row, "the approval row");
  const actionKind = text(r.action_kind, "action_kind");
  const decision = text(r.decision, "decision");
  const payloadSha256 = text(r.payload_sha256, "payload_sha256");
  if (!(APPROVAL_ACTION_KINDS as readonly string[]).includes(actionKind)) throw new ApprovalAnswerError(`action_kind "${actionKind}" is not one this product knows.`);
  if (!(APPROVAL_DECISIONS as readonly string[]).includes(decision)) throw new ApprovalAnswerError(`decision "${decision}" is not one this product knows.`);
  if (!SHA256.test(payloadSha256)) throw new ApprovalAnswerError("payload_sha256 is not a SHA-256.");
  return {
    id: text(r.id, "id"),
    projectId: text(r.project_id, "project_id"),
    actionKind: actionKind as ApprovalActionKind,
    targetId: text(r.target_id, "target_id"),
    payloadSha256,
    decision: decision as ApprovalDecision,
    decidedBy: text(r.decided_by, "decided_by"),
    decidedAt: text(r.decided_at, "decided_at"),
    expiresAt: text(r.expires_at, "expires_at"),
    usedAt: nullableText(r.used_at, "used_at"),
    usedBy: nullableText(r.used_by, "used_by"),
  };
}

export function recordResultToOutcome(data: unknown): RecordApprovalOutcome {
  const result = object(data, "the function's answer");
  if (result.outcome === "recorded") return { status: "recorded", approval: approvalRowToRecord(result.approval) };
  if (result.outcome === "project-not-found") return { status: "project-not-found" };
  throw new ApprovalAnswerError(`The record function answered "${String(result.outcome)}".`);
}

/**
 * The consume answer, fail-closed: `consumed` only when the database said so
 * and the row it returns is used; any answer this product does not know is
 * an error, never a pass.
 */
export function consumeResultToOutcome(data: unknown): ConsumeApprovalOutcome {
  const result = object(data, "the function's answer");
  if (result.outcome === "consumed") {
    const approval = approvalRowToRecord(result.approval);
    if (approval.usedAt === null || approval.decision !== "approve") throw new ApprovalAnswerError("A consumed approval came back unused.");
    return { status: "consumed", approval };
  }
  if (typeof result.outcome === "string" && (CONSUME_REFUSALS as readonly string[]).includes(result.outcome)) return { status: result.outcome as ConsumeRefusal };
  throw new ApprovalAnswerError(`The consume function answered "${String(result.outcome)}".`);
}
