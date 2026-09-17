/**
 * Which executor runs agent tasks, and the AI provider's settings, read from
 * the server environment.
 *
 *   NEXRA_AGENT_EXECUTOR   mock (default) | ai
 *   NEXRA_AI_PROVIDER      anthropic — required when the executor is ai
 *   ANTHROPIC_API_KEY      the provider key — a secret, server only
 *   NEXRA_AI_MODEL         optional; defaults to DEFAULT_ANTHROPIC_MODEL
 *
 * The mock executor stays the default: selecting `ai` is an explicit decision,
 * because it spends money on every attempt. With `ai` selected and the provider
 * incomplete, the runtime still starts — every attempt then fails with the
 * terminal `provider-not-configured` code, which the run history shows —
 * instead of silently falling back to simulated output.
 *
 * Values are never echoed. Errors and status name variables, not their
 * contents.
 */

export const EXECUTOR_VARIABLE = "NEXRA_AGENT_EXECUTOR";
export const PROVIDER_VARIABLE = "NEXRA_AI_PROVIDER";
export const ANTHROPIC_KEY_VARIABLE = "ANTHROPIC_API_KEY";
export const MODEL_VARIABLE = "NEXRA_AI_MODEL";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";

type Environment = Readonly<Record<string, string | undefined>>;

export type ExecutorSelection = "mock" | "ai";

export type AiProviderConfig =
  | {
      readonly status: "configured";
      readonly provider: "anthropic";
      readonly apiKey: string;
      readonly model: string;
    }
  /** `problem` names what is missing or wrong, without values. */
  | { readonly status: "unconfigured"; readonly problem: string };

export class AgentExecutorConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentExecutorConfigurationError";
  }
}

export function selectExecutor(env: Environment): ExecutorSelection {
  const value = env[EXECUTOR_VARIABLE]?.trim() ?? "";
  if (value === "" || value === "mock") return "mock";
  if (value === "ai") return "ai";
  throw new AgentExecutorConfigurationError(`${EXECUTOR_VARIABLE} must be "mock" or "ai".`);
}

const MODEL_PATTERN = /^[a-z0-9][a-z0-9.-]{2,63}$/;

export function readAiProviderConfig(env: Environment): AiProviderConfig {
  const exposed = Object.keys(env).filter(
    (name) => name.startsWith("NEXT_PUBLIC_") && /ANTHROPIC|NEXRA_AI|API_KEY/i.test(name) && Boolean(env[name]?.trim()),
  );
  if (exposed.length > 0) {
    // A key under a public name would have been bundled into the browser.
    throw new AgentExecutorConfigurationError(
      `${exposed.join(", ")} would be bundled into the browser. AI provider settings are server-only.`,
    );
  }

  const provider = env[PROVIDER_VARIABLE]?.trim() ?? "";
  if (provider === "") return { status: "unconfigured", problem: `${PROVIDER_VARIABLE} is not set.` };
  if (provider !== "anthropic") {
    return { status: "unconfigured", problem: `${PROVIDER_VARIABLE} must be "anthropic".` };
  }

  const apiKey = env[ANTHROPIC_KEY_VARIABLE]?.trim() ?? "";
  if (apiKey === "") return { status: "unconfigured", problem: `${ANTHROPIC_KEY_VARIABLE} is not set.` };
  if (/\s/.test(apiKey) || apiKey.length < 20) {
    return { status: "unconfigured", problem: `${ANTHROPIC_KEY_VARIABLE} is not a valid key.` };
  }

  const model = env[MODEL_VARIABLE]?.trim() || DEFAULT_ANTHROPIC_MODEL;
  if (!MODEL_PATTERN.test(model)) {
    return { status: "unconfigured", problem: `${MODEL_VARIABLE} is not a model id.` };
  }

  return { status: "configured", provider: "anthropic", apiKey, model };
}

/** What the status endpoint may say about execution. No values. */
export function describeExecution(env: Environment): {
  readonly executor: ExecutorSelection | "invalid";
  readonly aiProvider: "configured" | "unconfigured" | "invalid";
  readonly model: string | null;
} {
  let executor: ExecutorSelection | "invalid";
  try {
    executor = selectExecutor(env);
  } catch {
    executor = "invalid";
  }
  try {
    const config = readAiProviderConfig(env);
    return {
      executor,
      aiProvider: config.status,
      model: config.status === "configured" ? config.model : null,
    };
  } catch {
    return { executor, aiProvider: "invalid", model: null };
  }
}
