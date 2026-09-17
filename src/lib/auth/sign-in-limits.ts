import "server-only";

import { createHash } from "node:crypto";
import { appRateLimiter } from "@/lib/security/app-rate-limit";

/**
 * Sign-in attempt limits: 5 per email address and 50 across the service, per
 * fifteen minutes, shared by every server instance on the database
 * deployment (`@/lib/security/app-rate-limit`).
 *
 * The per-address key is a truncated SHA-256 of the normalised address, so
 * the rate-limit table never holds an email address. Supabase Auth applies its
 * own limits behind these.
 */

const WINDOW_SECONDS = 15 * 60;
const PER_EMAIL = 5;
const OVERALL = 50;

export type SignInAllowance = "allowed" | "limited";

export function emailLimitKey(normalisedEmail: string): string {
  return createHash("sha256").update(normalisedEmail, "utf8").digest("hex").slice(0, 32);
}

/** Records one attempt. Throws if the shared count cannot be read. */
export async function consumeSignInAttempt(normalisedEmail: string): Promise<SignInAllowance> {
  const overall = await appRateLimiter("sign-in.all", { limit: OVERALL, windowSeconds: WINDOW_SECONDS }).consume("all");
  if (!overall.allowed) return "limited";
  const perEmail = await appRateLimiter("sign-in.email", { limit: PER_EMAIL, windowSeconds: WINDOW_SECONDS }).consume(
    emailLimitKey(normalisedEmail),
  );
  return perEmail.allowed ? "allowed" : "limited";
}
