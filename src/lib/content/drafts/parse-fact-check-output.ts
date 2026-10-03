/**
 * Reads one fact-check out of the text the Research & Evidence task stores,
 * and turns it into the deterministic record a version carries.
 *
 * The agent answers in six fixed sections — SUPPORTED, PARTIAL,
 * UNSUPPORTED, UNVERIFIABLE, EDITORIAL, SUMMARY — followed by a fixed
 * closing sentence (`@/lib/content/drafts/fact-check-grounding`). The parser
 * takes that contract literally: every heading present, once, in that
 * order; lines before the first heading ignored; "none" an empty list; each
 * line a quotation, an optional note after a dash, and an optional record
 * tag at the end. Nothing is inferred for a missing part.
 *
 * The record itself is then built here, not by the model: every tag is
 * checked against the paths and window the run's evidence actually carried;
 * a supported or partial statement whose tag names nothing in the evidence
 * is moved to unverifiable, because a citation that cannot be checked is
 * not support; and the overall status is derived from the groups, never
 * read from the model's words. Absence from the records is recorded as
 * absence, not as falsehood, in the wording the record carries.
 *
 * The article check (Phase 6, checkpoint 6.8b) passes its own heading list:
 * the same five, then ATTESTED, then SUMMARY. The draft check passes none and
 * reads exactly the six it always has.
 *
 * Pure: no store, no network, safe to import from either side.
 */

import { FACT_CHECK_CLOSING, FACT_CHECK_SECTIONS } from "@/lib/content/drafts/fact-check-grounding";
import type { DraftFactCheck, FactCheckItem, FactCheckStatus } from "@/types/content-draft";

type Heading = string;

export type ParsedFactCheckItem = {
  readonly text: string;
  readonly note: string | null;
  /** The record tag's inside, as written: `crawl /services` or `search console 2026-08-19 to 2026-09-17`. */
  readonly evidence: string | null;
};

export type ParsedFactCheckOutput = {
  readonly supported: readonly ParsedFactCheckItem[];
  readonly partial: readonly ParsedFactCheckItem[];
  readonly unsupported: readonly ParsedFactCheckItem[];
  readonly unverifiable: readonly ParsedFactCheckItem[];
  readonly editorial: readonly ParsedFactCheckItem[];
  /** The ATTESTED section's lines, only when the heading list read has one (the article check, 6.8b). */
  readonly attested?: readonly ParsedFactCheckItem[];
  readonly summary: string;
};

export type FactCheckOutputRefusal =
  /** A heading is missing, repeated, or out of order. */
  | "headings"
  /** The SUMMARY section carries no sentence. */
  | "summary-missing"
  /** More lines than one check may hold. */
  | "too-many-items";

export type ParseFactCheckOutputResult =
  | { readonly ok: true; readonly output: ParsedFactCheckOutput }
  | { readonly ok: false; readonly reason: FactCheckOutputRefusal };

/** The most lines all five lists may hold together; the column is a small record, not a transcript. */
export const MAX_FACT_CHECK_ITEMS = 40;
/** The longest quotation, note and summary kept, in code units. */
export const MAX_ITEM_TEXT_LENGTH = 300;
export const MAX_SUMMARY_LENGTH = 400;

