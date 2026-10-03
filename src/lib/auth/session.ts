import "server-only";

import { cache } from "react";
import { operatorFromUser, reviewerFromUser, type Operator } from "@/lib/auth/access";
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

/** Who may use the publish page (P-L2): an operator, or a reviewer listed in `NEXRA_REVIEWER_EMAILS`. */
export type Publisher = Operator & { readonly role: "operator" | "reviewer" };

/**
 * The operator or reviewer making this request, or null — the publish pages' and their API's check (P-L2). The same
 * authoritative Auth server read as `getOperator`, and the same fail-closed rule. Every other page and route keeps
 * `getOperator`, so a reviewer reaches nothing else.
 */
export const getPublisher = cache(async (): Promise<Publisher | null> => {
  try {
    const config = readAuthConfig(process.env);
    const client = await createSessionClient(config);
    const { data, error } = await client.auth.getUser();
    if (error) return null;
    const operator = operatorFromUser(data.user, config.operatorEmails);
    if (operator !== null) return { ...operator, role: "operator" };
    const reviewer = reviewerFromUser(data.user, config.reviewerEmails, config.operatorEmails);
    return reviewer === null ? null : { ...reviewer, role: "reviewer" };
  } catch (error) {
    console.error(
      "getPublisher:",
      error instanceof AuthConfigurationError ? error.message : error instanceof Error ? error.name : "unknown error",
    );
    return null;
  }
});
