# M — Smarter missions: understanding, background runs, shopping sense

Status: implemented. Measured with `bench/brief-eval.mjs` (understanding) and `bench/extract-eval.mjs` (extraction).
Results are in "Measurements" below.

## Problem

Missions planned in one shot: a search query, columns and a ranking. They didn't know what the user meant:
- **Budgets ignored:** "under $300" was never applied. The filter step was off until the user filled it in.
- **No notion of the thing itself:** only words with digits or hyphens had to appear, so a "headphones" mission
  kept ear pads, cases and earbuds. Worse, the must-mention list was built from the *search query*, so "under
  $40,000" made every row need the tokens "40" and "000".
- **Nothing to correct:** the understanding wasn't visible, so it couldn't be fixed.

## Research that shaped it

- **WebShop** (Yao et al. 2022, arXiv 2207.01206): shopping-agent success is scored on three things. The product
  *type* must be right, the requested *attributes and options* must match, and the price must be within budget.
  Its known failure is a product with similar attributes but the wrong type. Hence a brief with a subject,
  must-haves and a budget, enforced per row.
- **Clarify when necessary** (Zhang & Choi, NAACL Findings 2025) and **SAGE-Agent** (arXiv 2511.08798): ask only
  when the goal is ambiguous, and target the uncertain parts. Here, the reading is shown as an editable "Understood
  as" panel instead of asking a question every time.
- **Chain-of-verification:** short, narrow follow-up questions about the parts a model gets wrong. One kept: it
  checks whether a numbered must-have is exact or a limit. See Measurements.
- **Product matching / entity resolution:** identifiers (GTIN, MPN, SKU) first, then model numbers. Never merge
  variants. Hence `productKey` and the rule that only a confirmed same item counts as "cheaper".

## A. Understanding: the brief (`bg/brief.js`, PLAN in `bg/agent.js`)

**Gemma reads the goal; code never parses it.** An earlier regex parser was removed at the user's request: a
regex can't know what someone means.

1. **PLAN prompt:** Gemma returns the brief and the search plan as one JSON object (temperature 0):

   | Field | Holds |
   |---|---|
   | `subject`, `subject_words` | the kind of thing, and other names for it |
   | `budget` | `{op, value, currency}` |
   | `rank` | `{by, order}` |
   | `how_many` | 1 for one answer, more for a list |
   | `must` | exact words a listing must show |
   | `prefer` | stated wishes and comparisons |
   | `avoid` | what the user excluded |
   | `query`, `fields`, `question` | the search plan |

   Rules and five worked examples teach the distinctions a small model gets wrong (must vs prefer, budget vs spec).
2. **Critic:** `briefProblems` checks the model's output for inconsistencies, e.g. a "must" item holding a money
   word or a comparison, or a price ranking with no price column. Gemma gets one targeted request to fix them.
3. **Verify:** for each numbered must-have, one narrow question: "exact, or a limit?" ("256GB" in "at least 256GB").
4. **`normalizeBrief`:** cleans the JSON (types, numbers, caps). It doesn't interpret anything.
5. **Shown and editable:** Mission control's "Understood as" panel covers looking for, must have, not, ideally,
   budget, best means and how many. Edits rewrite the steps that enforce them.
6. **Enforced every round:**
   - The must-haves become the extract `require`.
   - The budget becomes the filter.
   - The ranking and how-many become the rank step.
   - `enforceSubject` keeps the right kind of thing and drops what the user excluded. On shopping goals it also
     drops accessories for the thing ("Stand for 27-inch monitor"), unless the thing itself is an accessory.
   - The goal check and the answer both see the brief, and the answer must say which part is unmet.

## B. Several missions at once, with a nudge (`bg/agent.js` missionStart / nudge)

- **Background runs:**
  - Missions run in the service worker, keyed by id. Their state lives in a `live` map, mirrored to
    `chrome.storage.session`.
  - Every progress message updates that state (`track`).
  - Mission control attaches with `agent.html?run=<id>` and rebuilds steps, log, rounds, rows and answer.
- **Starting points:**
  - Mission control's Run, the side panel and the ❀ menu all start background missions.
  - The panel's Missions tab lists "Running and recent", each with its plant: growing loop while working, bloom
    when the goal is met, part-grown for a best effort, wilted on failure.
- **The nudge,** only when you're not looking at that mission's tab:
  - On the page you're on: a toast above the ❀ button (content/core.js `nudge`).
  - Otherwise: a system notification.
  - Always: the toolbar badge counts unseen finished missions. Opening one clears its count.
- **Service-worker restarts:** a run can't be resumed, so it's listed as interrupted.

## C. Shopping sense, "like Honey, but smart" (`bg/agent.js` priceSeen / shopCheck / shopDone)

