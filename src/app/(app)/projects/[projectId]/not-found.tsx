import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";

/**
 * Shown when a project id does not exist in the roster.
 *
 * Rendered inside the application shell, so the sidebar and header stay put
 * and the recovery is one click rather than a browser back button.
 */
export default function ProjectNotFound() {
  return (
    <Panel>
      <EmptyState
        icon="projects"
        title="That project does not exist"
        description="The link points at a project that is not in this workspace. It may have been renamed, or the address may be mistyped."
        action={
          <Link href="/projects" className={buttonClasses("primary", "md")}>
            <Icon name="arrow-left" className="h-4 w-4" />
            Back to all projects
          </Link>
        }
      />
    </Panel>
  );
}
