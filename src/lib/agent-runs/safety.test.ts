import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canonicalJson, checkStorableJson, looksLikeSecret, MAX_JSON_BYTES } from "./safety.ts";

/**
 * What may be written into a run record, pinned pattern by pattern.
 *
 * The worker's output screen (`output-screen.test.ts`) proves these rules
 * reach a run as a refusal; this file proves each rule itself, including the
 * categories behind the production `rejected-output` refusals: an answer over
 * the ceiling, credential-shaped text, and metadata the store cannot hold.
 */

describe("looksLikeSecret: credential-shaped values", () => {
  const secrets: readonly [string, string][] = [
    ["PEM private key", "-----BEGIN RSA PRIVATE KEY-----\nMIIB"],
    ["Supabase secret key", "sb_secret_abcdefgh12345678"],
    ["JWT", `eyJhbGciOiJIUzI1NiJ9.${"a".repeat(12)}.${"b".repeat(12)}`],
    ["sk- provider key", `sk-${"a".repeat(24)}`],
    ["Google API key", `AIza${"A".repeat(35)}`],
    ["Google OAuth token", `ya29.${"a".repeat(24)}`],
    ["GitHub token", `ghp_${"A".repeat(36)}`],
    ["Slack token", "xoxb-1234567890-abcdef"],
    ["AWS access key id", "AKIAABCDEFGHIJKLMNOP"],
    ["password assignment", "password: hunter2!!"],
    ["api key assignment", "API_KEY = abcdef123456"],
    ["bearer assignment", "Bearer: abcdefgh"],
    ["access token assignment", "access-token=zzzzzzzz"],
  ];

  for (const [label, value] of secrets) {
    test(`${label} is a secret, alone and inside prose`, () => {
      assert.equal(looksLikeSecret(value), true);
      assert.equal(looksLikeSecret(`The page mentioned ${value} in a footer.`), true);
    });
  }

  test("ordinary text, short look-alikes and metric names are not secrets", () => {
    for (const value of [
      "The crawl fetched 5 pages.",
      "sk-short",
      "tokens: 12",
      "password reset page",
      "secret garden",
      "Bearer of bad news",
      "AKIA is not enough",
      "eyJ.two.parts",
      `api key ${"x".repeat(5)}`,
    ]) {
      assert.equal(looksLikeSecret(value), false, JSON.stringify(value));
    }
  });
});

describe("checkStorableJson: bounded plain JSON, free of credentials", () => {
  test("a plain object of scalars, arrays and nested objects is copied with its byte size", () => {
    const check = checkStorableJson({ a: 1, b: "two", c: [true, null], d: { e: { f: "deep enough" } } });
    assert.equal(check.ok, true);
    if (check.ok) {
      assert.deepEqual(check.value, { a: 1, b: "two", c: [true, null], d: { e: { f: "deep enough" } } });
      assert.equal(check.bytes, Buffer.byteLength(JSON.stringify(check.value), "utf8"));
    }
  });

  test("only a plain object is storable at the top", () => {
    for (const value of [null, undefined, "text", 3, [], new Date(), Object.create({ inherited: 1 })]) {
      assert.deepEqual(checkStorableJson(value), { ok: false, problem: "not-object" });
    }
    assert.equal(checkStorableJson(Object.create(null)).ok, true);
  });

  test("non-JSON values are refused instead of being dropped or coerced", () => {
    assert.deepEqual(checkStorableJson({ when: new Date() }), { ok: false, problem: "not-json" });
    assert.deepEqual(checkStorableJson({ fn: () => 1 }), { ok: false, problem: "not-json" });
    assert.deepEqual(checkStorableJson({ n: Number.NaN }), { ok: false, problem: "not-json" });
    assert.deepEqual(checkStorableJson({ n: Number.POSITIVE_INFINITY }), { ok: false, problem: "not-json" });
    assert.deepEqual(checkStorableJson({ u: undefined }), { ok: false, problem: "not-json" });
    assert.deepEqual(checkStorableJson({ big: 1n }), { ok: false, problem: "not-json" });
  });

  test("depth, key count, array length and byte size are all bounded", () => {
    assert.equal(checkStorableJson({ a: { b: { c: { d: 1 } } } }).ok, true);
    assert.deepEqual(checkStorableJson({ a: { b: { c: { d: { e: 1 } } } } }), { ok: false, problem: "too-deep" });
    const wide = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, i]));
    assert.deepEqual(checkStorableJson(wide), { ok: false, problem: "too-large" });
    assert.equal(checkStorableJson(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]))).ok, true);
    assert.deepEqual(checkStorableJson({ list: Array.from({ length: 101 }, () => 1) }), { ok: false, problem: "too-large" });
    assert.equal(checkStorableJson({ list: Array.from({ length: 100 }, () => 1) }).ok, true);
    assert.deepEqual(checkStorableJson({ text: "x".repeat(MAX_JSON_BYTES) }), { ok: false, problem: "too-large" });
    assert.equal(checkStorableJson({ text: "x".repeat(MAX_JSON_BYTES - 20) }).ok, true);
  });

  test("a credential-shaped string value, or a credential-like key, is refused anywhere in the tree", () => {
    assert.deepEqual(checkStorableJson({ note: `key ${"AKIA" + "B".repeat(16)} seen` }), { ok: false, problem: "secret" });
    assert.deepEqual(checkStorableJson({ nested: { list: [`sk-${"z".repeat(30)}`] } }), { ok: false, problem: "secret" });
    for (const key of ["password", "apiKey", "api_key", "access_token", "refreshToken", "Authorization", "cookie", "private-key", "credential"]) {
      assert.deepEqual(checkStorableJson({ [key]: "value" }), { ok: false, problem: "secret" }, key);
    }
    // Metric names that merely contain "token" are fine.
    assert.equal(checkStorableJson({ inputTokens: 12, sessions: 3 }).ok, true);
  });
});

describe("canonicalJson: key order does not change identity", () => {
  test("sorts keys at every level and leaves arrays in order", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: [2, 1], c: null } }), '{"a":{"c":null,"d":[2,1]},"b":1}');
    assert.equal(canonicalJson({ z: "x", a: true }), canonicalJson({ a: true, z: "x" }));
    assert.notEqual(canonicalJson({ a: [1, 2] }), canonicalJson({ a: [2, 1] }));
  });

  test("scalars serialise as JSON does", () => {
    assert.equal(canonicalJson("quote\"d"), '"quote\\"d"');
    assert.equal(canonicalJson(null), "null");
    assert.equal(canonicalJson(2.5), "2.5");
  });
});
