import type { ContentDraftStore } from "@/lib/content/drafts/contract";
import { contentSha256 } from "@/lib/content/publications/content-hash";
import type { CreateProposalInput, CreateProposalOutcome, PublicationProposalStore } from "@/lib/content/publications/contract";
import { PLACEHOLDER_MARKER } from "@/lib/content/publications/proposal-rules";
import type { ContentDraft, ContentDraftVersion, DraftFactCheck, FactCheckStatus } from "@/types/content-draft";
import type { PublicationProposal } from "@/types/content-publication";

/**
 * Shared fixtures for the publication proposal tests: an approved draft
 * whose current version 2 carries a passed check, and two in-memory stores.
 * The proposal store's `create` applies, in one synchronous step, the same
 * checks `nexra_content_publication_propose` applies under the draft's row
 * lock, so a test can race two requests and see the database's answer.
 * Test support only; nothing in the application imports this.
 */

export const PROJECT = "nexra-agency";
export const DRAFT_ID = "00000000-0000-4000-8000-0000000000d1";
export const VERSION_1_ID = "00000000-0000-4000-8000-0000000000e1";
export const VERSION_2_ID = "00000000-0000-4000-8000-0000000000e2";
export const OPERATOR = "00000000-0000-4000-8000-00000000000a";
export const APPROVER = "00000000-0000-4000-8000-00000000000d";
export const APPROVED_AT = "2026-09-22T15:00:00.123456+00:00";

export function factCheck(status: FactCheckStatus, version = 2, draftId = DRAFT_ID): DraftFactCheck {
  return {
    status,
    draftId,
    version,
    checkedAt: "2026-09-22T14:00:00.000Z",
    checkedByRunId: "11111111-0000-4000-8000-000000000080",
    recordedAt: "2026-09-22T14:05:00.000Z",
    recordedBy: OPERATOR,
    crawlId: "8f1c0d2e-0000-4000-8000-000000000001",
    searchWindow: null,
    summary: "One supported.",
    supported: [{ text: "Claim", evidence: "crawl /", note: null }],
    partial: [],
    unsupported: [],
    unverifiable: [],
    editorial: [],
  };
}

export const APPROVED_DRAFT: ContentDraft = {
  id: DRAFT_ID,
  projectId: PROJECT,
  sourceWriterRunId: "11111111-0000-4000-8000-000000000070",
  sourcePlanRunId: null,
  sectionIndex: null,
  sectionLabel: "Section",
  status: "approved",
  currentVersion: 2,
  approvedVersion: 2,
  approvedBy: APPROVER,
  approvedAt: APPROVED_AT,
  publishedVersion: null,
  publishedAt: null,
  remoteContentId: null,
  remoteTarget: null,
  createdBy: OPERATOR,
  createdAt: "2026-09-22T12:00:00.000Z",
  updatedAt: "2026-09-22T15:00:00.000Z",
};

export const VERSION_1: ContentDraftVersion = {
  id: VERSION_1_ID,
  draftId: DRAFT_ID,
  version: 1,
  origin: "writer",
  title: "What automated lead follow-up does",
  body: "Writer text.",
  claims: ["The home page title names automation. [crawl /]"],
  placeholders: ["[NEEDS EVIDENCE: how quickly a lead is contacted]"],
  factCheck: null,
  createdBy: OPERATOR,
  createdAt: "2026-09-22T12:00:00.000Z",
};

export const VERSION_2: ContentDraftVersion = {
  id: VERSION_2_ID,
  draftId: DRAFT_ID,
  version: 2,
  origin: "operator",
  title: "Automated lead follow-up — how it works",
  body: "Nexra's home page leads with automation.\nCafé, naïve, 日本語, 🙂.",
  claims: [],
  placeholders: [],
  factCheck: factCheck("passed") as unknown as ContentDraftVersion["factCheck"],
  createdBy: OPERATOR,
  createdAt: "2026-09-22T13:00:00.000Z",
};

/** The Postgres-computed SHA-256 of VERSION_2's text (checked against a local PostgreSQL 16). */
export const VERSION_2_SQL_HASH = "ae9a004672c93d283ef1541f5c7b2ea98abff745fb7b17074af0bea62472cdc5";

export type World = {
  drafts: ContentDraft[];
  versions: ContentDraftVersion[];
  proposals: PublicationProposal[];
  /** Every store call, in order. */
  calls: string[];
};

export function world(options: { draft?: Partial<ContentDraft>; version2?: Partial<ContentDraftVersion> } = {}): World {
  return {
    drafts: [{ ...APPROVED_DRAFT, ...options.draft }],
    versions: [VERSION_1, { ...VERSION_2, ...options.version2 }],
    proposals: [],
    calls: [],
  };
}

const unused = (name: string) => async () => {
  throw new Error(`${name} is not used by the publication service`);
};

