import type { Agent, AgentId } from "@/types/agent";

/**
 * The agent registry — the single source of truth for who the twelve agents
 * are (CLAUDE.md §13).
 *
 * Every module that names an agent reads from this file. The Command Center's
 * operations board derives its cards from these records, each project's team
 * is a subset of them, and the Agents module renders them directly. There is
 * no second list of agent names, disciplines, or pipeline positions anywhere
 * in the product.
 *
 * Like the client roster it is written beside, this file deliberately imports
 * nothing from the fixture builders: those import *this*, so the dependency
 * runs in one direction and no cycle is possible. It holds no timestamps and
 * no derived numbers — only what an agent is.
 *
 * `stage` is the position in the orchestration loop, and `upstream` /
 * `downstream` spell the same sequence out as edges. The loop closes:
 * Analytics & Learning hands back to the SEO Director, which re-prioritises
 * the next cycle rather than the work stopping at stage twelve.
 *
 * `outputBase` and `tasks` seed the operational fixtures. The agents are
 * mocked in this milestone — nothing here executes, and `brief` is an
 * operational summary written for the account team, not a system prompt
 * (CLAUDE.md §4).
 */

export const AGENT_REGISTRY: readonly Agent[] = [
  {
    id: "seo-director",
    name: "SEO Director",
    title: "Strategy and orchestration",
    description:
      "Owns the strategy for every account and decides what the rest of the team works on next.",
    responsibility:
      "Sets the plan, sequences the other agents, and arbitrates when two disciplines want the same sprint.",
    responsibilities: [
      "Set and revise the quarterly SEO strategy per project",
      "Sequence agent hand-offs so work arrives in a usable order",
      "Arbitrate between competing content, technical, and authority priorities",
      "Sign off the priority queue the Command Center surfaces",
    ],
    specialties: [
      "Strategy",
      "Prioritisation",
      "Orchestration",
      "Forecasting",
      "Stakeholder alignment",
    ],
    category: "leadership",
    stage: 1,
    icon: "command-center",
    initials: "SD",
    module: "/",
    upstream: ["analytics-learning"],
    downstream: ["project-manager"],
    outputLabel: "decisions",
    outputBase: 34,
    outputKinds: ["Strategy decision", "Roadmap update", "Priority ruling"],
    tasks: [
      "Re-prioritising the quarterly roadmap from the latest analytics feedback",
      "Arbitrating between the content and technical backlogs for next sprint",
      "Sequencing agent hand-offs for the new topical cluster rollout",
    ],
    brief: {
      mission:
        "Hold one coherent plan per project and make sure the eleven specialist agents are working on the highest-return thing available to them.",
      inputs: [
        "Project goals, market, and commercial targets",
        "The learning summary returned by Analytics at the end of each cycle",
        "Open issues and opportunities raised by every other agent",
      ],
      outputs: [
        "A ranked priority queue per project",
        "Sequenced work assignments across the team",
        "Written rulings when two disciplines contend for the same capacity",
      ],
      qualityChecks: [
        "Every priority traces back to a measured gap, not an assumption",
        "No agent is assigned work its upstream dependency has not delivered",
        "The plan stays inside the agreed scope for the engagement",
      ],
      escalation: [
        "A ruling would change the agreed scope or budget",
        "Two projects need the same capacity in the same window",
      ],
    },
    capacity: 6,
    defaultPriority: "critical",
    reviewRequired: false,
    seed: 3109,
  },
  {
    id: "project-manager",
    name: "Project Manager",
    title: "Scope, scheduling, delivery",
    description:
      "Turns the strategy into scheduled, tracked work and keeps delivery honest against the statement of work.",
    responsibility:
      "Owns intake, scope, scheduling, task state, and the delivery record for every project.",
    responsibilities: [
      "Run project intake and onboarding",
      "Break approved strategy into scheduled, owned tasks",
      "Track task state and flag slipping milestones early",
      "Reconcile delivered work against the agreed scope",
    ],
    specialties: [
      "Intake",
      "Scheduling",
      "Delivery tracking",
      "Scope control",
      "Reporting",
    ],
    category: "leadership",
    stage: 2,
    icon: "briefcase",
    initials: "PM",
    module: "/projects",
    upstream: ["seo-director"],
    downstream: ["market-intelligence"],
    outputLabel: "tasks",
    outputBase: 128,
    outputKinds: ["Delivery plan", "Sprint summary", "Scope change"],
    tasks: [
      "Confirming delivery scope and rescheduling two slipped milestones",
      "Reconciling the sprint board against the agreed statement of work",
      "Preparing the month-end delivery summary for client review",
    ],
    brief: {
      mission:
        "Make the plan executable: everything the Director decides becomes a dated, owned task with a visible state.",
      inputs: [
        "The Director's ranked priorities",
        "Agent capacity and current workload",
        "The statement of work and agreed milestones",
      ],
      outputs: [
        "A scheduled task board per project",
        "Milestone and delivery status",
        "Scope-change notes when the plan moves",
      ],
      qualityChecks: [
        "Every task has an owner, a due date, and a defined output",
        "No agent is scheduled beyond its stated concurrent capacity",
        "Delivered work is reconciled against scope before the month closes",
      ],
      escalation: [
        "A milestone will slip past the agreed delivery date",
        "Requested work falls outside the statement of work",
      ],
    },
    capacity: 10,
    defaultPriority: "high",
    reviewRequired: false,
    seed: 3221,
  },
  {
    id: "market-intelligence",
    name: "Market & Competitor Intelligence",
    title: "Landscape and share of voice",
    description:
      "Maps who else is competing for the same demand and where the account stands against them.",
    responsibility:
      "Owns the competitive picture: the rival set, their movement, and the project's share of voice.",
    responsibilities: [
      "Identify and profile the real SERP competitor set",
      "Track share-of-voice movement across the tracked keyword set",
      "Flag new entrants and rivals gaining ground",
      "Surface positioning gaps the content plan can exploit",
    ],
    specialties: [
      "SERP analysis",
      "Share of voice",
      "Competitor profiling",
      "Market sizing",
      "Positioning",
    ],
    category: "intelligence",
    stage: 3,
    icon: "competitors",
    initials: "MI",
    module: "/competitors",
    upstream: ["project-manager"],
    downstream: ["keyword-intent"],
    outputLabel: "reports",
    outputBase: 18,
    outputKinds: [
      "Competitor report",
      "Share-of-voice study",
      "Market landscape",
    ],
    tasks: [
      "Mapping the SERP competitor set for the highest-value cluster",
      "Tracking a rival's share-of-voice gain across 240 shared terms",
      "Profiling two new entrants that appeared in the top ten this month",
    ],
    brief: {
      mission:
        "Answer who the project is actually competing with, term by term, and where that competition is moving.",
      inputs: [
        "The project's tracked keyword set and target market",
        "SERP results for the highest-value clusters",
        "Historical visibility for the project and its rivals",
      ],
      outputs: [
        "A ranked competitor set with visibility and overlap",
        "Share-of-voice movement over the window",
        "Gap and positioning notes for the keyword and content agents",
      ],
      qualityChecks: [
        "Competitors are the ones ranking, not the ones the client names",
        "Overlap is measured on the tracked set, not estimated",
        "Every movement claim carries the window it was measured over",
      ],
      escalation: [
        "A rival's gain looks structural rather than seasonal",
        "The competitive set has changed enough to invalidate the plan",
      ],
    },
    capacity: 4,
    defaultPriority: "medium",
    reviewRequired: false,
    seed: 3331,
  },
  {
    id: "keyword-intent",
    name: "Keyword & Search Intent",
    title: "Discovery, clustering, intent",
    description:
      "Finds the demand, groups it into clusters, and classifies what each search is actually asking for.",
    responsibility:
      "Owns the keyword universe: discovery, clustering, intent classification, and prioritisation.",
    responsibilities: [
      "Discover and de-duplicate the addressable keyword universe",
      "Group terms into clusters that map to real pages",
      "Classify intent and re-classify when a SERP changes shape",
      "Score the pool against conversion value, not volume alone",
    ],
    specialties: [
      "Keyword discovery",
      "Clustering",
      "Intent classification",
      "Opportunity scoring",
      "Long-tail analysis",
    ],
    category: "intelligence",
    stage: 4,
    icon: "keywords",
    initials: "KI",
    module: "/keywords",
    upstream: ["market-intelligence"],
    downstream: ["content-strategist"],
    outputLabel: "clusters",
    outputBase: 96,
    outputKinds: [
      "Keyword cluster",
      "Intent classification",
      "Opportunity list",
    ],
    tasks: [
      "Clustering 412 newly discovered keywords by search intent",
      "Re-classifying intent on terms whose SERPs changed shape",
      "Scoring the long-tail pool against the current conversion model",
    ],
    brief: {
      mission:
        "Turn raw search demand into a prioritised set of clusters the content plan can be built on.",
      inputs: [
        "Competitor keyword sets and gap analysis",
        "Current rankings, impressions, and conversion data",
        "The project's commercial goal and target market",
      ],
      outputs: [
        "Named clusters with intent, volume, and difficulty",
        "A prioritised opportunity list",
        "Cannibalisation warnings where two pages chase one cluster",
      ],
      qualityChecks: [
        "Intent is read from the live SERP, not inferred from wording",
        "Clusters map to one page each, with no overlap left unflagged",
        "Priority reflects conversion value, not search volume alone",
      ],
      escalation: [
        "A cluster's SERP shifts intent and invalidates published pages",
        "The highest-value demand is outside the agreed scope",
      ],
    },
    capacity: 6,
    defaultPriority: "high",
    reviewRequired: false,
    seed: 3449,
  },
  {
    id: "content-strategist",
    name: "Content Strategist",
    title: "Plans, briefs, topical maps",
    description:
      "Decides what gets written, in what order, and how the pages link together.",
    responsibility:
      "Owns the content plan: topical maps, briefs, and the internal-linking strategy behind them.",
    responsibilities: [
      "Build topical maps from the prioritised clusters",
      "Write briefs specific enough to be drafted against",
      "Plan internal linking so authority reaches the money pages",
      "Schedule refreshes for decaying content",
    ],
    specialties: [
      "Topical mapping",
      "Content briefs",
      "Internal linking",
      "Content refresh",
      "Editorial planning",
    ],
    category: "content",
    stage: 5,
    icon: "layers",
    initials: "CS",
    module: "/content",
    upstream: ["keyword-intent"],
    downstream: ["research-evidence"],
    outputLabel: "briefs",
    outputBase: 42,
    outputKinds: ["Content brief", "Topical map", "Internal-link plan"],
    tasks: [
      "Drafting the topical map for the comparison hub",
      "Rebuilding internal-linking paths across the resource library",
      "Turning the top twenty opportunities into prioritised briefs",
    ],
    brief: {
      mission:
        "Convert prioritised demand into a publishing plan: what to write, what it must cover, and where it sits in the site.",
      inputs: [
        "Prioritised keyword clusters with intent",
        "Existing content inventory and its performance",
        "Competitor coverage and identified gaps",
      ],
      outputs: [
        "Briefs with outline, entities, and target cluster",
        "A topical map showing hub and spoke relationships",
        "An internal-linking plan per hub",
      ],
      qualityChecks: [
        "Every brief names one cluster and one search intent",
        "Coverage is checked against existing pages before commissioning",
        "Each planned page has a defined place in the internal-link graph",
      ],
      escalation: [
        "A brief would duplicate a page that already ranks",
        "The plan needs subject-matter input the account cannot supply",
      ],
    },
    capacity: 6,
    defaultPriority: "high",
    reviewRequired: true,
    seed: 3557,
  },
  {
    id: "research-evidence",
    name: "Research & Evidence",
    title: "Sources, facts, citations",
    description:
      "Puts a verifiable source behind every factual claim before it reaches a draft.",
    responsibility:
      "Owns evidence: sourcing, verification, and the citation record behind published claims.",
    responsibilities: [
      "Source primary evidence for every factual claim in a brief",
      "Verify statistics and regulatory statements before drafting",
      "Re-check ageing citations on live pages",
      "Maintain the citation record behind published content",
    ],
    specialties: [
      "Source verification",
      "Citation management",
      "Fact checking",
      "Primary research",
      "Regulatory review",
    ],
    category: "content",
    stage: 6,
    icon: "search",
    initials: "RE",
    module: "/content",
    upstream: ["content-strategist"],
    downstream: ["writer"],
    outputLabel: "citations",
    outputBase: 310,
    outputKinds: ["Evidence pack", "Source verification", "Citation set"],
    tasks: [
      "Verifying 38 regulatory claims in the compliance guide",
      "Sourcing primary evidence for the annual industry report",
      "Re-checking statistics older than eighteen months across live pages",
    ],
    brief: {
      mission:
        "Make sure nothing is published that cannot be traced back to a source the client would be comfortable defending.",
      inputs: [
        "Approved content briefs and their factual claims",
        "Existing published pages carrying ageing statistics",
        "Regulatory and compliance constraints for the market",
      ],
      outputs: [
        "An evidence pack per brief, claim by claim",
        "Verified citations with retrieval dates",
        "Flags on claims that could not be substantiated",
      ],
      qualityChecks: [
        "Each claim carries a primary source, not a secondary summary",
        "Statistics older than eighteen months are re-verified or replaced",
        "Regulated claims are checked against the market's own rules",
      ],
      escalation: [
        "A central claim in a brief cannot be substantiated",
        "A regulated statement needs client legal sign-off",
      ],
    },
    capacity: 8,
    defaultPriority: "medium",
    reviewRequired: true,
    seed: 3671,
  },
  {
    id: "writer",
    name: "Writer",
    title: "Drafting against briefs",
    description:
      "Writes the pages the plan calls for, to the brief, the evidence, and the account's tone.",
    responsibility:
      "Owns drafting: turning a brief and its evidence into publishable copy.",
    responsibilities: [
      "Draft pages against approved briefs and evidence packs",
      "Rewrite decaying content to a refreshed outline",
      "Produce the structured blocks answer engines can quote",
      "Hold the account's tone and reading level across the library",
    ],
    specialties: [
      "Long-form drafting",
      "Comparison content",
      "Tone of voice",
      "Content refresh",
      "Structured answers",
    ],
    category: "content",
    stage: 7,
    icon: "edit",
    initials: "WR",
    module: "/content",
    upstream: ["research-evidence"],
    downstream: ["on-page-seo"],
    outputLabel: "drafts",
    outputBase: 38,
    outputKinds: ["Article draft", "Page copy", "FAQ block"],
    tasks: [
      "Drafting eight comparison pages against approved briefs",
      "Rewriting three decaying guides to the refreshed outline",
      "Producing the FAQ blocks required for answer eligibility",
    ],
    brief: {
      mission:
        "Produce drafts that answer the search behind the brief completely, in the account's voice, with every claim sourced.",
      inputs: [
        "The approved brief, its outline, and its target cluster",
        "The evidence pack for the page's factual claims",
        "The account's tone, reading level, and style rules",
      ],
      outputs: [
        "Complete page drafts ready for on-page optimisation",
        "Refreshed versions of decaying pages",
        "Structured question-and-answer blocks",
      ],
      qualityChecks: [
        "The draft covers every section the brief specified",
        "Every factual claim maps to a citation in the evidence pack",
        "Reading level and tone match the account's published library",
      ],
      escalation: [
        "The brief and the evidence pack contradict each other",
        "The page needs a subject-matter interview to be credible",
      ],
    },
    capacity: 5,
    defaultPriority: "medium",
    reviewRequired: true,
    seed: 3779,
  },
  {
    id: "on-page-seo",
    name: "On-Page SEO",
    title: "Titles, meta, entities, links",
    description:
      "Optimises what is on the page: titles, metadata, headings, entities, and internal links.",
    responsibility:
      "Owns on-page optimisation across the live site, page by page.",
    responsibilities: [
      "Rewrite titles and meta descriptions for click-through",
      "Fix heading hierarchy and on-page structure",
      "Add entity markup and internal links to the money pages",
      "Resolve keyword cannibalisation between competing pages",
    ],
    specialties: [
      "Metadata",
      "Heading structure",
      "Entity optimisation",
      "Internal links",
      "Cannibalisation",
    ],
    category: "optimisation",
    stage: 8,
    icon: "pages",
    initials: "OP",
    module: "/content",
    upstream: ["writer"],
    downstream: ["technical-seo"],
    outputLabel: "pages",
    outputBase: 214,
    outputKinds: ["Optimised article", "Metadata set", "Entity markup"],
    tasks: [
      "Rewriting titles and meta descriptions for 126 low-click pages",
      "Adding entity markup and internal links to the money pages",
      "Resolving heading-hierarchy defects flagged on the blog template",
    ],
    brief: {
      mission:
        "Make every page state clearly what it is about, to both readers and crawlers, and connect it to the rest of the site.",
      inputs: [
        "Drafts arriving from the Writer, and the live page inventory",
        "Cluster and intent assignments from the keyword agent",
        "Click-through and impression data per page",
      ],
      outputs: [
        "Optimised titles, descriptions, and headings",
        "Entity and internal-link additions",
        "Cannibalisation resolutions between competing pages",
      ],
      qualityChecks: [
        "One page targets one cluster, with no unresolved overlap",
        "Titles stay within the length that renders in the SERP",
        "Every internal link added is contextually relevant, not padding",
      ],
      escalation: [
        "Resolving cannibalisation would require retiring a live page",
        "A template change is needed that only development can make",
      ],
    },
    capacity: 8,
    defaultPriority: "medium",
    reviewRequired: false,
    seed: 3889,
  },
  {
    id: "technical-seo",
    name: "Technical SEO",
    title: "Crawl, indexation, vitals, schema",
    description:
      "Keeps the site crawlable, indexable, fast, and correctly described in structured data.",
    responsibility:
      "Owns site health: crawlability, indexation, Core Web Vitals, and schema.",
    responsibilities: [
      "Diagnose and resolve crawl and indexation defects",
      "Cut redirect chains and canonical conflicts",
      "Hold Core Web Vitals within threshold on every template",
      "Maintain structured data coverage and validity",
    ],
    specialties: [
      "Crawlability",
      "Indexation",
      "Core Web Vitals",
      "Structured data",
      "Log analysis",
    ],
    category: "optimisation",
    stage: 9,
    icon: "technical",
    initials: "TS",
    module: "/technical",
    upstream: ["on-page-seo"],
    downstream: ["ai-visibility"],
    outputLabel: "fixes",
    outputBase: 64,
    outputKinds: ["Technical audit", "Schema recommendation", "Fix report"],
    tasks: [
      "Resolving duplicate canonical tags across paginated archives",
      "Cutting redirect chains left behind by the template migration",
      "Restoring product schema fields dropped in the last release",
    ],
    brief: {
      mission:
        "Remove every technical reason a page might not be found, crawled, indexed, or understood.",
      inputs: [
        "Crawl results, server logs, and coverage reports",
        "Core Web Vitals field data per template",
        "Release notes for site changes that could regress health",
      ],
      outputs: [
        "Prioritised technical audits with affected URL counts",
        "Schema recommendations per template",
        "Fix reports confirming a defect is closed",
      ],
      qualityChecks: [
        "Every defect names the affected URLs, not just the symptom",
        "Fixes are re-crawled and confirmed before being closed",
        "Schema is validated against the live rendered page",
      ],
      escalation: [
        "A defect needs a deployment the client's developers must make",
        "Indexation loss is accelerating rather than levelling off",
      ],
    },
    capacity: 6,
    defaultPriority: "critical",
    reviewRequired: true,
    seed: 4001,
  },
  {
    id: "ai-visibility",
    name: "AI Visibility",
    title: "Answer engines, AEO and GEO",
    description:
      "Works on whether the brand is present, cited, and correctly represented inside AI answers.",
    responsibility:
      "Owns visibility in generative engines: answer-readiness, citations, and mention share.",
    responsibilities: [
      "Audit answer-readiness across the highest-value pages",
      "Structure definitions and comparisons for generative retrieval",
      "Track citation and mention share across answer engines",
      "Flag clusters losing clicks to AI answers",
    ],
    specialties: [
      "Answer engine optimisation",
      "Generative retrieval",
      "Citation tracking",
      "Entity clarity",
      "Structured answers",
    ],
    category: "growth",
    stage: 10,
    icon: "ai-visibility",
    initials: "AV",
    module: "/ai-visibility",
    upstream: ["technical-seo"],
    downstream: ["authority-backlink"],
    outputLabel: "optimisations",
    outputBase: 52,
    outputKinds: [
      "AI visibility analysis",
      "Answer-readiness audit",
      "Citation tracker",
    ],
    tasks: [
      "Auditing answer-readiness on the top 40 landing pages",
      "Structuring definitions and comparisons for generative retrieval",
      "Tracking citation share across six answer engines",
    ],
    brief: {
      mission:
        "Make the account the source an answer engine reaches for, and measure whether it actually is.",
      inputs: [
        "The tracked prompt set and its current answers",
        "Page structure, schema, and entity coverage",
        "Clusters showing impression growth without click growth",
      ],
      outputs: [
        "Answer-readiness scores per page",
        "Citation and mention share across tracked engines",
        "Restructuring recommendations for retrievable passages",
      ],
      qualityChecks: [
        "Recommendations improve the page for readers, not only for retrieval",
        "Citation counts are measured across the same prompt set each window",
        "Entity claims match what the site actually says elsewhere",
      ],
      escalation: [
        "An engine is citing the brand with incorrect information",
        "A cluster's clicks are collapsing while rankings hold",
      ],
    },
    capacity: 5,
    defaultPriority: "high",
    reviewRequired: false,
    seed: 4111,
  },
  {
    id: "authority-backlink",
    name: "Authority & Backlink",
    title: "Links, digital PR, authority",
    description:
      "Builds the off-site signals: link opportunities, digital PR, and recovered authority.",
    responsibility:
      "Owns authority growth: prospecting, outreach, and the link profile's health.",
    responsibilities: [
      "Qualify link prospects against relevance and authority",
      "Run digital-PR angles the account can actually support",
      "Reclaim links lost when referring pages change",
      "Convert unlinked brand mentions into links",
    ],
    specialties: [
      "Link prospecting",
      "Digital PR",
      "Link reclamation",
      "Unlinked mentions",
      "Authority analysis",
    ],
    category: "growth",
    stage: 11,
    icon: "backlinks",
    initials: "AB",
    module: "/backlinks",
    upstream: ["ai-visibility"],
    downstream: ["analytics-learning"],
    outputLabel: "prospects",
    outputBase: 88,
    outputKinds: ["Backlink opportunity", "Digital-PR pitch", "Prospect list"],
    tasks: [
      "Qualifying 60 digital-PR prospects for the annual report campaign",
      "Reclaiming links lost when three referring pages were retired",
      "Converting unlinked brand mentions on trade publications",
    ],
    brief: {
      mission:
        "Grow the account's authority with links it would be happy to have named in public.",
      inputs: [
        "The current link profile and its lost-link record",
        "Publishable assets the content team has produced",
        "Competitor link profiles and their referring domains",
      ],
      outputs: [
        "Qualified prospect lists with authority and relevance",
        "Digital-PR angles tied to a real asset",
        "Reclamation and unlinked-mention opportunities",
      ],
      qualityChecks: [
        "Every prospect is topically relevant, not authority alone",
        "No paid, exchanged, or manufactured link is proposed",
        "Outreach angles reference an asset that actually exists",
      ],
      escalation: [
        "A campaign needs a client spokesperson or original data",
        "The profile shows links the account did not earn",
      ],
    },
    capacity: 6,
    defaultPriority: "low",
    reviewRequired: false,
    seed: 4229,
  },
  {
    id: "analytics-learning",
    name: "Analytics & Learning",
    title: "Measurement and feedback",
    description:
      "Measures what the work produced, attributes it, and feeds the learning back into strategy.",
    responsibility:
      "Owns measurement and the feedback loop that closes the cycle back to the Director.",
    responsibilities: [
      "Attribute ranking and traffic movement to the actions behind it",
      "Model which content and fixes return fastest per account",
      "Report performance against the agreed targets",
      "Return a learning summary that re-prioritises the next cycle",
    ],
    specialties: [
      "Attribution",
      "Performance modelling",
      "Forecasting",
      "Reporting",
      "Experiment design",
    ],
    category: "growth",
    stage: 12,
    icon: "analytics",
    initials: "AL",
    module: "/analytics",
    upstream: ["authority-backlink"],
    downstream: ["seo-director"],
    outputLabel: "insights",
    outputBase: 27,
    outputKinds: ["Analytics report", "Attribution model", "Learning summary"],
    tasks: [
      "Attributing ranking gains back to the actions that caused them",
      "Modelling which content type returns fastest for this account",
      "Feeding the month's learnings back to the SEO Director",
    ],
    brief: {
      mission:
        "Say what actually worked, with the evidence, and make the next cycle better than the last.",
      inputs: [
        "Traffic, ranking, and conversion data for the window",
        "The record of what every agent shipped and when",
        "The targets agreed at the start of the cycle",
      ],
      outputs: [
        "Attribution linking outcomes back to the work that caused them",
        "Performance reports against target",
        "A learning summary handed back to the SEO Director",
      ],
      qualityChecks: [
        "Correlation is separated from attribution in every claim",
        "Seasonality and algorithm updates are accounted for",
        "Every conclusion names the data it rests on",
      ],
      escalation: [
        "Measurement data is incomplete enough to distort the read",
        "Results diverge far enough from forecast to need a plan change",
      ],
    },
    capacity: 5,
    defaultPriority: "medium",
    reviewRequired: false,
    seed: 4337,
  },
];

/** Display names for the twelve agents, keyed by id. */
export const AGENT_NAMES: Record<AgentId, string> = Object.fromEntries(
  AGENT_REGISTRY.map((agent) => [agent.id, agent.name]),
) as Record<AgentId, string>;

/** Ids in orchestration order, stage 1 through 12. */
export const AGENT_IDS: readonly AgentId[] = AGENT_REGISTRY.map(
  (agent) => agent.id,
);

/** Look up an agent. Returns undefined for an id that is not in the registry. */
export function getAgentRecord(id: string): Agent | undefined {
  return AGENT_REGISTRY.find((agent) => agent.id === id);
}
