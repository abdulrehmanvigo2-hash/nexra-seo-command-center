import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";

/**
 * Shown when a report id is not in the library.
 *
 * Rendered inside the application shell, so the sidebar and header stay put
 * and the recovery is one click rather than a browser back button.
 */
export default function ReportNotFound() {
  return (
    <Panel>
      <EmptyState
        icon="reports"
        title="That report is not in the library"
        description="The link points at a project, template and period combination that was never assembled — reports only exist for periods an engagement was running in. The address may also be mistyped."
        action={
          <Link
            href="/reports?tab=library"
            className={buttonClasses("primary", "md")}
          >
            <Icon name="arrow-left" className="h-4 w-4" />
            Back to Reports
          </Link>
        }
      />
    </Panel>
  );
}
