import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { cn } from "@/lib/cn";
import { formatFullDate } from "@/lib/format";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";
import {
  AUDIENCE_META,
  CADENCE_META,
  DELIVERY_NOTE,
  PROVENANCE_META,
  REPORTS_SOURCE_NOTE,
  REPORT_BRAND,
  getReportDetail,
} from "@/lib/mock/reports";
import { ExportPanel } from "@/components/reports/export-panel";
import {
  BandBadge,
  ChannelTag,
  DueValue,
  ProvenanceTag,
  ReadinessMeter,
  SectionStateBadge,
  StatusBadge,
} from "@/components/reports/reports-chrome";
import type { ReportFigure, ReportSection } from "@/types/reports";
import { ModelledBadge } from "@/components/ui/modelled-badge";

/**
 * One report, as the client would read it.
 *
 * A preview rather than an editor: the figures are quoted from the modules, so
 * there is nothing on this page a person could sensibly change. What they can
 * do is check any claim against the module that made it — every section links
 * to its source, scoped to this project — and write the report out as a file.
 *
 * A server component. The only interactive part is the export panel, which has
 * to be a client component because saving a file is a browser API.
 */
export function ReportPreview({ reportId }: { reportId: string }) {
  const detail = getReportDetail(reportId);
  if (!detail) return null;

  const { report, template, sections } = detail;
  const printable = sections.filter(
    (section) => section.state !== "unavailable",
  );
  const omitted = sections.filter((section) => section.state === "unavailable");

  return (
    <div className="space-y-6">
      <SectionHeader
        size="page"
        eyebrow={`${report.client} · ${report.projectName}`}
        title={report.title}
        description={detail.subtitle}
        actions={
          <>
            <ModelledBadge />
            <Link
              href="/reports"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-surface-raised px-3 text-[12px] font-medium text-fg-muted transition-colors hover:bg-surface-hover"
            >
              <Icon name="arrow-left" className="h-4 w-4" />
              All reports
            </Link>
            <Link
              href={`/projects/${report.projectId}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-surface-raised px-3 text-[12px] font-medium text-fg-muted transition-colors hover:bg-surface-hover"
            >
              <Icon name="projects" className="h-4 w-4" />
              Project
            </Link>
          </>
        }
      />

      <Panel>
        <PanelBody className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <StatusBadge status={report.status} />
          <BandBadge band={report.band} />
          <ReadinessMeter readiness={report.readiness} band={report.band} />

          <span className="text-[12px] text-fg-muted">
            {report.completeSections} of {report.sectionCount} sections complete
            {report.partialSections > 0 &&
              ` · ${report.partialSections} partial`}
            {report.unavailableSections > 0 &&
              ` · ${report.unavailableSections} with nothing to report`}
          </span>

          <DueValue
            dueInDays={report.dueInDays}
            dueAt={formatFullDate(report.dueAt)}
          />

          <ChannelTag channel={report.channel} />

          <span className="ml-auto text-[11.5px] text-fg-subtle">
            Assembled {formatFullDate(report.updatedAt)} · owned by{" "}
            {AGENT_NAMES[report.owner]}
          </span>
        </PanelBody>

        <PanelFooter>
          <span>
            {template.name} · {AUDIENCE_META[template.audience].label} ·{" "}
            {CADENCE_META[template.cadence].label} · period{" "}
            {formatFullDate(report.period.start)} to{" "}
            {formatFullDate(report.period.end)}
            {report.period.state === "open" && " (still open)"}
          </span>
          <span>
            Prepared by {REPORT_BRAND.preparedBy} for {REPORT_BRAND.workspace}
          </span>
        </PanelFooter>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {printable.map((section) => (
            <SectionPanel key={section.id} section={section} />
          ))}

          {omitted.length > 0 && (
            <Panel>
              <PanelHeader
                title="Left out of this report"
                description="Requested by the template, and omitted because the source module has nothing for this account. Stated rather than printed as an empty heading."
              />
              <PanelBody>
                <ul className="space-y-1.5">
                  {omitted.map((section) => (
                    <li
                      key={section.id}
                      className="text-[12.5px] text-fg-muted"
                    >
                      <span className="font-medium text-fg">
                        {section.title}
                      </span>{" "}
                      — {section.caveat}
                    </li>
                  ))}
                </ul>
              </PanelBody>
            </Panel>
          )}
        </div>

        <div className="space-y-4">
          <ExportPanel detail={detail} />

          <Panel>
            <PanelHeader
              title="Written for"
              description="Who this report is addressed to. Invented contacts on a reserved domain — nothing is transmitted to any of them."
            />
            <PanelBody>
              <ul className="space-y-2">
                {report.recipients.map((person) => (
                  <li key={person.email}>
                    <p className="text-[12.5px] font-medium text-fg">
                      {person.name}
                    </p>
                    <p className="text-[11.5px] text-fg-subtle">
                      {person.role} · {person.email}
                    </p>
                  </li>
                ))}
              </ul>
            </PanelBody>
            <PanelFooter>
              <span>{DELIVERY_NOTE}</span>
            </PanelFooter>
          </Panel>

          <Panel>
            <PanelHeader
              title="Where the figures came from"
              description="Every module this report quotes, scoped to this project."
            />
            <PanelBody>
              <ul className="space-y-2">
                {detail.sources.map((source) => (
                  <li key={source.label}>
                    <p className="text-[12.5px] font-medium text-fg">
                      {source.label}
                    </p>
                    <p className="text-[11.5px] leading-snug text-fg-subtle">
                      {source.note}
                    </p>
                    {source.href !== null && (
                      <Link
                        href={source.href}
                        className="mt-0.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-accent transition-opacity hover:opacity-80"
                      >
                        Check it
                        <Icon name="arrow-right" className="h-3 w-3" />
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </PanelBody>
            <PanelFooter>
              <span>{REPORTS_SOURCE_NOTE}</span>
            </PanelFooter>
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const STATE_BORDER = {
  complete: "border-l-positive",
  partial: "border-l-warning",
  unavailable: "border-l-border-strong",
} as const;

function SectionPanel({ section }: { section: ReportSection }) {
  return (
    <Panel className={cn("border-l-2", STATE_BORDER[section.state])}>
      <PanelHeader
        title={section.title}
        description={section.summary}
        actions={
          <>
            <SectionStateBadge
              state={section.state}
              caveat={section.caveat}
            />
            <ProvenanceTag provenance={section.provenance} />
          </>
        }
      />

      {section.figures.length > 0 && (
        <PanelBody>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {section.figures.map((figure) => (
              <FigureCard key={figure.id} figure={figure} />
            ))}
          </dl>
        </PanelBody>
      )}

      {section.highlights.length > 0 && (
        <PanelBody className={section.figures.length > 0 ? "pt-0" : undefined}>
          <ul className="space-y-1.5">
            {section.highlights.map((line) => (
              <li
                key={line}
                className="flex items-start gap-2 text-[12.5px] leading-relaxed text-fg-muted"
              >
                <Icon
                  name="chevron-right"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle"
                />
                {line}
              </li>
            ))}
          </ul>
        </PanelBody>
      )}

      {section.caveat !== null && (
        <div className="border-t border-border bg-warning/5 px-4 py-2.5 sm:px-5">
          <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-warning">
            <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {section.caveat}
          </p>
        </div>
      )}

      <PanelFooter>
        <span>Composed from {section.sourceLabel}.</span>
        {section.sourceHref !== null && (
          <Link
            href={section.sourceHref}
            className="inline-flex items-center gap-1 font-medium text-fg-muted transition-colors hover:text-accent"
          >
            Open the records
            <Icon name="arrow-right" className="h-3.5 w-3.5" />
          </Link>
        )}
      </PanelFooter>
    </Panel>
  );
}

function FigureCard({ figure }: { figure: ReportFigure }) {
  return (
    <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
      <dt className="text-[11px] font-medium tracking-[0.03em] text-fg-muted uppercase">
        {figure.label}
      </dt>
      <dd
        className={cn(
          "tabular mt-1.5 text-[18px] leading-none font-semibold",
          figure.tone === "critical"
            ? "text-critical"
            : figure.tone === "warning"
              ? "text-warning"
              : figure.tone === "positive"
                ? "text-positive"
                : "text-fg",
        )}
      >
        {figure.value}
      </dd>
      <p className="mt-1.5 text-[11px] leading-snug text-fg-subtle">
        {figure.detail}
      </p>
      {figure.provenance !== "composed" && (
        <Badge
          tone="neutral"
          className="mt-1.5"
          title={PROVENANCE_META[figure.provenance].description}
        >
          {PROVENANCE_META[figure.provenance].label}
        </Badge>
      )}
    </div>
  );
}
