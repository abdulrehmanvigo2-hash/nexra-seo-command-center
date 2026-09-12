import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Meter } from "@/components/ui/meter";
import { cn } from "@/lib/cn";
import {
  AUDIENCE_META,
  BAND_META,
  CADENCE_META,
  CHANNEL_META,
  DELIVERY_STATE_META,
  PROVENANCE_META,
  SECTION_STATE_META,
  STATUS_META,
} from "@/lib/mock/reports";
import type {
  Cadence,
  DeliveryChannel,
  DeliveryState,
  ReadinessBand,
  ReportAudience,
  ReportDistributionRow,
  ReportProvenance,
  ReportStatus,
  SectionState,
} from "@/types/reports";

/**
 * The pieces of report display that appear in more than one place.
 *
 * A status, a completeness band and a section state read the same in the
 * library table, on the overview, inside a report preview, on the project
 * workspace and on the Command Center, because all of them render these.
 *
 * Two of these components are load-bearing on honesty. `SectionStateBadge`
 * carries the reason a section is short wherever it appears, and
 * `ProvenanceTag` says which module a figure came from — neither is decorative.
 */

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function StatusBadge({ status }: { status: ReportStatus }) {
  const meta = STATUS_META[status];
  return (
    <Badge tone={meta.tone} dot title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function BandBadge({ band }: { band: ReadinessBand }) {
  const meta = BAND_META[band];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function DeliveryStateBadge({ state }: { state: DeliveryState }) {
  const meta = DELIVERY_STATE_META[state];
  return (
    <Badge tone={meta.tone} dot title={meta.description}>
      {meta.label}
    </Badge>
  );
}

/**
 * How complete a section is, with the reason attached.
 *
 * The reason is the point. "Partial" on its own tells a reader nothing they can
 * act on; "partial because June closed longer ago than the source reaches back"
 * tells them the figure is current rather than historical.
 */
export function SectionStateBadge({
  state,
  caveat,
}: {
  state: SectionState;
  caveat?: string | null;
}) {
  const meta = SECTION_STATE_META[state];
  return (
    <Badge tone={meta.tone} dot title={caveat ?? meta.description}>
      {meta.label}
    </Badge>
  );
}

export function ProvenanceTag({
  provenance,
  className,
}: {
  provenance: ReportProvenance;
  className?: string;
}) {
  const meta = PROVENANCE_META[provenance];
  return (
    <span
      title={meta.description}
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium tracking-[0.04em] text-fg-subtle uppercase",
        className,
      )}
    >
      <Icon name="info" className="h-3 w-3 shrink-0" />
      {meta.label}
    </span>
  );
}

export function CadenceTag({ cadence }: { cadence: Cadence }) {
  const meta = CADENCE_META[cadence];
  return (
    <span className="text-[11.5px] whitespace-nowrap text-fg-subtle" title={meta.description}>
      {meta.label}
    </span>
  );
}

export function AudienceTag({ audience }: { audience: ReportAudience }) {
  const meta = AUDIENCE_META[audience];
  return (
    <span className="text-[11.5px] text-fg-subtle" title={meta.description}>
      {meta.label}
    </span>
  );
}

export function ChannelTag({ channel }: { channel: DeliveryChannel }) {
  const meta = CHANNEL_META[channel];
  return (
    <span
      className="inline-flex items-center gap-1 text-[11.5px] whitespace-nowrap text-fg-subtle"
      title={meta.description}
    >
      <Icon
        name={
          channel === "email"
            ? "inbox"
            : channel === "shared-link"
              ? "external"
              : "handoff"
        }
        className="h-3.5 w-3.5 shrink-0"
      />
      {meta.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

const BAND_TONE = {
  ready: "positive",
  nearly: "accent",
  thin: "warning",
  "not-ready": "critical",
} as const;

/** Completeness as a number and a bar. The bar never appears on its own. */
export function ReadinessMeter({
  readiness,
  band,
  className,
}: {
  readiness: number;
  band: ReadinessBand;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-24 items-center gap-2", className)}>
      <span className="tabular text-[12.5px] font-semibold text-fg">
        {readiness}
      </span>
      <Meter
        value={readiness}
        tone={BAND_TONE[band]}
        size="sm"
        label={`Completeness ${readiness} out of 100`}
      />
    </div>
  );
}

/**
 * How a due date reads today.
 *
 * Days rather than a date, because "4 days late" is the thing a reader acts
 * on and the date is one hover away.
 */
export function DueValue({
  dueInDays,
  dueAt,
  className,
}: {
  dueInDays: number;
  dueAt: string;
  className?: string;
}) {
  const label =
    dueInDays < 0
      ? `${Math.abs(dueInDays)}d late`
      : dueInDays === 0
        ? "Due today"
        : `in ${dueInDays}d`;

  return (
    <span
      title={`Due ${dueAt}`}
      className={cn(
        "tabular inline-flex items-center gap-1 text-[12px] font-medium whitespace-nowrap",
        dueInDays < 0
          ? "text-critical"
          : dueInDays <= 3
            ? "text-warning"
            : "text-fg-muted",
        className,
      )}
    >
      <Icon
        name={dueInDays < 0 ? "alert" : "calendar"}
        className="h-3.5 w-3.5 shrink-0"
      />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Distributions
// ---------------------------------------------------------------------------

const ROW_TONE = {
  positive: "bg-positive",
  accent: "bg-accent",
  warning: "bg-warning",
  critical: "bg-critical",
  neutral: "bg-fg-subtle",
} as const;

/**
 * A distribution as a stacked bar plus a legend.
 *
 * Rows with a zero count never reach here — they are filtered where the
 * distribution is built, so a legend never offers a band nothing is in.
 */
export function DistributionBar({
  rows,
  label,
}: {
  rows: readonly ReportDistributionRow[];
  label: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-[12px] text-fg-subtle">Nothing in this selection.</p>
    );
  }

  return (
    <div>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-surface-hover"
        role="img"
        aria-label={`${label}: ${rows.map((row) => `${row.label} ${row.count}`).join(", ")}`}
      >
        {rows.map((row) => (
          <span
            key={row.id}
            className={ROW_TONE[row.tone]}
            style={{ width: `${row.share}%` }}
          />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {rows.map((row) => (
          <li
            key={row.id}
            title={row.description}
            className="flex items-center gap-1.5 text-[11.5px] text-fg-muted"
          >
            <span
              aria-hidden="true"
              className={cn("h-2 w-2 shrink-0 rounded-full", ROW_TONE[row.tone])}
            />
            {row.label}
            <span className="tabular font-semibold text-fg">{row.count}</span>
            <span className="tabular text-fg-subtle">{row.share}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
