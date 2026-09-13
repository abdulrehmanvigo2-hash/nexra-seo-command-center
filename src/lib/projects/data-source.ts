/**
 * Which store the Projects repository reads.
 *
 * Chosen explicitly, never inferred. Supabase credentials being present is not
 * enough to switch: a deployment that happens to carry them for another reason
 * keeps serving the mock data until `PROJECTS_DATA_SOURCE=supabase` says
 * otherwise. Unset means mock, and anything unrecognised is an error rather
 * than a guess.
 */

export const PROJECT_DATA_SOURCE_VARIABLE = "PROJECTS_DATA_SOURCE";

export const PROJECT_DATA_SOURCES = ["mock", "supabase"] as const;

export type ProjectDataSource = (typeof PROJECT_DATA_SOURCES)[number];

export function selectProjectDataSource(
  env: Readonly<Record<string, string | undefined>>,
): ProjectDataSource {
  const value = env[PROJECT_DATA_SOURCE_VARIABLE]?.trim() ?? "";
  if (value === "") return "mock";

  const source = PROJECT_DATA_SOURCES.find((entry) => entry === value);
  if (!source) {
    throw new Error(
      `${PROJECT_DATA_SOURCE_VARIABLE} is "${value}"; expected ${PROJECT_DATA_SOURCES.map((entry) => `"${entry}"`).join(" or ")}.`,
    );
  }
  return source;
}
