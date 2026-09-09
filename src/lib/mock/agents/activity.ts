import { minutesBefore, pickSubset, randInt } from "@/lib/mock/dashboard/core";
import { AGENT_REGISTRY } from "@/lib/mock/agents/registry";
import { projectsForAgent } from "@/lib/mock/agents/assignments";
import type { ActivityCategory, ActivityState } from "@/types/dashboard";
import type { AgentActivity, AgentId } from "@/types/agent";

/**
 * The audit trail for the agent team.
 *
 * Typed as the Command Center's own `ActivityEvent`, so this feed renders
 * through the same component the dashboard uses rather than a second one
 * written to look like it. The difference is only what it covers: the
 * dashboard's feed is one project's history, this is every agent's, across the
 * portfolio.
 *
 * Hand-authored per agent, then distributed across the projects that agent is
 * actually staffed on — an event against an engagement nobody is working would
 * be a lie the rest of the module would then have to keep.
 */

/** The category an agent's work is filed under in the feed. */
const CATEGORY: Record<AgentId, ActivityCategory> = {
  "seo-director": "agent",
  "project-manager": "agent",
  "market-intelligence": "competitor",
  "keyword-intent": "ranking",
  "content-strategist": "content",
  "research-evidence": "content",
  writer: "content",
  "on-page-seo": "content",
  "technical-seo": "technical",
  "ai-visibility": "ai-visibility",
  "authority-backlink": "authority",
  "analytics-learning": "ranking",
};

type ActivitySeed = {
  readonly title: string;
  readonly detail: string;
  readonly state: ActivityState;
};

