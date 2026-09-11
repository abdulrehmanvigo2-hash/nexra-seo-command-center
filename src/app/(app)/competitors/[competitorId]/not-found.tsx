import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";

/**
 * Shown when a competitor id is not in the tracked set.
 *
 * Rendered inside the application shell, so the sidebar and header stay put
 * and the recovery is one click rather than a browser back button.
 */
export default function CompetitorNotFound() {
  return (
    <Panel>
      <EmptyState
        icon="competitors"
        title="That competitor is not tracked"
        description="The link points at a competitor that does not exist in the tracked set. It may have been renamed, or the address may be mistyped."
        action={
          <Link href="/competitors" className={buttonClasses("primary", "md")}>
            <Icon name="arrow-left" className="h-4 w-4" />
            Back to Competitor Intelligence
          </Link>
        }
      />
    </Panel>
  );
}
