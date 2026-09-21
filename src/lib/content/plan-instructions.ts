/**
 * What the Content Strategist is asked to produce from the records this
 * product holds — the first task for that agent, and the second task to read
 * the evidence pack block.
 *
 * The block is the one the Research & Evidence agent reads: the project's
 * newest own-site crawl, the default Search Console window where connected,
 * and which competitor crawls exist. It is read through the same reader,
 * unchanged, because a second question over the same records is one
 * declaration in the task registry, not a second reader (`@/lib/agent-runs/
 * task-grounding`). Nothing here consumes an earlier agent's output: the
 * pack's supported-claims list remains the authority a Writer will read for
 * factual claims, and this plan says so in a fixed line.
 *
 * The plan is for one page, in seven fixed sections, and every line that
 * states a recorded fact ends with the record it rests on — `[crawl /path]`
 * or `[search console <window>]` — while every planned section that rests
 * on nothing ends with `[needs evidence]`. Intent is always an inference,
 * because Search Console records what was typed and clicked, never why, and
 * it is marked as one. The registry brief for this agent speaks of clusters,
 * topical maps and link graphs; none of those exist in the records, and the
 * instructions say so, so a model checking its work against that brief
 * cannot satisfy it by naming a cluster or a volume that no record holds.
 *
 * Every section is bounded in lines and words so that an answer at every
 * bound stays under 1,500 characters with ordinary words and under the
 * worker's 2,000-character ceiling with long ones, and the answer is told
 * what to cut first if it must cut.
 */

/** The line that keeps factual claims with the Research & Evidence pack, verbatim. */
export const CONTENT_PLAN_CLAIMS_LINE =
  "Factual claims in the draft come only from the Research & Evidence pack's supported list.";

/** The closing sentence, verbatim. */
export const CONTENT_PLAN_CLOSING =
  "This plan is a proposal over records this product holds; it names no volume, difficulty, ranking, traffic, backlink, authority, conversion or market figure, and every draft claim must carry a record tag.";

/** The seven headings, in order. */
export const CONTENT_PLAN_SECTIONS = [
  "PAGE AND GOAL",
  "INTENT AND QUERY",
  "TITLE AND H1 DIRECTION",
  "OUTLINE",
  "INTERNAL LINKS AND SCHEMA",
  "CLAIMS NOT PERMITTED",
  "NEXT OPERATOR ACTION",
] as const;

export const CONTENT_PLAN_INSTRUCTIONS = [
  "Plan exactly one page for this project from the records supplied with this task: the project's own site as this product's crawler read it, what Google Search Console reported where present, and which competitor crawls exist. Use only the supplied records; nothing else is known here.",
  "Answer in exactly seven sections, headed PAGE AND GOAL, INTENT AND QUERY, TITLE AND H1 DIRECTION, OUTLINE, INTERNAL LINKS AND SCHEMA, CLAIMS NOT PERMITTED, and NEXT OPERATOR ACTION. Keep the whole answer under 1,500 characters.",
  "PAGE AND GOAL: one line under 15 words naming one crawled path or new page, and what the page is for. INTENT AND QUERY: one line under 15 words beginning INFERENCE: with the intent, tied to a recorded query and ending [search console <window>], or stating not established.",
  "TITLE AND H1 DIRECTION: at most two lines under 12 words; a line stating a recorded fact ends with its tag, any other begins INFERENCE:. OUTLINE: at most four sections, one line each under 10 words, each ending with [crawl /path], [search console <window>] or [needs evidence].",
  "INTERNAL LINKS AND SCHEMA: at most two lines under 12 words naming only crawled paths and JSON-LD types the crawl recorded, each ending with a tag. CLAIMS NOT PERMITTED: at most two lines under 14 words naming what the records cannot support, then exactly this line: Factual claims in the draft come only from the Research & Evidence pack's supported list. NEXT OPERATOR ACTION: one line under 12 words, chosen only from: compile or refresh the evidence pack; run or re-run the site crawl; connect or verify Search Console; queue a named existing review.",
  "Never state or estimate keyword volume, difficulty, traffic potential, rankings beyond the Search Console average position, competitor positions, backlinks, authority, conversions, market share, or a cause. Name no page the crawl did not fetch, no audience fact the records lack, and no study, publication, citation, source or organisation. The crawl is a sample and the query list is Google's top rows. If the answer runs long, drop outline lines first, then the links lines; never a heading, the fixed claims line or the closing sentence.",
  `End with exactly this sentence: ${CONTENT_PLAN_CLOSING}`,
].join(" ");
