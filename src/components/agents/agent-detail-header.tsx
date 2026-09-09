import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { formatCompact, formatRelative } from "@/lib/format";
import { AGENT_CATEGORY_META, WORKLOAD_META } from "@/lib/mock/agents";
import {
  AgentMonogram,
  AgentStatusBadge,
} from "@/components/agents/agent-chrome";
import type { Agent, AgentConfiguration, AgentListItem } from "@/types/agent";

/**
 * The identity block at the top of an agent's workspace.
 *
 * Reads the live configuration rather than the registry record for anything
 * the settings panel can change, so renaming an agent is visible here the
 * moment it is saved — a header that disagreed with the form below it would be
 * worse than no header at all.
 */
export function AgentDetailHeader({
  agent,
  listItem,
  configuration,
  referenceIso,
  queued,
  onRunSync,
}: {
  agent: Agent;
  listItem: AgentListItem;
  configuration: AgentConfiguration;
  referenceIso: string;
  /** True while the mocked sync notice is showing. */
  queued: boolean;
  onRunSync: () => void;
}) {
  const category = AGENT_CATEGORY_META[agent.category];
  const workload = WORKLOAD_META[listItem.workload.band];

  const facts: readonly { label: string; value: string }[] = [
    { label: "Stage", value: `${agent.stage} of 12` },
    { label: "Category", value: category.label },
    { label: "Projects", value: String(listItem.projects.length) },
    { label: "Active tasks", value: String(listItem.workload.activeTasks) },
    { label: "Queue", value: String(listItem.workload.queuedTasks) },
    { label: "Workload", value: `${listItem.workload.percent}%` },
    { label: "Quality", value: `${listItem.quality} / 100` },
    {
      label: "Outputs",
      value: `${formatCompact(listItem.completedOutputs)} ${agent.outputLabel}`,
    },
  ];

  return (
    <Panel as="div" className="p-4 sm:p-5">
      <nav aria-label="Breadcrumb" className="mb-3">
        <ol className="flex items-center gap-1.5 text-[11.5px] text-fg-subtle">
          <li>
            <Link
              href="/agents"
              className="transition-colors hover:text-fg-muted"
            >
              All agents
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="truncate text-fg-muted">
            {configuration.displayName}
          </li>
        </ol>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-start gap-3.5">
          <AgentMonogram
            initials={agent.initials}
            stage={agent.stage}
            size="lg"
          />

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-[20px] leading-tight font-semibold tracking-tight text-fg">
                {configuration.displayName}
              </h2>
              <AgentStatusBadge status={configuration.status} />
              <Badge tone={workload.tone} dot>
                {workload.label} load
              </Badge>
            </div>

            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-subtle">
              <span className="inline-flex items-center gap-1.5">
                <Icon name={category.icon} className="h-3.5 w-3.5" />
                {agent.title}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Icon name="clock" className="h-3.5 w-3.5" />
                Last action {formatRelative(listItem.lastActivity, referenceIso)}
              </span>
            </p>

            <p className="mt-2.5 max-w-3xl text-[12.5px] leading-relaxed text-fg-muted">
              {agent.responsibility}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="primary"
            icon="refresh"
            onClick={onRunSync}
            disabled={queued}
          >
            {queued ? "Sync queued" : "Run agent sync"}
          </Button>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 sm:grid-cols-4 xl:grid-cols-8">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="text-[10.5px] font-medium tracking-[0.05em] text-fg-subtle uppercase">
              {fact.label}
            </dt>
            <dd className="tabular mt-1 truncate text-[12.5px] font-medium text-fg">
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>

      <p
        aria-live="polite"
        className={cn(
          "mt-3.5 flex items-start gap-2 rounded-md border px-3 py-2.5 text-[11.5px] leading-relaxed",
          queued
            ? "border-accent/30 bg-accent-soft text-fg-muted"
            : "border-border bg-surface-raised text-fg-subtle",
        )}
      >
        <Icon
          name={queued ? "refresh" : "info"}
          className={cn("mt-px h-3.5 w-3.5 shrink-0", queued && "text-accent")}
        />
        {queued
          ? "Sync queued. The orchestration pass is mocked in this milestone — no agent runs, and the figures below are unchanged."
          : "Mock operating data. The agents are simulated in this milestone: nothing on this page executes a run."}
      </p>
    </Panel>
  );
}
