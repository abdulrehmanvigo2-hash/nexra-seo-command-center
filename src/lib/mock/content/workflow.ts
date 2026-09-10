import { CONTENT_AS_OF } from "@/lib/mock/content/records";
import { STAGE_META, STAGE_ORDER } from "@/lib/mock/content/meta";
import type {
  ContentRecord,
  ContentStage,
  WorkflowColumn,
  WorkflowItem,
} from "@/types/content";

/**
 * The production board.
 *
 * Two things sit on it. A **new** item is a piece that has never been
 * published, carrying the stage it has reached. A **refresh** is rework queued
 * against a page that is already live — which is most of what an editorial
 * team actually does, and a board that showed only new pieces would give a
 * false picture of the workload.
 *
 * Neither is a separate record. Both are readings of the canonical content
 * records, so an item moving on this board is the same piece the inventory
 * lists and the same page the detail workspace opens.
 *
 * The published column is deliberately not the whole archive. A board's last
 * column answers "what have we shipped lately", not "what exists" — the
 * inventory answers that, and stacking a hundred and sixty live pages beside
 * six drafts would make the board unreadable.
 */

const DAY_MS = 86_400_000;

/** How far back the published column reaches. */
export const RECENTLY_PUBLISHED_DAYS = 90;

/** Days between an ISO instant and the reference instant. */
function daysSince(iso: string): number {
  return Math.round((Date.parse(CONTENT_AS_OF) - Date.parse(iso)) / DAY_MS);
}

/** Every item on the board, for a given selection of records. */
export function getWorkflowItems(
  records: readonly ContentRecord[],
): readonly WorkflowItem[] {
  const items: WorkflowItem[] = [];

  for (const record of records) {
    if (record.url === null) {
      items.push({
        id: `${record.id}--new`,
        kind: "new",
        stage: record.stage,
        record,
        owner: record.owner,
        dueAt: record.updatedAt,
        note:
          record.primaryKeyword === null
            ? `Hub page for the ${record.clusterName} cluster.`
            : `New piece targeting “${record.primaryKeyword}”.`,
      });
      continue;
    }

    if (record.refresh) {
      items.push({
        id: `${record.id}--refresh`,
        kind: "refresh",
        stage: record.refresh.stage,
        record,
        owner: record.refresh.owner,
        dueAt: record.refresh.dueAt,
        note: record.refresh.reason,
      });
      continue;
    }

    if (
      record.publishedAt !== null &&
      daysSince(record.publishedAt) <= RECENTLY_PUBLISHED_DAYS
    ) {
      items.push({
        id: `${record.id}--live`,
        kind: "new",
        stage: "published",
        record,
        owner: record.owner,
        dueAt: record.publishedAt,
        note: `Published ${daysSince(record.publishedAt)} days ago.`,
      });
    }
  }

  return items;
}

/** The board, one column per stage. */
export function getWorkflowBoard(
  records: readonly ContentRecord[],
): readonly WorkflowColumn[] {
  const items = getWorkflowItems(records);

  return STAGE_ORDER.map((stage) => {
    const columnItems = items
      .filter((item) => item.stage === stage)
      .sort(
        (a, b) =>
          b.record.totalVolume - a.record.totalVolume ||
          a.record.title.localeCompare(b.record.title),
      );

    return {
      stage,
      label: stage === "published" ? "Recently published" : STAGE_META[stage].label,
      description:
        stage === "published"
          ? `Live in the last ${RECENTLY_PUBLISHED_DAYS} days.`
          : STAGE_META[stage].description,
      tone: STAGE_META[stage].tone,
      items: columnItems,
      volume: columnItems.reduce(
        (carry, item) => carry + item.record.totalVolume,
        0,
      ),
    } satisfies WorkflowColumn;
  });
}

/** Items due before the reference instant that are not yet published. */
export function overdueItems(
  records: readonly ContentRecord[],
): readonly WorkflowItem[] {
  return getWorkflowItems(records).filter(
    (item) =>
      item.stage !== "published" && Date.parse(item.dueAt) < Date.parse(CONTENT_AS_OF),
  );
}

/** Work in flight, whichever stage it is at. */
export function inFlightCount(records: readonly ContentRecord[]): number {
  return getWorkflowItems(records).filter(
    (item) => item.stage !== "published",
  ).length;
}

/** Stage of an item, for the board's own filters. */
export function stagesWithWork(
  records: readonly ContentRecord[],
): readonly ContentStage[] {
  const present = new Set(getWorkflowItems(records).map((item) => item.stage));
  return STAGE_ORDER.filter((stage) => present.has(stage));
}
