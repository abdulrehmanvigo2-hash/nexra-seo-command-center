import { looksLikeSecret } from "@/lib/agent-runs/safety";
import type { AgentId } from "@/types/agent";
import type { AgentTaskType, JsonObject } from "@/types/agent-run";

/**
 * The tasks an agent can be asked to run, and the input each accepts.
 *
 * Deliberately few, and all read-only: a task here asks an agent to look and
 * report. Nothing publishes, sends, builds links, or changes a site — those
 * need review gates the runtime does not have yet.
 *
 * Each task type parses its input strictly: an unknown field is refused, not
 * ignored, so nothing the caller did not mean to store is stored.
 */

export type TaskInputResult =
  | { readonly ok: true; readonly value: JsonObject }
  | { readonly ok: false; readonly error: string };

export type TaskTypeDefinition = {
  readonly id: AgentTaskType;
  readonly label: string;
  readonly description: string;
  /** The agents allowed to run it, or every agent. */
  readonly agents: readonly AgentId[] | "any";
  parseInput(input: unknown): TaskInputResult;
};

function objectWithOnly(
  input: unknown,
  allowed: readonly string[],
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, value: {} };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Task input must be an object." };
  }
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Task input has fields this task does not accept: ${unknown.slice(0, 5).join(", ")}.`,
    };
  }
  return { ok: true, value: input as Record<string, unknown> };
}

/** Collapses whitespace; refuses control characters and credential-like text. */
function cleanText(value: unknown, field: string, max: number): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: `${field} must be text.` };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    return { ok: false, error: `${field} contains control characters.` };
  }
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length > max) return { ok: false, error: `${field} must be ${max} characters or fewer.` };
  if (looksLikeSecret(text)) {
    return { ok: false, error: `${field} looks like it contains a credential. Remove it.` };
  }
  return { ok: true, value: text };
}

const projectReview: TaskTypeDefinition = {
  id: "project-review",
  label: "Project review",
  description: "Review the project from this agent's discipline and summarise what it finds.",
  agents: "any",
  parseInput(input): TaskInputResult {
    const object = objectWithOnly(input, ["focus"]);
    if (!object.ok) return object;
    if (object.value.focus === undefined) return { ok: true, value: {} };
    const focus = cleanText(object.value.focus, "Focus", 300);
    if (!focus.ok) return focus;
    if (!focus.value) return { ok: true, value: {} };
    return { ok: true, value: { focus: focus.value } };
  },
};

const MAX_SEED_KEYWORDS = 25;

const keywordResearch: TaskTypeDefinition = {
  id: "keyword-research",
  label: "Keyword research",
  description: "Expand seed keywords into candidates with search intent.",
  agents: ["keyword-intent"],
  parseInput(input): TaskInputResult {
    const object = objectWithOnly(input, ["seedKeywords"]);
    if (!object.ok) return object;
    const seeds = object.value.seedKeywords;
    if (!Array.isArray(seeds) || seeds.length === 0) {
      return { ok: false, error: "seedKeywords must list at least one keyword." };
    }
    if (seeds.length > MAX_SEED_KEYWORDS) {
      return { ok: false, error: `seedKeywords can list at most ${MAX_SEED_KEYWORDS} keywords.` };
    }
    const keywords: string[] = [];
    for (const seed of seeds) {
      const keyword = cleanText(seed, "A seed keyword", 80);
      if (!keyword.ok) return keyword;
      const normalised = keyword.value.toLowerCase();
      if (normalised.length === 0) return { ok: false, error: "A seed keyword is empty." };
      if (!keywords.includes(normalised)) keywords.push(normalised);
    }
    return { ok: true, value: { seedKeywords: keywords } };
  },
};

export const TASK_TYPES: readonly TaskTypeDefinition[] = [projectReview, keywordResearch];

export function getTaskType(id: unknown): TaskTypeDefinition | undefined {
  return TASK_TYPES.find((definition) => definition.id === id);
}

export function isAgentTaskType(value: unknown): value is AgentTaskType {
  return getTaskType(value) !== undefined;
}

export function agentMayRun(definition: TaskTypeDefinition, agentId: AgentId): boolean {
  return definition.agents === "any" || definition.agents.includes(agentId);
}
