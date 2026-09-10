import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";

/**
 * Shown when a keyword id is not in the registry.
 *
 * Rendered inside the application shell, so the sidebar and header stay put
 * and the recovery is one click rather than a browser back button.
 */
export default function KeywordNotFound() {
  return (
    <Panel>
      <EmptyState
        icon="keywords"
        title="That keyword is not tracked"
        description="The link points at a keyword that is not in the analysed set. It may have been renamed, or the address may be mistyped."
        action={
          <Link href="/keywords" className={buttonClasses("primary", "md")}>
            <Icon name="arrow-left" className="h-4 w-4" />
            Back to Keyword Intelligence
          </Link>
        }
      />
    </Panel>
  );
}
