"use client";

import { Icon, type IconName } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";
import {
  LINK_SOURCE_SHORT,
  TOXIC_HARMFUL,
  TOXIC_REVIEW,
  TOXIC_SIGNAL_META,
} from "@/lib/mock/backlinks";
import {
  AuthorityValue,
  DistributionList,
  DomainText,
  ScoreBreakdownList,
  ScoreReading,
  TargetPageLink,
  ToxicActionBadge,
  ToxicSignalBadge,
} from "@/components/backlinks/link-chrome";
import type { LinkFilters } from "@/components/backlinks/filters";
import type { Backlink, RiskSummary } from "@/types/backlinks";

/**
 * Links worth worrying about.
 *
 * The distinction that matters: most flagged links are noise that needs
 * nothing done, a smaller number need a human to look, and a small number are
 * worth formally disowning. Collapsing those three into one "toxic links"
 * figure is how a report turns a healthy profile into a panic, so the view
 * keeps them apart and says what each one means.
 *
 * The handling shown against each signal is the default for that signal, from
 * the vocabulary — not a decision this component makes.
 */

type Tile = {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly icon: IconName;
  readonly note: string;
  readonly tone: "positive" | "warning" | "critical" | "neutral";
};

const TONE_TEXT = {
  positive: "text-positive",
  warning: "text-warning",
  critical: "text-critical",
  neutral: "text-fg",
} as const;

