import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";

/**
 * Shown when an agent id does not exist in the registry.
 *
 * Rendered inside the application shell, so the sidebar and header stay put
 * and the recovery is one click rather than a browser back button.
 */
export default function AgentNotFound() {
  return (
    <Panel>
      <EmptyState
        icon="agents"
        title="That agent does not exist"
        description="The link points at an agent that is not part of the twelve-agent team. It may have been renamed, or the address may be mistyped."
        action={
          <Link href="/agents" className={buttonClasses("primary", "md")}>
            <Icon name="arrow-left" className="h-4 w-4" />
            Back to all agents
          </Link>
        }
      />
    </Panel>
  );
}
