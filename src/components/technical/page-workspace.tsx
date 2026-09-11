import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";
import { AGENT_NAMES } from "@/lib/mock/seo";
import {
  MODELLED_SOURCE_NOTE,
  getTechnicalPageDetail,
} from "@/lib/mock/technical";
import {
  CategoryBadge,
  CwvBadge,
  EffortBadge,
  OpportunityCategoryBadge,
  ProvenanceTag,
  SchemaBadge,
  ScoreBreakdownList,
  ScoreReading,
  SeverityBadge,
  StatusCode,
  VitalValue,
} from "@/components/technical/technical-chrome";
import { CWV_THRESHOLDS } from "@/lib/mock/technical";
import type { DetailFact, TechnicalPage } from "@/types/technical";

/**
 * One URL, diagnosed.
 *
 * A server component: nothing here is interactive, and the detail is a pure
 * reading of the canonical page record and the issue registry. Triage happens
 * in the workspace, which owns that state.
 *
 * Scope is deliberately technical. What this page is worth, who it is for, how
 * it is performing editorially — that is Content Studio's, and this links
 * there rather than restating it.
 */
export function TechnicalPageWorkspace({ pageId }: { pageId: string }) {
  const detail = getTechnicalPageDetail(pageId);

  if (!detail) {
    return (
      <Panel>
        <EmptyState
          icon="search"
          title="Page not found"
          description="This URL is not in the published inventory."
        />
      </Panel>
    );
  }

  const { page } = detail;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/technical?tab=pages"
          className="inline-flex items-center gap-1.5 text-[12px] text-fg-subtle transition-colors hover:text-fg-muted"
        >
          <Icon name="arrow-left" className="h-3.5 w-3.5" />
          All pages
        </Link>

        <SectionHeader
          className="mt-3"
          size="page"
          eyebrow={`${page.projectName} · ${page.clusterName}`}
          title={page.title}
          description={page.path}
          actions={
            <>
              <SeverityBadge severity={page.severity} count={page.issueCount} />
              <Link
                href={`/content/${page.contentId}`}
                className={buttonClasses("secondary", "sm")}
              >
                Open in Content Studio
                <Icon name="arrow-right" className="h-4 w-4" />
              </Link>
            </>
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-1">
          <PanelHeader
            eyebrow="Diagnosis"
            title="Technical score"
            description={page.score.summary}
          />
          <PanelBody className="space-y-4">
            <ScoreReading
              score={page.score.score}
              caption="Technical score"
              label={`Technical score: ${page.score.score} out of 100`}
            />
            <ScoreBreakdownList score={page.score} />
          </PanelBody>
          <PanelFooter>
            <span>{MODELLED_SOURCE_NOTE}</span>
          </PanelFooter>
        </Panel>

        <div className="grid gap-4 sm:grid-cols-2 xl:col-span-2 xl:content-start">
          <FactPanel
            eyebrow="Response"
            title="What the URL returns"
            description="The response a crawler gets, and how far in the page sits."
            facts={detail.response}
          />
          <FactPanel
            eyebrow="Indexing"
            title="Whether it can be, and is, indexed"
            description="Permission and presence are separate questions and are answered separately."
            facts={detail.indexing}
          />
          <FactPanel
            eyebrow="On the page"
            title="Metadata and markup"
            description="Title, description, heading, and structured data."
            facts={detail.onPage}
          />
          <FactPanel
            eyebrow="Linking"
            title="How the site supports it"
            description="Inbound and outbound links from our own pages."
            facts={detail.linking}
          />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="Performance"
            title="Core Web Vitals"
            description={
              page.vitals.state === "unmeasured"
                ? "Too little traffic to model a field reading for this URL."
                : "Modelled field vitals against the published thresholds."
            }
            actions={<CwvBadge state={page.vitals.state} />}
          />
          <PanelBody>
            {page.vitals.state === "unmeasured" ? (
              <p className="text-[12px] leading-relaxed text-fg-muted">
                A page this quiet has no field data behind it. Saying so is
                honest; a reading assembled from a sample of nothing would not
                be.
              </p>
            ) : (
              <dl className="grid gap-3 sm:grid-cols-3">
                <VitalFigure
                  label="LCP"
                  value={page.vitals.lcp}
                  unit="ms"
                  good={CWV_THRESHOLDS.lcp.good}
                  poor={CWV_THRESHOLDS.lcp.poor}
                />
                <VitalFigure
                  label="INP"
                  value={page.vitals.inp}
                  unit="ms"
                  good={CWV_THRESHOLDS.inp.good}
                  poor={CWV_THRESHOLDS.inp.poor}
                />
                <VitalFigure
                  label="CLS"
                  value={page.vitals.cls}
                  unit=""
                  good={CWV_THRESHOLDS.cls.good}
                  poor={CWV_THRESHOLDS.cls.poor}
                />
              </dl>
            )}
          </PanelBody>
          <PanelFooter>
            <span>A page passes only when all three are in the good band</span>
            <ProvenanceTag provenance="seeded" />
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Structured data"
            title="Markup on this page"
            description={`Expected for a ${page.format} page.`}
            actions={<SchemaBadge state={page.schemaState} />}
          />
          <PanelBody>
            {page.schemaTypes.length === 0 ? (
              <p className="text-[12px] leading-relaxed text-fg-muted">
                No structured data on the page. Rich results are unavailable and
                the page&apos;s entities go unstated.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {page.schemaTypes.map((type) => (
                  <li
                    key={type}
                    className="rounded-md border border-border bg-surface-raised px-2 py-1 font-mono text-[11px] text-fg-muted"
                  >
                    {type}
                  </li>
                ))}
              </ul>
            )}
          </PanelBody>
          <PanelFooter>
            <span>Validity is modelled, not checked against a live test</span>
          </PanelFooter>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="Open against this URL"
            title={`${detail.issues.length} ${detail.issues.length === 1 ? "finding" : "findings"}`}
            description="Every check this page fails, worst first."
          />
          {detail.issues.length === 0 ? (
            <EmptyState
              size="sm"
              icon="check"
              title="Nothing outstanding"
              description="This URL passes every check the registry runs."
            />
          ) : (
            <ul className="divide-y divide-border">
              {detail.issues.map((issue) => (
                <li key={issue.id} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-[12.5px] font-medium text-fg">
                      {issue.label}
                    </span>
                    <span className="tabular shrink-0 text-[11.5px] text-fg-subtle">
                      {issue.affectedPages} pages ·{" "}
                      {formatPercent(issue.affectedShare, 0)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={issue.severity} />
                    <CategoryBadge category={issue.category} />
                    <span className="text-[11.5px] text-fg-subtle">
                      {AGENT_NAMES[issue.owner]}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-snug text-fg-subtle">
                    {issue.impact}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <PanelFooter>
            <span>Findings are raised per rule, across the project</span>
            <Link
              href="/technical?tab=issues"
              className={buttonClasses("secondary", "sm")}
            >
              All findings
              <Icon name="arrow-right" className="h-4 w-4" />
            </Link>
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="What to do"
            title="Recommended actions"
            description="The jobs in the queue that would touch this URL."
          />
          {detail.opportunities.length === 0 ? (
            <EmptyState
              size="sm"
              icon="check"
              title="No work queued"
              description="Nothing in the technical queue touches this page."
            />
          ) : (
            <ul className="divide-y divide-border">
              {detail.opportunities.map((entry) => (
                <li key={entry.id} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-[12.5px] font-medium text-fg">
                      {entry.title}
                    </span>
                    <span className="tabular shrink-0 text-[11.5px] text-fg-subtle">
                      Priority {entry.priority}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <OpportunityCategoryBadge category={entry.category} />
                    <EffortBadge effort={entry.effort} />
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-snug text-fg-subtle">
                    {entry.action}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <PanelFooter>
            <span>Ranked by value against effort</span>
            <Link
              href="/technical?tab=opportunities"
              className={buttonClasses("secondary", "sm")}
            >
              Full queue
              <Icon name="arrow-right" className="h-4 w-4" />
            </Link>
          </PanelFooter>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <PageListPanel
          eyebrow="Inbound"
          title="Pages linking here"
          description={
            detail.inboundPages.length === 0
              ? "Nothing on the site links to this page."
              : "Where this page's internal authority comes from."
          }
          pages={detail.inboundPages}
          empty="No internal link points at this URL."
        />
        <PageListPanel
          eyebrow="Outbound"
          title="Pages this links to"
          description={
            detail.outboundPages.length === 0
              ? "This page links to nothing else on the site."
              : "Where this page passes authority on to."
          }
          pages={detail.outboundPages}
          empty="Authority stops here instead of flowing on."
        />
        <PageListPanel
          eyebrow="Cluster"
          title={page.clusterName}
          description="The other published pages in this cluster."
          pages={detail.clusterPages}
          empty="This is the only published page in its cluster."
        />
      </div>
    </div>
  );
}

const TONE_TEXT = {
  positive: "text-positive",
  warning: "text-warning",
  critical: "text-critical",
  neutral: "text-fg",
} as const;

function FactPanel({
  eyebrow,
  title,
  description,
  facts,
}: {
  eyebrow: string;
  title: string;
  description: string;
  facts: readonly DetailFact[];
}) {
  return (
    <Panel>
      <PanelHeader eyebrow={eyebrow} title={title} description={description} />
      <PanelBody>
        <dl className="space-y-2.5">
          {facts.map((entry) => (
            <div key={entry.id} className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <dt className="flex items-baseline gap-2 text-[12px] text-fg-subtle">
                  {entry.label}
                  <ProvenanceTag provenance={entry.provenance} />
                </dt>
                <dd
                  className={cn(
                    "tabular shrink-0 text-[12.5px] font-semibold",
                    TONE_TEXT[entry.tone ?? "neutral"],
                  )}
                >
                  {entry.value}
                </dd>
              </div>
              {entry.detail && (
                <p className="mt-0.5 text-[11px] leading-snug break-words text-fg-subtle">
                  {entry.detail}
                </p>
              )}
            </div>
          ))}
        </dl>
      </PanelBody>
    </Panel>
  );
}

function VitalFigure({
  label,
  value,
  unit,
  good,
  poor,
}: {
  label: string;
  value: number;
  unit: string;
  good: number;
  poor: number;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
      <dt className="text-[11px] font-medium tracking-[0.03em] text-fg-muted uppercase">
        {label}
      </dt>
      <dd className="mt-1.5 text-[18px] leading-none font-semibold">
        <VitalValue value={value} unit={unit} good={good} poor={poor} />
      </dd>
      <p className="mt-1.5 text-[11px] text-fg-subtle">
        Good at or under {unit === "ms" ? `${good}ms` : good}
      </p>
    </div>
  );
}

function PageListPanel({
  eyebrow,
  title,
  description,
  pages,
  empty,
}: {
  eyebrow: string;
  title: string;
  description: string;
  pages: readonly TechnicalPage[];
  empty: string;
}) {
  return (
    <Panel>
      <PanelHeader eyebrow={eyebrow} title={title} description={description} />
      {pages.length === 0 ? (
        <EmptyState size="sm" icon="link-off" title="None" description={empty} />
      ) : (
        <ul className="divide-y divide-border">
          {pages.slice(0, 8).map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5"
            >
              <span className="min-w-0 flex-1">
                <Link
                  href={`/technical/pages/${entry.id}`}
                  className="block truncate text-[12.5px] font-medium text-fg transition-colors hover:text-accent"
                  title={entry.title}
                >
                  {entry.title}
                </Link>
                <span
                  className="block truncate font-mono text-[11px] text-fg-subtle"
                  title={entry.path}
                >
                  {entry.path}
                </span>
              </span>
              <StatusCode status={entry.httpStatus} />
            </li>
          ))}
        </ul>
      )}
      {pages.length > 8 && (
        <PanelFooter>
          <span>Showing 8 of {pages.length}</span>
        </PanelFooter>
      )}
    </Panel>
  );
}
