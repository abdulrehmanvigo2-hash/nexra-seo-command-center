"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { MetricTileGrid, type MetricTileData } from "@/components/ui/metric-tile";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import {
  formatCompact,
  formatCurrency,
  formatNumber,
  formatRelative,
} from "@/lib/format";
import { DATE_RANGES } from "@/lib/mock/dashboard";
import {
  AI_COVERAGE_META,
  KEYWORDS_AI_SOURCE_NOTE,
  CANNIBALIZATION_RISK_META,
  CONTENT_GAP_META,
  DIFFICULTY_BAND_META,
  OPPORTUNITY_BAND_META,
  OPPORTUNITY_CATEGORY_META,
  RANKING_STATUS_META,
  SERP_FEATURE_META,
  SERP_OWNERSHIP_META,
  SERP_TYPE_META,
  aiOpportunityOf,
  entityGapOf,
  getKeywordDetail,
  targetPositionFor,
} from "@/lib/mock/keywords";
import { contentForKeyword } from "@/lib/mock/content";
import { BATTLE_META, overlapForKeyword } from "@/lib/mock/competitors";
import { AiReadinessNote } from "@/components/keywords/ai-readiness-note";
import { TechnicalWarning } from "@/components/keywords/technical-warning";
import { RankChart } from "@/components/keywords/rank-chart";
import {
  ChangeValue,
  IntentBadge,
  KeywordLink,
  KeywordStatusBadge,
  OpportunityValue,
  OwnerLink,
  PositionValue,
  ProjectLink,
  RankingBadge,
  ScoreBreakdown,
  TargetUrl,
} from "@/components/keywords/keyword-chrome";
import type { RangeId } from "@/types/dashboard";

/**
 * One keyword's workspace.
 *
 * Everything the product knows about a single term, in the order somebody
 * would ask it: where it sits, how it got there, what it is worth, what the
 * result page looks like, what an answer engine does with it, and what to do
 * next. The recommended action is at the top rather than the bottom, because
 * it is the reason the page was opened.
 *
 * The panels read the same records the table reads — a position here is the
 * position there, and the cluster, project, and owner all link back to the
 * modules that own them.
 */
