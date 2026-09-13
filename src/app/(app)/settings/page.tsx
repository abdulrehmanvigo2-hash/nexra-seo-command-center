import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsWorkspace } from "@/components/settings/settings-workspace";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Settings",
  description:
    "How this workspace opens and behaves: Command Center defaults, roster views, motion, and what is held in this browser.",
};

/**
 * The workspace reads its section from the query string, so a link can open
 * Settings on a particular tab. `useSearchParams` needs a Suspense boundary
 * during static rendering, which is what this shell provides.
 */
export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsFallback />}>
      <SettingsWorkspace />
    </Suspense>
  );
}

function SettingsFallback() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-6 w-full max-w-40" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
      <Skeleton className="h-9 w-full max-w-md" />
      <Panel>
        <div className="space-y-4 p-4 sm:p-5">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      </Panel>
    </div>
  );
}
