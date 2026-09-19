"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import {
  TabList,
  tabDomId,
  tabPanelDomId,
  type TabDefinition,
} from "@/components/ui/tab-list";
import {
  SettingList,
  SettingRow,
  SettingSwitch,
} from "@/components/settings/setting-row";
import { DATE_RANGES } from "@/lib/mock/dashboard";
import {
  withPortfolioOption,
  type ProjectOption,
} from "@/lib/projects/selection";
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_STORAGE_KEY,
  isDefault,
  resetPreferences,
  setPreference,
  usePreferences,
} from "@/lib/preferences";
import type { ProjectId, RangeId } from "@/types/dashboard";

/**
 * Settings.
 *
 * Everything here changes something the moment it is set. There is no Save
 * button because there is nowhere to save to: the preferences live in this
 * browser, and the page says so rather than implying a profile on a server
 * (CLAUDE.md §4 — no backend, no database, no account).
 *
 * What is absent matters as much as what is here. There are no account, team,
 * billing or security settings, and no notification delivery toggles: all of
 * those need a server to mean anything, and a control that changes nothing is
 * worse than an honest gap. Every section below has a real consumer today.
 */

type TabId = "general" | "modules" | "interface" | "data";

const TABS: readonly TabDefinition<TabId>[] = [
  { id: "general", label: "General", icon: "command-center" },
  { id: "modules", label: "Modules", icon: "grid" },
  { id: "interface", label: "Interface", icon: "sliders" },
  { id: "data", label: "Data & session", icon: "shield" },
];

function isTabId(value: string | null): value is TabId {
  return TABS.some((tab) => tab.id === value);
}

const VIEW_OPTIONS = [
  { value: "grid", label: "Cards" },
  { value: "table", label: "Table" },
] as const;

