import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { AGENT_NAMES, getAgentRecord } from "@/lib/mock/agents";
import type { AgentCollaboration, AgentId } from "@/types/agent";

/**
 * Who works with whom.
 *
 * A table rather than a network graph: the useful questions are operational —
 * where does this agent's work come from, where does it go, and who else is on
 * the same accounts — and a table answers all three at a glance without adding
 * a graph library the product does not otherwise need.
 *
 * Upstream and downstream come from the registry's pipeline edges. Frequent
 * collaborators are counted from shared project assignments, so the column
 * reflects who an agent actually works alongside rather than an org chart.
 */
export function CollaborationMatrix({
  rows,
}: {
  rows: readonly AgentCollaboration[];
}) {
  return (
    <Panel>
      <PanelHeader
        eyebrow="Team"
        title="Agent Collaboration"
        description="Where each agent's work comes from, where it goes, and who it shares accounts with."
      />

      <Table caption="Agents with their upstream, downstream, and most frequent collaborators">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Agent</TableHeaderCell>
            <TableHeaderCell>Receives from</TableHeaderCell>
            <TableHeaderCell>Hands to</TableHeaderCell>
            <TableHeaderCell>Frequent collaborators</TableHeaderCell>
            <TableHeaderCell align="right">Workflows</TableHeaderCell>
            <TableHeaderCell align="right">Open handoffs</TableHeaderCell>
          </TableRow>
        </TableHead>

        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.agent}>
              <TableCell header className="max-w-[220px]">
                <Link
                  href={`/agents/${row.agent}`}
                  className="flex items-center gap-2.5 transition-colors hover:text-accent"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface-raised text-[10.5px] font-semibold text-fg-subtle"
                  >
                    {row.initials}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{row.name}</span>
                    <span className="block text-[11px] font-normal text-fg-subtle">
                      Stage {row.stage}
                    </span>
                  </span>
                </Link>
              </TableCell>

              <TableCell>
                <AgentLinks agents={row.upstream} />
              </TableCell>

              <TableCell>
                <AgentLinks agents={row.downstream} />
              </TableCell>

              <TableCell className="max-w-[280px]">
                <span className="flex flex-wrap gap-1.5">
                  {row.collaborators.slice(0, 3).map((entry) => (
                    <Badge key={entry.agent} tone="neutral">
                      {getAgentRecord(entry.agent)?.initials ?? "??"}
                      <span className="sr-only">
                        {AGENT_NAMES[entry.agent]},{" "}
                      </span>
                      <span className="tabular text-[10.5px] text-fg-subtle">
                        {entry.sharedProjects} shared
                      </span>
                    </Badge>
                  ))}
                  {row.collaborators.length === 0 && (
                    <span className="text-fg-subtle">
                      No shared engagements
                    </span>
                  )}
                </span>
              </TableCell>

              <TableCell numeric>{row.activeWorkflows}</TableCell>

              <TableCell numeric>
                {row.openHandoffs > 0 ? (
                  <span className="text-fg">{row.openHandoffs}</span>
                ) : (
                  <span className="text-fg-subtle">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <PanelFooter>
        <span>
          Upstream and downstream follow the twelve-stage loop; collaborators
          are counted from shared project assignments.
        </span>
        <span>{rows.length} agents</span>
      </PanelFooter>
    </Panel>
  );
}

function AgentLinks({ agents }: { agents: readonly AgentId[] }) {
  if (agents.length === 0) {
    return <span className="text-fg-subtle">—</span>;
  }

  return (
    <span className="flex flex-wrap gap-x-2 gap-y-1">
      {agents.map((agent) => (
        <Link
          key={agent}
          href={`/agents/${agent}`}
          className="inline-flex items-center gap-1 whitespace-nowrap text-fg-muted transition-colors hover:text-accent"
        >
          <Icon name="handoff" className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
          {AGENT_NAMES[agent]}
        </Link>
      ))}
    </span>
  );
}
