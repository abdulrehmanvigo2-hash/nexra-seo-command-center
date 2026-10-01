"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Dropdown } from "@/components/ui/dropdown";
import { resolveActiveItem } from "@/config/navigation";

export function Header({ onOpenNav }: { onOpenNav: () => void }) {
  const pathname = usePathname();
  const active = resolveActiveItem(pathname);
  const email = useSignedInEmail();

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
          <div className="px-3 py-5 text-center">
            <p className="text-[12.5px] text-fg-muted">No notifications</p>
            <p className="mt-1 text-[11.5px] leading-snug text-fg-subtle">
              This product sends no alerts. Agent runs and their results are listed in Run History.
            </p>
            <Link
              href="/agents"
              className="mt-2.5 inline-flex text-[11.5px] font-medium text-accent hover:underline"
            >
              Open Run History
            </Link>
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
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border-strong bg-surface-raised text-[10.5px] font-semibold text-fg-muted uppercase">
              {email ? email.charAt(0) : <Icon name="user" className="h-4 w-4" />}
            </span>
            <Icon name="chevron-down" className="hidden h-4 w-4 sm:block" />
          </>
        }
      >
        {(close) => (
          <div>
            <div className="border-b border-border px-3 py-2.5">
              <div className="text-[11px] text-fg-subtle">Signed in as</div>
              <div className="truncate text-[12.5px] font-medium text-fg">
                {email ?? "…"}
              </div>
              <div className="mt-1.5 inline-flex rounded border border-border-strong px-1.5 py-0.5 text-[10.5px] text-fg-muted">
                Operator
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
              {/* A plain form post: signing out works before, and without, JavaScript. */}
              <form method="post" action="/auth/sign-out">
                <button
                  type="submit"
                  role="menuitem"
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                >
                  <Icon name="arrow-right" className="h-4 w-4" />
                  Sign out
                </button>
              </form>
            </div>
          </div>
        )}
      </Dropdown>
    </header>
  );
}

/**
 * The signed-in operator's email, fetched after hydration.
 *
 * Every operator is served the same statically rendered page, so the email
 * cannot be in its HTML; rendering it on the first client pass would not match
 * the server's markup. Null until the answer arrives, and if the session has
 * ended — the next navigation goes to the sign-in page.
 */
function useSignedInEmail(): string | null {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/auth/session", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (
          typeof body === "object" &&
          body !== null &&
          "email" in body &&
          typeof body.email === "string"
        ) {
          setEmail(body.email);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return email;
}
