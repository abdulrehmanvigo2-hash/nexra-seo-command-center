"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import {
  EXPORT_FORMATS,
  EXPORT_NOTE,
  REPORT_BRAND,
  exportFilename,
  renderExport,
} from "@/lib/mock/reports";
import type { ExportFormat, ReportDetail } from "@/types/reports";

/**
 * Writing the report on screen out as a file.
 *
 * This is the one place in the product where something actually leaves it, and
 * the whole of what happens is local: the file is built from the report that is
 * already rendered, handed to the browser as a blob, and saved by the user.
 * There is no upload, no document service, no mail provider, and no network
 * call of any kind (CLAUDE.md §4).
 *
 * Which is also why the buttons are real. A greyed-out "Send to client" would
 * be a dead control promising an integration that does not exist; a download
 * that works is the honest version of the same intent.
 */
export function ExportPanel({ detail }: { detail: ReportDetail }) {
  const [saved, setSaved] = useState<ExportFormat | null>(null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const save = (format: ExportFormat) => {
    const descriptor = EXPORT_FORMATS.find((entry) => entry.id === format);
    if (!descriptor) return;

    try {
      const blob = new Blob([renderExport(detail, format)], {
        type: descriptor.mimeType,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = exportFilename(detail, descriptor.extension);
      document.body.append(link);
      link.click();
      link.remove();
      // Revoked on the next frame: some browsers read the blob after the
      // click returns, and releasing it synchronously cancels the save.
      requestAnimationFrame(() => URL.revokeObjectURL(url));

      setSaved(format);
      setCopied(false);
      setFailed(null);
    } catch {
      setFailed(
        "The browser refused the download. Copy the Markdown instead, or check whether downloads are blocked for this site.",
      );
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(renderExport(detail, "markdown"));
      setCopied(true);
      setSaved(null);
      setFailed(null);
    } catch {
      setFailed(
        "The clipboard is not available in this context. Save the Markdown file instead.",
      );
    }
  };

  const savedLabel =
    saved === null
      ? null
      : EXPORT_FORMATS.find((entry) => entry.id === saved)?.label;

  return (
    <Panel>
      <PanelHeader
        title="Export"
        description={`Branded as ${REPORT_BRAND.workspace}, prepared by ${REPORT_BRAND.preparedBy}. Built here and saved to your machine.`}
        actions={
          <Button icon="note" onClick={copy}>
            {copied ? "Copied" : "Copy Markdown"}
          </Button>
        }
      />

      <PanelBody>
        <ul className="grid gap-3 sm:grid-cols-2">
          {EXPORT_FORMATS.map((format) => (
            <li key={format.id}>
              <button
                type="button"
                onClick={() => save(format.id)}
                className={cn(
                  "w-full rounded-md border px-3 py-2.5 text-left transition-colors",
                  "border-border bg-surface-raised hover:border-border-strong hover:bg-surface-hover",
                  "focus-visible:border-accent focus-visible:outline-none",
                )}
              >
                <span className="flex items-center gap-2 text-[12.5px] font-medium text-fg">
                  <Icon name={format.icon} className="h-4 w-4 text-fg-subtle" />
                  Save {format.label}
                  <span className="ml-auto font-mono text-[11px] text-fg-subtle">
                    {exportFilename(detail, format.extension)}
                  </span>
                </span>
                <span className="mt-1 block text-[11.5px] leading-snug text-fg-subtle">
                  {format.description}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <p aria-live="polite" className="mt-3 text-[12px]">
          {failed !== null ? (
            <span className="inline-flex items-start gap-1.5 text-warning">
              <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {failed}
            </span>
          ) : savedLabel !== null ? (
            <span className="inline-flex items-center gap-1.5 text-positive">
              <Icon name="check" className="h-3.5 w-3.5 shrink-0" />
              {savedLabel} saved to your downloads.
            </span>
          ) : copied ? (
            <span className="inline-flex items-center gap-1.5 text-positive">
              <Icon name="check" className="h-3.5 w-3.5 shrink-0" />
              Markdown copied to the clipboard.
            </span>
          ) : (
            <span className="text-fg-subtle">
              Every format carries the figures, where each one came from, and
              the methodology note.
            </span>
          )}
        </p>
      </PanelBody>

      <PanelFooter>
        <span>{EXPORT_NOTE}</span>
      </PanelFooter>
    </Panel>
  );
}