export function RiskView({
  risk,
  links,
  onFilter,
}: {
  risk: RiskSummary;
  /** Flagged links in the current selection, worst first. */
  links: readonly Backlink[];
  onFilter: (patch: Partial<LinkFilters>) => void;
}) {
  const tiles: readonly Tile[] = [
    {
      id: "disavow",
      label: "Worth disavowing",
      count: risk.disavowCandidates,
      icon: "shield",
      note: `Risk at or above ${TOXIC_HARMFUL}. Formally disown these.`,
      tone: "critical",
    },
    {
      id: "removal",
      label: "Request removal",
      count: risk.removalCandidates,
      icon: "handoff",
      note: "Someone to ask before escalating.",
      tone: "warning",
    },
    {
      id: "review",
      label: "Needs a human",
      count: risk.reviewCandidates,
      icon: "user",
      note: `Risk between ${TOXIC_REVIEW} and ${TOXIC_HARMFUL}.`,
      tone: "warning",
    },
    {
      id: "flagged",
      label: "Flagged in total",
      count: risk.flaggedLinks,
      icon: "alert",
      note: "Most of these need nothing done.",
      tone: "neutral",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-1">
          <PanelHeader
            eyebrow="Risk"
            title="Profile health"
            description={risk.score.summary}
          />
          <PanelBody className="space-y-4">
            <ScoreReading
              score={risk.score.score}
              caption="Profile health"
              label={`Profile health: ${risk.score.score} out of 100`}
              detail={`${formatPercent(risk.toxicShare, 0)} of the profile carries a signal of some kind.`}
            />
            <ScoreBreakdownList score={risk.score} />
          </PanelBody>
          <PanelFooter>
            <span>{LINK_SOURCE_SHORT}</span>
          </PanelFooter>
        </Panel>

        <div className="space-y-4 xl:col-span-2">
          <Panel>
            <PanelHeader
              eyebrow="Handling"
              title="What actually needs doing"
              description="A flagged link is not automatically a problem. These are the three groups that behave differently."
            />
            <PanelBody>
              <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                {tiles.map((tile) => (
                  <li
                    key={tile.id}
                    className="flex h-full flex-col rounded-md border border-border bg-surface-raised px-3 py-2.5"
                  >
                    <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.03em] text-fg-muted uppercase">
                      <Icon name={tile.icon} className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 truncate">{tile.label}</span>
                    </span>
                    <span
                      className={cn(
                        "tabular mt-2 text-[20px] leading-none font-semibold",
                        TONE_TEXT[tile.tone],
                      )}
                    >
                      {tile.count}
                    </span>
                    <span className="mt-1.5 block text-[11px] leading-snug text-fg-subtle">
                      {tile.note}
                    </span>
                  </li>
                ))}
              </ul>
            </PanelBody>
            <PanelFooter>
              <span>{risk.flaggedDomains} domains carry a signal</span>
              <button
                type="button"
                onClick={() => onFilter({ flaggedOnly: true })}
                className="text-[12px] font-medium text-fg-muted transition-colors hover:text-accent"
              >
                Show flagged only
              </button>
            </PanelFooter>
          </Panel>

          <Panel>
            <PanelHeader
              eyebrow="Signals"
              title="What is being flagged"
              description="Counted per link, so one link with three signals appears in three rows."
            />
            <PanelBody>
              <DistributionList
                rows={risk.signals}
                emptyLabel="No risk signal against this selection."
              />
            </PanelBody>
          </Panel>
        </div>
      </div>

      <Panel>
        <PanelHeader
          eyebrow="Worst first"
          title="Flagged links"
          description="Every link carrying a signal, with the handling its worst signal calls for."
        />
        {links.length === 0 ? (
          <EmptyState
            size="sm"
            icon="check"
            title="Nothing flagged"
            description="No link in this selection carries a risk signal."
          />
        ) : (
          <Table caption="Links carrying a risk signal">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Referring domain</TableHeaderCell>
                <TableHeaderCell align="right">DA</TableHeaderCell>
                <TableHeaderCell className="hidden lg:table-cell">
                  Target page
                </TableHeaderCell>
                <TableHeaderCell>Signals</TableHeaderCell>
                <TableHeaderCell className="hidden sm:table-cell">
                  Handling
                </TableHeaderCell>
                <TableHeaderCell align="right">Risk</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {links.map((link) => {
                // The handling is the most serious one any of its signals
                // calls for, from the vocabulary rather than from here.
                const action = link.toxicSignals.reduce<
                  ReturnType<typeof worstAction>
                >((carry, signal) => worstAction(carry, signal), "monitor");

                return (
                  <TableRow key={link.id}>
                    <TableCell header className="max-w-[16rem] min-w-[10rem]">
                      <DomainText domain={link.domain} className="block" />
                    </TableCell>
                    <TableCell numeric>
                      <AuthorityValue authority={link.domainAuthority} />
                    </TableCell>
                    <TableCell className="hidden max-w-[18rem] lg:table-cell">
                      <TargetPageLink
                        contentId={link.contentId}
                        title={link.targetTitle}
                        path={link.targetPath}
                      />
                    </TableCell>
                    <TableCell className="max-w-[20rem]">
                      <span className="flex flex-wrap gap-1">
                        {link.toxicSignals.map((signal) => (
                          <ToxicSignalBadge key={signal} signal={signal} />
                        ))}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <ToxicActionBadge action={action} />
                    </TableCell>
                    <TableCell numeric>
                      <span
                        className={cn(
                          "tabular font-semibold",
                          link.toxicScore >= TOXIC_HARMFUL
                            ? "text-critical"
                            : link.toxicScore >= TOXIC_REVIEW
                              ? "text-warning"
                              : "text-fg-muted",
                        )}
                      >
                        {link.toxicScore}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <PanelFooter>
          <span>
            Nothing here is submitted anywhere. A disavow file is a decision for
            a person, not an action this product takes.
          </span>
        </PanelFooter>
      </Panel>
    </div>
  );
}

const ACTION_RANK = {
  monitor: 0,
  review: 1,
  "request-removal": 2,
  disavow: 3,
} as const;

function worstAction(
  carry: keyof typeof ACTION_RANK,
  signal: keyof typeof TOXIC_SIGNAL_META,
): keyof typeof ACTION_RANK {
  const next = TOXIC_SIGNAL_META[signal].action;
  return ACTION_RANK[next] > ACTION_RANK[carry] ? next : carry;
}
