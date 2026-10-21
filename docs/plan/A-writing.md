# A — Writing

Files: `content/writing.js`, `content/ghost.js`, `content/replies.js`, `content/jargon.js`, `content/forms.js`.

| Feature | Plan |
|---|---|
| Write-back | Result action "Insert"/"Replace selection" when the card came from an editable selection; `EG.writeBack(text, current.sel)` |
| Proofread | Text action; proofreading prompt; offers Replace |
| Paraphrase modes | "Rewrite ▸" picker: Standard, Fluent, Formal, Casual, Shorter, Longer, Simple, Creative |
| Templates | Launcher "Write…": ~10 templates (email, cover letter, tweet, LinkedIn post, summary, outline, product description, apology, thank-you, meeting notes) + free prompt |
| Your voice | Approved Inserts saved to `voiceSamples` (local, last 20); up to 3 used as style hints; setting `useVoice` (default on) |
| Ghost text | Opt-in `ghostText`: after 900 ms pause and ≥20 chars, ≤15-word grey continuation; Tab accepts; never in password fields; cancel on typing |
| Reply buttons | "✦ Reply" pill on focused compose boxes (Gmail, Outlook, LinkedIn, X, Slack, WhatsApp, Discord, generic); drafts from visible thread (last ~4000 chars) |
| Jargon lens | Hold Alt >400 ms over a term → plain-language tooltip from paragraph context; cached per term |
| Form helper | Launcher "Help with this form": explain fields; propose values from a note; fill only after "Fill"; never password/payment fields |

## Status

Done (agent A, one smoke run on the real model): Proofread + Replace, ghost text with Tab, reply pill
draft + insert, jargon tooltip, form helper (fills name/email, leaves password/card), tweet template
insert, voice samples stored. "Insert" also works for any answer at the caret of the last text box.

Left: "Rewrite as ▸" not clicked (same path as Proofread); form helper skips checkboxes/radios.
Requests: settings switches for `ghostText`, `useVoice`, `replyButtons`; history/savings must skip
requests marked `quiet: true` (forwarded to group G).
