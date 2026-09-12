import { clamp } from "@/lib/mock/dashboard/core";
import { getContentRecords } from "@/lib/mock/content";
import { getAiEntities } from "@/lib/mock/ai-visibility/entities";
import type {
  AiEntityRecord,
  Confidence,
  EntityConnectivity,
  EntityRelation,
  RelationBand,
  RelationEvidence,
  RelationKind,
} from "@/types/ai-visibility";

/**
 * How the project's entities connect to each other.
 *
 * The gap this closes: the entity model knew how well each entity was
 * established on its own, and nothing at all about how they relate. An answer
 * engine resolving "does this business do X for Y" is asking about a
 * connection, and a page that establishes both things separately and never
 * puts them together does not answer it.
 *
 * The hard rule here is that **an edge names its evidence, not a semantic
 * claim**. This product has no knowledge graph and no way to establish that
 * two things are related in the world. What it can see is that its own content
 * puts them on the same page, or links the pages that establish them, or
 * merely files them under the same topic — three different strengths of the
 * same observation, and the vocabulary keeps them apart. "Co-present on four
 * pages" is a fact about the content. "Is a kind of" would be an invention,
 * and there is no member of `RelationKind` that could express it.
 *
 * Direct evidence and inferred association are therefore separate states
 * rather than points on one scale, and an edge that rests on nothing but
 * shared filing says so and carries a recommendation instead of a strength it
 * has not earned.
 *
 * Thresholds exist to stop the graph collapsing into all-to-all. Every
 * cluster's entities are, trivially, about the same topic; emitting that as a
 * strong connection would produce a dense graph carrying no information. Only
 * co-presence and links earn a direct edge, and the rest are reported as what
 * they are.
 */

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * Shared pages before co-presence counts as a connection.
 *
 * One shared page is a coincidence on a site where most pages mention the
 * brand. Two is a pattern.
 */
export const CO_PRESENCE_FLOOR = 2;

/** Shared pages before a brand-to-topic association counts. */
export const BRAND_FLOOR = 1;

/**
 * What each band means, expressed as a floor.
 *
 * `central` is a link, or co-presence across several pages, between two
 * entities that are themselves established. `connected` is the ordinary case.
 * `peripheral` is thin evidence or a weak end. `isolated` is shared filing and
 * nothing else.
 */
export const RELATION_BANDS = {
  central: 66,
  connected: 45,
  peripheral: 25,
} as const;

export function relationBandFor(strength: number): RelationBand {
  if (strength >= RELATION_BANDS.central) return "central";
  if (strength >= RELATION_BANDS.connected) return "connected";
  if (strength >= RELATION_BANDS.peripheral) return "peripheral";
  return "isolated";
}

/**
 * What each kind of evidence is worth as a starting point.
 *
 * Calibrated so that the ordinary case — two entities on two shared pages —
 * lands in `connected` rather than `central`. `central` has to mean something
 * beyond ordinary, or the band stops carrying information: an earlier
 * calibration put two thirds of the graph there, which is the same as not
 * banding it at all.
 */
const KIND_BASE: Readonly<Record<RelationKind, number>> = {
  linked: 52,
  "co-present": 40,
  "brand-topic": 30,
  "same-topic": 10,
};

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function shared(a: readonly string[], b: readonly string[]): readonly string[] {
  const set = new Set(b);
  return a.filter((id) => set.has(id));
}

/**
 * How well established a connection is.
 *
 * The evidence count does most of the work, and the two entities' own
 * published strengths cap it: a connection between two thin entities is a thin
 * connection however many pages it appears on, because neither end is
 * established enough for an engine to resolve. Their strength is read from the
 * entity records rather than recalculated.
 */
function strengthFor(
  kind: RelationKind,
  evidenceCount: number,
  source: AiEntityRecord,
  target: AiEntityRecord,
): number {
  const weakerEnd = Math.min(source.strength.score, target.strength.score);
  // Diminishing: the difference between two shared pages and five matters;
  // between fifteen and twenty it does not.
  const depth = clamp(Math.log2(evidenceCount + 1) * 10, 0, 24);

  return Math.round(
    clamp(KIND_BASE[kind] + depth + (weakerEnd - 55) * 0.35, 0, 100),
  );
}

/**
 * How much the edge can be trusted.
 *
 * `unknown` is reachable and load-bearing: where an entity has no page of its
 * own, nothing can be said about how it relates to anything, and reporting a
 * confidence there would be reporting one the data cannot support.
 */
function confidenceFor(
  evidence: RelationEvidence,
  evidenceCount: number,
  source: AiEntityRecord,
  target: AiEntityRecord,
): Confidence {
  if (source.primaryPageId === null || target.primaryPageId === null) {
    return "unknown";
  }
  if (evidence === "inferred") return "low";
  if (evidenceCount >= 4) return "high";
  if (evidenceCount >= 2) return "medium";
  return "low";
}

type Candidate = {
  readonly kind: RelationKind;
  readonly evidence: RelationEvidence;
  readonly source: AiEntityRecord;
  readonly target: AiEntityRecord;
  readonly pageIds: readonly string[];
  readonly evidenceCount: number;
  readonly directional: boolean;
  readonly basis: string;
};

