import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";

/**
 * Shown when a content id is not in the inventory.
 *
 * Rendered inside the application shell, so the sidebar and header stay put
 * and the recovery is one click rather than a browser back button.
 */
export default function ContentNotFound() {
  return (
    <Panel>
      <EmptyState
        icon="content"
        title="That page is not in the inventory"
        description="The link points at a piece of content that does not exist. It may have been renamed, or the address may be mistyped."
        action={
          <Link href="/content" className={buttonClasses("primary", "md")}>
            <Icon name="arrow-left" className="h-4 w-4" />
            Back to Content Studio
          </Link>
        }
      />
    </Panel>
  );
}
