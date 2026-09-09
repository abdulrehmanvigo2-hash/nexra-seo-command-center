import {
  clamp,
  deltaFor,
  jitter,
  randInt,
  round,
  scoreFor,
  volumeFor,
} from "@/lib/mock/dashboard/core";
import type {
  AiEngineRow,
  AiEngineStatus,
  AiVisibilitySnapshot,
  DashboardProject,
  DateRange,
} from "@/types/dashboard";

/**
 * Visibility inside AI answers and generative engines — the surface this
 * product is built around, so it gets its own snapshot rather than being
 * folded into organic reporting.
 *
 * Coverage is answer presence across a tracked prompt set; citations are the
 * subset where the brand is named as a source. Both derive from the project's
 * health, so the engine table moves with the rest of the dashboard.
 */

type EngineSeed = {
  readonly id: string;
  readonly engine: string;
  /** Coverage before the project's health offset is applied. */
  readonly baseCoverage: number;
  /** Citations per coverage point, which differs sharply by engine. */
  readonly citationRatio: number;
  readonly mentionRatio: number;
  readonly momentum: number;
};

const ENGINES: readonly EngineSeed[] = [
  { id: "chatgpt", engine: "ChatGPT", baseCoverage: 72, citationRatio: 5.7, mentionRatio: 25.6, momentum: 11.4 },
  { id: "perplexity", engine: "Perplexity", baseCoverage: 68, citationRatio: 7.9, mentionRatio: 14.1, momentum: 18.2 },
  { id: "google-ai-overviews", engine: "Google AI Overviews", baseCoverage: 64, citationRatio: 4.5, mentionRatio: 37.7, momentum: 6.1 },
  { id: "claude", engine: "Claude", baseCoverage: 57, citationRatio: 3.4, mentionRatio: 12.6, momentum: 9.7 },
  { id: "gemini", engine: "Gemini", baseCoverage: 49, citationRatio: 2.5, mentionRatio: 12.9, momentum: -4.3 },
  { id: "copilot", engine: "Microsoft Copilot", baseCoverage: 38, citationRatio: 2.0, mentionRatio: 8.0, momentum: 2.5 },
];

function gradeEngine(coverage: number, momentum: number): AiEngineStatus {
  if (momentum < 0) return "at-risk";
  if (coverage >= 65) return "strong";
  if (coverage >= 45) return "growing";
  return "emerging";
}

export function buildAiVisibilitySnapshot(
  project: DashboardProject,
  range: DateRange,
): AiVisibilitySnapshot {
  const windowScale = Math.max(0.4, range.days / 30);
  const scale = project.portfolio ? 1 : project.scale * 2.2;

  const engines: readonly AiEngineRow[] = ENGINES.map((engine, index) => {
    const coverage = round(
      clamp(
        engine.baseCoverage + project.healthOffset * 0.7 + jitter(project.seed, index + 81, 3),
        4,
        98,
      ),
      0,
    );
    const momentum = round(
      engine.momentum + deltaFor(project, range, index + 82, 0, 3.4),
      1,
    );

    return {
      id: `${project.id}-${engine.id}`,
      engine: engine.engine,
      coverage,
      citations: Math.max(
        1,
        Math.round(coverage * engine.citationRatio * scale * windowScale ** 0.7),
      ),
      mentions: Math.max(
        1,
        Math.round(coverage * engine.mentionRatio * scale * windowScale ** 0.7),
      ),
      trend: { value: momentum },
      status: gradeEngine(coverage, momentum),
    };
  });

  const totalPages = volumeFor(project, 4_820, 88);
  const eligibleShare = clamp(0.38 + project.healthOffset / 140, 0.12, 0.82);

  return {
    score: scoreFor(project, 61, 5),
    trend: { value: deltaFor(project, range, 89, 8.4, 5.2) },
    citationPresence: round(
      clamp(31.4 + project.healthOffset * 0.62 + jitter(project.seed, 90, 2.4), 4, 88),
      1,
    ),
    brandMentions: engines.reduce((carry, engine) => carry + engine.mentions, 0),
    brandMentionsTrend: { value: deltaFor(project, range, 91, 12.1, 6.8) },
    answerCoverage: round(
      engines.reduce((carry, engine) => carry + engine.coverage, 0) / engines.length,
      1,
    ),
    entityStrength: scoreFor(project, 58, 6),
    eligiblePages: Math.round(totalPages * eligibleShare),
    totalPages,
    opportunities: randInt(project.seed, 92, 18, 210),
    engines,
  };
}
