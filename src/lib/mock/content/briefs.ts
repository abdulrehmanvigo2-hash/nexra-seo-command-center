import { clamp, daysBefore, randInt } from "@/lib/mock/dashboard/core";
import { PROJECTS } from "@/lib/mock/projects/roster";
import { getKeywordRecord } from "@/lib/mock/keywords";
import { FORMAT_META } from "@/lib/mock/content/meta";
import { getContentRecord, getContentRecords } from "@/lib/mock/content/records";
import type { KeywordRecord } from "@/types/keyword";
import type {
  BriefSection,
  BriefSource,
  ContentBrief,
  ContentRecord,
  KeywordIntent,
} from "@/types/content";

/**
 * The instruction a writer works from.
 *
 * A brief is not authored either. It is assembled from what the canonical
 * layers already establish: the page's own keywords decide the outline and the
 * word target, the ones phrased as questions become the questions the piece
 * has to answer, the project's own competitor set becomes the pages to beat,
 * and the cluster supplies the topic the entities hang off.
 *
 * That is what keeps a brief honest. Every heading in an outline is there
 * because a keyword asked for it, and every competitor named is one the
 * keyword layer already says out-ranks us on this query — nothing in a brief
 * is invented to make it look complete.
 *
 * A piece with no keyword mapped to it gets no brief, because there would be
 * nothing to write the brief against. That is a finding, and the workspace
 * says so rather than generating an empty document.
 */

// ---------------------------------------------------------------------------
// Copy that varies by intent and format
// ---------------------------------------------------------------------------

const AUDIENCE: Record<KeywordIntent, string> = {
  informational:
    "Someone trying to understand the topic well enough to make a decision later.",
  commercial:
    "Someone actively comparing options and close to choosing one.",
  transactional: "Someone ready to act, who needs the last objection removed.",
  local: "Someone looking for a provider near them, usually on a phone.",
  navigational: "Someone who already knows the brand and wants a specific page.",
  mixed:
    "A split audience: some are still learning, some are ready to buy on the same query.",
};

const INTENT_NOTE: Record<KeywordIntent, string> = {
  informational:
    "Answer the question in the first hundred words, then earn the rest of the read.",
  commercial:
    "Reach a recommendation. A comparison that refuses to choose sends the reader back to the results page.",
  transactional:
    "Keep it short and remove friction. Depth here costs conversions rather than earning them.",
  local:
    "Lead with the place, the hours, and how to get there. Everything else is secondary.",
  navigational:
    "The reader knows what they want. Get them to it in one click.",
  mixed:
    "Serve the question first and the decision second, on the same page.",
};

const CTA: Record<KeywordIntent, string> = {
  informational: "Link through to the comparison page for readers ready to choose.",
  commercial: "Primary call to action: start the comparison or request a quote.",
  transactional: "Primary call to action: complete the application or add to basket.",
  local: "Primary call to action: book an appointment at this location.",
  navigational: "Primary call to action: sign in or open the account dashboard.",
  mixed: "Offer both: a deeper explainer, and a direct next step for the decided.",
};

/**
 * Source types the Research & Evidence agent attaches, by what a topic needs.
 *
 * Templates rather than a fixed list: the topic is filled in from the cluster,
 * so a brief cites something relevant to it rather than a generic placeholder.
 */
const SOURCE_TEMPLATES: readonly {
  readonly kind: BriefSource["kind"];
  readonly label: (topic: string, market: string) => string;
  readonly note: string;
}[] = [
  {
    kind: "market-data",
    label: (topic) => `${topic} market sizing, 2026`,
    note: "Use for the headline figures. Cite the year in the sentence, not just the link.",
  },
  {
    kind: "study",
    label: (topic) => `Independent study on ${topic.toLowerCase()} outcomes`,
    note: "Supports the central claim. One direct quotation is enough.",
  },
  {
    kind: "standard",
    label: (topic) => `Published standard covering ${topic.toLowerCase()}`,
    note: "Name the standard explicitly — it is one of the entities this topic expects.",
  },
  {
    kind: "guidance",
    label: (_topic, market) => `Regulator guidance for ${market}`,
    note: "Check this before publishing; the wording constrains what can be claimed.",
  },
  {
    kind: "internal",
    label: () => "Internal performance data",
    note: "Anonymised. Clear the specific figures with the client before they appear.",
  },
];

