import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { formatRelative, formatShortDate } from "@/lib/format";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";
import { REPORTS_AS_OF } from "@/lib/mock/reports";
import {
  AudienceTag,
  BandBadge,
  CadenceTag,
  ChannelTag,
  DeliveryStateBadge,
  DueValue,
  ReadinessMeter,
  StatusBadge,
} from "@/components/reports/reports-chrome";
import type {
  ProjectCoverage,
  ReportRecord,
  ReportSchedule,
} from "@/types/reports";

/**
 * The three tables in the Reports workspace.
 *
 * Presentational: sorting, filtering and paging belong to the workspace, which
 * is the only place that can keep them consistent across a tab change.
 */

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export function LibraryTable({
  reports,
}: {
  reports: readonly ReportRecord[];
}) {
  return (
    <Table caption="Reports in the library">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Report</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell>Completeness</TableHeaderCell>
          <TableHeaderCell>Sections</TableHeaderCell>
          <TableHeaderCell>Due</TableHeaderCell>
          <TableHeaderCell>Delivery</TableHeaderCell>
          <TableHeaderCell align="right">Assembled</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {reports.length === 0 ? (
          <TableEmptyRow colSpan={7}>
            <EmptyState
              size="sm"
              icon="reports"
              title="No reports match this selection"
              description="Clear a filter or widen the search. Every filter option is built from a live count, so an empty result here is the combination, not the option."
            />
          </TableEmptyRow>
        ) : (
          reports.map((report) => (
            <TableRow key={report.id}>
              <TableCell header>
                <Link
                  href={report.href}
                  className="group inline-flex flex-col gap-0.5"
                >
                  <span className="font-medium text-fg transition-colors group-hover:text-accent">
                    {report.templateName}
                  </span>
                  <span className="text-[11.5px] text-fg-subtle">
                    {report.projectName} · {report.period.label}
                    {report.period.state === "open" && " · open"}
                  </span>
                  <AudienceTag audience={report.audience} />
                </Link>
              </TableCell>

              <TableCell>
                <StatusBadge status={report.status} />
              </TableCell>

              <TableCell>
                <ReadinessMeter
                  readiness={report.readiness}
                  band={report.band}
                />
              </TableCell>

              <TableCell>
                <span
                  className="tabular text-[12px] whitespace-nowrap"
                  title={`${report.completeSections} complete, ${report.partialSections} partial, ${report.unavailableSections} unavailable`}
                >
                  {report.completeSections}/{report.sectionCount}
                  {report.partialSections > 0 && (
                    <span className="text-warning">
                      {" "}
                      +{report.partialSections} partial
                    </span>
                  )}
                </span>
              </TableCell>

              <TableCell>
                <DueValue
                  dueInDays={report.dueInDays}
                  dueAt={formatShortDate(report.dueAt)}
                />
              </TableCell>

              <TableCell>
                <div className="flex flex-col gap-0.5">
                  <ChannelTag channel={report.channel} />
                  <span className="text-[11px] text-fg-subtle">
                    {report.recipients.length}{" "}
                    {report.recipients.length === 1 ? "contact" : "contacts"}
                  </span>
                </div>
              </TableCell>

              <TableCell align="right" numeric>
                <span title={report.updatedAt}>
                  {formatRelative(report.updatedAt, REPORTS_AS_OF)}
                </span>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

export function ScheduleTable({
  schedules,
}: {
  schedules: readonly ReportSchedule[];
}) {
  return (
    <Table caption="Scheduled report preparation">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Schedule</TableHeaderCell>
          <TableHeaderCell>Cadence</TableHeaderCell>
          <TableHeaderCell>State</TableHeaderCell>
          <TableHeaderCell>Next run</TableHeaderCell>
          <TableHeaderCell>Last prepared</TableHeaderCell>
          <TableHeaderCell>Written for</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {schedules.length === 0 ? (
          <TableEmptyRow colSpan={6}>
            <EmptyState
              size="sm"
              icon="clock"
              title="No schedules in this selection"
              description="On-demand templates are prepared when they are asked for, so they carry no standing schedule."
            />
          </TableEmptyRow>
        ) : (
          schedules.map((schedule) => (
            <TableRow key={schedule.id}>
              <TableCell header>
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium text-fg">
                    {schedule.templateName}
                  </span>
                  <span className="text-[11.5px] text-fg-subtle">
                    {schedule.projectName} · owned by{" "}
                    {AGENT_NAMES[schedule.owner]}
                  </span>
                  {schedule.blockedReason !== null && (
                    <span className="text-[11.5px] text-warning">
                      {schedule.blockedReason}
                    </span>
                  )}
                </span>
              </TableCell>

              <TableCell>
                <CadenceTag cadence={schedule.cadence} />
              </TableCell>

              <TableCell>
                <DeliveryStateBadge state={schedule.state} />
              </TableCell>

              <TableCell>
                <span className="tabular text-[12px] whitespace-nowrap">
                  {formatShortDate(schedule.nextRunAt)}
                </span>
              </TableCell>

              <TableCell>
                <span className="tabular text-[12px] whitespace-nowrap">
                  {schedule.lastPreparedAt === null
                    ? "Never"
                    : formatRelative(schedule.lastPreparedAt, REPORTS_AS_OF)}
                </span>
              </TableCell>

              <TableCell>
                <span className="flex flex-col gap-0.5">
                  <ChannelTag channel={schedule.channel} />
                  {schedule.recipients.map((person) => (
                    <span
                      key={person.email}
                      className="text-[11px] text-fg-subtle"
                      title={`${person.email} — an invented fixture. Nothing is sent.`}
                    >
                      {person.name}, {person.role}
                    </span>
                  ))}
                </span>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

export function CoverageTable({
  rows,
}: {
  rows: readonly ProjectCoverage[];
}) {
  return (
    <Table caption="Reporting coverage by project">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Project</TableHeaderCell>
          <TableHeaderCell align="right">Reports</TableHeaderCell>
          <TableHeaderCell align="right">Schedules</TableHeaderCell>
          <TableHeaderCell>Mean completeness</TableHeaderCell>
          <TableHeaderCell align="right">Overdue</TableHeaderCell>
          <TableHeaderCell align="right">Next due</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.length === 0 ? (
          <TableEmptyRow colSpan={6}>
            <EmptyState
              size="sm"
              icon="projects"
              title="No projects match this selection"
              description="Every project on the roster appears here, including those with no reporting configured."
            />
          </TableEmptyRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.projectId}>
              <TableCell header>
                <Link
                  href={row.href}
                  className="group inline-flex flex-col gap-0.5"
                >
                  <span className="font-medium text-fg transition-colors group-hover:text-accent">
                    {row.projectName}
                  </span>
                  <span className="text-[11.5px] text-fg-subtle">
                    {row.client}
                  </span>
                </Link>
              </TableCell>

              <TableCell align="right" numeric>
                {row.reports}
              </TableCell>

              <TableCell align="right" numeric>
                {row.scheduled === 0 ? (
                  <Badge tone="warning" title="No standing schedule configured.">
                    None
                  </Badge>
                ) : (
                  row.scheduled
                )}
              </TableCell>

              <TableCell>
                <div className="flex items-center gap-2">
                  <ReadinessMeter readiness={row.readiness} band={row.band} />
                  <BandBadge band={row.band} />
                </div>
              </TableCell>

              <TableCell align="right" numeric>
                {row.overdue === 0 ? (
                  <span className="text-fg-subtle">—</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-critical">
                    <Icon name="alert" className="h-3.5 w-3.5" />
                    {row.overdue}
                  </span>
                )}
              </TableCell>

              <TableCell align="right" numeric>
                {row.nextDueAt === null ? (
                  <span className="text-fg-subtle">—</span>
                ) : (
                  formatShortDate(row.nextDueAt)
                )}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
