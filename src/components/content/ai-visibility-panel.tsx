import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { AGENT_NAMES } from "@/lib/mock/seo";
import {
  AI_SOURCE_NOTE,
  GAP_META,
  aiOpportunitiesForPage,
  aiPageForContent,
  entitiesForPage,
  gapsForPage,
} from "@/lib/mock/ai-visibility";
import {
  CitationBadge,
  ConfidenceTag,
  EffortBadge,
  EntityBandBadge,
  EntityTypeBadge,
  EvidenceBadge,
  EvidenceKindBadge,
  GainBadge,
  GapKindBadge,
  OpportunityKindBadge,
  ReadinessBadge,
  ScoreBreakdownList,
  ScoreReading,
  ScoreValue,
  SeverityBadge,
} from "@/components/ai-visibility/ai-chrome";

/**
 * One page's AI-visibility reading, on its Content Studio detail view.
 *
 * This is the page-level AI workspace the module needs, and it lives here
 * rather than on a route of its own: there is already one page detail screen in
 * this product, and a second would split the same URL across two places.
 *
 * The import direction is deliberate. `ai-visibility/*` reads `content/*` at
 * the fixture layer, so this component — not the content fixture layer — is
 * what reads back. A data-layer import in this direction would close a cycle.
 */
export function AiVisibilityPanel({ contentId }: { contentId: string }) {
  const page = aiPageForContent(contentId);

  if (!page) {
    return (
      <Panel>
        <EmptyState
          icon="ai-visibility"
          title="Not published yet"
          description="AI visibility is read from live URLs. An unpublished piece has nothing for an answer engine to reach, so there is nothing to score."
        />
      </Panel>
    );
  }

  const gaps = gapsForPage(page.id);
  const opportunities = aiOpportunitiesForPage(page.id);
  const entities = entitiesForPage(page.id);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-1">
          <PanelHeader
            eyebrow="Answer engines"
            title="AI visibility"
            description={page.visibility.summary}
            actions={<ReadinessBadge band={page.visibility.band} />}
          />
          <PanelBody className="space-y-4">
            <ScoreReading
              score={page.visibility.score}
              caption="AI visibility score"
              label={`AI visibility: ${page.visibility.score} out of 100`}
            />
            <ScoreBreakdownList score={page.visibility} />
          </PanelBody>
          <PanelFooter>
            <span>{AI_SOURCE_NOTE}</span>
          </PanelFooter>
        </Panel>

        <div className="grid gap-4 sm:grid-cols-2 xl:col-span-2 xl:content-start">
          <Panel>
            <PanelHeader
              eyebrow="Answer readiness"
              title="Does it answer the question"
              description={
                page.answer.reasons[0] ??
                "Nothing is holding this page's answer back."
              }
              actions={
                <ScoreValue
                  score={page.answer.score.score}
                  label="Answer readiness"
                />
              }
            />
            <PanelBody className="space-y-3">
              <ul className="space-y-1.5">
                {page.answer.signals
                  .filter((signal) => signal.applicable)
                  .slice(0, 6)
                  .map((signal) => (
                    <li
                      key={signal.id}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span
                        className="min-w-0 truncate text-[12px] text-fg-muted"
                        title={signal.finding}
                      >
                        {signal.label}
                      </span>
                      <span
                        className={cn(
                          "tabular shrink-0 text-[11.5px] font-semibold",
                          signal.value >= 65
                            ? "text-positive"
                            : signal.value >= 45
                              ? "text-warning"
                              : "text-critical",
                        )}
                      >
                        {signal.value}
                      </span>
                    </li>
                  ))}
              </ul>

              {page.answer.unansweredQuestions.length > 0 && (
                <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5">
                  <p className="text-[11px] font-semibold tracking-[0.06em] text-warning uppercase">
                    Questions it does not answer
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {page.answer.unansweredQuestions.map((question) => (
                      <li key={question} className="text-[12px] text-fg-muted">
                        {question}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              eyebrow="Evidence"
              title="Does it show its working"
              description={`${page.evidence.supportedClaims} supported and ${page.evidence.unsupportedClaims} unsupported claims, across ${page.evidence.diversity} kinds.`}
              actions={<EvidenceBadge band={page.evidence.band} />}
            />
            <PanelBody className="space-y-2.5">
              <ul className="flex flex-wrap gap-1.5">
                {[
                  ...new Set(
                    page.evidence.items
                      .filter((item) => item.kind !== "supported-claim")
                      .map((item) => item.kind),
                  ),
                ].map((kind) => (
                  <li key={kind}>
                    <EvidenceKindBadge kind={kind} />
                  </li>
                ))}
                {page.evidence.items.every(
                  (item) => item.kind === "supported-claim" || item.kind === "unsupported-claim",
                ) && (
                  <li className="text-[12px] text-fg-subtle">
                    No distinguishing evidence — the page asserts without
                    showing.
                  </li>
                )}
              </ul>
              <p className="text-[11.5px] leading-snug text-fg-subtle">
                Evidence availability is modelled from what the page is. No
                source URL is fetched or validated anywhere in this product.
              </p>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              eyebrow="Citation readiness"
              title="Could a claim be lifted"
              description={page.citation.reason}
              actions={<CitationBadge state={page.citation.state} />}
            />
            <PanelBody>
              <dl className="grid grid-cols-2 gap-3">
                <Figure
                  label="Quotable facts"
                  value={String(page.citation.quotableFacts)}
                  detail="Specific enough to stand alone."
                />
                <Figure
                  label="Readiness score"
                  value={String(page.citation.score.score)}
                  detail="Not a measure of whether anything was cited."
                />
              </dl>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              eyebrow="Information gain"
              title="Is there anything new here"
              description={page.gain.summary}
              actions={
                <>
                  <GainBadge band={page.gain.band} />
                  <ConfidenceTag confidence={page.gain.confidence} />
                </>
              }
            />
            <PanelBody>
              {page.gain.signals.length === 0 ? (
                <p className="text-[12px] leading-relaxed text-fg-muted">
                  {page.gain.confidence === "unknown"
                    ? "This page carries no distinguishing evidence, so originality cannot be established either way. Stated rather than guessed."
                    : "No signal of original contribution."}
                </p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {page.gain.signals.map((signal) => (
                    <li
                      key={signal}
                      className="rounded-md border border-border bg-surface-raised px-2 py-1 text-[11px] text-fg-muted"
                    >
                      {signal.replace(/-/g, " ")}
                    </li>
                  ))}
                </ul>
              )}
            </PanelBody>
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel>
          <PanelHeader
            eyebrow="Strengths"
            title="What is working"
            description="Where this page is already doing what an answer engine needs."
          />
          {page.strengths.length === 0 ? (
            <EmptyState
              size="sm"
              icon="alert"
              title="Nothing standing out"
              description="No dimension on this page is in good shape yet."
            />
          ) : (
            <ul className="divide-y divide-border">
              {page.strengths.map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-2 px-4 py-2.5 text-[12px] text-fg-muted sm:px-5"
                >
                  <Icon
                    name="check"
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-positive"
                  />
                  {line}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Weaknesses"
            title="What is holding it back"
            description="The reasons behind the score above."
          />
          {page.weaknesses.length === 0 ? (
            <EmptyState
              size="sm"
              icon="check"
              title="Nothing outstanding"
              description="No dimension on this page is below par."
            />
          ) : (
            <ul className="divide-y divide-border">
              {page.weaknesses.map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-2 px-4 py-2.5 text-[12px] text-fg-muted sm:px-5"
                >
                  <Icon
                    name="alert"
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
                  />
                  {line}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Entities"
            title="What this page is about"
            description={`${entities.length} modelled ${entities.length === 1 ? "entity" : "entities"} this page is a source for.`}
          />
          {entities.length === 0 ? (
            <EmptyState
              size="sm"
              icon="layers"
              title="No entities"
              description="Nothing on this page is modelled as an entity it owns."
            />
          ) : (
            <ul className="divide-y divide-border">
              {entities.slice(0, 6).map((entity) => (
                <li
                  key={entity.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-fg">
                      {entity.name}
                    </span>
                    <span className="mt-0.5 block">
                      <EntityTypeBadge type={entity.type} />
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <EntityBandBadge band={entity.band} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <PanelFooter>
            <Link
              href={`/ai-visibility?project=${page.projectId}&tab=entities`}
              className={buttonClasses("secondary", "sm")}
            >
              All entities
              <Icon name="arrow-right" className="h-4 w-4" />
            </Link>
          </PanelFooter>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="Open against this page"
            title={`${gaps.length} AI ${gaps.length === 1 ? "gap" : "gaps"}`}
            description="What an answer engine would trip over here."
          />
          {gaps.length === 0 ? (
            <EmptyState
              size="sm"
              icon="check"
              title="Nothing outstanding"
              description="No AI-specific gap is raised against this URL."
            />
          ) : (
            <ul className="divide-y divide-border">
              {gaps.map((gap) => (
                <li key={gap.id} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <GapKindBadge kind={gap.kind} />
                    <SeverityBadge severity={gap.severity} />
                    {gap.sourceIssueId !== null && (
                      <Link
                        href="/technical?tab=issues"
                        className="text-[11px] text-accent transition-opacity hover:opacity-80"
                        title="This finding defers to a Technical SEO issue rather than restating it."
                      >
                        Owned by Technical SEO
                      </Link>
                    )}
                  </div>
                  <p className="mt-1.5 text-[12px] leading-snug text-fg-muted">
                    {gap.reason}
                  </p>
                  <p className="mt-1 text-[11.5px] leading-snug text-fg-subtle">
                    {GAP_META[gap.kind].action}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <PanelFooter>
            <span>Findings are raised per rule, across the project</span>
            <Link
              href={`/ai-visibility?project=${page.projectId}&tab=gaps`}
              className={buttonClasses("secondary", "sm")}
            >
              All gaps
              <Icon name="arrow-right" className="h-4 w-4" />
            </Link>
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="What to do"
            title="Recommended improvements"
            description="The jobs in the queue that would touch this URL."
          />
          {opportunities.length === 0 ? (
            <EmptyState
              size="sm"
              icon="check"
              title="No work queued"
              description="Nothing in the AI queue touches this page."
            />
          ) : (
            <ul className="divide-y divide-border">
              {opportunities.map((entry) => (
                <li key={entry.id} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-[12.5px] font-medium text-fg">
                      {entry.title}
                    </span>
                    <span className="tabular shrink-0 text-[11.5px] text-fg-subtle">
                      Priority {entry.priority}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <OpportunityKindBadge kind={entry.kind} />
                    <EffortBadge effort={entry.effort} />
                    <span className="text-[11.5px] text-fg-subtle">
                      {AGENT_NAMES[entry.owner]}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-snug text-fg-subtle">
                    {entry.action}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <PanelFooter>
            <span>Ranked by value against effort</span>
            <Link
              href={`/ai-visibility?project=${page.projectId}&tab=opportunities`}
              className={buttonClasses("secondary", "sm")}
            >
              Full queue
              <Icon name="arrow-right" className="h-4 w-4" />
            </Link>
          </PanelFooter>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          eyebrow="Elsewhere"
          title="The same page, other lenses"
          description="Technical diagnostics, the keyword set behind it, and the topic it belongs to."
        />
        <PanelBody>
          <div className="flex flex-wrap gap-2">
            {page.technicalPageId !== null && (
              <Link
                href={`/technical/pages/${page.technicalPageId}`}
                className={buttonClasses("secondary", "sm")}
              >
                <Icon name="technical" className="h-4 w-4" />
                Technical detail
              </Link>
            )}
            <Link
              href={`/keywords/clusters/${page.clusterId}`}
              className={buttonClasses("secondary", "sm")}
            >
              <Icon name="keywords" className="h-4 w-4" />
              {page.clusterName}
            </Link>
            <Link
              href={`/ai-visibility?project=${page.projectId}&topic=${page.clusterId}&tab=topics`}
              className={buttonClasses("secondary", "sm")}
            >
              <Icon name="ai-visibility" className="h-4 w-4" />
              Topic readiness
            </Link>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}

function Figure({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
      <dt className="text-[11px] font-medium tracking-[0.03em] text-fg-muted uppercase">
        {label}
      </dt>
      <dd className="tabular mt-1.5 text-[20px] leading-none font-semibold text-fg">
        {value}
      </dd>
      <p className="mt-1.5 text-[11px] leading-snug text-fg-subtle">{detail}</p>
    </div>
  );
}
