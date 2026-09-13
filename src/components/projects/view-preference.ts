"use client";

import {
  setPreference,
  usePreference,
  type RosterView,
} from "@/lib/preferences";

/**
 * Whether the project roster was last read as cards or as a table.
 *
 * The preference itself lives in the shared store (`@/lib/preferences`) so
 * Settings can show and change it alongside the others. This module stays as
 * the project module's own name for it — reading projects as a table says
 * nothing about how somebody wants to read anything else.
 */

export type ProjectView = RosterView;

export function setProjectView(view: ProjectView): void {
  setPreference("projectsView", view);
}

export function useProjectView(): ProjectView {
  return usePreference("projectsView");
}
