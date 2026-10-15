import { isAdmissible, isOutsideUrl, type EvidenceSource, type EvidenceUnit } from "@/lib/evidence/contract";
import { MAX_SOURCES, type PipelineSnapshot, type RunState, type SourceState } from "@/lib/pipeline/plan";
import { resultsOfType, type SerpResult, type SerpRunView } from "@/lib/serp/contract";
import type { AgentRun } from "@/types/agent-run";

/**
 * OC1 — One-Click Article, PR 3: Stage A over the M4 records (docs/roadmap/OC1-one-click-article.md, steps 1–4).
 *
 * Pure. It reads what M4 already keeps — the newest SERP run, the fetched sources, the extraction runs and their
 * units — and answers (1) which organic results the pipeline fetches as sources, (2) the Stage A part of the planner's
 * snapshot, and (3) the units Gate 1 shows pre-ticked. Nothing here is admitted, fetched or queued: a pre-ticked unit
 * is admitted only when the owner presses *Approve & write* at Gate 1, through the existing decide route, and the
 * database's own admission rule (supported, quote found, pending) still decides. Not wired to a route or screen yet.
 */

export type PickedSource = {
  readonly serpResultId: string;
  readonly url: string;
  readonly domain: string;
  readonly rank: number;
};

/** A host, lower-cased, without a trailing dot or a leading `www.`; null when it is not a host. */
export function normalHost(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  let host = value.trim().toLowerCase();
  if (host.includes("/")) {
    try {
      host = new URL(host.includes("://") ? host : `https://${host}`).hostname;
    } catch {
      return null;
    }
  }
  host = host.replace(/\.$/, "").replace(/^www\./, "");
  return /^[a-z0-9.-]+$/.test(host) && host.includes(".") ? host : null;
}

/** Whether a host is the project's own site or one of its subdomains. */
export function isOwnHost(host: string, projectDomain: string): boolean {
  const own = normalHost(projectDomain);
  return own !== null && (host === own || host.endsWith(`.${own}`));
}

/**
 * Step 2: the top organic results, in rank order, the project's own site left out and at most one per domain (five
 * pages from one site say one site's view), at most MAX_SOURCES — which is also M4's daily limit per opportunity.
 */
export function pickSources(results: readonly SerpResult[], projectDomain: string, max: number = MAX_SOURCES): readonly PickedSource[] {
  const picked: PickedSource[] = [];
  const seen = new Set<string>();
  for (const result of resultsOfType(results, "organic")) {
    if (picked.length >= max) break;
    if (result.url === null || !isOutsideUrl(result.url)) continue;
    const domain = normalHost(result.domain) ?? normalHost(result.url);
    if (domain === null || isOwnHost(domain, projectDomain) || seen.has(domain)) continue;
    seen.add(domain);
    picked.push({ serpResultId: result.id, url: result.url, domain, rank: result.rank });
  }
  return picked;
}

export type StageAInput = {
  readonly projectDomain: string;
  /** The opportunity's newest SERP run, or null when none is recorded. */
  readonly serp: SerpRunView | null;
  /** The opportunity's stored sources (any order). */
  readonly sources: readonly EvidenceSource[];
  /** Research & Evidence's runs (any order); only `evidence-extract` runs naming a source are read. */
  readonly runs: readonly AgentRun[];
  /** The opportunity's recorded units. */
  readonly units: readonly EvidenceUnit[];
};

export type StageASource = SourceState & {
  /** The stored source once fetched, or null while it is still to be fetched. */
  readonly sourceId: string | null;
  /** The SERP result it came from; null for a source the owner added by URL. */
  readonly serpResultId: string | null;
};

export type StageASnapshot = Pick<PipelineSnapshot, "serp" | "sourcesPicked"> & { readonly sources: readonly StageASource[] };