- **Price memory:**
  - Every product page you open records its price under a product key (GTIN → MPN → SKU → model number) in
    `chrome.storage.local`, newest 300 products.
  - The product chip then says what's worth knowing: "Lowest you've seen: $X at store", "↓ $Δ since <date>", or
    "$X at <store>" when today's check found it cheaper.
- **Same item only:** a cheaper offer counts only with the same product key, at another store, in the same currency.
  A "Lite" variant at $149 never counts as "the same headphones, cheaper".
- **Opt-in store check:**
  - Settings → "Shopping sense". It's off by default because it searches the product name on Bing.
  - When you stay 8 s on a product page, a quiet background mission looks for the same item elsewhere, at most
    once a day per product.
  - You're nudged only if it's at least 3% cheaper, and the toast's Open goes straight to that store.
- **What Honey does that this doesn't:** no coupon database or cashback. Those need a server, and everything here
  runs on the device.

## D. Measurements

**Understanding** (`bench/brief-eval.mjs`, Gemma 4 E2B; a goal passes only if every listed fact is right):

| Version | Tuned set (16) | Held-out set (8) |
|---|---|---|
| Plain PLAN prompt | 11/16 | n/a |
| + clearer rules, budget/rank fields first, critic pass | 13/16 | n/a |
| + narrow verification of budget, one-vs-list, numbered must-haves | 10/16 (budget and one/list questions made it worse) | n/a |
| + numbered must-haves verification only (shipped) | 14/16 | 5/8 |
| Constrained decoding: plan as a LiteRT tool call with a JSON schema | 7/16 | 3/8 |
| After removing an example that taught invented exclusions | 14/16 | 5/8 |
| **+ critic: a negated wish ("not refurbished") belongs in avoid** (shipped; held-out set now 9) | 13/16 | **9/9** |
| **Same prompt on Gemma 4 E4B** (2.97 GB) | 13/16 | **8/8** |

- **Constrained decoding:** the JSON always parses, but Gemma leaves optional fields out (budget, rank, must). It was
  removed.
- **Held-out misses (E2B):** a ranking word on a non-shopping goal ("biggest air fryer", "cheapest flight") and "4" in
  "4-person". E4B reads all eight held-out goals right, at about 7 s per goal versus 5 s. The editable brief is the
  safety net either way.
- **Other open models with LiteRT builds** (Qwen3-4B-Instruct, Qwen3.5-4B, Ministral-3-3B, SmolLM3, Phi-4-mini) have no
  official *web* build, so they weren't benchmarked. Gemma 4 E4B is the only bigger model the browser engine is
  known to run. NuExtract3 (a 4B JSON-extraction fine-tune of Qwen3.5) would be the next to try if a web build appears.

**Live web run** ("noise-cancelling headphones under $200, not refurbished", E2B, 144 s):
- Brief: headphones, avoid refurbished, under 200 USD, best rated first.
- Set aside: 5 rows that weren't headphones, 1 review article ("The 5 Best … Under $100", whose price came from its
  own title), and 17 over budget.
- Result: five distinct real headphones under $200 (KVIDIO $25, Sony ULT WEAR $129.95 and $147, Sony WH-CH720N $179.99,
  Nothing Headphone (a) $199).
- The answer says plainly that no listing showed a rating.

Two fixes came from this run:
- **Ranking:** rows without the ranking field now follow the ranked ones instead of vanishing. A rating ranking had
  dropped every shop listing.
- **De-duplication:** it now runs on all rows, ranked or not.

**Extraction** (`bench/extract-eval.mjs`, real pages, 38 questions over four sets): **38/38** after all of the above,
the same as before.

## E. A model per task, changed by asking (`bg/engine.js` TASKS/modelFor, offscreen `useModel`, side panel)

- **Tasks:** Chat in the side panel, Actions on pages, Missions, Background work. Each can use any downloaded model,
  or "Automatic" (whichever is loaded). This lives in `settings.taskModels`.
- **Switching:** a request names its task's model. The engine swaps models inside its queue (one in memory at a
  time; a swap takes a few seconds) and never mid-request.
- **Choosing:** the user picks, never Homegrown. Either Settings → "Which model does what", or by asking in Chat.
  For Chat, Gemma reads a short message against the list of settings and allowed values (models, theme, every
  on-page toggle, translation language). Code only checks the answer names a real setting and value. It becomes a
  card, "Change model for missions from automatic to Gemma-4-E4B-it? Apply / Not now", and nothing changes until
  Apply.

## Next

- Try a web build of a JSON-extraction model (NuExtract3, Qwen3-4B-Instruct) on `bench/brief-eval.mjs` when one exists.
- Grouping rows by `productKey` in shopping answers ("the same monitor at 3 stores").
- Shopping sense for prices in other currencies (convert, don't skip).