const LEADING_DECORATION = [/^#{1,6}\s+/, /^(?:\d+[.)]|[-*•])\s+/, /^[*_]+/];
const TRAILING_DECORATION = [/[*_]+$/, /[:\-–—]+$/];

/** The line's words alone: leading and trailing presentation removed. */
function undecorated(line: string): string {
  let text = line.trim();
  let previous = "";
  while (text !== previous) {
    previous = text;
    for (const pattern of LEADING_DECORATION) text = text.replace(pattern, "").trim();
    for (const pattern of TRAILING_DECORATION) text = text.replace(pattern, "").trim();
  }
  return text;
}

/**
 * A heading sharing its line with its first content, as `SUMMARY: one
 * sentence` or `EDITORIAL: - "…"`: the heading in capitals exactly as the
 * contract names it, optional emphasis, a colon or dash, then the content.
 * Capitals are required here, unlike for a heading alone, so a sentence
 * that merely begins with "Partial" or "Summary" is never read as one.
 */
function inlineHeading(sections: readonly string[]): RegExp {
  return new RegExp(`^(${sections.join("|")})(?:[*_]+)?\\s*[:\\-–—]\\s*(\\S.*)$`);
}
const INLINE_HEADING = inlineHeading(FACT_CHECK_SECTIONS);

/** The line without leading presentation: hashes, a list marker, opening emphasis. */
function stripLeading(line: string): string {
  let text = line.trim();
  let previous = "";
  while (text !== previous) {
    previous = text;
    for (const pattern of LEADING_DECORATION) text = text.replace(pattern, "").trim();
  }
  return text;
}

/** The heading a line carries, and the content that shares its line, if any. */
function headingOf(line: string, sections: readonly string[], pattern: RegExp): { readonly heading: Heading; readonly inline: string | null } | null {
  const words = undecorated(line).toUpperCase();
  const alone = sections.find((heading) => heading === words);
  if (alone !== undefined) return { heading: alone, inline: null };
  const inline = pattern.exec(stripLeading(line));
  if (inline === null) return null;
  return { heading: inline[1] as Heading, inline: inline[2].trim() };
}

/** "none", however the model marks or punctuates it — `none`, `- none`, `None.`, `**none**` — is not an item. */
const NONE_LINE = /^(?:\d+[.)]|[-*•])?\s*[*_]*none[*_]*[.!]?$/i;

function nonEmptyLines(lines: readonly string[]): readonly string[] {
  return lines.map((line) => line.trim()).filter((line) => line.length > 0);
}

/** A tag that names a record, ending the line apart from presentation, as the Writer's contract has it. */
const TAG_TAIL = "(?:[*_]+)?[.,;:!?]?(?:[*_]+)?\\s*$";
// M4: `[evidence E<n>]` names an admitted outside unit; only an article check given such units can verify one.
const RECORD_TAG = new RegExp(`\\[(crawl \\/[^\\]\\s]*|search console [^\\]]+|evidence E\\d{1,2})\\]${TAG_TAIL}`, "i");
const QUOTED = /["“”]([^"“”]+)["“”]/;
const NOTE_SEPARATOR = /\s+[—–-]\s+/;

function cut(text: string, limit: number): string {
  const characters = Array.from(text.trim());
  return characters.length > limit ? `${characters.slice(0, limit).join("")}…` : characters.join("");
}

/** One list line: the quotation, the note after the dash, and the record tag at the end. */
export function parseFactCheckLine(line: string): ParsedFactCheckItem {
  let rest = line.trim().replace(/^(?:\d+[.)]|[-*•])\s+/, "");
  let evidence: string | null = null;
  const tag = RECORD_TAG.exec(rest);
  if (tag !== null) {
    evidence = tag[1].replace(/\s+/g, " ").trim();
    rest = rest.slice(0, tag.index).trim();
  }
  const quoted = QUOTED.exec(rest);
  let text: string;
  let after: string;
  if (quoted !== null) {
    text = quoted[1].trim();
    after = rest.slice(quoted.index + quoted[0].length);
  } else {
    const split = rest.split(NOTE_SEPARATOR);
    text = split[0];
    after = split.length > 1 ? ` — ${split.slice(1).join(" — ")}` : "";
  }
  const note = after.replace(/^[\s—–\-:]+/, "").replace(/[*_]+/g, "").trim();
  return {
    text: cut(text.replace(/[*_]+/g, ""), MAX_ITEM_TEXT_LENGTH),
    note: note.length === 0 ? null : cut(note, MAX_ITEM_TEXT_LENGTH),
    evidence,
  };
}

/**
 * The sections in order. `sections` defaults to the draft check's six; the
 * article check passes its seven (ATTESTED before SUMMARY). Every heading
 * given must be present, once, in that order, whatever the list.
 */
