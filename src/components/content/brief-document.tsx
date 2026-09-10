import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { formatCompact, formatFullDate } from "@/lib/format";
import { FORMAT_META } from "@/lib/mock/content";
import {
  IntentBadge,
  KeywordLink,
  OwnerLink,
  StageBadge,
} from "@/components/content/content-chrome";
import type { BriefSource, ContentBrief } from "@/types/content";

/**
 * A brief, rendered as the document a writer would actually work from.
 *
 * Laid out in the order the work happens: what it is for and who it is for,
 * then the keywords it has to carry, then the outline, then the material to
 * write it with. Every part is derived from the canonical layers — the
 * secondary keywords are real records and link to them, the competitors are
 * the ones the keyword module already says out-rank us, and the internal links
 * are pages that exist.
 *
 * Nothing here is editable. There is no editor and no store behind it in this
 * milestone, and a text box that discarded what was typed would be worse than
 * a document that plainly reads.
 */

const SOURCE_TONE: Record<BriefSource["kind"], string> = {
  study: "Study",
  standard: "Standard",
  "market-data": "Market data",
  internal: "Internal",
  guidance: "Guidance",
};

export function BriefDocument({
  brief,
  /** Shown above the title where the brief is read outside its own page. */
  eyebrow = "Content brief",
  className,
}: {
  brief: ContentBrief;
  eyebrow?: string;
  className?: string;
}) {
  const format = FORMAT_META[brief.format];

  return (
    <Panel className={className}>
      <PanelHeader
        eyebrow={eyebrow}
        title={brief.title}
        description={brief.angle}
        actions={
          <>
            <StageBadge stage={brief.stage} />
            <Badge tone="neutral" title={format.description}>
              <Icon name={format.icon} className="h-3 w-3" />
              {format.label}
            </Badge>
          </>
        }
      />

      <PanelBody className="space-y-5">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="Primary keyword">
            <KeywordLink
              id={brief.primaryKeywordId}
              keyword={brief.primaryKeyword}
              className="text-[12.5px]"
            />
          </Fact>
          <Fact label="Search intent">
            <IntentBadge intent={brief.intent} />
          </Fact>
          <Fact label="Word target">
            <span className="tabular text-[13px] font-semibold text-fg">
              {brief.wordTarget.toLocaleString("en-US")}
            </span>
          </Fact>
          <Fact label="Due">
            <span className="tabular text-[12.5px] text-fg-muted">
              {formatFullDate(brief.dueAt)}
            </span>
          </Fact>
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <Note title="Who this is for" body={brief.audience} icon="user" />
          <Note
            title="How to serve the intent"
            body={brief.searchIntentNote}
            icon="target"
          />
        </section>

        {brief.secondaryKeywords.length > 0 && (
          <section>
            <Heading>Secondary keywords</Heading>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {brief.secondaryKeywords.map((entry) => (
                <li key={entry.id}>
                  <Link
                    href={`/keywords/${entry.id}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2 py-1 text-[11.5px] text-fg-muted transition-colors hover:border-border-strong hover:text-accent"
                  >
                    {entry.keyword}
                    <span className="tabular text-[10.5px] text-fg-subtle">
                      {formatCompact(entry.volume)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <Heading>Outline</Heading>
          <ol className="mt-2 space-y-1.5">
            {brief.outline.map((section) => (
              <li
                key={section.id}
                className={cn(
                  "rounded-md border border-border bg-surface-raised px-3 py-2",
                  section.level === 3 && "ml-4",
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle">
                      H{section.level}
                    </span>
                    <span className="text-[12.5px] font-medium text-fg">
                      {section.heading}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-[11px] text-fg-subtle">
                    ~{section.wordTarget} words
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] leading-snug text-fg-subtle">
                  {section.purpose}
                </p>
                {section.keywords.length > 0 && (
                  <p className="mt-1 text-[11px] text-fg-subtle">
                    Carries:{" "}
                    <span className="text-fg-muted">
                      {section.keywords.join(", ")}
                    </span>
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <section>
            <Heading>Entities to cover</Heading>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {brief.entities.map((entity) => (
                <li key={entity}>
                  <Badge tone="neutral">{entity}</Badge>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] leading-relaxed text-fg-subtle">
              Named things the topic assumes. An answer engine reads these as
              the signal that the page belongs to the subject.
            </p>
          </section>

          <section>
            <Heading>Questions to answer</Heading>
            {brief.questions.length === 0 ? (
              <p className="mt-2 text-[11.5px] leading-relaxed text-fg-subtle">
                None of this page&apos;s keywords are phrased as questions, so
                the result page is not asking any directly. Lead with the
                definition instead of an FAQ.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {brief.questions.map((question) => (
                  <li
                    key={question}
                    className="flex items-start gap-2 text-[12px] leading-snug text-fg-muted"
                  >
                    <Icon
                      name="chevron-right"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle"
                    />
                    {question}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <section>
            <Heading>Pages to beat</Heading>
            {brief.competitors.length === 0 ? (
              <p className="mt-2 text-[11.5px] leading-relaxed text-fg-subtle">
                No tracked rival ranks meaningfully above us on these keywords.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {brief.competitors.map((entry) => (
                  <li
                    key={entry.domain}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-raised px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium text-fg">
                        {entry.name}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-fg-subtle">
                        {entry.domain}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-[12px] text-fg-muted">
                      #{entry.position}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <Heading>Evidence to use</Heading>
            <ul className="mt-2 space-y-1.5">
              {brief.sources.map((source) => (
                <li
                  key={source.id}
                  className="rounded-md border border-border bg-surface-raised px-3 py-2"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[12.5px] font-medium text-fg">
                      {source.label}
                    </span>
                    <Badge tone="neutral">{SOURCE_TONE[source.kind]}</Badge>
                  </div>
                  <p className="mt-1 text-[11.5px] leading-snug text-fg-subtle">
                    {source.note}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {brief.internalLinks.length > 0 && (
          <section>
            <Heading>Internal links to include</Heading>
            <ul className="mt-2 space-y-1.5">
              {brief.internalLinks.map((link) => (
                <li
                  key={link.toId}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-border bg-surface-raised px-3 py-2"
                >
                  <Link
                    href={`/content/${link.toId}`}
                    className="min-w-0 truncate text-[12.5px] font-medium text-fg transition-colors hover:text-accent"
                  >
                    {link.toTitle}
                  </Link>
                  <span className="text-[11.5px] text-fg-subtle">
                    anchor:{" "}
                    <span className="text-fg-muted">
                      &ldquo;{link.anchor}&rdquo;
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-md border border-accent/25 bg-accent-soft/40 px-3.5 py-3">
          <Heading>Call to action</Heading>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-fg-muted">
            {brief.callToAction}
          </p>
        </section>
      </PanelBody>

      <PanelFooter>
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            Owner
            <OwnerLink agent={brief.owner} />
          </span>
          <span className="inline-flex items-center gap-1.5">
            Writing
            <OwnerLink agent={brief.writer} />
          </span>
        </span>
        <span>Generated from the canonical keyword set — read-only.</span>
      </PanelFooter>
    </Panel>
  );
}

function Heading({ children }: { children: string }) {
  return (
    <h4 className="text-[10.5px] font-semibold tracking-[0.09em] text-fg-subtle uppercase">
      {children}
    </h4>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-surface-raised px-3 py-2.5">
      <p className="text-[11px] text-fg-subtle">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Note({
  title,
  body,
  icon,
}: {
  title: string;
  body: string;
  icon: "user" | "target";
}) {
  return (
    <div className="rounded-md border border-border bg-surface-raised px-3.5 py-3">
      <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-fg-muted">
        <Icon name={icon} className="h-3.5 w-3.5 text-fg-subtle" />
        {title}
      </p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-fg-subtle">{body}</p>
    </div>
  );
}
