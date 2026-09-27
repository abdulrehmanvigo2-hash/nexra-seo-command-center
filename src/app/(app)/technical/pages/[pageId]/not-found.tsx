import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";

/**
 * Shown when an id is not a page of any stored project's own recorded crawl
 * (checkpoint 3.3): an unknown id, a retired fixture id, or a competitor
 * crawl's page. Rendered inside the application shell, so the recovery is one
 * click.
 */
export default function TechnicalPageNotFound() {
  return (
    <Panel>
      <EmptyState
        icon="technical"
        title="That page is not in a recorded crawl"
        description="The link does not name a page of a stored project's own crawl. Open the Pages tab on the Technical SEO screen to choose a recorded page."
        action={
          <Link href="/technical?tab=pages" className={buttonClasses("primary", "md")}>
            <Icon name="arrow-left" className="h-4 w-4" />
            Back to Technical SEO
          </Link>
        }
      />
    </Panel>
  );
}
