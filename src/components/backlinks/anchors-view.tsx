"use client";

import { Icon } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { LINK_SOURCE_SHORT } from "@/lib/mock/backlinks";
import {
  AnchorBadge,
  ScoreBreakdownList,
  ScoreReading,
} from "@/components/backlinks/link-chrome";
import type { LinkFilters } from "@/components/backlinks/filters";
import type { AnchorProfile } from "@/types/backlinks";

/**
 * The anchor profile.
 *
 * Read over followed links only. A nofollowed exact-match anchor is not the
 * signal this view is looking for, and counting it would report manipulation
 * where there is none.
 *
 * The judgement is about distribution, not about individual anchors: a handful
 * of exact-match anchors is normal and useful, and the same anchors at a third
 * of the profile are the clearest sign a link profile was bought rather than
 * earned. Each row is therefore shown against its ceiling rather than on its
 * own.
 */
export function AnchorsView({
  anchors,
  onFilter,
}: {
  anchors: AnchorProfile;
  onFilter: (patch: Partial<LinkFilters>) => void;
}) {
  if (anchors.rows.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon="target"
          title="No followed links in this selection"
          description="The anchor profile is read over followed links only. Clear a filter to bring some back."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-1">
          <PanelHeader
            eyebrow="Anchors"
            title="Anchor health"
            description={anchors.score.summary}
          />
          <PanelBody className="space-y-4">
            <ScoreReading
              score={anchors.score.score}
              caption="Anchor health"
              label={`Anchor health: ${anchors.score.score} out of 100`}
              detail={anchors.summary}
            />
            <ScoreBreakdownList score={anchors.score} />
          </PanelBody>
          <PanelFooter>
            <span>{anchors.followedLinks} followed links</span>
            <span>{LINK_SOURCE_SHORT}</span>
          </PanelFooter>
        </Panel>

        <Panel className="xl:col-span-2">
          <PanelHeader
            eyebrow="Distribution"
            title="Each anchor kind against its ceiling"
            description="A natural profile is mostly branded and page-title anchors. Going past a ceiling is what the check reports — not the anchors themselves."
            actions={
              anchors.overWeighted.length > 0 && (
                <span className="inline-flex items-center gap-1.5 text-[11.5px] text-critical">
                  <Icon name="alert" className="h-3.5 w-3.5" />
                  {anchors.overWeighted.length} over-weighted
                </span>
              )
            }
          />
          <PanelBody>
            <ul className="space-y-3.5">
              {anchors.rows.map((row) => (
                <li key={row.kind} className="min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          onFilter({
                            anchorKind: row.kind,
                            rel: "follow",
                          })
                        }
                        title={`Show the ${row.links} followed links with ${row.label.toLowerCase()} anchors`}
                        className="rounded-md transition-opacity hover:opacity-80"
                      >
                        <AnchorBadge kind={row.kind} />
                      </button>
                      <span className="tabular text-[11.5px] text-fg-subtle">
                        {row.links} links
                      </span>
                    </span>

                    <span className="tabular shrink-0 text-[12px]">
                      <span
                        className={cn(
                          "font-semibold",
                          row.overWeighted ? "text-critical" : "text-fg",
                        )}
                      >
                        {row.share}%
                      </span>
                      <span className="ml-1.5 text-fg-subtle">
                        against a {row.ceiling}% ceiling
                      </span>
                    </span>
                  </div>

                  <Meter
                    className="mt-2"
                    value={Math.min((row.share / row.ceiling) * 100, 100)}
                    tone={row.overWeighted ? "critical" : "accent"}
                    label={`${row.label}: ${row.share}% of followed links, against a ${row.ceiling}% ceiling`}
                  />

                  <p className="mt-1.5 text-[11.5px] leading-snug text-fg-subtle">
                    {row.description}
                  </p>

                  {row.examples.length > 0 && (
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {row.examples.map((example) => (
                        <li
                          key={example}
                          className="max-w-full truncate rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[11px] text-fg-subtle italic"
                          title={example}
                        >
                          &ldquo;{example}&rdquo;
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </PanelBody>
          <PanelFooter>
            <span>
              Selecting a kind narrows the workspace to the followed links that
              carry it.
            </span>
          </PanelFooter>
        </Panel>
      </div>
    </div>
  );
}
