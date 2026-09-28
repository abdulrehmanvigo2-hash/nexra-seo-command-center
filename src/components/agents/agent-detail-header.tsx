import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { ModelledSection } from "@/components/ui/modelled-badge";
import { Panel } from "@/components/ui/panel";
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
 *
 * Every figure here — status, load, last action, stage, queue, workload,
 * quality, outputs — comes from the fixture registry, so they sit together in
 * one block labelled Modelled (checkpoint 6.2, the 5.7 rule). The header has
 * no control: the page's live section is Run History below, and nothing here
 * starts, syncs or schedules an agent.
 */
export function AgentDetailHeader({
  agent,
  listItem,
  configuration,
  referenceIso,
}: {
  agent: Agent;
  listItem: AgentListItem;
  configuration: AgentConfiguration;
  referenceIso: string;
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

      <div className="flex min-w-0 items-start gap-3.5">
        <AgentMonogram
          initials={agent.initials}
          stage={agent.stage}
          size="lg"
        />

        <div className="min-w-0">
          <h2 className="text-[20px] leading-tight font-semibold tracking-tight text-fg">
            {configuration.displayName}
          </h2>

          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-subtle">
            <span className="inline-flex items-center gap-1.5">
              <Icon name={category.icon} className="h-3.5 w-3.5" />
              {agent.title}
            </span>
          </p>

          <p className="mt-2.5 max-w-3xl text-[12.5px] leading-relaxed text-fg-muted">
            {agent.responsibility}
          </p>
        </div>
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <ModelledSection name="Operating figures">
          <div className="flex flex-wrap items-center gap-2.5">
            <AgentStatusBadge status={configuration.status} />
            <Badge tone={workload.tone} dot>
              {workload.label} load
            </Badge>
            <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-subtle">
              <Icon name="clock" className="h-3.5 w-3.5" />
              Last action {formatRelative(listItem.lastActivity, referenceIso)}
            </span>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 xl:grid-cols-8">
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
        </ModelledSection>
      </div>

      <p className="mt-3.5 flex items-start gap-2 rounded-md border border-border bg-surface-raised px-3 py-2.5 text-[11.5px] leading-relaxed text-fg-subtle">
        <Icon name="info" className="mt-px h-3.5 w-3.5 shrink-0" />
        Nothing on this page starts an agent run. Run History lists this
        agent&apos;s stored runs; every section labelled Modelled is fixture
        data.
      </p>
    </Panel>
  );
}
