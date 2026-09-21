"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { updateProjectCompetitorsAction } from "@/app/(app)/projects/actions";
import { Icon } from "@/components/icons";
import { CompetitorCrawlsPanel } from "@/components/crawl/competitor-crawls-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import {
  MAX_COMPETITOR_DOMAINS,
  addCompetitorDomain,
  sameCompetitorDomains,
} from "@/lib/projects/competitor-domains";

/**
 * The competitor domains recorded for a project, edited and saved, with the
 * competitor crawl panel reading the saved list beneath.
 *
 * Two lists are kept apart on purpose. `persisted` is what the server holds,
 * handed in from the stored record on render and replaced only by what the
 * save action reports back. `draft` is what the operator is composing. A
 * draft entry is labelled unsaved and is not a crawl target, because the
 * crawl panel is given the persisted list and nothing else — the server
 * would refuse an unsaved domain anyway, but the panel must not offer one.
 *
 * Saving writes one field of one project through a Server Action that
 * confirms the operator and re-validates the list against the project's
 * stored domain. It crawls nothing and queues nothing.
 */

type SaveState =
  | { readonly status: "idle" }
  | { readonly status: "saving" }
  | { readonly status: "saved" }
  | { readonly status: "failed"; readonly message: string; readonly index: number | null };

function saveFailure(result: Awaited<ReturnType<typeof updateProjectCompetitorsAction>>): SaveState {
  if (result.ok) return { status: "saved" };
  switch (result.reason) {
    case "unauthorized":
      return { status: "failed", message: "Your session has ended. Reload the page to sign in again.", index: null };
    case "invalid":
      return { status: "failed", message: result.message, index: result.index };
    case "unknown-project":
      return { status: "failed", message: "This project no longer exists on the server.", index: null };
    case "unavailable":
      return { status: "failed", message: "Projects are not stored on this deployment, so the list cannot be saved.", index: null };
    case "rate-limited":
      return {
        status: "failed",
        message: `Too many saves. Wait ${result.retryAfterSeconds} second${result.retryAfterSeconds === 1 ? "" : "s"} and try again.`,
        index: null,
      };
    case "failed":
      return { status: "failed", message: "The list could not be saved. Nothing is known to have changed.", index: null };
  }
}

export function CompetitorDomainsSection({
  projectId,
  projectDomain,
  competitorDomains,
}: {
  projectId: string;
  projectDomain: string;
  /** The recorded list, read from the stored project on the server. */
  competitorDomains: readonly string[];
}) {
  const router = useRouter();
  const [persisted, setPersisted] = useState<readonly string[]>(competitorDomains);
  const [draft, setDraft] = useState<readonly string[]>(competitorDomains);
  const [entry, setEntry] = useState("");
  const [entryError, setEntryError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const inputId = useId();

  const dirty = !sameCompetitorDomains(draft, persisted);

  const add = () => {
    const added = addCompetitorDomain(draft, entry, projectDomain);
    if (!added.ok) {
      setEntryError(added.message);
      return;
    }
    setDraft(added.value);
    setEntry("");
    setEntryError(null);
    setSave({ status: "idle" });
  };

  const remove = (host: string) => {
    setDraft((current) => current.filter((item) => item !== host));
    setSave({ status: "idle" });
  };

  const discard = () => {
    setDraft(persisted);
    setEntry("");
    setEntryError(null);
    setSave({ status: "idle" });
  };

  const submit = async () => {
    if (save.status === "saving" || !dirty) return;
    setSave({ status: "saving" });
    let result: Awaited<ReturnType<typeof updateProjectCompetitorsAction>>;
    try {
      result = await updateProjectCompetitorsAction({ projectId, competitorDomains: draft });
    } catch {
      setSave({ status: "failed", message: "The save did not complete. Refresh before trying again.", index: null });
      return;
    }
    if (!result.ok) {
      setSave(saveFailure(result));
      return;
    }
    // What the server reports as stored is the list, canonical: the draft is
    // replaced by it rather than trusted.
    setPersisted(result.competitorDomains);
    setDraft(result.competitorDomains);
    setSave({ status: "saved" });
    // Re-render the server-fed props too, so a reload and this page agree.
    router.refresh();
  };

  return (
    <>
      <Panel>
        <PanelHeader
          eyebrow="Competitive set"
          title="Competitor domains"
          description={`The competitor domains recorded for this project, up to ${MAX_COMPETITOR_DOMAINS}. Saved domains are the only ones a competitor crawl can be asked for; saving records the list and starts nothing.`}
          actions={
            <Badge tone={dirty ? "warning" : "neutral"} dot>
              {dirty ? "Unsaved changes" : `${persisted.length} saved`}
            </Badge>
          }
        />

        <div className="border-b border-border px-4 py-3 sm:px-5">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
            className="flex flex-wrap items-start gap-2"
          >
            <div className="min-w-0 flex-1 sm:max-w-xs">
              <label htmlFor={inputId} className="sr-only">
                Competitor domain
              </label>
              <TextInput
                id={inputId}
                value={entry}
                invalid={Boolean(entryError)}
                onChange={(event) => {
                  setEntry(event.target.value);
                  setEntryError(null);
                }}
                placeholder="northpeak.example"
                autoComplete="off"
                disabled={draft.length >= MAX_COMPETITOR_DOMAINS || save.status === "saving"}
              />
              {entryError && (
                <p role="alert" className="mt-1.5 text-[11.5px] text-critical">
                  {entryError}
                </p>
              )}
            </div>
            <Button type="submit" icon="plus" disabled={draft.length >= MAX_COMPETITOR_DOMAINS || save.status === "saving"}>
              Add to list
            </Button>
          </form>
        </div>

        {draft.length === 0 ? (
          <p className="px-4 py-4 text-sm text-fg-subtle sm:px-5">
            No competitor domains are recorded for this project. Add a bare domain above, then save.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {draft.map((host) => {
              const saved = persisted.includes(host);
              return (
                <li key={host} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-mono text-[12.5px] text-fg">{host}</span>
                    {saved ? (
                      <Badge tone="neutral">Saved</Badge>
                    ) : (
                      <Badge tone="warning" title="Not a crawl target until the list is saved.">
                        Unsaved
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => remove(host)}
                    disabled={save.status === "saving"}
                    aria-label={`Remove ${host} from the list`}
                  >
                    <Icon name="minus" className="h-4 w-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        <PanelFooter>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon="check" onClick={submit} disabled={!dirty || save.status === "saving"} aria-busy={save.status === "saving"}>
              {save.status === "saving" ? "Saving…" : "Save competitor domains"}
            </Button>
            <Button variant="ghost" onClick={discard} disabled={!dirty || save.status === "saving"}>
              Discard changes
            </Button>
          </div>
          <span role="status" className={save.status === "failed" ? "text-critical" : undefined}>
            {save.status === "saved"
              ? "Saved. The list below is what the server holds."
              : save.status === "failed"
                ? `Not saved. ${save.message}`
                : dirty
                  ? "Changes are not saved until you save the list."
                  : "Removing a domain does not delete any crawl already recorded for it."}
          </span>
        </PanelFooter>
      </Panel>

      <CompetitorCrawlsPanel projectId={projectId} projectDomain={projectDomain} competitorDomains={persisted} />
    </>
  );
}