// ---------------------------------------------------------------------------
// Outline
// ---------------------------------------------------------------------------

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * The outline, built from the keywords the piece has to carry.
 *
 * The opening section always exists because every format needs an answer near
 * the top. After that, each secondary keyword earns its own section, the
 * question keywords collect into one block, and the format decides what closes
 * the piece.
 */
function outlineFor(
  record: ContentRecord,
  primary: KeywordRecord,
  secondary: readonly KeywordRecord[],
  questions: readonly string[],
  wordTarget: number,
): readonly BriefSection[] {
  const sections: BriefSection[] = [];
  const push = (
    heading: string,
    level: 2 | 3,
    purpose: string,
    keywords: readonly string[],
    share: number,
  ) =>
    sections.push({
      id: `${record.id}--section-${sections.length + 1}`,
      heading,
      level,
      purpose,
      keywords,
      wordTarget: Math.round(wordTarget * share),
    });

  push(
    record.format === "comparison"
      ? "The short answer"
      : `What ${primary.keyword} means`,
    2,
    "A 40-60 word self-contained answer that a generated result can quote verbatim.",
    [primary.keyword],
    0.08,
  );

  switch (record.format) {
    case "comparison":
      push(
        "How the options were compared",
        2,
        "State the criteria before the verdict, so the recommendation reads as reasoned.",
        [],
        0.12,
      );
      break;
    case "landing":
    case "product":
      push(
        "What you get",
        2,
        "The offer in concrete terms — specifications, inclusions, and price.",
        [],
        0.18,
      );
      break;
    case "location":
      push(
        "Finding us",
        2,
        "Address, hours, transport, and parking. This is what the local pack rewards.",
        [],
        0.2,
      );
      break;
    case "tool":
      push(
        "How to use the calculator",
        2,
        "One short paragraph above the tool; everything else goes below it.",
        [],
        0.15,
      );
      break;
    default:
      push(
        "Why this matters",
        2,
        "Frame the problem in the reader's terms before explaining the solution.",
        [],
        0.12,
      );
  }

  for (const keyword of secondary.slice(0, 4)) {
    push(
      sentenceCase(keyword.keyword),
      2,
      `Covers a secondary target worth ${keyword.volume.toLocaleString("en-US")} searches a month.`,
      [keyword.keyword],
      0.14,
    );
  }

  if (questions.length > 0) {
    push(
      "Common questions",
      2,
      "One question per sub-heading, answered in two or three sentences each.",
      [],
      0.14,
    );
    for (const question of questions.slice(0, 3)) {
      push(
        sentenceCase(question),
        3,
        "Answer directly in the first sentence, then qualify.",
        [],
        0.04,
      );
    }
  }

  push(
    record.format === "comparison" ? "The recommendation" : "Next steps",
    2,
    CTA[primary.intent],
    [],
    0.08,
  );

  return sections;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function keywordsOf(record: ContentRecord): readonly KeywordRecord[] {
  return record.keywordIds
    .map((id) => getKeywordRecord(id))
    .filter((entry): entry is KeywordRecord => entry !== undefined);
}

function buildBrief(record: ContentRecord): ContentBrief | null {
  if (record.primaryKeywordId === null) return null;

  const keywords = keywordsOf(record);
  const primary = keywords.find((entry) => entry.id === record.primaryKeywordId);
  if (!primary) return null;

  const project = PROJECTS.find((entry) => entry.id === record.projectId);
  const secondary = keywords
    .filter((entry) => entry.id !== primary.id)
    .sort((a, b) => b.volume - a.volume);

  // Questions the result page is already asking. Where the keyword set has
  // none phrased as a question, the brief says so rather than inventing three.
  const questions = keywords
    .filter((entry) => entry.ai.questionFormat)
    .map((entry) =>
      entry.keyword.endsWith("?") ? entry.keyword : `${entry.keyword}?`,
    );

  // Difficulty buys length: a contested query needs more than an easy one.
  const wordTarget = Math.round(
    clamp(
      FORMAT_META[record.format].wordTarget * (0.8 + primary.difficulty / 160),
      400,
      4_200,
    ) / 50,
  ) * 50;

  const competitors = [
    ...new Map(
      keywords
        .map((entry) => entry.competitor)
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .map((entry) => [entry.domain, entry]),
    ).values(),
  ]
    .sort((a, b) => a.position - b.position)
    .slice(0, 4);

  const topic = record.clusterName;
  const market = project?.market ?? "the target market";

  const sourceCount = randInt(record.seed, 121, 2, 4);
  const sources: readonly BriefSource[] = SOURCE_TEMPLATES.slice(
    0,
    sourceCount,
  ).map((template, index) => ({
    id: `${record.id}--source-${index + 1}`,
    label: template.label(topic, market),
    kind: template.kind,
    note: template.note,
  }));

  const entities = [
    ...new Set(
      [
        topic,
        project?.industry ?? "",
        market,
        FORMAT_META[record.format].schema.split(" + ")[0],
        ...competitors.map((entry) => entry.name),
      ].filter((entry) => entry.length > 0),
    ),
  ].slice(0, 7);

  const internalLinks = record.linksTo
    .map((id) => getContentRecord(id))
    .filter((entry): entry is ContentRecord => entry !== undefined)
    .slice(0, 4)
    .map((entry) => ({
      toId: entry.id,
      toTitle: entry.title,
      anchor: entry.primaryKeyword ?? entry.title.toLowerCase(),
    }));

  const stage = record.refresh?.stage ?? record.stage;

  return {
    id: `${record.id}--brief`,
    contentId: record.id,
    title: record.title,
    format: record.format,
    primaryKeyword: primary.keyword,
    primaryKeywordId: primary.id,
    intent: primary.intent,
    secondaryKeywords: secondary.slice(0, 8).map((entry) => ({
      id: entry.id,
      keyword: entry.keyword,
      volume: entry.volume,
    })),
    searchIntentNote: INTENT_NOTE[primary.intent],
    audience: AUDIENCE[primary.intent],
    angle:
      competitors.length > 0
        ? `Beat ${competitors[0].name}, who holds position ${competitors[0].position} on the primary query, by answering what their page leaves out.`
        : `Own the query outright — no tracked rival ranks meaningfully above us on it.`,
    wordTarget,
    outline: outlineFor(record, primary, secondary, questions, wordTarget),
    entities,
    questions,
    competitors,
    sources,
    internalLinks,
    callToAction: CTA[primary.intent],
    owner: record.owner,
    writer: record.writer,
    stage,
    dueAt:
      record.refresh?.dueAt ??
      (record.url === null
        ? daysBefore(-randInt(record.seed, 122, 4, 62))
        : daysBefore(-randInt(record.seed, 123, 20, 120))),
    updatedAt: record.updatedAt,
  };
}

let cache: readonly ContentBrief[] | null = null;

/** Every brief in the product, one per piece that has a keyword to aim at. */
export function getContentBriefs(): readonly ContentBrief[] {
  cache ??= getContentRecords()
    .map((record) => buildBrief(record))
    .filter((entry): entry is ContentBrief => entry !== null);
  return cache;
}

/** The brief for one piece, or null where no keyword is mapped to it. */
export function briefForContent(contentId: string): ContentBrief | null {
  return (
    getContentBriefs().find((entry) => entry.contentId === contentId) ?? null
  );
}

/**
 * The briefs an editor is actually working from.
 *
 * A brief attached to a healthy live page is a historical document; the ones
 * that matter are for pieces still to be written and pages queued for rework.
 */
export function getActiveBriefs(): readonly ContentBrief[] {
  const records = new Map(
    getContentRecords().map((record) => [record.id, record]),
  );

  return getContentBriefs().filter((brief) => {
    const record = records.get(brief.contentId);
    if (!record) return false;
    return record.url === null || record.refresh !== null;
  });
}
