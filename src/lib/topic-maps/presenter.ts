import type { Confirmation } from "@/lib/agent-runs/spend-confirm";
import type { Coverage } from "@/lib/topic-maps/cluster";
import type { TopicCluster, TopicMapsView, TopicMapView } from "@/lib/topic-maps/contract";

/**
 * The Topical map tab (M1, PR 5): what the screen says, in words, for every
 * answer the route gives. Pure and client-safe. Every figure on the tab is
 * a provider's estimate copied at build time, labelled so; coverage and the
 * clusters are derived by fixed rules, labelled so; a seed the provider
 * returned nothing for reads "No estimate from the provider", never zero
 * and never "no demand".
 */

export const NOT_SET_UP_TITLE = "Not set up yet";
export const NOT_SET_UP_COPY =
  "The topical map needs its tables in this deployment's database (migration 20261019120000). Nothing here is broken: the rest of the screen reads its records as before.";
export const PROVIDER_ESTIMATE_LABEL = "Provider estimate";
export const DERIVED_LABEL = "Derived by fixed rules";
export const NO_ESTIMATE_LABEL = "No estimate from the provider";
export const NO_ESTIMATE_TITLE = "The provider returned no data for this seed. Its demand is unknown — not zero, and not proof of no demand.";
export const UNKNOWN_INTENT = "unknown";
export const CANDIDATE_NOTE = "candidate — not created";
export const BUILD_LABEL = "Build map…";
export const APPROVE_LABEL = "Approve map…";
export const MAP_NOTE =
  "One cluster per provider seed. Figures are DataForSEO's estimates as recorded; clusters, primary keywords and coverage follow fixed rules. Nothing here is observed data, and approving a map queues nothing.";

export type TabState =
  | { readonly status: "loading" }
  | { readonly status: "not-set-up" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly view: TopicMapsView };

export function tabState(httpStatus: number, body: unknown): TabState {
  if (httpStatus === 503) return { status: "not-set-up" };
  if (httpStatus === 401 || httpStatus === 403) return { status: "failed", message: "Sign in again as an operator to read the topical map." };
  if (httpStatus === 429) return { status: "failed", message: "Too many reads just now; try again in a few minutes." };
  const view = typeof body === "object" && body !== null ? (body as { view?: TopicMapsView }).view : undefined;
  if (httpStatus < 200 || httpStatus >= 300 || !view || typeof view.source !== "object" || view.source === null) {
    return { status: "failed", message: "The topical map could not be read. Nothing is shown in its place." };
  }
  return { status: "ready", view };
}

export const READ_FAILED: TabState = { status: "failed", message: "The topical map could not be read. Nothing is shown in its place." };

/** The map the tab shows first: the proposed one waiting for a decision, else the approved one. */
export function shownMap(view: TopicMapsView): TopicMapView | null {
  return view.proposed ?? view.approved;
}

export function coverageBadge(coverage: Coverage): { readonly label: string; readonly tone: "positive" | "accent" | "warning" } {
  switch (coverage) {
    case "covered":
      return { label: "Covered", tone: "positive" };
    case "partial":
      return { label: "Partial", tone: "accent" };
    case "gap":
      return { label: "Gap", tone: "warning" };
  }
}

/** A figure as recorded, or a dash for a null — never 0 for a missing value. */
export function figure(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US");
}

export function pageLine(cluster: TopicCluster): string {
  if (cluster.coverage === "gap") return cluster.candidatePage === null ? "no candidate (its slug is already live)" : `/blog/${cluster.candidatePage} · ${CANDIDATE_NOTE}`;
  return cluster.existingPage ?? "—";
}

export function sourceLine(view: TopicMapsView): string {
  if (view.source.status === "no-run") return "No completed live provider run for this project yet: fetch provider estimates on the Keywords tab first.";
  const day = view.source.fetchedAt.slice(0, 10);
  return `Built from provider run ${view.source.runId.slice(0, 8)} (${day}, ${view.source.seeds} seeds, ${view.source.rows} keyword rows), the live articles' recorded keywords and the newest own-site crawl.`;
}

export function mapLine(view: TopicMapView): string {
  const { map } = view;
  const state = map.status === "approved" ? `Approved ${map.approvedAt?.slice(0, 10) ?? ""}`.trim() : map.status === "proposed" ? "Proposed — waiting for your approval" : "Superseded";
  const c = map.counts;
  return `${state} · built ${map.createdAt.slice(0, 10)} · ${c.clusters} clusters: ${c.covered} covered, ${c.partial} partial, ${c.gap} gaps · ${c.noEstimate} with no estimate · ${c.excluded} excluded terms`;
}

export function buildConfirmation(projectId: string, view: TopicMapsView): Confirmation {
  return {
    title: "Build a topical map?",
    facts: [
      { label: "Project", value: projectId },
      { label: "Reads", value: view.source.status === "ready" ? `provider run ${view.source.runId.slice(0, 8)}, the live articles, the newest crawl` : "nothing yet (no provider run)" },
      { label: "Cost", value: "None: no provider call, no agent run" },
      { label: "Replaces", value: view.proposed === null ? "nothing" : "the proposed map waiting for approval (kept as superseded)" },
    ],
    consequence: "The clusters are derived from records already stored, by fixed rules, and recorded as a new proposed map. An approved map stays as it is until you approve another.",
    confirmLabel: "Build map",
    dismissLabel: "Go back",
    usage: null,
    tone: "primary",
  };
}

export function approveConfirmation(projectId: string, map: TopicMapView): Confirmation {
  return {
    title: "Approve this topical map?",
    facts: [
      { label: "Project", value: projectId },
      { label: "Map", value: `${map.map.id.slice(0, 8)} · ${map.map.counts.clusters} clusters` },
      { label: "Replaces", value: "the approved map, if any (kept as superseded)" },
    ],
    consequence: "Approving records your decision that this map is the one later planning reads. It queues no run, creates no task and publishes nothing.",
    confirmLabel: "Approve map",
    dismissLabel: "Go back",
    usage: null,
    tone: "primary",
  };
}

/** A POST's answer in words. */
export function writeOutcome(httpStatus: number, body: unknown): { readonly text: string; readonly tone: "neutral" | "warning" } {
  const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : null;
  if (httpStatus === 201) return { text: "Map built and recorded as proposed.", tone: "neutral" };
  if (httpStatus === 200) return { text: "Map approved.", tone: "neutral" };
  if (httpStatus === 503) return { text: NOT_SET_UP_COPY, tone: "warning" };
  if (error === "no-run") return { text: "No completed live provider run to build from. Nothing was recorded.", tone: "warning" };
  if (error === "live-articles-unread") return { text: "The live articles could not be read, so coverage would be wrong. Nothing was recorded; try again.", tone: "warning" };
  if (error === "not-proposed") return { text: "That map is no longer waiting for approval. The list has been read again.", tone: "warning" };
  if (error === "invalid-map") return { text: "The database refused the map as out of shape. Nothing was recorded.", tone: "warning" };
  if (httpStatus === 429) return { text: "Too many requests just now; try again in a few minutes.", tone: "warning" };
  if (httpStatus === 401 || httpStatus === 403) return { text: "Sign in again as an operator.", tone: "warning" };
  return { text: "The request failed. Nothing is known to have been recorded.", tone: "warning" };
}
