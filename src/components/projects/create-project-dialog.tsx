"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Field, Select, TextArea, TextInput } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/cn";
import { DOMAIN_PATTERN, MAX_COMPETITORS } from "@/lib/projects/intake-rules";
import {
  INDUSTRY_OPTIONS,
  LANGUAGE_OPTIONS,
  MARKET_OPTIONS,
  PROJECT_GOAL_META,
  PROJECT_GOAL_ORDER,
  PROJECT_TYPE_META,
  PROJECT_TYPE_ORDER,
} from "@/lib/mock/projects";
import type {
  NewProjectInput,
  ProjectGoal,
  ProjectType,
} from "@/types/project";

/**
 * Project intake.
 *
 * Two steps rather than one long form: what the project is, then where it
 * competes and what it is for. Each step validates before it advances, so a
 * mistake is caught next to the field that caused it.
 *
 * The dialog validates in the browser, then hands the submission to its owner
 * and waits. Where the project store persists, that is a server write: the
 * form shows it is working, ignores a second submit, stays open on failure
 * with the reason next to the field that caused it, and closes only once the
 * project is saved. Where it does not, the project is kept for the session and
 * the copy says so rather than implying it is saved anywhere.
 */

/** What the owner reports back after a submission. */
export type CreateProjectOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** Field messages, e.g. from server-side validation. */
      readonly errors?: Readonly<Partial<Record<keyof NewProjectInput, string>>>;
      /** A message about the submission as a whole. */
      readonly message?: string;
    };

const UNEXPECTED_FAILURE =
  "The project could not be saved, so nothing was created. Try again in a moment.";


type Draft = {
  name: string;
  url: string;
  client: string;
  industry: string;
  market: string;
  language: string;
  type: ProjectType;
  goal: ProjectGoal;
  targetLocation: string;
  competitors: string[];
  notes: string;
};

const EMPTY: Draft = {
  name: "",
  url: "",
  client: "",
  industry: INDUSTRY_OPTIONS[0],
  market: MARKET_OPTIONS[0],
  language: LANGUAGE_OPTIONS[0],
  type: "saas",
  goal: "organic-traffic",
  targetLocation: "",
  competitors: [""],
  notes: "",
};

type Errors = Partial<Record<"name" | "url" | "client" | "competitors", string>>;

/** Field order on screen, so "the first problem" means the topmost one. */
const FOCUS_ORDER: readonly (keyof Errors)[] = [
  "name",
  "url",
  "client",
  "competitors",
];

function validateStepOne(draft: Draft): Errors {
  const errors: Errors = {};

  if (draft.name.trim().length < 2) {
    errors.name = "Give the project a name of at least two characters.";
  }
  if (draft.url.trim().length === 0) {
    errors.url = "A website is required — it is what gets crawled.";
  } else if (!DOMAIN_PATTERN.test(draft.url.trim())) {
    errors.url = "Enter a domain or full URL, for example acme.example.";
  }
  if (draft.client.trim().length === 0) {
    errors.client = "Name the client this project is delivered for.";
  }

  return errors;
}

function validateStepTwo(draft: Draft): Errors {
  const errors: Errors = {};
  const invalid = draft.competitors
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !DOMAIN_PATTERN.test(entry));

  if (invalid.length > 0) {
    errors.competitors = `Not a valid domain: ${invalid.join(", ")}`;
  }

  return errors;
}

