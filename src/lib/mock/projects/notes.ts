import { minutesBefore, pickSubset, randInt } from "@/lib/mock/dashboard/core";
import type { DashboardProject } from "@/types/dashboard";
import type { ProjectNote } from "@/types/project";

/**
 * The running account note on a project.
 *
 * Half the entries are written by the team and half are recorded by an agent,
 * which is how the log reads in an operation where both are working the same
 * account. Notes added on the page are frontend state and are not persisted —
 * there is no backend in this milestone (CLAUDE.md §4).
 */

type NoteSeed = Omit<ProjectNote, "id" | "at"> & {
  /** Age at the reference instant, in minutes. */
  readonly minutesAgo: number;
};

const POOL: readonly NoteSeed[] = [
  {
    body: "Client confirmed the replatform date has moved to the first week of November. Hold the migration checklist until we have a staging URL.",
    author: "Abdul Rehman",
    role: "Account lead",
    source: "team",
    minutesAgo: 190,
  },
  {
    body: "Crawl finished cleanly overnight. The 5xx cluster is contained to paginated category URLs, not the templates themselves.",
    author: "Technical SEO",
    role: "Agent",
    source: "agent",
    minutesAgo: 420,
  },
  {
    body: "Legal have asked us to avoid comparative claims against named competitors in any published copy. Passed on to the writing brief.",
    author: "Priya Raman",
    role: "SEO strategist",
    source: "team",
    minutesAgo: 1_450,
  },
  {
    body: "Reprioritised the sprint: technical fixes ahead of net-new content until the canonical issue is resolved.",
    author: "SEO Director",
    role: "Agent",
    source: "agent",
    minutesAgo: 2_180,
  },
  {
    body: "Client wants the monthly report to lead with pipeline rather than sessions. Reporting template updated for next cycle.",
    author: "Tom Alvarez",
    role: "Client partner",
    source: "team",
    minutesAgo: 4_300,
  },
  {
    body: "Answer-engine tracking added for eleven new prompts around the core category. First data lands after the next collection run.",
    author: "AI Visibility",
    role: "Agent",
    source: "agent",
    minutesAgo: 5_760,
  },
  {
    body: "Two of the lost referring domains have replied and are willing to reinstate the links once the resource page is republished.",
    author: "Authority & Backlink",
    role: "Agent",
    source: "agent",
    minutesAgo: 7_200,
  },
  {
    body: "Budget for the quarter is signed off. Scope stays as agreed — no additional markets before the review in December.",
    author: "Abdul Rehman",
    role: "Account lead",
    source: "team",
    minutesAgo: 10_080,
  },
  {
    body: "Keyword set re-clustered by intent. The commercial cluster is smaller than we assumed and the informational one is doing most of the work.",
    author: "Keyword & Search Intent",
    role: "Agent",
    source: "agent",
    minutesAgo: 12_960,
  },
  {
    body: "Kick-off held with the client's marketing team. Access to analytics and the CMS is granted; search console is still pending.",
    author: "Priya Raman",
    role: "SEO strategist",
    source: "team",
    minutesAgo: 20_160,
  },
];

/** The note history for one project, newest first. */
export function buildProjectNotes(
  project: DashboardProject,
): readonly ProjectNote[] {
  const count = randInt(project.seed + 57, 1, 3, 6);
  const selected = pickSubset(POOL, project.seed + 509, count);

  return selected
    .map((seed, index) => ({
      id: `${project.id}-note-${index + 1}`,
      body: seed.body,
      author: seed.author,
      role: seed.role,
      source: seed.source,
      at: minutesBefore(seed.minutesAgo),
    }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
