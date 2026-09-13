"use client";

import { useSyncExternalStore } from "react";
import {
  DASHBOARD_PROJECTS,
  DATE_RANGES,
  DEFAULT_PROJECT_ID,
  DEFAULT_RANGE_ID,
} from "@/lib/mock/dashboard";
import type { ProjectId, RangeId } from "@/types/dashboard";

/**
 * Every preference the product remembers, in one typed record.
 *
 * This generalises the pattern the Projects and Agents rosters already used:
 * `localStorage` read through `useSyncExternalStore`, so the server renders
 * the default, React swaps to the stored value after hydration without a
 * mismatch, and nothing writes state inside an effect. Those two modules now
 * read their view through here rather than keeping a store each.
 *
 * Preferences, not data. Storage can be unavailable — private windows, blocked
 * site data — and a stored blob can be from an older shape, so every read
 * falls back to the default rather than trusting what it finds. Nothing here
 * leaves the browser: there is no backend in this milestone (CLAUDE.md §4).
 */

export type RosterView = "grid" | "table";

export type Preferences = {
  /** Project the Command Center opens on, until something else is chosen. */
  readonly commandCenterProject: ProjectId;
  /** Reporting window the Command Center opens on. */
  readonly commandCenterRange: RangeId;
  /** Whether the project roster opens as cards or as a table. */
  readonly projectsView: RosterView;
  /** Whether the agent roster opens as cards or as a table. */
  readonly agentsView: RosterView;
  /** Suppress transitions and animation, regardless of the OS setting. */
  readonly reduceMotion: boolean;
};

export const DEFAULT_PREFERENCES: Preferences = {
  commandCenterProject: DEFAULT_PROJECT_ID,
  commandCenterRange: DEFAULT_RANGE_ID,
  projectsView: "grid",
  agentsView: "grid",
  reduceMotion: false,
};

/**
 * Versioned, so a future shape change starts from defaults instead of
 * inheriting a blob it cannot read.
 */
const STORAGE_KEY = "nexra.preferences.v1";

/**
 * Validators, one per key. A stored value is only accepted if it is still a
 * value the product offers — a project that has left the roster, or a range
 * that no longer exists, falls back rather than selecting nothing.
 */
const VALIDATORS: {
  [K in keyof Preferences]: (value: unknown) => value is Preferences[K];
} = {
  commandCenterProject: (value): value is ProjectId =>
    DASHBOARD_PROJECTS.some((project) => project.id === value),
  commandCenterRange: (value): value is RangeId =>
    DATE_RANGES.some((range) => range.id === value),
  projectsView: (value): value is RosterView =>
    value === "grid" || value === "table",
  agentsView: (value): value is RosterView =>
    value === "grid" || value === "table",
  reduceMotion: (value): value is boolean => typeof value === "boolean",
};

const PREFERENCE_KEYS = Object.keys(DEFAULT_PREFERENCES) as (keyof Preferences)[];

const listeners = new Set<() => void>();

/**
 * The snapshot React reads. Cached because `useSyncExternalStore` needs the
 * same object back on every call until the store actually changes.
 */
let snapshot: Preferences | null = null;

function parse(raw: string | null): Preferences {
  if (raw === null) return DEFAULT_PREFERENCES;

  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFERENCES;
  }
  if (typeof stored !== "object" || stored === null) return DEFAULT_PREFERENCES;

  const record = stored as Record<string, unknown>;
  const next = { ...DEFAULT_PREFERENCES } as {
    -readonly [K in keyof Preferences]: Preferences[K];
  };

  for (const key of PREFERENCE_KEYS) {
    const value = record[key];
    if (VALIDATORS[key](value)) {
      // Each validator narrows to its own key's type; the index signature
      // cannot follow that across the union, so the assignment is widened.
      (next[key] as Preferences[typeof key]) = value;
    }
  }

  return next;
}

function readSnapshot(): Preferences {
  if (snapshot === null) {
    try {
      snapshot = parse(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      snapshot = DEFAULT_PREFERENCES;
    }
  }
  return snapshot;
}

/** The server has no storage, so it renders defaults. */
function readServerSnapshot(): Preferences {
  return DEFAULT_PREFERENCES;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function commit(next: Preferences): void {
  snapshot = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable. The preference holds for this session and simply
    // does not survive a reload.
  }
  for (const listener of listeners) listener();
}

export function setPreference<K extends keyof Preferences>(
  key: K,
  value: Preferences[K],
): void {
  commit({ ...readSnapshot(), [key]: value });
}

/** Returns every preference to its default and forgets the stored blob. */
export function resetPreferences(): void {
  snapshot = DEFAULT_PREFERENCES;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored to remove.
  }
  for (const listener of listeners) listener();
}

/** True where anything differs from the shipped defaults. */
export function isDefault(preferences: Preferences): boolean {
  return PREFERENCE_KEYS.every(
    (key) => preferences[key] === DEFAULT_PREFERENCES[key],
  );
}

/** The key this product writes, shown in Settings so it is not a secret. */
export const PREFERENCES_STORAGE_KEY = STORAGE_KEY;


export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, readSnapshot, readServerSnapshot);
}

export function usePreference<K extends keyof Preferences>(
  key: K,
): Preferences[K] {
  return usePreferences()[key];
}
