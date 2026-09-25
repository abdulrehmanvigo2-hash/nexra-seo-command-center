import { CRAWL_SOURCE, type GroundingReader } from "@/lib/agent-runs/ai-executor";
import { readRunGrounding, type AgentRunReader } from "@/lib/agent-runs/run-grounding";
import { getTaskType } from "@/lib/agent-runs/task-types";
import { readLinkGrounding, type LinkGroundingReaders } from "@/lib/authority/link-grounding";
import { readArticleCheckGrounding, type ArticleCheckGroundingReaders } from "@/lib/content/articles/checks/grounding";
import { readDraftGrounding, type DraftGroundingReaders } from "@/lib/content/draft-grounding";
import { readFactCheckGrounding, type FactCheckGroundingReaders } from "@/lib/content/drafts/fact-check-grounding";
import { readComparisonGrounding, type ComparisonGroundingReaders } from "@/lib/crawl/comparison-grounding";
import { computeCrawlFindings } from "@/lib/crawl/findings/compute";
import { formatRecordedFindingsGrounding } from "@/lib/crawl/findings/director-grounding";
import { FINDINGS_LINK_LIMIT, formatCrawlFindingsGrounding, unavailableCrawlFindingsGrounding } from "@/lib/crawl/findings/grounding";
import { formatCrawlGrounding, readReviewableCrawl, type CrawlGroundingReader } from "@/lib/crawl/grounding";
import type { CrawlFindingsRead } from "@/lib/crawl/service";
import { readProjectGrounding, type ProjectGroundingReaders } from "@/lib/projects/grounding";
import { readEvidencePackGrounding, type EvidencePackReaders } from "@/lib/research/evidence-pack";
import {
  readSearchConsoleGrounding,
  type SearchConsoleReportReader,
} from "@/lib/search-console/grounding";
import type { SnapshotHistoryComparison } from "@/lib/search-console/history/compare";
import { formatSearchConsoleHistory, type HistoryInput } from "@/lib/search-console/history/grounding";
import { formatKeywordGrounding } from "@/lib/search-console/keywords/grounding";
import type { KeywordIntelligenceInput } from "@/lib/search-console/keywords/inventory";
import { formatQueryPageGrounding } from "@/lib/search-console/query-pages/grounding";
import type { QueryPageInput } from "@/lib/search-console/query-pages/intelligence";

/**
 * Which evidence a task is allowed to see, decided by what its task type
 * declares rather than by its name.
 *
 * The runtime reads the evidence, not the executor, which reaches no system of
 * its own. A task type declaring `evidence: "crawl"` is given one crawl this
 * product recorded (`crawl-review`, `on-page-review`); one declaring
 * `evidence: "search-console"` is given the Search Console report for the
 * run's own project and the window in its input (`search-query-review`); one
 * declaring `evidence: "agent-run"` is given one other agent's completed,
 * grounded review from the same project (`priority-review`); one declaring
 * `evidence: "project"` is given the run's own stored project record and an
 * inventory of the evidence this product holds for it (`intake-review`); one
 * declaring `evidence: "competitor-comparison"` is given the newest recorded
 * crawl of the run's own site and the newest recorded crawl of one
 * competitor its stored record lists (`competitor-comparison-review`); one
 * declaring `evidence: "evidence-pack"` is given the records this product
 * holds for the run's own project (`evidence-pack-review`); every other task
 * gets none. In every case the project is the run's: a crawl id
 * or a source run id is checked against it, a report is fetched for it, a
 * record is read by it, and a competitor domain is matched against its own
 * record, so nothing a caller writes can reach another client's data.
 *
 * Pure apart from the readers it is handed, so the same dispatch runs against
 * Supabase and Google in the application and in-memory fakes in a test.
 */
/** The stored-snapshot comparison for one project, or null when this deployment keeps no snapshots. */
export type SearchConsoleHistoryReader = (projectId: string) => Promise<SnapshotHistoryComparison | null>;

/** The stored query × page intelligence for one project (P4c), or null when this deployment keeps no pairs. */
export type SearchConsoleQueryPageReader = (projectId: string) => Promise<QueryPageInput | null>;

/** The observed query inventory for one project (M4), or null when this deployment keeps no snapshots. */
export type SearchConsoleKeywordReader = (projectId: string) => Promise<KeywordIntelligenceInput | null>;

/** The findings recorded for one of the project's own crawls (T3), read by project and crawl id, never recomputed. */
export type CrawlFindingsReader = (projectId: string, crawlId: string) => Promise<CrawlFindingsRead>;