const POOL: Record<AgentId, readonly ActivitySeed[]> = {
  "seo-director": [
    {
      title: "Campaign plan approved",
      detail: "Next cycle signed off: technical recovery first, then the comparison cluster.",
      state: "success",
    },
    {
      title: "Priorities resequenced",
      detail: "Content work moved behind the indexation fix after the latest coverage read.",
      state: "info",
    },
    {
      title: "Escalation raised",
      detail: "Two projects need the same capacity this window; a ruling is waiting on the account lead.",
      state: "warning",
    },
  ],
  "project-manager": [
    {
      title: "Sprint board reconciled",
      detail: "22 tasks closed against scope, four carried into the next sprint.",
      state: "success",
    },
    {
      title: "Milestone rescheduled",
      detail: "Content delivery moved out by a week to clear the technical dependency first.",
      state: "warning",
    },
    {
      title: "Onboarding checklist advanced",
      detail: "Baseline crawl and analytics access confirmed; keyword sign-off outstanding.",
      state: "info",
    },
  ],
  "market-intelligence": [
    {
      title: "Competitor gained visibility",
      detail: "A rival added 38 shared terms to the top ten after publishing a hub page.",
      state: "warning",
    },
    {
      title: "Competitor set refreshed",
      detail: "Two new entrants profiled and added to the tracked rival list.",
      state: "info",
    },
    {
      title: "Share of voice recalculated",
      detail: "Visibility across the tracked set re-measured against the previous window.",
      state: "success",
    },
  ],
  "keyword-intent": [
    {
      title: "Clustering completed",
      detail: "412 discovered terms grouped into 18 clusters and classified by intent.",
      state: "success",
    },
    {
      title: "Intent reclassified",
      detail: "96 terms re-read after their SERPs changed shape this month.",
      state: "info",
    },
    {
      title: "Cannibalisation detected",
      detail: "Two pages found competing for the same commercial cluster.",
      state: "warning",
    },
  ],
  "content-strategist": [
    {
      title: "Content brief generated",
      detail: "Brief drafted for the comparison hub with 14 sourced citations attached.",
      state: "info",
    },
    {
      title: "Topical map published",
      detail: "Hub and spoke structure agreed for the highest-value cluster.",
      state: "success",
    },
    {
      title: "Refresh queue built",
      detail: "Six decaying guides scheduled for rewrite against updated outlines.",
      state: "info",
    },
  ],
  "research-evidence": [
    {
      title: "Evidence pack verified",
      detail: "38 regulatory claims checked against primary sources and approved.",
      state: "success",
    },
    {
      title: "Claim could not be substantiated",
      detail: "A central statistic in the draft has no primary source and was flagged.",
      state: "warning",
    },
    {
      title: "Citations refreshed",
      detail: "Statistics older than eighteen months replaced across eleven live pages.",
      state: "info",
    },
  ],
  writer: [
    {
      title: "Article draft generated",
      detail: "Eight product-comparison drafts completed against approved briefs.",
      state: "success",
    },
    {
      title: "Draft submitted for review",
      detail: "Buyer's guide queued for editorial review before on-page optimisation.",
      state: "info",
    },
    {
      title: "Rewrite completed",
      detail: "Three decaying guides rewritten to the refreshed outline.",
      state: "success",
    },
  ],
  "on-page-seo": [
    {
      title: "Article optimised",
      detail: "On-page pass applied to the comparison hub, including entity markup.",
      state: "success",
    },
    {
      title: "Metadata rewritten",
      detail: "Titles and descriptions replaced on 126 pages with low click-through.",
      state: "info",
    },
    {
      title: "Cannibalisation resolved",
      detail: "Two competing guides consolidated behind a single canonical target.",
      state: "success",
    },
  ],
  "technical-seo": [
    {
      title: "Indexing issue found",
      detail: "A noindex directive survived the migration and is served on a whole segment.",
      state: "critical",
    },
    {
      title: "Fix deployed",
      detail: "Redirect chains collapsed to a single hop on 205 legacy category URLs.",
      state: "success",
    },
    {
      title: "Crawl completed",
      detail: "Full crawl finished with 48,240 URLs discovered and 14 defects raised.",
      state: "info",
    },
  ],
  "ai-visibility": [
    {
      title: "AI citation opportunity identified",
      detail: "Eleven comparison prompts return an answer with no cited source of authority.",
      state: "info",
    },
    {
      title: "Citation earned in AI answers",
      detail: "Cited by two answer engines across the tracked comparison prompt set.",
      state: "success",
    },
    {
      title: "Answer share slipping",
      detail: "A cluster is holding rankings while losing clicks to AI Overviews.",
      state: "warning",
    },
  ],
  "authority-backlink": [
    {
      title: "Link prospect added",
      detail: "A trade publication with an authority score of 81 qualified for outreach.",
      state: "info",
    },
    {
      title: "Backlink acquired",
      detail: "Followed link earned from the annual industry report campaign.",
      state: "success",
    },
    {
      title: "Referring domains lost",
      detail: "Three linking pages retired during a restructure; reclamation opened.",
      state: "warning",
    },
  ],
  "analytics-learning": [
    {
      title: "Performance model updated",
      detail: "Attribution re-run across the window with the latest conversion data.",
      state: "success",
    },
    {
      title: "Learnings returned to the Director",
      detail: "Comparison content returned fastest this quarter; next cycle re-weighted.",
      state: "info",
    },
    {
      title: "Attribution run blocked",
      detail: "The analytics export returned an incomplete date range and the run stopped.",
      state: "critical",
    },
  ],
};

let cache: readonly AgentActivity[] | null = null;

/** The whole team's activity, newest first. */
export function getAgentActivity(): readonly AgentActivity[] {
  cache ??= build();
  return cache;
}

/** Activity recorded against one agent, newest first. */
export function activityForAgent(agentId: AgentId): readonly AgentActivity[] {
  return getAgentActivity().filter((event) => event.agent === agentId);
}

function build(): readonly AgentActivity[] {
  const events: AgentActivity[] = [];

  for (const agent of AGENT_REGISTRY) {
    const seeds = POOL[agent.id];
    const assigned = projectsForAgent(agent.id);
    if (assigned.length === 0) continue;

    // Two to four projects per agent keeps the feed readable while still
    // covering the roster: every project appears through somebody.
    const projects = pickSubset(
      assigned,
      agent.seed + 61,
      Math.min(assigned.length, randInt(agent.seed, 7, 2, 4)),
    );

    projects.forEach((project, index) => {
      const seed = seeds[(agent.stage + index) % seeds.length];

      events.push({
        id: `${agent.id}-${project.id}-activity-${index + 1}`,
        category: CATEGORY[agent.id],
        // The feed renders the agent name beside the title, so the title
        // itself stays the event, not the actor.
        title: seed.title,
        detail: seed.detail,
        agent: agent.id,
        at: minutesBefore(randInt(agent.seed + index, 9, 12, 5_400)),
        state: seed.state,
        project: project.name,
      });
    });
  }

  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
