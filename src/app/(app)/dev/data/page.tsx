import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import {
  AGENT_ACTIVITY,
  AI_VISIBILITY,
  ANALYTICS_TREND,
  BACKLINK_SUMMARY,
  COMPETITORS,
  KEYWORDS,
  LINK_OPPORTUNITIES,
  OVERVIEW_METRICS,
  RECENT_WINS,
  SEO_OPPORTUNITIES,
  TECHNICAL_ISSUES,
} from "@/lib/mock/seo";
import {
  getCompetitorDatasetCounts,
  getCompetitorRecords,
} from "@/lib/mock/competitors";
import {
  getTechnicalDatasetCounts,
  getTechnicalPages,
} from "@/lib/mock/technical";
import { getReportsDatasetCounts } from "@/lib/mock/reports";

export const metadata: Metadata = {
  title: "Mock Data",
  robots: { index: false, follow: false },
};

type Dataset = {
  /** Exported binding name, so the page doubles as the import reference. */
  readonly name: string;
  readonly description: string;
  readonly records: number;
  /** First record, or the whole value when the export is a single object. */
  readonly sample: unknown;
};

const DATASETS: readonly Dataset[] = [
  {
    name: "OVERVIEW_METRICS",
    description: "Portfolio headline metrics for the Command Center.",
    records: OVERVIEW_METRICS.length,
    sample: OVERVIEW_METRICS[0],
  },
  {
    name: "AGENT_ACTIVITY",
    description: "Current task board across the twelve agents.",
    records: AGENT_ACTIVITY.length,
    sample: AGENT_ACTIVITY[0],
  },
  {
    name: "SEO_OPPORTUNITIES",
    description: "Prioritised opportunity queue with impact and effort.",
    records: SEO_OPPORTUNITIES.length,
    sample: SEO_OPPORTUNITIES[0],
  },
  {
    name: "TECHNICAL_ISSUES",
    description: "Site-health defects by severity, category, and status.",
    records: TECHNICAL_ISSUES.length,
    sample: TECHNICAL_ISSUES[0],
  },
  {
    name: "RECENT_WINS",
    description: "Delivered results, each linked to the module that owns it.",
    records: RECENT_WINS.length,
    sample: RECENT_WINS[0],
  },
  {
    name: "KEYWORDS",
    description: "Keyword sample with intent, cluster, and opportunity score.",
    records: KEYWORDS.length,
    sample: KEYWORDS[0],
  },
  {
    name: "COMPETITORS",
    description: "Tracked competitive set with visibility and overlap.",
    records: COMPETITORS.length,
    sample: COMPETITORS[0],
  },
  {
    name: "AI_VISIBILITY",
    description: "Answer presence across six generative engines.",
    records: AI_VISIBILITY.length,
    sample: AI_VISIBILITY[0],
  },
  {
    name: "BACKLINK_SUMMARY",
    description: "Link profile totals and authority trend. Single object.",
    records: 1,
    sample: BACKLINK_SUMMARY,
  },
  {
    name: "LINK_OPPORTUNITIES",
    description: "Outreach pipeline with prospect status.",
    records: LINK_OPPORTUNITIES.length,
    sample: LINK_OPPORTUNITIES[0],
  },
  {
    name: "ANALYTICS_TREND",
    description: "Daily series for the 28-day window ending 2026-09-07.",
    records: ANALYTICS_TREND.length,
    sample: ANALYTICS_TREND[0],
  },
];

/**
 * The derived Competitor Intelligence layer.
 *
 * Listed separately from the Phase 1 exports above because nothing here is
 * authored: every figure is derived from the project roster and the keyword
 * registry at first read. The counts are the ones the module itself reports,
 * so a distribution can be checked without opening the workspace.
 */
const COMPETITOR_COUNTS = getCompetitorDatasetCounts();
const COMPETITOR_SAMPLE = getCompetitorRecords()[0];

/**
 * The derived Technical SEO layer.
 *
 * Nothing here is authored either: the page inventory is the published content
 * records read technically, and every finding is a rule run over them. The
 * integrity list is the check that matters — each entry it can return is a way
 * this layer could contradict the canonical one it was built from, so an empty
 * list is the passing result.
 */
const TECHNICAL_COUNTS = getTechnicalDatasetCounts();
const TECHNICAL_SAMPLE = getTechnicalPages()[0];

