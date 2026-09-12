/**
 * The reusable report templates.
 *
 * A template is a reading order and an audience, and nothing else. It holds no
 * figures, because the figures belong to the modules — which is what lets the
 * same six templates serve nine very different accounts without any of them
 * carrying a second copy of anything.
 *
 * The order of `sections` is the order the report is read in, so an executive
 * template leads with the summary and stops before the diagnostics, while the
 * internal review ends with methodology because its readers will check it.
 */
import type { ReportTemplate, SectionKind } from "@/types/reports";

export const REPORT_TEMPLATES: readonly ReportTemplate[] = [
  {
    id: "client-monthly",
    name: "Monthly performance report",
    description:
      "The standard client report. What moved, what was delivered, what is next, with the diagnostics behind each claim.",
    audience: "client-marketing",
    cadence: "monthly",
    sections: [
      "executive-summary",
      "performance",
      "keywords",
      "content",
      "technical",
      "authority",
      "next-actions",
      "methodology",
    ],
    icon: "reports",
    builtIn: true,
  },
  {
    id: "executive-brief",
    name: "Executive brief",
    description:
      "One page for a reader who will not go further: the window in five figures and the decision it points at.",
    audience: "client-executive",
    cadence: "monthly",
    sections: [
      "executive-summary",
      "performance",
      "next-actions",
      "methodology",
    ],
    icon: "briefcase",
    builtIn: true,
  },
  {
    id: "weekly-pulse",
    name: "Weekly pulse",
    description:
      "A short check-in on movement between the monthly reports. No diagnostics, no strategy — just what changed.",
    audience: "client-marketing",
    cadence: "weekly",
    sections: ["performance", "keywords", "content", "next-actions"],
    icon: "activity",
    builtIn: true,
  },
  {
    id: "quarterly-review",
    name: "Quarterly strategy review",
    description:
      "Everything, including what is not going well and what this product cannot measure. Written for the internal review before the client conversation.",
    audience: "internal-strategy",
    cadence: "quarterly",
    sections: [
      "executive-summary",
      "performance",
      "keywords",
      "content",
      "technical",
      "ai-visibility",
      "authority",
      "competitors",
      "agent-activity",
      "next-actions",
      "methodology",
    ],
    icon: "target",
    builtIn: true,
  },
  {
    id: "technical-readout",
    name: "Technical audit readout",
    description:
      "Cloned from the monthly report and cut down to the technical picture, for accounts in the middle of a recovery.",
    audience: "client-marketing",
    cadence: "on-demand",
    sections: [
      "executive-summary",
      "technical",
      "content",
      "next-actions",
      "methodology",
    ],
    icon: "technical",
    builtIn: false,
  },
  {
    id: "ai-visibility-briefing",
    name: "AI visibility briefing",
    description:
      "Answer-readiness and the work behind it, for accounts where generative search is the stated goal. Says plainly what is readiness and what would be a citation.",
    audience: "internal-strategy",
    cadence: "on-demand",
    sections: [
      "executive-summary",
      "ai-visibility",
      "content",
      "keywords",
      "next-actions",
      "methodology",
    ],
    icon: "ai-visibility",
    builtIn: false,
  },
];

let byId: Map<string, ReportTemplate> | null = null;

export function getReportTemplates(): readonly ReportTemplate[] {
  return REPORT_TEMPLATES;
}

export function getTemplate(id: string): ReportTemplate | undefined {
  byId ??= new Map(REPORT_TEMPLATES.map((entry) => [entry.id, entry]));
  return byId.get(id);
}

/** Every section kind used by at least one template, in first-use order. */
export function getUsedSectionKinds(): readonly SectionKind[] {
  const seen = new Set<SectionKind>();
  for (const template of REPORT_TEMPLATES) {
    for (const kind of template.sections) seen.add(kind);
  }
  return [...seen];
}
