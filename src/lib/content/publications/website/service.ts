/**
 * The website artifact dry-run for one publication proposal, decided on the
 * server from its own records.
 *
 * Only the draft's active proposal is rendered, and only while it holds:
 * the proposal service re-reads the draft by project and id, rebuilds the
 * proposal's preview from the exact bound version row, and checks the row
 * id, the content hash and the preview hash against what the proposal
 * stored (`verified`), and the draft's approval, version and approval
 * moment against the proposal's binding (`current`). A withdrawn, stale,
 * unverified or foreign proposal is refused. The text rendered is the
 * verified preview's — the bound row's title and body — never anything the
 * browser sent.
 *
 * Read-only: nothing here writes to the proposal, the draft or anything
 * else, and nothing reaches the network. The destination repository is
 * never read; the template is the pinned contract.
 */

import { isProjectId, isUuid } from "@/lib/content/drafts/service";
import { utf8Sha256 } from "@/lib/content/publications/content-hash";
import type { PublicationService } from "@/lib/content/publications/service";
import { envelopeFromProposal } from "@/lib/content/publications/website/article-contract";
import { buildWebsiteDryRun } from "@/lib/content/publications/website/render";
import { templateForDestination } from "@/lib/content/publications/website/template";
import type { WebsiteDryRun } from "@/types/website-artifact";

export type WebsiteDryRunRefusal =
  /** An id is not the shape it must be; nothing was read. */
  | "invalid"
  /** Drafts are not persisted on this data source. */
  | "unavailable"
  /** No such draft in this project, or no such proposal for it. */
  | "not-found"
  /** The proposal was withdrawn. */
  | "withdrawn"
  /** The draft moved on: the proposal no longer names its approved current version at the same approval. */
  | "stale"
  /** The bound row, its hash or the preview hash no longer match what the proposal stored. */
  | "unverified"
  /** No pinned template exists for the proposal's destination. */
  | "no-template";

export type WebsiteDryRunResult =
  | { readonly ok: true; readonly dryRun: WebsiteDryRun }
  | { readonly ok: false; readonly reason: WebsiteDryRunRefusal };

export type WebsiteDryRunService = {
  getDryRun(projectId: string, draftId: string, proposalId: string): Promise<WebsiteDryRunResult>;
};

export function createWebsiteDryRunService(dependencies: { readonly publications: PublicationService }): WebsiteDryRunService {
  const { publications } = dependencies;
  return {
    async getDryRun(projectId, draftId, proposalId) {
      if (!isProjectId(projectId) || !isUuid(draftId) || !isUuid(proposalId)) return { ok: false, reason: "invalid" };
      const id = proposalId.toLowerCase();

      const read = await publications.getState(projectId, draftId);
      if (!read.ok) return { ok: false, reason: read.reason };
      const { active, history } = read.state;

      if (active === null || active.proposal.id !== id) {
        return { ok: false, reason: history.some((entry) => entry.id === id) ? "withdrawn" : "not-found" };
      }
      if (!active.current) return { ok: false, reason: "stale" };
      if (!active.verified || active.preview === null || active.destination === null) return { ok: false, reason: "unverified" };

      const template = templateForDestination(active.proposal.destination);
      if (template === null) return { ok: false, reason: "no-template" };

      const { proposal, preview } = active;
      return {
        ok: true,
        dryRun: buildWebsiteDryRun({
          template,
          envelope: envelopeFromProposal({ slug: proposal.slug, title: preview.title, body: preview.body }),
          provenance: {
            proposalId: proposal.id,
            draftId: proposal.draftId,
            version: proposal.version,
            versionId: proposal.versionId,
            contentSha256: proposal.contentSha256,
          },
          sha256: utf8Sha256,
        }),
      };
    },
  };
}