export type TaskGroundingReaders = {
  readonly crawls: CrawlGroundingReader;
  readonly searchConsole: SearchConsoleReportReader;
  /**
   * `search-console` tasks, after the live report: the run's own project's
   * stored snapshot history, appended as a second block. Never a replacement
   * for the live report, and never a refusal: history that is missing,
   * insufficient or unreadable is stated in one bounded note.
   */
  readonly searchConsoleHistory: SearchConsoleHistoryReader;
  /**
   * `search-console` tasks, after the history: the run's own project's
   * stored query × page evidence (P4c), appended as a third block only when
   * observed pair evidence exists. Absent, or answering null, means no
   * block; never a refusal and never a replacement for the live report.
   */
  readonly searchConsoleQueryPages?: SearchConsoleQueryPageReader;
  /**
   * `search-query-review` only, after the pairs: the run's own project's
   * observed query inventory (M4), appended as a fourth block only when an
   * inventory exists. Absent, or answering null, means no block; never a
   * refusal and never a replacement for the live report.
   */
  readonly searchConsoleKeywords?: SearchConsoleKeywordReader;
  /** The run store itself satisfies this; a test hands in a map. */
  readonly runs: AgentRunReader;
  /**
   * `agent-run` tasks, after the quoted upstream review: when that review
   * was written over a crawl this product recorded, the findings recorded
   * for that crawl, appended as a second block. Never a refusal: findings
   * that are unavailable, not recorded or not the project's are stated in
   * one bounded note, and nothing is inferred in their place.
   */
  readonly crawlFindings: CrawlFindingsReader;
  /** The project repository, crawl service, Search Console and run store, each read by project id. */
  readonly projects: ProjectGroundingReaders;
  /** The project repository and crawl service, for the two crawls a comparison reads. */
  readonly comparison: ComparisonGroundingReaders;
  /** The project repository, crawl service and Search Console, for the records an evidence pack collects. */
  readonly evidencePack: EvidencePackReaders;
  /** `content-draft` tasks: one completed plan by id, and the pack it was written over, re-read. */
  readonly draft: DraftGroundingReaders;
  /** `crawl-links` tasks: one crawl record, and the edges it recorded, read bounded. */
  readonly links: LinkGroundingReaders;
  /** `draft-version` tasks: one saved draft version by project, id and number, and the pack it rests on, re-read. */
  readonly factCheck: FactCheckGroundingReaders;
  /** `article-unit` tasks: one article version by project, id and number, its units regenerated, and the pack, re-read. */
  readonly articleCheck: ArticleCheckGroundingReaders;
};

