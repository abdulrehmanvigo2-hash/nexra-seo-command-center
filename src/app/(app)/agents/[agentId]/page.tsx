import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentWorkspace } from "@/components/agents/agent-workspace";
import { getAgentIds, getAgentRecord } from "@/lib/mock/agents";

type PageParams = { params: Promise<{ agentId: string }> };

/**
 * All twelve agents are prerendered, and only those: the registry is a fixed
 * set, so an id that is not in it is a broken link rather than an agent that
 * has not been built yet.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return getAgentIds().map((agentId) => ({ agentId }));
}

export async function generateMetadata({
  params,
}: PageParams): Promise<Metadata> {
  const { agentId } = await params;
  const agent = getAgentRecord(agentId);

  if (!agent) {
    return { title: "Agent not found" };
  }

  return {
    title: agent.name,
    description: `${agent.title}. ${agent.description}`,
  };
}

export default async function AgentPage({ params }: PageParams) {
  const { agentId } = await params;

  if (!getAgentRecord(agentId)) {
    notFound();
  }

  return <AgentWorkspace agentId={agentId} />;
}
