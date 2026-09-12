import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { AppShell } from "@/components/layout/app-shell";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";

export const metadata: Metadata = {
  title: "Page not found",
};

/**
 * The catch-all 404: an address that matches no route at all.
 *
 * This file has to live at the application root, because a URL that matches
 * nothing never reaches a route group and so never reaches the `(app)`
 * layout. It therefore renders `AppShell` itself, which keeps the sidebar and
 * the header in place and makes the way back one click rather than a browser
 * back button — the same recovery the per-segment screens offer.
 *
 * A detail route with an unknown id does *not* land here. Those pages call
 * `notFound()` and are answered by the `not-found.tsx` beside them, which can
 * name the module the link was pointing at.
 */
export default function NotFound() {
  return (
    <AppShell>
      <Panel>
        <EmptyState
          icon="link-off"
          title="That page does not exist"
          description="The address does not match any screen in this workspace. It may have been mistyped, or the link may be out of date."
          action={
            <Link href="/" className={buttonClasses("primary", "md")}>
              <Icon name="arrow-left" className="h-4 w-4" />
              Back to the Command Center
            </Link>
          }
        />
      </Panel>
    </AppShell>
  );
}
