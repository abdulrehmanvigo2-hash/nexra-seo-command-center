import type {
  NewProjectInput,
  ProjectGoal,
  ProjectStatus,
  ProjectType,
} from "@/types/project";

/**
 * The rules a new project has to satisfy, in one place.
 *
 * The intake dialog checks them in the browser so a mistake is caught while the
 * form is open; `parseNewProjectInput` checks them again on the server, because
 * a browser check is a convenience and never a guarantee. Both read the same
 * pattern and limits from here, so they cannot drift apart. The database
 * enforces the same shape once more in its constraints
 * (supabase/migrations/…_create_projects.sql).
 */

/** Accepts a bare host or a full URL; rejects anything without a dot. */
export const DOMAIN_PATTERN = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i;

/** Competitors a project can be created with. */
export const MAX_COMPETITORS = 5;

const LIMITS = {
  name: { min: 2, max: 120 },
  client: { min: 1, max: 120 },
  shortText: { min: 1, max: 80 },
  targetLocation: { min: 1, max: 120 },
  notes: { max: 2000 },
} as const;

/**
 * A list that names every member of a union, checked at compile time — adding
 * a status to the type without adding it here is a type error, not a silent
 * gap in validation.
 */
function everyMember<T extends string>() {
  return <const L extends readonly T[]>(
    list: L & ([Exclude<T, L[number]>] extends [never] ? unknown : never),
  ): L => list;
}

export const PROJECT_TYPES = everyMember<ProjectType>()([
  "saas",
  "ecommerce",
  "local",
  "lead-gen",
  "publisher",
  "enterprise",
  "other",
]);

export const PROJECT_STATUSES = everyMember<ProjectStatus>()([
  "active",
  "onboarding",
  "monitoring",
  "paused",
  "needs-attention",
]);

export const PROJECT_GOALS = everyMember<ProjectGoal>()([
  "organic-traffic",
  "leads",
  "rankings",
  "ecommerce-revenue",
  "local-visibility",
  "ai-visibility",
  "technical-recovery",
]);

export function isProjectType(value: unknown): value is ProjectType {
  return PROJECT_TYPES.some((entry) => entry === value);
}

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return PROJECT_STATUSES.some((entry) => entry === value);
}

export function isProjectGoal(value: unknown): value is ProjectGoal {
  return PROJECT_GOALS.some((entry) => entry === value);
}

/** Two-letter monogram from a project name. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "NP";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Strips the scheme and any trailing slash, leaving the bare host and path. */
export function normaliseDomain(url: string): string {
  return url
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

/**
 * The form a domain is stored in: normalised and lower case, so one site cannot
 * be registered twice as `Acme.example` and `https://acme.example/`.
 */
export function canonicalDomain(url: string): string {
  return normaliseDomain(url).toLowerCase();
}

/**
 * A route-safe id from a project name: lower case, hyphen-separated, at most
 * 48 characters so a numeric suffix still fits the 64-character limit.
 */
export function projectSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
}

// ---------------------------------------------------------------------------
// Server-side validation
// ---------------------------------------------------------------------------

export type NewProjectErrors = Readonly<
  Partial<Record<keyof NewProjectInput, string>>
>;

/** A new project that has passed every rule, in stored form. */
export type ValidNewProject = {
  readonly name: string;
  readonly client: string;
  readonly domain: string;
  readonly industry: string;
  readonly market: string;
  readonly language: string;
  readonly type: ProjectType;
  readonly goal: ProjectGoal;
  readonly targetLocation: string;
  readonly competitorDomains: readonly string[];
  readonly notes: string;
};

export type ParsedNewProject =
  | { readonly ok: true; readonly value: ValidNewProject }
  | { readonly ok: false; readonly errors: NewProjectErrors };

function text(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function within(value: string, { min = 0, max }: { min?: number; max: number }) {
  return value.length >= min && value.length <= max;
}

/**
 * Validates an intake submission that arrived from outside the server.
 *
 * Accepts `unknown` rather than `NewProjectInput` because a typed parameter says
 * nothing about what a request actually carried. The wording of the messages
 * matches the intake dialog's, so a rule failing here reads the same as it
 * does in the form.
 */
export function parseNewProjectInput(input: unknown): ParsedNewProject {
  const source: Record<string, unknown> =
    typeof input === "object" && input !== null ? { ...input } : {};
  const errors: Partial<Record<keyof NewProjectInput, string>> = {};

  const name = text(source.name) ?? "";
  if (!within(name, LIMITS.name)) {
    errors.name =
      name.length < LIMITS.name.min
        ? "Give the project a name of at least two characters."
        : `Keep the project name under ${LIMITS.name.max} characters.`;
  }

  const url = text(source.url) ?? "";
  if (url.length === 0) {
    errors.url = "A website is required — it is what gets crawled.";
  } else if (!DOMAIN_PATTERN.test(url)) {
    errors.url = "Enter a domain or full URL, for example acme.example.";
  }

  const client = text(source.client) ?? "";
  if (!within(client, LIMITS.client)) {
    errors.client =
      client.length === 0
        ? "Name the client this project is delivered for."
        : `Keep the client name under ${LIMITS.client.max} characters.`;
  }

  const industry = text(source.industry) ?? "";
  if (!within(industry, LIMITS.shortText)) errors.industry = "Choose an industry.";

  const market = text(source.market) ?? "";
  if (!within(market, LIMITS.shortText)) errors.market = "Choose a market.";

  const language = text(source.language) ?? "";
  if (!within(language, LIMITS.shortText)) errors.language = "Choose a language.";

  if (!isProjectType(source.type)) errors.type = "Choose a project type.";
  if (!isProjectGoal(source.goal)) errors.goal = "Choose a primary goal.";

  // The dialog falls back to the market when no location is given, so an
  // empty location is only possible when the market is missing too — and that
  // is already reported against the market.
  const targetLocation = text(source.targetLocation) || market;
  if (targetLocation.length > LIMITS.targetLocation.max) {
    errors.targetLocation = `Keep the target location under ${LIMITS.targetLocation.max} characters.`;
  }

  const rawCompetitors = Array.isArray(source.competitors)
    ? source.competitors
    : source.competitors === undefined
      ? []
      : null;
  const competitorEntries = (rawCompetitors ?? [])
    .map((entry) => text(entry))
    .filter((entry): entry is string => entry !== null && entry.length > 0);
  const invalidCompetitors = competitorEntries.filter(
    (entry) => !DOMAIN_PATTERN.test(entry),
  );
  const competitorDomains = [...new Set(competitorEntries.map(canonicalDomain))];
  if (rawCompetitors === null) {
    errors.competitors = "Competitors must be a list of domains.";
  } else if (invalidCompetitors.length > 0) {
    errors.competitors = `Not a valid domain: ${invalidCompetitors.join(", ")}`;
  } else if (competitorDomains.length > MAX_COMPETITORS) {
    errors.competitors = `Track at most ${MAX_COMPETITORS} competitors.`;
  }

  const notes = text(source.notes) ?? "";
  if (!within(notes, LIMITS.notes)) {
    errors.notes = `Keep notes under ${LIMITS.notes.max} characters.`;
  }

  if (Object.keys(errors).length > 0 || !isProjectType(source.type) || !isProjectGoal(source.goal)) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      name,
      client,
      domain: canonicalDomain(url),
      industry,
      market,
      language,
      type: source.type,
      goal: source.goal,
      targetLocation,
      competitorDomains,
      notes,
    },
  };
}
