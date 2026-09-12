"use client";

import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Meter } from "@/components/ui/meter";
import {
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
} from "@/components/ui/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import {
  AGENT_ACCESS_NOTE,
  AGENT_DIRECTIVE_META,
  AGENT_PURPOSE_META,
  getAgent,
} from "@/lib/mock/technical";
import type { AgentAccessSummary, AiAgentId } from "@/types/technical";

/**
 * Whether generative crawlers may fetch the site.
 *
 * Sits under Crawlability because that is the question it answers, and
 * alongside the existing crawl reading rather than replacing it: Googlebot and
 * GPTBot are governed by different rules, and a site can be wide open to one
 * and shut to the other.
 *
 * The table leads with what each agent is *for*. That ordering is the whole
 * point — an account team reading "GPTBot: blocked" and reaching for a fix
 * would be undoing a deliberate licensing decision, while "OAI-SearchBot:
 * blocked" genuinely costs the client answers.
 */
export function AgentAccessPanel({ access }: { access: AgentAccessSummary }) {
  const grouped = groupByAgent(access);

  return (
    <Panel>
      <PanelHeader
        eyebrow="Generative crawlers"
        title="Can answer engines fetch the site"
        description="Crawlability for the agents that feed generated answers. A separate question from Googlebot, governed by separate rules."
        actions={
          <div className="flex items-center gap-2">
            <span className="tabular text-[13px] font-semibold text-fg">
              {access.score}
            </span>
            <span className="text-[11px] text-fg-subtle">/ 100</span>
          </div>
        }
      />

      <PanelBody className="space-y-3">
        <div className="flex items-center gap-3">
          <Meter
            value={access.score}
            tone={
              access.retrievalBlocked.length > 0
                ? "critical"
                : access.score >= 80
                  ? "positive"
                  : "warning"
            }
            label={`Generative crawler access ${access.score} out of 100`}
          />
        </div>

        <p
          className={cn(
            "rounded-md border px-3 py-2.5 text-[12px] leading-relaxed",
            access.retrievalBlocked.length > 0
              ? "border-critical/30 bg-critical/10 text-critical"
              : "border-border bg-surface-raised text-fg-muted",
          )}
        >
          {access.summary}
        </p>
      </PanelBody>

      <Table caption="robots.txt directives for generative crawlers">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Agent</TableHeaderCell>
            <TableHeaderCell>Fetches for</TableHeaderCell>
            <TableHeaderCell>Directive</TableHeaderCell>
            <TableHeaderCell align="right">Pages shut out</TableHeaderCell>
            <TableHeaderCell>What the rule does</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {grouped.map((row) => {
            const agent = getAgent(row.agent);
            const directive = AGENT_DIRECTIVE_META[row.directive];
            const purpose = AGENT_PURPOSE_META[agent.purpose];

            return (
              <TableRow key={row.agent}>
                <TableCell header>
                  <span className="flex flex-col gap-0.5">
                    <span className="font-mono text-[12px] font-medium text-fg">
                      {agent.label}
                    </span>
                    <span className="text-[11px] text-fg-subtle">
                      {agent.vendor}
                    </span>
                  </span>
                </TableCell>

                <TableCell>
                  <Badge
                    tone={purpose.tone}
                    title={purpose.description}
                  >
                    {purpose.label}
                  </Badge>
                </TableCell>

                <TableCell>
                  <Badge tone={directive.tone} dot title={directive.description}>
                    {directive.label}
                    {row.projects > 1 && (
                      <span className="tabular ml-1 text-[10.5px] opacity-70">
                        ×{row.projects}
                      </span>
                    )}
                  </Badge>
                </TableCell>

                <TableCell align="right" numeric>
                  {row.blockedPages === 0 ? (
                    <span className="text-fg-subtle">—</span>
                  ) : (
                    row.blockedPages
                  )}
                </TableCell>

                <TableCell>
                  <span className="text-[11.5px] leading-snug text-fg-subtle">
                    {row.note}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <PanelFooter>
        <span className="inline-flex items-start gap-1.5">
          <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {AGENT_ACCESS_NOTE}
        </span>
      </PanelFooter>
    </Panel>
  );
}

type Row = {
  readonly agent: AiAgentId;
  readonly directive: AgentAccessSummary["directives"][number]["directive"];
  readonly blockedPages: number;
  readonly note: string;
  /** How many projects this row stands for, in a portfolio selection. */
  readonly projects: number;
};

/**
 * One row per agent.
 *
 * Across a portfolio the directives differ by project, so the row reports the
 * worst of them — the state an account team would need to look at — with the
 * project count beside it rather than nine rows for one agent.
 */
function groupByAgent(access: AgentAccessSummary): readonly Row[] {
  const RANK = { disallowed: 0, partial: 1, unspecified: 2, allowed: 3 };
  const byAgent = new Map<AiAgentId, Row>();

  for (const entry of access.directives) {
    const current = byAgent.get(entry.agent);
    if (current === undefined) {
      byAgent.set(entry.agent, {
        agent: entry.agent,
        directive: entry.directive,
        blockedPages: entry.blockedPages,
        note: entry.note,
        projects: 1,
      });
      continue;
    }

    const worse = RANK[entry.directive] < RANK[current.directive];
    byAgent.set(entry.agent, {
      agent: entry.agent,
      directive: worse ? entry.directive : current.directive,
      blockedPages: current.blockedPages + entry.blockedPages,
      note: worse ? entry.note : current.note,
      projects: current.projects + 1,
    });
  }

  return [...byAgent.values()];
}
