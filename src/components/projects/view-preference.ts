"use client";

import { useSyncExternalStore } from "react";

/**
 * Remembers whether the roster was last read as cards or as a table.
 *
 * Backed by `localStorage` and read through `useSyncExternalStore` rather than
 * an effect: the server has no storage, so it renders the default, and React
 * swaps to the stored value after hydration without a mismatch warning and
 * without a state write inside an effect.
 *
 * A preference, not data — every failure path falls back to the default.
 */

export type ProjectView = "grid" | "table";

const STORAGE_KEY = "nexra.projects.view";
const DEFAULT_VIEW: ProjectView = "grid";

const listeners = new Set<() => void>();

/**
 * The snapshot React reads. Cached because `useSyncExternalStore` requires the
 * same value back on every call until the store actually changes.
 */
let snapshot: ProjectView | null = null;

function readSnapshot(): ProjectView {
  if (snapshot === null) {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      snapshot = stored === "table" || stored === "grid" ? stored : DEFAULT_VIEW;
    } catch {
      snapshot = DEFAULT_VIEW;
    }
  }
  return snapshot;
}

function readServerSnapshot(): ProjectView {
  return DEFAULT_VIEW;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function setProjectView(view: ProjectView): void {
  snapshot = view;
  try {
    window.localStorage.setItem(STORAGE_KEY, view);
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). The
    // preference simply does not survive a reload.
  }
  for (const listener of listeners) listener();
}

export function useProjectView(): ProjectView {
  return useSyncExternalStore(subscribe, readSnapshot, readServerSnapshot);
}
