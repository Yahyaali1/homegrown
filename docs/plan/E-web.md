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

Drafted by an agent; smoke check in progress. Update with results and any shared-file changes needed.