export function createTaskGrounding(readers: TaskGroundingReaders): GroundingReader {
  return async (task) => {
    const definition = getTaskType(task.taskType);
    if (!definition) return { ok: true, grounding: null };

    switch (definition.evidence) {
      case "none":
        return { ok: true, grounding: null };

      case "crawl": {
        const crawlId = task.input.crawlId;
        if (typeof crawlId !== "string") return { ok: false, reason: "crawl-id-missing" };

        // The run's own project and its own domain: a crawl of another project
        // or of a competitor's site is refused before a page is described.
        const eligible = await readReviewableCrawl(readers.crawls, {
          crawlId,
          projectId: task.project.id,
          projectDomain: task.project.domain,
        });
        if (!eligible.ok) return { ok: false, reason: eligible.reason };
        const crawlGrounding = formatCrawlGrounding(eligible.crawl, eligible.pages);

        // The two reviews of the project's own pages also get the fixed
        // rules' findings over the same eligible crawl, appended after the
        // crawl evidence. The edges come through the one bounded link read;
        // if that read fails the crawl evidence stands alone and says so.
        if (task.taskType !== "crawl-review" && task.taskType !== "on-page-review") {
          return { ok: true, grounding: { text: crawlGrounding.text, summary: { ...crawlGrounding.summary }, source: CRAWL_SOURCE } };
        }
        let findings;
        try {
          const links = await readers.links.links.listLinks(eligible.crawl.id, FINDINGS_LINK_LIMIT);
          const report = computeCrawlFindings({ crawl: eligible.crawl, pages: eligible.pages, links });
          findings = formatCrawlFindingsGrounding(report, { read: links.length, cut: links.length >= FINDINGS_LINK_LIMIT });
        } catch {
          findings = unavailableCrawlFindingsGrounding();
        }

        return {
          ok: true,
          grounding: {
            text: `${crawlGrounding.text}\n\n${findings.text}`,
            summary: { ...crawlGrounding.summary, findings: findings.summary },
            source: CRAWL_SOURCE,
          },
        };
      }

      case "search-console": {
        const result = await readSearchConsoleGrounding(readers.searchConsole, {
          projectId: task.project.id,
          rangeId: task.input.range,
        });
        if (!result.ok) return { ok: false, reason: result.reason };

        // The live report is the evidence; stored history is appended after
        // it for the run's own project. A history read that fails leaves the
        // live report standing and says so, rather than failing the run.
        let history: HistoryInput;
        try {
          history = (await readers.searchConsoleHistory(task.project.id)) ?? { available: false, reason: "not-kept" };
        } catch {
          history = { available: false, reason: "read-failed" };
        }
        const audience = task.taskType === "performance-review" ? "analytics" : "keyword";
        const historyGrounding = formatSearchConsoleHistory(history, audience);

        // Stored query × page pairs (P4c), appended after the history and
        // only when observed pair evidence exists; a missing reader, an
        // empty store or a failed read adds no block and never fails the run.
        let queryPages: QueryPageInput;
        try {
          queryPages = (await readers.searchConsoleQueryPages?.(task.project.id)) ?? { available: false, reason: "not-kept" };
        } catch {
          queryPages = { available: false, reason: "read-failed" };
        }
        const pairGrounding = formatQueryPageGrounding(queryPages, audience);

        // The observed query inventory (M4), appended last and for the
        // Keyword & Search Intent agent only: the performance review
        // measures figures and gets no lexical hints. A missing reader, a
        // deployment that keeps no snapshots or a failed read adds no block
        // and never fails the run.
        let keywords: KeywordIntelligenceInput = { available: false, reason: "not-kept" };
        if (task.taskType === "search-query-review") {
          try {
            keywords = (await readers.searchConsoleKeywords?.(task.project.id)) ?? { available: false, reason: "not-kept" };
          } catch {
            keywords = { available: false, reason: "read-failed" };
          }
        }
        const keywordGrounding = formatKeywordGrounding(keywords);

        return {
          ok: true,
          grounding: {
            text: `${result.grounding.text}\n\n${historyGrounding.text}${pairGrounding.text === null ? "" : `\n\n${pairGrounding.text}`}${keywordGrounding.text === null ? "" : `\n\n${keywordGrounding.text}`}`,
            summary: { ...result.grounding.summary, history: historyGrounding.summary, queryPages: pairGrounding.summary, keywords: keywordGrounding.summary },
            source: result.grounding.source,
          },
        };
      }

      case "agent-run": {
        const sourceRunId = task.input.sourceRunId;
        if (typeof sourceRunId !== "string") return { ok: false, reason: "source-run-id-missing" };

        const result = await readRunGrounding(readers.runs, { sourceRunId, projectId: task.project.id });
        if (!result.ok) return { ok: false, reason: result.reason };

        // The upstream review was written over a crawl this product recorded
        // when its own evidence summary names one. The findings recorded for
        // that crawl (T3) are then read for the Director's own project — the
        // same project the upstream run was just checked against — and
        // appended after the review as observations beside an inference. A
        // review written over anything else gets no second block.
        const upstreamCrawlId = result.grounding.summary.upstreamEvidence?.crawlId;
        if (typeof upstreamCrawlId !== "string") {
          return {
            ok: true,
            grounding: {
              text: result.grounding.text,
              summary: { ...result.grounding.summary },
              source: result.grounding.source,
            },
          };
        }
        const recorded = formatRecordedFindingsGrounding(upstreamCrawlId, await readers.crawlFindings(task.project.id, upstreamCrawlId));
        return {
          ok: true,
          grounding: {
            text: `${result.grounding.text}\n\n${recorded.text}`,
            summary: { ...result.grounding.summary, recordedFindings: recorded.summary },
            source: result.grounding.source,
          },
        };
      }

      case "project": {
        // No input is read: the project is the run's own, and nothing else.
        const result = await readProjectGrounding(readers.projects, { projectId: task.project.id });
        if (!result.ok) return { ok: false, reason: result.reason };

        return {
          ok: true,
          grounding: {
            text: result.grounding.text,
            summary: { ...result.grounding.summary },
            source: result.grounding.source,
          },
        };
      }

      case "evidence-pack": {
        // No input is read: the project is the run's own, and every record
        // is found by the server from it.
        const result = await readEvidencePackGrounding(readers.evidencePack, { projectId: task.project.id });
        if (!result.ok) return { ok: false, reason: result.reason };

        return {
          ok: true,
          grounding: {
            text: result.grounding.text,
            summary: { ...result.grounding.summary },
            source: result.grounding.source,
          },
        };
      }

      case "crawl-links": {
        const crawlId = task.input.crawlId;
        if (typeof crawlId !== "string") return { ok: false, reason: "crawl-id-missing" };

        // The run's own project and its own domain, as for the crawl reviews:
        // another project's crawl or a competitor's site is refused before an
        // edge is read.
        const result = await readLinkGrounding(readers.links, {
          crawlId,
          projectId: task.project.id,
          projectDomain: task.project.domain,
        });
        if (!result.ok) return { ok: false, reason: result.reason };

        return {
          ok: true,
          grounding: {
            text: result.grounding.text,
            summary: { ...result.grounding.summary },
            source: result.grounding.source,
          },
        };
      }

      case "content-draft": {
        // The input names a completed content plan and the operator's chosen
        // section; the project is the run's own, and the reader checks the
        // plan against it before a word of the plan is formatted, resolves
        // the section in the plan's own outline, then re-reads the records it
        // was written over. A run queued before sections were chosen carries
        // no sectionIndex and is refused, never given the first section.
        const planRunId = task.input.planRunId;
        if (typeof planRunId !== "string") return { ok: false, reason: "plan-run-id-missing" };
        const result = await readDraftGrounding(readers.draft, { planRunId, projectId: task.project.id, sectionIndex: task.input.sectionIndex });
        if (!result.ok) return { ok: false, reason: result.reason };

        return {
          ok: true,
          grounding: {
            text: result.grounding.text,
            summary: { ...result.grounding.summary, records: { ...result.grounding.summary.records } },
            source: result.grounding.source,
          },
        };
      }

      case "draft-version": {
        // The input names a draft and a version number; the project is the
        // run's own, and the reader finds the draft by project and id
        // together, then that exact version, before a word of it is quoted.
        const draftId = task.input.draftId;
        const version = task.input.version;
        if (typeof draftId !== "string") return { ok: false, reason: "draft-id-missing" };
        if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
          return { ok: false, reason: "version-missing" };
        }
        const result = await readFactCheckGrounding(readers.factCheck, { draftId, version, projectId: task.project.id });
        if (!result.ok) return { ok: false, reason: result.reason };

        return {
          ok: true,
          grounding: {
            text: result.grounding.text,
            summary: {
              ...result.grounding.summary,
              recordPaths: [...result.grounding.summary.recordPaths],
              records: { ...result.grounding.summary.records },
            },
            source: result.grounding.source,
          },
        };
      }

      case "article-unit": {
        // The input names an article, a version number, that version's row
        // id and a unit index; the project is the run's own, and the reader
        // finds the article by project and id together, the exact version,
        // then regenerates the units from its stored text and resolves the
        // index — refusing, never substituting another unit — before a word
        // of it is quoted.
        const articleId = task.input.articleId;
        const articleVersion = task.input.articleVersion;
        const articleVersionId = task.input.articleVersionId;
        if (typeof articleId !== "string") return { ok: false, reason: "article-id-missing" };
        if (typeof articleVersion !== "number" || !Number.isInteger(articleVersion) || articleVersion < 1) {
          return { ok: false, reason: "version-missing" };
        }
        if (typeof articleVersionId !== "string") return { ok: false, reason: "version-id-missing" };
        const result = await readArticleCheckGrounding(readers.articleCheck, {
          projectId: task.project.id,
          articleId,
          articleVersion,
          articleVersionId,
          unitIndex: task.input.unitIndex,
        });
        if (!result.ok) return { ok: false, reason: result.reason };

        return {
          ok: true,
          grounding: {
            text: result.grounding.text,
            summary: {
              ...result.grounding.summary,
              recordPaths: [...result.grounding.summary.recordPaths],
              records: { ...result.grounding.summary.records },
            },
            source: result.grounding.source,
          },
        };
      }

      case "competitor-comparison": {
        // The input names a competitor domain; the project is the run's own,
        // and the reader matches the domain against that project's stored
        // record before either crawl is found.
        const result = await readComparisonGrounding(readers.comparison, {
          projectId: task.project.id,
          competitorDomain: task.input.competitorDomain,
        });
        if (!result.ok) return { ok: false, reason: result.reason };

        return {
          ok: true,
          grounding: {
            text: result.grounding.text,
            summary: { ...result.grounding.summary },
            source: result.grounding.source,
          },
        };
      }
    }
  };
}