export function memoryDraftStore(w: World, options: { storesDrafts?: boolean } = {}): ContentDraftStore {
  const currentOf = (draft: ContentDraft) => w.versions.find((v) => v.draftId === draft.id && v.version === draft.currentVersion) ?? null;
  return {
    storesDrafts: options.storesDrafts ?? true,
    findByWriterRunId: unused("findByWriterRunId"),
    async getByProjectAndId(projectId, draftId) {
      w.calls.push("drafts.get");
      const draft = w.drafts.find((d) => d.projectId === projectId && d.id === draftId);
      if (draft === undefined) return null;
      const version = currentOf(draft);
      return version === null ? null : { draft, version };
    },
    createFromWriterRun: unused("createFromWriterRun"),
    getCurrentVersion: unused("getCurrentVersion"),
    async listVersions(draftId) {
      return w.versions.filter((v) => v.draftId === draftId);
    },
    saveVersion: unused("saveVersion"),
    async getVersion(draftId, version) {
      w.calls.push("drafts.version");
      return w.versions.find((v) => v.draftId === draftId && v.version === version) ?? null;
    },
    recordFactCheck: unused("recordFactCheck"),
    markFactChecked: unused("markFactChecked"),
    approveVersion: unused("approveVersion"),
  };
}

let minted = 0;

export function memoryProposalStore(
  w: World,
  options: { storesProposals?: boolean; beforeCreate?: () => void } = {},
): PublicationProposalStore {
  return {
    storesProposals: options.storesProposals ?? true,
    async findActiveForDraft(projectId, draftId) {
      w.calls.push("proposals.active");
      return w.proposals.find((p) => p.projectId === projectId && p.draftId === draftId && p.status === "proposed") ?? null;
    },
    async listForDraft(projectId, draftId, limit) {
      w.calls.push("proposals.list");
      return w.proposals
        .filter((p) => p.projectId === projectId && p.draftId === draftId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    },
    async getById(projectId, draftId, proposalId) {
      w.calls.push("proposals.get");
      return w.proposals.find((p) => p.projectId === projectId && p.draftId === draftId && p.id === proposalId) ?? null;
    },
    // The database function, in one synchronous step: no await between the checks and the insert.
    async create(input: CreateProposalInput): Promise<CreateProposalOutcome> {
      options.beforeCreate?.();
      w.calls.push("proposals.create");
      const draft = w.drafts.find((d) => d.id === input.draftId && d.projectId === input.projectId);
      if (draft === undefined) return { status: "not-found" };
      if (
        draft.status !== "approved" ||
        draft.currentVersion !== input.version ||
        draft.approvedVersion !== input.version ||
        draft.approvedBy !== input.approvedBy ||
        draft.approvedAt !== input.approvedAt
      ) {
        return { status: "stale", currentVersion: draft.currentVersion };
      }
      const version = w.versions.find((v) => v.draftId === input.draftId && v.version === input.version);
      if (version === undefined) return { status: "version-not-found" };
      if (version.id !== input.versionId) return { status: "stale", currentVersion: draft.currentVersion };
      const check = version.factCheck as { status?: unknown; version?: unknown } | null;
      if (check === null || check.status !== "passed" || check.version !== input.version) {
        return { status: "ineligible", reason: "fact-check-not-passed" };
      }
      if (
        version.placeholders.length > 0 ||
        version.title.toLowerCase().includes(PLACEHOLDER_MARKER) ||
        version.body.toLowerCase().includes(PLACEHOLDER_MARKER)
      ) {
        return { status: "ineligible", reason: "unresolved-placeholders" };
      }
      if (contentSha256(version) !== input.contentSha256) return { status: "content-mismatch" };
      const active = w.proposals.find((p) => p.draftId === input.draftId && p.status === "proposed");
      if (active !== undefined) return { status: "exists", proposal: active };
      if (w.proposals.some((p) => p.status === "proposed" && p.destination === input.destination && p.slug === input.slug)) {
        return { status: "slug-taken" };
      }
      minted += 1;
      const proposal: PublicationProposal = {
        id: `00000000-0000-4000-8000-${String(minted).padStart(12, "0")}`,
        projectId: input.projectId,
        draftId: input.draftId,
        version: input.version,
        versionId: input.versionId,
        contentSha256: input.contentSha256,
        approvedBy: draft.approvedBy,
        approvedAt: draft.approvedAt,
        destination: input.destination,
        slug: input.slug,
        previewFormat: input.previewFormat,
        previewSha256: input.previewSha256,
        status: "proposed",
        requestedBy: input.requestedBy,
        withdrawnBy: null,
        withdrawnAt: null,
        createdAt: `2026-09-22T16:${String(minted % 60).padStart(2, "0")}:00.000Z`,
        updatedAt: `2026-09-22T16:${String(minted % 60).padStart(2, "0")}:00.000Z`,
      };
      w.proposals.push(proposal);
      return { status: "created", proposal };
    },
    async withdraw(input) {
      w.calls.push("proposals.withdraw");
      const index = w.proposals.findIndex(
        (p) => p.id === input.proposalId && p.projectId === input.projectId && p.draftId === input.draftId && p.status === "proposed",
      );
      if (index === -1) return { status: "unchanged" };
      const proposal: PublicationProposal = {
        ...w.proposals[index],
        status: "withdrawn",
        withdrawnBy: input.withdrawnBy,
        withdrawnAt: "2026-09-22T17:00:00.000Z",
        updatedAt: "2026-09-22T17:00:00.000Z",
      };
      w.proposals[index] = proposal;
      return { status: "withdrawn", proposal };
    },
  };
}
