import "server-only";

import { createSign } from "node:crypto";
import type { ServiceAccountCredentials } from "@/lib/search-console/config";

/**
 * The HTTP conversation with Google, and nothing else.
 *
 * Authenticates as a service account with a signed JWT (RFC 7523), which is
 * all the token exchange needs — no Google SDK. The access token lives in
 * memory for the hour Google grants, less a margin, and is never logged or
 * returned.
 *
 * Every request has a timeout. Timeouts, rate limiting and server errors are
 * retried a bounded number of times with backoff — the token exchange and the
 * call it authorises share one retry budget; refusals (400, 401, 403,
 * 404) are not, because asking again gets the same answer. Failures leave as
 * a `SearchConsoleProviderError` whose message is fixed text — Google's error
 * bodies can echo request details, so they are never passed on.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_ROOT = "https://www.googleapis.com/webmasters/v3";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export type ProviderErrorKind =
  | "timeout"
  | "rate-limited"
  | "credentials-rejected"
  | "access-denied"
  | "not-found"
  | "bad-request"
  | "error";

export class SearchConsoleProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status: number | null;

  constructor(kind: ProviderErrorKind, status: number | null = null) {
    super(`Search Console request failed: ${kind}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "SearchConsoleProviderError";
    this.kind = kind;
    this.status = status;
  }
}

export type SearchAnalyticsRequest = {
  readonly startDate: string;
  readonly endDate: string;
  readonly dimensions: readonly ("query" | "page")[];
  readonly rowLimit?: number;
};

export type SearchConsoleClient = {
  /** GET sites — the properties this account can see. Raw JSON. */
  listSites(): Promise<unknown>;
  /** POST searchAnalytics.query for one property. Raw JSON. */
  querySearchAnalytics(property: string, request: SearchAnalyticsRequest): Promise<unknown>;
};

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export type ClientOptions = {
  readonly credentials: ServiceAccountCredentials;
  readonly fetch?: Fetch;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
  /** Additional attempts after the first, for retryable failures. */
  readonly retries?: number;
};

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

export function signServiceAccountJwt(credentials: ServiceAccountCredentials, nowMs: number): string {
  const issuedAt = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: credentials.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${base64url(signer.sign(credentials.privateKey))}`;
}

function kindForStatus(status: number): ProviderErrorKind {
  if (status === 429) return "rate-limited";
  if (status === 401) return "credentials-rejected";
  if (status === 403) return "access-denied";
  if (status === 404) return "not-found";
  if (status === 400) return "bad-request";
  return "error";
}

const retryable = (kind: ProviderErrorKind) =>
  kind === "timeout" || kind === "rate-limited" || kind === "error";

export function createSearchConsoleClient(options: ClientOptions): SearchConsoleClient {
  const {
    credentials,
    fetch: send = (input, init) => fetch(input, init),
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeoutMs = 10_000,
    retries = 2,
  } = options;

  let token: { value: string; expiresAt: number } | null = null;
  let tokenRequest: Promise<string> | null = null;

  /** One HTTP exchange with a timeout; returns the parsed JSON body. */
  async function exchange(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await send(url, { ...init, signal: controller.signal });
    } catch (error) {
      throw new SearchConsoleProviderError(
        error instanceof Error && error.name === "AbortError" ? "timeout" : "error",
      );
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      // Drain without reading into anything that could be logged.
      await response.body?.cancel().catch(() => {});
      throw new SearchConsoleProviderError(kindForStatus(response.status), response.status);
    }
    try {
      return await response.json();
    } catch {
      throw new SearchConsoleProviderError("error", response.status);
    }
  }

  async function withRetries<T>(attempt: () => Promise<T>): Promise<T> {
    for (let tries = 0; ; tries += 1) {
      try {
        return await attempt();
      } catch (error) {
        const kind = error instanceof SearchConsoleProviderError ? error.kind : "error";
        if (!retryable(kind) || tries >= retries) throw error;
        await sleep(300 * 3 ** tries);
      }
    }
  }

  async function accessToken(): Promise<string> {
    if (token && now() < token.expiresAt) return token.value;
    if (!tokenRequest) {
      tokenRequest = (async () => {
        let body: unknown;
        try {
          body = await exchange(TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
              assertion: signServiceAccountJwt(credentials, now()),
            }).toString(),
          });
        } catch (error) {
          // The token endpoint answers a bad key or a deleted account with
          // 400 invalid_grant: that is a credentials problem, not a bad request.
          if (error instanceof SearchConsoleProviderError && (error.status === 400 || error.status === 401)) {
            throw new SearchConsoleProviderError("credentials-rejected", error.status);
          }
          throw error;
        }
        const { access_token: value, expires_in: expiresIn } = (body ?? {}) as Record<string, unknown>;
        if (typeof value !== "string" || value.length === 0) {
          throw new SearchConsoleProviderError("credentials-rejected");
        }
        const lifetime = typeof expiresIn === "number" && expiresIn > 0 ? expiresIn : 3600;
        token = { value, expiresAt: now() + Math.max(0, lifetime - 120) * 1000 };
        return value;
      })().finally(() => {
        tokenRequest = null;
      });
    }
    return tokenRequest;
  }

  async function authorised(url: string, init: RequestInit): Promise<unknown> {
    return withRetries(async () => {
      const value = await accessToken();
      try {
        return await exchange(url, {
          ...init,
          headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${value}` },
        });
      } catch (error) {
        // A revoked or expired token: forget it so the next attempt re-signs.
        if (error instanceof SearchConsoleProviderError && error.status === 401) token = null;
        throw error;
      }
    });
  }

  return {
    listSites: () => authorised(`${API_ROOT}/sites`, { method: "GET" }),

    querySearchAnalytics: (property, request) =>
      authorised(`${API_ROOT}/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: request.startDate,
          endDate: request.endDate,
          dimensions: request.dimensions,
          rowLimit: request.rowLimit ?? 25,
          type: "web",
          dataState: "final",
        }),
      }),
  };
}
