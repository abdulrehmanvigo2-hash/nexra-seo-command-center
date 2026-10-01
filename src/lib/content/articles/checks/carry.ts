import "server-only";

/**
 * Check-result carry-forward (fix F8, audit A5-02, A3-03).
 *
 * A check result binds to one exact article version. When a later version
 * holds a unit whose text is identical, byte for byte, to a unit that PASSED
 * on an earlier version of the same article, that result may be carried onto
 * the new version instead of a new run — but only when:
 *
 *   * the source passed, on an earlier version of the same article, and was
 *     checked by its own run (a carried result is never a source);
 *   * the source run recorded the checker instructions' SHA-256, and it is
 *     the hash of the instructions the server checks with now;
 *   * and either the source result holds no SUPPORTED statement — it rests
 *     on no record, so a change in the records cannot change it — or the
 *     source run recorded the evidence fingerprint, and the evidence read now
 *     has the same fingerprint.
 *
 * Results recorded before F8 carry neither hash and are never carried. The
 * database's carry function holds the same rule (`20261014120000`); this
 * module chooses the source and says why a unit is or is not eligible, and
 * the database decides.
 *
 * THE EVIDENCE FINGERPRINT is the SHA-256 of the evidence-pack text the
 * check read, with the one line that records when Google was read ("Read
 * from Google at: …") removed: that line changes with every read and states
 * no record. Everything else — the crawl's pages and declarations, the Search
 * Console window and its figures, the competitor list — is in the hash, so
 * any change in what the records say is a different fingerprint.
 */

import type { CarryBasis, CarryRefusal } from "@/lib/content/articles/checks/carry-copy";
import { utf8Sha256 } from "@/lib/content/publications/content-hash";
import type { ArticleCheckUnitRecord } from "@/types/content-article-check";

const READ_TIME_LINE = /^Read from Google at:/;

/** The evidence fingerprint of an evidence-pack text: its SHA-256 without the read-time line. */
export function evidenceFingerprint(evidenceText: string): string {
  return utf8Sha256(
    evidenceText
      .split("\n")
      .filter((line) => !READ_TIME_LINE.test(line))
      .join("\n"),
  );
}

/** What the source run recorded about its check, from its evidence summary. Null fields were not recorded. */
export type SourceRunHashes = {
  readonly instructionsSha256: string | null;
  readonly evidenceSha256: string | null;
};

export type { CarryBasis, CarryRefusal };

/** `evidence-to-compare`: decided without the evidence (a screen read); the carry itself re-reads and compares it. */
export type CarryOfferBasis = CarryBasis | "evidence-to-compare";

export type CarryCandidate = {
  readonly source: ArticleCheckUnitRecord;
  readonly basis: CarryOfferBasis;
};

export type CarryDecision =
  | { readonly ok: true; readonly candidate: CarryCandidate }
  | { readonly ok: false; readonly reason: CarryRefusal; /** The newest identical earlier pass, when there is one. */ readonly fromVersion: number | null };

/** The hashes a source run recorded in its evidence summary; null where it recorded none (every run before F8). */
export function sourceRunHashes(metadata: unknown): SourceRunHashes {
  const evidence = typeof metadata === "object" && metadata !== null ? (metadata as Record<string, unknown>).evidence : undefined;
  const read = (key: string) => {
    if (typeof evidence !== "object" || evidence === null) return null;
    const value = (evidence as Record<string, unknown>)[key];
    return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null;
  };
  return { instructionsSha256: read("instructionsSha256"), evidenceSha256: read("evidenceSha256") };
}

/** The earlier passes a unit could carry from: same article, earlier version, passed by its own run, identical unit. Newest first. */
export function carrySources(
  target: { readonly unitKey: string; readonly unitKind: string; readonly unitSha256: string; readonly articleVersion: number },
  earlier: readonly ArticleCheckUnitRecord[],
): readonly ArticleCheckUnitRecord[] {
  return earlier
    .filter(
      (record) =>
        record.articleVersion < target.articleVersion &&
        record.status === "passed" &&
        record.carriedFrom === null &&
        record.unitSha256 === target.unitSha256 &&
        record.unitKey === target.unitKey &&
        record.unitKind === target.unitKind,
    )
    .sort((a, b) => b.articleVersion - a.articleVersion);
}

/**
 * The earlier result one unit could carry, or why none. `earlier` is every
 * unit record of the article's earlier versions; `runs` the hashes each
 * source run recorded, by run id. The newest eligible source is chosen.
 * `evidenceSha256` is the fingerprint of the evidence read now, or
 * "unread" when the caller has not read it (a source resting on a record is
 * then offered as `evidence-to-compare`).
 */
export function carryDecision(input: {
  readonly target: { readonly unitKey: string; readonly unitKind: string; readonly unitSha256: string; readonly articleVersion: number };
  readonly earlier: readonly ArticleCheckUnitRecord[];
  readonly runs: ReadonlyMap<string, SourceRunHashes>;
  readonly instructionsSha256: string;
  readonly evidenceSha256: string | null | "unread";
}): CarryDecision {
  const sources = carrySources(input.target, input.earlier);
  if (sources.length === 0) return { ok: false, reason: "no-earlier-pass", fromVersion: null };

  // When no source is eligible, the reason given is the newest source's.
  let refusal: CarryRefusal | null = null;
  const refuse = (reason: CarryRefusal) => {
    refusal ??= reason;
  };
  for (const source of sources) {
    const run = input.runs.get(source.checkedByRunId) ?? { instructionsSha256: null, evidenceSha256: null };
    if (run.instructionsSha256 === null) {
      refuse("instructions-not-recorded");
      continue;
    }
    if (run.instructionsSha256 !== input.instructionsSha256) {
      refuse("instructions-changed");
      continue;
    }
    const supported = source.result !== null && source.result.status === "passed" ? source.result.counts.supported : -1;
    if (supported === 0) return { ok: true, candidate: { source, basis: "no-supported" } };
    if (run.evidenceSha256 === null) {
      refuse("evidence-not-recorded");
      continue;
    }
    if (input.evidenceSha256 === "unread") return { ok: true, candidate: { source, basis: "evidence-to-compare" } };
    if (input.evidenceSha256 === null || run.evidenceSha256 !== input.evidenceSha256) {
      refuse("evidence-changed");
      continue;
    }
    return { ok: true, candidate: { source, basis: "evidence-unchanged" } };
  }
  return { ok: false, reason: refusal ?? "no-earlier-pass", fromVersion: sources[0]?.articleVersion ?? null };
}
