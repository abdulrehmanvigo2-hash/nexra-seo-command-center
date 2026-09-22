/**
 * The rules around a publication proposal: which draft version, to which
 * destination, under which name, by whom, and at most one at a time.
 *
 * Everything is decided from the server's own records. The draft is read by
 * project and id together, the version by number, and its text, its
 * recorded fact-check and the draft's approval are what the policy judges;
 * nothing the browser sends about the text, the approval, the hash or the
 * operator is used. The browser names the version it was shown and the
 * content hash it was shown, and both are compared, never stored: if either
 * differs from what the server reads now, nothing is written. The store's
 * one database function then re-checks every condition under a lock on the
 * draft, so a draft edited or re-approved in between is answered stale.
 *
 * Nothing here publishes, contacts a repository, creates a file, branch,
 * commit or pull request, or deploys anything. A withdrawal changes the
 * proposal's status and nothing else.
 */

import type { ContentDraftStore } from "@/lib/content/drafts/contract";
import { isProjectId, isUuid } from "@/lib/content/drafts/service";
import { contentSha256, isSha256Hex, previewSha256 } from "@/lib/content/publications/content-hash";
import type { PublicationProposalStore } from "@/lib/content/publications/contract";
import { destinationsForProject, findDestination } from "@/lib/content/publications/destinations";
import { buildPublicationPreview, PREVIEW_FORMAT } from "@/lib/content/publications/preview";
import {
  isProposalCurrent,
  proposalEligibility,
  suggestSlug,
  validateSlug,
  type ProposalRefusal,
  type SlugRefusal,
} from "@/lib/content/publications/proposal-rules";
import type { ContentDraft, ContentDraftVersion } from "@/types/content-draft";
import type { PublicationDestination, PublicationPreview, PublicationProposal } from "@/types/content-publication";

export type ProposalView = {
  readonly proposal: PublicationProposal;
  readonly destination: PublicationDestination | null;
  /** Rebuilt from the bound version row and the proposal's own binding; null when the row cannot be read. */
  readonly preview: PublicationPreview | null;
  /** The bound row, its text hash and the rebuilt preview's hash all match what the proposal stored. */
  readonly verified: boolean;
  /** The proposal still names the draft's current, approved version at the same approval. */
  readonly current: boolean;
};

/** The draft's current version as the server reads it, when it may be proposed now. */
export type ProposalCandidate = {
  readonly version: number;
  readonly versionId: string;
  readonly contentSha256: string;
  readonly title: string;
  readonly body: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly destinations: readonly PublicationDestination[];
  readonly suggestedSlug: string;
};

export type ProposalState = {
  readonly active: ProposalView | null;
  /** Earlier, withdrawn proposals, newest first. */
  readonly history: readonly PublicationProposal[];
  readonly candidate: ProposalCandidate | null;
  /** Why the current version cannot be proposed now; null when it can. */
  readonly refusal: ProposalRefusal | null;
};

export type GetProposalStateResult =
  | { readonly ok: true; readonly state: ProposalState }
  | { readonly ok: false; readonly reason: "invalid" | "unavailable" | "not-found" };

export type ProposeRequest = {
  readonly projectId: string;
  readonly draftId: string;
  /** The version the operator was shown; it must still be current. */
  readonly version: number;
  readonly destination: string;
  readonly slug: string;
  /** The content hash the operator was shown; compared with the server's, never stored. */
  readonly expectedContentSha256: string;
  /** The operator's Supabase Auth user id, confirmed by the caller. */
  readonly operatorId: string;
};

export type ProposeResult =
  /** `created: false` means this same proposal was already active, so nothing was written. */
  | { readonly ok: true; readonly created: boolean; readonly state: ProposalState }
  | { readonly ok: false; readonly reason: "invalid" }
  | { readonly ok: false; readonly reason: "unavailable" }
  | { readonly ok: false; readonly reason: "not-found" }
  | { readonly ok: false; readonly reason: "version-not-found" }
  /** The destination key is not registered for this project. */
  | { readonly ok: false; readonly reason: "destination-unknown" }
  | { readonly ok: false; readonly reason: "slug"; readonly refusal: SlugRefusal }
  | { readonly ok: false; readonly reason: "ineligible"; readonly refusal: ProposalRefusal }
  /** The draft moved on from the version the operator was shown; nothing was written. */
  | { readonly ok: false; readonly reason: "stale"; readonly currentVersion: number }
  /** The text now reads differently from what the operator was shown; nothing was written. */
  | { readonly ok: false; readonly reason: "content-changed" }
  /** Another draft's active proposal holds this slug at this destination; nothing was written. */
  | { readonly ok: false; readonly reason: "slug-taken" }
  | { readonly ok: false; readonly reason: "failed" };

export type WithdrawRequest = {
  readonly projectId: string;
  readonly draftId: string;
  readonly proposalId: string;
  readonly operatorId: string;
};

