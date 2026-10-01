import "server-only";

import { createHash } from "node:crypto";
import type { ProviderCredentials } from "@/lib/providers/dataforseo/config";
import { API_HOSTS, type Endpoint, type ProviderMode } from "@/lib/providers/dataforseo/constants";

/**
 * The HTTP conversation with DataForSEO, and nothing else (F0, §6 and §7).
 *
 * Basic auth from the credentials, built here and never logged, returned or
 * stored. One POST per call with a timeout. In live mode nothing is retried
 * by this client — a timeout or a network failure after sending is answered
 * `unknown`, because the provider may have charged for it; the caller records
 * it at its estimate. In sandbox mode (free) one retry on timeout is allowed.
 * A refused request (HTTP status not 2xx) is `failed` with the status only;
 * the provider's body and `status_message` are never passed on, because they
 * can echo the request.
 */

export type ClientResult =
  | {
      readonly outcome: "succeeded";
      readonly httpStatus: number;
      /** The parsed JSON body, for the parsers; never logged. */
      readonly body: unknown;
      /** SHA-256 of the raw response text (the text itself is discarded). */
      readonly sha256: string;
      readonly sentAt: string;
      readonly receivedAt: string;
      readonly durationMs: number;
    }
  | { readonly outcome: "failed"; readonly httpStatus: number; readonly kind: "refused" | "credentials-rejected" | "rate-limited" | "server-error"; readonly sentAt: string; readonly receivedAt: string }
  | { readonly outcome: "failed"; readonly httpStatus: null; readonly kind: "malformed"; readonly sentAt: string; readonly receivedAt: string }
  | { readonly outcome: "unknown"; readonly kind: "timeout" | "network"; readonly sentAt: string };

export type DataForSeoClient = {
  readonly mode: ProviderMode;
  readonly host: string;
  /** POST one task array to one endpoint. Never throws for a provider outcome. */
  post(endpoint: Endpoint, tasks: readonly Readonly<Record<string, unknown>>[]): Promise<ClientResult>;
};

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export type ClientOptions = {
  readonly credentials: ProviderCredentials;
  readonly mode: ProviderMode;
  readonly fetch?: Fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
};

export const DEFAULT_TIMEOUT_MS = 30_000;

function kindForStatus(status: number): "refused" | "credentials-rejected" | "rate-limited" | "server-error" {
  if (status === 401 || status === 403) return "credentials-rejected";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "server-error";
  return "refused";
}

export function createDataForSeoClient(options: ClientOptions): DataForSeoClient {
  const { credentials, mode, fetch: send = (input, init) => fetch(input, init), now = Date.now, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const host = API_HOSTS[mode];
  // Built once, held in this closure only.
  const authorization = `Basic ${Buffer.from(`${credentials.login}:${credentials.password}`, "utf8").toString("base64")}`;

  async function once(endpoint: Endpoint, tasks: readonly Readonly<Record<string, unknown>>[]): Promise<ClientResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = now();
    const sentAt = new Date(started).toISOString();
    let response: Response;
    try {
      response = await send(`https://${host}/v3/${endpoint}`, {
        method: "POST",
        headers: { authorization, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(tasks),
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      return { outcome: "unknown", kind: error instanceof Error && error.name === "AbortError" ? "timeout" : "network", sentAt };
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      clearTimeout(timer);
      return { outcome: "unknown", kind: "network", sentAt };
    } finally {
      clearTimeout(timer);
    }
    const receivedAt = new Date(now()).toISOString();
    if (!response.ok) return { outcome: "failed", httpStatus: response.status, kind: kindForStatus(response.status), sentAt, receivedAt };
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { outcome: "failed", httpStatus: null, kind: "malformed", sentAt, receivedAt };
    }
    return {
      outcome: "succeeded",
      httpStatus: response.status,
      body,
      sha256: createHash("sha256").update(text, "utf8").digest("hex"),
      sentAt,
      receivedAt,
      durationMs: Math.max(0, now() - started),
    };
  }

  return {
    mode,
    host,
    async post(endpoint, tasks) {
      const first = await once(endpoint, tasks);
      // Sandbox calls are free: one retry on timeout. Live calls are never retried here.
      if (mode === "sandbox" && first.outcome === "unknown" && first.kind === "timeout") return once(endpoint, tasks);
      return first;
    },
  };
}
