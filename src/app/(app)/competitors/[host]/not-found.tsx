import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";

/**
 * Shown when the address is not a hostname a stored project recorded as a competitor.
 *
 * Rendered inside the application shell, so the sidebar and header stay put
 * and the recovery is one click rather than a browser back button.
 */
export default function CompetitorNotFound() {
  return (
    <Panel>
      <EmptyState
        icon="competitors"
        title="That competitor is not recorded"
        description="The address is not a competitor domain any stored project recorded. Competitor domains are recorded on a project's screen."
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
