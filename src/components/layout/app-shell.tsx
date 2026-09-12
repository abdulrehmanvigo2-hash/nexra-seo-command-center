"use client";

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { cn } from "@/lib/cn";

/**
 * Application shell: fixed sidebar, sticky header, scrolling content column.
 *
 * Desktop-first. Below `lg` the sidebar becomes an overlay drawer so the
 * content column keeps the full viewport width.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // The drawer closes on navigation via each link's onNavigate handler,
  // so no effect is needed to watch the pathname.

  const closeNav = useCallback(() => setNavOpen(false), []);

  /**
   * The drawer is a modal surface: it declares `aria-modal`, covers the page
   * with a backdrop, and locks scrolling, so it owes the keyboard exactly what
   * the centred dialog owes it. Both take that from the same hook rather than
   * each keeping a focus trap of its own.
   *
   * Focus lands on the first destination rather than on the close button:
   * navigating is what the drawer is for, and the close button stays one
   * Shift+Tab away.
   */
  useDialogFocus({
    active: navOpen,
    panelRef: drawerRef,
    onClose: closeNav,
    initialFocusSelector: "nav a",
  });

  return (
    <div
      style={
        { "--sidebar-width": collapsed ? "76px" : "260px" } as CSSProperties
      }
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-100 focus:rounded-md focus:border focus:border-border-strong focus:bg-surface-raised focus:px-3 focus:py-2 focus:text-[12.5px] focus:text-fg"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[var(--sidebar-width)] transition-[width] duration-200 lg:block">
        <Sidebar
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((value) => !value)}
        />
      </aside>

      {/* Mobile drawer */}
      <div
        className={cn(
          "fixed inset-0 z-50 lg:hidden",
          !navOpen && "pointer-events-none",
        )}
      >
        <div
          onClick={closeNav}
          aria-hidden="true"
          className={cn(
            "absolute inset-0 bg-black/60 transition-opacity duration-200",
            navOpen ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          inert={!navOpen}
          className={cn(
            "absolute inset-y-0 left-0 w-[276px] max-w-[85vw] transition-transform duration-200",
            navOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <Sidebar variant="mobile" onClose={closeNav} />
        </div>
      </div>

      {/* Content column */}
      <div className="flex min-h-screen flex-col transition-[padding] duration-200 lg:pl-[var(--sidebar-width)]">
        <Header onOpenNav={() => setNavOpen(true)} />
        <main id="main-content" className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