export type WithdrawResult =
  /** `withdrawn: false` means it already was, so nothing was written. */
  | { readonly ok: true; readonly withdrawn: boolean; readonly state: ProposalState }
  | { readonly ok: false; readonly reason: "invalid" | "unavailable" | "not-found" | "failed" };

export type PublicationService = {
  getState(projectId: string, draftId: string): Promise<GetProposalStateResult>;
  propose(request: ProposeRequest): Promise<ProposeResult>;
  withdraw(request: WithdrawRequest): Promise<WithdrawResult>;
};

/** How many proposals are read back for the history list. */
export const PROPOSAL_HISTORY_LIMIT = 10;

export function createPublicationService(dependencies: {
  readonly drafts: ContentDraftStore;
  readonly proposals: PublicationProposalStore;
}): PublicationService {
  const { drafts, proposals } = dependencies;

  const available = () => drafts.storesDrafts && proposals.storesProposals;

  async function viewOf(draft: ContentDraft, proposal: PublicationProposal): Promise<ProposalView> {
    const destination = findDestination(proposal.destination, proposal.projectId);
    const row = await drafts.getVersion(draft.id, proposal.version);
    if (row === null || row.id !== proposal.versionId || destination === null) {
      return { proposal, destination, preview: null, verified: false, current: isProposalCurrent(draft, proposal) };
    }
    const preview = buildPublicationPreview({
      destination,
      slug: proposal.slug,
      projectId: proposal.projectId,
      draftId: proposal.draftId,
      version: proposal.version,
      versionId: proposal.versionId,
      contentSha256: proposal.contentSha256,
      approvedBy: proposal.approvedBy,
      approvedAt: proposal.approvedAt,
      title: row.title,
      body: row.body,
    });
    const verified =
      contentSha256(row) === proposal.contentSha256 &&
      previewSha256(preview.document) === proposal.previewSha256 &&
      proposal.previewFormat === preview.format;
    return { proposal, destination, preview, verified, current: isProposalCurrent(draft, proposal) };
  }

  async function stateOf(projectId: string, draft: ContentDraft, currentVersion: ContentDraftVersion): Promise<ProposalState> {
    const listed = await proposals.listForDraft(projectId, draft.id, PROPOSAL_HISTORY_LIMIT);
    const activeProposal = listed.find((entry) => entry.status === "proposed") ?? (await proposals.findActiveForDraft(projectId, draft.id));
    const active = activeProposal === null ? null : await viewOf(draft, activeProposal);
    const history = listed.filter((entry) => entry.status !== "proposed");

    const destinations = destinationsForProject(projectId);
    const eligibility = proposalEligibility(draft, currentVersion, activeProposal);
    const refusal: ProposalRefusal | null = !eligibility.ok ? eligibility.reason : destinations.length === 0 ? "no-destination" : null;
    const candidate: ProposalCandidate | null =
      refusal === null && draft.approvedBy !== null && draft.approvedAt !== null
        ? {
            version: currentVersion.version,
            versionId: currentVersion.id,
            contentSha256: contentSha256(currentVersion),
            title: currentVersion.title,
            body: currentVersion.body,
            approvedBy: draft.approvedBy,
            approvedAt: draft.approvedAt,
            destinations,
            suggestedSlug: suggestSlug(currentVersion.title),
          }
        : null;
    return { active, history, candidate, refusal };
  }

  async function freshState(projectId: string, draftId: string): Promise<ProposalState | null> {
    const now = await drafts.getByProjectAndId(projectId, draftId);
    return now === null ? null : stateOf(projectId, now.draft, now.version);
  }

  /** Whether an active proposal is exactly the one being asked for again. */
  function sameProposal(active: PublicationProposal, ask: { version: ContentDraftVersion; destination: string; slug: string; hash: string }) {
    return (
      active.version === ask.version.version &&
      active.versionId === ask.version.id &&
      active.destination === ask.destination &&
      active.slug === ask.slug &&
      active.contentSha256 === ask.hash
    );
  }

  return {
    async getState(projectId, draftId) {
      if (!isProjectId(projectId) || !isUuid(draftId)) return { ok: false, reason: "invalid" };
      if (!available()) return { ok: false, reason: "unavailable" };
      const existing = await drafts.getByProjectAndId(projectId, draftId.toLowerCase());
      if (existing === null) return { ok: false, reason: "not-found" };
      return { ok: true, state: await stateOf(projectId, existing.draft, existing.version) };
    },

    async propose(request) {
      if (
        !isProjectId(request.projectId) ||
        !isUuid(request.draftId) ||
        !isUuid(request.operatorId) ||
        !Number.isInteger(request.version) ||
        request.version < 1 ||
        !isSha256Hex(request.expectedContentSha256)
      ) {
        return { ok: false, reason: "invalid" };
      }
      const destination = findDestination(request.destination, request.projectId);
      if (destination === null) return { ok: false, reason: "destination-unknown" };
      const slug = validateSlug(request.slug);
      if (!slug.ok) return { ok: false, reason: "slug", refusal: slug.refusal };
      if (!available()) return { ok: false, reason: "unavailable" };
      const projectId = request.projectId;
      const draftId = request.draftId.toLowerCase();

      // Ownership: the draft by project and id together.
      const existing = await drafts.getByProjectAndId(projectId, draftId);
      if (existing === null) return { ok: false, reason: "not-found" };
      const { draft } = existing;
      const version = await drafts.getVersion(draft.id, request.version);
      if (version === null) return { ok: false, reason: "version-not-found" };
      if (draft.currentVersion !== request.version) return { ok: false, reason: "stale", currentVersion: draft.currentVersion };

      const hash = contentSha256(version);
      const ask = { version, destination: destination.key, slug: slug.slug, hash };

      // The same proposal asked for again: already recorded, nothing written.
      const active = await proposals.findActiveForDraft(projectId, draftId);
      if (active !== null && sameProposal(active, ask)) {
        const state = await freshState(projectId, draftId);
        return state === null ? { ok: false, reason: "failed" } : { ok: true, created: false, state };
      }

      const eligibility = proposalEligibility(draft, version, active);
      if (!eligibility.ok) return { ok: false, reason: "ineligible", refusal: eligibility.reason };
      // Eligibility guarantees the approval is present; the narrowing is for the compiler.
      if (draft.approvedBy === null || draft.approvedAt === null) return { ok: false, reason: "ineligible", refusal: "approval-not-current" };

      // What the operator was shown must be what the server reads now.
      if (request.expectedContentSha256 !== hash) return { ok: false, reason: "content-changed" };

      const preview = buildPublicationPreview({
        destination,
        slug: slug.slug,
        projectId,
        draftId,
        version: version.version,
        versionId: version.id,
        contentSha256: hash,
        approvedBy: draft.approvedBy,
        approvedAt: draft.approvedAt,
        title: version.title,
        body: version.body,
      });

      const outcome = await proposals.create({
        projectId,
        draftId,
        version: version.version,
        versionId: version.id,
        contentSha256: hash,
        approvedBy: draft.approvedBy,
        approvedAt: draft.approvedAt,
        destination: destination.key,
        slug: slug.slug,
        previewFormat: PREVIEW_FORMAT,
        previewSha256: previewSha256(preview.document),
        requestedBy: request.operatorId.toLowerCase(),
      });

      switch (outcome.status) {
        case "created":
        case "exists": {
          if (outcome.status === "exists" && !sameProposal(outcome.proposal, ask)) {
            return { ok: false, reason: "ineligible", refusal: "proposal-exists" };
          }
          const state = await freshState(projectId, draftId);
          return state === null ? { ok: false, reason: "failed" } : { ok: true, created: outcome.status === "created", state };
        }
        case "stale":
          return { ok: false, reason: "stale", currentVersion: outcome.currentVersion };
        case "not-found":
          return { ok: false, reason: "not-found" };
        case "version-not-found":
          return { ok: false, reason: "version-not-found" };
        case "ineligible":
          return {
            ok: false,
            reason: "ineligible",
            refusal: outcome.reason === "unresolved-placeholders" ? "unresolved-placeholders" : "not-fact-checked",
          };
        case "content-mismatch":
          return { ok: false, reason: "content-changed" };
        case "slug-taken":
          return { ok: false, reason: "slug-taken" };
      }
    },

    async withdraw(request) {
      if (!isProjectId(request.projectId) || !isUuid(request.draftId) || !isUuid(request.proposalId) || !isUuid(request.operatorId)) {
        return { ok: false, reason: "invalid" };
      }
      if (!available()) return { ok: false, reason: "unavailable" };
      const projectId = request.projectId;
      const draftId = request.draftId.toLowerCase();
      const proposalId = request.proposalId.toLowerCase();

      const existing = await proposals.getById(projectId, draftId, proposalId);
      if (existing === null) return { ok: false, reason: "not-found" };

      let withdrawn = false;
      if (existing.status === "proposed") {
        const outcome = await proposals.withdraw({ projectId, draftId, proposalId, withdrawnBy: request.operatorId.toLowerCase() });
        withdrawn = outcome.status === "withdrawn";
        if (!withdrawn) {
          // Matched no row: read why, and never guess.
          const now = await proposals.getById(projectId, draftId, proposalId);
          if (now === null) return { ok: false, reason: "not-found" };
          if (now.status !== "withdrawn") return { ok: false, reason: "failed" };
        }
      }

      const state = await freshState(projectId, draftId);
      return state === null ? { ok: false, reason: "failed" } : { ok: true, withdrawn, state };
    },
  };
}
