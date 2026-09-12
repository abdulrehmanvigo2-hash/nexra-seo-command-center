"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Icon } from "@/components/icons";
import { Button, buttonClasses } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

/**
 * Error boundary for every in-product route.
 *
 * Sits inside the `(app)` layout, so the sidebar and the header stay on
 * screen: whatever failed, the rest of the product is still navigable, and the
 * user is never stranded on a bare error page.
 *
 * Two things are deliberately absent. There is no logging call — no backend or
 * reporting service exists in this milestone (CLAUDE.md §4), and a fake one
 * would imply somebody is receiving these. And there is no error message or
 * stack trace: `error.message` is developer text that can carry internal paths
 * and data shapes, so the screen states what the user can do instead. The
 * digest is shown when React supplies one, because it is an opaque id that
 * identifies this failure in a build without describing it.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // The console is where a developer expects the detail; the screen is not.
  useEffect(() => {
    console.error("Unhandled error in an application route:", error);
  }, [error]);

  return (
    <Panel>
      <div className="flex flex-col items-center px-6 py-12 text-center">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-critical/30 bg-critical/10 text-critical">
          <Icon name="alert" className="h-5 w-5" />
        </span>

        <h2 className="mt-4 text-[14px] font-semibold tracking-tight text-fg">
          This screen failed to load
        </h2>

        <p className="mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-fg-subtle">
          Something went wrong while rendering this part of the product. Nothing
          you were working on has been sent anywhere, and the rest of the
          workspace is still available.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button variant="primary" size="md" icon="refresh" onClick={reset}>
            Try again
          </Button>
          <Link href="/" className={buttonClasses("secondary", "md")}>
            <Icon name="command-center" className="h-4 w-4" />
            Back to the Command Center
          </Link>
        </div>

        {error.digest && (
          <p className="mt-5 font-mono text-[11px] text-fg-subtle">
            Reference: {error.digest}
          </p>
        )}
      </div>
    </Panel>
  );
}
