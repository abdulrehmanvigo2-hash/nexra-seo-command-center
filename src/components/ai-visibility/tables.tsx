"use client";

import Link from "next/link";
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
import { DIMENSION_META } from "@/lib/mock/ai-visibility";
import {
  AiPageLink,
  CitationBadge,
  ConfidenceTag,
  EntityBandBadge,
  EntityTypeBadge,
  EvidenceBadge,
  GainBadge,
  ReadinessBadge,
  ScoreValue,
  TopicStateBadge,
} from "@/components/ai-visibility/ai-chrome";
import type {
  AiEntityRecord,
  AiPageRecord,
  AiTopicRecord,
} from "@/types/ai-visibility";

/**
 * The three AI-visibility tables.
 *
 * Kept together because they share the same row grammar: an identity column,
 * a set of 0-100 dimension readings, and a band. Less load-bearing columns are
 * hidden below `lg` rather than wrapped, and each table scrolls inside its own
 * container so the page itself never does.
 */

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

export function TopicsTable({ topics }: { topics: readonly AiTopicRecord[] }) {
  if (topics.length === 0) {
    return (
      <EmptyState
        icon="target"
        title="No topics match these filters"
        description="Every filter here is derived from records that exist, so a combination can still select nothing. Clear one to widen the set."
      />
    );
  }

  return (
    <Table caption="Topic coverage for answer engines">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Topic</TableHeaderCell>
          <TableHeaderCell className="hidden lg:table-cell">
            Intent
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden sm:table-cell">
            Keywords
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden sm:table-cell">
            Pages
          </TableHeaderCell>
          <TableHeaderCell>Coverage</TableHeaderCell>
          <TableHeaderCell align="right" className="hidden xl:table-cell">
            Answer
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden xl:table-cell">
            Evidence
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden xl:table-cell">
            Entities
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden xl:table-cell">
            Citation
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden lg:table-cell">
            Technical
          </TableHeaderCell>
          <TableHeaderCell align="right">Visibility</TableHeaderCell>
        </TableRow>
      </TableHead>

      <TableBody>
        {topics.map((topic) => (
          <TableRow key={topic.id}>
            <TableCell header className="max-w-[20rem] min-w-[11rem]">
              <span className="block min-w-0">
                <Link
                  href={`/keywords/clusters/${topic.clusterId}`}
                  className="block truncate font-medium text-fg transition-colors hover:text-accent"
                  title={`${topic.name} — open the cluster`}
                >
                  {topic.name}
                </Link>
                <span className="block truncate text-[11px] text-fg-subtle">
                  {topic.projectName} · {topic.biggestGap}
                </span>
              </span>
            </TableCell>
            <TableCell className="hidden capitalize lg:table-cell">
              {topic.primaryIntent}
            </TableCell>
            <TableCell numeric className="hidden sm:table-cell">
              {topic.keywordCount}
            </TableCell>
            <TableCell numeric className="hidden sm:table-cell">
              {topic.pageCount}
            </TableCell>
            <TableCell>
              <TopicStateBadge state={topic.coverageState} />
            </TableCell>
            <TableCell numeric className="hidden xl:table-cell">
              {topic.answerReadiness}
            </TableCell>
            <TableCell numeric className="hidden xl:table-cell">
              {topic.evidenceStrength}
            </TableCell>
            <TableCell numeric className="hidden xl:table-cell">
              {topic.entityCoverage}
            </TableCell>
            <TableCell numeric className="hidden xl:table-cell">
              {topic.citationReadiness}
            </TableCell>
            <TableCell numeric className="hidden lg:table-cell">
              {topic.technicalHealth}
            </TableCell>
            <TableCell numeric>
              <ScoreValue
                score={topic.visibility.score}
                label="AI visibility"
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export function EntitiesTable({
  entities,
}: {
  entities: readonly AiEntityRecord[];
}) {
  if (entities.length === 0) {
    return (
      <EmptyState
        icon="layers"
        title="No entities match these filters"
        description="Clear a filter to widen the set."
      />
    );
  }

  return (
    <Table caption="Internal entity coverage">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Entity</TableHeaderCell>
          <TableHeaderCell className="hidden sm:table-cell">Type</TableHeaderCell>
          <TableHeaderCell align="right">Pages</TableHeaderCell>
          <TableHeaderCell className="hidden lg:table-cell">
            Primary page
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden xl:table-cell">
            Coverage
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden xl:table-cell">
            Definition
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden xl:table-cell">
            Evidence
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden xl:table-cell">
            Links
          </TableHeaderCell>
          <TableHeaderCell className="hidden sm:table-cell">Band</TableHeaderCell>
          <TableHeaderCell align="right">Strength</TableHeaderCell>
        </TableRow>
      </TableHead>

      <TableBody>
        {entities.map((entity) => (
          <TableRow key={entity.id}>
            <TableCell header className="max-w-[18rem] min-w-[10rem]">
              <span className="block min-w-0">
                <span className="block truncate font-medium text-fg" title={entity.name}>
                  {entity.name}
                </span>
                <span className="block truncate text-[11px] text-fg-subtle">
                  {entity.gaps.length === 0
                    ? "Nothing outstanding"
                    : entity.gaps[0]}
                </span>
              </span>
            </TableCell>
            <TableCell className="hidden sm:table-cell">
              <EntityTypeBadge type={entity.type} />
            </TableCell>
            <TableCell numeric>{entity.pageCount}</TableCell>
            <TableCell className="hidden max-w-[16rem] lg:table-cell">
              {entity.primaryPageId === null ? (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-warning">
                  <Icon name="link-off" className="h-3.5 w-3.5 shrink-0" />
                  None
                </span>
              ) : (
                <span
                  className="block truncate"
                  title={entity.primaryPageTitle ?? ""}
                >
                  {entity.primaryPageTitle}
                </span>
              )}
            </TableCell>
            <TableCell numeric className="hidden xl:table-cell">
              {entity.semanticCoverage}
            </TableCell>
            <TableCell numeric className="hidden xl:table-cell">
              {entity.definitionClarity}
            </TableCell>
            <TableCell numeric className="hidden xl:table-cell">
              {entity.evidenceSupport}
            </TableCell>
            <TableCell numeric className="hidden xl:table-cell">
              {entity.linkSupport}
            </TableCell>
            <TableCell className="hidden sm:table-cell">
              <EntityBandBadge band={entity.band} />
            </TableCell>
            <TableCell numeric>
              <ScoreValue
                score={entity.strength.score}
                label="Entity strength"
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/**
 * The page table, in three column sets.
 *
 * The same rows serve the Answer Readiness, Citations and Evidence tabs, with
 * the middle columns swapped for whichever dimension the tab is about. One
 * table rather than three keeps the row grammar identical across them.
 */
export function AiPagesTable({
  pages,
  variant,
}: {
  pages: readonly AiPageRecord[];
  variant: "readiness" | "citations" | "evidence";
}) {
  if (pages.length === 0) {
    return (
      <EmptyState
        icon="search"
        title="No pages match these filters"
        description="Every filter here is derived from the pages that exist, so a combination can still select nothing. Clear one to widen the set."
      />
    );
  }

  return (
    <Table caption={`Published pages read for ${DIMENSION_META["answer-readiness"].label.toLowerCase()}`}>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Page</TableHeaderCell>
          <TableHeaderCell className="hidden lg:table-cell">
            Topic
          </TableHeaderCell>

          {variant === "readiness" && (
            <>
              <TableHeaderCell align="right" className="hidden sm:table-cell">
                Questions
              </TableHeaderCell>
              <TableHeaderCell align="right">Answer</TableHeaderCell>
              <TableHeaderCell className="hidden xl:table-cell">
                Reason
              </TableHeaderCell>
            </>
          )}

          {variant === "citations" && (
            <>
              <TableHeaderCell>State</TableHeaderCell>
              <TableHeaderCell align="right" className="hidden sm:table-cell">
                Quotable
              </TableHeaderCell>
              <TableHeaderCell align="right">Citation</TableHeaderCell>
              <TableHeaderCell className="hidden xl:table-cell">
                Why
              </TableHeaderCell>
            </>
          )}

          {variant === "evidence" && (
            <>
              <TableHeaderCell>Band</TableHeaderCell>
              <TableHeaderCell align="right" className="hidden sm:table-cell">
                Supported
              </TableHeaderCell>
              <TableHeaderCell align="right" className="hidden sm:table-cell">
                Unsupported
              </TableHeaderCell>
              <TableHeaderCell align="right" className="hidden lg:table-cell">
                Kinds
              </TableHeaderCell>
              <TableHeaderCell className="hidden xl:table-cell">
                Information gain
              </TableHeaderCell>
              <TableHeaderCell align="right">Evidence</TableHeaderCell>
            </>
          )}

          <TableHeaderCell className="hidden sm:table-cell">
            Readiness
          </TableHeaderCell>
          <TableHeaderCell align="right">Visibility</TableHeaderCell>
        </TableRow>
      </TableHead>

      <TableBody>
        {pages.map((page) => (
          <TableRow key={page.id}>
            <TableCell header className="max-w-[20rem] min-w-[11rem]">
              <AiPageLink
                contentId={page.contentId}
                title={page.title}
                path={page.path}
              />
            </TableCell>
            <TableCell className="hidden max-w-[12rem] lg:table-cell">
              <span className="block truncate" title={page.clusterName}>
                {page.clusterName}
              </span>
            </TableCell>

            {variant === "readiness" && (
              <>
                <TableCell numeric className="hidden sm:table-cell">
                  {page.questionKeywords}
                </TableCell>
                <TableCell numeric>
                  <ScoreValue
                    score={page.answer.score.score}
                    label="Answer readiness"
                  />
                </TableCell>
                <TableCell className="hidden max-w-[22rem] xl:table-cell">
                  <span
                    className={cn(
                      "block truncate",
                      page.answer.reasons.length === 0
                        ? "text-fg-subtle"
                        : undefined,
                    )}
                    title={page.answer.reasons[0] ?? "Nothing holding it back."}
                  >
                    {page.answer.reasons[0] ?? "Nothing holding it back."}
                  </span>
                </TableCell>
              </>
            )}

            {variant === "citations" && (
              <>
                <TableCell>
                  <CitationBadge state={page.citation.state} />
                </TableCell>
                <TableCell numeric className="hidden sm:table-cell">
                  {page.citation.quotableFacts}
                </TableCell>
                <TableCell numeric>
                  <ScoreValue
                    score={page.citation.score.score}
                    label="Citation readiness"
                  />
                </TableCell>
                <TableCell className="hidden max-w-[22rem] xl:table-cell">
                  <span className="block truncate" title={page.citation.reason}>
                    {page.citation.reason}
                  </span>
                </TableCell>
              </>
            )}

            {variant === "evidence" && (
              <>
                <TableCell>
                  <EvidenceBadge band={page.evidence.band} />
                </TableCell>
                <TableCell numeric className="hidden sm:table-cell">
                  {page.evidence.supportedClaims}
                </TableCell>
                <TableCell
                  numeric
                  className={cn(
                    "hidden sm:table-cell",
                    page.evidence.unsupportedClaims > 0
                      ? "text-critical"
                      : undefined,
                  )}
                >
                  {page.evidence.unsupportedClaims}
                </TableCell>
                <TableCell numeric className="hidden lg:table-cell">
                  {page.evidence.diversity}
                </TableCell>
                <TableCell className="hidden xl:table-cell">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <GainBadge band={page.gain.band} />
                    <ConfidenceTag confidence={page.gain.confidence} />
                  </span>
                </TableCell>
                <TableCell numeric>
                  <ScoreValue
                    score={page.evidence.score.score}
                    label="Evidence strength"
                  />
                </TableCell>
              </>
            )}

            <TableCell className="hidden sm:table-cell">
              <ReadinessBadge band={page.visibility.band} />
            </TableCell>
            <TableCell numeric>
              <ScoreValue
                score={page.visibility.score}
                label="AI visibility"
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
