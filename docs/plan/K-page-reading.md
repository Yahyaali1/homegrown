# K — Reading any web page (for Missions)

Goal: the agent can find what it needs on any page — a price in a product grid, a spec in a table, a
date in an article — without trusting a 2B model to read raw HTML.

## What the state of the art says

| Approach | Finding | Source |
|---|---|---|
| Rule-based main-content extraction | Trafilatura family leads the 2,008-page WCXB benchmark (F1 0.86–0.90, ~44 ms/page); Readability 0.67–0.74 overall but strong on articles | [WCXB](https://arxiv.org/html/2605.21097v1) |
| Small LLM extractors | ReaderLM-v2 (1.5B) 0.74 at ~10 s/page; MinerU-HTML 0.83 on GPU — heuristics win on speed and accuracy | [WCXB](https://arxiv.org/html/2605.21097v1) |
| Agent page representations | Simplify the DOM: visible elements only, indexed interactive elements (browser-use), strip decoration (page-agent), DOM downsampling | [browser-use](https://tessl.io/registry/tessl/pypi-browser-use), [D2Snap](https://arxiv.org/html/2508.04412v1) |
| Structured data | Pages publish JSON-LD, microdata, RDFa and Open Graph (what `extruct` reads) | schema.org |
| List scraping | Free "instant data scraper" tools find repeated sibling blocks (product cards, results) and turn them into rows | — |
| Server-side readers | Crawl4AI (open source, self-hosted, JS rendering), Firecrawl (API, crawl/agent, AGPL self-host), Jina Reader (URL → markdown) — all need a server; we do the same conversion inside the user's own browser tab | [comparison](https://toolhalla.ai/blog/firecrawl-vs-crawl4ai-vs-jina-reader-2026), [Jina vs Firecrawl](https://blog.apify.com/jina-ai-vs-firecrawl/) |

## Design: a layered page model, model last

`lib/pageread.js` runs inside the page (injected) and returns a **page model**:

1. **Structured:** JSON-LD (incl. `@graph`, nested offers), microdata (`itemprop`), Open Graph / product meta.
2. **Main content as markdown:** Mozilla Readability on a clone of the document, then a small DOM→markdown
   converter that keeps headings, lists, links and tables. Falls back to the largest text block.
3. **Tables:** every visible `<table>` (and ARIA grids) as header → rows.
4. **Repeated items:** sibling groups with ≥3 members sharing a tag/class signature, each holding text and a
   link; each becomes a record (title, url, price + currency, rating, image) — product grids, search results.
5. **Prep:** auto-scroll to load lazy content, read open shadow roots, skip hidden elements.

Mission extraction then goes deterministic → model:
structured product → repeated items → tables → **Gemma on the most relevant markdown chunks only**
(keyword ranking by field names and goal) with a JSON schema → **grounding check**: a value Gemma returns
must appear in the page text (numbers matched after normalising), otherwise it is dropped. Rows carry
`_via` (structured / list / table / model) so the table shows how each value was found.

## Status

Done (main session), checked on fixture pages and the live web:

| Page | Path used | Result |
|---|---|---|
| Product grid, no product data, sale + crossed-out prices (`tests/fixtures/pages/grid.html`) | list | 4 products, sale prices, numeric ratings, no model call |
| Spec table (`pages/specs.html`) | table | 3 laptops ranked by battery |
| Review prose with a planted injection (`pages/review.html`) | model on relevant chunks | $229 / $399 / $549 correct; injected "$1" ignored; "not recommended" item left out |
| 3 shops (2 JSON-LD, 1 text only) | structured + model | correct, Charlie Shop's store name from the page's own metadata |
| Live: "cheapest 27-inch 4K monitor with USB-C" | list (Amazon results grid) | 46 rows from 6 pages → 10 after required-term filter (27, 4k, usb-c) → answer quotes "1980.04 SEK" |

Hardening found by these runs: digit classes ignored in block signatures (item-1, item-2); required terms
from the query with synonyms (4K = UHD = 3840, USB-C = Type-C); prices passed to the answer with their
currency; extraction runs at temperature 0; instruction-like sentences removed from page text before the
model reads it and before grounding (a sampled run had returned the injected "$1").

Engine: one generation at a time on the GPU, now in two lanes — what the user just asked for runs before
background work (missions, gists, page translation, monitors). Measured: 4 parallel requests all correct,
no cross-talk; a question asked while 6 long background jobs were queued was answered after 1 of them
(3.4 s) instead of after all 6 (~22 s).

### Benchmark on real pages (`bench/extract-eval.mjs`)

Each case runs as a mission and is scored against an answer computed independently from the page HTML
(or a known fact). Two consecutive runs: **10/10 correct** both times.

| Case | Kind of page | Path |
|---|---|---|
| books.toscrape: cheapest book | product grid, names cut with "…" | list |
| books.toscrape: one book's price | product page | table |
| webscraper.io: cheapest laptop | grid with microdata | structured |
| scrapethissite: most wins 1990 | headed table | table |
| scrapethissite: largest country | 250 cards in Bootstrap rows, no links | list |
| Wikipedia: tallest building | many tables, unit columns | table |
| Wikipedia: Eiffel Tower height | infobox with sub-labels (Architectural / Tip) | table + model |
| Hacker News: most points | title and points in separate rows | list |
| Wikipedia: Iceland population | infobox, footnoted number | table + model |
| quotes.toscrape: authors | repeated blocks | list |

The first run scored 2/10. Fixes, all general rather than per-site: full names from link `title` attributes;
microdata names and prices; numbers typed from any "number + short unit" value and scientific notation;
labelled parts of blocks (class / itemprop / data-label → field); grids split into rows merged into one list;
records split over sibling rows joined; numbers found next to a field's name ("342 points"); key/value
tables as facts about the page's subject, with the model choosing among sub-labels; unit-aware column
matching ("height_m" → "Height (m)"); and every source proposing rows, scored by completeness, instead of
a fixed order. Fixture pages and the live monitor mission still pass.

### Held-out set (written after the fixes above, scored before any change for it)

`node bench/extract-eval.mjs heldout` — 9 new pages: a books category page, a microdata phone grid, Mount
Everest and Python infoboxes (footnoted number, date), a quotes tag page, a search-filtered hockey table,
Wikipedia's largest cities (two-row headers, CSS in cells), scrapethissite's AJAX Oscars page (data only
after clicking "2015"), and a local page of shadow-DOM product cards.

| Run | Held-out | Tuned |
|---|---|---|
| First held-out run, unchanged reader | **4/9** | 10/10 |
| After general fixes | **9/9** | 10/10 |

Fixes from the held-out failures: the page's subject fills the first field on infobox questions; numbers
taken from values with units, footnotes and notes ("8,848.86 m (29,031.7 ft)[note 2] Ranked 1st");
table cells read as rendered text with footnote markers removed; multi-row headers merged with
colspans/rowspans; **open shadow roots flattened** in background mission tabs; **in-page controls clicked**
when named after a goal term (years like "2015") or when they expand content ("Show more") — never links
to other pages, submit buttons or anything inside a form; the name column found when no header names it.

The 4/9 is the honest generalisation number for the reader as it was; 9/9 is after fixing for these pages,
so a third, fresh set is the way to measure again.

### Fresh third set (written after the held-out fixes, scored untouched)

`node bench/extract-eval.mjs fresh` — 9 more new pages (quotes page 2, poetry books, tablets, New York
hockey seasons, Moon / Burj Khalifa / JavaScript infoboxes, Ask HN comments, lakes by area).

| Reader version | Fresh | Held-out | Tuned |
|---|---|---|---|
| Before any fresh-set change | **7/9** | 9/9 | 10/10 |
| After one general fix (infobox labels scored by all field words, real infobox preferred) | 8/9 | 9/9 | 10/10 |

So generalisation went from 4/9 (first held-out, untouched) to 7/9 (fresh, untouched). Remaining miss:
"floors" picks the Burj Khalifa infobox's "Floor area" instead of "Floor count" — left unfixed rather than
add a rule for one page.

Also added: cross-origin iframes are read (the reader runs in every frame of a mission tab and the
results are merged) — checked with a product grid inside a cross-origin iframe, ranked correctly.

Left: closed shadow roots can't be read; controls are clicked only when named after a goal term or
obviously expanding; label choice between near-synonyms ("floor area" vs "floor count") is lexical;
markdown capped at 60k characters.
