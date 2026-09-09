"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, Logo } from "@/components/icons";
import {
  NAV_GROUPS,
  getGroupItems,
  isActiveHref,
  type NavItem,
} from "@/config/navigation";
import { cn } from "@/lib/cn";

type SidebarProps = {
  /** Icon-only rail. Desktop only — the mobile drawer is always expanded. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onClose?: () => void;
  variant?: "desktop" | "mobile";
};

export function Sidebar({
  collapsed = false,
  onToggleCollapse,
  onClose,
  variant = "desktop",
}: SidebarProps) {
  const pathname = usePathname();
  const isMobile = variant === "mobile";
  const showLabels = isMobile || !collapsed;

  return (
    <div className="flex h-full flex-col border-r border-border bg-surface">
      {/* Brand */}
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-border",
          showLabels ? "gap-2.5 px-4" : "justify-center px-2",
        )}
      >
        <Logo className="h-8 w-8 shrink-0" />
        {showLabels && (
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] leading-tight font-semibold tracking-tight text-fg">
              Nexra
            </div>
            <div className="truncate text-[10.5px] leading-tight tracking-wide text-fg-subtle uppercase">
              SEO Command Center
            </div>
          </div>
        )}
        {isMobile && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <Icon name="close" />
          </button>
        )}
      </div>

      {/* Destinations */}
      <nav
        aria-label="Main"
        className="flex-1 overflow-y-auto overscroll-contain px-2.5 py-4"
      >
        {NAV_GROUPS.map((group, index) => {
          const items = getGroupItems(group);
          if (items.length === 0) return null;

          return (
            <div key={group} className={cn(index > 0 && "mt-5")}>
              {showLabels ? (
                <div className="px-2.5 pb-1.5 text-[10.5px] font-medium tracking-[0.08em] text-fg-subtle uppercase">
                  {group}
                </div>
              ) : (
                index > 0 && <div className="mx-2 mb-4 h-px bg-border" />
              )}
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.href}>
                    <SidebarLink
                      item={item}
                      active={isActiveHref(item.href, pathname)}
                      showLabel={showLabels}
                      onNavigate={onClose}
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Build status — honest about the current milestone */}
      <div className="shrink-0 border-t border-border p-3">
        {showLabels ? (
          <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
                aria-hidden="true"
              />
              <span className="text-[11.5px] font-medium text-fg-muted">
                Mock data
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-fg-subtle">
              Phase 2 · Command Center
            </p>
          </div>
        ) : (
          <div
            className="mx-auto h-1.5 w-1.5 rounded-full bg-warning"
            title="Mock data — Phase 2, Command Center"
          />
        )}
      </div>

      {/* Collapse control — desktop only */}
      {!isMobile && (
        <div className="shrink-0 border-t border-border p-2">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[12.5px] text-fg-subtle transition-colors",
              "hover:bg-surface-hover hover:text-fg",
              collapsed && "justify-center px-0",
            )}
          >
            <Icon name="panel" className="h-[18px] w-[18px] shrink-0" />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      )}
    </div>
  );
}

function SidebarLink({
  item,
  active,
  showLabel,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  showLabel: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={showLabel ? undefined : item.label}
      className={cn(
        "group relative flex items-center rounded-md py-2 text-[13.5px] transition-colors",
        showLabel ? "gap-3 px-2.5" : "justify-center px-0",
        active
          ? "bg-accent-soft text-fg"
          : "text-fg-muted hover:bg-surface-hover hover:text-fg",
      )}
    >
      {active && (
        <span
          className="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-accent"
          aria-hidden="true"
        />
      )}
      <Icon
        name={item.icon}
        className={cn(
          "h-[18px] w-[18px] shrink-0 transition-colors",
          active ? "text-accent" : "text-fg-subtle group-hover:text-fg-muted",
        )}
      />
      {showLabel && <span className="truncate">{item.label}</span>}
    </Link>
  );
}
