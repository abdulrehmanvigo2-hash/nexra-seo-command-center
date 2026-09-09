import type { Metadata } from "next";
import { AgentsWorkspace } from "@/components/agents/agents-workspace";

export const metadata: Metadata = {
  title: "AI Agents",
  description:
    "The twelve specialist agents: roster, status, workload, orchestration pipeline, hand-offs, and outputs.",
};

export default function AgentsPage() {
  return <AgentsWorkspace />;
}
