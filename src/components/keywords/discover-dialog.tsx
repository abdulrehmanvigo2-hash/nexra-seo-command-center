"use client";

import { useId, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { formatCompact } from "@/lib/format";
import { LANGUAGE_OPTIONS, MARKET_OPTIONS } from "@/lib/mock/projects";
import { INTENT_META, INTENT_ORDER, runDiscovery } from "@/lib/mock/keywords";
import { IntentBadge } from "@/components/keywords/keyword-chrome";
import type {
  ImportedKeyword,
  KeywordDiscoveryResult,
  KeywordIntent,
} from "@/types/keyword";

/**
 * Expanding a seed topic into candidate keywords.
 *
 * A simulation, and it says so on every result. The suggestions are produced
 * by expanding the topic through a fixed set of query shapes, and the figures
 * beside them are arithmetic on the words rather than search data. Running the
 * same topic twice returns the same set, which is the point — it behaves like
 * a tool, not a random generator.
 *
 * Anything kept from a run is added the same way a paste is: pending, with no
 * measured metrics attached. That keeps one rule across both flows — nothing
 * enters the tracked set with numbers nobody measured.
 */
export function DiscoverDialog({
  projects,
  defaultProjectId,
  referenceIso,
  onClose,
  onAdd,
}: {
  projects: readonly { readonly id: string; readonly name: string }[];
  defaultProjectId: string;
  referenceIso: string;
  onClose: () => void;
  onAdd: (rows: readonly ImportedKeyword[]) => void;
}) {
  const [topic, setTopic] = useState("");
  const [projectId, setProjectId] = useState(
    defaultProjectId === "all" ? (projects[0]?.id ?? "") : defaultProjectId,
  );
  const [market, setMarket] = useState(MARKET_OPTIONS[0] ?? "United Kingdom");
  const [language, setLanguage] = useState(
    LANGUAGE_OPTIONS[0] ?? "English (UK)",
  );
  const [intentFocus, setIntentFocus] = useState<KeywordIntent | "all">("all");
  const [result, setResult] = useState<KeywordDiscoveryResult | null>(null);
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());

  const topicId = useId();
  const projectFieldId = useId();
  const marketId = useId();
  const languageId = useId();
  const intentId = useId();

  const projectName =
    projects.find((project) => project.id === projectId)?.name ?? "";

  const run = () => {
    if (topic.trim().length < 2) return;
    const next = runDiscovery({
      seedTopic: topic,
      projectId,
      market,
      language,
      intentFocus,
    });
    setResult(next);
    setKept(
      new Set(
        next.keywords
          .filter((entry) => !entry.alreadyTracked)
          .map((entry) => entry.id),
      ),
    );
  };

  const toggle = (id: string) =>
    setKept((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const add = () => {
    if (!result) return;

    const rows: ImportedKeyword[] = result.keywords
      .filter((entry) => kept.has(entry.id))
      .map((entry, index) => ({
        id: `discovered--${entry.id}--${index}`,
        keyword: entry.keyword,
        projectId,
        projectName,
        intent: entry.intent,
        status: "awaiting-research",
        note: `From a simulated discovery run on "${result.input.seedTopic}". Metrics still need researching.`,
        addedAt: referenceIso,
      }));

    onAdd(rows);
    onClose();
  };

  return (
    <Modal
      title="Discover keywords"
      description="Expand a seed topic into candidate keywords for a project."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-[11.5px] text-fg-subtle">
            {result
              ? `${kept.size} of ${result.keywords.length} suggestions selected`
              : "Run a search to see suggestions"}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="plus"
            disabled={!result || kept.size === 0}
            onClick={add}
          >
            Add {kept.size} to the research queue
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Seed topic"
            htmlFor={topicId}
            required
            hint="The subject to expand, e.g. “smart thermostat”."
            className="sm:col-span-2"
          >
            <TextInput
              id={topicId}
              value={topic}
              placeholder="smart thermostat"
              onChange={(event) => setTopic(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") run();
              }}
            />
          </Field>

          <Field label="Project" htmlFor={projectFieldId}>
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

          <Field label="Target market" htmlFor={marketId}>
            <Select
              id={marketId}
              value={market}
              onChange={(event) => setMarket(event.target.value)}
              options={MARKET_OPTIONS.map((option) => ({
                value: option,
                label: option,
              }))}
            />
          </Field>

          <Field label="Language" htmlFor={languageId}>
            <Select
              id={languageId}
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              options={LANGUAGE_OPTIONS.map((option) => ({
                value: option,
                label: option,
              }))}
            />
          </Field>

          <Field label="Intent focus" htmlFor={intentId}>
            <Select
              id={intentId}
              value={intentFocus}
              onChange={(event) =>
                setIntentFocus(event.target.value as KeywordIntent | "all")
              }
              options={[
                { value: "all", label: "Every intent" },
                ...INTENT_ORDER.map((intent) => ({
                  value: intent,
                  label: INTENT_META[intent].label,
                })),
              ]}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            icon="search"
            onClick={run}
            disabled={topic.trim().length < 2}
          >
            {result ? "Run again" : "Discover keywords"}
          </Button>
          {result && (
            <span className="text-[11.5px] text-fg-subtle">
              {result.keywords.length} suggestions ·{" "}
              {formatCompact(result.totalVolume)} simulated searches / mo ·{" "}
              {result.clusters.length} clusters
            </span>
          )}
        </div>

        {result && (
          <div className="rounded-md border border-border bg-surface-raised">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
              <p className="text-[12px] font-semibold text-fg">
                Suggestions for “{result.input.seedTopic}”
              </p>
              <Badge tone="warning">
                <Icon name="alert" className="h-3 w-3" />
                Simulated
              </Badge>
            </div>

            <ul className="max-h-64 divide-y divide-border overflow-y-auto">
              {result.keywords.map((entry) => (
                <li key={entry.id} className="px-3.5 py-2.5">
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={kept.has(entry.id)}
                      disabled={entry.alreadyTracked}
                      onChange={() => toggle(entry.id)}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-accent disabled:cursor-not-allowed"
                    />

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[12.5px] font-medium text-fg">
                          {entry.keyword}
                        </span>
                        <IntentBadge intent={entry.intent} />
                        <Badge tone="neutral">{entry.clusterName}</Badge>
                        {entry.alreadyTracked && (
                          <Badge tone="accent">Already tracked</Badge>
                        )}
                      </span>
                      <span className="mt-1 block text-[11.5px] text-fg-subtle">
                        {entry.rationale}
                      </span>
                    </span>

                    <span className="tabular shrink-0 text-right text-[11.5px] text-fg-subtle">
                      <span className="block">
                        ~{formatCompact(entry.estimatedVolume)} / mo
                      </span>
                      <span className="block">
                        difficulty ~{entry.estimatedDifficulty}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning/5 px-3 py-2.5 text-[11.5px] leading-relaxed text-fg-muted">
          <Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0 text-warning" />
          <span>
            <span className="font-medium text-fg">This is simulated data.</span>{" "}
            Suggestions are generated from query patterns, and the volume and
            difficulty beside them are derived from the words themselves — not
            from any search provider. Keywords added from a run enter the
            research queue with no metrics attached.
          </span>
        </p>
      </div>
    </Modal>
  );
}
