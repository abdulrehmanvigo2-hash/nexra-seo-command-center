/**
 * Reads one Writer section draft out of the text the Writer task stores.
 *
 * The Writer answers in five fixed sections — SECTION, DRAFT, CLAIMS USED,
 * PLACEHOLDERS, STATUS — followed by a fixed closing sentence
 * (`@/lib/content/draft-grounding`). This parser takes that contract
 * literally: every heading must be present, once, in that order; the
 * section line, the prose and the status line must be non-empty; and the
 * status line must be the fixed one. Nothing is inferred for a missing
 * part, because a draft version is text a person will own and edit, and a
 * guess written into it would be indistinguishable from what the model
 * said.
 *
 * Presentation around a heading — a markdown hash, a list marker, emphasis,
 * a trailing colon — is tolerated, as it is for the content plan's outline;
 * the words of the heading are what is matched. The prose is kept exactly
 * as generated apart from surrounding whitespace, and the status sentence
 * and the closing sentence are never part of it.
 *
 * Pure: no store, no network, safe to import from either side.
 */

/** The fixed status line the Writer is told to write. Mirrors SECTION_DRAFT_STATUS. */
export const WRITER_STATUS_LINE = "Draft for operator review. Not published, not approved, not final.";

export const WRITER_HEADINGS = ["SECTION", "DRAFT", "CLAIMS USED", "PLACEHOLDERS", "STATUS"] as const;
type Heading = (typeof WRITER_HEADINGS)[number];

/** The longest body a version may hold; the column's bound. */
export const MAX_DRAFT_BODY_LENGTH = 20_000;
export const MAX_DRAFT_TITLE_LENGTH = 400;

export type ParsedWriterOutput = {
  /** The SECTION line: the outline line the Writer drafted. */
  readonly sectionLabel: string;
  /** The DRAFT prose, surrounding whitespace removed, internal line breaks kept. */
  readonly body: string;
  readonly claims: readonly string[];
  readonly placeholders: readonly string[];
  readonly status: string;
};

export type WriterOutputRefusal =
  /** A heading is missing, repeated, or out of order. */
  | "headings"
  /** The SECTION line is empty. */
  | "section-empty"
  /** The Writer reported that no outline section carried a record tag: there is no draft to save. */
  | "section-none"
  | "body-empty"
  | "body-too-long"
  | "title-too-long"
  | "status-missing"
  /** The status line is not the fixed one, so this is not a Writer draft as the contract defines it. */
  | "status-unexpected";

export type ParseWriterOutputResult =
  | { readonly ok: true; readonly output: ParsedWriterOutput }
  | { readonly ok: false; readonly reason: WriterOutputRefusal };

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

function headingOf(line: string): Heading | null {
  const words = undecorated(line).toUpperCase();
  return WRITER_HEADINGS.find((heading) => heading === words) ?? null;
}

/** "none", however the model punctuates it, is an empty list. */
function isNone(lines: readonly string[]): boolean {
  return lines.length === 1 && /^[*_]*none[*_]*[.!]?$/i.test(lines[0].trim());
}

function nonEmptyLines(lines: readonly string[]): readonly string[] {
  return lines.map((line) => line.trim()).filter((line) => line.length > 0);
}

export function parseWriterOutput(text: string): ParseWriterOutputResult {
  const lines = text.split("\n");
  const found: { heading: Heading; index: number }[] = [];
  for (const [index, line] of lines.entries()) {
    const heading = headingOf(line);
    if (heading !== null) found.push({ heading, index });
  }
  // Each heading exactly once, in the fixed order.
  if (found.length !== WRITER_HEADINGS.length) return { ok: false, reason: "headings" };
  if (found.some((entry, position) => entry.heading !== WRITER_HEADINGS[position])) {
    return { ok: false, reason: "headings" };
  }

  const sectionOf = (position: number): readonly string[] => {
    const start = found[position].index + 1;
    const end = position + 1 < found.length ? found[position + 1].index : lines.length;
    return lines.slice(start, end);
  };

  const sectionLines = nonEmptyLines(sectionOf(0));
  const sectionLabel = sectionLines.join(" ").trim();
  if (sectionLabel.length === 0) return { ok: false, reason: "section-empty" };
  if (/^[*_]*none\b/i.test(sectionLabel)) return { ok: false, reason: "section-none" };
  if (sectionLabel.length > MAX_DRAFT_TITLE_LENGTH) return { ok: false, reason: "title-too-long" };

  const body = sectionOf(1).join("\n").trim();
  if (body.length === 0) return { ok: false, reason: "body-empty" };
  if (body.length > MAX_DRAFT_BODY_LENGTH) return { ok: false, reason: "body-too-long" };

  const claimLines = nonEmptyLines(sectionOf(2));
  const claims = isNone(claimLines) ? [] : claimLines;
  const placeholderLines = nonEmptyLines(sectionOf(3));
  const placeholders = isNone(placeholderLines) ? [] : placeholderLines;

  const statusLines = nonEmptyLines(sectionOf(4));
  const status = statusLines[0] ?? "";
  if (status.length === 0) return { ok: false, reason: "status-missing" };
  if (undecorated(status).replace(/[.]+$/, "") !== WRITER_STATUS_LINE.replace(/[.]+$/, "")) {
    return { ok: false, reason: "status-unexpected" };
  }

  return { ok: true, output: { sectionLabel, body, claims, placeholders, status: WRITER_STATUS_LINE } };
}
