import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  AuthConfigurationError,
  OPERATOR_EMAILS_VARIABLE,
  readAuthConfig,
  SESSION_COOKIE_OPTIONS,
  SUPABASE_PUBLISHABLE_KEY_VARIABLE,
  SUPABASE_URL_VARIABLE,
} from "./config.ts";

/**
 * Sign-in configuration fails closed.
 *
 * Every refusal below names a variable and never echoes a value, and the two
 * refusals that matter most — a secret key where the publishable one belongs,
 * and an operator list that admits nobody or something that is not an
 * address — are pinned so the check cannot quietly loosen.
 */

/** A JWT-format key with the given role claim; the signature is irrelevant here. */
function jwtKey(role: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role, iss: "supabase" })}.signature-not-checked-here`;
}

const GOOD = {
  [SUPABASE_URL_VARIABLE]: "https://project.supabase.co",
  [SUPABASE_PUBLISHABLE_KEY_VARIABLE]: "sb_publishable_0123456789abcdef",
  [OPERATOR_EMAILS_VARIABLE]: "ops@nexraagency.com",
};

function refused(env: Record<string, string | undefined>, fragment: string) {
  assert.throws(
    () => readAuthConfig(env),
    (error: unknown) => error instanceof AuthConfigurationError && error.message.includes(fragment),
    `expected a refusal mentioning ${JSON.stringify(fragment)}`,
  );
}

describe("readAuthConfig: what a valid configuration is", () => {
  test("a good environment reads to its origin, key and lower-cased operator set", () => {
    const config = readAuthConfig({ ...GOOD, [OPERATOR_EMAILS_VARIABLE]: " Ops@NexraAgency.com , second@nexraagency.com,, " });
    assert.equal(config.url, "https://project.supabase.co");
    assert.equal(config.publishableKey, GOOD[SUPABASE_PUBLISHABLE_KEY_VARIABLE]);
    assert.deepEqual([...config.operatorEmails].sort(), ["ops@nexraagency.com", "second@nexraagency.com"]);
  });

  test("the URL is reduced to its origin", () => {
    assert.equal(readAuthConfig({ ...GOOD, [SUPABASE_URL_VARIABLE]: "https://project.supabase.co/rest/v1/?x=1" }).url, "https://project.supabase.co");
  });

  test("an anon JWT is accepted as the publishable key", () => {
    assert.equal(readAuthConfig({ ...GOOD, [SUPABASE_PUBLISHABLE_KEY_VARIABLE]: jwtKey("anon") }).publishableKey, jwtKey("anon"));
  });

  test("session cookies are httpOnly, site-wide and lax", () => {
    assert.deepEqual(SESSION_COOKIE_OPTIONS, { path: "/", sameSite: "lax", httpOnly: true });
  });
});

describe("readAuthConfig: refusals name the variable and never the value", () => {
  test("every missing variable is named, together", () => {
    refused({}, `${SUPABASE_URL_VARIABLE}, ${SUPABASE_PUBLISHABLE_KEY_VARIABLE}, ${OPERATOR_EMAILS_VARIABLE} are not set`);
    refused({ ...GOOD, [OPERATOR_EMAILS_VARIABLE]: "   " }, `${OPERATOR_EMAILS_VARIABLE} is not set`);
  });

  test("the URL must parse and use https, except on localhost", () => {
    refused({ ...GOOD, [SUPABASE_URL_VARIABLE]: "not a url" }, "is not a URL");
    refused({ ...GOOD, [SUPABASE_URL_VARIABLE]: "http://project.supabase.co" }, "must use https");
    assert.equal(readAuthConfig({ ...GOOD, [SUPABASE_URL_VARIABLE]: "http://localhost:54321" }).url, "http://localhost:54321");
    assert.equal(readAuthConfig({ ...GOOD, [SUPABASE_URL_VARIABLE]: "http://127.0.0.1:54321" }).url, "http://127.0.0.1:54321");
  });

  test("a secret key where the publishable key belongs is refused, and its value is not echoed", () => {
    const secret = "sb_secret_ThisWouldActAsServiceRole000";
    assert.throws(
      () => readAuthConfig({ ...GOOD, [SUPABASE_PUBLISHABLE_KEY_VARIABLE]: secret }),
      (error: unknown) =>
        error instanceof AuthConfigurationError && error.message.includes("holds a secret key") && !error.message.includes(secret),
    );
    const serviceJwt = jwtKey("service_role");
    assert.throws(
      () => readAuthConfig({ ...GOOD, [SUPABASE_PUBLISHABLE_KEY_VARIABLE]: serviceJwt }),
      (error: unknown) =>
        error instanceof AuthConfigurationError && error.message.includes("holds a secret key") && !error.message.includes(serviceJwt),
    );
  });

  test("a key of any other shape is refused", () => {
    refused({ ...GOOD, [SUPABASE_PUBLISHABLE_KEY_VARIABLE]: "some-random-token-value" }, "is not a publishable");
    refused({ ...GOOD, [SUPABASE_PUBLISHABLE_KEY_VARIABLE]: jwtKey("authenticated") }, "is not a publishable");
    // A malformed JWT payload is not a role at all.
    refused({ ...GOOD, [SUPABASE_PUBLISHABLE_KEY_VARIABLE]: "aaa.bbb.ccc" }, "is not a publishable");
  });

  test("the operator list must hold at least one address and nothing that is not one", () => {
    refused({ ...GOOD, [OPERATOR_EMAILS_VARIABLE]: ", ," }, "comma-separated list of email addresses");
    refused({ ...GOOD, [OPERATOR_EMAILS_VARIABLE]: "ops@nexraagency.com, not-an-address" }, "comma-separated list of email addresses");
    refused({ ...GOOD, [OPERATOR_EMAILS_VARIABLE]: "ops@nexraagency.com second@nexraagency.com" }, "comma-separated list of email addresses");
    refused({ ...GOOD, [OPERATOR_EMAILS_VARIABLE]: "ops@nexraagency" }, "comma-separated list of email addresses");
  });
});
