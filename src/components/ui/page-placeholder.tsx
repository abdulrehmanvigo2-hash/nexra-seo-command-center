import { Icon } from "@/components/icons";
import { getNavItem, type NavHref } from "@/config/navigation";

/**
 * Placeholder shown for every destination that has not been built yet.
 *
 * Content is read from the navigation config, so a module's title and
 * description stay identical in the sidebar, the header, and this page.
 */
export function PagePlaceholder({ href }: { href: NavHref }) {
  const item = getNavItem(href);
  const status =
    item.phase === null
      ? "Coming in a later phase"
      : `Coming in Phase ${item.phase}`;

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-[20px] leading-tight font-semibold tracking-tight text-fg">
            {item.label}
          </h2>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-fg-muted">
            {item.description}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border-strong bg-surface px-3 py-1.5 text-[11.5px] font-medium text-fg-muted">
          <span
            className="h-1.5 w-1.5 rounded-full bg-accent"
            aria-hidden="true"
          />
          {status}
        </span>
      </div>

      <div className="mt-6 rounded-panel border border-border bg-surface p-6 sm:p-8">
        <div className="flex items-start gap-3.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface-raised text-fg-muted">
            <Icon name={item.icon} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold tracking-tight text-fg">
              Planned for this module
            </h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-fg-subtle">
              The route, navigation, and layout are live. The module itself is
              built in its own phase.
            </p>
          </div>
        </div>

        <ul className="mt-6 grid gap-2.5 lg:grid-cols-3">
          {item.focus.map((entry) => (
            <li
              key={entry}
              className="flex items-start gap-2.5 rounded-md border border-border bg-surface-raised px-3.5 py-3 text-[12.5px] leading-snug text-fg-muted"
            >
              <span
                className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-fg-subtle"
                aria-hidden="true"
              />
              {entry}
            </li>
          ))}
        </ul>

        <p className="mt-6 border-t border-border pt-5 text-[12px] leading-relaxed text-fg-subtle">
          Current milestone: Phase 3 — Projects. All data shown across the
          product is mock data.
        </p>
      </div>
    </section>
  );
}
