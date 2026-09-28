import { Badge } from "@/components/ui/badge";

/**
 * The explicit on-screen label for a screen whose figures come from the
 * modelled fixture layer (`src/lib/mock`), not from anything this product
 * measured or stored (Phase 5, checkpoint 5.7). The counterpart of the
 * observed screens' "Observed" badge. Panels on such a screen that read live
 * data carry their own label.
 */
export const MODELLED_TITLE =
  "Modelled fixture data — not measured or stored by this product. Panels backed by live data are labelled on their own.";

export function ModelledBadge() {
  return (
    <Badge tone="warning" title={MODELLED_TITLE}>
      Modelled
    </Badge>
  );
}
