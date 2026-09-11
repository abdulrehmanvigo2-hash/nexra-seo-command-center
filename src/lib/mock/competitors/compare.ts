import { round } from "@/lib/mock/dashboard/core";
import { PROJECTS } from "@/lib/mock/projects/roster";
import { getKeywordRecords } from "@/lib/mock/keywords";
import { contentForProject } from "@/lib/mock/content";
import {
  competitorsForProject,
  getOverlapRows,
} from "@/lib/mock/competitors/registry";
import { getClusterBattlegrounds } from "@/lib/mock/competitors/clusters";
import type {
  CompareDimension,
  CompareResult,
  CompetitorRecord,
} from "@/types/competitor";

/**
 * Us against a chosen set of rivals, on dimensions that mean the same thing
 * for both sides.
 *
 * The constraint that makes this useful rather than decorative is that every
 * row is measured the same way for us as for them. Our footprint is counted
 * over the same keyword set, our positions come from the same records, our
 * cluster strength uses the same function as theirs. A row that can only be
 * measured for one side — their modelled authority, the threat they pose —
 * says so by leaving the other side empty rather than inventing a number to
 * fill the column.
 *
 * Comparison is per project. Rivals in different markets have no shared
 * denominator, and a table that put them side by side would be comparing two
 * unrelated fights.
 */

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((carry, value) => carry + value, 0) / values.length;
}

/**
 * The comparison for one project.
 *
 * Unknown competitor ids are dropped rather than rendered as blank columns:
 * the selection lives in the URL and in session state, and a stale id should
 * narrow the table, not break it.
 */
export function buildComparison(
  projectId: string,
  competitorIds: readonly string[],
): CompareResult | null {
  const project = PROJECTS.find((entry) => entry.id === projectId);
  if (!project) return null;

  const pool = competitorsForProject(projectId);
  const selected: readonly CompetitorRecord[] = competitorIds
    .map((id) => pool.find((record) => record.id === id))
    .filter((record): record is CompetitorRecord => record !== undefined);

  const keywords = getKeywordRecords().filter(
    (record) => record.projectId === projectId,
  );
  const ourPositions = keywords
    .map((record) => record.position)
    .filter((value): value is number => value !== null);

  const pages = contentForProject(projectId).filter(
    (record) => record.url !== null,
  );
  const clusters = getClusterBattlegrounds().filter(
    (entry) => entry.projectId === projectId,
  );

  const rows = getOverlapRows().filter((row) => row.projectId === projectId);

  /** Distinct intents a side actually ranks for. */
  const ourIntents = new Set(
    keywords
      .filter((record) => record.position !== null)
      .map((record) => record.intent),
  );

  const intentsFor = (competitorId: string) =>
    new Set(
      rows
        .filter(
          (row) => row.competitorId === competitorId && row.theirPosition !== null,
        )
        .map((row) => row.intent),
    ).size;

  const clusterStrengthFor = (competitorId: string) =>
    mean(
      clusters
        .map(
          (entry) =>
            entry.rivals.find((rival) => rival.competitorId === competitorId)
              ?.strength,
        )
        .filter((value): value is number => value !== undefined),
    );

  const by = (read: (record: CompetitorRecord) => number | null) =>
    Object.fromEntries(
      selected.map((record) => [record.id, read(record)]),
    ) as Readonly<Record<string, number | null>>;

  const dimensions: readonly CompareDimension[] = [
    {
      id: "visibility",
      label: "Search visibility",
      description:
        "Share of the traffic this project's keyword set could produce, at the positions each side actually holds.",
      format: "percent",
      provenance: "derived",
      ours: selected[0]?.ourVisibility ?? null,
      values: by((record) => record.visibility),
    },
    {
      id: "footprint",
      label: "Keyword footprint",
      description: "Terms in the tracked set the side ranks for at all.",
      format: "number",
      provenance: "derived",
      ours: ourPositions.length,
      values: by((record) => record.keywordFootprint),
    },
    {
      id: "shared",
      label: "Shared keywords",
      description:
        "Terms both we and this rival rank for. Not applicable to our own column.",
      format: "number",
      provenance: "derived",
      ours: null,
      values: by((record) => record.sharedKeywords),
    },
    {
      id: "top-three",
      label: "Top-three terms",
      description: "Terms held at position three or better.",
      format: "number",
      provenance: "derived",
      ours: ourPositions.filter((position) => position <= 3).length,
      values: by((record) => record.rankingFootprint.topThree),
    },
    {
      id: "top-ten",
      label: "Top-ten terms",
      description: "Terms held on the first page.",
      format: "number",
      provenance: "derived",
      ours: ourPositions.filter((position) => position <= 10).length,
      values: by(
        (record) =>
          record.rankingFootprint.topThree + record.rankingFootprint.topTen,
      ),
    },
    {
      id: "average-position",
      label: "Average position",
      description: "Mean position across the terms the side ranks for.",
      format: "position",
      lowerIsBetter: true,
      provenance: "derived",
      ours: ourPositions.length === 0 ? null : round(mean(ourPositions) ?? 0, 1),
      values: by((record) => record.averagePosition),
    },
    {
      id: "content-footprint",
      label: "Pages on these topics",
      description:
        "Live pages covering the project's clusters. Ours from the content inventory; theirs modelled from the terms they rank with.",
      format: "number",
      provenance: "derived",
      ours: pages.length,
      values: by((record) => record.pageCount),
    },
    {
      id: "content-depth",
      label: "Content depth",
      description:
        "How thoroughly the pages cover their topics, 0-100. Ours is the content score; theirs is modelled.",
      format: "score",
      provenance: "seeded",
      ours:
        pages.length === 0
          ? null
          : Math.round(mean(pages.map((page) => page.score.score)) ?? 0),
      values: by((record) => record.contentDepth),
    },
    {
      id: "cluster-strength",
      label: "Cluster strength",
      description:
        "Mean hold on the project's topic clusters, measured the same way for both sides.",
      format: "score",
      provenance: "derived",
      ours:
        clusters.length === 0
          ? null
          : Math.round(mean(clusters.map((entry) => entry.ourStrength)) ?? 0),
      values: by((record) => {
        const value = clusterStrengthFor(record.id);
        return value === null ? null : Math.round(value);
      }),
    },
    {
      id: "intent-coverage",
      label: "Intents covered",
      description:
        "How many of the six search intents the side ranks for anywhere in this set.",
      format: "number",
      provenance: "derived",
      ours: ourIntents.size,
      values: by((record) => intentsFor(record.id)),
    },
    {
      id: "authority",
      label: "Domain authority",
      description:
        "A modelled authority-style score for the rival's domain. There is no link index behind this product, so ours is not stated.",
      format: "score",
      provenance: "seeded",
      ours: null,
      values: by((record) => record.authority),
    },
    {
      id: "threat",
      label: "Threat score",
      description:
        "How much this rival is costing the project. Describes them, so it has no reading for our own column.",
      format: "score",
      provenance: "derived",
      ours: null,
      values: by((record) => record.threat.score),
    },
    {
      id: "opportunity",
      label: "Opportunity exposure",
      description:
        "How much of what they hold is realistically takeable back.",
      format: "score",
      provenance: "derived",
      ours: null,
      values: by((record) => record.opportunity.score),
    },
  ];

  return {
    projectId,
    projectName: project.name,
    ourName: project.name,
    ourDomain: project.domain,
    competitors: selected,
    dimensions,
  };
}
