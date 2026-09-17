import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The scheduled worker's credential.
 *
 * The worker routes (`/api/worker/*`) are called by a scheduler, not a person,
 * so they cannot use an operator session. They take a shared secret instead,
 * sent as `Authorization: Bearer <secret>`. The variable is `CRON_SECRET`
 * because that is the name Vercel Cron reads: with it set in the project,
 * Vercel sends exactly this header on every scheduled invocation.
 *
 * The secret is server-only: it has no `NEXT_PUBLIC_` name (one that did is
 * refused), it is compared in constant time through SHA-256 digests so its
 * length is not revealed either, and it is never logged, returned, or
 * written to a table. Fewer than 32 characters is refused as guessable.
 *
 * Unset or invalid, every worker request is refused. Nothing falls back to
 * an operator session or to no authentication.
 */

export const WORKER_SECRET_VARIABLE = "CRON_SECRET";
export const MIN_WORKER_SECRET_LENGTH = 32;

type Environment = Readonly<Record<string, string | undefined>>;

export type WorkerSecret =
  | { readonly status: "configured"; readonly digest: Buffer }
  /** `problem` names the variable, never its value. */
  | { readonly status: "unconfigured"; readonly problem: string };

export function readWorkerSecret(env: Environment): WorkerSecret {
  const exposed = Object.keys(env).filter(
    (name) => name.startsWith("NEXT_PUBLIC_") && /CRON|WORKER/i.test(name) && Boolean(env[name]?.trim()),
  );
  if (exposed.length > 0) {
    return {
      status: "unconfigured",
      problem: `${exposed.join(", ")} would be bundled into the browser; the worker secret is server-only.`,
    };
  }

  const secret = env[WORKER_SECRET_VARIABLE]?.trim() ?? "";
  if (secret === "") return { status: "unconfigured", problem: `${WORKER_SECRET_VARIABLE} is not set.` };
  if (secret.length < MIN_WORKER_SECRET_LENGTH || /\s/.test(secret)) {
    return {
      status: "unconfigured",
      problem: `${WORKER_SECRET_VARIABLE} must be at least ${MIN_WORKER_SECRET_LENGTH} characters with no spaces.`,
    };
  }
  return { status: "configured", digest: digest(secret) };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export type WorkerAuthentication = "authorized" | "missing" | "invalid" | "unconfigured";

/** Checks an `Authorization` header against the configured secret. */
export function authenticateWorker(authorization: string | null, secret: WorkerSecret): WorkerAuthentication {
  if (secret.status !== "configured") return "unconfigured";
  if (!authorization) return "missing";
  const match = /^Bearer ([^\s]{1,512})$/.exec(authorization);
  if (!match) return "invalid";
  return timingSafeEqual(digest(match[1]), secret.digest) ? "authorized" : "invalid";
}
