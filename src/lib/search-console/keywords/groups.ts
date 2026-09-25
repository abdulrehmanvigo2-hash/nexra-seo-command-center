/**
 * Lexical groups over an inventory of observed queries (milestone M4).
 *
 * The smallest defensible grouping: each query is filed under the one
 * non-function word of its own that is most frequent across the whole
 * inventory (ties: the alphabetically earlier word), and a group is kept
 * only when GROUP_MIN_QUERIES queries share that word. Deterministic, pure,
 * and honest about what it is — a grouping of words, not of meaning. Two
 * queries that share "seo" may be about different things, and two about
 * the same thing may share no word at all. The label says "lexical group"
 * so a screen or an agent cannot read it as a topic model.
 */

import { tokensOf } from "@/lib/search-console/keywords/intent";
import { GROUP_MIN_QUERIES } from "@/lib/search-console/keywords/thresholds";

/** Words that carry no topic on their own. Intent markers are here too, so "best" and "how" never head a group. */
const FUNCTION_WORDS = new Set([
  "a", "an", "the", "of", "for", "to", "in", "on", "at", "by", "from", "with", "and", "or", "is", "are", "was", "were", "be", "it", "its", "as", "vs", "versus",
  "how", "what", "why", "when", "where", "who", "which", "does", "do", "can", "should", "my", "your", "our", "me", "near", "best", "top", "free", "new",
  "i", "you", "we", "they", "this", "that", "these", "those", "not", "no", "yes", "get", "use", "using",
]);

export type LexicalGroup = {
  /** The shared word. */
  readonly term: string;
  /** Queries sharing the word, in the order the inventory lists them. */
  readonly queries: readonly string[];
  readonly queryCount: number;
};

export type LexicalGrouping = {
  /** Groups by query count, then term. */
  readonly groups: readonly LexicalGroup[];
  /** Query → term, for every query that landed in a kept group. */
  readonly termOf: ReadonlyMap<string, string>;
  /** Queries with no topic word, or whose word is shared by fewer than GROUP_MIN_QUERIES queries. */
  readonly ungrouped: number;
};

/** The query's topic words: its tokens minus function words and duplicates, in query order. */
export function topicTokensOf(query: string): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokensOf(query)) {
    if (FUNCTION_WORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

export function groupQueries(queries: readonly string[]): LexicalGrouping {
  const tokensByQuery = new Map<string, readonly string[]>();
  const frequency = new Map<string, number>();
  for (const query of queries) {
    if (tokensByQuery.has(query)) continue;
    const tokens = topicTokensOf(query);
    tokensByQuery.set(query, tokens);
    for (const token of tokens) frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }

  const headOf = (tokens: readonly string[]): string | null => {
    let head: string | null = null;
    for (const token of tokens) {
      if (head === null) {
        head = token;
        continue;
      }
      const f = frequency.get(token) ?? 0;
      const h = frequency.get(head) ?? 0;
      if (f > h || (f === h && token < head)) head = token;
    }
    return head;
  };

  const members = new Map<string, string[]>();
  for (const [query, tokens] of tokensByQuery) {
    const head = headOf(tokens);
    if (head === null) continue;
    const list = members.get(head);
    if (list) list.push(query);
    else members.set(head, [query]);
  }

  const termOf = new Map<string, string>();
  const groups: LexicalGroup[] = [];
  for (const [term, list] of members) {
    if (list.length < GROUP_MIN_QUERIES) continue;
    for (const query of list) termOf.set(query, term);
    groups.push({ term, queries: list, queryCount: list.length });
  }
  groups.sort((a, b) => b.queryCount - a.queryCount || a.term.localeCompare(b.term));

  return { groups, termOf, ungrouped: tokensByQuery.size - termOf.size };
}
