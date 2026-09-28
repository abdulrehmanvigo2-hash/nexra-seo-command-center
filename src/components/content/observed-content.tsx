"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import type { IconName } from "@/components/icons";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { TabList, tabDomId, tabPanelDomId } from "@/components/ui/tab-list";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import {
  CONTENT_TABS,
  STUDIO_NOTE,
  approvalSummary,
  articleDetailHref,
  articleStatusLabel,
  checkProgressLine,
  contentUrls,
  draftIdsOf,
  draftStatusLabel,
  groupArticles,
  groupDrafts,
  ok,
  presentArticleDetail,
  presentArticleRow,
  presentDraftRow,
  presentUnits,
  projectHref,
  proposalSummary,
  resolveContentTab,
  unitStatusLabel,
  type ArticleRow,
  type ContentTabId,
  type DraftRow,
  type Read,
} from "@/lib/content/studio";
import type { ArticleProposalStateView } from "@/lib/content/articles/proposals/service";
import type { ProposalState } from "@/lib/content/publications/service";
import { formatFullDate } from "@/lib/format";
import type { ProjectOption } from "@/lib/projects/selection";
import type { ArticleApprovalState } from "@/types/content-article-approval";
import type { ArticleVersionChecks } from "@/types/content-article-check";
import type { ArticleWorkspace } from "@/types/content-article-record";
import type { DraftHistory } from "@/types/content-draft";

/**
 * The Content Studio over stored content only (Phase 5, checkpoint 5.2,
 * decisions Q1 and Q2).
 *
 * One stored project, chosen on the screen. Articles, Drafts and Pipeline are
 * read from the content workflow's own GET routes; nothing here writes, and
 * the controls that save, check, approve or propose stay on the project
 * screen, linked from each record. The modelled tabs are hidden, not
 * labelled: nothing this product stores backs them.
 */

const TABS = CONTENT_TABS satisfies readonly { id: string; label: string; icon: IconName }[];

/** How many drafts the Drafts tab reads, one history and one proposal state each. */
const DRAFT_READ_LIMIT = 20;

async function read<T>(url: string, key: string, signal: AbortSignal): Promise<Read<T>> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    if (response.status === 503) return { status: "unavailable" };
    if (!response.ok) return { status: "failed" };
    const body = (await response.json()) as Record<string, unknown>;
    return body[key] === undefined ? { status: "failed" } : ok(body[key] as T);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return { status: "failed" };
  }
}

export function ObservedBadge() {
  return (
    <Badge tone="accent" title="Read from this product's stored articles, drafts, checks, approvals and proposals. Not fixture data.">
      Observed
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Studio
// ---------------------------------------------------------------------------

type StudioData =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "unavailable" }
  | { readonly status: "ready"; readonly articles: readonly ArticleRow[]; readonly drafts: readonly DraftRow[]; readonly draftsNotRead: number; readonly draftsNotListed: number };

function useStudioData(projectId: string): StudioData {
  const [data, setData] = useState<StudioData>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      const workspace = await read<ArticleWorkspace>(contentUrls.workspace(projectId), "workspace", signal);
      if (workspace.status !== "ok") return setData({ status: workspace.status });
      const articles = await Promise.all(
        workspace.value.articles.map(async (history) => {
          const [checks, proposal] = await Promise.all([
            read<ArticleVersionChecks>(contentUrls.checks(projectId, history.article.id, history.article.currentVersion), "checks", signal),
            read<ArticleProposalStateView>(contentUrls.proposal(projectId, history.article.id), "proposal", signal),
          ]);
          return presentArticleRow(history, checks, proposal);
        }),
      );
      const ids = draftIdsOf(workspace.value);
      const listed = ids.slice(0, DRAFT_READ_LIMIT);
      const drafts = await Promise.all(
        listed.map(async (id) => {
          const [history, publication] = await Promise.all([
            read<DraftHistory | null>(contentUrls.draft(projectId, id), "draft", signal),
            read<ProposalState>(contentUrls.publication(projectId, id), "state", signal),
          ]);
          return history.status === "ok" && history.value !== null ? presentDraftRow(history.value, publication) : null;
        }),
      );
      const readDrafts = drafts.filter((d): d is DraftRow => d !== null);
      setData({ status: "ready", articles, drafts: readDrafts, draftsNotRead: listed.length - readDrafts.length, draftsNotListed: ids.length - listed.length });
    })().catch((error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") return;
      setData({ status: "failed" });
    });
    return () => controller.abort();
  }, [projectId]);
  return data;
}