export function KeywordWorkspace({ keywordId }: { keywordId: string }) {
  const [range, setRange] = useState<RangeId>("3m");

  const detail = useMemo(
    () => getKeywordDetail(keywordId, range),
    [keywordId, range],
  );

  if (!detail) return null;

  const { keyword, cluster, history, cannibalization, gap, related } = detail;
  // The piece serving this query, from the Content Studio's canonical
  // inventory. Null only where the keyword is not mapped to anything.
  const contentPiece = contentForKeyword(keyword.id);
  // Every rival ranking for this term, read from Competitor Intelligence so
  // the positions here and there are the same reading rather than two.
  const rivals = overlapForKeyword(keyword.id);
  const target = targetPositionFor(keyword.position);
  const uplift = Math.max(0, keyword.trafficPotential - keyword.currentTraffic);
  const band = OPPORTUNITY_BAND_META[keyword.opportunity.band];
  const difficultyMeta = DIFFICULTY_BAND_META[keyword.difficultyBand];

  const metrics: readonly MetricTileData[] = [
    {
      id: "position",
      label: "Current position",
      value: keyword.position === null ? "—" : String(keyword.position),
      unit: keyword.previousPosition === null ? undefined : `was ${keyword.previousPosition}`,
      detail: RANKING_STATUS_META[keyword.rankingStatus].label,
      icon: "target",
      health:
        keyword.position === null
          ? "negative"
          : keyword.position <= 3
            ? "positive"
            : keyword.position <= 20
              ? "neutral"
              : "warning",
    },
    {
      id: "volume",
      label: "Search volume",
      value: formatCompact(keyword.volume),
      unit: "/ mo",
      detail: `${formatNumber(keyword.volume)} searches a month`,
      icon: "search",
    },
    {
      id: "difficulty",
      label: "Difficulty",
      value: String(keyword.difficulty),
      unit: "/ 100",
      detail: `${difficultyMeta.label} (${difficultyMeta.range})`,
      icon: "gauge",
      health:
        keyword.difficultyBand === "easy"
          ? "positive"
          : keyword.difficultyBand === "moderate"
            ? "neutral"
            : keyword.difficultyBand === "hard"
              ? "warning"
              : "negative",
    },
    {
      id: "traffic",
      label: "Estimated traffic",
      value: formatCompact(keyword.currentTraffic),
      unit: "sessions / mo",
      detail: "At the current position and modelled click-through rate",
      icon: "analytics",
    },
    {
      id: "potential",
      label: "Traffic potential",
      value: formatCompact(keyword.trafficPotential),
      unit: "sessions / mo",
      detail: `+${formatCompact(uplift)} at position ${target}`,
      icon: "trend-up",
      health: "positive",
    },
    {
      id: "cpc",
      label: "Commercial value",
      value: `$${keyword.cpc.toFixed(2)}`,
      unit: "per click",
      detail: `Value index ${keyword.commercialValue} of 100`,
      icon: "value",
    },
    {
      id: "opportunity",
      label: "Opportunity score",
      value: String(keyword.opportunity.score),
      unit: `/ 100 · ${band.label}`,
      detail: keyword.opportunity.summary,
      icon: "flag",
      health: band.health,
    },
    {
      id: "content",
      label: "Content strength",
      value: keyword.targetUrl === null ? "—" : String(keyword.contentStrength),
      unit: keyword.targetUrl === null ? undefined : "/ 100",
      detail:
        keyword.targetUrl === null
          ? "No page targets this keyword"
          : "How strong our page is on this topic",
      icon: "pages",
      health:
        keyword.targetUrl === null
          ? "negative"
          : keyword.contentStrength >= 70
            ? "positive"
            : keyword.contentStrength >= 45
              ? "neutral"
              : "warning",
    },
  ];

  const opportunityValue = uplift * keyword.cpc;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <nav aria-label="Breadcrumb">
          <Link
            href="/keywords"
            className="inline-flex items-center gap-1.5 text-[12px] text-fg-subtle transition-colors hover:text-fg-muted"
          >
            <Icon name="arrow-left" className="h-3.5 w-3.5" />
            All keywords
          </Link>
        </nav>

        <SectionHeader
          size="page"
          title={keyword.keyword}
          description={`${keyword.projectName} · ${keyword.clusterName} · last measured ${formatRelative(keyword.updatedAt, detail.generatedAt)}`}
          actions={
            <>
              <IntentBadge intent={keyword.intent} />
              <RankingBadge status={keyword.rankingStatus} />
              <KeywordStatusBadge status={keyword.status} />
            </>
          }
        />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-fg-subtle">
          <ProjectLink
            projectId={keyword.projectId}
            projectName={keyword.projectName}
          />
          {cluster && (
            <Link
              href={`/keywords/clusters/${cluster.id}`}
              className="inline-flex items-center gap-1.5 transition-colors hover:text-accent"
            >
              <Icon name="layers" className="h-3.5 w-3.5" />
              {cluster.name}
            </Link>
          )}
          <OwnerLink agent={keyword.owner} />
          <Link
            href={`/keywords?project=${keyword.projectId}`}
            className="inline-flex items-center gap-1.5 transition-colors hover:text-accent"
          >
            <Icon name="filter" className="h-3.5 w-3.5" />
            All {keyword.projectName} keywords
          </Link>
        </div>
      </div>

      {/* The reason the page was opened comes first. */}
      <Panel className="border-accent/30">
        <div className="flex flex-wrap items-start gap-x-5 gap-y-3 px-4 py-4 sm:px-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-accent/35 bg-accent-soft text-accent">
            <Icon name="bolt" className="h-4.5 w-4.5" />
          </span>

          <div className="min-w-0 grow basis-48">
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-[10.5px] font-semibold tracking-[0.09em] text-fg-subtle uppercase">
                Recommended action
              </span>
              <PriorityBadge priority={detail.recommendedAction.urgency} />
            </p>
            <h3 className="mt-1 text-[15px] leading-tight font-semibold text-fg">
              {detail.recommendedAction.title}
            </h3>
            <p className="mt-1.5 max-w-3xl text-[12.5px] leading-relaxed text-fg-muted">
              {detail.recommendedAction.detail}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <OwnerLink agent={detail.recommendedAction.owner} />
            <Link
              href={`/agents/${detail.recommendedAction.owner}`}
              className={buttonClasses("secondary", "sm")}
            >
              Open the owning agent
              <Icon name="arrow-right" className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </Panel>

      {contentPiece && <TechnicalWarning contentId={contentPiece.id} />}

      {contentPiece && (
        <AiReadinessNote
          contentId={contentPiece.id}
          answerProjected={keyword.ai.answerProjected}
          answerability={keyword.ai.answerability}
        />
      )}

      <MetricTileGrid metrics={metrics} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader
            eyebrow="Ranking trend"
            title="Position over time"
            description="Rank is inverted — a rising line is an improving position. Gaps are windows where the keyword did not rank."
            actions={
              <Segmented
                label="Ranking history window"
                value={range}
                onChange={setRange}
                options={DATE_RANGES.map((entry) => ({
                  value: entry.id,
                  label: entry.label,
                  title: entry.caption,
                }))}
              />
            }
          />

          <PanelBody>
            <RankChart history={history} />

            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-5">
              <Reading
                label="Best"
                value={history.best === null ? "—" : String(history.best)}
                tone="positive"
              />
              <Reading
                label="Worst"
                value={history.worst === null ? "—" : String(history.worst)}
                tone="critical"
              />
              <Reading
                label="Net change"
                value={
                  history.net === 0
                    ? "0"
                    : `${history.net > 0 ? "+" : "−"}${Math.abs(history.net)}`
                }
                tone={
                  history.net > 0
                    ? "positive"
                    : history.net < 0
                      ? "critical"
                      : "neutral"
                }
              />
              <Reading
                label="Volatility"
                value={history.volatility.toFixed(1)}
                caption="mean places moved per sample"
              />
              <Reading
                label="Now"
                value={
                  history.endPosition === null
                    ? "Not ranking"
                    : String(history.endPosition)
                }
              />
            </dl>
          </PanelBody>

          <PanelFooter>
            <span>
              Deterministic mock history reconstructed from the current and
              previous positions — not a rank-tracking feed.
            </span>
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Prioritisation"
            title="Nexra opportunity score"
            description="A weighted sum of nine readings of the mock dataset. Not a model — the components are published so the number can be argued with."
            actions={
              <Badge tone={band.tone}>
                {keyword.opportunity.score} · {band.label}
              </Badge>
            }
          />

          <PanelBody>
            <div className="rounded-md border border-border bg-surface-raised px-3.5 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[11.5px] text-fg-subtle">
                  Weighted total
                </span>
                <span className="tabular text-[22px] leading-none font-semibold text-fg">
                  {keyword.opportunity.score}
                </span>
              </div>
              <Meter
                className="mt-2"
                value={keyword.opportunity.score}
                tone={band.meter}
                label={`Opportunity score ${keyword.opportunity.score} of 100`}
              />
              <p className="mt-2 text-[11.5px] leading-relaxed text-fg-subtle">
                {keyword.opportunity.summary}
              </p>
              <p className="mt-2 text-[11.5px] text-fg-subtle">
                Closing the gap is worth about{" "}
                <span className="font-medium text-fg">
                  {formatCurrency(opportunityValue)}
                </span>{" "}
                a month at this keyword&apos;s listed cost per click.
              </p>
            </div>

            <div className="mt-3.5">
              <ScoreBreakdown score={keyword.opportunity} />
            </div>
          </PanelBody>

          <PanelFooter>
            <span>
              Arithmetic over fixture values. It is not a proprietary model, and
              no machine learning is involved.
            </span>
          </PanelFooter>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="Target page"
            title="What should rank for this"
            description="The page meant to serve the query, and anything else of ours competing for it."
          />

          <PanelBody className="space-y-3">
            <div className="rounded-md border border-border bg-surface-raised px-3.5 py-3">
              <p className="text-[11px] text-fg-subtle">Target page</p>
              <p className="mt-1.5">
                <TargetUrl url={keyword.targetUrl} className="text-[12.5px]" />
              </p>
              {keyword.targetUrl !== null && (
                <>
                  <div className="mt-2.5 flex items-baseline justify-between text-[11px]">
                    <span className="text-fg-subtle">Content strength</span>
                    <span className="tabular text-fg-muted">
                      {keyword.contentStrength} / 100
                    </span>
                  </div>
                  <Meter
                    className="mt-1.5"
                    size="sm"
                    value={keyword.contentStrength}
                    tone={
                      keyword.contentStrength >= 70
                        ? "positive"
                        : keyword.contentStrength >= 45
                          ? "accent"
                          : "warning"
                    }
                    label={`Content strength ${keyword.contentStrength} of 100`}
                  />
                </>
              )}

              {/* The Content Studio holds the piece serving this query,
                  published or not, so the two modules meet here. */}
              {contentPiece && (
                <Link
                  href={`/content/${contentPiece.id}`}
                  className={buttonClasses("secondary", "sm", "mt-3 w-full justify-center")}
                >
                  <Icon name="content" className="h-4 w-4" />
                  {contentPiece.url === null
                    ? "Open the piece in production"
                    : "Open in Content Studio"}
                </Link>
              )}
            </div>

            {cannibalization ? (
              <div className="rounded-md border border-critical/30 bg-surface-raised px-3.5 py-3">
                <p className="flex flex-wrap items-center gap-2">
                  <Icon name="split" className="h-4 w-4 shrink-0 text-critical" />
                  <span className="text-[12.5px] font-semibold text-fg">
                    Competing pages
                  </span>
                  <Badge
                    tone={CANNIBALIZATION_RISK_META[cannibalization.risk].tone}
                    dot
                  >
                    {CANNIBALIZATION_RISK_META[cannibalization.risk].label} risk
                  </Badge>
                </p>

                <ul className="mt-2.5 space-y-1.5">
                  {cannibalization.urls.map((entry) => (
                    <li
                      key={entry.url}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded border border-border bg-surface px-2.5 py-1.5"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Badge
                          tone={entry.role === "primary" ? "accent" : "neutral"}
                        >
                          {entry.role === "primary" ? "Primary" : "Competing"}
                        </Badge>
                        <span className="truncate font-mono text-[11.5px] text-fg-muted">
                          {entry.url}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-[11.5px] text-fg-subtle">
                        position {entry.position} · {entry.trafficShare}% of
                        clicks
                      </span>
                    </li>
                  ))}
                </ul>

                <p className="mt-2.5 text-[11.5px] leading-relaxed text-fg-muted">
                  {cannibalization.resolution}
                </p>
                <p className="mt-1.5 text-[11.5px] text-fg-subtle">
                  About {formatCompact(cannibalization.lostTraffic)} sessions a
                  month are lost to the split.
                </p>
              </div>
            ) : (
              <p className="flex items-center gap-2 rounded-md border border-border bg-surface-raised px-3.5 py-3 text-[12px] text-fg-subtle">
                <Icon name="check" className="h-4 w-4 shrink-0 text-positive" />
                One page of ours ranks for this term. No cannibalisation
                detected.
              </p>
            )}

            {keyword.competitor && (
              <div className="rounded-md border border-border bg-surface-raised px-3.5 py-3">
                <p className="text-[11px] text-fg-subtle">Best-placed rival</p>
                <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[12.5px] font-medium text-fg">
                    {keyword.competitor.name}
                  </span>
                  <span className="font-mono text-[11.5px] text-fg-subtle">
                    {keyword.competitor.domain}
                  </span>
                  <span className="tabular text-[11.5px] text-warning">
                    position {keyword.competitor.position}
                  </span>
                </p>
                {gap && (
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-fg-subtle">
                    <Badge tone={CONTENT_GAP_META[gap.gapType].tone}>
                      {CONTENT_GAP_META[gap.gapType].label}
                    </Badge>
                    {CONTENT_GAP_META[gap.gapType].description} Suggested:{" "}
                    {gap.suggestedContentType}.
                  </p>
                )}
              </div>
            )}

            {rivals.length > 0 && (
              <div className="rounded-md border border-border bg-surface-raised px-3.5 py-3">
                <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-fg-subtle">
                  <span>Every rival ranking for this term</span>
                  <Link
                    href={`/competitors?project=${keyword.projectId}&tab=overlap`}
                    className="inline-flex items-center gap-1 text-accent transition-colors hover:text-accent-hover"
                  >
                    Competitor Intelligence
                    <Icon name="arrow-right" className="h-3 w-3" />
                  </Link>
                </p>

                <ul className="mt-2.5 space-y-1.5">
                  {rivals.map((rival) => (
                    <li
                      key={rival.id}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded border border-border bg-surface px-2.5 py-1.5"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Link
                          href={`/competitors/${rival.competitorId}`}
                          className="text-[12px] font-medium text-fg transition-colors hover:text-accent"
                        >
                          {rival.competitorName}
                        </Link>
                        <span className="truncate font-mono text-[11px] text-fg-subtle">
                          {rival.competitorDomain}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2.5 text-[11.5px]">
                        <span
                          className="tabular text-fg-muted"
                          title="Their position on this query"
                        >
                          position {rival.theirPosition}
                        </span>
                        {rival.battle !== null && (
                          <Badge tone={BATTLE_META[rival.battle].tone}>
                            {BATTLE_META[rival.battle].short}
                          </Badge>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>

                <p className="mt-2 text-[11px] leading-snug text-fg-subtle">
                  Positions and states are the same readings the Competitor
                  Intelligence module shows for this term.
                </p>
              </div>
            )}
          </PanelBody>

          <PanelFooter>
            <span>
              Positions and shares are modelled from the fixture dataset.
            </span>
            <span className="inline-flex items-center gap-2">
              <ChangeValue change={keyword.change} />
              <PositionValue position={keyword.position} />
            </span>
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="SERP landscape"
            title="What the result page looks like"
            description="Features detected on the result page for this query, and who currently holds them."
            actions={
              <Badge tone="neutral">
                {SERP_TYPE_META[keyword.serpType].label} SERP
              </Badge>
            }
          />

          {keyword.serpFeatures.length === 0 ? (
            <EmptyState
              size="sm"
              icon="search"
              title="No SERP features detected"
              description="Ten organic results with nothing else on the page — the ranking is the whole opportunity here."
            />
          ) : (
            <PanelBody className="space-y-2">
              {keyword.serpFeatures.map((entry) => {
                const meta = SERP_FEATURE_META[entry.feature];
                const ownership = SERP_OWNERSHIP_META[entry.ownership];

                return (
                  <div
                    key={entry.feature}
                    className={cn(
                      "rounded-md border px-3 py-2.5",
                      entry.ownership === "ours"
                        ? "border-positive/30 bg-positive/5"
                        : "border-border bg-surface-raised",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <Icon
                          name={meta.icon}
                          className="h-4 w-4 shrink-0 text-fg-subtle"
                        />
                        <span className="truncate text-[12.5px] font-medium text-fg">
                          {meta.label}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {entry.holder && (
                          <span className="text-[11px] text-fg-subtle">
                            {entry.holder}
                          </span>
                        )}
                        <Badge tone={ownership.tone}>{ownership.label}</Badge>
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11.5px] leading-snug text-fg-subtle">
                      {entry.action}
                    </p>
                  </div>
                );
              })}
            </PanelBody>
          )}

          <PanelFooter>
            <span>{SERP_TYPE_META[keyword.serpType].description}</span>
          </PanelFooter>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="AI search"
            title="Answer engine relevance"
            description="How this query behaves where the answer replaces the click. Every reading below is projected from this keyword's own figures."
            actions={
              <Badge tone={AI_COVERAGE_META[keyword.ai.coverage].tone} dot>
                {AI_COVERAGE_META[keyword.ai.coverage].label}
              </Badge>
            }
          />

          <PanelBody className="space-y-3">
            <p className="text-[12px] leading-relaxed text-fg-muted">
              {AI_COVERAGE_META[keyword.ai.coverage].description}
            </p>

            <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
              <AiReading
                label="AI opportunity"
                value={aiOpportunityOf(keyword)}
                hint="Relevance and answerability, discounted by what we already hold"
              />
              <AiReading
                label="Answer relevance"
                value={keyword.ai.answerRelevance}
                hint="How well the query suits a generated answer"
              />
              <AiReading
                label="Answerability"
                value={keyword.ai.answerability}
                hint="How cleanly it can be answered in a passage"
              />
              <AiReading
                label="Brand mention potential"
                value={keyword.ai.brandMentionPotential}
                hint="Modelled likelihood the brand is named in an answer"
              />
            </dl>

            <div className="rounded-md border border-border bg-surface-raised px-3.5 py-3">
              <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
                <span className="text-fg-subtle">Entity strength needed</span>
                <span className="tabular text-fg-muted">
                  {keyword.ai.entityStrengthHeld} held /{" "}
                  {keyword.ai.entityStrengthNeeded} needed
                </span>
              </div>
              <Meter
                className="mt-2"
                value={keyword.ai.entityStrengthHeld}
                max={Math.max(
                  keyword.ai.entityStrengthNeeded,
                  keyword.ai.entityStrengthHeld,
                  1,
                )}
                tone={
                  entityGapOf(keyword) > 12
                    ? "critical"
                    : entityGapOf(keyword) > 0
                      ? "warning"
                      : "positive"
                }
                label="Entity strength held against entity strength needed"
              />
              <p className="mt-2 text-[11.5px] leading-snug text-fg-subtle">
                {entityGapOf(keyword) > 0
                  ? `${entityGapOf(keyword)} points short of the topical authority being drawn from an answer would demand here.`
                  : "Authoritative enough on this topic for being drawn from an answer to be realistic."}
              </p>
            </div>

            <p className="flex flex-wrap items-center gap-2 text-[11.5px] text-fg-subtle">
              Citation opportunity:
              <Badge
                tone={
                  keyword.ai.citationOpportunity === "high"
                    ? "positive"
                    : keyword.ai.citationOpportunity === "medium"
                      ? "accent"
                      : "neutral"
                }
              >
                {keyword.ai.citationOpportunity}
              </Badge>
              {keyword.ai.questionFormat && <Badge tone="neutral">Question format</Badge>}
            </p>
          </PanelBody>

          <PanelFooter>
            <span>{KEYWORDS_AI_SOURCE_NOTE}</span>
            <Link
              href="/agents/ai-visibility"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-accent"
            >
              <Icon name="agents" className="h-3.5 w-3.5" />
              AI Visibility agent
            </Link>
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Cluster"
            title={cluster ? cluster.name : "Not clustered"}
            description={
              cluster
                ? `${cluster.parentTopic} · ${cluster.keywordCount} keywords · ${formatCompact(cluster.totalVolume)} searches a month`
                : "This keyword does not belong to a cluster."
            }
            actions={
              cluster ? (
                <Link
                  href={`/keywords/clusters/${cluster.id}`}
                  className={buttonClasses("secondary", "sm")}
                >
                  Open cluster
                  <Icon name="arrow-right" className="h-4 w-4" />
                </Link>
              ) : undefined
            }
          />

          {related.length === 0 ? (
            <EmptyState
              size="sm"
              icon="layers"
              title="No related keywords"
              description="Nothing else in the dataset shares this keyword's cluster."
            />
          ) : (
            <PanelBody>
              <p className="mb-2.5 text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
                Related keywords in this cluster
              </p>
              <ul className="space-y-1.5">
                {related.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-border bg-surface-raised px-3 py-2"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <KeywordLink
                        id={entry.id}
                        keyword={entry.keyword}
                        className="truncate text-[12.5px]"
                      />
                      <IntentBadge intent={entry.intent} short />
                    </span>
                    <span className="flex shrink-0 items-center gap-3 text-[11.5px] text-fg-subtle">
                      <span className="tabular">
                        {formatCompact(entry.volume)} / mo
                      </span>
                      <PositionValue position={entry.position} />
                      <OpportunityValue
                        score={entry.opportunity.score}
                        showMeter={false}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </PanelBody>
          )}

          <PanelFooter>
            <span>
              Ordered by opportunity score — the strongest sibling first.
            </span>
          </PanelFooter>
        </Panel>
      </div>

      {detail.opportunities.length > 0 && (
        <Panel>
          <PanelHeader
            eyebrow="Opportunities"
            title="Why this keyword is on the list"
            description="Every category this keyword currently qualifies for, and the rule that put it there."
          />
          <PanelBody>
            <ul className="grid gap-2 md:grid-cols-2">
              {detail.opportunities.map((entry) => {
                const meta = OPPORTUNITY_CATEGORY_META[entry.category];
                return (
                  <li
                    key={entry.id}
                    className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
                  >
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge tone={meta.tone}>
                        <Icon name={meta.icon} className="h-3 w-3" />
                        {meta.label}
                      </Badge>
                      <span className="text-[11.5px] text-positive">
                        {entry.expectedImpact}
                      </span>
                    </p>
                    <p className="mt-1.5 text-[11.5px] leading-snug text-fg-muted">
                      {entry.reason}
                    </p>
                  </li>
                );
              })}
            </ul>
          </PanelBody>
          <PanelFooter>
            <span>
              A keyword can qualify for more than one category — the rules are
              independent readings of the same record.
            </span>
            <Link
              href="/keywords?tab=opportunities"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-accent"
            >
              All opportunities
              <Icon name="arrow-right" className="h-3.5 w-3.5" />
            </Link>
          </PanelFooter>
        </Panel>
      )}
    </div>
  );
}

function Reading({
  label,
  value,
  caption,
  tone = "neutral",
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: "neutral" | "positive" | "critical";
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-fg-subtle">{label}</dt>
      <dd
        className={cn(
          "tabular mt-1 text-[18px] leading-none font-semibold",
          tone === "positive"
            ? "text-positive"
            : tone === "critical"
              ? "text-critical"
              : "text-fg",
        )}
      >
        {value}
      </dd>
      {caption && (
        <dd className="mt-1 text-[10.5px] leading-snug text-fg-subtle">
          {caption}
        </dd>
      )}
    </div>
  );
}

function AiReading({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-fg-subtle">{label}</span>
        <span className="tabular font-medium text-fg-muted">{value}</span>
      </dt>
      <dd>
        <Meter
          className="mt-1.5"
          size="sm"
          value={value}
          tone={value >= 70 ? "positive" : value >= 45 ? "accent" : "neutral"}
          label={`${label}: ${value} out of 100`}
        />
        <p className="mt-1 text-[10.5px] leading-snug text-fg-subtle">{hint}</p>
      </dd>
    </div>
  );
}