const TECHNICAL_GROUPS: readonly {
  readonly label: string;
  readonly counts: Readonly<Record<string, number>>;
}[] = [
  { label: "Page severity", counts: TECHNICAL_COUNTS.bySeverity },
  { label: "Crawl state", counts: TECHNICAL_COUNTS.byCrawlState },
  { label: "Index status", counts: TECHNICAL_COUNTS.byIndexStatus },
  { label: "Indexability", counts: TECHNICAL_COUNTS.byIndexability },
  { label: "Canonical", counts: TECHNICAL_COUNTS.byCanonical },
  { label: "Core Web Vitals", counts: TECHNICAL_COUNTS.byCwv },
  { label: "Structured data", counts: TECHNICAL_COUNTS.bySchema },
  { label: "Findings by category", counts: TECHNICAL_COUNTS.byCategory },
  { label: "Findings by check", counts: TECHNICAL_COUNTS.byIssueType },
  { label: "Generative crawler access", counts: TECHNICAL_COUNTS.byAgentDirective },
];

/**
 * The composed Reports layer.
 *
 * Nothing here is authored either, and nothing here is calculated: every
 * figure in a report is quoted from the module that publishes it. The
 * integrity list is what matters — each entry it can return is a way this
 * layer could contradict the modules it quotes, put one client's figures in
 * another's report, or claim a period it cannot cover. An empty list passes.
 */
const REPORT_COUNTS = getReportsDatasetCounts();

const REPORT_GROUPS: readonly {
  readonly label: string;
  readonly counts: Readonly<Record<string, number>>;
}[] = [
  { label: "Report status", counts: REPORT_COUNTS.byStatus },
  { label: "Completeness band", counts: REPORT_COUNTS.byBand },
  { label: "Section state", counts: REPORT_COUNTS.byState },
  { label: "Schedule state", counts: REPORT_COUNTS.byDelivery },
];

const TOTAL_RECORDS = DATASETS.reduce(
  (total, dataset) => total + dataset.records,
  0,
);

/**
 * Development-only inspection route for the mock SEO data layer.
 *
 * Deliberately absent from the sidebar, and deliberately not dashboard UI: it
 * lists what each export contains and shows one record verbatim, so the data
 * can be checked without a module having been built for it yet.
 */
