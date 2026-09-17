import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import {
  ProviderError,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
} from "@/lib/agent-runs/providers/contract";

/**
 * The Anthropic provider: one Messages API request per attempt.
 *
 * Server-only — the key is read from the server environment by the caller and
 * handed in here, and the SDK sends it in a header that is never logged.
 *
 * Choices:
 *   * No SDK retries (`maxRetries: 0`). Retrying is the runtime's job: it
 *     backs off across attempts and records each one, where silent in-client
 *     retries would spend the attempt's timeout invisibly.
 *   * Server-side refusal fallbacks (`fallbacks: "default"`), so a request a
 *     safety classifier declines is answered by Anthropic's recommended
 *     fallback model instead of failing. If the whole chain still refuses,
 *     the attempt fails as `rejected`.
 *   * The answer is the text blocks only. A response cut off at `max_tokens`
 *     is refused rather than stored half-finished.
 *   * Errors are classified by status — 408/409/429/5xx and connection
 *     failures are `unavailable`, every other status is `rejected` — and the
 *     SDK's error, which can quote the request, is dropped.
 */
export function createAnthropicProvider(options: {
  readonly apiKey: string;
  readonly model: string;
  /** Per-request ceiling; the runtime's attempt timeout is the real bound. */
  readonly timeoutMs: number;
  /** Tests substitute the transport; the application never does. */
  readonly fetch?: typeof fetch;
}): ModelProvider {
  const client = new Anthropic({
    apiKey: options.apiKey,
    maxRetries: 0,
    timeout: options.timeoutMs,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  return {
    id: "anthropic",
    model: options.model,

    async generate(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
      let message: Anthropic.Beta.BetaMessage;
      try {
        message = await client.beta.messages.create(
          {
            model: options.model,
            max_tokens: request.maxOutputTokens,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            system: request.system,
            messages: [{ role: "user", content: request.prompt }],
          },
          { signal },
        );
      } catch (error) {
        throw new ProviderError(classify(error));
      }

      if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") {
        throw new ProviderError("rejected");
      }

      const text = message.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      if (text.length === 0) throw new ProviderError("rejected");

      return {
        text,
        model: message.model,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      };
    },
  };
}

function classify(error: unknown): "unavailable" | "rejected" {
  if (error instanceof Anthropic.APIConnectionError) return "unavailable";
  if (error instanceof Anthropic.RateLimitError) return "unavailable";
  if (error instanceof Anthropic.InternalServerError) return "unavailable";
  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    if (status === 408 || status === 409 || (typeof status === "number" && status >= 500)) {
      return "unavailable";
    }
    return "rejected";
  }
  // An abort or anything unexpected: treat as transient so a retry decides.
  return "unavailable";
}
