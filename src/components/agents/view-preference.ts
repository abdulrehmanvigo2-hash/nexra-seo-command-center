"use client";

import {
  setPreference,
  usePreference,
  type RosterView,
} from "@/lib/preferences";

/**
 * Whether the agent roster was last read as cards or as a table.
 *
 * The preference itself lives in the shared store (`@/lib/preferences`) so
 * Settings can show and change it alongside the others. This module stays as
 * the agent module's own name for it — reading agents as a table says
 * nothing about how somebody wants to read anything else.
 */

export type AgentView = RosterView;

export function setAgentView(view: AgentView): void {
  setPreference("agentsView", view);
}

export function useAgentView(): AgentView {
  return usePreference("agentsView");
}
