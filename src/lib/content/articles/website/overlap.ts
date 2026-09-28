/**
 * The keyword overlap check for a new article (decision D7): its keywords
 * may not repeat the live article's. Two phrases overlap when, normalised
 * (`normalisePhrase`: lowercase ASCII words, punctuation dropped), they are
 * equal or one holds the other as a whole run of words — so "Dead-lead
 * follow up" repeats "dead lead follow-up", and "dead lead follow-up
 * checklist" repeats it too.
 *
 * Both sets feed the check: the live article's keywords are pinned in the
 * template, and the new article's own keywords are returned normalised,
 * for the live-slug follow-up (D10) to record once it is published.
 *
 * Pure.
 */

import { normalisePhrase } from "@/lib/content/publications/website/topic-overlap";

export type KeywordOverlap = { readonly keyword: string; readonly liveKeyword: string };

function holds(outer: string, inner: string): boolean {
  return ` ${outer} `.includes(` ${inner} `);
}

/** Every new keyword that repeats a live keyword, in the new article's order, with the live keyword it repeats. */
export function keywordOverlaps(newKeywords: readonly string[], liveKeywords: readonly string[]): KeywordOverlap[] {
  const live = liveKeywords.map((keyword) => ({ keyword, phrase: normalisePhrase(keyword) })).filter((entry) => entry.phrase !== "");
  const overlaps: KeywordOverlap[] = [];
  for (const keyword of newKeywords) {
    const phrase = normalisePhrase(keyword);
    if (phrase === "") continue;
    const hit = live.find((entry) => holds(phrase, entry.phrase) || holds(entry.phrase, phrase));
    if (hit !== undefined) overlaps.push({ keyword, liveKeyword: hit.keyword });
  }
  return overlaps;
}

/** The new article's keywords, normalised, in order and once each: its set for the overlap check after publication. */
export function normalisedKeywords(keywords: readonly string[]): string[] {
  return [...new Set(keywords.map(normalisePhrase).filter((phrase) => phrase !== ""))];
}
