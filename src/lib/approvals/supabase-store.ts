import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  consumeResultToOutcome,
  isRecordApprovalInput,
  recordResultToOutcome,
  type ConsumeApprovalInput,
  type ConsumeApprovalOutcome,
  type RecordApprovalInput,
  type RecordApprovalOutcome,
} from "@/lib/approvals/contract";

/**
 * The approval records store over migration 20261009120000: the two database
 * functions and nothing else — no table write, no read that decides. Not
 * wired to any route yet (checkpoint 6.8); C7 (6.11) is its first consumer.
 */

export type ApprovalStore = {
  record(input: RecordApprovalInput): Promise<RecordApprovalOutcome>;
  consume(input: ConsumeApprovalInput): Promise<ConsumeApprovalOutcome>;
};

export class ApprovalStoreError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`Approval store: ${operation} failed.`);
    this.name = "ApprovalStoreError";
    this.cause = cause;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the functions are not in a generated schema
export function createSupabaseApprovalStore(client: SupabaseClient<any>): ApprovalStore {
  return {
    async record(input) {
      if (!isRecordApprovalInput(input)) throw new ApprovalStoreError("record (invalid input)", null);
      const { data, error } = await client.rpc("nexra_approval_record", {
        p_project_id: input.projectId,
        p_action_kind: input.actionKind,
        p_target_id: input.targetId,
        p_payload_sha256: input.payloadSha256,
        p_decision: input.decision,
        p_operator: input.operatorId,
        p_ttl_minutes: input.ttlMinutes,
      });
      if (error) throw new ApprovalStoreError("record", error);
      return recordResultToOutcome(data);
    },

    async consume(input) {
      const { data, error } = await client.rpc("nexra_approval_consume", {
        p_project_id: input.projectId,
        p_approval_id: input.approvalId,
        p_action_kind: input.actionKind,
        p_target_id: input.targetId,
        p_payload_sha256: input.payloadSha256,
        p_operator: input.operatorId,
      });
      if (error) throw new ApprovalStoreError("consume", error);
      return consumeResultToOutcome(data);
    },
  };
}
