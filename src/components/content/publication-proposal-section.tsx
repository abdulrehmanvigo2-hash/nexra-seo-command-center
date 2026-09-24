"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import {
  preparePublicationProposal,
  withdrawPublicationProposal,
  type PreparePublicationProposalActionResult,
  type WithdrawPublicationProposalActionResult,
} from "@/app/(app)/projects/publication-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/field";
import { WebsiteDryRunPanel } from "@/components/content/website-dry-run-panel";
import { DRAFT_SECTION_LABEL, NO_PUBLICATION_STATEMENT } from "@/lib/content/publications/preview";
import {
  proposalEligibility,
  proposalRefusalMessage,
  slugRefusalMessage,
  validateSlug,
} from "@/lib/content/publications/proposal-rules";
import type { ProposalCandidate, ProposalState, ProposalView } from "@/lib/content/publications/service";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import type { ContentDraft, ContentDraftVersion } from "@/types/content-draft";
import type { PublicationDestination } from "@/types/content-publication";

/**
 * One draft's publication proposal: the active proposal, bound to one exact
 * approved version, with its preview rebuilt from that version's stored row;
 * or, for the current version when the server says it is eligible, the
 * two-step control that prepares one; or the reason no control is offered.
 *
 * A proposal publishes nothing and creates no GitHub pull request, and the
 * section says so. There is no publish, merge, deploy or pull-request
 * control. Nothing here writes on its own: the section reads its state (a
 * GET) and writes only on a confirmation click. The server decides every
 * write from its own records and re-checks it under a lock on the draft.
 */

type Load =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly state: ProposalState }
  | { readonly status: "unavailable" }
  | { readonly status: "failed" };

async function readProposalState(projectId: string, draftId: string, signal?: AbortSignal): Promise<Load> {
  const params = new URLSearchParams({ project: projectId, draft: draftId });
  const response = await fetch(`/api/content-publications?${params.toString()}`, { cache: "no-store", signal });
  if (response.status === 503) return { status: "unavailable" };
  if (!response.ok) return { status: "failed" };
  const body = (await response.json()) as { state?: ProposalState };
  return body.state ? { status: "ready", state: body.state } : { status: "failed" };
}

const READ_FAILED = "The publication proposal state could not be read. Reload to try again.";

type Failure<T> = Exclude<T, { ok: true } | { reason: "ineligible" } | { reason: "stale" } | { reason: "slug" }>;

const PREPARE_FAILURE: Readonly<Record<Failure<PreparePublicationProposalActionResult>["reason"], string>> = {
  unauthorized: "Your session has ended. Reload the page to sign in again.",
  "rate-limited": "Too many requests. Wait a moment and try again.",
  invalid: "This proposal cannot be prepared: its identifiers are not what the server expects.",
  unavailable: "Drafts are not persisted on this deployment, so nothing can be proposed.",
  "not-found": "This draft no longer exists on the server, or belongs to another project.",
  "version-not-found": "This version no longer exists on the server.",
  "destination-unknown": "That destination is not registered for this project.",
  "content-changed": "The version's text on the server is not what was shown here, so nothing was proposed. The preview has been reloaded.",
  "slug-taken": "Another active publication proposal — a draft's or an article's — already uses this destination and slug. Choose another slug.",
  failed: "The proposal could not be prepared. Nothing is known to have been written.",
};

const WITHDRAW_FAILURE: Readonly<Record<Exclude<WithdrawPublicationProposalActionResult, { ok: true }>["reason"], string>> = {
  unauthorized: "Your session has ended. Reload the page to sign in again.",
  "rate-limited": "Too many requests. Wait a moment and try again.",
  invalid: "This proposal cannot be withdrawn: its identifiers are not what the server expects.",
  unavailable: "Drafts are not persisted on this deployment.",
  "not-found": "This proposal no longer exists on the server, or belongs to another draft.",
  failed: "The proposal could not be withdrawn. Nothing is known to have been written.",
};

