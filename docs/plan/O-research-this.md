# O. Research this: highlight a term, get it explained

* **Author:** Yahyaali
* **Date:** 2026-10-28

## Problem

Deep research starts from the ❀ launcher with a typed question. A reader who meets an unknown word wants to
select it and learn what it means *on this page*: "Mercury" on an astronomy page is the planet.

## Answers to the EGM questions

- **Who:** a reader on any page, from the selection toolbar.
- **Constraints:** local model only; searches are the only outside traffic (as with Deep research); page text
  is data.
- **Out of scope:** saving reports to the Library, follow-up questions, images.
- **Success:** the query names the term in the page's sense, the report cites only the sources read, and an
  injected instruction in the sentence changes nothing.

## Targets

- **T1** A "Research this" chip for selections of 1–8 words, at most 80 characters.
- **T2** The model writes the search query from the term, its sentence and the page title; the card shows it;
  a failed or wandering query falls back to the term plus title words.
- **T3** The report: what it is, 3–5 cited facts, and a "Here:" line on the page's sentence.
- **T4** Page text goes to the model as defanged data; the query is one cleaned line.
- **T5** Unit tests for the query step; a browser test on the fixture web with the real model.

## Status

Real model (Gemma 4 E2B, fixture web): "waggle" → searched "waggle dance meaning honeybees", 3 sources, a cited
explanation in about 10 s.

## Review

| Round | Reviewer | Found | Result |
| --- | --- | --- | --- |
| 1 | codebase-details | 1 Blocker (fetched pages reached the model without `defang`, also in Deep research and Check claim), 5 Major, 3 Nit | All fixed: every research prompt is a fixed instruction with page text, titles, snippets, notes, topic and claim in the data, defanged; `around()` takes the offset from the range (repeats, spans, inputs); whole-word "names the term"; Unicode fallback words; model errors are no longer read as "pages would not load"; the browser test checks the query took its sense from the sentence |
