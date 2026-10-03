/**
 * Admitted outside evidence for an article check (M4, PR 8; docs/roadmap/M4-research-evidence.md §5). Pure:
 *
 *   * which opportunities an article is for — those whose accepted task's NEWEST `article-linked` event names the
 *     article (M3's link; a task re-linked elsewhere no longer counts);
 *   * the block the checker reads: each admitted unit as `E<n>` with its claim, its quote (the words a statement may
 *     rest on), the page and the retrieval date — at most MAX_ADMITTED_UNITS and MAX_ADMITTED_BYTES, oldest decision
 *     first so the numbering is stable as units are added; none when there are none, so an article without admitted
 *     units is checked exactly as before;
 *   * the evidence text the F8 fingerprint covers: the pack's text, then the block when there is one — so admitting
 *     or rejecting a unit ends the carry of a passed result that rested on the records.
 */

export const MAX_ADMITTED_UNITS = 40;
export const MAX_ADMITTED_BYTES = 8_000;

export type AdmittedUnit = {
  readonly id: string;
  readonly claim: string;
  readonly quote: string;
  readonly url: string;
  readonly fetchedAt: string;
  readonly decidedAt: string;
};

export type LinkEvent = { readonly taskId: string; readonly articleId: string | null; readonly seq: number };
export type OpportunityTask = { readonly taskId: string; readonly sourceKind: string; readonly sourceRef: string };

/** The opportunities whose task's newest article link names this article. */
export function linkedOpportunityIds(events: readonly LinkEvent[], tasks: readonly OpportunityTask[], articleId: string): readonly string[] {
  const newest = new Map<string, LinkEvent>();
  for (const event of events) {
    const seen = newest.get(event.taskId);
    if (seen === undefined || event.seq > seen.seq) newest.set(event.taskId, event);
  }
  const ids = new Set<string>();
  for (const task of tasks) {
    if (task.sourceKind !== "opportunity") continue;
    if (newest.get(task.taskId)?.articleId?.toLowerCase() === articleId.toLowerCase()) ids.add(task.sourceRef.toLowerCase());
  }
  return [...ids].sort();
}

export type AdmittedBlock = {
  readonly text: string;
  /** The labels a SUPPORTED line may name, `E1` upward. */
  readonly labels: readonly string[];
  readonly unitIds: readonly string[];
  /** Admitted units left out by the bounds. */
  readonly omitted: number;
};

const encoder = new TextEncoder();

export function formatAdmittedBlock(units: readonly AdmittedUnit[]): AdmittedBlock | null {
  const ordered = [...units].sort((a, b) => a.decidedAt.localeCompare(b.decidedAt) || a.id.localeCompare(b.id));
  if (ordered.length === 0) return null;
  const head = "=== ADMITTED OUTSIDE EVIDENCE (claims from outside pages, each admitted by the operator after the product found its quote word for word in the stored page; a statement may rest only on a unit's QUOTE) ===";
  const tail = "=== END ADMITTED OUTSIDE EVIDENCE ===";
  const lines: string[] = [];
  const labels: string[] = [];
  const unitIds: string[] = [];
  let bytes = encoder.encode(`${head}\n\n${tail}`).length;
  for (const unit of ordered) {
    if (labels.length >= MAX_ADMITTED_UNITS) break;
    const label = `E${labels.length + 1}`;
    const line = `${label} — claim: ${JSON.stringify(unit.claim)} — quote: ${JSON.stringify(unit.quote)} — page: ${unit.url} — retrieved ${unit.fetchedAt.slice(0, 10)}`;
    const size = encoder.encode(`${line}\n`).length;
    if (bytes + size > MAX_ADMITTED_BYTES) break;
    bytes += size;
    lines.push(line);
    labels.push(label);
    unitIds.push(unit.id);
  }
  if (labels.length === 0) return null;
  const omitted = ordered.length - labels.length;
  const text = [head, ...lines, ...(omitted > 0 ? [`(${omitted} more admitted unit${omitted === 1 ? "" : "s"} not shown: the block's bound)`] : []), tail].join("\n");
  return { text, labels, unitIds, omitted };
}

/** The text the F8 evidence fingerprint covers: the pack's, then the admitted block when there is one. */
export function checkEvidenceText(packText: string, block: AdmittedBlock | null): string {
  return block === null ? packText : `${packText}\n\n${block.text}`;
}
