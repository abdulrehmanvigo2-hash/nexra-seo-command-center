"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import {
  AUDIENCE_META,
  CADENCE_META,
  EXPORT_FORMATS,
  EXPORT_NOTE,
  SECTION_META,
  SECTION_WEIGHT,
} from "@/lib/mock/reports";
import type { ReportTemplate, SectionKind } from "@/types/reports";

/**
 * The template catalogue.
 *
 * A template is a reading order and an audience — it holds no figures. Each
 * card therefore shows the sections it asks for, in order, and which module
 * each one will be filled from, because that is the entirety of what choosing
 * a template decides.
 */
export function TemplatesView({
  templates,
  usage,
}: {
  templates: readonly ReportTemplate[];
  /** How many reports in the current selection use each template. */
  usage: Readonly<Record<string, number>>;
}) {
  if (templates.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon="reports"
          title="No templates match this selection"
          description="Clear the audience or cadence filter to see the rest of the catalogue."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        {templates.map((template) => (
          <Panel key={template.id}>
            <PanelHeader
              eyebrow={`${AUDIENCE_META[template.audience].label} · ${CADENCE_META[template.cadence].label}`}
              title={template.name}
              description={template.description}
              actions={
                <>
                  <Badge
                    tone={template.builtIn ? "neutral" : "accent"}
                    title={
                      template.builtIn
                        ? "Ships with the product."
                        : "Cloned and edited in this workspace."
                    }
                  >
                    {template.builtIn ? "Built in" : "Cloned"}
                  </Badge>
                  <Badge tone="neutral">
                    {usage[template.id] ?? 0} in use
                  </Badge>
                </>
              }
            />

            <PanelBody className="space-y-2.5">
              <p className="text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
                Reading order
              </p>
              <ol className="space-y-1.5">
                {template.sections.map((kind, index) => (
                  <SectionRow key={kind} kind={kind} index={index + 1} />
                ))}
              </ol>
            </PanelBody>

            <PanelFooter>
              <span>
                {template.sections.length} sections. Each is composed from one
                module and names it.
              </span>
            </PanelFooter>
          </Panel>
        ))}
      </div>

      <Panel>
        <PanelHeader
          title="How a template becomes a report"
          description="The template chooses the order and the audience. Everything else is quoted."
        />
        <PanelBody>
          <ol className="space-y-2.5 text-[12.5px] leading-relaxed text-fg-muted">
            <Step index={1}>
              The template names a list of sections. Nothing in it holds a
              figure.
            </Step>
            <Step index={2}>
              Each section reads the module that owns it and quotes what that
              module publishes for this project — unchanged, so the report and
              the module cannot disagree.
            </Step>
            <Step index={3}>
              Each section then states whether it actually covers the period on
              the cover. A window still open, a window older than the module
              reaches back, or too few records behind it all pull the section to
              partial, with the reason attached.
            </Step>
            <Step index={4}>
              Completeness is the weighted share of sections that came back
              whole. A missing executive summary counts for more than a missing
              methodology note, which is what the weights below say.
            </Step>
          </ol>
        </PanelBody>
        <PanelFooter className="block">
          <p className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
            Section weights
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
            {(Object.keys(SECTION_WEIGHT) as SectionKind[]).map((kind) => (
              <li
                key={kind}
                className="flex items-center gap-1.5 text-[11.5px] text-fg-muted"
                title={SECTION_META[kind].description}
              >
                {SECTION_META[kind].label}
                <span className="tabular font-semibold text-fg">
                  {SECTION_WEIGHT[kind].toFixed(1)}
                </span>
              </li>
            ))}
          </ul>
        </PanelFooter>
      </Panel>

      <Panel>
        <PanelHeader
          title="Export formats"
          description="What a finished report can be written out as. All four are produced in the browser and saved to your machine."
        />
        <PanelBody>
          <ul className="grid gap-3 sm:grid-cols-2">
            {EXPORT_FORMATS.map((format) => (
              <li
                key={format.id}
                className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
              >
                <p className="flex items-center gap-2 text-[12.5px] font-medium text-fg">
                  <Icon name={format.icon} className="h-4 w-4 text-fg-subtle" />
                  {format.label}
                  <span className="font-mono text-[11px] text-fg-subtle">
                    .{format.extension}
                  </span>
                </p>
                <p className="mt-1 text-[11.5px] leading-snug text-fg-subtle">
                  {format.description}
                </p>
              </li>
            ))}
          </ul>
        </PanelBody>
        <PanelFooter>
          <span>{EXPORT_NOTE}</span>
        </PanelFooter>
      </Panel>
    </div>
  );
}

function SectionRow({ kind, index }: { kind: SectionKind; index: number }) {
  const meta = SECTION_META[kind];

  return (
    <li className="flex items-start gap-2.5">
      <span className="tabular mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border-strong bg-surface-raised text-[10.5px] font-semibold text-fg-subtle">
        {index}
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium text-fg">
          {meta.label}
        </span>
        <span className="block text-[11.5px] leading-snug text-fg-subtle">
          {meta.description}
        </span>
        <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-fg-subtle">
          <Icon name="layers" className="h-3 w-3 shrink-0" />
          {meta.source}
          {meta.href !== null && (
            <Link
              href={meta.href}
              className="ml-1 font-medium text-accent transition-opacity hover:opacity-80"
            >
              Open
            </Link>
          )}
        </span>
      </span>
    </li>
  );
}

function Step({
  index,
  children,
}: {
  index: number;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={cn(
          "tabular mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
          "bg-accent-soft text-[10.5px] font-semibold text-accent",
        )}
      >
        {index}
      </span>
      <span>{children}</span>
    </li>
  );
}
