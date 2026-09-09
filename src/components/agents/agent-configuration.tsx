"use client";

import { useId, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/field";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import {
  AGENT_STATUS_META,
  AGENT_STATUS_ORDER,
} from "@/lib/mock/agents";
import type { AgentConfiguration, AgentStatus } from "@/types/agent";
import type { Priority } from "@/types/dashboard";

/**
 * Operational settings for one agent.
 *
 * Everything here is non-sensitive and descriptive: what the agent is called,
 * what state it is held in, how much work it will take at once, and whether a
 * person signs its output off. Saving updates this session's state and nothing
 * else.
 *
 * There is deliberately no model provider, no API key, no prompt editor, and
 * no autonomous-execution switch. Those need approval and a backend, and this
 * milestone has neither (CLAUDE.md §4, §6).
 */

const PRIORITY_OPTIONS: readonly { value: Priority; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const CAPACITY_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1),
  label: `${index + 1} task${index === 0 ? "" : "s"}`,
}));

export function AgentConfigurationPanel({
  configuration,
  onSave,
  savedAt,
  agentName,
}: {
  configuration: AgentConfiguration;
  onSave: (next: AgentConfiguration) => void;
  /** Set for a few seconds after a save, to confirm it landed. */
  savedAt: string | null;
  agentName: string;
}) {
  const [draft, setDraft] = useState<AgentConfiguration>(configuration);

  const nameId = useId();
  const statusId = useId();
  const priorityId = useId();
  const capacityId = useId();

  const dirty =
    draft.displayName !== configuration.displayName ||
    draft.status !== configuration.status ||
    draft.defaultPriority !== configuration.defaultPriority ||
    draft.maxConcurrent !== configuration.maxConcurrent ||
    draft.autoAssign !== configuration.autoAssign ||
    draft.reviewRequired !== configuration.reviewRequired;

  const nameError =
    draft.displayName.trim().length === 0 ? "A display name is required." : "";

  const change = (patch: Partial<AgentConfiguration>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const submit = () => {
    if (nameError) return;
    onSave({ ...draft, displayName: draft.displayName.trim() });
  };

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          eyebrow="Configuration"
          title="Agent Settings"
          description={`How ${agentName} is operated: naming, state, capacity, and review policy.`}
          actions={
            savedAt ? (
              <Badge tone="positive" dot>
                Saved
              </Badge>
            ) : dirty ? (
              <Badge tone="accent" dot>
                Unsaved changes
              </Badge>
            ) : undefined
          }
        />

        <PanelBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field
              label="Display name"
              htmlFor={nameId}
              required
              error={nameError || undefined}
              hint="Shown wherever this agent appears in the product."
            >
              <TextInput
                id={nameId}
                value={draft.displayName}
                invalid={Boolean(nameError)}
                onChange={(event) =>
                  change({ displayName: event.target.value })
                }
              />
            </Field>

            <Field
              label="Operational status"
              htmlFor={statusId}
              hint={AGENT_STATUS_META[draft.status].description}
            >
              <Select
                id={statusId}
                value={draft.status}
                onChange={(event) =>
                  change({ status: event.target.value as AgentStatus })
                }
                options={AGENT_STATUS_ORDER.map((status) => ({
                  value: status,
                  label: AGENT_STATUS_META[status].label,
                }))}
              />
            </Field>

            <Field
              label="Default priority"
              htmlFor={priorityId}
              hint="Priority new work is queued at."
            >
              <Select
                id={priorityId}
                value={draft.defaultPriority}
                onChange={(event) =>
                  change({ defaultPriority: event.target.value as Priority })
                }
                options={PRIORITY_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
              />
            </Field>

            <Field
              label="Max concurrent tasks"
              htmlFor={capacityId}
              hint="Work beyond this queues behind the current tasks."
            >
              <Select
                id={capacityId}
                value={String(draft.maxConcurrent)}
                onChange={(event) =>
                  change({ maxConcurrent: Number(event.target.value) })
                }
                options={CAPACITY_OPTIONS}
              />
            </Field>
          </div>

          <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
            <ToggleRow
              label="Assign to new projects automatically"
              hint="When on, this agent joins a project's team as soon as it is created."
              checked={draft.autoAssign}
              onChange={(autoAssign) => change({ autoAssign })}
            />
            <ToggleRow
              label="Require human review before hand-off"
              hint="Output waits for a person to release it to the next stage."
              checked={draft.reviewRequired}
              onChange={(reviewRequired) => change({ reviewRequired })}
            />
          </div>
        </PanelBody>

        <PanelFooter>
          <span>
            Changes are held in this session only — there is no backend behind
            this form yet.
          </span>
          <div className="flex items-center gap-2">
            {dirty && (
              <Button variant="ghost" onClick={() => setDraft(configuration)}>
                Discard
              </Button>
            )}
            <Button
              variant="primary"
              icon="check"
              onClick={submit}
              disabled={!dirty || Boolean(nameError)}
            >
              Save changes
            </Button>
          </div>
        </PanelFooter>
      </Panel>

      {/*
        The settings a real agent runtime would need are named here rather than
        left as an empty promise — and they are disabled, because adding any of
        them needs explicit approval (CLAUDE.md §6).
      */}
      <Panel>
        <PanelHeader
          eyebrow="Coming later"
          title="Model and execution settings"
          description="Provider selection, credentials, run schedules, and autonomous execution arrive with the backend."
        />
        <PanelBody>
          <ul className="grid gap-2 sm:grid-cols-2">
            {[
              "Model provider and version",
              "Run schedule and triggers",
              "Autonomous execution limits",
              "Tool and data-source access",
            ].map((item) => (
              <li
                key={item}
                className="flex items-center gap-2.5 rounded-md border border-border bg-surface-raised px-3 py-2.5 text-[12px] text-fg-subtle"
              >
                <Icon name="sliders" className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item}</span>
                <Badge tone="neutral">Not available</Badge>
              </li>
            ))}
          </ul>
        </PanelBody>
        <PanelFooter>
          <span>
            None of these are configurable in this milestone. Credentials and
            paid services need approval before they are added.
          </span>
        </PanelFooter>
      </Panel>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex items-start gap-3 rounded-md border px-3.5 py-3 text-left transition-colors",
        checked
          ? "border-accent/35 bg-accent-soft/40"
          : "border-border bg-surface-raised hover:border-border-strong",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full border p-0.5 transition-colors",
          checked ? "justify-end border-accent bg-accent/30" : "border-border-strong",
        )}
      >
        <span
          className={cn(
            "h-2.5 w-2.5 rounded-full transition-colors",
            checked ? "bg-accent" : "bg-fg-subtle",
          )}
        />
      </span>

      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium text-fg">{label}</span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-fg-subtle">
          {hint}
        </span>
      </span>
    </button>
  );
}
