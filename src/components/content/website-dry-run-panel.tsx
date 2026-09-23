"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { NO_EXTERNAL_ACTION_NOTICE } from "@/lib/content/publications/website/render";
import type { ArticleFieldState, DryRunArtifact, WebsiteDryRun } from "@/types/website-artifact";

/**
 * The website artifact dry-run for one active publication proposal: the
 * pinned destination template, the route and the two files the website's
 * repository would need, the article completeness checklist, any topic
 * warning, and both artifacts verbatim with their SHA-256.
 *
 * Read-only. The panel fetches the server's rendering once (a GET) and has
 * no button: there is no create, branch, commit, pull-request, merge,
 * deploy or publish control, and it always says that nothing was created.
 */

type Load =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly dryRun: WebsiteDryRun }
  | { readonly status: "refused"; readonly reason: string }
  | { readonly status: "failed" };

const REFUSAL: Readonly<Record<string, string>> = {
  withdrawn: "This proposal was withdrawn, so no website dry-run is rendered for it.",
  stale: "The draft changed after this proposal was made, so no website dry-run is rendered. Withdraw the proposal first.",
  unverified: "This proposal's bound version or preview no longer verifies against its stored hashes, so no website dry-run is rendered.",
  "no-template": "No pinned website template exists for this proposal's destination.",
  "not-found": "This proposal was not found for this draft and project.",
  invalid: "This dry-run cannot be requested: its identifiers are not what the server expects.",
  unavailable: "Drafts are not persisted on this deployment.",
  unauthorized: "Your session has ended. Reload the page to sign in again.",
};

const FIELD_TONE: Readonly<Record<ArticleFieldState, { readonly tone: "positive" | "accent" | "neutral" | "critical"; readonly label: string }>> = {
  present: { tone: "positive", label: "Present" },
  derived: { tone: "accent", label: "Derived" },
  template: { tone: "accent", label: "Template" },
  missing: { tone: "critical", label: "Missing" },
  absent: { tone: "neutral", label: "Not provided" },
};

async function readDryRun(projectId: string, draftId: string, proposalId: string, signal: AbortSignal): Promise<Load> {
  const params = new URLSearchParams({ project: projectId, draft: draftId, proposal: proposalId });
  const response = await fetch(`/api/content-publications/dry-run?${params.toString()}`, { cache: "no-store", signal });
  const body = (await response.json().catch(() => ({}))) as { dryRun?: WebsiteDryRun; error?: string };
  if (response.ok && body.dryRun) return { status: "ready", dryRun: body.dryRun };
  if (typeof body.error === "string" && body.error in REFUSAL) return { status: "refused", reason: body.error };
  return { status: "failed" };
}

export function WebsiteDryRunPanel({ projectId, draftId, proposalId }: { projectId: string; draftId: string; proposalId: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    readDryRun(projectId, draftId, proposalId, controller.signal)
      .then(setLoad)
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed" });
      });
    return () => controller.abort();
  }, [projectId, draftId, proposalId]);

  return (
    <div className="space-y-2 rounded border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Website artifact dry-run</p>
        {load.status === "ready" && (
          <Badge tone={load.dryRun.status === "complete" ? "accent" : "warning"} dot>
            {load.dryRun.statusLabel}
          </Badge>
        )}
      </div>
      <p className="text-xs text-fg-subtle">{NO_EXTERNAL_ACTION_NOTICE}</p>
      {load.status === "loading" && <p className="text-xs text-fg-subtle">Rendering the website dry-run…</p>}
      {load.status === "refused" && <p className="text-xs text-warning">{REFUSAL[load.reason]}</p>}
      {load.status === "failed" && (
        <p className="text-xs text-critical" role="status">
          The website dry-run could not be rendered. Reload to try again.
        </p>
      )}
      {load.status === "ready" && <DryRunBody dryRun={load.dryRun} />}
    </div>
  );
}

function DryRunBody({ dryRun }: { dryRun: WebsiteDryRun }) {
  const { template } = dryRun;
  return (
    <div className="space-y-3">
      <ul className="space-y-0.5 text-xs text-fg-subtle">
        <li>Destination repository: {template.repository} (branch {template.defaultBranch}; named for reference, not contacted)</li>
        <li className="break-all">
          Pinned template: {template.id} at commit {template.pinnedCommit}
        </li>
        <li>Route: {dryRun.route}</li>
        <li>Page file: {dryRun.page.path} (new file)</li>
        <li>Registry file: {dryRun.registry.path} (one record appended to the articles array)</li>
        <li>
          Bound version: {dryRun.proposal.version} (row {dryRun.proposal.versionId})
        </li>
      </ul>

      {dryRun.warnings.map((warning) => (
        <p key={`${warning.kind}:${warning.existingSlug}`} className="rounded border border-warning/40 p-2 text-xs text-warning" role="note">
          {warning.kind === "slug-collision" ? "Slug collision: " : "Topic overlap: "}
          {warning.message}
        </p>
      ))}
      {dryRun.noOverlapDetected && (
        <p className="text-xs text-fg-subtle">
          The fixed phrase check found no overlap with the site&apos;s live articles. That is not proof the topics are distinct.
        </p>
      )}

      <div className="space-y-1">
        <p className="text-xs font-medium text-fg-subtle">Article completeness</p>
        <ul className="space-y-1">
          {dryRun.fields.map((field) => (
            <li key={field.key} className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <Badge tone={FIELD_TONE[field.state].tone}>{FIELD_TONE[field.state].label}</Badge>
              <span>
                {field.label}
                {field.required ? "" : " (optional)"}
              </span>
              {field.source && <span className="text-fg-subtle">· {field.source}</span>}
            </li>
          ))}
        </ul>
      </div>

      {dryRun.missingRequired.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-critical">Missing required fields ({dryRun.missingRequired.length})</p>
          <p className="text-xs text-fg-subtle">
            None of these exist in this product yet, and none is invented. The approved version is one section: its title and
            body.
          </p>
          <ul className="list-inside list-disc text-xs text-fg-muted">
            {dryRun.missingRequired.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>
      )}

      <ArtifactPreview title="page.tsx dry-run" artifact={dryRun.page} />
      <ArtifactPreview title="lib/blog.ts record dry-run" artifact={dryRun.registry} />
    </div>
  );
}

function ArtifactPreview({ title, artifact }: { title: string; artifact: DryRunArtifact }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-fg-muted">
        {title} · {artifact.path}
      </p>
      <p className="break-all text-[11px] text-fg-subtle">SHA-256: {artifact.sha256}</p>
      <details className="rounded border border-border">
        <summary className="cursor-pointer px-2 py-1 text-xs text-fg-muted">Show the artifact verbatim</summary>
        <pre className="max-h-96 overflow-auto whitespace-pre px-2 py-2 font-mono text-[11px] leading-relaxed text-fg-muted">
          {artifact.content}
        </pre>
      </details>
    </div>
  );
}
