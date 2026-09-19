import type { ProjectRoster } from "@/lib/projects/contract";
import { PORTFOLIO_PROJECT } from "@/lib/mock/projects/roster";

/**
 * The projects a workspace can be scoped to, read from the Projects
 * repository — the same roster the Projects screen lists, so a project created
 * there is selectable everywhere without a second copy of it.
 *
 * Only what a picker needs: the id, the name, how to label the row, and
 * whether anything has measured the project. An unmeasured project can be
 * selected, but a screen must not present modelled figures for it as if they
 * described it.
 *
 * `domain`, `industry` and `initials` are identity, copied from the stored
 * record — what the project *is*, never what anything measured about it. The
 * Command Center's header reads them so it can name the selected project
 * without going back to the fixture roster, which knows only the nine
 * canonical ids.
 */
export type ProjectOption = {
  readonly id: string;
  readonly name: string;
  readonly measured: boolean;
  readonly domain: string;
  readonly industry: string;
  /** Two-letter monogram for the selector chip. */
  readonly initials: string;
};

export function projectOptionsFrom(roster: ProjectRoster): readonly ProjectOption[] {
  return roster.projects.map(
    ({ id, name, measured, domain, industry, initials }) => ({
      id,
      name,
      measured,
      domain,
      industry,
      initials,
    }),
  );
}

/**
 * The cross-project roll-up, as a selector option.
 *
 * Not a stored project and never one: `portfolio` is reserved, and the figures
 * behind it are the modelled aggregate of the canonical roster. Its caption is
 * left exactly as the roster writes it — the roll-up covers the nine measured
 * projects, so renumbering it as stored projects arrive would claim they are
 * in the total when nothing has measured them.
 *
 * `measured: true` because the roll-up does have figures; it is the one option
 * here that is not a project.
 */
export const PORTFOLIO_OPTION: ProjectOption = {
  id: PORTFOLIO_PROJECT.id,
  name: PORTFOLIO_PROJECT.name,
  measured: true,
  domain: PORTFOLIO_PROJECT.domain,
  industry: PORTFOLIO_PROJECT.industry,
  initials: PORTFOLIO_PROJECT.initials,
};

/**
 * The roll-up followed by the roster — the list both the Command Center and
 * Settings offer, built once so the two cannot drift.
 */
export function withPortfolioOption(
  projects: readonly ProjectOption[],
): readonly ProjectOption[] {
  return [PORTFOLIO_OPTION, ...projects];
}
