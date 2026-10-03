import "server-only";

import { createHash } from "node:crypto";
import { approvalPayloadSha256 } from "@/lib/approvals/contract";
import { readPublishMode } from "@/lib/publishing/contract";
import { githubClientFromEnv } from "@/lib/publishing/github";
import { createPublishingService, type PublishingService } from "@/lib/publishing/service";
import { unavailablePublicationStore } from "@/lib/publishing/store-contract";
import { createSupabasePublicationStore } from "@/lib/publishing/supabase-store";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { appRateLimiter } from "@/lib/security/app-rate-limit";
import type { AsyncRateLimiter } from "@/lib/security/shared-rate-limit";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The server's publisher (P-L2) — the one place that wires it: the publication records in Supabase (migration
 * 20261023120000; a database without it answers "not set up"), the GitHub client from `NEXRA_AI_GITHUB_TOKEN` (unset:
 * "not configured") and the mode from `NEXRA_PUBLISH_MODE` (`off` unless it names `dry-run` or `merge`). The live
 * check is one GET of the public page with a timeout, no credential and no redirect followed.
 */

const LIVE_CHECK_TIMEOUT_MS = 10_000;

async function checkLive(url: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: "GET", redirect: "manual", cache: "no-store", signal: controller.signal });
    return response.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let service: PublishingService | null = null;

export function publishingService(): PublishingService {
  if (service !== null) return service;
  const inSupabase = selectProjectDataSource(process.env) === "supabase";
  const config = inSupabase ? readSupabaseServerConfig(process.env) : null;
  service = createPublishingService({
    store: config ? createSupabasePublicationStore(createSupabaseServerClient(config)) : unavailablePublicationStore,
    github: githubClientFromEnv(process.env),
    mode: readPublishMode(process.env),
    checkLive,
    sha256: (text) => createHash("sha256").update(text, "utf8").digest("hex"),
    payloadDigest: (articleId, payload) => approvalPayloadSha256("article-publication", articleId, payload),
  });
  return service;
}

type LimitName = "read" | "write";

/** A request or a publish press is deliberate: ten per person per ten minutes; reads as other screens read. */
const LIMITS: Record<LimitName, { readonly limit: number; readonly windowSeconds: number }> = {
  read: { limit: 120, windowSeconds: 600 },
  write: { limit: 10, windowSeconds: 600 },
};

export function publicationLimiter(name: LimitName): AsyncRateLimiter {
  return appRateLimiter(`publications.${name}`, LIMITS[name]);
}
