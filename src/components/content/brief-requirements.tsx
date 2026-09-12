import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Meter } from "@/components/ui/meter";
import {
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
} from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";
import {
  REQUIREMENT_KIND_META,
  REQUIREMENT_KIND_ORDER,
  REQUIREMENT_NOTE,
  REQUIREMENT_STATUS_META,
  SEVERITY_META,
  briefRequirementsFor,
} from "@/lib/mock/ai-visibility";
import type {
  BriefRequirement,
  RequirementKind,
} from "@/types/ai-visibility";

/**
 * What a brief has to prove, establish, answer and gather.
 *
 * Content Studio's brief already said what to cover and which rivals to beat.
 * It said nothing about what the page had to *prove* — and everything needed
 * to say that was already computed two modules away, reaching nobody who was
 * going to write anything.
 *
 * Read back from AI Visibility at the component layer, not at the data layer.
 * `ai-visibility/*` reads `content/*`, so the brief fixture cannot import it
 * without closing a cycle; this component can, and does. The same convention
 * the AI readiness note on a keyword already uses.
 *
 * Renders nothing where a brief has no outstanding requirements, which is a
 * real outcome rather than an empty heading.
 */
export function BriefRequirementsSection({
  contentId,
}: {
  contentId: string;
}) {
  const requirements = briefRequirementsFor(contentId);
  if (!requirements) return null;

  const worst = requirements.worstUnresolved;

  return (
    <Panel>
      <PanelHeader
        eyebrow="Evidence and AI requirements"
        title="What this piece has to deliver"
        description="Derived from the answer-engine reading of this topic. Every row resolves to a record another module already raised."
        actions={
          <>
            {worst !== null && (
              <Badge
                tone={SEVERITY_META[worst].tone}
                dot
                title={`The worst severity among everything still unresolved. ${SEVERITY_META[worst].description}`}
              >
                {SEVERITY_META[worst].label} unresolved
              </Badge>
            )}
            <span className="tabular text-[11.5px] text-fg-subtle">
              {requirements.outstanding} outstanding ·{" "}
              {requirements.partlyMet} partly met
            </span>
          </>
        }
      />

      <PanelBody>
        <dl className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {REQUIREMENT_KIND_ORDER.map((kind) => {
            const meta = REQUIREMENT_KIND_META[kind];
            const count = requirements.byKind[kind];

            return (
              <div
                key={kind}
                title={meta.description}
                className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
              >
                <dt className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.03em] text-fg-muted uppercase">
                  <Icon name={meta.icon} className="h-3.5 w-3.5 shrink-0" />
                  {meta.label}
                </dt>
                <dd
                  className={cn(
                    "tabular mt-1.5 text-[18px] leading-none font-semibold",
                    count === 0 ? "text-fg-subtle" : "text-fg",
                  )}
                >
                  {count}
                </dd>
              </div>
            );
          })}
        </dl>
      </PanelBody>

      {REQUIREMENT_KIND_ORDER.map((kind) => {
        const rows = requirements.requirements.filter(
          (entry) => entry.kind === kind,
        );
        if (rows.length === 0) return null;

        return (
          <Group key={kind} kind={kind} rows={rows} />
        );
      })}

      <PanelFooter className="block">
        <p className="flex items-start gap-1.5">
          <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {REQUIREMENT_NOTE}
        </p>
        {requirements.trimmed > 0 && (
          <p className="mt-1.5 pl-5 text-fg-subtle">
            {requirements.trimmed} lower-priority{" "}
            {requirements.trimmed === 1 ? "requirement is" : "requirements are"}{" "}
            not shown. Nothing critical is ever held back.
          </p>
        )}
      </PanelFooter>
    </Panel>
  );
}

function Group({
  kind,
  rows,
}: {
  kind: RequirementKind;
  rows: readonly BriefRequirement[];
}) {
  const meta = REQUIREMENT_KIND_META[kind];

  return (
    <section className="border-t border-border">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 pt-3.5 sm:px-5">
        <h4 className="text-[12.5px] font-semibold text-fg">{meta.heading}</h4>
        <span className="text-[11.5px] text-fg-subtle">{meta.description}</span>
      </div>

      <ul className="divide-y divide-border">
        {rows.map((requirement) => (
          <RequirementRow key={requirement.id} requirement={requirement} />
        ))}
      </ul>
    </section>
  );
}

const SEVERITY_BORDER = {
  critical: "border-l-critical",
  high: "border-l-critical",
  medium: "border-l-warning",
  low: "border-l-border-strong",
} as const;

function RequirementRow({
  requirement,
}: {
  requirement: BriefRequirement;
}) {
  const status = REQUIREMENT_STATUS_META[requirement.status];
  const severity = SEVERITY_META[requirement.severity];

  return (
    <li
      className={cn(
        "border-l-2 px-4 py-3 sm:px-5",
        SEVERITY_BORDER[requirement.severity],
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <p className="min-w-0 flex-1 text-[12.5px] font-medium text-fg">
          {requirement.title}
        </p>
        <Badge tone={severity.tone} title={severity.description}>
          {severity.label}
        </Badge>
        <Badge tone={status.tone} dot title={status.description}>
          {status.label}
        </Badge>
      </div>

      <p className="mt-1 text-[11.5px] leading-relaxed text-fg-muted">
        {requirement.why}
      </p>

      <p className="mt-1 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-fg-muted">
        <Icon
          name="chevron-right"
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle"
        />
        {requirement.treatment}
      </p>

      <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-fg-subtle">
        <span>{requirement.sourceModule}</span>
        <span aria-hidden="true">·</span>
        <span>{AGENT_NAMES[requirement.owner]}</span>
        {requirement.branchIntent !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span>{requirement.branchIntent} intent</span>
          </>
        )}
        {requirement.sourceHref !== null && (
          <Link
            href={requirement.sourceHref}
            className="ml-auto inline-flex items-center gap-1 font-medium text-fg-muted transition-colors hover:text-accent"
          >
            Check the record
            <Icon name="arrow-right" className="h-3 w-3" />
          </Link>
        )}
      </p>
    </li>
  );
}

/**
 * The compact reading, for the briefs list.
 *
 * One line rather than a panel: a reader scanning forty briefs wants to know
 * which ones have work attached, not what the work is.
 */
export function BriefRequirementsSummary({
  contentId,
}: {
  contentId: string;
}) {
  const requirements = briefRequirementsFor(contentId);
  if (!requirements) return null;

  const worst = requirements.worstUnresolved;

  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-fg-subtle">
      <span className="inline-flex items-center gap-1">
        <Icon name="shield" className="h-3 w-3 shrink-0" />
        {requirements.requirements.length} AI{" "}
        {requirements.requirements.length === 1
          ? "requirement"
          : "requirements"}
      </span>
      {worst !== null && (
        <Badge tone={SEVERITY_META[worst].tone} title={SEVERITY_META[worst].description}>
          {SEVERITY_META[worst].label}
        </Badge>
      )}
      <Meter
        className="max-w-20"
        value={requirements.partlyMet}
        max={Math.max(requirements.requirements.length, 1)}
        tone="warning"
        size="sm"
        label={`${requirements.partlyMet} of ${requirements.requirements.length} requirements partly met`}
      />
    </span>
  );
}
