import { minutesBefore, pickSubset, randInt, scoreFor } from "@/lib/mock/dashboard/core";
import { AGENT_REGISTRY, getAgentRecord } from "@/lib/mock/agents/registry";
import { projectsForAgent } from "@/lib/mock/agents/assignments";
import { getProjectRecord } from "@/lib/mock/projects/roster";
import type {
  AgentId,
  AgentOutput,
  AgentOutputStatus,
} from "@/types/agent";

/**
 * The deliverables the agents have filed.
 *
 * Hand-authored per agent rather than generated, because a deliverable is the
 * one thing on this screen a person reads as a sentence: "Commercial banking
 * cluster map, 412 terms" tells you what was produced, where a generated
 * string would not. Which projects each set is filed against, when, and in
 * what state is derived, so the volume scales with the roster.
 *
 * Nothing here is a real artifact. `View` opens nothing in this milestone;
 * these are fixtures for a module that has no storage behind it yet
 * (CLAUDE.md §4).
 */

type OutputSeed = {
  /** Kind of deliverable, drawn from the agent's registry entry. */
  readonly type: string;
  readonly title: string;
};

const POOL: Record<AgentId, readonly OutputSeed[]> = {
  "seo-director": [
    { type: "Strategy decision", title: "Quarterly priority order, content before authority" },
    { type: "Roadmap update", title: "Revised Q4 roadmap after the September analytics read" },
    { type: "Priority ruling", title: "Technical recovery takes the next two sprints" },
    { type: "Strategy decision", title: "Cluster rollout sequence for the comparison hub" },
  ],
  "project-manager": [
    { type: "Delivery plan", title: "September delivery plan with two milestones rescheduled" },
    { type: "Sprint summary", title: "Sprint 18 summary: 22 tasks closed, 4 carried" },
    { type: "Scope change", title: "Scope note: schema work moved into the technical stream" },
    { type: "Delivery plan", title: "Onboarding schedule through to first published cluster" },
  ],
  "market-intelligence": [
    { type: "Competitor report", title: "Rival set for the commercial cluster, ranked by overlap" },
    { type: "Share-of-voice study", title: "Share of voice across 240 shared terms, 90 days" },
    { type: "Market landscape", title: "Two new entrants profiled after top-ten changes" },
    { type: "Competitor report", title: "Content coverage gap against the three closest rivals" },
  ],
  "keyword-intent": [
    { type: "Keyword cluster", title: "Commercial cluster map, 412 terms in 18 groups" },
    { type: "Intent classification", title: "Intent re-read on 96 terms whose SERPs changed shape" },
    { type: "Opportunity list", title: "Striking-distance list, positions 11 to 20" },
    { type: "Keyword cluster", title: "Long-tail pool scored against the conversion model" },
  ],
  "content-strategist": [
    { type: "Content brief", title: "Brief: buyer's guide for the top commercial cluster" },
    { type: "Topical map", title: "Topical map for the comparison hub, 14 pages" },
    { type: "Internal-link plan", title: "Internal-link plan routing authority to the money pages" },
    { type: "Content brief", title: "Refresh brief for the six guides flagged as decaying" },
  ],
  "research-evidence": [
    { type: "Evidence pack", title: "Evidence pack: 38 regulatory claims, sourced and dated" },
    { type: "Source verification", title: "Primary sources for the annual industry report" },
    { type: "Citation set", title: "Citation refresh on statistics older than eighteen months" },
    { type: "Evidence pack", title: "Claim check for the compliance guide rewrite" },
  ],
  writer: [
    { type: "Article draft", title: "Draft: eight product-comparison pages against brief" },
    { type: "Page copy", title: "Category copy for the twelve highest-value listings" },
    { type: "FAQ block", title: "Answer blocks for the top 20 question queries" },
    { type: "Article draft", title: "Rewrite of three decaying guides to the new outline" },
  ],
  "on-page-seo": [
    { type: "Optimised article", title: "On-page pass applied to the comparison hub" },
    { type: "Metadata set", title: "Titles and descriptions rewritten for 126 low-click pages" },
    { type: "Entity markup", title: "Entity and internal-link additions on the money pages" },
    { type: "Optimised article", title: "Cannibalisation fix across two competing guides" },
  ],
  "technical-seo": [
    { type: "Technical audit", title: "Crawl audit: 48,240 URLs, 14 defects raised" },
    { type: "Schema recommendation", title: "Product schema fields restored on the catalogue template" },
    { type: "Fix report", title: "Redirect chains collapsed to a single hop on 205 URLs" },
    { type: "Technical audit", title: "Core Web Vitals read by template, mobile field data" },
  ],
  "ai-visibility": [
    { type: "AI visibility analysis", title: "Citation share across six answer engines" },
    { type: "Answer-readiness audit", title: "Answer-readiness scored on the top 40 landing pages" },
    { type: "Citation tracker", title: "Prompt set expanded to 60 comparison questions" },
    { type: "AI visibility analysis", title: "Clusters losing clicks to AI Overviews, ranked" },
  ],
  "authority-backlink": [
    { type: "Backlink opportunity", title: "60 digital-PR prospects qualified for the annual report" },
    { type: "Digital-PR pitch", title: "Pitch angle built on the original survey data" },
    { type: "Prospect list", title: "Unlinked brand mentions on eleven trade publications" },
    { type: "Backlink opportunity", title: "Reclamation list for links lost in the restructure" },
  ],
  "analytics-learning": [
    { type: "Analytics report", title: "Monthly performance read against the agreed targets" },
    { type: "Attribution model", title: "August ranking gains attributed to shipped work" },
    { type: "Learning summary", title: "What returned fastest this quarter, by content type" },
    { type: "Analytics report", title: "Conversion path read for the commercial cluster" },
  ],
};

