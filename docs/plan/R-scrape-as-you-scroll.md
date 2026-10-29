# R. Scrape as you scroll

* **Author:** Yahyaali
* **Date:** 2026-10-29

## Problem

Collect needs rules the user writes. The goal set in plan P: the page's data fills a table while the reader
scrolls, like the bilingual page, and the model decides which tool fits each thing.

## Answers to the EGM questions

- **Who:** a reader on any page, from the ❀ launcher.
- **Constraints:** local model only; reading only (the `read` tools of plan P: no click, fill or code); page
  text goes to the model as data; bounded calls (25 blocks a page, 20 items a call).
- **Out of scope:** blocks inside iframes, saving to the Library, sending to Collect.
- **Success:** tables and fact lists collected without a model; a product grid recognised as records with
  sensible fields; menus, footers and prose left alone; an infinite feed keeps adding rows.

## Design

- Blocks: tables, `<dl>`s and "Label: value" lists are read directly (`table_json`-like, facts). Repeated blocks
  go to the model: one call decides records or furniture and picks 2–6 fields; grounded AI fields fill them.
- An IntersectionObserver queues blocks as they near the view, as translation does; a MutationObserver finds
  new blocks and new items.
- Results stay in the page: a bar with the count, Show, Copy JSON, CSV and Stop.

## Status

Real model (Gemma 4 E2B): the care table (2 rows), then the product grid (picked `name`, `price`,
`shipping_time`), then 5 more cards from the feed: 11 rows; the menu and the article were not collected.
Without a model, tables and facts still come in and the bar says why lists wait.

## Review

| Round | Reviewer | Found | Result |
| --- | --- | --- | --- |
| 1 | design | 1 Blocker (the outermost repeated container won, so a grid inside page sections was never collected), 6 Major, 2 Nit | All fixed: the innermost block wins; layout tables skipped and rows read directly; lists over 20 items go on while in view; budgets for model requests, and Stop cancels the call through a session port; scans only of what changed, when idle; card lists with "Price:" lines aren't facts; items remembered one by one (prepend, recycle); late answers after Stop dropped; skipped blocks outlined and counted |
| 2 | design | no Blockers, 6 Major, 2 Nit | All fixed: innermost across scans (a late grid drops the wrapper, even mid-read); per-item detail blocks stay in their list; facts need one pair per child; items keyed by text with text changes watched; mutation scans limited to added subtrees; runs only while the port is open (reconnects after a worker restart); restart and retry budget fixes. Real model: a grid loading 4 s after the start inside sections is collected |

## Whole page and Organize

Asked for after the first version: capture literally everything, then have the agent place it in tables.

- **Whole page** switch: the page split at its headings; each section's text and Markdown captured as it comes
  into view, without navigation, headers, footers or scripts.
- **Organize**: the rest captured, then one model call per section: a table the model designs (name, up to 6
  columns, 15 rows), each cell kept only when the section's text says it; prose gets no table. An outline
  (heading, level, words) without a model.
