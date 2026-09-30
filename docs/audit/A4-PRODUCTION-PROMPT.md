# Audit A4 — production screen check (operator, read-only)

Paste the block below into Cowork (Claude in Chrome) while signed in to the production app as the operator. It opens
each page by typing its address, takes a desktop and a 375 px screenshot, and notes what it sees. It never clicks a
button, a form control, a menu or a tab. Tabs are reached by `?tab=` in the address.

```text
READ-ONLY SCREEN CHECK of https://nexra-seo-command-center.vercel.app — I am already signed in in this browser.

HARD RULES (break none of them; if one would be broken, stop and tell me):
1. Navigate ONLY by typing each URL below into the address bar and pressing Enter. You may scroll. You may not click
   anything on the page: no button, link, tab, menu, dropdown, select, checkbox, input or form. Never press Enter or
   Space while focus is on the page.
2. Never click or activate anything labelled (or looking like) Run, Run Now, Run Crawl, Crawl, Queue, Analyze, Check,
   Record, Save, Approve, Confirm, Propose, Withdraw, Hand off, Track, Import, Add, Create, Delete, Remove, Cancel,
   Retry, Apply, Print, Sign out, or any account, workspace or notification menu.
3. Never type into the page. Never sign in, sign out or enter a password. If a page sends you to /login, stop and tell
   me.
4. Do not open developer tools except the device toolbar for the narrow view (step B).

FOR EACH URL, in order:
A. Desktop: window about 1280–1440 px wide. Load the URL, wait 15 seconds, scroll to the bottom once, then scroll back
   to the top. Take one screenshot of the top of the page, and one more if something below looks wrong.
B. Narrow: switch to a 375 px wide view (Chrome device toolbar, "iPhone SE", 375 × 667; or resize the window to 375
   px). Reload, wait 15 seconds, and take a screenshot. Scroll sideways once: does the page scroll horizontally? If
   you cannot get a 375 px view, say so once and continue with desktop only.
C. Note, for this URL:
   - HTTP-level result: page shown / "not found" screen / "This screen failed to load" / sent to /login / blank.
   - Any error text on the page (quote it exactly), e.g. "could not be read", "failed", "not found", "Not read".
   - Anything still showing "Loading", "Reading…" or a spinner after 15 seconds (endless loading).
   - Broken layout: horizontal scroll at 375 px, text or tables cut off or overlapping, elements running off screen.
   - Any figure shown as 0 where the page elsewhere says the data was not read.

URLS (26):
1  https://nexra-seo-command-center.vercel.app/?project=nexra-agency
2  https://nexra-seo-command-center.vercel.app/projects
3  https://nexra-seo-command-center.vercel.app/projects/nexra-agency
4  https://nexra-seo-command-center.vercel.app/projects/halcyon-fintech
5  https://nexra-seo-command-center.vercel.app/agents
6  https://nexra-seo-command-center.vercel.app/agents/seo-director
7  https://nexra-seo-command-center.vercel.app/agents/project-manager
8  https://nexra-seo-command-center.vercel.app/keywords?project=nexra-agency&tab=keywords
9  https://nexra-seo-command-center.vercel.app/keywords?project=nexra-agency&tab=lists
10 https://nexra-seo-command-center.vercel.app/keywords/1ac3af3b-103f-46db-bbf2-ec8556646403?project=nexra-agency
11 https://nexra-seo-command-center.vercel.app/content?project=nexra-agency&tab=articles
12 https://nexra-seo-command-center.vercel.app/content/1003104c-6b25-456f-9304-eefa2ba88e7d?project=nexra-agency
13 https://nexra-seo-command-center.vercel.app/content/c89182f9-4954-4834-8446-a831fc3c42d0?project=nexra-agency
14 https://nexra-seo-command-center.vercel.app/technical?project=nexra-agency&tab=overview
15 https://nexra-seo-command-center.vercel.app/technical?project=nexra-agency&tab=issues
16 https://nexra-seo-command-center.vercel.app/technical?project=nexra-agency&tab=pages
17 https://nexra-seo-command-center.vercel.app/technical/pages/771a12e3-c57b-4d97-8150-6599798ced16
18 https://nexra-seo-command-center.vercel.app/competitors?project=nexra-agency
19 https://nexra-seo-command-center.vercel.app/competitors/2vautomation.ai?project=nexra-agency
20 https://nexra-seo-command-center.vercel.app/ai-visibility?project=nexra-agency
21 https://nexra-seo-command-center.vercel.app/backlinks?project=nexra-agency
22 https://nexra-seo-command-center.vercel.app/analytics?project=nexra-agency&tab=overview
23 https://nexra-seo-command-center.vercel.app/analytics?project=nexra-agency&tab=learnings
24 https://nexra-seo-command-center.vercel.app/reports?project=nexra-agency
25 https://nexra-seo-command-center.vercel.app/settings
26 https://nexra-seo-command-center.vercel.app/api/health   (desktop only; copy the JSON text exactly)


REPORT BACK:
- One table: # | URL | desktop result | 375 px result | horizontal scroll at 375? | error text (exact) | endless loading? |
  other layout problem.
- Then a list of every problem found, most serious first, each with its URL and screenshot name.
- Then confirm in one line: "I clicked nothing on any page, typed only URLs, and made no change."
- Attach or save all screenshots, named <number>-desktop.png and <number>-375.png.
```