export function CreateProjectDialog({
  onClose,
  onCreate,
  persists,
}: {
  onClose: () => void;
  onCreate: (
    input: NewProjectInput,
  ) => CreateProjectOutcome | Promise<CreateProjectOutcome>;
  /** Whether a created project is saved, or kept for this session only. */
  persists: boolean;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  // Guards against a second submit before the first has answered; a ref, so
  // the check does not wait for a render.
  const inFlight = useRef(false);

  const fieldId = useId();
  const formId = `${fieldId}-form`;
  const id = (name: string) => `${fieldId}-${name}`;

  /**
   * Move to the field that failed, once the render that shows the message has
   * happened. It cannot be done inline in the handler: a failure on step two
   * can send the user back to step one, and those inputs are not in the
   * document until React has re-rendered.
   *
   * The pending target is a ref rather than state — it is a one-shot
   * instruction to the DOM, not something the component renders, and clearing
   * it must not cost another render.
   */
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;

    pendingFocus.current = null;
    document.getElementById(target)?.focus();
  }, [errors, step]);

  const focusFirstError = (found: Errors) => {
    const first = FOCUS_ORDER.find((key) => found[key]);
    if (!first) return;
    pendingFocus.current = id(first === "competitors" ? "competitor-0" : first);
  };

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const setCompetitor = (index: number, value: string) => {
    setDraft((current) => ({
      ...current,
      competitors: current.competitors.map((entry, position) =>
        position === index ? value : entry,
      ),
    }));
    setErrors((current) => ({ ...current, competitors: undefined }));
  };

  const addCompetitor = () =>
    setDraft((current) =>
      current.competitors.length >= MAX_COMPETITORS
        ? current
        : { ...current, competitors: [...current.competitors, ""] },
    );

  const removeCompetitor = (index: number) =>
    setDraft((current) => ({
      ...current,
      competitors: current.competitors.filter(
        (_, position) => position !== index,
      ),
    }));

  const goToStepTwo = () => {
    const found = validateStepOne(draft);
    setErrors(found);

    if (Object.keys(found).length === 0) {
      setStep(2);
      return;
    }

    focusFirstError(found);
  };

  const submit = async () => {
    if (inFlight.current) return;

    const found = { ...validateStepOne(draft), ...validateStepTwo(draft) };
    setErrors(found);
    setFormError(null);

    if (Object.keys(found).length > 0) {
      // Anything wrong at this point belongs to the first step.
      if (found.name || found.url || found.client) setStep(1);
      focusFirstError(found);
      return;
    }

    inFlight.current = true;
    setSubmitting(true);

    let outcome: CreateProjectOutcome;
    try {
      outcome = await onCreate({
        name: draft.name.trim(),
        url: draft.url.trim(),
        client: draft.client.trim(),
        industry: draft.industry,
        market: draft.market,
        language: draft.language,
        type: draft.type,
        goal: draft.goal,
        targetLocation: draft.targetLocation.trim() || draft.market,
        competitors: draft.competitors
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
        notes: draft.notes.trim(),
      });
    } catch {
      outcome = { ok: false, message: UNEXPECTED_FAILURE };
    }

    // On success the owner closes the dialog; there is nothing left to update.
    if (outcome.ok) return;

    inFlight.current = false;
    setSubmitting(false);

    // Messages for fields this form shows go next to them; anything else is
    // reported for the submission as a whole.
    const returned = outcome.errors ?? {};
    const fieldErrors: Errors = {
      name: returned.name,
      url: returned.url,
      client: returned.client,
      competitors: returned.competitors,
    };
    const shown = new Set<string>(FOCUS_ORDER);
    const other = Object.entries(returned)
      .filter(([key, value]) => !shown.has(key) && Boolean(value))
      .map(([, value]) => value);

    setErrors(fieldErrors);
    const summary = [outcome.message, ...other].filter(Boolean).join(" ");
    setFormError(summary || null);

    if (fieldErrors.name || fieldErrors.url || fieldErrors.client) setStep(1);
    focusFirstError(fieldErrors);
  };

  return (
    <Modal
      size="lg"
      title="Create project"
      description={
        persists
          ? "Set up a new client project. It is saved to this workspace and listed as awaiting its first crawl until reporting data exists."
          : "Set up a new client project. Nothing is sent anywhere — the project is added to this session only."
      }
      onClose={() => {
        // A write in progress is not interrupted by Escape or the backdrop.
        if (!inFlight.current) onClose();
      }}
      footer={
        <>
          <p className="mr-auto hidden text-[11.5px] text-fg-subtle sm:block">
            Step {step} of 2
          </p>
          {step === 1 ? (
            <>
              <Button onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" form={formId} variant="primary">
                Continue
                <Icon name="arrow-right" className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button
                icon="arrow-left"
                onClick={() => setStep(1)}
                disabled={submitting}
              >
                Back
              </Button>
              {/*
                Marked busy rather than disabled while saving: disabling the
                focused button would drop keyboard focus out of the dialog.
                The in-flight guard is what refuses a second submit.
              */}
              <Button
                type="submit"
                form={formId}
                variant="primary"
                icon={submitting ? "refresh" : "plus"}
                aria-disabled={submitting || undefined}
              >
                {submitting ? "Creating…" : "Create project"}
              </Button>
            </>
          )}
        </>
      }
    >
      {/*
        A real form, so Enter does the obvious thing from any field: finish
        step one, or create the project. `noValidate` keeps the browser's own
        bubbles out of the way — this form reports failures through `Field`,
        next to the control that caused them.

        The action buttons live in the modal's footer, which is a sibling of
        this element rather than a descendant, so they join the form by id.
      */}
      <form
        id={formId}
        noValidate
        aria-busy={submitting || undefined}
        onSubmit={(event) => {
          event.preventDefault();
          if (step === 1) goToStepTwo();
          else void submit();
        }}
      >
        {formError && (
          <p
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-md border border-critical/30 bg-critical/10 px-3 py-2.5 text-[12px] leading-relaxed text-critical"
          >
            <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{formError}</span>
          </p>
        )}
        <ol className="mb-5 flex items-center gap-2">
          <StepChip index={1} label="Project details" current={step} />
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
          <StepChip index={2} label="Targeting and goals" current={step} />
        </ol>

        {step === 1 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Project name"
              htmlFor={id("name")}
              required
              error={errors.name}
              className="sm:col-span-2"
            >
              <TextInput
                id={id("name")}
                value={draft.name}
                invalid={Boolean(errors.name)}
                onChange={(event) => update("name", event.target.value)}
                placeholder="Halcyon Fintech"
                autoComplete="off"
              />
            </Field>

            <Field
              label="Website URL"
              htmlFor={id("url")}
              required
              error={errors.url}
              hint="The domain the crawler starts from."
            >
              <TextInput
                id={id("url")}
                value={draft.url}
                invalid={Boolean(errors.url)}
                onChange={(event) => update("url", event.target.value)}
                placeholder="halcyon.example"
                autoComplete="off"
                inputMode="url"
              />
            </Field>

            <Field
              label="Client name"
              htmlFor={id("client")}
              required
              error={errors.client}
            >
              <TextInput
                id={id("client")}
                value={draft.client}
                invalid={Boolean(errors.client)}
                onChange={(event) => update("client", event.target.value)}
                placeholder="Halcyon Financial Group"
                autoComplete="off"
              />
            </Field>

            <Field label="Industry" htmlFor={id("industry")}>
              <Select
                id={id("industry")}
                value={draft.industry}
                onChange={(event) => update("industry", event.target.value)}
                options={INDUSTRY_OPTIONS.map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </Field>

            <Field
              label="Project type"
              htmlFor={id("type")}
              hint="Sets which agents are assigned first."
            >
              <Select
                id={id("type")}
                value={draft.type}
                onChange={(event) =>
                  update("type", event.target.value as ProjectType)
                }
                options={PROJECT_TYPE_ORDER.map((type) => ({
                  value: type,
                  label: PROJECT_TYPE_META[type].label,
                }))}
              />
            </Field>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Country / market" htmlFor={id("market")}>
              <Select
                id={id("market")}
                value={draft.market}
                onChange={(event) => update("market", event.target.value)}
                options={MARKET_OPTIONS.map((value) => ({ value, label: value }))}
              />
            </Field>

            <Field label="Primary language" htmlFor={id("language")}>
              <Select
                id={id("language")}
                value={draft.language}
                onChange={(event) => update("language", event.target.value)}
                options={LANGUAGE_OPTIONS.map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </Field>

            <Field
              label="Target location"
              htmlFor={id("location")}
              hint="Where rankings are measured. Defaults to the market."
            >
              <TextInput
                id={id("location")}
                value={draft.targetLocation}
                onChange={(event) => update("targetLocation", event.target.value)}
                placeholder="London, United Kingdom"
                autoComplete="off"
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
              label="Competitors"
              htmlFor={id("competitor-0")}
              error={errors.competitors}
              hint={`Up to ${MAX_COMPETITORS} domains to track against. Optional.`}
              className="sm:col-span-2"
            >
              <div className="space-y-2">
                {draft.competitors.map((competitor, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <TextInput
                      id={id(`competitor-${index}`)}
                      value={competitor}
                      invalid={Boolean(errors.competitors)}
                      onChange={(event) => setCompetitor(index, event.target.value)}
                      placeholder="northpeak.example"
                      autoComplete="off"
                      aria-label={`Competitor ${index + 1}`}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeCompetitor(index)}
                      disabled={draft.competitors.length === 1}
                      aria-label={`Remove competitor ${index + 1}`}
                    >
                      <Icon name="minus" className="h-4 w-4" />
                    </Button>
                  </div>
                ))}

                <Button
                  icon="plus"
                  onClick={addCompetitor}
                  disabled={draft.competitors.length >= MAX_COMPETITORS}
                >
                  Add competitor
                </Button>
              </div>
            </Field>

            <Field
              label="Notes"
              htmlFor={id("notes")}
              hint="Anything the team should know before the first sprint."
              className="sm:col-span-2"
            >
              <TextArea
                id={id("notes")}
                rows={3}
                value={draft.notes}
                onChange={(event) => update("notes", event.target.value)}
                placeholder="Migration planned for November. Avoid comparative claims in published copy."
              />
            </Field>
          </div>
        )}
      </form>
    </Modal>
  );
}

function StepChip({
  index,
  label,
  current,
}: {
  index: 1 | 2;
  label: string;
  current: 1 | 2;
}) {
  const done = current > index;
  const active = current === index;

  return (
    <li
      aria-current={active ? "step" : undefined}
      className={cn(
        "inline-flex items-center gap-2 text-[12px] font-medium",
        active ? "text-fg" : "text-fg-subtle",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex h-5 w-5 items-center justify-center rounded-full border text-[10.5px]",
          active && "border-accent bg-accent-soft text-accent",
          done && "border-positive/40 bg-positive/10 text-positive",
          !active && !done && "border-border-strong text-fg-subtle",
        )}
      >
        {done ? <Icon name="check" className="h-3 w-3" /> : index}
      </span>
      {label}
    </li>
  );
}