export function parseFactCheckOutput(text: string, sections: readonly string[] = FACT_CHECK_SECTIONS): ParseFactCheckOutputResult {
  const pattern = sections === FACT_CHECK_SECTIONS ? INLINE_HEADING : inlineHeading(sections);
  const attestedAt = sections.indexOf("ATTESTED");
  const lines = text.split("\n");
  const found: { heading: Heading; index: number; inline: string | null }[] = [];
  for (const [index, line] of lines.entries()) {
    const heading = headingOf(line, sections, pattern);
    if (heading !== null) found.push({ heading: heading.heading, index, inline: heading.inline });
  }
  if (found.length !== sections.length) return { ok: false, reason: "headings" };
  if (found.some((entry, position) => entry.heading !== sections[position])) {
    return { ok: false, reason: "headings" };
  }

  // A section's lines: what shared the heading's line, then the lines
  // beneath it; blank lines and every form of "none" dropped.
  const sectionOf = (position: number): readonly string[] => {
    const start = found[position].index + 1;
    const end = position + 1 < found.length ? found[position + 1].index : lines.length;
    const inline = found[position].inline;
    return nonEmptyLines([...(inline === null ? [] : [inline]), ...lines.slice(start, end)]).filter((line) => !NONE_LINE.test(line));
  };
  const listOf = (position: number): readonly ParsedFactCheckItem[] => sectionOf(position).map(parseFactCheckLine);

  const supported = listOf(0);
  const partial = listOf(1);
  const unsupported = listOf(2);
  const unverifiable = listOf(3);
  const editorial = listOf(4);
  const attested = attestedAt === -1 ? undefined : listOf(attestedAt);
  if (supported.length + partial.length + unsupported.length + unverifiable.length + editorial.length + (attested?.length ?? 0) > MAX_FACT_CHECK_ITEMS) {
    return { ok: false, reason: "too-many-items" };
  }

  const closing = FACT_CHECK_CLOSING.replace(/[.]+$/, "").toLowerCase();
  const summaryLines = sectionOf(sections.length - 1).filter((line) => undecorated(line).replace(/[.]+$/, "").toLowerCase() !== closing);
  const summary = cut(summaryLines.join(" ").replace(/[*_]+/g, ""), MAX_SUMMARY_LENGTH);
  if (summary.length === 0) return { ok: false, reason: "summary-missing" };

  return { ok: true, output: { supported, partial, unsupported, unverifiable, editorial, ...(attested === undefined ? {} : { attested }), summary } };
}

/** The records a tag may name: the fetched paths and the one window the run's evidence carried. */
export type FactCheckEvidence = {
  readonly crawlId: string;
  readonly searchWindow: string | null;
  readonly recordPaths: readonly string[];
  /** M4: the admitted outside units an article check was given (`E1` upward); absent or empty, no evidence tag names anything. */
  readonly admittedUnits?: readonly string[];
};

