import "server-only";

import { cache } from "react";
import { operatorFromUser, type Operator } from "@/lib/auth/access";
import { AuthConfigurationError, readAuthConfig } from "@/lib/auth/config";
import { createSessionClient } from "@/lib/auth/server-client";

/**
 * The operator making this request, or null.
 *
 * The authoritative check, for anything that reads private data or writes:
 * it asks the Auth server for the user behind the session instead of trusting
 * the token alone, so a deleted or unconfirmed account is refused even while
 * its token has not yet expired. The proxy's cheaper check decides redirects;
 * this one decides access.
 *
 * Fails closed: if sign-in is not configured, or Supabase cannot be reached,
 * nobody is an operator. Cached per request, so several callers in one render
 * cost one round trip.
 */
export const getOperator = cache(async (): Promise<Operator | null> => {
  try {
    const config = readAuthConfig(process.env);
    const client = await createSessionClient(config);
    const { data, error } = await client.auth.getUser();
    if (error) return null;
    return operatorFromUser(data.user, config.operatorEmails);
  } catch (error) {
    console.error(
      "getOperator:",
      error instanceof AuthConfigurationError
        ? error.message
        : error instanceof Error
          ? error.name
          : "unknown error",
    );
    return null;
  }
});