/**
 * A rotation of review states.
 *
 * Weighted towards delivered work: most of what an agency files has already
 * shipped, and a queue where everything sat in review would not be a working
 * team.
 */
const STATUS_MIX: readonly AgentOutputStatus[] = [
  "delivered",
  "approved",
  "delivered",
  "in-review",
  "delivered",
  "draft",
  "approved",
  "delivered",
];

let cache: readonly AgentOutput[] | null = null;

/** Every deliverable filed across the portfolio, newest first. */
export function getAgentOutputs(): readonly AgentOutput[] {
  cache ??= build();
  return cache;
}

/** Deliverables filed by one agent, newest first. */
export function outputsForAgent(agentId: AgentId): readonly AgentOutput[] {
  return getAgentOutputs().filter((output) => output.agent === agentId);
}

function build(): readonly AgentOutput[] {
  const outputs: AgentOutput[] = [];

  for (const agent of AGENT_REGISTRY) {
    const seeds = POOL[agent.id];
    let index = 0;

    for (const assignment of projectsForAgent(agent.id)) {
      const project = getProjectRecord(assignment.id);
      if (!project) continue;

      // A paused engagement files nothing new; what it produced is already on
      // the record, so it keeps one delivered artifact and no drafts.
      const count =
        project.status === "paused"
          ? 1
          : randInt(agent.seed + project.seed, 1, 1, 3);

      for (const seed of pickSubset(seeds, agent.seed + project.seed, count)) {
        const status =
          project.status === "paused"
            ? "delivered"
            : STATUS_MIX[(index + agent.stage) % STATUS_MIX.length];

        outputs.push({
          id: `${agent.id}-${project.id}-output-${index + 1}`,
          title: seed.title,
          agent: agent.id,
          projectId: project.id,
          projectName: project.name,
          type: seed.type,
          status,
          createdAt: minutesBefore(
            randInt(agent.seed + project.seed, index + 40, 90, 26_000),
          ),
          quality: scoreFor(project, 84, agent.stage + index),
          module: agent.module,
        });

        index += 1;
      }
    }
  }

  return outputs.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** How many deliverables an agent has filed. */
export function outputCountFor(agentId: AgentId): number {
  return outputsForAgent(agentId).length;
}

/** Kinds of deliverable an agent files, for its workspace header. */
export function outputKindsFor(agentId: AgentId): readonly string[] {
  return getAgentRecord(agentId)?.outputKinds ?? [];
}
