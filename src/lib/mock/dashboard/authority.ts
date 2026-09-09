import { formatCompact } from "@/lib/format";
import {
  clamp,
  deltaFor,
  pickSubset,
  randInt,
  round,
  scoreFor,
  volumeFor,
} from "@/lib/mock/dashboard/core";
import type {
  AuthoritySnapshot,
  DashboardProject,
  DateRange,
  LinkProspect,
} from "@/types/dashboard";

/**
 * Link profile and the outreach pipeline behind it.
 *
 * Profile counts are derived from the project's size and health; the prospect
 * list is authored, because a prospect is only meaningful if the opportunity
 * type and the reason for it are concrete. Domains are invented for the demo.
 */

type ProspectSeed = Omit<LinkProspect, "id" | "estimatedValue"> & {
  /** Monthly referral value in dollars, before project scaling. */
  readonly baseValue: number;
};

const PROSPECTS: readonly ProspectSeed[] = [
  {
    domain: "tradejournal.example",
    authority: 81,
    type: "Digital PR",
    relevance: "high",
    status: "running",
    baseValue: 4_200,
  },
  {
    domain: "logisticsweekly.example",
    authority: 76,
    type: "Unlinked mention",
    relevance: "high",
    status: "active",
    baseValue: 3_400,
  },
  {
    domain: "financeeducators.example",
    authority: 72,
    type: "Resource page",
    relevance: "high",
    status: "active",
    baseValue: 2_900,
  },
  {
    domain: "homeimprovementhub.example",
    authority: 64,
    type: "Guest post",
    relevance: "medium",
    status: "queued",
    baseValue: 1_800,
  },
  {
    domain: "clinicdirectory.example",
    authority: 58,
    type: "Broken link",
    relevance: "medium",
    status: "complete",
    baseValue: 1_200,
  },
  {
    domain: "outdoorgearlab.example",
    authority: 51,
    type: "Guest post",
    relevance: "medium",
    status: "queued",
    baseValue: 940,
  },
  {
    domain: "startuproundup.example",
    authority: 34,
    type: "Resource page",
    relevance: "low",
    status: "paused",
    baseValue: 380,
  },
];

export function buildAuthoritySnapshot(
  project: DashboardProject,
  range: DateRange,
): AuthoritySnapshot {
  const windowScale = Math.max(0.4, range.days / 30);

  const referringDomains = volumeFor(project, 8_460, 71);
  const totalBacklinks = Math.round(
    referringDomains * (11 + randInt(project.seed, 72, 0, 9)),
  );
  const newLinks = Math.max(
    1,
    Math.round(referringDomains * 0.051 * windowScale ** 0.8),
  );
  const lostLinks = Math.max(
    0,
    Math.round(newLinks * clamp(0.28 - project.healthOffset / 90, 0.05, 0.72)),
  );

  const selected = project.portfolio
    ? PROSPECTS
    : pickSubset(PROSPECTS, project.seed + 43, randInt(project.seed, 44, 5, 6));

  const prospects: readonly LinkProspect[] = selected.map((prospect, index) => ({
    id: `${project.id}-link-${index + 1}`,
    domain: prospect.domain,
    authority: prospect.authority,
    type: prospect.type,
    relevance: prospect.relevance,
    status: prospect.status,
    estimatedValue: `$${formatCompact(
      Math.round(prospect.baseValue * (project.portfolio ? 1 : project.scale * 2.3)),
    )} / mo`,
  }));

  return {
    authorityScore: scoreFor(project, 63, 4),
    authorityTrend: { value: deltaFor(project, range, 45, 3.4, 3.6) },
    referringDomains,
    referringDomainsTrend: { value: deltaFor(project, range, 46, 4.1, 3.2) },
    totalBacklinks,
    newLinks,
    lostLinks,
    toxicLinks: Math.round(
      referringDomains * clamp(0.019 - project.healthOffset / 5_400, 0.003, 0.06),
    ),
    dofollowShare: round(clamp(72 + project.healthOffset * 0.5, 42, 94), 1),
    prospects,
  };
}