export function ContentStudio({ projects }: { projects: readonly ProjectOption[] }) {
  const searchParams = useSearchParams();
  const selectId = useId();
  const initialProject = searchParams.get("project");
  const [projectId, setProjectId] = useState<string | null>(() =>
    initialProject !== null && projects.some((p) => p.id === initialProject) ? initialProject : (projects[0]?.id ?? null),
  );
  const [tab, setTab] = useState<ContentTabId>(() => resolveContentTab(searchParams.get("tab")));
  const projectName = projects.find((p) => p.id === projectId)?.name ?? "the project";

  return (
    <div className="space-y-6">
      <SectionHeader
        size="page"
        title="Content Studio"
        description={`The articles and drafts stored for ${projectName}, with their checks, approvals and proposals. Observed data only.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ObservedBadge />
            {projects.length > 0 && (
              <>
                <label htmlFor={selectId} className="text-xs text-fg-subtle">
                  Stored project
                </label>
                <Select id={selectId} size="sm" value={projectId ?? ""} onChange={(event) => setProjectId(event.target.value)} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
              </>
            )}
          </div>
        }
      />
      {projects.length === 0 && (
        <Panel>
          <EmptyState icon="projects" title="No stored project" description="Content Studio reads a stored project's own articles and drafts. Add a project on the Projects screen." />
        </Panel>
      )}
      {projectId !== null && (
        <>
          <TabList tabs={TABS} value={tab} onChange={setTab} label="Content sections" idPrefix="content" />
          <div role="tabpanel" id={tabPanelDomId("content", tab)} aria-labelledby={tabDomId("content", tab)} tabIndex={0} className="space-y-4 focus-visible:outline-none">
            <StudioTab key={projectId} projectId={projectId} tab={tab} />
          </div>
        </>
      )}
    </div>
  );
}

function StudioTab({ projectId, tab }: { projectId: string; tab: ContentTabId }) {
  const data = useStudioData(projectId);
  if (data.status === "loading") return <Skeleton className="h-64 w-full" />;
  if (data.status !== "ready") {
    return (
      <Panel>
        <EmptyState
          icon="content"
          title={data.status === "unavailable" ? "Content is not stored on this deployment" : "The stored content could not be read"}
          description={data.status === "unavailable" ? "There is no stored article or draft to show." : "Nothing is shown rather than a guess. Reload to try again."}
        />
      </Panel>
    );
  }
  if (tab === "articles") return <ArticlesTable projectId={projectId} rows={data.articles} />;
  if (tab === "drafts") return <DraftsTable projectId={projectId} rows={data.drafts} notRead={data.draftsNotRead} notListed={data.draftsNotListed} />;
  return <Pipeline projectId={projectId} articles={data.articles} drafts={data.drafts} />;
}

const STATUS_TONE: Record<string, BadgeTone> = { drafting: "neutral", checked: "accent", "fact-checked": "accent", approved: "positive", published: "positive", archived: "neutral" };

function ArticlesTable({ projectId, rows }: { projectId: string; rows: readonly ArticleRow[] }) {
  return (
    <Panel>
      <PanelHeader eyebrow="Stored articles" title="Articles" description={STUDIO_NOTE} />
      {rows.length === 0 ? (
        <EmptyState icon="content" title="No article recorded" description="An article is assembled from a completed content plan on the project screen. None is stored for this project." />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Article</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Version</TableHeaderCell>
              <TableHeaderCell>Check units</TableHeaderCell>
              <TableHeaderCell>Approval</TableHeaderCell>
              <TableHeaderCell>Proposal</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell header className="max-w-72">
                  <Link href={articleDetailHref(row.id, projectId)} className="text-fg hover:text-accent">
                    {row.title}
                  </Link>
                  <p className="font-mono text-[11px] text-fg-subtle">{row.slug ?? "slug not readable"}</p>
                </TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{articleStatusLabel(row.status)}</Badge>
                </TableCell>
                <TableCell className="text-xs">
                  {row.currentVersion} of {row.versionCount}
                </TableCell>
                <TableCell className="text-xs">{row.checks === "not-read" ? "Not read" : row.checks === "refused" ? "Cannot be cut into units" : checkProgressLine(row.checks)}</TableCell>
                <TableCell className="text-xs">{row.approval}</TableCell>
                <TableCell className="max-w-64 text-xs">{row.proposal}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <PanelFooter>
        <span>
          Controls live on the{" "}
          <Link href={projectHref(projectId)} className="text-accent hover:underline">
            project screen
          </Link>
          . A proposal is a record, never a publication.
        </span>
      </PanelFooter>
    </Panel>
  );
}

function DraftsTable({ projectId, rows, notRead, notListed }: { projectId: string; rows: readonly DraftRow[]; notRead: number; notListed: number }) {
  return (
    <Panel>
      <PanelHeader eyebrow="Stored drafts" title="Drafts" description="Section drafts saved from Writer runs, with every version, its fact-check, approval and proposal." />
      {rows.length === 0 ? (
        <EmptyState icon="layers" title="No draft recorded" description="A draft is saved from a completed Writer run on the project screen. None is stored for this project." />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Draft</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Version</TableHeaderCell>
              <TableHeaderCell>Fact-check</TableHeaderCell>
              <TableHeaderCell>Placeholders</TableHeaderCell>
              <TableHeaderCell>Approval</TableHeaderCell>
              <TableHeaderCell>Proposal</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell header className="max-w-72">
                  <p className="truncate" title={row.title}>
                    {row.title}
                  </p>
                  <p className="truncate text-[11px] text-fg-subtle" title={row.sectionLabel}>
                    Section {row.sectionLabel} · {row.id.slice(0, 8)}
                  </p>
                </TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{draftStatusLabel(row.status)}</Badge>
                </TableCell>
                <TableCell className="text-xs">
                  {row.currentVersion} of {row.versionCount}
                </TableCell>
                <TableCell className="text-xs">{row.factCheck}</TableCell>
                <TableCell numeric className="text-xs">
                  {row.placeholders}
                </TableCell>
                <TableCell className="text-xs">{row.approval}</TableCell>
                <TableCell className="max-w-64 text-xs">{row.proposal}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <PanelFooter>
        <span>
          {notRead > 0 ? `${notRead} ${notRead === 1 ? "draft" : "drafts"} could not be read. ` : ""}
          {notListed > 0 ? `${notListed} older ${notListed === 1 ? "draft is" : "drafts are"} not listed. ` : ""}
          Draft controls live on the{" "}
          <Link href={projectHref(projectId)} className="text-accent hover:underline">
            project screen
          </Link>
          .
        </span>
      </PanelFooter>
    </Panel>
  );
}

function Pipeline({ projectId, articles, drafts }: { projectId: string; articles: readonly ArticleRow[]; drafts: readonly DraftRow[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel>
        <PanelHeader eyebrow="By status" title="Articles" description="Every stored article under its status. Drafting → checked → approved; a proposal is a record, never a publication." />
        <PanelBody className="space-y-3">
          {groupArticles(articles).map((group) => (
            <PipelineStage key={group.status} label={group.label} empty="None">
              {group.items.map((row) => (
                <li key={row.id}>
                  <Link href={articleDetailHref(row.id, projectId)} className="text-fg hover:text-accent">
                    {row.title}
                  </Link>{" "}
                  <span className="text-fg-subtle">· version {row.currentVersion}</span>
                </li>
              ))}
            </PipelineStage>
          ))}
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader eyebrow="By status" title="Drafts" description="Every read draft under its status. Drafting → fact-checked → approved." />
        <PanelBody className="space-y-3">
          {groupDrafts(drafts).map((group) => (
            <PipelineStage key={group.status} label={group.label} empty="None">
              {group.items.map((row) => (
                <li key={row.id} className="truncate" title={row.title}>
                  {row.title} <span className="text-fg-subtle">· version {row.currentVersion}</span>
                </li>
              ))}
            </PipelineStage>
          ))}
        </PanelBody>
      </Panel>
    </div>
  );
}

function PipelineStage({ label, empty, children }: { label: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div>
      <p className="text-xs font-medium text-fg-muted">
        {label} <span className="text-fg-subtle">({children.length})</span>
      </p>
      {children.length === 0 ? <p className="text-xs text-fg-subtle italic">{empty}</p> : <ul className="mt-1 space-y-1 text-sm">{children}</ul>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Article detail
// ---------------------------------------------------------------------------

type DetailData =
  | { readonly status: "loading" }
  | { readonly status: "failed" | "unavailable" | "missing" }
  | {
      readonly status: "ready";
      readonly workspace: ArticleWorkspace;
      readonly checks: Read<ArticleVersionChecks>;
      readonly approval: Read<ArticleApprovalState>;
      readonly proposal: Read<ArticleProposalStateView>;
    };

export function ArticleDetailView({ projectId, projectName, articleId }: { projectId: string; projectName: string; articleId: string }) {
  const [data, setData] = useState<DetailData>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      const workspace = await read<ArticleWorkspace>(contentUrls.workspace(projectId), "workspace", signal);
      if (workspace.status !== "ok") return setData({ status: workspace.status });
      const history = workspace.value.articles.find((h) => h.article.id === articleId);
      if (history === undefined) return setData({ status: "missing" });
      const [checks, approval, proposal] = await Promise.all([
        read<ArticleVersionChecks>(contentUrls.checks(projectId, articleId, history.article.currentVersion), "checks", signal),
        read<ArticleApprovalState>(contentUrls.approval(projectId, articleId), "approval", signal),
        read<ArticleProposalStateView>(contentUrls.proposal(projectId, articleId), "proposal", signal),
      ]);
      setData({ status: "ready", workspace: workspace.value, checks, approval, proposal });
    })().catch((error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") return;
      setData({ status: "failed" });
    });
    return () => controller.abort();
  }, [projectId, articleId]);

  if (data.status === "loading") return <Skeleton className="h-96 w-full" />;
  if (data.status !== "ready") {
    return (
      <Panel>
        <EmptyState
          icon="content"
          title={data.status === "missing" ? "This article is not among the project's stored articles" : data.status === "unavailable" ? "Content is not stored on this deployment" : "The article could not be read"}
          description="Nothing is shown rather than a guess."
        />
      </Panel>
    );
  }
  const history = data.workspace.articles.find((h) => h.article.id === articleId);
  if (history === undefined) return null;
  const detail = presentArticleDetail(history);

  return (
    <div className="space-y-6">
      <SectionHeader
        size="page"
        title={detail.title}
        description={`A stored article of ${projectName}. ${STUDIO_NOTE}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ObservedBadge />
            <Badge tone={STATUS_TONE[detail.status] ?? "neutral"}>{articleStatusLabel(detail.status)}</Badge>
          </div>
        }
      />
      <Panel>
        <PanelBody className="grid gap-2 text-xs sm:grid-cols-2">
          <p>
            <span className="text-fg-subtle">Slug </span>
            <span className="font-mono">{detail.slug ?? "not readable"}</span>
          </p>
          <p>
            <span className="text-fg-subtle">Current version </span>
            {detail.currentVersion} of {detail.versions.length}
          </p>
          <p>
            <span className="text-fg-subtle">Content plan run </span>
            <span className="font-mono">{detail.sourcePlanRunId.slice(0, 8)}</span>
          </p>
          <p>
            <span className="text-fg-subtle">Created </span>
            {formatFullDate(detail.createdAt)} · <span className="text-fg-subtle">updated </span>
            {formatFullDate(detail.updatedAt)}
          </p>
        </PanelBody>
        <PanelFooter>
          <span>
            Editing, checking, approving and proposing are done on the{" "}
            <Link href={projectHref(projectId)} className="text-accent hover:underline">
              project screen
            </Link>
            ; this page only reads.
          </span>
        </PanelFooter>
      </Panel>

      <Panel>
        <PanelHeader eyebrow={`Version ${detail.currentVersion}`} title="Check units" description="The current version's units, each with the verdict recorded for it. A needs-review result is final for its version." />
        {data.checks.status !== "ok" ? (
          <PanelBody>
            <p className="text-sm text-critical" role="status">
              The check units could not be read.
            </p>
          </PanelBody>
        ) : data.checks.value.refusal !== null ? (
          <PanelBody>
            <p className="text-sm">This version cannot be cut into check units ({data.checks.value.refusal}).</p>
          </PanelBody>
        ) : (
          <>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Unit</TableHeaderCell>
                  <TableHeaderCell align="right">Statements</TableHeaderCell>
                  <TableHeaderCell align="right">Attested</TableHeaderCell>
                  <TableHeaderCell>Verdict</TableHeaderCell>
                  <TableHeaderCell>Counts</TableHeaderCell>
                  <TableHeaderCell>Run</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {presentUnits(data.checks.value).map((unit) => (
                  <TableRow key={unit.index}>
                    <TableCell header>
                      <span className="font-mono text-[11.5px]">{unit.key}</span>
                      <p className="text-[11px] text-fg-subtle">{unit.label}</p>
                    </TableCell>
                    <TableCell numeric className="text-xs">
                      {unit.statementCount}
                    </TableCell>
                    <TableCell numeric className="text-xs">
                      {unit.attestedStatementCount === 0 ? "—" : unit.attestedStatementCount}
                    </TableCell>
                    <TableCell>
                      <Badge tone={unit.status === "passed" ? "positive" : unit.status === "needs-review" || unit.status === "failed" ? "warning" : "neutral"}>{unitStatusLabel(unit.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {unit.counts === null
                        ? "—"
                        : `${unit.counts.supported} supported · ${unit.counts.partial} partial · ${unit.counts.unsupported} unsupported · ${unit.counts.unverifiable} unverifiable${
                            unit.counts.attested === null ? "" : ` · ${unit.counts.attested} attested`
                          }`}
                    </TableCell>
                    <TableCell className="font-mono text-[11px]">{unit.runId === null ? "—" : unit.runId.slice(0, 8)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PanelFooter>
              <span>{checkProgressLine(data.checks.value.counts)}</span>
            </PanelFooter>
          </>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <StateSummary title="Approval" summary={data.approval.status === "ok" ? approvalSummary(data.approval.value) : null} history={data.approval.status === "ok" ? data.approval.value.history.length : null} />
        <StateSummary title="Publication proposal" summary={data.proposal.status === "ok" ? proposalSummary(data.proposal.value) : null} history={data.proposal.status === "ok" ? data.proposal.value.history.length : null} />
      </div>

      <Panel>
        <PanelHeader eyebrow="Immutable history" title="Versions and source drafts" description="Every stored version, newest first, with the exact draft versions it was assembled from." />
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Version</TableHeaderCell>
              <TableHeaderCell>Saved</TableHeaderCell>
              <TableHeaderCell>Content hash</TableHeaderCell>
              <TableHeaderCell>Topic decision</TableHeaderCell>
              <TableHeaderCell align="right">Attested paragraphs</TableHeaderCell>
              <TableHeaderCell>Source draft versions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {detail.versions.map((version) => (
              <TableRow key={version.version}>
                <TableCell header className="text-xs">
                  {version.version}
                  {version.current ? " (current)" : ""}
                </TableCell>
                <TableCell className="text-xs">{formatFullDate(version.createdAt)}</TableCell>
                <TableCell className="font-mono text-[11px]">
                  {version.contentSha256.slice(0, 12)}… {version.verified ? "" : <span className="text-critical">does not verify</span>}
                </TableCell>
                <TableCell className="text-xs">{version.topicDecision ?? "not readable"}</TableCell>
                <TableCell numeric className="text-xs">
                  {version.attestedCount === null ? "—" : version.attestedCount}
                </TableCell>
                <TableCell className="font-mono text-[11px]">{version.sources.map((s) => `${s.draftId.slice(0, 8)} v${s.version}`).join(", ") || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </div>
  );
}

function StateSummary({ title, summary, history }: { title: string; summary: { readonly headline: string; readonly reasons: readonly string[] } | null; history: number | null }) {
  return (
    <Panel>
      <PanelHeader eyebrow="Current version" title={title} />
      <PanelBody className="space-y-2 text-sm">
        {summary === null ? (
          <p className="text-critical" role="status">
            Not read.
          </p>
        ) : (
          <>
            <p>{summary.headline}</p>
            {summary.reasons.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-fg-muted">
                {summary.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-fg-subtle">History: {history ?? 0} recorded</p>
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
