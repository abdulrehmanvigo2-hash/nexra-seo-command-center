"use server";

import { redirect } from "next/navigation";
import { operatorFromUser, safeNextPath } from "@/lib/auth/access";
import { AuthConfigurationError, readAuthConfig } from "@/lib/auth/config";
import { createSessionClient } from "@/lib/auth/server-client";
import { createRateLimiter } from "@/lib/security/rate-limit";

/**
 * Signs an operator in with email and password.
 *
 * Accounts are created by an administrator in Supabase; there is no sign-up.
 * A wrong email and a wrong password get the same answer, so the form cannot
 * be used to learn which addresses have accounts. An account that signs in
 * correctly but is not an operator is signed straight back out.
 *
 * Attempts are limited per email address and across the whole server, in
 * this process's memory (see `createRateLimiter` for why that is not enough
 * for a public deployment). Supabase Auth applies its own limits behind these.
 */

export type SignInState = {
  readonly error: string | null;
  /** Echoed back so a failed attempt does not clear the field. */
  readonly email: string;
};

const INCORRECT = "Email or password is incorrect.";
const TOO_MANY = "Too many sign-in attempts. Wait a few minutes and try again.";

const MAX_EMAIL_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 1_024;

const FIFTEEN_MINUTES = 15 * 60 * 1_000;
const attemptsPerEmail = createRateLimiter({ limit: 5, windowMs: FIFTEEN_MINUTES });
const attemptsOverall = createRateLimiter({ limit: 50, windowMs: FIFTEEN_MINUTES });

export async function signInAction(
  _previous: SignInState,
  form: FormData,
): Promise<SignInState> {
  const email = form.get("email");
  const password = form.get("password");
  const next = safeNextPath(form.get("next"));

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.trim().length === 0 ||
    password.length === 0
  ) {
    return {
      error: "Enter your email and password.",
      email: typeof email === "string" ? email.slice(0, MAX_EMAIL_LENGTH) : "",
    };
  }
  if (email.length > MAX_EMAIL_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return { error: INCORRECT, email: "" };
  }

  const address = email.trim().toLowerCase();
  if (!attemptsOverall.consume("all").allowed || !attemptsPerEmail.consume(address).allowed) {
    return { error: TOO_MANY, email: address };
  }

  let signedIn = false;
  try {
    const config = readAuthConfig(process.env);
    const client = await createSessionClient(config);
    const { data, error } = await client.auth.signInWithPassword({ email: address, password });
    if (error || !data.user) return { error: INCORRECT, email: address };

    if (!operatorFromUser(data.user, config.operatorEmails)) {
      await client.auth.signOut({ scope: "local" });
      return { error: "This account does not have access to Nexra.", email: address };
    }
    signedIn = true;
  } catch (error) {
    console.error(
      "signInAction:",
      error instanceof AuthConfigurationError
        ? error.message
        : error instanceof Error
          ? error.name
          : "unknown error",
    );
    return {
      error:
        error instanceof AuthConfigurationError
          ? "Sign-in is not configured on this server."
          : "Sign-in is unavailable right now. Try again in a moment.",
      email: address,
    };
  }

  // Outside the try: `redirect` works by throwing.
  if (signedIn) redirect(next);
  return { error: INCORRECT, email: address };
}