function when(iso: string): string {
  return `${formatFullDate(iso)}, ${formatTimeUtc(iso)}`;
}

export function PublicationProposalSection({
  projectId,
  draft,
  version,
}: {
  projectId: string;
  draft: ContentDraft;
  version: ContentDraftVersion;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [note, setNote] = useState<string | null>(null);

  // A read, keyed by the draft and its state. The parent keys this section
  // by the draft, the version on screen and the draft's status, so a change
  // to any of them mounts a fresh section that asks again.
  useEffect(() => {
    const controller = new AbortController();
    readProposalState(projectId, draft.id, controller.signal)
      .then(setLoad)
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed" });
      });
    return () => controller.abort();
  }, [projectId, draft.id]);

  async function reload() {
    try {
      setLoad(await readProposalState(projectId, draft.id));
    } catch {
      setLoad({ status: "failed" });
    }
  }

  const viewingCurrent = version.version === draft.currentVersion;

  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Publication proposal</dt>
      <dd className="space-y-2 text-fg-muted">
        <p className="text-xs text-fg-subtle">{NO_PUBLICATION_STATEMENT}</p>
        {load.status === "loading" && <p className="text-xs text-fg-subtle">Checking publication proposals…</p>}
        {load.status === "unavailable" && <p className="text-xs text-warning">{PREPARE_FAILURE.unavailable}</p>}
        {load.status === "failed" && (
          <p className="text-xs text-critical" role="status">
            {READ_FAILED}
          </p>
        )}
        {load.status === "ready" && (
          <ProposalBody
            projectId={projectId}
            draft={draft}
            version={version}
            viewingCurrent={viewingCurrent}
            state={load.state}
            onState={(state, message) => {
              setLoad({ status: "ready", state });
              setNote(message);
            }}
            onNote={setNote}
            onReload={reload}
          />
        )}
        {note && (
          <p className="text-xs text-fg-muted" role="status">
            {note}
          </p>
        )}
      </dd>
    </div>
  );
}