/** Step 1–3 as the planner reads them. */
export function stageASnapshot(input: StageAInput): StageASnapshot {
  const serp = serpState(input.serp);
  if (serp !== "completed" || input.serp === null) {
    // Sources the owner fetched by hand before a SERP still count once the SERP completes; until then Stage A waits.
    return { serp, sourcesPicked: false, sources: [] };
  }

  const picks = pickSources(input.serp.results, input.projectDomain);
  const byResult = new Map<string, EvidenceSource>();
  for (const source of newestFirst(input.sources)) {
    if (source.serpResultId !== null && !byResult.has(source.serpResultId)) byResult.set(source.serpResultId, source);
  }

  const sources: StageASource[] = picks.map((pick) => {
    const stored = byResult.get(pick.serpResultId);
    return stored === undefined
      ? { url: pick.url, fetch: "pending", extraction: { state: "none" }, unitsRecorded: false, sourceId: null, serpResultId: pick.serpResultId }
      : fromStored(stored, input);
  });

  // A source the owner fetched by URL, or from a result this pick left out, is kept: its units may back the brief.
  const pickedIds = new Set(picks.map((pick) => pick.serpResultId));
  const listed = new Set(sources.map((source) => source.sourceId));
  for (const stored of newestFirst(input.sources)) {
    if (listed.has(stored.id) || stored.fetchState !== "fetched") continue;
    if (stored.serpResultId !== null && pickedIds.has(stored.serpResultId)) continue;
    listed.add(stored.id);
    sources.push(fromStored(stored, input));
  }

  return { serp, sourcesPicked: true, sources };
}

function fromStored(stored: EvidenceSource, input: StageAInput): StageASource {
  const fetched = stored.fetchState === "fetched";
  const extraction = fetched ? newestExtraction(input.runs, stored.id) : { state: "none" as const };
  const unitsRecorded = extraction.state === "run" && input.units.some((unit) => unit.runId === extraction.runId);
  return {
    url: stored.finalUrl ?? stored.requestedUrl,
    fetch: fetched ? "fetched" : "refused",
    extraction,
    unitsRecorded,
    sourceId: stored.id,
    serpResultId: stored.serpResultId,
  };
}

function serpState(view: SerpRunView | null): PipelineSnapshot["serp"] {
  if (view === null) return "none";
  switch (view.run.status) {
    case "reserved":
      return "running";
    case "completed":
    case "partial":
      return resultsOfType(view.results, "organic").length > 0 ? "completed" : "failed";
    default:
      return "failed";
  }
}

function newestExtraction(runs: readonly AgentRun[], sourceId: string): RunState {
  const run = newestFirst(runs.filter((r) => r.taskType === "evidence-extract" && r.input.sourceId === sourceId), (r) => r.createdAt)[0];
  return run === undefined ? { state: "none" } : { state: "run", runId: run.id, status: run.status };
}

function newestFirst<T>(items: readonly T[], at: (item: T) => string = (item) => (item as { fetchedAt: string }).fetchedAt): T[] {
  return [...items].sort((a, b) => (at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0));
}

export type Gate1Evidence = {
  /** Units Gate 1 shows ticked: admissible by the database's rule. The owner may untick any. */
  readonly preTicked: readonly string[];
  readonly admitted: number;
  /** Supported by the run, but its quote was not found on the page: shown, never ticked. */
  readonly quoteNotFound: number;
  readonly needsReview: number;
  readonly unsupported: number;
  readonly rejected: number;
};

/** Step 4: what Gate 1 offers. Nothing is admitted here. */
export function gate1Evidence(units: readonly EvidenceUnit[]): Gate1Evidence {
  const preTicked: string[] = [];
  let admitted = 0;
  let quoteNotFound = 0;
  let needsReview = 0;
  let unsupported = 0;
  let rejected = 0;
  for (const unit of [...units].sort((a, b) => (a.sourceId === b.sourceId ? a.position - b.position : a.sourceId < b.sourceId ? -1 : 1))) {
    if (unit.decision === "admitted") admitted += 1;
    else if (unit.decision === "rejected") rejected += 1;
    else if (isAdmissible(unit)) preTicked.push(unit.id);
    else if (unit.status === "supported" && !unit.quoteFound) quoteNotFound += 1;
    else if (unit.status === "unsupported") unsupported += 1;
    else needsReview += 1;
  }
  return { preTicked, admitted, quoteNotFound, needsReview, unsupported, rejected };
}

/**
 * At Gate 1 the owner's ticks must be a subset of what was offered: a unit that is not admissible (decided since, or
 * never offered) is refused here before any decide request, and the database re-checks each one anyway.
 */
export function confirmTicks(offered: Gate1Evidence, ticked: readonly string[]): { readonly ok: true; readonly admit: readonly string[] } | { readonly ok: false; readonly unknown: readonly string[] } {
  const allowed = new Set(offered.preTicked);
  const unique = [...new Set(ticked)];
  const unknown = unique.filter((id) => !allowed.has(id));
  return unknown.length > 0 ? { ok: false, unknown } : { ok: true, admit: unique };
}
