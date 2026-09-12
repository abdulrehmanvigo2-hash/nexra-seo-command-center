"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { formatShortDate } from "@/lib/format";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";
import {
  DELIVERY_NOTE_SHORT,
  REPORTS_SOURCE_NOTE,
  SECTION_META,
} from "@/lib/mock/reports";
import {
  BandBadge,
  DistributionBar,
  DueValue,
  ReadinessMeter,
  StatusBadge,
} from "@/components/reports/reports-chrome";
import type { ReportRecord, ReportsOverview } from "@/types/reports";

/**
 * The reporting position at a glance.
 *
 * Three questions, in the order an account lead asks them: what is late, what
 * is coming, and how complete is what we are about to send. The distributions
 * sit underneath because they answer the fourth question — whether the picture
 * above is typical — and nobody asks that first.
 */
export function OverviewView({
  overview,
  onOpenTab,
}: {
  overview: ReportsOverview;
  onOpenTab: (tab: string) => void;
}) {
  if (overview.reports.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon="reports"
          title="No reporting configured for this selection"
          description="Reports are arranged per account. Choose another project, or the whole portfolio, to see what is configured."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Past due"
            description="Past the date agreed with the client and not yet approved or issued. Derived from the date, never set by hand."
            actions={
              <Button icon="rows" onClick={() => onOpenTab("library")}>
                Open library
              </Button>
            }
          />
          {overview.overdue.length === 0 ? (
            <EmptyState
              size="sm"
              icon="check"
              title="Nothing is late"
              description="Every report past its date has been approved or issued."
            />
          ) : (
            <ul className="divide-y divide-border">
              {overview.overdue.slice(0, 5).map((report) => (
                <ReportRow key={report.id} report={report} />
              ))}
            </ul>
          )}
          {overview.overdue.length > 5 && (
            <PanelFooter>
              <span>
                {overview.overdue.length - 5} more past due in the library.
              </span>
            </PanelFooter>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            title="What to finish next"
            description="Ordered by how late it is, then by how soon it is due. Completeness only breaks a tie — a nearly-finished report that is not due for a fortnight is not the one to open."
          />
          {overview.upcoming.length === 0 ? (
            <EmptyState
              size="sm"
              icon="check"
              title="Nothing outstanding"
              description="Every report in this selection has been issued."
            />
          ) : (
            <ul className="divide-y divide-border">
              {overview.upcoming.map((report) => (
                <ReportRow key={report.id} report={report} />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel>
          <PanelHeader
            title="Workflow"
            description="Where the reports in this selection currently sit."
          />
          <PanelBody>
            <DistributionBar rows={overview.statusRows} label="Report status" />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            title="Completeness"
            description="How much of each template could actually be filled."
          />
          <PanelBody>
            <DistributionBar
              rows={overview.readinessRows}
              label="Report completeness"
            />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            title="Sections"
            description="Across every report in this selection."
          />
          <PanelBody>
            <DistributionBar
              rows={overview.sectionRows}
              label="Section state"
            />
          </PanelBody>
          <PanelFooter>
            <span>
              A partial section is filled but covers a shorter or older window
              than its heading implies, and says which.
            </span>
          </PanelFooter>
        </Panel>
      </div>

      {overview.blocked.length > 0 && (
        <Panel>
          <PanelHeader
            title="Sections nothing can fill"
            description="Requested by a template and left out, because the source module has no records for the accounts asking for it."
          />
          <PanelBody>
            <ul className="space-y-2">
              {overview.blocked.map((entry) => (
                <li
                  key={entry.kind}
                  className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-fg-muted"
                >
                  <span className="font-medium text-fg">
                    {SECTION_META[entry.kind].label}
                  </span>
                  <span className="tabular text-fg-subtle">
                    {entry.count} {entry.count === 1 ? "report" : "reports"}
                  </span>
                  <span>{entry.reason}</span>
                </li>
              ))}
            </ul>
          </PanelBody>
        </Panel>
      )}

      <Panel>
        <PanelHeader
          title="What these figures are"
          description="Stated here and printed into every export, because an export is the one artefact of this product that leaves the building."
        />
        <PanelBody className="space-y-2">
          <p className="text-[12.5px] leading-relaxed text-fg-muted">
            {REPORTS_SOURCE_NOTE}
          </p>
          <p className="flex items-start gap-1.5 text-[12px] text-fg-subtle">
            <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {DELIVERY_NOTE_SHORT}
          </p>
        </PanelBody>
      </Panel>
    </div>
  );
}

function ReportRow({ report }: { report: ReportRecord }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
      <Link href={report.href} className="group min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium text-fg transition-colors group-hover:text-accent">
          {report.templateName}
        </span>
        <span className="block truncate text-[11.5px] text-fg-subtle">
          {report.projectName} · {report.period.label} · owned by{" "}
          {AGENT_NAMES[report.owner]}
        </span>
      </Link>

      <StatusBadge status={report.status} />
      <BandBadge band={report.band} />
      <ReadinessMeter readiness={report.readiness} band={report.band} />
      <DueValue
        dueInDays={report.dueInDays}
        dueAt={formatShortDate(report.dueAt)}
      />
      <Link
        href={report.href}
        aria-label={`Open ${report.templateName} for ${report.projectName}`}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface-raised text-fg-muted transition-colors hover:bg-surface-hover"
      >
        <Icon name="arrow-right" className="h-4 w-4" />
      </Link>
    </li>
  );
}
