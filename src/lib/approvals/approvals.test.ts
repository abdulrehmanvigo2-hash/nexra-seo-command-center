import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import {
  APPROVAL_ACTION_KINDS,
  CONSUME_REFUSALS,
  ApprovalAnswerError,
  approvalPayloadSha256,
  consumeResultToOutcome,
  isRecordApprovalInput,
  recordResultToOutcome,
  type RecordApprovalInput,
} from "./contract.ts";
import { createSupabaseApprovalStore } from "./supabase-store.ts";

/**
 * Approval records (Phase 6, checkpoint 6.8): the contract parses the
 * database's answers fail-closed, the digest binds kind, target and payload,
 * the store calls the two functions only, and nothing consumes an approval
 * yet — the run-claim gate is unchanged.
 */

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const ROW = {
  id: "f0000000-0000-4000-8000-000000000001",
  project_id: "nexra-agency",
  action_kind: "article-publication",
  target_id: "5f229630-0000-4000-8000-000000000001",
  payload_sha256: "a".repeat(64),
  decision: "approve",
  decided_by: "00000000-0000-4000-8000-0000000000aa",
  decided_at: "2026-09-28T12:00:00Z",
  expires_at: "2026-09-28T13:00:00Z",
  used_at: null,
  used_by: null,
};

describe("the contract", () => {
  test("the digest binds kind, target and payload; lowercase hex; stable", () => {
    const d = approvalPayloadSha256("article-publication", ROW.target_id, "payload");
    assert.match(d, /^[0-9a-f]{64}$/);
    assert.equal(d, approvalPayloadSha256("article-publication", ROW.target_id.toUpperCase(), "payload"), "the target id is compared lowercase");
    assert.notEqual(d, approvalPayloadSha256("article-publication", "5f229630-0000-4000-8000-000000000002", "payload"), "another target, another digest");
    assert.notEqual(d, approvalPayloadSha256("article-publication", ROW.target_id, "payload "), "one byte of payload changes it");
  });

  test("record inputs: one kind, two decisions, a uuid target, a SHA-256, 1-1440 minutes", () => {
    const base: RecordApprovalInput = { projectId: "nexra-agency", actionKind: "article-publication", targetId: ROW.target_id, payloadSha256: ROW.payload_sha256, decision: "approve", operatorId: ROW.decided_by, ttlMinutes: 60 };
    assert.equal(isRecordApprovalInput(base), true);
    assert.deepEqual([...APPROVAL_ACTION_KINDS], ["article-publication"]);
    for (const bad of [
      { ...base, actionKind: "merge" },
      { ...base, decision: "maybe" },
      { ...base, targetId: "not-a-uuid" },
      { ...base, payloadSha256: "A".repeat(64) },
      { ...base, ttlMinutes: 0 },
      { ...base, ttlMinutes: 1441 },
      { ...base, ttlMinutes: 1.5 },
    ]) assert.equal(isRecordApprovalInput(bad as RecordApprovalInput), false, JSON.stringify(bad));
  });

  test("record answers: recorded with the row, project-not-found, anything else an error", () => {
    const recorded = recordResultToOutcome({ outcome: "recorded", approval: ROW });
    assert.equal(recorded.status, "recorded");
    assert.equal(recorded.status === "recorded" && recorded.approval.usedAt, null);
    assert.deepEqual(recordResultToOutcome({ outcome: "project-not-found" }), { status: "project-not-found" });
    assert.throws(() => recordResultToOutcome({ outcome: "approved" }), ApprovalAnswerError);
    assert.throws(() => recordResultToOutcome({ outcome: "recorded", approval: { ...ROW, action_kind: "merge" } }), ApprovalAnswerError);
  });

  test("consume answers, fail-closed: consumed only with a used approval; every refusal named; anything else an error", () => {
    const used = { ...ROW, used_at: "2026-09-28T12:30:00Z", used_by: ROW.decided_by };
    assert.equal(consumeResultToOutcome({ outcome: "consumed", approval: used }).status, "consumed");
    assert.throws(() => consumeResultToOutcome({ outcome: "consumed", approval: ROW }), ApprovalAnswerError, "a consumed approval must come back used");
    assert.throws(() => consumeResultToOutcome({ outcome: "consumed", approval: { ...used, decision: "refuse" } }), ApprovalAnswerError);
    assert.deepEqual([...CONSUME_REFUSALS], ["approval-not-found", "refused", "action-mismatch", "digest-mismatch", "used", "expired", "superseded"]);
    for (const outcome of CONSUME_REFUSALS) assert.deepEqual(consumeResultToOutcome({ outcome }), { status: outcome });
    for (const answer of [{ outcome: "ok" }, { outcome: null }, null, [], "consumed"]) assert.throws(() => consumeResultToOutcome(answer), ApprovalAnswerError, JSON.stringify(answer));
  });
});

