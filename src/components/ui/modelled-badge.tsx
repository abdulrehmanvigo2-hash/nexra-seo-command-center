import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

/**
 * The explicit on-screen label for figures that come from the modelled
 * fixture layer (`src/lib/mock`), not from anything this product measured or
 * stored (Phase 5, checkpoint 5.7). The counterpart of the observed screens'
 * "Observed" badge.
 *
 * A screen drawn wholly from fixtures carries the badge in its header. A
 * mixed screen — fixture sections beside live panels — carries it on each
 * fixture section instead (`ModelledSection`), so a live panel is never read
 * as modelled; its live panels keep their own label.
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

/** One fixture section of a mixed screen, labelled Modelled above its content. */
export function ModelledSection({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section aria-label={`${name} (modelled)`} className="min-w-0 space-y-2">
      <div className="flex items-center gap-2">
        <ModelledBadge />
        <span className="text-[11.5px] text-fg-subtle">{name}</span>
      </div>
      {children}
    </section>
  );
}
