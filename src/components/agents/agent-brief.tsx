import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { AGENT_NAMES } from "@/lib/mock/agents";
import type { Agent } from "@/types/agent";

/**
 * The agent's operating brief.
 *
 * A plain summary of what the agent is for, written for the person running the
 * account: its mission, what it takes in, what it produces, what it checks
 * before handing work on, and when it stops and asks a human.
 *
 * Deliberately nothing else. There is no model configuration here, no
 * credentials, no private system prompt, and no simulated reasoning — this is
 * a description of a role, not the internals of one (Phase 4 scope §18).
 */
export function AgentBriefPanel({ agent }: { agent: Agent }) {
  const { brief } = agent;

  return (
    <Panel>
      <PanelHeader
        eyebrow="Operating brief"
        title="What this agent does"
        description="The role as it is briefed: inputs, outputs, quality checks, and when it escalates."
        actions={
          <Badge tone="neutral">
            <Icon name="brief" className="h-3 w-3" />
            Stage {agent.stage} of 12
          </Badge>
        }
      />

      <PanelBody className="space-y-4">
        <div className="rounded-md border border-accent/25 bg-accent-soft/50 px-4 py-3.5">
          <p className="text-[10.5px] font-medium tracking-[0.05em] text-fg-subtle uppercase">
            Mission
          </p>
          <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-fg">
            {brief.mission}
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <BriefList
            icon="arrow-right"
            title="Inputs it works from"
            items={brief.inputs}
          />
          <BriefList
            icon="layers"
            title="Outputs it produces"
            items={brief.outputs}
          />
          <BriefList
            icon="check"
            title="Quality checks before hand-off"
            items={brief.qualityChecks}
          />
          <BriefList
            icon="alert"
            title="When it escalates to a human"
            items={brief.escalation}
            tone="warning"
          />
        </div>

        <div className="grid gap-4 border-t border-border pt-4 lg:grid-cols-2">
          <BriefList
            icon="agents"
            title="Responsibilities"
            items={agent.responsibilities}
          />

          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-fg-muted">
              <Icon name="target" className="h-3.5 w-3.5 text-fg-subtle" />
              Specialties
            </p>
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {agent.specialties.map((specialty) => (
                <li key={specialty}>
                  <Badge tone="neutral">{specialty}</Badge>
                </li>
              ))}
            </ul>

            <p className="mt-4 flex items-center gap-1.5 text-[11.5px] font-semibold text-fg-muted">
              <Icon name="handoff" className="h-3.5 w-3.5 text-fg-subtle" />
              Position in the loop
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11.5px]">
              {agent.upstream.map((id) => (
                <Link
                  key={id}
                  href={`/agents/${id}`}
                  className="text-fg-subtle transition-colors hover:text-accent"
                >
                  {AGENT_NAMES[id]}
                </Link>
              ))}
              <Icon
                name="arrow-right"
                className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
              />
              <span className="font-medium text-fg">{agent.name}</span>
              <Icon
                name="arrow-right"
                className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
              />
              {agent.downstream.map((id) => (
                <Link
                  key={id}
                  href={`/agents/${id}`}
                  className="text-fg-subtle transition-colors hover:text-accent"
                >
                  {AGENT_NAMES[id]}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </PanelBody>

      <PanelFooter>
        <span>
          An operational description of the role. No model settings, credentials,
          or internal reasoning are held here.
        </span>
      </PanelFooter>
    </Panel>
  );
}

function BriefList({
  icon,
  title,
  items,
  tone = "default",
}: {
  icon: IconName;
  title: string;
  items: readonly string[];
  tone?: "default" | "warning";
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-fg-muted">
        <Icon
          name={icon}
          className={
            tone === "warning"
              ? "h-3.5 w-3.5 text-warning"
              : "h-3.5 w-3.5 text-fg-subtle"
          }
        />
        {title}
      </p>
      <ul className="mt-2.5 space-y-1.5">
        {items.map((item) => (
          <li
            key={item}
            className="flex items-start gap-2 text-[12px] leading-relaxed text-fg-muted"
          >
            <span
              aria-hidden="true"
              className={
                tone === "warning"
                  ? "mt-[7px] h-1 w-1 shrink-0 rounded-full bg-warning"
                  : "mt-[7px] h-1 w-1 shrink-0 rounded-full bg-fg-subtle"
              }
            />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
