/**
 * A complete, valid article for the C1 contract tests, built fresh on every
 * call so a test can change its copy freely. Plain data, no product record:
 * none of it exists anywhere but here.
 */

export function completeArticle(): Record<string, unknown> {
  return {
    topic: "Missed-call text-back for service businesses",
    searchIntent: "commercial",
    slug: "missed-call-text-back",
    title: "Missed-Call Text-Back: Answering Every Lead You Could Not Pick Up",
    metaTitle: "Missed-Call Text-Back for Service Businesses",
    metaDescription: "How an automatic text reply to missed calls keeps a lead talking until someone can call back.",
    excerpt: "An automatic text reply to a missed call keeps the lead in the conversation.",
    category: "Operations",
    keywords: ["missed call text back", "missed call automation"],
    lead: "A missed call is often a lead deciding where to go next.",
    introduction: ["This article explains what a text-back does and where it stops."],
    sections: [
      {
        id: "what-it-does",
        heading: "What a text-back does",
        paragraphs: ["It sends one text when a call is not answered.", "The text names the business and asks how it can help."],
        subsections: [{ id: "timing", heading: "Timing", paragraphs: ["The reply goes out within a minute."] }],
      },
      {
        id: "where-it-stops",
        heading: "Where it stops",
        paragraphs: ["It does not replace calling the lead back."],
        subsections: [],
      },
    ],
    faqs: [{ question: "Does the caller have to reply?", answer: "No. The text only opens the conversation." }],
    internalLinks: [{ path: "/services#automation", anchorText: "our automation services", sectionId: "where-it-stops" }],
    ctaTitle: "Stop losing missed calls",
    ctaBody: "Talk to us about setting up a text-back for your business.",
    topicDecision: "unset",
  };
}

export const SOURCE_REFERENCE = {
  draftId: "00000000-0000-4000-8000-00000000d001",
  version: 2,
  versionId: "00000000-0000-4000-8000-00000000e002",
  contentSha256: "a".repeat(64),
};
