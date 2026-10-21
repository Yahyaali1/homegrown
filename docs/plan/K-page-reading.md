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

In progress (main session).
