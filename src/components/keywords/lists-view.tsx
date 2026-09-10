"use client";

import { useId, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TextInput } from "@/components/ui/field";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { formatCompact, formatRelative } from "@/lib/format";
import { KEYWORD_STATUS_META } from "@/lib/mock/keywords";
import {
  IntentBadge,
  KeywordLink,
  PositionValue,
} from "@/components/keywords/keyword-chrome";
import type {
  ImportedKeyword,
  KeywordList,
  KeywordRecord,
} from "@/types/keyword";

/**
 * Saved lists and the research queue.
 *
 * Lists are session state from the moment the page loads. The seeded ones are
 * built from rules over the keyword set — "Quick wins" holds whatever
 * currently qualifies as a quick win — and each says so, so a list is never a
 * set of ids nobody can explain. Anything created, renamed, or edited here
 * lives until the page reloads and no further: there is nowhere to save it to
 * in this milestone (CLAUDE.md §4).
 *
 * The research queue is what the import and discovery flows produce. Those
 * keywords carry no metrics on purpose, and the panel says why rather than
 * showing zeroes that look like measurements.
 */
export function ListsView({
  lists,
  records,
  imported,
  onCreate,
  onRename,
  onRemoveKeyword,
  onOpenList,
  onRemoveImported,
  onOpenImport,
  onOpenDiscover,
  referenceIso,
}: {
  lists: readonly KeywordList[];
  /** Every keyword, for resolving list membership. */
  records: readonly KeywordRecord[];
  imported: readonly ImportedKeyword[];
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onRemoveKeyword: (listId: string, keywordId: string) => void;
  /** Filters the keyword table to this list and moves to it. */
  onOpenList: (listId: string) => void;
  onRemoveImported: (id: string) => void;
  onOpenImport: () => void;
  onOpenDiscover: () => void;
  referenceIso: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const newListId = useId();

  const byId = new Map(records.map((record) => [record.id, record]));

  const startRename = (list: KeywordList) => {
    setRenamingId(list.id);
    setDraftName(list.name);
  };

  const commitRename = () => {
    if (renamingId === null) return;
    const name = draftName.trim();
    if (name.length > 0) onRename(renamingId, name);
    setRenamingId(null);
  };

  const create = () => {
    const name = newName.trim();
    if (name.length === 0) return;
    onCreate(name);
    setNewName("");
    setCreating(false);
  };

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          eyebrow="Saved views"
          title="Keyword lists"
          description="Working sets of keywords — for a plan, a client review, or a sprint. Session state only."
          actions={
            creating ? (
              <span className="flex items-center gap-1.5">
                <label htmlFor={newListId} className="sr-only">
                  Name for the new list
                </label>
                <span className="block w-48">
                  <TextInput
                    id={newListId}
                    size="sm"
                    autoFocus
                    value={newName}
                    placeholder="List name"
                    onChange={(event) => setNewName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") create();
                      if (event.key === "Escape") setCreating(false);
                    }}
                  />
                </span>
                <Button
                  variant="primary"
                  onClick={create}
                  disabled={newName.trim().length === 0}
                >
                  Create
                </Button>
                <Button variant="ghost" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
              </span>
            ) : (
              <Button icon="plus" onClick={() => setCreating(true)}>
                New list
              </Button>
            )
          }
        />

        <PanelBody>
          <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {lists.map((list) => {
              const open = openId === list.id;
              const members = list.keywordIds
                .map((id) => byId.get(id))
                .filter((record): record is KeywordRecord => record !== undefined);

              const volume = members.reduce(
                (carry, record) => carry + record.volume,
                0,
              );

              return (
                <li key={list.id} className="min-w-0">
                  <article
                    className={cn(
                      "flex h-full flex-col rounded-panel border bg-surface-raised p-3.5 transition-colors",
                      open ? "border-accent/40" : "border-border hover:border-border-strong",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface text-fg-muted">
                          <Icon name={list.icon} className="h-4 w-4" />
                        </span>

                        <div className="min-w-0">
                          {renamingId === list.id ? (
                            <span className="flex items-center gap-1.5">
                              <span className="block w-40">
                                <TextInput
                                  size="sm"
                                  autoFocus
                                  value={draftName}
                                  aria-label={`Rename ${list.name}`}
                                  onChange={(event) =>
                                    setDraftName(event.target.value)
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") commitRename();
                                    if (event.key === "Escape")
                                      setRenamingId(null);
                                  }}
                                />
                              </span>
                              <Button variant="primary" onClick={commitRename}>
                                Save
                              </Button>
                            </span>
                          ) : (
                            <h4 className="truncate text-[13.5px] leading-tight font-semibold text-fg">
                              {list.name}
                            </h4>
                          )}

                          <p className="mt-1 text-[11.5px] leading-snug text-fg-subtle">
                            {list.description}
                          </p>
                        </div>
                      </div>

                      <Badge tone={list.seeded ? "neutral" : "accent"}>
                        {list.seeded ? "Built-in" : "This session"}
                      </Badge>
                    </div>

                    <p className="mt-3 flex items-baseline gap-3 text-[11.5px] text-fg-subtle">
                      <span className="tabular text-[15px] font-semibold text-fg">
                        {list.keywordIds.length}
                      </span>
                      keywords
                      <span className="tabular">
                        {formatCompact(volume)} searches / mo
                      </span>
                    </p>

                    {open && (
                      <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto border-t border-border pt-2.5">
                        {members.length === 0 ? (
                          <li className="py-4 text-center text-[11.5px] text-fg-subtle">
                            This list is empty. Select keywords in the table and
                            use “Add to list”.
                          </li>
                        ) : (
                          members.map((record) => (
                            <li
                              key={record.id}
                              className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-surface-hover"
                            >
                              <span className="min-w-0 flex-1">
                                <KeywordLink
                                  id={record.id}
                                  keyword={record.keyword}
                                  className="block truncate text-[12px]"
                                />
                                <span className="block truncate text-[10.5px] text-fg-subtle">
                                  {record.projectName} ·{" "}
                                  {formatCompact(record.volume)} / mo
                                </span>
                              </span>
                              <PositionValue
                                position={record.position}
                                className="text-[11.5px]"
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove ${record.keyword} from ${list.name}`}
                                onClick={() =>
                                  onRemoveKeyword(list.id, record.id)
                                }
                              >
                                <Icon name="close" className="h-3.5 w-3.5" />
                              </Button>
                            </li>
                          ))
                        )}
                      </ul>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
                      <Button
                        onClick={() => setOpenId(open ? null : list.id)}
                        icon={open ? "minus" : "plus"}
                      >
                        {open ? "Hide keywords" : "Show keywords"}
                      </Button>
                      <Button icon="filter" onClick={() => onOpenList(list.id)}>
                        Filter table
                      </Button>
                      <Button
                        variant="ghost"
                        icon="edit"
                        onClick={() => startRename(list)}
                      >
                        Rename
                      </Button>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        </PanelBody>

        <PanelFooter>
          <span>
            Built-in lists are rules over the keyword set, so they stay in step
            with it. Edits and new lists live in this session only.
          </span>
          <span>{lists.length} lists</span>
        </PanelFooter>
      </Panel>

      <Panel>
        <PanelHeader
          eyebrow="Research queue"
          title="Imported and discovered keywords"
          description="Keywords added in this session. They carry no metrics until they are researched."
          actions={
            <span className="flex items-center gap-2">
              <Button icon="upload" onClick={onOpenImport}>
                Import keywords
              </Button>
              <Button icon="search" onClick={onOpenDiscover}>
                Discover keywords
              </Button>
            </span>
          }
        />

        {imported.length === 0 ? (
          <EmptyState
            icon="inbox"
            title="Nothing in the research queue"
            description="Paste a list of keywords, or run a discovery search on a seed topic. Anything added lands here until it has been researched."
            action={
              <span className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="primary" icon="upload" onClick={onOpenImport}>
                  Import keywords
                </Button>
                <Button icon="search" onClick={onOpenDiscover}>
                  Discover keywords
                </Button>
              </span>
            }
          />
        ) : (
          <PanelBody>
            <ul className="space-y-1.5">
              {imported.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-border bg-surface-raised px-3 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[12px] text-fg">
                      {row.keyword}
                    </span>
                    <span className="block truncate text-[11px] text-fg-subtle">
                      {row.projectName} · {row.note} ·{" "}
                      {formatRelative(row.addedAt, referenceIso)}
                    </span>
                  </span>

                  {row.intent && <IntentBadge intent={row.intent} />}

                  <Badge
                    tone={
                      row.status === "duplicate"
                        ? "warning"
                        : row.status === "invalid"
                          ? "critical"
                          : "accent"
                    }
                    dot
                  >
                    {row.status === "pending-metrics"
                      ? KEYWORD_STATUS_META.pending.label
                      : row.status === "awaiting-research"
                        ? "Awaiting research"
                        : row.status === "duplicate"
                          ? "Duplicate"
                          : "Invalid"}
                  </Badge>

                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${row.keyword} from the research queue`}
                    onClick={() => onRemoveImported(row.id)}
                  >
                    <Icon name="close" className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </PanelBody>
        )}

        <PanelFooter>
          <span>
            No search volume or difficulty is attached on import. This milestone
            has no keyword provider connected.
          </span>
          <span>{imported.length} in the queue</span>
        </PanelFooter>
      </Panel>
    </div>
  );
}
