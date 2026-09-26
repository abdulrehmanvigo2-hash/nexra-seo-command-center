import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { logEvent, type LogFields } from "./log.ts";

/**
 * What a log line may carry.
 *
 * Every line is captured from the console and parsed back, so the assertions
 * are about what a log drain would actually receive: a closed set of fields,
 * short printable scalars, and never a credential.
 */

type Captured = { readonly method: "info" | "warn" | "error"; readonly line: string };

let captured: Captured[] = [];
const original = { info: console.info, warn: console.warn, error: console.error };

beforeEach(() => {
  captured = [];
  console.info = (line: string) => captured.push({ method: "info", line });
  console.warn = (line: string) => captured.push({ method: "warn", line });
  console.error = (line: string) => captured.push({ method: "error", line });
});

afterEach(() => {
  console.info = original.info;
  console.warn = original.warn;
  console.error = original.error;
});

function last(): { method: Captured["method"]; entry: Record<string, unknown> } {
  const item = captured.at(-1);
  assert.ok(item, "nothing was logged");
  return { method: item.method, entry: JSON.parse(item.line) as Record<string, unknown> };
}

describe("logEvent: one JSON object per line, on the console method of its level", () => {
  test("level, event and a timestamp are always present, and the level picks the method", () => {
    logEvent("info", "agent_run.transition", { runId: "r1" });
    const info = last();
    assert.equal(info.method, "info");
    assert.equal(info.entry.level, "info");
    assert.equal(info.entry.event, "agent_run.transition");
    assert.ok(typeof info.entry.at === "string" && !Number.isNaN(Date.parse(info.entry.at as string)));
    logEvent("warn", "x");
    assert.equal(last().method, "warn");
    logEvent("error", "x");
    assert.equal(last().method, "error");
    assert.equal(captured.length, 3);
  });

  test("only the closed field set is written; anything else is dropped, and undefined is omitted", () => {
    const fields = { runId: "r1", summary: "the answer text", token: "abc", input: { crawlId: "x" }, attempt: undefined } as unknown as LogFields;
    logEvent("info", "e", fields);
    const { entry } = last();
    assert.deepEqual(Object.keys(entry).sort(), ["at", "event", "level", "runId"]);
  });

  test("a credential-shaped value is replaced, whatever field it is in", () => {
    logEvent("warn", "e", { reason: `sk-${"a".repeat(30)}`, host: "password: hunter2!!", route: "/api/x" });
    const { entry } = last();
    assert.equal(entry.reason, "[redacted]");
    assert.equal(entry.host, "[redacted]");
    assert.equal(entry.route, "/api/x");
    assert.ok(!captured.at(-1)!.line.includes("hunter2"));
    assert.ok(!captured.at(-1)!.line.includes("sk-aaaa"));
  });

  test("the event name itself is cleaned", () => {
    logEvent("info", `ghp_${"A".repeat(36)}`);
    assert.equal(last().entry.event, "[redacted]");
  });

  test("non-printable characters are replaced and long strings are cut", () => {
    logEvent("info", "e", { reason: "line\nbreak\u0000and\u001bescape é" });
    assert.equal(last().entry.reason, "line?break?and?escape ?");
    logEvent("info", "e", { reason: "x".repeat(200) });
    const reason = last().entry.reason as string;
    assert.equal(reason.length, 121);
    assert.ok(reason.endsWith("…"));
  });

  test("numbers, booleans and null pass through; non-finite numbers become null", () => {
    logEvent("info", "e", { durationMs: 12.5, count: 0, claimed: true, errorCode: null, limit: Number.NaN, depth: Number.POSITIVE_INFINITY });
    const { entry } = last();
    assert.equal(entry.durationMs, 12.5);
    assert.equal(entry.count, 0);
    assert.equal(entry.claimed, true);
    assert.equal(entry.errorCode, null);
    assert.equal(entry.limit, null);
    assert.equal(entry.depth, null);
  });

  test("the line is a flat object: no nested values can be written", () => {
    logEvent("info", "e", { runId: "r1", projectId: "p", agentId: "a", taskType: "t", attempt: 1 });
    for (const value of Object.values(last().entry)) {
      assert.ok(value === null || ["string", "number", "boolean"].includes(typeof value));
    }
  });
});
