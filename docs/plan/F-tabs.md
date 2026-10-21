# F — Tabs, automation, tasks, side panel

Files: `bg/tabs.js`, `bg/monitors.js`, `content/tabs.js`, `sidepanel.html/js/css`.

| Feature | Plan |
|---|---|
| Compare tabs | Launcher "Compare tabs…": pick tabs → text via `chrome.scripting` → comparison table or per-tab summaries (render tables in the card) |
| Tab Tidy | Launcher "Tidy tabs": model groups tabs as JSON → `chrome.tabGroups` with names; duplicates flagged; "where was I" note per group (`tabNotes`) |
| Page monitors | Launcher "Watch this page" (hourly/daily) → `monitors`; `chrome.alarms` fetch + diff + 1–2 sentence change summary → notification |
| Scheduled tasks | Side panel: run a page task on a URL hourly/daily → `scheduledResults` + notification |
| Task variables & sharing | Inline edit, reorder, `{variables}` defaults in `taskVars`, export/import JSON, copy/paste share |
| Side panel | Models + Tasks (+ Monitors list) are the reason to open it; Chat/Prompt Lab/Ask Image stay with a note |

## Status

Drafted by an agent; smoke check in progress. Update with results and any shared-file changes needed.
