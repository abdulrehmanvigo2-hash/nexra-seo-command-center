import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";

/**
 * Stands in for a module's modelled headline figures when the selected project
 * has never been measured. The modelled dataset has no records for it, and
 * zeros in its place would read as observations.
 */
export function UnmeasuredSelectionNotice({ name }: { name: string }) {
  return (
    <Panel>
      <EmptyState
        size="sm"
        icon="clock"
        title={`${name} has not been measured yet`}
        description="The modelled figures on this screen appear once reporting data exists for this project; none are estimated in the meantime. Search Console data, where a property is connected, is shown in its own panel."
      />
    </Panel>
  );
}
