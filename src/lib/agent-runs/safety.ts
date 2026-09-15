import type { JsonObject, JsonValue } from "@/types/agent-run";

/**
 * What may be written into a run record.
 *
 * Runs are audit records that outlive the request that made them, so anything
 * stored in one — the task input going in, the result coming out — is checked
 * here first: plain JSON only, bounded in size and depth, and free of anything
 * that looks like a credential. The patterns are a backstop, not the defence:
 * task inputs accept only the fields their task type names, and executors take
 * credentials from the server environment, never from a run.
 */

/** Serialised size limit for a task input or result metadata, in bytes. */
export const MAX_JSON_BYTES = 8_192;
const MAX_DEPTH = 4;
const MAX_KEYS = 50;
const MAX_ARRAY_LENGTH = 100;

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsb_secret_[A-Za-z0-9_-]{8,}/,
  // A JSON Web Token: three base64url segments, the first a JSON header.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bya29\.[0-9A-Za-z_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|bearer)\s*[:=]\s*\S{6,}/i,
];

// Narrow on purpose: "tokens" or "sessions" are ordinary metric names.
const SECRET_KEY_PATTERN =
  /(?:password|passwd|secret|(?:access|refresh|id|auth|bearer)[_-]?token|api[_-]?key|credential|private[_-]?key|authori[sz]ation|cookie)/i;

export function looksLikeSecret(text: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(text));
}

export type JsonCheck =
  | { readonly ok: true; readonly value: JsonObject; readonly bytes: number }
  | { readonly ok: false; readonly problem: "not-object" | "too-large" | "too-deep" | "not-json" | "secret" };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Copies `value` as plain JSON, or says why it cannot be stored.
 *
 * Walks the value itself rather than trusting `JSON.stringify`, which would
 * quietly drop functions and undefined, turn dates into strings, and throw on
 * cycles and bigints.
 */
export function checkStorableJson(value: unknown): JsonCheck {
  if (!isPlainObject(value)) return { ok: false, problem: "not-object" };

  let problem: Exclude<JsonCheck, { ok: true }>["problem"] | null = null;

  const copy = (entry: unknown, depth: number): JsonValue => {
    if (problem) return null;
    if (entry === null || typeof entry === "boolean") return entry;
    if (typeof entry === "number") {
      if (Number.isFinite(entry)) return entry;
      problem = "not-json";
      return null;
    }
    if (typeof entry === "string") {
      if (looksLikeSecret(entry)) problem = "secret";
      return entry;
    }
    if (depth >= MAX_DEPTH) {
      problem = "too-deep";
      return null;
    }
    if (Array.isArray(entry)) {
      if (entry.length > MAX_ARRAY_LENGTH) {
        problem = "too-large";
        return null;
      }
      return entry.map((item) => copy(item, depth + 1));
    }
    if (isPlainObject(entry)) {
      const keys = Object.keys(entry);
      if (keys.length > MAX_KEYS) {
        problem = "too-large";
        return null;
      }
      const result: Record<string, JsonValue> = {};
      for (const key of keys) {
        if (SECRET_KEY_PATTERN.test(key)) {
          problem = "secret";
          return null;
        }
        result[key] = copy(entry[key], depth + 1);
      }
      return result;
    }
    problem = "not-json";
    return null;
  };

  const copied = copy(value, 0);
  if (problem) return { ok: false, problem };

  const bytes = Buffer.byteLength(JSON.stringify(copied), "utf8");
  if (bytes > MAX_JSON_BYTES) return { ok: false, problem: "too-large" };
  return { ok: true, value: copied as JsonObject, bytes };
}

/**
 * The same value with keys sorted at every level, serialised — so two inputs
 * that differ only in key order are recognised as the same request.
 */
export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as { readonly [key: string]: JsonValue };
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
