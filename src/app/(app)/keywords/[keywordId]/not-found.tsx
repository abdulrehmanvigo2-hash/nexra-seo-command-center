import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";

/**
 * Shown when a keyword id is not a stored curated keyword (checkpoint 3.5):
 * an unknown id, a malformed one, or an id of the modelled keyword pages
 * this route replaced.
 *
 * Rendered inside the application shell, so the sidebar and header stay put
 * and the recovery is one click rather than a browser back button.
 */
export default function KeywordNotFound() {
  return (
    <Panel>
      <EmptyState
        icon="keywords"
        title="That keyword is not curated"
        description="The link does not name a curated keyword of a stored project. The address may be mistyped, or it may point to a modelled keyword page that no longer exists."
        action={
          <Link href="/keywords?tab=lists" className={buttonClasses("primary", "md")}>
            <Icon name="arrow-left" className="h-4 w-4" />
            Back to Keyword Intelligence
          </Link>
        }
      />
    </Panel>
  );
}
