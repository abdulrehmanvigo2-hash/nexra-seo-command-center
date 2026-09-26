import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  AgentExecutorConfigurationError,
  ANTHROPIC_KEY_VARIABLE,
  DEFAULT_ANTHROPIC_MODEL,
  describeExecution,
  EXECUTOR_VARIABLE,
  MODEL_VARIABLE,
  PROVIDER_VARIABLE,
  readAiProviderConfig,
  selectExecutor,
} from "./providers/config.ts";

/**
 * Which executor runs, and whether the AI provider is usable — the matrix
 * behind every attempt's cost. The mock executor is the default so that
 * spending is always an explicit setting; a public-prefixed variable that
 * could have bundled a key is refused outright.
 */

const KEY = "sk-ant-placeholder-key-for-tests-0000";
const CONFIGURED = { [PROVIDER_VARIABLE]: "anthropic", [ANTHROPIC_KEY_VARIABLE]: KEY };

describe("selectExecutor", () => {
  test("unset, blank or `mock` is the mock executor", () => {
    assert.equal(selectExecutor({}), "mock");
    assert.equal(selectExecutor({ [EXECUTOR_VARIABLE]: "" }), "mock");
    assert.equal(selectExecutor({ [EXECUTOR_VARIABLE]: "  " }), "mock");
    assert.equal(selectExecutor({ [EXECUTOR_VARIABLE]: " mock " }), "mock");
  });

  test("`ai` selects the AI executor, and nothing else is accepted", () => {
    assert.equal(selectExecutor({ [EXECUTOR_VARIABLE]: "ai" }), "ai");
    assert.equal(selectExecutor({ [EXECUTOR_VARIABLE]: " ai\n" }), "ai");
    for (const value of ["AI", "Mock", "anthropic", "true", "1"]) {
      assert.throws(() => selectExecutor({ [EXECUTOR_VARIABLE]: value }), AgentExecutorConfigurationError, value);
    }
  });
});

describe("readAiProviderConfig", () => {
  test("a complete configuration reads to the provider, key and default model", () => {
    assert.deepEqual(readAiProviderConfig(CONFIGURED), { status: "configured", provider: "anthropic", apiKey: KEY, model: DEFAULT_ANTHROPIC_MODEL });
    assert.equal(readAiProviderConfig({ ...CONFIGURED, [MODEL_VARIABLE]: " claude-opus-5 " }).status, "configured");
    assert.equal(readAiProviderConfig({ ...CONFIGURED, [MODEL_VARIABLE]: "" }).status, "configured");
  });

  test("an explicit model is used when it is a model id, and refused otherwise", () => {
    const config = readAiProviderConfig({ ...CONFIGURED, [MODEL_VARIABLE]: "claude-sonnet-5" });
    assert.equal(config.status === "configured" && config.model, "claude-sonnet-5");
    for (const model of ["Claude-Opus-5", "ab", "has space", "model/x", "x".repeat(65)]) {
      const refused = readAiProviderConfig({ ...CONFIGURED, [MODEL_VARIABLE]: model });
      assert.equal(refused.status, "unconfigured", model);
      if (refused.status === "unconfigured") assert.ok(refused.problem.includes(MODEL_VARIABLE) && !refused.problem.includes(model));
    }
  });

  test("a missing or unknown provider, or a missing or malformed key, is unconfigured and names the variable only", () => {
    for (const [env, fragment] of [
      [{}, `${PROVIDER_VARIABLE} is not set`],
      [{ [PROVIDER_VARIABLE]: "openai", [ANTHROPIC_KEY_VARIABLE]: KEY }, `${PROVIDER_VARIABLE} must be "anthropic"`],
      [{ [PROVIDER_VARIABLE]: "Anthropic", [ANTHROPIC_KEY_VARIABLE]: KEY }, `${PROVIDER_VARIABLE} must be "anthropic"`],
      [{ [PROVIDER_VARIABLE]: "anthropic" }, `${ANTHROPIC_KEY_VARIABLE} is not set`],
      [{ [PROVIDER_VARIABLE]: "anthropic", [ANTHROPIC_KEY_VARIABLE]: "short-key" }, `${ANTHROPIC_KEY_VARIABLE} is not a valid key`],
      [{ [PROVIDER_VARIABLE]: "anthropic", [ANTHROPIC_KEY_VARIABLE]: `${KEY} with-space` }, `${ANTHROPIC_KEY_VARIABLE} is not a valid key`],
    ] as const) {
      const config = readAiProviderConfig(env);
      assert.equal(config.status, "unconfigured");
      if (config.status === "unconfigured") {
        assert.ok(config.problem.includes(fragment), config.problem);
        assert.ok(!config.problem.includes(KEY) && !config.problem.includes("short-key"), "a value was echoed");
      }
    }
  });

  test("a browser-exposed variable that could carry the key is refused, and its value is not echoed", () => {
    for (const name of ["NEXT_PUBLIC_ANTHROPIC_API_KEY", "NEXT_PUBLIC_NEXRA_AI_MODEL", "NEXT_PUBLIC_SOME_API_KEY"]) {
      assert.throws(
        () => readAiProviderConfig({ ...CONFIGURED, [name]: "leaked-value" }),
        (error: unknown) =>
          error instanceof AgentExecutorConfigurationError && error.message.includes(name) && error.message.includes("browser") && !error.message.includes("leaked-value"),
        name,
      );
    }
    // Empty exposed variables and unrelated public ones are ignored.
    assert.equal(readAiProviderConfig({ ...CONFIGURED, NEXT_PUBLIC_ANTHROPIC_API_KEY: "  " }).status, "configured");
    assert.equal(readAiProviderConfig({ ...CONFIGURED, NEXT_PUBLIC_SITE_NAME: "Nexra" }).status, "configured");
  });
});

describe("describeExecution: what the status endpoint may say", () => {
  test("names the executor and the provider state, and the model only when configured", () => {
    assert.deepEqual(describeExecution({}), { executor: "mock", aiProvider: "unconfigured", model: null });
    assert.deepEqual(describeExecution({ [EXECUTOR_VARIABLE]: "ai", ...CONFIGURED }), { executor: "ai", aiProvider: "configured", model: DEFAULT_ANTHROPIC_MODEL });
    assert.deepEqual(describeExecution({ [EXECUTOR_VARIABLE]: "ai" }), { executor: "ai", aiProvider: "unconfigured", model: null });
  });

  test("an invalid executor or an exposed variable is reported as invalid, never thrown", () => {
    assert.deepEqual(describeExecution({ [EXECUTOR_VARIABLE]: "gpt", ...CONFIGURED }), { executor: "invalid", aiProvider: "configured", model: DEFAULT_ANTHROPIC_MODEL });
    assert.deepEqual(describeExecution({ ...CONFIGURED, NEXT_PUBLIC_ANTHROPIC_API_KEY: "x" }), { executor: "mock", aiProvider: "invalid", model: null });
  });

  test("the description never carries the key", () => {
    assert.ok(!JSON.stringify(describeExecution({ [EXECUTOR_VARIABLE]: "ai", ...CONFIGURED })).includes(KEY));
  });
});
