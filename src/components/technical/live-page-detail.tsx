import Link from "next/link";
import { Fragment } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { CoverageBanner } from "@/components/technical/live-views";
import { urlBreakParts, type EdgeRow, type PageDetailView } from "@/lib/crawl/page-detail";
import { formatFullDate, formatTimeUtc } from "@/lib/format";

/**
 * One recorded page (Phase 3, checkpoint 3.3): what this product's own crawl
 * recorded for it, presented by `@/lib/crawl/page-detail`. Observed data only;
 * no score, no Core Web Vitals and no index status, because the crawl holds
 * none of them.
 */

const stamp = (iso: string) => `${formatFullDate(iso)}, ${formatTimeUtc(iso)}`;

function BackLink() {
  return (
    <Link href="/technical?tab=pages" className="inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg">
      <Icon name="arrow-left" className="h-3.5 w-3.5" />
      Technical SEO pages
    </Link>
  );
}

export function PageDetailNotice({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-4">
      <BackLink />
      <Panel>
        <EmptyState icon="inbox" title={title} description={description} />
      </Panel>
    </div>
  );
}

/** A URL that wraps only after its separators; one unbroken run longer than the line still wraps (fix F7, A4-11). */
function UrlText({ value }: { value: string }) {
  return (
    <span className="font-mono text-[12px]">
      {urlBreakParts(value).map((part, index) => (
        <Fragment key={index}>
          {part}
          <wbr />
        </Fragment>
      ))}
    </span>
  );
}

function Edges({ rows, empty, side }: { rows: readonly EdgeRow[]; empty: string; side: "from" | "to" }) {
  if (rows.length === 0) return <p className="text-sm text-fg-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {rows.map((row) => (
        <li key={row.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
          <span className="max-w-full truncate font-mono text-[12px] text-fg" title={row.url}>
            {side === "from" ? "from " : "to "}
            {row.path}
          </span>
          <span className="text-xs text-fg-subtle">
            “{row.anchor}”{row.internal ? "" : " · external"}
            {row.rel ? ` · rel ${row.rel}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function LivePageDetail({ view }: { view: PageDetailView }) {
  return (
    <div className="space-y-6">
      <BackLink />
      <SectionHeader
        size="page"
        title={view.title}
        description={view.url}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent" title="Read from this product's own crawl records. Not fixture data.">
              Observed
            </Badge>
            <Badge tone={view.fetched ? "positive" : "neutral"}>{view.fetched ? "Fetched" : "Not fetched"}</Badge>
          </div>
        }
      />
      <CoverageBanner text={view.banner} />

      {!view.fetched && (
        <p className="text-sm text-fg-muted" role="status">
          This crawl discovered this URL but did not read it, so nothing it would declare or carry was recorded. It was not looked at.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {view.groups.map((group) => (
          <Panel key={group.id}>
            <PanelHeader title={group.title} />
            <PanelBody>
              <dl className="divide-y divide-border">
                {group.facts.map((fact) => (
                  <div key={fact.label} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-3 py-1.5 text-sm">
                    <dt className="text-fg-muted">{fact.label}</dt>
                    <dd className="break-words text-fg" title={fact.title}>
                      {fact.url ? <UrlText value={fact.value} /> : fact.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </PanelBody>
            <PanelFooter>
              <span>{group.note}</span>
            </PanelFooter>
          </Panel>
        ))}
      </div>

      {view.fetched && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="Pages linking here" description="Recorded edges whose target is this page." />
            <PanelBody>
              <Edges rows={view.inbound} side="from" empty="No fetched page of this crawl links to this page." />
            </PanelBody>
            <PanelFooter>
              <span>{view.linksNote}</span>
            </PanelFooter>
          </Panel>
          <Panel>
            <PanelHeader title="Links on this page" description="Recorded edges found on this page, internal and external." />
            <PanelBody>
              <Edges rows={view.outbound} side="to" empty="No link was recorded on this page." />
            </PanelBody>
            <PanelFooter>
              <span>{view.linksNote}</span>
            </PanelFooter>
          </Panel>
        </div>
      )}

      <Panel>
        <PanelHeader title="Findings naming this page" description={view.findingsNote} />
        {view.findings.length > 0 && (
          <PanelBody>
            <ul className="space-y-2">
              {view.findings.map((row) => (
                <li key={row.key} className="rounded-md border border-border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={row.tone}>{row.severityLabel}</Badge>
                    <span className="text-sm font-medium text-fg">{row.ruleLabel}</span>
                    <span className="text-xs text-fg-subtle">{row.categoryLabel}</span>
                    <Badge tone={row.statusTone}>{row.statusLabel}</Badge>
                  </div>
                  <p className="mt-1 text-[13px] text-fg">{row.message}</p>
                  {row.partialUrls && <p className="mt-1 text-xs text-fg-subtle">This finding may also name pages not listed here.</p>}
                </li>
              ))}
            </ul>
          </PanelBody>
        )}
        <PanelFooter>
          <span>
            Observed in crawl of {view.hostScope}
            {view.finishedAt ? ` finished ${stamp(view.finishedAt)}` : ""}. Declared signals only; nothing here reports indexation, rankings, traffic or Core Web Vitals.
          </span>
        </PanelFooter>
      </Panel>
    </div>
  );
}