describe("the store: the two functions, nothing else", () => {
  test("record and consume call only their functions with every argument", async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const client = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return fn === "nexra_approval_record" ? { data: { outcome: "recorded", approval: ROW }, error: null } : { data: { outcome: "digest-mismatch" }, error: null };
      },
      from: () => {
        throw new Error("no table access");
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = createSupabaseApprovalStore(client as any);
    const recorded = await store.record({ projectId: "nexra-agency", actionKind: "article-publication", targetId: ROW.target_id, payloadSha256: ROW.payload_sha256, decision: "approve", operatorId: ROW.decided_by, ttlMinutes: 30 });
    assert.equal(recorded.status, "recorded");
    const consumed = await store.consume({ projectId: "nexra-agency", approvalId: ROW.id, actionKind: "article-publication", targetId: ROW.target_id, payloadSha256: "b".repeat(64), operatorId: ROW.decided_by });
    assert.deepEqual(consumed, { status: "digest-mismatch" });
    assert.deepEqual(calls.map((c) => c.fn), ["nexra_approval_record", "nexra_approval_consume"]);
    assert.deepEqual(Object.keys(calls[0].args).sort(), ["p_action_kind", "p_decision", "p_operator", "p_payload_sha256", "p_project_id", "p_target_id", "p_ttl_minutes"]);
    assert.deepEqual(Object.keys(calls[1].args).sort(), ["p_action_kind", "p_approval_id", "p_operator", "p_payload_sha256", "p_project_id", "p_target_id"]);
    await assert.rejects(store.record({ projectId: "nexra-agency", actionKind: "article-publication", targetId: ROW.target_id, payloadSha256: "x", decision: "approve", operatorId: ROW.decided_by, ttlMinutes: 30 }), /invalid input/);
    assert.equal(calls.length, 2, "an invalid record is refused before any call");
  });
});

describe("the migration and its scope", () => {
  test("one table, RLS on, two security definer functions granted to service_role, SELECT only, guards, no consumer of the claim gate", async () => {
    const sql = await read("../../../supabase/migrations/20261009120000_approval_records.sql");
    assert.match(sql, /create table public\.nexra_approvals \(/);
    assert.match(sql, /alter table public\.nexra_approvals enable row level security;/);
    assert.doesNotMatch(sql, /create policy/i);
    assert.equal((sql.match(/^security definer$/gm) ?? []).length, 2);
    assert.match(sql, /grant select on table public\.nexra_approvals to service_role;/);
    assert.match(sql, /grant execute on function public\.nexra_approval_record\(text, text, uuid, text, text, uuid, integer\) to service_role;/);
    assert.match(sql, /grant execute on function public\.nexra_approval_consume\(text, uuid, text, uuid, text, uuid\) to service_role;/);
    assert.equal((sql.match(/^\s*grant /gm) ?? []).length, 3, "three grants");
    assert.doesNotMatch(sql, /grant (insert|update|delete)|drop table|drop function|function public\.agent_run|alter table public\.agent_runs/i, "the claim gate and the runs are untouched");
    for (const trigger of ["nexra_approvals_check_insert", "nexra_approvals_guard_update", "nexra_approvals_guard_delete", "nexra_approvals_guard_truncate"]) assert.match(sql, new RegExp(`create trigger ${trigger}`));
    for (const outcome of ["approval-not-found", "refused", "action-mismatch", "digest-mismatch", "used", "expired", "superseded", "consumed"]) assert.match(sql, new RegExp(`'outcome', '${outcome}'`));
  });

  test("one consumer: only the P-L2 publisher imports the approvals module (its digest); no route, action or agent-run module does", async () => {
    const { readdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const root = new URL("../../", import.meta.url).pathname;
    const offenders: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name) && !path.includes("/lib/approvals/")) {
          if ((await readFile(path, "utf8")).includes("@/lib/approvals")) offenders.push(path);
        }
      }
    }
    await walk(root);
    // P-L2 (docs/roadmap/P-L2-publishing.md): the publisher binds a request with approvalPayloadSha256; the database's
    // request and start functions record and consume the approval. Nothing else may import this module.
    const allowed = ["/lib/publishing/index.ts", "/lib/publishing/publishing.test.ts"];
    assert.deepEqual(offenders.filter((path) => !allowed.some((end) => path.endsWith(end))), []);
  });
});
