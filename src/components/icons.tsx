import type { ReactNode } from "react";

/**
 * Local inline icon set.
 *
 * Hand-rolled rather than pulling in an icon library: the shell needs ~18
 * glyphs, all on a single 24px stroke grid, which keeps the visual system
 * consistent and adds zero dependencies.
 */
export type IconName =
  | "command-center"
  | "projects"
  | "agents"
  | "keywords"
  | "content"
  | "technical"
  | "competitors"
  | "ai-visibility"
  | "backlinks"
  | "analytics"
  | "reports"
  | "settings"
  | "search"
  | "bell"
  | "menu"
  | "close"
  | "panel"
  | "user"
  | "chevron-down"
  | "check";

const PATHS: Record<IconName, ReactNode> = {
  "command-center": (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  projects: (
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2a1.5 1.5 0 0 1 1.2.6l.9 1.2a1.5 1.5 0 0 0 1.2.6h6.5A1.5 1.5 0 0 1 20 9.9V18a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3 18Z" />
  ),
  agents: (
    <>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" />
      <rect x="10" y="10" width="4" height="4" rx="1" />
      <path d="M10 3v3.5M14 3v3.5M10 17.5V21M14 17.5V21M3 10h3.5M3 14h3.5M17.5 10H21M17.5 14H21" />
    </>
  ),
  keywords: (
    <>
      <path d="M3 11.5v-7A1.5 1.5 0 0 1 4.5 3h7a1.5 1.5 0 0 1 1.06.44l7.5 7.5a1.5 1.5 0 0 1 0 2.12l-7 7a1.5 1.5 0 0 1-2.12 0l-7.5-7.5A1.5 1.5 0 0 1 3 11.5Z" />
      <circle cx="7.75" cy="7.75" r="1.25" />
    </>
  ),
  content: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9" />
      <path d="M14 3v5a1 1 0 0 0 1 1h4" />
      <path d="M8.5 13.5h5M8.5 17h3" />
    </>
  ),
  technical: (
    <>
      <rect x="3" y="4" width="18" height="6" rx="2" />
      <rect x="3" y="14" width="18" height="6" rx="2" />
      <path d="M7 7h.01M7 17h.01" />
    </>
  ),
  competitors: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.75" />
      <circle cx="12" cy="12" r="0.75" />
    </>
  ),
  "ai-visibility": (
    <>
      <path d="M2.5 12S6 5.75 12 5.75 21.5 12 21.5 12 18 18.25 12 18.25 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.75" />
    </>
  ),
  backlinks: (
    <>
      <path d="M10.5 13.5a4 4 0 0 0 5.66 0l2.84-2.83a4 4 0 1 0-5.66-5.67l-1.41 1.42" />
      <path d="M13.5 10.5a4 4 0 0 0-5.66 0L5 13.33a4 4 0 1 0 5.66 5.67l1.41-1.42" />
    </>
  ),
  analytics: (
    <>
      <path d="M3 20.5h18" />
      <path d="M6.75 20.5v-6M12 20.5V7M17.25 20.5v-9" />
    </>
  ),
  reports: (
    <>
      <path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9Z" />
      <path d="M13 3v5a1 1 0 0 0 1 1h5" />
      <path d="M8.5 13.5h7M8.5 17h4.5" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7.5h9M19 7.5h1M4 16.5h1M11 16.5h9" />
      <circle cx="16" cy="7.5" r="2.5" />
      <circle cx="8" cy="16.5" r="2.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8.75a6 6 0 1 0-12 0c0 4.75-2 6.25-2 6.25h16s-2-1.5-2-6.25Z" />
      <path d="M10.4 18.5a1.9 1.9 0 0 0 3.2 0" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9.5 4v16" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
    </>
  ),
  "chevron-down": <path d="m7 10 5 5 5-5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
};

export function Icon({
  name,
  className = "h-[18px] w-[18px]",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

/** Product mark — a flat geometric "N", no gradients. */
export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="9"
        className="fill-accent-soft stroke-accent/40"
        strokeWidth="1.5"
      />
      <path
        d="M11 22V10l10 12V10"
        fill="none"
        className="stroke-accent"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
