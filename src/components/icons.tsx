import type { ReactNode } from "react";

/**
 * Local inline icon set.
 *
 * Hand-rolled rather than pulling in an icon library: the product needs a few
 * dozen glyphs, all on a single 24px stroke grid, which keeps the visual
 * system consistent and adds zero dependencies.
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
  | "check"
  | "trend-up"
  | "trend-down"
  | "trend-flat"
  | "filter"
  | "plus"
  | "inbox"
  // Added for the Command Center dashboard.
  | "refresh"
  | "calendar"
  | "clock"
  | "info"
  | "alert"
  | "shield"
  | "target"
  | "value"
  | "pages"
  | "layers"
  | "sparkles"
  | "activity"
  | "globe"
  | "bolt"
  | "flag"
  | "link-off"
  | "gauge"
  | "sort"
  | "arrow-right"
  | "chevron-right"
  | "external"
  // Added for the Projects module.
  | "map-pin"
  | "briefcase"
  | "grid"
  | "rows"
  | "edit"
  | "note"
  | "trash"
  | "arrow-left"
  | "minus"
  // Added for the AI Agents module.
  | "workflow"
  | "handoff"
  | "brief"
  | "sliders"
  // Added for the Keyword Intelligence module.
  | "list"
  | "upload"
  | "split"
  | "star";

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
  "trend-up": (
    <>
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </>
  ),
  "trend-down": (
    <>
      <path d="m7 7 10 10" />
      <path d="M17 9v8H9" />
    </>
  ),
  "trend-flat": <path d="M6 12h12" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  plus: <path d="M12 5v14M5 12h14" />,
  inbox: (
    <>
      <path d="M4 14h4l1.5 2.5h5L16 14h4" />
      <path d="M4 14 6.5 6h11L20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11.5a8 8 0 1 0-.9 5" />
      <path d="M20 4.5v6h-6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3.5V6.5M16 3.5V6.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.75h.01" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.5 2.9 20a1 1 0 0 0 .87 1.5h16.46A1 1 0 0 0 21.1 20Z" />
      <path d="M12 10v4.5M12 17.75h.01" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5.5c0 4.4 2.9 8.1 7 9.5 4.1-1.4 7-5.1 7-9.5V6Z" />
      <path d="m9.25 12 1.9 1.9 3.6-3.8" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.75" />
    </>
  ),
  value: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.5 9.25a2.75 2.75 0 0 0-2.5-1.5c-1.5 0-2.6.85-2.6 2s1 1.75 2.6 2.1 2.75 1 2.75 2.15-1.15 2.25-2.75 2.25a2.9 2.9 0 0 1-2.65-1.5" />
      <path d="M12 6.25v11.5" />
    </>
  ),
  pages: (
    <>
      <path d="M8 3.5h6.5L19 8v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2Z" />
      <path d="M14 3.5V8h4.5" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3.5 8.5 4.25L12 12 3.5 7.75Z" />
      <path d="m3.5 12 8.5 4.25L20.5 12" />
      <path d="m3.5 16.25 8.5 4.25 8.5-4.25" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3.5 1.7 4.55 4.55 1.7-4.55 1.7L12 16l-1.7-4.55-4.55-1.7 4.55-1.7Z" />
      <path d="M18.5 15.5 19.25 17.5l2 .75-2 .75-.75 2-.75-2-2-.75 2-.75Z" />
    </>
  ),
  activity: <path d="M3 12.5h3.5L9 5.5l4 13 2.5-6h4" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.2 2.4 3.4 5.4 3.4 8.5s-1.2 6.1-3.4 8.5c-2.2-2.4-3.4-5.4-3.4-8.5S9.8 5.9 12 3.5Z" />
    </>
  ),
  bolt: <path d="M13.5 3 5.5 13.5h5L10 21l8.5-10.5h-5Z" />,
  flag: (
    <>
      <path d="M5.5 21V4.5" />
      <path d="M5.5 5.25h11l-1.75 3.5 1.75 3.5h-11" />
    </>
  ),
  "link-off": (
    <>
      <path d="M10 13.5a4 4 0 0 0 3.9.9" />
      <path d="M14.5 6.5 16 5.1a4 4 0 0 1 5.65 5.65l-1.4 1.4" />
      <path d="M9.5 17.5 8 18.9A4 4 0 0 1 2.35 13.25l1.4-1.4" />
      <path d="m3.5 3.5 17 17" />
    </>
  ),
  gauge: (
    <>
      <path d="M4 17.5a9 9 0 1 1 16 0" />
      <path d="m12 13.5 3.75-3.75" />
      <circle cx="12" cy="14.75" r="1.25" />
    </>
  ),
  sort: (
    <>
      <path d="M8 5v14M8 5 5 8.25M8 5l3 3.25" />
      <path d="M16 19V5m0 14 3-3.25M16 19l-3-3.25" />
    </>
  ),
  "arrow-right": <path d="M4.5 12h15m-5.5-5.5L19.5 12 14 17.5" />,
  "chevron-right": <path d="m10 7 5 5-5 5" />,
  external: (
    <>
      <path d="M13.5 4.5H19.5V10.5" />
      <path d="M19.5 4.5 11 13" />
      <path d="M18 14.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5" />
    </>
  ),
  "map-pin": (
    <>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7.5" width="18" height="12.5" rx="2" />
      <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" />
      <path d="M3 12.5h18" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  rows: (
    <>
      <rect x="3.5" y="4.5" width="17" height="5" rx="1.5" />
      <rect x="3.5" y="14.5" width="17" height="5" rx="1.5" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20Z" />
      <path d="M13.5 7 17 10.5" />
    </>
  ),
  note: (
    <>
      <path d="M5 4.5h14v10L14 20H6a1 1 0 0 1-1-1V4.5Z" />
      <path d="M19 14.5h-5v5" />
      <path d="M8.5 9h7M8.5 12.5h4" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V7" />
      <path d="M6.5 7v12a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5V7" />
      <path d="M10.5 11v5.5M13.5 11v5.5" />
    </>
  ),
  "arrow-left": <path d="M19.5 12h-15m5.5-5.5L4.5 12 10 17.5" />,
  minus: <path d="M6 12h12" />,

  // Added for the AI Agents module.
  workflow: (
    <>
      <circle cx="5.5" cy="6" r="2.5" />
      <circle cx="18.5" cy="12" r="2.5" />
      <circle cx="5.5" cy="18" r="2.5" />
      <path d="M8 6h4a2 2 0 0 1 2 2v2M8 18h4a2 2 0 0 0 2-2v-2" />
    </>
  ),
  handoff: (
    <>
      <circle cx="5" cy="12" r="2.5" />
      <circle cx="19" cy="12" r="2.5" />
      <path d="M8 12h5.5m-2 -2.5L14 12l-2.5 2.5" />
    </>
  ),
  brief: (
    <>
      <path d="M6 3.5h8.5L19 8v12.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z" />
      <path d="M14 3.5V8h4.5" />
      <path d="M8.5 12.5h7M8.5 16h4.5" />
    </>
  ),
  sliders: (
    <>
      <path d="M5 7h9M18.5 7H20M5 17h3M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15.5V4m0 0L8 8m4-4 4 4" />
      <path d="M4 15v3.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
  split: (
    <>
      <path d="M12 20V9" />
      <path d="M12 9 7 4M12 9l5-5" />
      <circle cx="12" cy="20" r="1.6" />
    </>
  ),
  star: (
    <path d="m12 4 2.45 4.96 5.47.8-3.96 3.86.94 5.45L12 16.5l-4.9 2.57.94-5.45L4.08 9.76l5.47-.8Z" />
  ),
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