function assemble(candidate: Candidate): EntityRelation {
  const { kind, evidence, source, target, pageIds, evidenceCount } = candidate;

  const strength = strengthFor(kind, evidenceCount, source, target);
  const confidence = confidenceFor(evidence, evidenceCount, source, target);
  const band = relationBandFor(strength);

  const clusterIds = [
    ...new Set(
      [source.clusterId, target.clusterId].filter(
        (id): id is string => id !== null,
      ),
    ),
  ];

  // A weak or unverifiable connection gets a recommendation instead of a
  // score it has not earned.
  const gap =
    confidence === "unknown"
      ? `${source.primaryPageId === null ? source.name : target.name} has no page of its own, so this connection cannot be established either way.`
      : evidence === "inferred"
        ? `${source.name} and ${target.name} sit under the same topic and never appear on the same page.`
        : band === "isolated" || band === "peripheral"
          ? `Only ${evidenceCount} ${evidenceCount === 1 ? "page" : "pages"} put these two together, and neither end is strongly established.`
          : null;

  const action =
    gap === null
      ? null
      : confidence === "unknown"
        ? "Give the unestablished entity a page of its own before trying to connect it."
        : evidence === "inferred"
          ? "Cover both on one page, or link the pages that establish them, so the association has something behind it."
          : "Strengthen the weaker entity first — a connection is only as resolvable as its ends.";

  return {
    id: `rel-${kind}-${source.id}--${target.id}`,
    kind,
    evidence,
    sourceId: source.id,
    sourceName: source.name,
    targetId: target.id,
    targetName: target.name,
    directional: candidate.directional,
    projectId: source.projectId,
    projectName: source.projectName,
    pageIds,
    clusterIds,
    evidenceCount,
    strength,
    band,
    confidence,
    // Derived throughout: the entities are canonical, the pages are canonical,
    // and the link graph is the content layer's own.
    provenance: "derived",
    basis: candidate.basis,
    gap,
    action,
  };
}

let cache: readonly EntityRelation[] | null = null;

function build(): readonly EntityRelation[] {
  const entities = getAiEntities();
  const content = getContentRecords();

  // The internal link graph, keyed the way entities refer to pages.
  const linksOut = new Map<string, ReadonlySet<string>>();
  for (const record of content) {
    linksOut.set(
      `ai-${record.id}`,
      new Set(record.linksTo.map((id) => `ai-${id}`)),
    );
  }

  const byProject = new Map<string, AiEntityRecord[]>();
  for (const entity of entities) {
    const list = byProject.get(entity.projectId);
    if (list) list.push(entity);
    else byProject.set(entity.projectId, [entity]);
  }

  const out: EntityRelation[] = [];

  for (const group of byProject.values()) {
    // Alphabetical by id, so a symmetric pair is always visited in the same
    // order and can only be emitted once.
    const ordered = [...group].sort((a, b) => a.id.localeCompare(b.id));

    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const a = ordered[i];
        const b = ordered[j];

        const sharedPages = shared(a.pageIds, b.pageIds);
        const sameCluster =
          a.clusterId !== null && a.clusterId === b.clusterId;
        const brandPair =
          (a.type === "organization" || b.type === "organization") &&
          a.type !== b.type;

        // -- linked: their primary pages point at each other ------------
        // Directional, and the only kind that is: a link runs one way, and
        // storing it symmetrically would describe a link that does not exist.
        const aPrimary = a.primaryPageId;
        const bPrimary = b.primaryPageId;
        const aLinksB =
          aPrimary !== null &&
          bPrimary !== null &&
          (linksOut.get(aPrimary)?.has(bPrimary) ?? false);
        const bLinksA =
          aPrimary !== null &&
          bPrimary !== null &&
          (linksOut.get(bPrimary)?.has(aPrimary) ?? false);

        if (aLinksB || bLinksA) {
          const source = aLinksB ? a : b;
          const target = aLinksB ? b : a;
          out.push(
            assemble({
              kind: "linked",
              evidence: "direct",
              source,
              target,
              pageIds: [source.primaryPageId as string],
              evidenceCount: sharedPages.length + 1,
              directional: true,
              basis: `The page establishing ${source.name} links to the page establishing ${target.name}.`,
            }),
          );
          continue;
        }

        // -- brand-topic: the brand and a topic term, together ----------
        if (brandPair && sharedPages.length >= BRAND_FLOOR) {
          out.push(
            assemble({
              kind: "brand-topic",
              evidence: "direct",
              source: a,
              target: b,
              pageIds: sharedPages,
              evidenceCount: sharedPages.length,
              directional: false,
              basis: `The brand and this term appear together on ${sharedPages.length} ${sharedPages.length === 1 ? "page" : "pages"}.`,
            }),
          );
          continue;
        }

        // -- co-present: established together on real pages -------------
        if (sharedPages.length >= CO_PRESENCE_FLOOR) {
          out.push(
            assemble({
              kind: "co-present",
              evidence: "direct",
              source: a,
              target: b,
              pageIds: sharedPages,
              evidenceCount: sharedPages.length,
              directional: false,
              basis: `Both are established on the same ${sharedPages.length} pages.`,
            }),
          );
          continue;
        }

        // -- same-topic: shared filing and nothing more ------------------
        // Emitted only within a cluster. Across a project this would be
        // every pair of entities, which is a graph with no information in it.
        if (sameCluster) {
          out.push(
            assemble({
              kind: "same-topic",
              evidence: "inferred",
              source: a,
              target: b,
              pageIds: sharedPages,
              evidenceCount: sharedPages.length,
              directional: false,
              basis: `Both sit under ${a.clusterName ?? "the same topic"}, with no page covering them together.`,
            }),
          );
        }
      }
    }
  }

  return out;
}

