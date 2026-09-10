"use client";

import { useId, useState } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Select, TextInput } from "@/components/ui/field";
import { AGENT_IDS, AGENT_NAMES } from "@/lib/mock/agents";
import type { AgentId, KeywordList } from "@/types/keyword";

/**
 * What can be done to several keywords at once.
 *
 * Appears only when something is selected, and every action here changes this
 * session's state and nothing else: a list gains members, an owner is recorded
 * against the selection, a keyword is marked reviewed. Nothing is written
 * anywhere, nothing is queued, and nothing is deleted — there is deliberately
 * no destructive action in this bar, because a delete with nothing behind it
 * would be a lie about what the product can do (CLAUDE.md §4).
 *
 * Each action reports what it did rather than closing silently, so a bulk
 * change is never something the user has to go and verify.
 */
export function BulkActions({
  count,
  lists,
  clusters,
  onClear,
  onAddToList,
  onCreateList,
  onAssignAgent,
  onAddToCluster,
  onMarkReviewed,
  onAddToContentPlan,
  notice,
}: {
  count: number;
  lists: readonly KeywordList[];
  clusters: readonly { readonly id: string; readonly label: string }[];
  onClear: () => void;
  onAddToList: (listId: string) => void;
  onCreateList: (name: string) => void;
  onAssignAgent: (agent: AgentId) => void;
  onAddToCluster: (clusterId: string) => void;
  onMarkReviewed: () => void;
  onAddToContentPlan: () => void;
  /** Confirmation of the last action, cleared by the workspace. */
  notice: string | null;
}) {
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [agent, setAgent] = useState<AgentId>("keyword-intent");
  const [clusterId, setClusterId] = useState(clusters[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const listSelectId = useId();
  const agentSelectId = useId();
  const clusterSelectId = useId();
  const newListId = useId();

  if (count === 0) return null;

  const createList = () => {
    const name = newName.trim();
    if (name.length === 0) return;
    onCreateList(name);
    setNewName("");
    setCreating(false);
  };

  return (
    <div className="border-b border-accent/25 bg-accent-soft/40 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <span className="inline-flex items-center gap-2 text-[12.5px] font-medium text-fg">
          <Icon name="check" className="h-4 w-4 text-accent" />
          {count} keyword{count === 1 ? "" : "s"} selected
        </span>

        <span aria-hidden="true" className="hidden h-5 w-px bg-border sm:block" />

        <span className="flex items-center gap-1.5">
          <label htmlFor={listSelectId} className="sr-only">
            List to add the selection to
          </label>
          <span className="block w-40">
            <Select
              id={listSelectId}
              size="sm"
              value={listId}
              onChange={(event) => setListId(event.target.value)}
              options={lists.map((list) => ({
                value: list.id,
                label: list.name,
              }))}
            />
          </span>
          <Button
            icon="list"
            onClick={() => onAddToList(listId)}
            disabled={listId === ""}
          >
            Add to list
          </Button>
        </span>

        <span className="flex items-center gap-1.5">
          <label htmlFor={agentSelectId} className="sr-only">
            Agent to assign the selection to
          </label>
          <span className="block w-44">
            <Select
              id={agentSelectId}
              size="sm"
              value={agent}
              onChange={(event) => setAgent(event.target.value as AgentId)}
              options={AGENT_IDS.map((id) => ({
                value: id,
                label: AGENT_NAMES[id],
              }))}
            />
          </span>
          <Button icon="agents" onClick={() => onAssignAgent(agent)}>
            Assign
          </Button>
        </span>

        <span className="flex items-center gap-1.5">
          <label htmlFor={clusterSelectId} className="sr-only">
            Cluster to add the selection to
          </label>
          <span className="block w-48">
            <Select
              id={clusterSelectId}
              size="sm"
              value={clusterId}
              onChange={(event) => setClusterId(event.target.value)}
              options={clusters.map((cluster) => ({
                value: cluster.id,
                label: cluster.label,
              }))}
            />
          </span>
          <Button
            icon="layers"
            onClick={() => onAddToCluster(clusterId)}
            disabled={clusterId === ""}
          >
            Add to cluster
          </Button>
        </span>

        <Button icon="content" onClick={onAddToContentPlan}>
          Add to content plan
        </Button>

        <Button icon="check" onClick={onMarkReviewed}>
          Mark reviewed
        </Button>

        {creating ? (
          <span className="flex items-center gap-1.5">
            <label htmlFor={newListId} className="sr-only">
              Name for the new list
            </label>
            <span className="block w-44">
              <TextInput
                id={newListId}
                size="sm"
                value={newName}
                autoFocus
                placeholder="New list name"
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") createList();
                  if (event.key === "Escape") setCreating(false);
                }}
              />
            </span>
            <Button
              variant="primary"
              onClick={createList}
              disabled={newName.trim().length === 0}
            >
              Create
            </Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button variant="ghost" icon="plus" onClick={() => setCreating(true)}>
            New list from selection
          </Button>
        )}

        <span aria-hidden="true" className="flex-1" />

        <Button variant="ghost" icon="close" onClick={onClear}>
          Clear selection
        </Button>
      </div>

      <p aria-live="polite" className="mt-2 text-[11.5px] text-fg-subtle">
        {notice ??
          "Bulk actions change this session only — nothing is saved, queued, or deleted."}
      </p>
    </div>
  );
}
