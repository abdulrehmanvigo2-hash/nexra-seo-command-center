import type { ProjectRoster } from "@/lib/projects/contract";

/**
 * The projects a workspace can be scoped to, read from the Projects
 * repository — the same roster the Projects screen lists, so a project created
 * there is selectable everywhere without a second copy of it.
 *
 * Only what a picker needs: the id, the name, and whether anything has
 * measured the project. An unmeasured project can be selected, but a screen
 * must not present modelled figures for it as if they described it.
 */
export type ProjectOption = {
  readonly id: string;
  readonly name: string;
  readonly measured: boolean;
};

export function projectOptionsFrom(roster: ProjectRoster): readonly ProjectOption[] {
  return roster.projects.map(({ id, name, measured }) => ({ id, name, measured }));
}
