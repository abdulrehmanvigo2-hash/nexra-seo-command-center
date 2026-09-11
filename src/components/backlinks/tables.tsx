"use client";

import { Icon } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatCompact, formatShortDate } from "@/lib/format";
import {
  AnchorBadge,
  AnchorText,
  AuthorityValue,
  CategoryBadge,
  DomainIdentity,
  DomainText,
  LinkKindBadge,
  LinkStatusBadge,
  QualityBadge,
  ReferralValue,
  RelBadge,
  RelationshipBadge,
  RelevanceBadge,
  ScoreValue,
  TargetPageLink,
  ToxicSignalBadge,
} from "@/components/backlinks/link-chrome";
import type {
  Backlink,
  LinkGap,
  LinkedPage,
  ReferringDomain,
} from "@/types/backlinks";

/**
 * The four authority tables.
 *
 * Kept together because they share the same row grammar: an identity column,
 * a set of 0-100 readings, and a band. Less load-bearing columns are hidden
 * below `lg` rather than wrapped, and each table scrolls inside its own
 * container so the page itself never does.
 */

// ---------------------------------------------------------------------------
// Backlinks
// ---------------------------------------------------------------------------

export function BacklinksTable({ links }: { links: readonly Backlink[] }) {
  if (links.length === 0) {
    return (
      <EmptyState
        icon="search"
        title="No links match these filters"
        description="Every filter here is derived from the links that exist, so a combination can still select nothing. Clear one to widen the set."
      />
    );
  }

  return (
    <Table caption="Backlinks, with the page each one points at">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Referring domain</TableHeaderCell>
          <TableHeaderCell align="right">DA</TableHeaderCell>
          <TableHeaderCell className="hidden lg:table-cell">
            Target page
          </TableHeaderCell>
          <TableHeaderCell className="hidden xl:table-cell">
            Anchor
          </TableHeaderCell>
          <TableHeaderCell className="hidden sm:table-cell">Rel</TableHeaderCell>
          <TableHeaderCell className="hidden xl:table-cell">Type</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell align="right" className="hidden lg:table-cell">
            Referral
          </TableHeaderCell>
          <TableHeaderCell className="hidden sm:table-cell">
            Quality
          </TableHeaderCell>
          <TableHeaderCell align="right">Score</TableHeaderCell>
        </TableRow>
      </TableHead>

      <TableBody>
        {links.map((link) => (
          <TableRow key={link.id}>
            <TableCell header className="max-w-[16rem] min-w-[10rem]">
              <span className="block min-w-0">
                <DomainText domain={link.domain} className="block" />
                <span className="mt-0.5 block truncate font-mono text-[10.5px] text-fg-subtle/70">
                  {link.sourcePath}
                </span>
              </span>
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

            <TableCell className="hidden xl:table-cell">
              <span className="block min-w-0">
                <AnchorText text={link.anchorText} />
                <span className="mt-1 block">
                  <AnchorBadge kind={link.anchorKind} />
                </span>
              </span>
            </TableCell>

            <TableCell className="hidden sm:table-cell">
              <RelBadge rel={link.rel} />
            </TableCell>

            <TableCell className="hidden xl:table-cell">
              <LinkKindBadge kind={link.kind} />
            </TableCell>

            <TableCell>
              <span className="flex flex-wrap items-center gap-1.5">
                <LinkStatusBadge status={link.status} />
                {link.toxicSignals.length > 0 && (
                  <span
                    title={`${link.toxicSignals.length} risk signals`}
                    className="inline-flex items-center gap-0.5 text-[11px] text-critical"
                  >
                    <Icon name="shield" className="h-3.5 w-3.5" />
                    {link.toxicSignals.length}
                  </span>
                )}
              </span>
            </TableCell>

            <TableCell numeric className="hidden lg:table-cell">
              <ReferralValue sessions={link.referralTraffic} />
            </TableCell>

            <TableCell className="hidden sm:table-cell">
              <QualityBadge band={link.band} />
            </TableCell>

            <TableCell numeric>
              <ScoreValue score={link.quality.score} label="Link quality" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Referring domains
// ---------------------------------------------------------------------------

export function DomainsTable({
  domains,
}: {
  domains: readonly ReferringDomain[];
}) {
  if (domains.length === 0) {
    return (
      <EmptyState
        icon="globe"
        title="No referring domains match these filters"
        description="Clear a filter to widen the set."
      />
    );
  }

  return (
    <Table caption="Referring domains and what they contribute">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Domain</TableHeaderCell>
          <TableHeaderCell className="hidden sm:table-cell">
            Category
          </TableHeaderCell>
          <TableHeaderCell align="right">DA</TableHeaderCell>
          <TableHeaderCell className="hidden lg:table-cell">
            Relevance
          </TableHeaderCell>
          <TableHeaderCell align="right">Links</TableHeaderCell>
          <TableHeaderCell align="right" className="hidden sm:table-cell">
            Followed
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden xl:table-cell">
            Site traffic
          </TableHeaderCell>
          <TableHeaderCell className="hidden xl:table-cell">
            Relationship
          </TableHeaderCell>
          <TableHeaderCell className="hidden lg:table-cell">
            Risk
          </TableHeaderCell>
          <TableHeaderCell align="right">Quality</TableHeaderCell>
        </TableRow>
      </TableHead>

      <TableBody>
        {domains.map((domain) => (
          <TableRow key={domain.id}>
            <TableCell header className="max-w-[18rem] min-w-[11rem]">
              <DomainIdentity name={domain.name} domain={domain.domain} />
            </TableCell>

            <TableCell className="hidden sm:table-cell">
              <CategoryBadge category={domain.category} />
            </TableCell>

            <TableCell numeric>
              <AuthorityValue authority={domain.authority} />
            </TableCell>

            <TableCell className="hidden lg:table-cell">
              <RelevanceBadge band={domain.relevanceBand} />
            </TableCell>

            <TableCell numeric>{domain.linkCount}</TableCell>

            <TableCell numeric className="hidden sm:table-cell">
              <span
                className={cn(
                  "tabular",
                  domain.followedLinks === 0 ? "text-fg-subtle" : "text-fg-muted",
                )}
              >
                {domain.followedLinks}
              </span>
            </TableCell>

            <TableCell numeric className="hidden xl:table-cell">
              {formatCompact(domain.traffic)}
            </TableCell>

            <TableCell className="hidden xl:table-cell">
              <RelationshipBadge relationship={domain.relationship} />
            </TableCell>

            <TableCell className="hidden max-w-[14rem] lg:table-cell">
              {domain.toxicSignals.length === 0 ? (
                <span className="text-[11.5px] text-fg-subtle">Clean</span>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {domain.toxicSignals.slice(0, 2).map((signal) => (
                    <ToxicSignalBadge key={signal} signal={signal} />
                  ))}
                </span>
              )}
            </TableCell>

            <TableCell numeric>
              <ScoreValue
                score={domain.quality.score}
                label="Domain quality"
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Our pages
// ---------------------------------------------------------------------------

export function LinkedPagesTable({ pages }: { pages: readonly LinkedPage[] }) {
  if (pages.length === 0) {
    return (
      <EmptyState
        icon="pages"
        title="No pages match these filters"
        description="Clear a filter to widen the set."
      />
    );
  }

  return (
    <Table caption="Our pages, read for the links they have earned">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Page</TableHeaderCell>
          <TableHeaderCell className="hidden lg:table-cell">
            Cluster
          </TableHeaderCell>
          <TableHeaderCell align="right">Domains</TableHeaderCell>
          <TableHeaderCell align="right" className="hidden sm:table-cell">
            Links
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden sm:table-cell">
            Followed
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden xl:table-cell">
            Lost
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden xl:table-cell">
            Mean DA
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden lg:table-cell">
            Internal in
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden lg:table-cell">
            Referral
          </TableHeaderCell>
          <TableHeaderCell align="right">Authority</TableHeaderCell>
        </TableRow>
      </TableHead>

      <TableBody>
        {pages.map((page) => (
          <TableRow key={page.contentId}>
            <TableCell header className="max-w-[20rem] min-w-[11rem]">
              <span className="block min-w-0">
                <TargetPageLink
                  contentId={page.contentId}
                  title={page.title}
                  path={page.path}
                />
                {page.underLinkedInternally && (
                  <span
                    className="mt-1 inline-flex items-center gap-1 text-[11px] text-warning"
                    title="This page earns links and passes almost none of it on internally."
                  >
                    <Icon name="link-off" className="h-3 w-3" />
                    Hoarding authority
                  </span>
                )}
              </span>
            </TableCell>

            <TableCell className="hidden max-w-[12rem] lg:table-cell">
              <span className="block truncate" title={page.clusterName}>
                {page.clusterName}
              </span>
            </TableCell>

            <TableCell numeric>
              <span
                className={cn(
                  "tabular font-semibold",
                  page.referringDomains === 0 ? "text-warning" : "text-fg",
                )}
              >
                {page.referringDomains}
              </span>
            </TableCell>

            <TableCell numeric className="hidden sm:table-cell">
              {page.links}
            </TableCell>

            <TableCell numeric className="hidden sm:table-cell">
              {page.followedLinks}
            </TableCell>

            <TableCell
              numeric
              className={cn(
                "hidden xl:table-cell",
                page.lostLinks > 0 ? "text-critical" : undefined,
              )}
            >
              {page.lostLinks}
            </TableCell>

            <TableCell numeric className="hidden xl:table-cell">
              {page.averageAuthority > 0 ? page.averageAuthority : "—"}
            </TableCell>

            <TableCell numeric className="hidden lg:table-cell">
              {page.internalLinksIn}
            </TableCell>

            <TableCell numeric className="hidden lg:table-cell">
              <ReferralValue sessions={page.referralTraffic} />
            </TableCell>

            <TableCell numeric>
              <ScoreValue
                score={page.pageAuthority.score}
                label="Page authority"
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Competitor gaps
// ---------------------------------------------------------------------------

export function GapsTable({ gaps }: { gaps: readonly LinkGap[] }) {
  if (gaps.length === 0) {
    return (
      <EmptyState
        icon="competitors"
        title="No link gaps for this selection"
        description="Either no tracked rival has a link we do not, or the filters have narrowed past the last one."
      />
    );
  }

  return (
    <Table caption="Domains linking to a rival and not to us">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Domain</TableHeaderCell>
          <TableHeaderCell className="hidden sm:table-cell">
            Category
          </TableHeaderCell>
          <TableHeaderCell align="right">DA</TableHeaderCell>
          <TableHeaderCell align="right" className="hidden lg:table-cell">
            Relevance
          </TableHeaderCell>
          <TableHeaderCell align="right">Rivals</TableHeaderCell>
          <TableHeaderCell className="hidden xl:table-cell">
            Who has it
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden sm:table-cell">
            Winnability
          </TableHeaderCell>
          <TableHeaderCell align="right">Value</TableHeaderCell>
        </TableRow>
      </TableHead>

      <TableBody>
        {gaps.map((gap) => (
          <TableRow key={gap.id}>
            <TableCell header className="max-w-[16rem] min-w-[10rem]">
              <span className="block min-w-0">
                <DomainText domain={gap.domain} className="block" />
                <span
                  className="mt-0.5 block truncate text-[11px] text-fg-subtle"
                  title={gap.reason}
                >
                  {gap.reason}
                </span>
              </span>
            </TableCell>

            <TableCell className="hidden sm:table-cell">
              <CategoryBadge category={gap.category} />
            </TableCell>

            <TableCell numeric>
              <AuthorityValue authority={gap.authority} />
            </TableCell>

            <TableCell numeric className="hidden lg:table-cell">
              {gap.relevance}
            </TableCell>

            <TableCell numeric>
              <span className="tabular font-semibold text-fg">
                {gap.rivalsLinked}
              </span>
            </TableCell>

            <TableCell className="hidden max-w-[16rem] xl:table-cell">
              <span
                className="block truncate text-[11.5px] text-fg-muted"
                title={gap.competitorNames.join(", ")}
              >
                {gap.competitorNames.join(", ")}
              </span>
            </TableCell>

            <TableCell numeric className="hidden sm:table-cell">
              <ScoreValue score={gap.winnability} label="Winnability" />
            </TableCell>

            <TableCell numeric>
              <ScoreValue score={gap.value} label="Opportunity value" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export { formatShortDate };