function normaliseTag(tag: string): string {
  return tag.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Whether the tag names a fetched path or the included window. */
export function tagNamesRecord(evidence: string, records: FactCheckEvidence): boolean {
  const tag = normaliseTag(evidence);
  if (tag.startsWith("crawl ")) {
    const path = tag.slice("crawl ".length).trim();
    return records.recordPaths.some((known) => known.toLowerCase() === path);
  }
  if (tag.startsWith("search console ")) {
    return records.searchWindow !== null && normaliseTag(`search console ${records.searchWindow}`) === tag;
  }
  if (tag.startsWith("evidence ")) {
    const label = tag.slice("evidence ".length).trim();
    return (records.admittedUnits ?? []).some((known) => known.toLowerCase() === label);
  }
  return false;
}

/** The tag as written when it names a record the evidence carried, else null. */
function verified(item: ParsedFactCheckItem, evidence: FactCheckEvidence): string | null {
  return item.evidence !== null && tagNamesRecord(item.evidence, evidence) ? item.evidence : null;
}

const NO_TAG = "no record in the evidence is named for this statement";
const UNKNOWN_TAG = "the record named is not among the evidence the check was given";

/**
 * The status the groups imply. Conservative on purpose: a pass needs at
 * least one supported statement and nothing partial, unsupported or
 * unverifiable; anything the records do not hold fails; everything else
 * needs a person's review.
 */
export function deriveFactCheckStatus(groups: {
  readonly supported: readonly unknown[];
  readonly partial: readonly unknown[];
  readonly unsupported: readonly unknown[];
  readonly unverifiable: readonly unknown[];
}): FactCheckStatus {
  if (groups.unsupported.length > 0) return "failed";
  if (groups.partial.length > 0 || groups.unverifiable.length > 0) return "needs-review";
  return groups.supported.length > 0 ? "passed" : "needs-review";
}

/**
 * The record a version carries, built from the parsed output and the run's
 * own evidence summary. Tags are verified here; nothing about the verdict
 * is taken from the model.
 */
export function buildFactCheck(input: {
  readonly output: ParsedFactCheckOutput;
  readonly evidence: FactCheckEvidence;
  readonly draftId: string;
  readonly version: number;
  readonly checkedAt: string;
  readonly checkedByRunId: string;
  readonly recordedAt: string;
  readonly recordedBy: string;
}): DraftFactCheck {
  const { output, evidence } = input;
  const supported: FactCheckItem[] = [];
  const partial: FactCheckItem[] = [];
  // The model's own unverifiable lines first, then the lines it called
  // supported or partial whose tag names nothing in the evidence.
  const unverifiable: FactCheckItem[] = output.unverifiable.map((item) => ({ text: item.text, evidence: verified(item, evidence), note: item.note }));

  for (const item of output.supported) {
    const tag = verified(item, evidence);
    if (tag !== null) supported.push({ text: item.text, evidence: tag, note: item.note });
    else unverifiable.push({ text: item.text, evidence: null, note: item.evidence === null ? NO_TAG : UNKNOWN_TAG });
  }
  for (const item of output.partial) {
    const tag = verified(item, evidence);
    if (tag !== null) partial.push({ text: item.text, evidence: tag, note: item.note });
    else unverifiable.push({ text: item.text, evidence: null, note: item.evidence === null ? NO_TAG : UNKNOWN_TAG });
  }
  const unsupported: FactCheckItem[] = output.unsupported.map((item) => ({ text: item.text, evidence: verified(item, evidence), note: item.note }));
  const editorial: FactCheckItem[] = output.editorial.map((item) => ({ text: item.text, evidence: null, note: item.note }));

  return {
    status: deriveFactCheckStatus({ supported, partial, unsupported, unverifiable }),
    draftId: input.draftId,
    version: input.version,
    checkedAt: input.checkedAt,
    checkedByRunId: input.checkedByRunId,
    recordedAt: input.recordedAt,
    recordedBy: input.recordedBy,
    crawlId: evidence.crawlId,
    searchWindow: evidence.searchWindow,
    summary: output.summary,
    supported,
    partial,
    unsupported,
    unverifiable,
    editorial,
  };
}

/** The stored object read back as a fact-check, or null where it is not one. Field by field; nothing is assumed. */
export function readFactCheck(value: unknown): DraftFactCheck | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (status !== "passed" && status !== "needs-review" && status !== "failed") return null;
  const items = (list: unknown): readonly FactCheckItem[] | null => {
    if (!Array.isArray(list)) return null;
    const out: FactCheckItem[] = [];
    for (const entry of list) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
      const item = entry as Record<string, unknown>;
      if (typeof item.text !== "string") return null;
      out.push({
        text: item.text,
        evidence: typeof item.evidence === "string" ? item.evidence : null,
        note: typeof item.note === "string" ? item.note : null,
      });
    }
    return out;
  };
  const supported = items(record.supported);
  const partial = items(record.partial);
  const unsupported = items(record.unsupported);
  const unverifiable = items(record.unverifiable);
  const editorial = items(record.editorial);
  if (
    supported === null || partial === null || unsupported === null || unverifiable === null || editorial === null ||
    typeof record.draftId !== "string" || typeof record.version !== "number" || typeof record.checkedAt !== "string" ||
    typeof record.checkedByRunId !== "string" || typeof record.recordedAt !== "string" || typeof record.recordedBy !== "string" ||
    typeof record.crawlId !== "string" || typeof record.summary !== "string"
  ) {
    return null;
  }
  return {
    status,
    draftId: record.draftId,
    version: record.version,
    checkedAt: record.checkedAt,
    checkedByRunId: record.checkedByRunId,
    recordedAt: record.recordedAt,
    recordedBy: record.recordedBy,
    crawlId: record.crawlId,
    searchWindow: typeof record.searchWindow === "string" ? record.searchWindow : null,
    summary: record.summary,
    supported,
    partial,
    unsupported,
    unverifiable,
    editorial,
  };
}
