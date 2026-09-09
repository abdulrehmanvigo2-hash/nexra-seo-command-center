"use client";

import { useId, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TextArea } from "@/components/ui/field";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { formatFullDate, formatRelative, formatTimeUtc } from "@/lib/format";
import type { ProjectNote } from "@/types/project";

/**
 * The running account note.
 *
 * Notes added here are held in this session only — there is nowhere to persist
 * them yet (CLAUDE.md §4) — and the panel says so rather than implying the
 * entry has been filed against the client record.
 */

const MAX_LENGTH = 600;

export function ProjectNotes({
  notes,
  onAdd,
  referenceIso,
}: {
  notes: readonly ProjectNote[];
  onAdd: (body: string) => void;
  referenceIso: string;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const composerId = useId();

  const submit = () => {
    const value = body.trim();

    if (value.length === 0) {
      setError("Write something before adding the note.");
      return;
    }

    onAdd(value);
    setBody("");
    setError(null);
  };

  return (
    <Panel>
      <PanelHeader
        eyebrow="Account log"
        title="Project Notes"
        description="Context the team and the agents have recorded against this project."
        actions={
          <Badge tone="neutral" dot>
            {notes.length} {notes.length === 1 ? "note" : "notes"}
          </Badge>
        }
      />

      <div className="border-b border-border px-4 py-3.5 sm:px-5">
        <label
          htmlFor={composerId}
          className="text-[11.5px] font-medium text-fg-muted"
        >
          Add a note
        </label>
        <TextArea
          id={composerId}
          className="mt-1.5"
          rows={3}
          value={body}
          maxLength={MAX_LENGTH}
          invalid={Boolean(error)}
          onChange={(event) => {
            setBody(event.target.value);
            setError(null);
          }}
          placeholder="Client confirmed the migration date has moved. Hold the technical sprint until staging is ready."
        />

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p
            className={cn(
              "text-[11.5px]",
              error ? "text-critical" : "text-fg-subtle",
            )}
            role={error ? "alert" : undefined}
          >
            {error ?? `${body.length} / ${MAX_LENGTH} characters`}
          </p>
          <Button variant="primary" icon="plus" onClick={submit}>
            Add note
          </Button>
        </div>
      </div>

      {notes.length === 0 ? (
        <EmptyState
          icon="note"
          title="No notes yet"
          description="Record a decision, a client constraint, or anything the agents should work around."
        />
      ) : (
        <PanelBody>
          <ol className="space-y-2.5">
            {notes.map((note) => (
              <li
                key={note.id}
                className="rounded-md border border-border bg-surface-raised px-3.5 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <p className="flex items-center gap-2 text-[12.5px] font-medium text-fg">
                    <Icon
                      name={note.source === "agent" ? "agents" : "user"}
                      className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
                    />
                    {note.author}
                    <span className="font-normal text-fg-subtle">
                      {note.role}
                    </span>
                  </p>
                  <p
                    className="text-[11px] whitespace-nowrap text-fg-subtle"
                    title={`${formatFullDate(note.at)}, ${formatTimeUtc(note.at)}`}
                  >
                    {formatRelative(note.at, referenceIso)}
                  </p>
                </div>

                <p className="mt-2 text-[12.5px] leading-relaxed text-fg-muted">
                  {note.body}
                </p>
              </li>
            ))}
          </ol>
        </PanelBody>
      )}

      <PanelFooter>
        <span>Notes added here are held in this session only.</span>
        <span>Newest first</span>
      </PanelFooter>
    </Panel>
  );
}
