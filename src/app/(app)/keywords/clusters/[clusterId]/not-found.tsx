import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";

/** Shown when a cluster id is not in the dataset. */
export default function ClusterNotFound() {
  return (
    <Panel>
      <EmptyState
        icon="layers"
        title="That cluster does not exist"
        description="The link points at a topic cluster that is not in the dataset. It may have been renamed, or the address may be mistyped."
        action={
          <Link
            href="/keywords?tab=clusters"
            className={buttonClasses("primary", "md")}
          >
            <Icon name="arrow-left" className="h-4 w-4" />
            Back to all clusters
          </Link>
        }
      />
    </Panel>
  );
}
