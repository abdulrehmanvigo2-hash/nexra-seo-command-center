"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { Dropdown } from "@/components/ui/dropdown";
import { resolveActiveItem } from "@/config/navigation";
import { CURRENT_USER, DEFAULT_WORKSPACE_ID, WORKSPACES } from "@/lib/mock/workspace";
import { cn } from "@/lib/cn";

export function Header({ onOpenNav }: { onOpenNav: () => void }) {
  const pathname = usePathname();
  const active = resolveActiveItem(pathname);
  const [workspaceId, setWorkspaceId] = useState(DEFAULT_WORKSPACE_ID);
  const workspace =
    WORKSPACES.find((entry) => entry.id === workspaceId) ?? WORKSPACES[0];

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-canvas/85 px-4 backdrop-blur-md sm:px-6">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="-ml-1 rounded-md p-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg lg:hidden"
      >
        <Icon name="menu" />
      </button>

      {/* Current page */}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[14.5px] leading-tight font-semibold tracking-tight text-fg">
          {active?.label ?? "Nexra SEO Command Center"}
        </h1>
        {active && (
          <p className="hidden truncate text-[11.5px] leading-tight text-fg-subtle xl:block">
            {active.description}
          </p>
        )}
      </div>

      {/* Workspace */}
      <Dropdown
        label="Switch workspace"
        align="right"
        panelClassName="w-64"
        triggerClassName="hidden h-9 max-w-[210px] px-2.5 md:flex"
        trigger={
          <>
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border-strong bg-surface-raised text-[10px] font-semibold text-fg-muted">
              {workspace.name.charAt(0)}
            </span>
            <span className="truncate text-[12.5px] font-medium text-fg">
              {workspace.name}
            </span>
            <Icon name="chevron-down" className="h-4 w-4 shrink-0" />
          </>
        }
      >
        {(close) => (
          <div className="py-1">
            <div className="px-3 pt-2 pb-1.5 text-[10.5px] font-medium tracking-[0.08em] text-fg-subtle uppercase">
              Workspaces
            </div>
            {WORKSPACES.map((entry) => {
              const selected = entry.id === workspace.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    setWorkspaceId(entry.id);
                    close();
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-hover"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border-strong bg-surface text-[11px] font-semibold text-fg-muted">
                    {entry.name.charAt(0)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-fg">
                      {entry.name}
                    </span>
                    <span className="block truncate text-[11px] text-fg-subtle">
                      {entry.plan} · {entry.projectCount} projects
                    </span>
                  </span>
                  {selected && (
                    <Icon name="check" className="h-4 w-4 shrink-0 text-accent" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Dropdown>

      <SearchField />

      {/* Notifications */}
      <Dropdown
        label="Notifications"
        panelClassName="w-72"
        triggerClassName="h-9 w-9 justify-center"
        trigger={<Icon name="bell" />}
      >
        <div>
          <div className="border-b border-border px-3 py-2.5 text-[12.5px] font-medium text-fg">
            Notifications
          </div>
          <div className="px-3 py-6 text-center">
            <p className="text-[12.5px] text-fg-muted">You&apos;re all caught up</p>
            <p className="mt-1 text-[11.5px] leading-snug text-fg-subtle">
              Agent alerts and run summaries will appear here once agents are live.
            </p>
          </div>
        </div>
      </Dropdown>

      {/* Account */}
      <Dropdown
        label="Account menu"
        panelClassName="w-60"
        triggerClassName="h-9 gap-2 pr-2 pl-1.5"
        trigger={
          <>
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border-strong bg-surface-raised text-[10.5px] font-semibold text-fg-muted">
              {CURRENT_USER.initials}
            </span>
            <Icon name="chevron-down" className="hidden h-4 w-4 sm:block" />
          </>
        }
      >
        {(close) => (
          <div>
            <div className="border-b border-border px-3 py-2.5">
              <div className="truncate text-[12.5px] font-medium text-fg">
                {CURRENT_USER.name}
              </div>
              <div className="truncate text-[11.5px] text-fg-subtle">
                {CURRENT_USER.email}
              </div>
              <div className="mt-1.5 inline-flex rounded border border-border-strong px-1.5 py-0.5 text-[10.5px] text-fg-muted">
                {CURRENT_USER.role}
              </div>
            </div>
            <div className="py-1">
              <Link
                href="/settings"
                role="menuitem"
                onClick={close}
                className="flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
              >
                <Icon name="settings" className="h-4 w-4" />
                Settings
              </Link>
            </div>
          </div>
        )}
      </Dropdown>
    </header>
  );
}

/**
 * Search affordance for the shell. Accepts input but performs no query —
 * search is wired up alongside the modules it searches.
 */
function SearchField() {
  const [value, setValue] = useState("");

  return (
    <form
      role="search"
      onSubmit={(event) => event.preventDefault()}
      className="hidden lg:block"
    >
      <div className="relative">
        <Icon
          name="search"
          className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-fg-subtle"
        />
        <input
          type="search"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Search projects, keywords, reports"
          aria-label="Search"
          className={cn(
            "h-9 w-56 rounded-md border border-border bg-surface pr-3 pl-8 text-[12.5px] text-fg transition-colors",
            "placeholder:text-fg-subtle hover:border-border-strong focus:border-accent focus:outline-none xl:w-64",
          )}
        />
      </div>
    </form>
  );
}
