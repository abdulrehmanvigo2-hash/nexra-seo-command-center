import type { AiPlatformVisibility } from "@/types/seo";

/**
 * Answer presence across the generative engines that are tracked.
 *
 * Demo fixtures. The portfolio-level "AI Visibility Score" in `overview.ts` is
 * the weighted roll-up of these six platform scores.
 */
export const AI_VISIBILITY: readonly AiPlatformVisibility[] = [
  {
    id: "chatgpt",
    platform: "ChatGPT",
    visibilityScore: 72,
    mentions: 1840,
    citations: 412,
    trend: { value: 11.4 },
    status: "strong",
  },
  {
    id: "perplexity",
    platform: "Perplexity",
    visibilityScore: 68,
    mentions: 960,
    citations: 538,
    trend: { value: 18.2 },
    status: "strong",
  },
  {
    id: "google-ai-overviews",
    platform: "Google AI Overviews",
    visibilityScore: 64,
    mentions: 2410,
    citations: 287,
    trend: { value: 6.1 },
    status: "growing",
  },
  {
    id: "claude",
    platform: "Claude",
    visibilityScore: 57,
    mentions: 720,
    citations: 194,
    trend: { value: 9.7 },
    status: "growing",
  },
  {
    id: "gemini",
    platform: "Gemini",
    visibilityScore: 49,
    mentions: 634,
    citations: 121,
    trend: { value: -4.3 },
    status: "at-risk",
  },
  {
    id: "copilot",
    platform: "Microsoft Copilot",
    visibilityScore: 38,
    mentions: 305,
    citations: 76,
    trend: { value: 2.5 },
    status: "emerging",
  },
];