export function SettingsWorkspace({
  projects,
}: {
  /** The Projects roster, read on the server from the Projects repository. */
  projects: readonly ProjectOption[];
}) {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");

  const [tab, setTab] = useState<TabId>(
    isTabId(requestedTab) ? requestedTab : "general",
  );
  const [confirmingReset, setConfirmingReset] = useState(false);

  const preferences = usePreferences();
  const atDefaults = isDefault(preferences);

  // The same list the dashboard's own selector offers: the roll-up, then the
  // roster from the Projects repository.
  const options = withPortfolioOption(projects);

  const projectName =
    options.find(
      (project) => project.id === preferences.commandCenterProject,
    )?.name ?? "All Projects";
  const rangeCaption =
    DATE_RANGES.find((range) => range.id === preferences.commandCenterRange)
      ?.caption ?? "Last 30 days";
  const defaultProjectName =
    options.find(
      (project) => project.id === DEFAULT_PREFERENCES.commandCenterProject,
    )?.name ?? "All Projects";

  return (
    <div className="space-y-6">
      <section>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h2 className="text-[20px] leading-tight font-semibold tracking-tight text-fg">
              Settings
            </h2>
            <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-fg-muted">
              How this workspace opens and behaves. Every setting applies
              immediately and is kept in this browser — there is no account, and
              nothing is sent anywhere.
            </p>
          </div>
          <Badge tone={atDefaults ? "neutral" : "accent"} dot>
            {atDefaults ? "All defaults" : "Customised"}
          </Badge>
        </div>
      </section>

      <TabList
        tabs={TABS}
        value={tab}
        onChange={setTab}
        label="Settings sections"
        idPrefix="settings"
      />

      <div
        role="tabpanel"
        id={tabPanelDomId("settings", tab)}
        aria-labelledby={tabDomId("settings", tab)}
        tabIndex={0}
        className="space-y-4 focus-visible:outline-none"
      >
        {tab === "general" && (
          <Panel>
            <PanelHeader
              title="Command Center"
              description="What the dashboard shows when you open it. Changing the project or the window on the dashboard itself still overrides this for that visit."
            />
            <SettingList>
              <SettingRow
                label="Opens on"
                description="The project the dashboard is scoped to on arrival. All Projects is the cross-client roll-up."
                footnote={"Currently opening on " + projectName + "."}
                render={({ controlId, describedBy }) => (
                  <span className="block w-full sm:w-56">
                    <Select
                      id={controlId}
                      aria-describedby={describedBy}
                      value={preferences.commandCenterProject}
                      onChange={(event) =>
                        setPreference(
                          "commandCenterProject",
                          event.target.value as ProjectId,
                        )
                      }
                      /* A select offers text and nothing else, so an
                         unmeasured project carries the fact in its label
                         rather than being indistinguishable until it is
                         chosen. */
                      options={options.map((project) => ({
                        value: project.id,
                        label: project.measured
                          ? project.name
                          : `${project.name} — not measured`,
                      }))}
                    />
                  </span>
                )}
              />

              <SettingRow
                label="Reporting window"
                description="The period the dashboard figures cover when it loads."
                footnote={"Currently " + rangeCaption.toLowerCase() + "."}
                render={({ controlId, describedBy }) => (
                  <span className="block w-full sm:w-56">
                    <Select
                      id={controlId}
                      aria-describedby={describedBy}
                      value={preferences.commandCenterRange}
                      onChange={(event) =>
                        setPreference(
                          "commandCenterRange",
                          event.target.value as RangeId,
                        )
                      }
                      options={DATE_RANGES.map((range) => ({
                        value: range.id,
                        label: range.caption,
                      }))}
                    />
                  </span>
                )}
              />
            </SettingList>
            <PanelFooter>
              <span>
                These two apply to the Command Center. Every other module takes
                its scope from the link that opened it.
              </span>
            </PanelFooter>
          </Panel>
        )}

        {tab === "modules" && (
          <Panel>
            <PanelHeader
              title="Roster views"
              description="Whether a roster opens as cards or as a dense table. Switching the view inside a module changes this too — it is the same preference."
            />
            <SettingList>
              <SettingRow
                label="Projects"
                description="The client roster on the Projects screen."
                render={({ controlId, describedBy }) => (
                  <span className="block w-full sm:w-44">
                    <Select
                      id={controlId}
                      aria-describedby={describedBy}
                      value={preferences.projectsView}
                      onChange={(event) =>
                        setPreference(
                          "projectsView",
                          event.target.value === "table" ? "table" : "grid",
                        )
                      }
                      options={VIEW_OPTIONS}
                    />
                  </span>
                )}
              />

              <SettingRow
                label="AI Agents"
                description="The twelve-agent roster on the AI Agents screen."
                render={({ controlId, describedBy }) => (
                  <span className="block w-full sm:w-44">
                    <Select
                      id={controlId}
                      aria-describedby={describedBy}
                      value={preferences.agentsView}
                      onChange={(event) =>
                        setPreference(
                          "agentsView",
                          event.target.value === "table" ? "table" : "grid",
                        )
                      }
                      options={VIEW_OPTIONS}
                    />
                  </span>
                )}
              />
            </SettingList>
            <PanelFooter>
              <span>
                Agent behaviour is not configurable here. The agents are
                simulated in this milestone — nothing executes a run, so there
                is nothing to tune.
              </span>
            </PanelFooter>
          </Panel>
        )}

        {tab === "interface" && (
          <Panel>
            <PanelHeader
              title="Interface"
              description="Presentation preferences that apply across every screen."
            />
            <SettingList>
              <SettingRow
                label="Reduce motion"
                description="Suppresses transitions and animation — the navigation drawer, panel fades, the pulse on a running agent."
                footnote="Your operating system's reduced-motion setting is already honoured. This forces it on regardless."
                render={({ controlId, describedBy }) => (
                  <SettingSwitch
                    id={controlId}
                    describedBy={describedBy}
                    label="Reduce motion"
                    checked={preferences.reduceMotion}
                    onChange={(next) => setPreference("reduceMotion", next)}
                  />
                )}
              />
            </SettingList>
            <PanelFooter>
              <span>
                Table density and theme are not offered: the product ships one
                dark, dense scale, and a switch only half the screens honoured
                would be worse than no switch.
              </span>
            </PanelFooter>
          </Panel>
        )}

        {tab === "data" && (
          <div className="space-y-4">
            <Panel>
              <PanelHeader
                title="What this workspace holds"
                description="The preferences on this page stay in this browser. Most figures elsewhere are modelled fixtures; stored projects, Search Console readings and agent runs come from the server and are labelled where they appear."
              />
              <SettingList>
                <SettingRow
                  label="Preferences"
                  description="The settings on this page, kept in this browser's local storage."
                  footnote={
                    <>
                      Stored under{" "}
                      <span className="font-mono text-[11px] text-fg-muted">
                        {PREFERENCES_STORAGE_KEY}
                      </span>
                      .
                    </>
                  }
                  render={() => (
                    <Badge tone={atDefaults ? "neutral" : "accent"}>
                      {atDefaults ? "At defaults" : "Customised"}
                    </Badge>
                  )}
                />
                <SettingRow
                  label="Everything else"
                  description="Keywords you import, and task and issue states you change, are held by the screen you changed them on and are gone when you reload. Projects are saved only when the workspace runs on the database."
                  footnote="Nothing held in a screen is written down, so there is nothing to clear here."
                  render={() => <Badge tone="neutral">Session only</Badge>}
                />
              </SettingList>
            </Panel>

            <Panel>
              <PanelHeader
                title="Reset preferences"
                description="Returns every setting on this page to its shipped default and forgets the stored value."
                actions={
                  <Button
                    variant="danger"
                    size="md"
                    icon="refresh"
                    disabled={atDefaults}
                    onClick={() => setConfirmingReset(true)}
                  >
                    Reset to defaults
                  </Button>
                }
              />
              <PanelFooter>
                <span>
                  {atDefaults
                    ? "Nothing to reset — every setting is already at its default."
                    : "Preferences only. No project, keyword or report data is touched."}
                </span>
              </PanelFooter>
            </Panel>
          </div>
        )}
      </div>

      {confirmingReset && (
        <Modal
          title="Reset preferences?"
          description="Every setting on this page returns to its default and the stored value is removed from this browser. Nothing else is affected."
          onClose={() => setConfirmingReset(false)}
          footer={
            <>
              <Button onClick={() => setConfirmingReset(false)}>Cancel</Button>
              <Button
                variant="danger"
                icon="refresh"
                onClick={() => {
                  resetPreferences();
                  setConfirmingReset(false);
                }}
              >
                Reset to defaults
              </Button>
            </>
          }
        >
          <ul className="space-y-2 text-[12.5px] text-fg-muted">
            <ResetLine>
              Command Center opens on{" "}
              <span className="text-fg">{defaultProjectName}</span>, over the
              last 30 days.
            </ResetLine>
            <ResetLine>Both rosters open as cards.</ResetLine>
            <ResetLine>
              Motion follows your operating system again.
            </ResetLine>
          </ul>
        </Modal>
      )}
    </div>
  );
}

function ResetLine({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <Icon
        name="arrow-right"
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle"
        aria-hidden="true"
      />
      <span>{children}</span>
    </li>
  );
}
