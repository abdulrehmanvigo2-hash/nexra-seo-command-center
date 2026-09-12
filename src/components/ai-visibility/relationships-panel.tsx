"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import {
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
} from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { Toolbar, ToolbarSpacer } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import {
  RELATION_BAND_META,
  RELATION_EVIDENCE_META,
  RELATION_KIND_META,
  RELATION_NOTE,
} from "@/lib/mock/ai-visibility";
import { ConfidenceTag } from "@/components/ai-visibility/ai-chrome";
import type {
  EntityConnectivity,
  EntityRelation,
  RelationBand,
} from "@/types/ai-visibility";

/**
 * How the entities on screen connect to each other.
 *
 * Sits under the entity table rather than in a tab of its own: a connection is
 * a property of the entities above it, and reading the two apart would mean
 * holding an entity's name in your head while you looked for it elsewhere. The
 * entity table already carries ten columns, so the relationships go below it
 * rather than into it.
 *
 * The panel is built to answer four questions in order — which entities are
 * strongly connected, which are barely connected, what evidence supports a
 * connection, and where a connection is missing — because that is the order
 * somebody deciding what to write next asks them in.
 */

const PREVIEW = 12;

type View = "strongest" | "weakest" | "isolated";

export function RelationshipsPanel({
  relations,
  connectivity,
}: {
  /** Edges touching the entities currently in view. */
  relations: readonly EntityRelation[];
  /** Connectivity for those same entities. */
  connectivity: readonly EntityConnectivity[];
}) {
  const [view, setView] = useState<View>("strongest");
  const [expanded, setExpanded] = useState(false);

  if (relations.length === 0 && connectivity.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon="split"
          title="No connections in this selection"
          description="Narrowing to a single entity type or a thin topic can leave nothing to connect. Widen the filters to see the graph."
        />
      </Panel>
    );
  }

  const direct = relations.filter((entry) => entry.evidence === "direct");
  const isolated = connectivity.filter((entry) => entry.band === "isolated");
  const withGap = relations.filter((entry) => entry.gap !== null);

  const rows =
    view === "strongest"
      ? [...relations].sort(
          (a, b) => b.strength - a.strength || a.id.localeCompare(b.id),
        )
      : view === "weakest"
        ? [...withGap].sort(
            (a, b) => a.strength - b.strength || a.id.localeCompare(b.id),
          )
        : [];

  const shown = expanded ? rows : rows.slice(0, PREVIEW);

  return (
    <Panel>
      <PanelHeader
        eyebrow="Semantic connections"
        title="How these entities relate"
        description="Derived from our own pages and link graph. An edge reports what the content puts together, which is a smaller claim than a real-world relationship."
        actions={
          <span className="text-[11.5px] text-fg-subtle">
            {relations.length} connections · {direct.length} on direct evidence
          </span>
        }
      />

      <Toolbar label="Choose which connections to read">
        <Segmented
          label="Connection view"
          value={view}
          onChange={(next) => {
            setView(next);
            setExpanded(false);
          }}
          options={[
            {
              value: "strongest" as const,
              label: "Strongest",
              count: relations.length,
              title: "Best-established connections first.",
            },
            {
              value: "weakest" as const,
              label: "Needs work",
              count: withGap.length,
              title:
                "Connections resting on thin or inferred evidence, with what would strengthen them.",
            },
            {
              value: "isolated" as const,
              label: "Unconnected",
              count: isolated.length,
              title:
                "Entities nothing of ours establishes alongside anything else.",
            },
          ]}
        />
        <ToolbarSpacer />
        {/* Wraps: at 375px a nowrap note is wider than the toolbar and gets
            clipped by the panel's own overflow rule. */}
        <p className="min-w-0 text-[11.5px] text-fg-subtle">
          Direct evidence is a shared page or a link. Inferred is shared filing.
        </p>
      </Toolbar>

      {view === "isolated" ? (
        <IsolatedList entities={isolated} />
      ) : rows.length === 0 ? (
        // Two different nothings: no connections at all, and no connections
        // that need work. Saying the second when the first is true would tell
        // a reader the graph is healthy when it is empty.
        view === "strongest" ? (
          <EmptyState
            size="sm"
            icon="split"
            title="Nothing connects these entities"
            description="The filters have narrowed to entities with no connection between them. Widen the type or topic filter to see the graph they sit in."
          />
        ) : (
          <EmptyState
            size="sm"
            icon="check"
            title="Nothing needs strengthening here"
            description="Every connection in this selection rests on direct evidence with both ends established."
          />
        )
      ) : (
        <>
          <Table caption="Entity connections">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Connection</TableHeaderCell>
                <TableHeaderCell>Evidence</TableHeaderCell>
                <TableHeaderCell className="hidden lg:table-cell">
                  What supports it
                </TableHeaderCell>
                <TableHeaderCell align="right">Strength</TableHeaderCell>
                <TableHeaderCell className="hidden xl:table-cell">
                  Gap and action
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((relation) => (
                <RelationRow key={relation.id} relation={relation} />
              ))}
            </TableBody>
          </Table>

          {rows.length > PREVIEW && (
            <PanelBody className="py-2.5">
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-fg-muted transition-colors hover:text-accent"
              >
                <Icon
                  name={expanded ? "minus" : "plus"}
                  className="h-3.5 w-3.5"
                />
                {expanded
                  ? `Show the first ${PREVIEW}`
                  : `Show all ${rows.length}`}
              </button>
            </PanelBody>
          )}
        </>
      )}

      <PanelFooter>
        <span className="inline-flex items-start gap-1.5">
          <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {RELATION_NOTE}
        </span>
      </PanelFooter>
    </Panel>
  );
}

