# E — Search, research, links

Files: `content/search.js`, `content/links.js`, `bg/web.js`.

| Feature | Plan |
|---|---|
| Web helpers | `bg/web.js`: `fetchText({url})` (tag-strip, prefer article/main), `search({q,n})` (DuckDuckGo HTML), `research({q,n})` (search → fetch top 6 → summarize each → cited report) |
| Search answers | On Google/Bing/DuckDuckGo results: compact card summarizing visible snippets; "Read top results" escalates; setting `searchAnswers` (default on) |
| Deep research | Launcher "Research…": progress lines → report with numbered, clickable sources |
| Check a claim | Text action: search selection, fetch 3 results, verdict + sources |
| Related reading | Page action: 5 related links with one-line why |
| Link X-ray | Long-press (500 ms) a link: title, reading time, 3 key points; warns when link text names another domain, punycode or lookalike domains; suppresses the click |

## Status

Done (agent E, smoke-checked on the real model): link X-ray (key points, no navigation, phishing warnings
on a lookalike link), Check claim ("Supported" with 3 sources, ~31 s), Research (6 pages, cited report
with working links), Bing answer card, parsers checked against live pages. `EG.web` and `EG.links` exposed.

Integration (main session): toolbar now draws above an open card (z-index); `linkPreview` switch added
to settings (searchAnswers was already there).

Left: DuckDuckGo returns a bot challenge (HTTP 202) after repeated runs from one IP, so checks used the
Wikipedia fallback, which only searches Wikipedia — a better fallback search source is still needed.
The search answer card runs the model on every results page while `searchAnswers` is on (default on).
