"use client";

import { useId, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select, TextArea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/cn";
import { IMPORT_INTENTS, parseImport } from "@/lib/mock/keywords";
import type { ImportStatus, ImportedKeyword } from "@/types/keyword";

/**
 * Bringing keywords in from somewhere else.
 *
 * Deliberately does not invent metrics. A pasted keyword arrives with no
 * volume, no difficulty, and no position, and lands in a pending state that
 * says so — a made-up search volume is a number somebody would plan against,
 * and nothing produced it. When a keyword provider is connected, this is where
 * that lookup happens.
 *
 * The preview is live, so a paste with a stray column or a duplicate is
 * visible before anything is added rather than after.
 */

const STATUS_META: Record<
  ImportStatus,
  { readonly label: string; readonly tone: "positive" | "warning" | "critical" | "neutral" }
> = {
  "pending-metrics": { label: "Pending metrics", tone: "positive" },
  "awaiting-research": { label: "Awaiting research", tone: "positive" },
  duplicate: { label: "Duplicate", tone: "warning" },
  invalid: { label: "Invalid", tone: "critical" },
};

const SAMPLE = `smart thermostat wiring guide
underfloor heating cost calculator, commercial
book a heating engineer, transactional`;

export function ImportDialog({
  projects,
  defaultProjectId,
  referenceIso,
  onClose,
  onImport,
}: {
  projects: readonly { readonly id: string; readonly name: string }[];
  defaultProjectId: string;
  /** The instant imported rows are stamped with. */
  referenceIso: string;
  onClose: () => void;
  onImport: (rows: readonly ImportedKeyword[]) => void;
}) {
  const [projectId, setProjectId] = useState(
    defaultProjectId === "all" ? (projects[0]?.id ?? "") : defaultProjectId,
  );
  const [text, setText] = useState("");

  const projectFieldId = useId();
  const textFieldId = useId();

  const parsed = useMemo(
    () => (text.trim().length === 0 ? [] : parseImport(text, projectId, referenceIso)),
    [text, projectId, referenceIso],
  );

  const accepted = parsed.filter(
    (row) => row.status === "pending-metrics" || row.status === "awaiting-research",
  );
  const rejected = parsed.length - accepted.length;

  return (
    <Modal
      title="Import keywords"
      description="Paste one keyword per line. Add a comma and an intent to set it while importing."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-[11.5px] text-fg-subtle">
            {accepted.length} of {parsed.length} lines will be added
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="upload"
            disabled={accepted.length === 0}
            onClick={() => {
              onImport(parsed);
              onClose();
            }}
          >
            Import {accepted.length} keyword{accepted.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Project"
          htmlFor={projectFieldId}
          hint="Imported keywords are checked against this project's tracked set."
        >
          <Select
            id={projectFieldId}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            options={projects.map((project) => ({
              value: project.id,
              label: project.name,
            }))}
          />
        </Field>

        <Field
          label="Keywords"
          htmlFor={textFieldId}
          hint={`One per line. Optional second column: ${IMPORT_INTENTS.join(", ")}.`}
        >
          <TextArea
            id={textFieldId}
            rows={8}
            value={text}
            placeholder={SAMPLE}
            onChange={(event) => setText(event.target.value)}
            className="font-mono text-[12px]"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            icon="note"
            onClick={() => setText(SAMPLE)}
            disabled={text.trim().length > 0}
          >
            Use the sample
          </Button>
          {text.trim().length > 0 && (
            <Button variant="ghost" icon="close" onClick={() => setText("")}>
              Clear
            </Button>
          )}
        </div>

        <div className="rounded-md border border-border bg-surface-raised">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
            <p className="text-[12px] font-semibold text-fg">Preview</p>
            {parsed.length > 0 && (
              <p className="flex items-center gap-2 text-[11.5px]">
                <span className="text-positive">{accepted.length} accepted</span>
                {rejected > 0 && (
                  <span className="text-warning">{rejected} skipped</span>
                )}
              </p>
            )}
          </div>

          {parsed.length === 0 ? (
            <p className="px-3.5 py-6 text-center text-[12px] text-fg-subtle">
              Nothing pasted yet. Lines appear here as you type, with what will
              happen to each one.
            </p>
          ) : (
            <ul className="max-h-56 divide-y divide-border overflow-y-auto">
              {parsed.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3.5 py-2"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <Icon
                      name={
                        row.status === "invalid"
                          ? "close"
                          : row.status === "duplicate"
                            ? "alert"
                            : "check"
                      }
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        row.status === "invalid"
                          ? "text-critical"
                          : row.status === "duplicate"
                            ? "text-warning"
                            : "text-positive",
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[12px] text-fg">
                        {row.keyword}
                      </span>
                      <span className="block text-[11px] text-fg-subtle">
                        {row.note}
                      </span>
                    </span>
                  </span>
                  <Badge tone={STATUS_META[row.status].tone}>
                    {STATUS_META[row.status].label}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="flex items-start gap-2 rounded-md border border-border bg-surface-raised px-3 py-2.5 text-[11.5px] leading-relaxed text-fg-subtle">
          <Icon name="info" className="mt-px h-3.5 w-3.5 shrink-0" />
          No search volume or difficulty is attached on import. This product has
          no keyword provider connected, and inventing those figures would give
          you numbers to plan against that nothing measured. Imported keywords
          stay in a pending state until they are researched.
        </p>
      </div>
    </Modal>
  );
}
