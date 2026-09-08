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
    </section>
  );
}
