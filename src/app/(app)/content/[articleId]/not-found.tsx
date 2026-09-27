import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";

/**
 * Shown when an id is not a stored article of any stored project — including
 * every id of the modelled inventory the screen used to show.
 *
 * Rendered inside the application shell, so the sidebar and header stay put
 * and the recovery is one click rather than a browser back button.
 */
export default function ArticleNotFound() {
  return (
    <Panel>
      <EmptyState
        icon="content"
        title="That article is not stored"
        description="The link does not name a stored article of any project. Content Studio lists the articles and drafts this product holds."
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
