/**
 * Writing an assembled report out as a file.
 *
 * Pure string builders: each takes the report already on screen and returns
 * the bytes of one format. Nothing here touches the network, the filesystem,
 * or any document service — the component that calls these hands the result to
 * the browser as a download, and that is the whole of what "export" means in
 * this product (CLAUDE.md §4).
 *
 * Every format carries the same three things: the figures, where each one came
 * from, and the methodology note. An export that dropped the provenance would
 * be the one artefact of this product that made a claim it could not support,
 * and it would be the one that left the building.
 */
import { formatFullDate } from "@/lib/format";
import {
  DELIVERY_NOTE,
  PROVENANCE_META,
  REPORTS_SOURCE_NOTE,
  REPORT_BRAND,
  SECTION_STATE_META,
  STATUS_META,
} from "@/lib/mock/reports/meta";
import type { ExportFormat, ReportDetail } from "@/types/reports";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function header(detail: ReportDetail) {
  const { report } = detail;
  return {
    title: report.title,
    client: `${report.client} — ${report.projectName}`,
    period: `${formatFullDate(report.period.start)} to ${formatFullDate(report.period.end)}`,
    prepared: `${REPORT_BRAND.workspace} · ${REPORT_BRAND.preparedBy}, ${REPORT_BRAND.preparedByRole}`,
    status: STATUS_META[report.status].label,
    readiness: `${report.readiness}/100`,
    generated: formatFullDate(report.updatedAt),
  };
}

