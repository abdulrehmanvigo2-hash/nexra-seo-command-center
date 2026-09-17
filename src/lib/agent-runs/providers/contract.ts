/**
 * What an AI executor needs from a language-model provider, and nothing more.
 *
 * One request in, plain text and token counts out. The executor builds the
 * request from the agent registry and the task type, never from free-form
 * operator text, and screens the answer before anything is stored. A provider
 * never sees the run record, the operator, or a credential other than its own
 * key, which it reads from the server environment.
 *
 * Failures are classified, not described: `unavailable` (network, rate limit,
 * overload, server error — worth retrying later) or `rejected` (a refused,
 * truncated, or invalid request or answer — retrying would fail the same way).
 * The provider's own error text is never passed on.
 */

export type ModelRequest = {
  /** Fixed per agent and task type. */
  readonly system: string;
  /** The task, built from validated fields only. */
  readonly prompt: string;
  readonly maxOutputTokens: number;
};

export type ModelResponse = {
  readonly text: string;
  /** The model that actually answered, which may differ from the one requested after a fallback. */
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
};

export type ModelProviderId = "anthropic";

export type ModelProvider = {
  readonly id: ModelProviderId;
  /** The model requested by default. */
  readonly model: string;
  generate(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
};

export type ProviderFailureKind = "unavailable" | "rejected";

export class ProviderError extends Error {
  readonly kind: ProviderFailureKind;

  constructor(kind: ProviderFailureKind) {
    super(`Model provider request ${kind}`);
    this.name = "ProviderError";
    this.kind = kind;
  }
}
