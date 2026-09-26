/**
 * Mock workspace and account data for the application shell.
 *
 * Fixtures only for the shell's workspace and account chrome; the backend, auth
 * and APIs live outside `@/lib/mock`.
 * Module-level mock SEO datasets arrive with their own phases.
 */

export type Workspace = {
  readonly id: string;
  readonly name: string;
  readonly plan: string;
  readonly projectCount: number;
};

export const WORKSPACES: readonly Workspace[] = [
  { id: "nexra-agency", name: "Nexra Agency", plan: "Agency", projectCount: 12 },
  { id: "northwind-group", name: "Northwind Group", plan: "Growth", projectCount: 4 },
  { id: "atlas-commerce", name: "Atlas Commerce", plan: "Growth", projectCount: 3 },
] as const;

export const DEFAULT_WORKSPACE_ID = "nexra-agency";

export type CurrentUser = {
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly initials: string;
};

export const CURRENT_USER: CurrentUser = {
  name: "Abdul Rehman",
  email: "abdulrehman@nexra.io",
  role: "Workspace owner",
  initials: "AR",
};