export function getEntityRelations(): readonly EntityRelation[] {
  cache ??= build();
  return cache;
}

export function relationsForProject(
  projectId: string,
): readonly EntityRelation[] {
  return projectId === "portfolio" || projectId === "all"
    ? getEntityRelations()
    : getEntityRelations().filter((entry) => entry.projectId === projectId);
}

/** Every edge touching one entity, strongest first. */
export function relationsForEntity(
  entityId: string,
): readonly EntityRelation[] {
  return getEntityRelations()
    .filter((entry) => entry.sourceId === entityId || entry.targetId === entityId)
    .sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id));
}

/**
 * How many meaningful connections a page is the evidence for.
 *
 * Brand-to-topic edges are excluded deliberately. The brand appears on most of
 * a project's pages, so counting those would make almost every page look like
 * it connects things — the first calibration of this did exactly that, firing
 * on 174 of 181 pages, which is the same as not having a signal. What counts
 * is co-presence between two topic entities, or a link between the pages that
 * establish them.
 */
export function relationEvidenceOn(pageId: string): number {
  return getEntityRelations().filter(
    (entry) =>
      entry.evidence === "direct" &&
      entry.kind !== "brand-topic" &&
      entry.band !== "isolated" &&
      entry.band !== "peripheral" &&
      entry.pageIds.includes(pageId),
  ).length;
}

/**
 * Co-present pairs a page must carry before density alone counts.
 *
 * Set where it is because entities are derived from each cluster's own
 * keywords, so almost every page in a cluster is co-present with several of
 * its siblings. Co-presence is therefore a weak discriminator in this model,
 * and a floor of two credited two thirds of the inventory — a gain signal
 * that most pages carry is not a gain signal. Four pairs is a page putting an
 * unusual amount of a model together.
 */
export const RELATION_SIGNAL_FLOOR = 4;

/**
 * Whether a page actually demonstrates a relationship between its entities.
 *
 * This is what the information-gain signal reads, replacing a guess from
 * keyword count and outbound link count that measured how busy a page was
 * rather than whether it connected anything.
 *
 * Two routes, and the first is the one that carries the weight. A link from
 * the page establishing one entity to the page establishing another is a
 * deliberate editorial act recorded in the canonical link graph — the clearest
 * evidence this product holds that somebody connected two things on purpose.
 * Density of co-presence is the second route, and it needs to be unusual to
 * count, for the reason given above.
 */
export function pageDemonstratesRelation(pageId: string): boolean {
  const sourcesALink = getEntityRelations().some(
    (entry) => entry.kind === "linked" && entry.pageIds.includes(pageId),
  );
  return sourcesALink || relationEvidenceOn(pageId) >= RELATION_SIGNAL_FLOOR;
}

// ---------------------------------------------------------------------------
// Connectivity
// ---------------------------------------------------------------------------

let connectivityCache: readonly EntityConnectivity[] | null = null;

/**
 * Each entity's position in the graph.
 *
 * Degree is counted over direct edges and inferred ones separately, because an
 * entity with nine inferred neighbours and no direct evidence is not well
 * connected — it is merely filed alongside a lot of things.
 */
function buildConnectivity(): readonly EntityConnectivity[] {
  const relations = getEntityRelations();

  return getAiEntities().map((entity) => {
    const touching = relations.filter(
      (entry) => entry.sourceId === entity.id || entry.targetId === entity.id,
    );
    const direct = touching.filter((entry) => entry.evidence === "direct");

    const strongest =
      [...touching].sort(
        (a, b) => b.strength - a.strength || a.id.localeCompare(b.id),
      )[0] ?? null;

    // A band read off the direct edges alone: shared filing is not connection.
    const band: RelationBand =
      direct.length >= 5
        ? "central"
        : direct.length >= 2
          ? "connected"
          : direct.length === 1
            ? "peripheral"
            : "isolated";

    return {
      entityId: entity.id,
      entityName: entity.name,
      projectId: entity.projectId,
      degree: touching.length,
      directDegree: direct.length,
      band,
      strongest,
    };
  });
}

export function getEntityConnectivity(): readonly EntityConnectivity[] {
  connectivityCache ??= buildConnectivity();
  return connectivityCache;
}

export function connectivityForEntity(
  entityId: string,
): EntityConnectivity | null {
  return (
    getEntityConnectivity().find((entry) => entry.entityId === entityId) ?? null
  );
}