export default function MockDataInspectorPage() {
  return (
    <section>
      <SectionHeader
        size="page"
        eyebrow="Development only"
        title="Mock SEO data layer"
        description="Every dataset exported from @/lib/mock/seo, typed against @/types/seo. Fixtures only — no API, database, or external service is involved."
        actions={
          <Badge tone="neutral">
            {DATASETS.length} datasets · {TOTAL_RECORDS.toLocaleString("en-US")}{" "}
            records
          </Badge>
        }
      />

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        {DATASETS.map((dataset) => (
          <Panel key={dataset.name}>
            <PanelHeader
              title={dataset.name}
              description={dataset.description}
              actions={
                <Badge tone="accent">
                  {dataset.records.toLocaleString("en-US")}{" "}
                  {dataset.records === 1 ? "record" : "records"}
                </Badge>
              }
            />
            <PanelBody>
              <pre className="overflow-x-auto rounded-md border border-border bg-surface-raised p-3.5 font-mono text-[11.5px] leading-relaxed text-fg-muted">
                {JSON.stringify(dataset.sample, null, 2)}
              </pre>
            </PanelBody>
          </Panel>
        ))}
      </div>
      <Panel className="mt-6">
        <PanelHeader
          eyebrow="Derived"
          title="Competitor Intelligence"
          description="Built from the project roster and the keyword registry at first read. Nothing in this layer is authored."
        />
        <PanelBody>
          <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {COMPETITOR_COUNTS.map((entry) => (
              <div
                key={entry.label}
                className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
              >
                <dt className="text-[11px] text-fg-subtle">{entry.label}</dt>
                <dd className="tabular mt-1 text-[18px] leading-none font-semibold text-fg">
                  {entry.count}
                </dd>
              </div>
            ))}
          </dl>

          {COMPETITOR_SAMPLE && (
            <pre className="mt-4 max-h-96 overflow-auto rounded-md border border-border bg-canvas p-3 font-mono text-[11px] leading-relaxed text-fg-muted">
              {JSON.stringify(COMPETITOR_SAMPLE, null, 2)}
            </pre>
          )}
        </PanelBody>
      </Panel>

      <Panel className="mt-6">
        <PanelHeader
          eyebrow="Derived"
          title="Technical SEO"
          description="The published content inventory read technically, plus every finding the registry raises over it. Nothing in this layer is authored."
          actions={
            <Badge
              tone={TECHNICAL_COUNTS.integrity.length === 0 ? "positive" : "critical"}
            >
              {TECHNICAL_COUNTS.integrity.length === 0
                ? "Integrity: clean"
                : `Integrity: ${TECHNICAL_COUNTS.integrity.length} findings`}
            </Badge>
          }
        />
        <PanelBody>
          <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[
              { label: "Pages", count: TECHNICAL_COUNTS.pages },
              { label: "Findings", count: TECHNICAL_COUNTS.issues },
              { label: "Projects", count: TECHNICAL_COUNTS.projects },
              { label: "Clusters", count: TECHNICAL_COUNTS.clusters },
              { label: "Agent rules", count: TECHNICAL_COUNTS.agentDirectives },
            ].map((entry) => (
              <div
                key={entry.label}
                className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
              >
                <dt className="text-[11px] text-fg-subtle">{entry.label}</dt>
                <dd className="tabular mt-1 text-[18px] leading-none font-semibold text-fg">
                  {entry.count}
                </dd>
              </div>
            ))}
          </dl>

          {TECHNICAL_COUNTS.integrity.length > 0 && (
            <ul className="mt-4 space-y-1 rounded-md border border-critical/30 bg-critical/10 p-3 text-[11.5px] text-critical">
              {TECHNICAL_COUNTS.integrity.map((finding) => (
                <li key={finding}>{finding}</li>
              ))}
            </ul>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {TECHNICAL_GROUPS.map((group) => (
              <div key={group.label} className="min-w-0">
                <p className="text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
                  {group.label}
                </p>
                <ul className="mt-1.5 space-y-1">
                  {Object.entries(group.counts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([key, count]) => (
                      <li
                        key={key}
                        className="flex items-baseline justify-between gap-3 text-[11.5px]"
                      >
                        <span className="min-w-0 truncate text-fg-muted">
                          {key}
                        </span>
                        <span className="tabular shrink-0 font-semibold text-fg">
                          {count}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>

          {TECHNICAL_SAMPLE && (
            <pre className="mt-4 max-h-96 overflow-auto rounded-md border border-border bg-canvas p-3 font-mono text-[11px] leading-relaxed text-fg-muted">
              {JSON.stringify(TECHNICAL_SAMPLE, null, 2)}
            </pre>
          )}
        </PanelBody>
      </Panel>

      <Panel className="mt-6">
        <PanelHeader
          eyebrow="Composed"
          title="Reports"
          description="Client-ready reports assembled from the figures the other modules publish. Nothing in this layer holds a number of its own."
          actions={
            <Badge
              tone={REPORT_COUNTS.integrity.length === 0 ? "positive" : "critical"}
            >
              {REPORT_COUNTS.integrity.length === 0
                ? "Integrity: clean"
                : `Integrity: ${REPORT_COUNTS.integrity.length} findings`}
            </Badge>
          }
        />
        <PanelBody>
          <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
            {[
              { label: "Templates", count: REPORT_COUNTS.templates },
              { label: "Reports", count: REPORT_COUNTS.reports },
              { label: "Sections", count: REPORT_COUNTS.sections },
              { label: "Schedules", count: REPORT_COUNTS.schedules },
              { label: "Contacts", count: REPORT_COUNTS.recipients },
              { label: "Projects", count: REPORT_COUNTS.projects },
            ].map((entry) => (
              <div
                key={entry.label}
                className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
              >
                <dt className="text-[11px] text-fg-subtle">{entry.label}</dt>
                <dd className="tabular mt-1 text-[18px] leading-none font-semibold text-fg">
                  {entry.count}
                </dd>
              </div>
            ))}
          </dl>

          {REPORT_COUNTS.integrity.length > 0 && (
            <ul className="mt-4 space-y-1 rounded-md border border-critical/30 bg-critical/10 p-3 text-[11.5px] text-critical">
              {REPORT_COUNTS.integrity.map((finding) => (
                <li key={finding}>{finding}</li>
              ))}
            </ul>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {REPORT_GROUPS.map((group) => (
              <div key={group.label} className="min-w-0">
                <p className="text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
                  {group.label}
                </p>
                <ul className="mt-1.5 space-y-1">
                  {Object.entries(group.counts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([key, count]) => (
                      <li
                        key={key}
                        className="flex items-baseline justify-between gap-3 text-[11.5px]"
                      >
                        <span className="min-w-0 truncate text-fg-muted">
                          {key}
                        </span>
                        <span className="tabular shrink-0 font-semibold text-fg">
                          {count}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </PanelBody>
      </Panel>
    </section>
  );
}