function ProposalBody({
  projectId,
  draft,
  version,
  viewingCurrent,
  state,
  onState,
  onNote,
  onReload,
}: {
  projectId: string;
  draft: ContentDraft;
  version: ContentDraftVersion;
  viewingCurrent: boolean;
  state: ProposalState;
  onState: (state: ProposalState, note: string | null) => void;
  onNote: (note: string | null) => void;
  onReload: () => Promise<void>;
}) {
  const active = state.active;
  const history = state.history;

  let main: ReactNode;
  if (active !== null && (viewingCurrent || active.proposal.version === version.version)) {
    main = <ActiveProposal projectId={projectId} view={active} onState={onState} onNote={onNote} />;
  } else if (viewingCurrent && state.candidate !== null) {
    main = <PrepareProposal projectId={projectId} draft={draft} candidate={state.candidate} onState={onState} onNote={onNote} onReload={onReload} />;
  } else {
    // The server's reason for the current version; the shared rule's for a historical one.
    const pure = proposalEligibility(draft, version, active?.proposal ?? null);
    const reason = viewingCurrent ? state.refusal : pure.ok ? "not-current" : pure.reason;
    main = (
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={viewingCurrent ? "warning" : "neutral"}>Not eligible for a publication proposal</Badge>
        {reason !== null && <span className="text-xs text-fg-subtle">{proposalRefusalMessage(reason)}</span>}
      </div>
    );
  }

  return (
    <>
      {main}
      {history.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-fg-subtle">Withdrawn proposals</p>
          <ul className="space-y-0.5 text-xs text-fg-subtle">
            {history.map((entry) => (
              <li key={entry.id}>
                Version {entry.version} · {entry.destination} · {entry.slug} · proposed {when(entry.createdAt)}
                {entry.withdrawnAt ? ` · withdrawn ${when(entry.withdrawnAt)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function DestinationDetails({ destination }: { destination: PublicationDestination }) {
  return (
    <ul className="space-y-0.5 text-xs text-fg-subtle">
      <li>
        Destination: {destination.label} ({destination.host}) · key {destination.key}
      </li>
      <li>Content path: {destination.contentPath ?? "unresolved — decided after the website's content format is inspected"}</li>
      <li>Content format: {destination.contentFormat ?? "not yet inspected"}</li>
      <li>Source repository: {destination.sourceRepository} (named for reference; not contacted)</li>
    </ul>
  );
}

function ExactText({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-1 rounded border border-border p-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-warning">{DRAFT_SECTION_LABEL}</p>
      <p className="text-sm font-medium text-fg">{title}</p>
      <p className="whitespace-pre-wrap text-sm text-fg-muted">{body}</p>
    </div>
  );
}

function PrepareProposal({
  projectId,
  draft,
  candidate,
  onState,
  onNote,
  onReload,
}: {
  projectId: string;
  draft: ContentDraft;
  candidate: ProposalCandidate;
  onState: (state: ProposalState, note: string | null) => void;
  onNote: (note: string | null) => void;
  onReload: () => Promise<void>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [destinationKey, setDestinationKey] = useState(candidate.destinations[0]?.key ?? "");
  const [slug, setSlug] = useState(candidate.suggestedSlug);
  const [working, setWorking] = useState(false);
  const destination = candidate.destinations.find((entry) => entry.key === destinationKey) ?? null;
  const slugCheck = validateSlug(slug);

  async function prepare() {
    if (working || !open || destination === null || !slugCheck.ok) return;
    setWorking(true);
    onNote(null);
    try {
      const result = await preparePublicationProposal(projectId, draft.id, candidate.version, destination.key, slugCheck.slug, candidate.contentSha256);
      if (result.ok) {
        setOpen(false);
        onState(result.state, result.created ? `Proposal prepared for version ${candidate.version}. Nothing was published.` : "This proposal was already active.");
      } else if (result.reason === "stale") {
        setOpen(false);
        onNote(`Version ${result.currentVersion} is current now, so nothing was proposed.`);
        await onReload();
      } else if (result.reason === "ineligible") {
        setOpen(false);
        onNote(proposalRefusalMessage(result.refusal));
        await onReload();
      } else if (result.reason === "slug") {
        onNote(slugRefusalMessage(result.refusal));
      } else {
        onNote(PREPARE_FAILURE[result.reason]);
        if (result.reason === "content-changed") await onReload();
      }
    } catch {
      onNote(PREPARE_FAILURE.failed);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">Eligible for a publication proposal</Badge>
        <span className="text-xs text-fg-subtle">
          Version {candidate.version} is the approved current version and its recorded fact-check passed.
        </span>
      </div>
      {!open ? (
        <Button onClick={() => setOpen(true)} icon="arrow-right">
          Prepare publication proposal
        </Button>
      ) : (
        <div className="space-y-2 rounded border border-border p-3">
          <div className="flex flex-wrap items-start gap-3">
            <Field label="Destination" htmlFor={`${id}-destination`} className="min-w-64">
              <Select
                id={`${id}-destination`}
                size="sm"
                value={destinationKey}
                disabled={working}
                onChange={(event) => setDestinationKey(event.target.value)}
                options={candidate.destinations.map((entry) => ({ value: entry.key, label: `${entry.label} (${entry.host})` }))}
              />
            </Field>
            <Field
              label="Slug"
              htmlFor={`${id}-slug`}
              className="min-w-64"
              hint="The target identifier. Validated only: no file, branch or page is created."
              error={slugCheck.ok ? undefined : slugRefusalMessage(slugCheck.refusal)}
            >
              <TextInput id={`${id}-slug`} size="sm" value={slug} disabled={working} onChange={(event) => setSlug(event.target.value)} />
            </Field>
          </div>
          {destination !== null && <DestinationDetails destination={destination} />}
          <ul className="space-y-0.5 text-xs text-fg-subtle">
            <li>
              Exact version: {candidate.version} (row {candidate.versionId})
            </li>
            <li className="break-all">Content SHA-256: {candidate.contentSha256}</li>
            <li>Approved: {when(candidate.approvedAt)} by operator {candidate.approvedBy}</li>
          </ul>
          <ExactText title={candidate.title} body={candidate.body} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon="check" onClick={() => void prepare()} disabled={working || destination === null || !slugCheck.ok}>
              {working ? "Preparing…" : `Confirm: prepare proposal for version ${candidate.version}`}
            </Button>
            <Button onClick={() => setOpen(false)} disabled={working}>
              Cancel
            </Button>
            <span className="text-xs text-fg-subtle">{NO_PUBLICATION_STATEMENT}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ActiveProposal({
  projectId,
  view,
  onState,
  onNote,
}: {
  projectId: string;
  view: ProposalView;
  onState: (state: ProposalState, note: string | null) => void;
  onNote: (note: string | null) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const { proposal } = view;

  async function withdraw() {
    if (working || !confirming) return;
    setWorking(true);
    onNote(null);
    try {
      const result = await withdrawPublicationProposal(projectId, proposal.draftId, proposal.id);
      if (result.ok) {
        setConfirming(false);
        onState(result.state, result.withdrawn ? "Proposal withdrawn. The draft, its versions and its approval are unchanged." : "This proposal was already withdrawn.");
      } else {
        onNote(WITHDRAW_FAILURE[result.reason]);
      }
    } catch {
      onNote(WITHDRAW_FAILURE.failed);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent" dot>
          Proposed
        </Badge>
        {view.current ? (
          <Badge tone="positive">Matches the approved current version</Badge>
        ) : (
          <Badge tone="warning">Stale: the draft changed after this proposal</Badge>
        )}
        {view.verified ? <Badge tone="positive">Preview verified</Badge> : <Badge tone="critical">Preview could not be verified</Badge>}
      </div>
      {!view.current && (
        <p className="text-xs text-warning">
          This proposal names version {proposal.version} as it was approved then. The draft has changed since, so it no longer
          describes the approved current version. Withdraw it; a new proposal can be prepared once the current version is
          checked and approved.
        </p>
      )}
      {view.destination !== null ? (
        <DestinationDetails destination={view.destination} />
      ) : (
        <p className="text-xs text-critical">Destination {proposal.destination} is no longer registered.</p>
      )}
      <ul className="space-y-0.5 text-xs text-fg-subtle">
        <li>Slug: {proposal.slug}</li>
        <li>
          Exact version: {proposal.version} (row {proposal.versionId})
        </li>
        <li className="break-all">Content SHA-256: {proposal.contentSha256}</li>
        <li className="break-all">
          Preview SHA-256: {proposal.previewSha256} ({proposal.previewFormat})
        </li>
        <li>
          Approved: {when(proposal.approvedAt)} by operator {proposal.approvedBy}
        </li>
        <li>
          Proposed: {when(proposal.createdAt)} by operator {proposal.requestedBy}
        </li>
      </ul>
      {view.preview !== null ? (
        <ExactText title={view.preview.title} body={view.preview.body} />
      ) : (
        <p className="text-xs text-critical">The bound version could not be read, so no preview is shown.</p>
      )}
      <WebsiteDryRunPanel key={proposal.id} projectId={projectId} draftId={proposal.draftId} proposalId={proposal.id} />
      <div className="flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <Button variant="danger" onClick={() => void withdraw()} disabled={working}>
              {working ? "Withdrawing…" : "Confirm: withdraw proposal"}
            </Button>
            <Button onClick={() => setConfirming(false)} disabled={working}>
              Cancel
            </Button>
            <span className="text-xs text-fg-subtle">
              Withdrawing changes this proposal&apos;s status only. The draft, its versions, fact-checks and approval are unchanged.
            </span>
          </>
        ) : (
          <Button onClick={() => setConfirming(true)} icon="close">
            Withdraw proposal
          </Button>
        )}
      </div>
    </div>
  );
}
