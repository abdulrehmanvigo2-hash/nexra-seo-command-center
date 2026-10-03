import { LANGUAGE_CODE, LOCATION_CODE, SERP_DEPTH } from "@/lib/providers/dataforseo/constants";

/**
 * DataForSEO `serp/google/organic/live/advanced` answers, read into rows for `nexra_provider_serp_record` (M4, PR 3;
 * docs/roadmap/M4-research-evidence.md §1). Pure and fail-closed, like the Labs parsers: a status other than 20000 is a
 * provider refusal (not charged), a body without the documented shape is malformed. Only three item types are kept —
 * organic results (the top SERP_DEPTH), People Also Ask questions and related searches — each ranked within its type in
 * the provider's order; every other block (ads, maps, videos …) is left out. A snippet is the provider's text, never
 * evidence. Nothing here keeps or echoes the body's text.
 */

export type SerpRow =
  | { readonly type: "organic"; readonly rank: number; readonly url: string; readonly domain: string; readonly title: string; readonly snippet: string | null }
  | { readonly type: "people-also-ask"; readonly rank: number; readonly title: string; readonly url: string | null }
  | { readonly type: "related-search"; readonly rank: number; readonly title: string };

export type ParsedSerp =
  | { readonly ok: true; readonly rows: readonly SerpRow[]; readonly costUsd: number; readonly taskId: string | null; readonly items: number; readonly providerStatusCode: number }
  | { readonly ok: false; readonly reason: "provider-refused"; readonly providerStatusCode: number; readonly taskId: string | null }
  | { readonly ok: false; readonly reason: "malformed"; readonly providerStatusCode: number | null; readonly taskId: string | null };

/** The bounds the database holds rows to (20261024120000). */
export const MAX_QUESTIONS = 20;
export const MAX_RELATED = 20;
const MAX_URL = 2000;
const MAX_DOMAIN = 255;
const MAX_TITLE = 500;
const MAX_SNIPPET = 1000;

type Obj = Record<string, unknown>;
const isObject = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Text collapsed to single spaces and cut to a bound (an over-long title is cut, not refused). */
function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length === 0) return null;
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

function domainOf(item: Obj, url: string): string | null {
  const given = clean(item.domain, MAX_DOMAIN);
  if (given !== null) return given;
  try {
    return clean(new URL(url).hostname, MAX_DOMAIN);
  } catch {
    return null;
  }
}

/** The task each SERP call sends — and records. Never a credential. */
export function serpTask(keyword: string): Readonly<Record<string, unknown>> {
  return { keyword, location_code: LOCATION_CODE, language_code: LANGUAGE_CODE, depth: SERP_DEPTH };
}

export function parseSerpAnswer(body: unknown): ParsedSerp {
  if (!isObject(body)) return { ok: false, reason: "malformed", providerStatusCode: null, taskId: null };
  const top = finite(body.status_code);
  if (top === null) return { ok: false, reason: "malformed", providerStatusCode: null, taskId: null };
  if (top !== 20000) return { ok: false, reason: "provider-refused", providerStatusCode: top, taskId: null };
  const tasks = Array.isArray(body.tasks) ? body.tasks : null;
  const task = tasks && tasks.length === 1 && isObject(tasks[0]) ? tasks[0] : null;
  if (task === null) return { ok: false, reason: "malformed", providerStatusCode: top, taskId: null };
  const taskId = typeof task.id === "string" && task.id.length > 0 && task.id.length <= 120 ? task.id : null;
  const status = finite(task.status_code);
  if (status === null) return { ok: false, reason: "malformed", providerStatusCode: top, taskId };
  if (status !== 20000) return { ok: false, reason: "provider-refused", providerStatusCode: status, taskId };
  const cost = finite(task.cost) ?? finite(body.cost);
  if (cost === null || cost < 0) return { ok: false, reason: "malformed", providerStatusCode: status, taskId };
  const result = Array.isArray(task.result) ? task.result : null;
  if (result === null) return { ok: false, reason: "malformed", providerStatusCode: status, taskId };

  const organic: SerpRow[] = [];
  const questions: SerpRow[] = [];
  const related: SerpRow[] = [];
  const seenUrls = new Set<string>();
  const seenQuestions = new Set<string>();
  const seenRelated = new Set<string>();
  let items = 0;

  for (const block of result) {
    if (!isObject(block) || !Array.isArray(block.items)) continue;
    for (const item of block.items) {
      if (!isObject(item)) return { ok: false, reason: "malformed", providerStatusCode: status, taskId };
      items += 1;
      if (item.type === "organic") {
        const url = httpUrl(item.url);
        const title = clean(item.title, MAX_TITLE);
        if (url === null || title === null || seenUrls.has(url) || organic.length >= SERP_DEPTH) continue;
        const domain = domainOf(item, url);
        if (domain === null) continue;
        seenUrls.add(url);
        organic.push({ type: "organic", rank: organic.length + 1, url, domain, title, snippet: clean(item.description, MAX_SNIPPET) });
      } else if (item.type === "people_also_ask" && Array.isArray(item.items)) {
        for (const element of item.items) {
          if (!isObject(element) || questions.length >= MAX_QUESTIONS) continue;
          const title = clean(element.title, MAX_TITLE);
          if (title === null || seenQuestions.has(title.toLowerCase())) continue;
          seenQuestions.add(title.toLowerCase());
          const expanded = Array.isArray(element.expanded_element) ? element.expanded_element.find(isObject) : undefined;
          questions.push({ type: "people-also-ask", rank: questions.length + 1, title, url: expanded === undefined ? null : httpUrl(expanded.url) });
        }
      } else if (item.type === "related_searches" && Array.isArray(item.items)) {
        for (const query of item.items) {
          const title = clean(query, MAX_TITLE);
          if (title === null || related.length >= MAX_RELATED || seenRelated.has(title.toLowerCase())) continue;
          seenRelated.add(title.toLowerCase());
          related.push({ type: "related-search", rank: related.length + 1, title });
        }
      }
    }
  }

  return { ok: true, rows: [...organic, ...questions, ...related], costUsd: Math.round(cost * 10_000) / 10_000, taskId, items, providerStatusCode: status };
}