/** Sections worth printing. An unavailable section states its absence once. */
function printable(detail: ReportDetail) {
  return detail.sections.filter((section) => section.state !== "unavailable");
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

export function toMarkdown(detail: ReportDetail): string {
  const head = header(detail);
  const lines: string[] = [];

  lines.push(`# ${head.title}`, "");
  lines.push(`**${head.client}**  `);
  lines.push(`Period: ${head.period}  `);
  lines.push(`Prepared by: ${head.prepared}  `);
  lines.push(`Status: ${head.status} · Completeness: ${head.readiness}  `);
  lines.push(`Assembled: ${head.generated}`, "");
  lines.push(`> ${detail.subtitle}`, "");
  lines.push("---", "");

  for (const section of detail.sections) {
    lines.push(`## ${section.title}`, "");
    lines.push(section.summary, "");

    if (section.figures.length > 0) {
      lines.push("| Figure | Value | Detail | Source |");
      lines.push("| --- | --- | --- | --- |");
      for (const figure of section.figures) {
        lines.push(
          `| ${figure.label} | ${figure.value} | ${figure.detail} | ${PROVENANCE_META[figure.provenance].label} |`,
        );
      }
      lines.push("");
    }

    for (const highlight of section.highlights) {
      lines.push(`- ${highlight}`);
    }
    if (section.highlights.length > 0) lines.push("");

    if (section.caveat !== null) {
      lines.push(
        `*${SECTION_STATE_META[section.state].label}: ${section.caveat}*`,
        "",
      );
    }

    lines.push(`_Composed from ${section.sourceLabel}._`, "");
  }

  lines.push("---", "");
  lines.push("## About the figures in this report", "");
  lines.push(REPORTS_SOURCE_NOTE, "");
  lines.push(DELIVERY_NOTE, "");
  lines.push(`Produced by ${REPORT_BRAND.product}.`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A branded, self-contained page.
 *
 * Styles are inline because the file has to open correctly from a download
 * folder with nothing else beside it, and print to PDF from the browser
 * without a stylesheet request that would fail.
 */
export function toHtml(detail: ReportDetail): string {
  const head = header(detail);
  const accent = REPORT_BRAND.accent;

  const sections = detail.sections
    .map((section) => {
      const figures =
        section.figures.length === 0
          ? ""
          : `<table><thead><tr><th>Figure</th><th>Value</th><th>Detail</th><th>Source</th></tr></thead><tbody>${section.figures
              .map(
                (figure) =>
                  `<tr><td>${escapeHtml(figure.label)}</td><td class="num">${escapeHtml(figure.value)}</td><td>${escapeHtml(figure.detail)}</td><td class="muted">${escapeHtml(PROVENANCE_META[figure.provenance].label)}</td></tr>`,
              )
              .join("")}</tbody></table>`;

      const highlights =
        section.highlights.length === 0
          ? ""
          : `<ul>${section.highlights.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;

      const caveat =
        section.caveat === null
          ? ""
          : `<p class="caveat"><strong>${escapeHtml(SECTION_STATE_META[section.state].label)}:</strong> ${escapeHtml(section.caveat)}</p>`;

      return `<section><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.summary)}</p>${figures}${highlights}${caveat}<p class="source">Composed from ${escapeHtml(section.sourceLabel)}.</p></section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(head.title)} — ${escapeHtml(detail.report.projectName)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px 24px 64px; font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #14171f; background: #fff; }
  main { max-width: 860px; margin: 0 auto; }
  header { border-bottom: 3px solid ${accent}; padding-bottom: 20px; margin-bottom: 32px; }
  .brand { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: ${accent}; font-weight: 700; }
  h1 { font-size: 27px; line-height: 1.25; margin: 10px 0 6px; }
  h2 { font-size: 18px; margin: 36px 0 8px; padding-top: 20px; border-top: 1px solid #e6e8ee; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 14px; margin: 14px 0 0; font-size: 13px; }
  dt { color: #656c7d; }
  dd { margin: 0; }
  .lede { margin: 18px 0 0; padding: 12px 14px; background: #f5f7fb; border-left: 3px solid ${accent}; font-size: 13.5px; color: #414855; }
  table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 13.5px; }
  th { text-align: left; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: #656c7d; border-bottom: 1px solid #d9dde6; padding: 6px 10px 6px 0; }
  td { padding: 7px 10px 7px 0; border-bottom: 1px solid #eef0f5; vertical-align: top; }
  td.num { font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
  td.muted { color: #656c7d; font-size: 12px; white-space: nowrap; }
  ul { margin: 12px 0; padding-left: 20px; }
  li { margin: 4px 0; }
  .caveat { font-size: 13px; color: #7a5b12; background: #fdf6e3; border-radius: 5px; padding: 9px 12px; }
  .source { font-size: 12px; color: #656c7d; margin-top: 10px; }
  footer { margin-top: 44px; padding-top: 20px; border-top: 1px solid #e6e8ee; font-size: 12.5px; color: #656c7d; }
  footer p { margin: 0 0 10px; }
  @media print { body { padding: 0; } h2 { break-after: avoid; } section { break-inside: avoid; } }
</style>
</head>
<body>
<main>
<header>
  <p class="brand">${escapeHtml(REPORT_BRAND.workspace)}</p>
  <h1>${escapeHtml(head.title)}</h1>
  <dl>
    <dt>Client</dt><dd>${escapeHtml(head.client)}</dd>
    <dt>Period</dt><dd>${escapeHtml(head.period)}</dd>
    <dt>Prepared by</dt><dd>${escapeHtml(head.prepared)}</dd>
    <dt>Status</dt><dd>${escapeHtml(head.status)} · completeness ${escapeHtml(head.readiness)}</dd>
    <dt>Assembled</dt><dd>${escapeHtml(head.generated)}</dd>
  </dl>
  <p class="lede">${escapeHtml(detail.subtitle)}</p>
</header>
${sections}
<footer>
  <p>${escapeHtml(REPORTS_SOURCE_NOTE)}</p>
  <p>${escapeHtml(DELIVERY_NOTE)}</p>
  <p>Produced by ${escapeHtml(REPORT_BRAND.product)}.</p>
</footer>
</main>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function toCsv(detail: ReportDetail): string {
  const rows: string[] = [
    [
      "section",
      "section_state",
      "figure",
      "value",
      "detail",
      "provenance",
      "source",
    ]
      .map(csvCell)
      .join(","),
  ];

  for (const section of printable(detail)) {
    for (const figure of section.figures) {
      rows.push(
        [
          section.title,
          SECTION_STATE_META[section.state].label,
          figure.label,
          figure.value,
          figure.detail,
          PROVENANCE_META[figure.provenance].label,
          section.sourceLabel,
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }

  return rows.join("\r\n");
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

export function toJson(detail: ReportDetail): string {
  return JSON.stringify(
    {
      product: REPORT_BRAND.product,
      workspace: REPORT_BRAND.workspace,
      preparedBy: REPORT_BRAND.preparedBy,
      sourceNote: REPORTS_SOURCE_NOTE,
      deliveryNote: DELIVERY_NOTE,
      report: detail.report,
      template: detail.template,
      sections: detail.sections,
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const WRITERS: Readonly<Record<ExportFormat, (detail: ReportDetail) => string>> =
  {
    markdown: toMarkdown,
    html: toHtml,
    csv: toCsv,
    json: toJson,
  };

export function renderExport(
  detail: ReportDetail,
  format: ExportFormat,
): string {
  return WRITERS[format](detail);
}

/** A stable, filesystem-safe name. Same report, same period, same file. */
export function exportFilename(
  detail: ReportDetail,
  extension: string,
): string {
  const slug = `${detail.report.projectId}-${detail.report.templateId}-${detail.report.period.id}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-");

  return `${slug}.${extension}`;
}