const BAND_TONE: Readonly<Record<RelationBand, "positive" | "accent" | "warning" | "critical">> = {
  central: "positive",
  connected: "accent",
  peripheral: "warning",
  isolated: "critical",
};

function RelationRow({ relation }: { relation: EntityRelation }) {
  const kind = RELATION_KIND_META[relation.kind];
  const evidence = RELATION_EVIDENCE_META[relation.evidence];
  const band = RELATION_BAND_META[relation.band];

  return (
    <TableRow>
      <TableCell header className="max-w-[20rem]">
        <span className="flex flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
            <Link
              href={`/ai-visibility?tab=entities&project=${relation.projectId}`}
              className="font-medium text-fg transition-colors hover:text-accent"
            >
              {relation.sourceName}
            </Link>
            <Icon
              name={relation.directional ? "arrow-right" : "minus"}
              className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
              aria-label={relation.directional ? "links to" : "connected with"}
            />
            <span className="font-medium text-fg">{relation.targetName}</span>
          </span>
          <span className="text-[11px] text-fg-subtle">
            {relation.projectName}
          </span>
        </span>
      </TableCell>

      <TableCell>
        <span className="flex flex-col gap-1">
          <Badge tone="neutral" title={kind.description}>
            <Icon name={kind.icon} className="h-3 w-3" />
            {kind.label}
          </Badge>
          <span className="flex items-center gap-1.5">
            <Badge tone={evidence.tone} dot title={evidence.description}>
              {evidence.label}
            </Badge>
            <ConfidenceTag confidence={relation.confidence} />
          </span>
        </span>
      </TableCell>

      <TableCell className="hidden lg:table-cell">
        <span className="flex flex-col gap-0.5">
          <span className="text-[11.5px] leading-snug text-fg-muted">
            {relation.basis}
          </span>
          <span className="tabular text-[11px] text-fg-subtle">
            {relation.evidenceCount}{" "}
            {relation.evidenceCount === 1 ? "piece" : "pieces"} of evidence ·{" "}
            {relation.pageIds.length}{" "}
            {relation.pageIds.length === 1 ? "page" : "pages"}
          </span>
        </span>
      </TableCell>

      <TableCell align="right">
        <span className="flex min-w-24 items-center justify-end gap-2">
          <span className="tabular text-[12.5px] font-semibold text-fg">
            {relation.strength}
          </span>
          <Meter
            value={relation.strength}
            tone={BAND_TONE[relation.band]}
            size="sm"
            label={`Connection strength ${relation.strength} out of 100`}
          />
          <Badge tone={band.tone} title={band.description}>
            {band.label}
          </Badge>
        </span>
      </TableCell>

      <TableCell className="hidden xl:table-cell">
        {relation.gap === null ? (
          <span className="text-[11.5px] text-fg-subtle">
            Established. Nothing outstanding.
          </span>
        ) : (
          <span className="flex flex-col gap-0.5">
            <span className="text-[11.5px] leading-snug text-warning">
              {relation.gap}
            </span>
            <span className="text-[11px] leading-snug text-fg-subtle">
              {relation.action}
            </span>
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

/**
 * Entities nothing connects.
 *
 * The most actionable list in the panel: an entity with no direct connection
 * reads to an engine as a term rather than a thing that belongs to something.
 */
function IsolatedList({
  entities,
}: {
  entities: readonly EntityConnectivity[];
}) {
  if (entities.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon="check"
        title="Every entity here is connected to something"
        description="Each one is established alongside at least one other on direct evidence."
      />
    );
  }

  return (
    <PanelBody>
      <ul className="space-y-2">
        {entities.map((entry) => (
          <li
            key={entry.entityId}
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2.5",
              "border-critical/30 bg-critical/5",
            )}
          >
            <span className="text-[12.5px] font-medium text-fg">
              {entry.entityName}
            </span>
            <span className="tabular text-[11.5px] text-fg-subtle">
              {entry.degree} {entry.degree === 1 ? "association" : "associations"},
              none on direct evidence
            </span>
            <span className="ml-auto text-[11.5px] text-fg-muted">
              Cover it alongside something else, or link its page from one that
              is established.
            </span>
          </li>
        ))}
      </ul>
    </PanelBody>
  );
}
