"use client";

import { useRef, type KeyboardEvent } from "react";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * The tab strip every workspace sits under.
 *
 * There were twelve copies of this before, and they had begun to diverge:
 * four spellings of the same key handler, two ways of finding the button to
 * focus. Nothing about them was module-specific — the differences were a
 * counts object under another name and a different `aria-label` — so the strip
 * is one component and the modules pass what is actually theirs.
 *
 * Only the strip. The panel stays with the module that renders it, because
 * that is where the content lives; `tabDomId` and `tabPanelDomId` are exported
 * so the two halves agree on ids without either one guessing.
 */

export type TabDefinition<T extends string> = {
  readonly id: T;
  readonly label: string;
  readonly icon: IconName;
};

/** DOM id of a tab button. */
export const tabDomId = (prefix: string, id: string) => `${prefix}-tab-${id}`;

/** DOM id of the panel a tab controls. */
export const tabPanelDomId = (prefix: string, id: string) =>
  `${prefix}-panel-${id}`;

export function TabList<T extends string>({
  tabs,
  /** Currently selected tab id. */
  value,
  onChange,
  /** Accessible name for the tab strip, e.g. "Reports sections". */
  label,
  /** Namespaces the tab and panel ids, so two strips can share a page. */
  idPrefix,
  /** Row counts shown after a label, where the module has them. */
  counts,
  className,
}: {
  tabs: readonly TabDefinition<T>[];
  value: T;
  onChange: (next: T) => void;
  label: string;
  idPrefix: string;
  counts?: Partial<Record<T, number>>;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  /** Roving focus across the strip, as a tablist is expected to behave. */
  const handleKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((entry) => entry.id === value);
    let next = index;

    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;

    event.preventDefault();
    onChange(tabs[next].id);
    listRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  };

  return (
    // No negative margin. The copies wrapped this in `-mx-1 … px-1` to buy the
    // focus ring 4px of clearance inside the scroll container, which left the
    // strip 4px wider than the content column on each side and showed up as a
    // 4px scrollWidth excess on the page. The ring is drawn inside the button
    // instead (below), so the strip can sit exactly on the column.
    <div className={cn("relative overflow-x-auto", className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        onKeyDown={handleKeys}
        className="inline-flex min-w-full items-center gap-1 border-b border-border"
      >
        {tabs.map((entry) => {
          const selected = entry.id === value;
          const count = counts?.[entry.id];

          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={tabDomId(idPrefix, entry.id)}
              aria-selected={selected}
              /*
               * Only the selected panel is mounted, so only the selected tab
               * can name one. Pointing the other eleven at ids that are not in
               * the document describes a relationship that does not exist.
               */
              aria-controls={
                selected ? tabPanelDomId(idPrefix, entry.id) : undefined
              }
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(entry.id)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors",
                // The focus ring is drawn inside the button — see the
                // `[role="tab"]:focus-visible` rule in globals.css — so this
                // scroll container cannot clip it at the first or last tab.
                selected
                  ? "border-accent text-fg"
                  : "border-transparent text-fg-subtle hover:text-fg-muted",
              )}
            >
              <Icon name={entry.icon} className="h-3.5 w-3.5" />
              {entry.label}
              {count !== undefined && (
                <span className="tabular text-[11px] text-fg-subtle">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
