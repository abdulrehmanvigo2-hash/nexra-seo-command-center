import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";

/**
 * Shown when a page id is not in the published inventory.
 *
 * Rendered inside the application shell, so the sidebar and header stay put
 * and the recovery is one click rather than a browser back button.
 */
export default function TechnicalPageNotFound() {
  return (
    <Panel>
      <EmptyState
        icon="technical"
        title="That URL is not in the inventory"
        description="The link points at a page that is not published, or the address may be mistyped. Technical SEO covers the published content inventory only."
        action={
          <Link
            href="/technical?tab=pages"
            className={buttonClasses("primary", "md")}
          >
            <Icon name="arrow-left" className="h-4 w-4" />
            Back to Technical SEO
          </Link>
        }
      />
    </Panel>
  );
}
