"use client";

import { useId, useState } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/field";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import {
  INDUSTRY_OPTIONS,
  LANGUAGE_OPTIONS,
  MARKET_OPTIONS,
  PROJECT_GOAL_META,
  PROJECT_GOAL_ORDER,
  PROJECT_STATUS_META,
  PROJECT_STATUS_ORDER,
} from "@/lib/mock/projects";
import type {
  ProjectGoal,
  ProjectSettings as Settings,
  ProjectStatus,
} from "@/types/project";

/**
 * Editable project information.
 *
 * Non-sensitive fields only: what the project is called, who it is for, where
 * it competes, and what state the engagement is in. There are no credentials,
 * no integrations, and no destructive operations here — those need a backend
 * and explicit approval (CLAUDE.md §6, §7).
 *
 * Saving updates the workspace's own state, so the header above changes with
 * it. Nothing is persisted.
 */

const DOMAIN_PATTERN = /^([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i;

type Errors = Partial<Record<"name" | "client" | "domain", string>>;

function validate(draft: Settings): Errors {
  const errors: Errors = {};

  if (draft.name.trim().length < 2) {
    errors.name = "Give the project a name of at least two characters.";
  }
  if (draft.client.trim().length === 0) {
    errors.client = "Name the client this project is delivered for.";
  }
  if (!DOMAIN_PATTERN.test(draft.domain.trim())) {
    errors.domain = "Enter a domain, for example halcyon.example.";
  }

  return errors;
}

export function ProjectSettingsPanel({
  settings,
  onSave,
  savedAt,
}: {
  settings: Settings;
  onSave: (next: Settings) => void;
  /** Set after a successful save, cleared when the confirmation expires. */
  savedAt: string | null;
}) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [errors, setErrors] = useState<Errors>({});

  const fieldId = useId();
  const id = (name: string) => `${fieldId}-${name}`;

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const dirty = (Object.keys(draft) as (keyof Settings)[]).some(
    (key) => draft[key] !== settings[key],
  );

  const submit = () => {
    const found = validate(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    onSave({
      ...draft,
      name: draft.name.trim(),
      client: draft.client.trim(),
      domain: draft.domain.trim(),
    });
  };

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          eyebrow="Configuration"
          title="Project Settings"
          description="Project information used across the workspace. Changes apply to this session."
        />

        <PanelBody>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className="grid gap-4 sm:grid-cols-2"
          >
            <Field
              label="Project name"
              htmlFor={id("name")}
              required
              error={errors.name}
            >
              <TextInput
                id={id("name")}
                value={draft.name}
                invalid={Boolean(errors.name)}
                onChange={(event) => update("name", event.target.value)}
              />
            </Field>

            <Field
              label="Client"
              htmlFor={id("client")}
              required
              error={errors.client}
            >
              <TextInput
                id={id("client")}
                value={draft.client}
                invalid={Boolean(errors.client)}
                onChange={(event) => update("client", event.target.value)}
              />
            </Field>

            <Field
              label="Domain"
              htmlFor={id("domain")}
              required
              error={errors.domain}
              hint="The property the crawler and rank tracking run against."
            >
              <TextInput
                id={id("domain")}
                value={draft.domain}
                invalid={Boolean(errors.domain)}
                onChange={(event) => update("domain", event.target.value)}
              />
            </Field>

            <Field label="Industry" htmlFor={id("industry")}>
              <Select
                id={id("industry")}
                value={draft.industry}
                onChange={(event) => update("industry", event.target.value)}
                options={optionsFor(INDUSTRY_OPTIONS, draft.industry)}
              />
            </Field>

            <Field label="Market" htmlFor={id("market")}>
              <Select
                id={id("market")}
                value={draft.market}
                onChange={(event) => update("market", event.target.value)}
                options={optionsFor(MARKET_OPTIONS, draft.market)}
              />
            </Field>

            <Field label="Primary language" htmlFor={id("language")}>
              <Select
                id={id("language")}
                value={draft.language}
                onChange={(event) => update("language", event.target.value)}
                options={optionsFor(LANGUAGE_OPTIONS, draft.language)}
              />
            </Field>

            <Field label="Main SEO goal" htmlFor={id("goal")}>
              <Select
                id={id("goal")}
                value={draft.goal}
                onChange={(event) =>
                  update("goal", event.target.value as ProjectGoal)
                }
                options={PROJECT_GOAL_ORDER.map((goal) => ({
                  value: goal,
                  label: PROJECT_GOAL_META[goal].label,
                }))}
              />
            </Field>

            <Field
              label="Project status"
              htmlFor={id("status")}
              hint={PROJECT_STATUS_META[draft.status].description}
            >
              <Select
                id={id("status")}
                value={draft.status}
                onChange={(event) =>
                  update("status", event.target.value as ProjectStatus)
                }
                options={PROJECT_STATUS_ORDER.map((status) => ({
                  value: status,
                  label: PROJECT_STATUS_META[status].label,
                }))}
              />
            </Field>

            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <Button type="submit" variant="primary" icon="check" disabled={!dirty}>
                Save changes
              </Button>
              <Button
                onClick={() => {
                  setDraft(settings);
                  setErrors({});
                }}
                disabled={!dirty}
              >
                Discard
              </Button>

              <p aria-live="polite" className="text-[11.5px]">
                {savedAt ? (
                  <span className="inline-flex items-center gap-1.5 text-positive">
                    <Icon name="check" className="h-3.5 w-3.5" />
                    Saved to this session
                  </span>
                ) : dirty ? (
                  <span className="text-fg-subtle">Unsaved changes</span>
                ) : (
                  <span className="text-fg-subtle">No changes</span>
                )}
              </p>
            </div>
          </form>
        </PanelBody>

        <PanelFooter>
          <span>
            Fields here are project information only — no credentials, keys, or
            integrations.
          </span>
        </PanelFooter>
      </Panel>

      <Panel>
        <PanelHeader
          eyebrow="Not yet available"
          title="Data sources and access"
          description="Search Console is mapped to projects on the server by an administrator, not from this screen. Connecting analytics or a CMS needs explicit approval and is not built."
        />
        <PanelBody>
          <ul className="grid gap-2.5 sm:grid-cols-3">
            {[
              "Analytics and CMS connections",
              "Team access and per-project permissions",
              "Archiving and deleting a project",
            ].map((entry) => (
              <li
                key={entry}
                className="flex items-start gap-2.5 rounded-md border border-dashed border-border-strong bg-surface-raised px-3.5 py-3 text-[12px] leading-snug text-fg-subtle"
              >
                <Icon name="clock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {entry}
              </li>
            ))}
          </ul>
        </PanelBody>
      </Panel>
    </div>
  );
}

/**
 * Keeps a value that is not in the option list selectable, so an existing
 * project is never silently reassigned by opening its settings.
 */
function optionsFor(
  options: readonly string[],
  current: string,
): readonly { value: string; label: string }[] {
  const all = options.includes(current) ? options : [current, ...options];
  return all.map((value) => ({ value, label: value }));
}
