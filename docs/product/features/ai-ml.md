# AI & ML ideas

The single home for every AI/ML-shaped DiveDay idea — from a raw one-line concept to a
prompt-ready implementation task. Previously split across a brainstorm file and a specialist
audit's ML & data section; consolidated here 2026-08-01 so there is exactly one place to look.
Nothing here is committed scope until a human decision and scoped GitHub issue promote it, with
an ADR for a provider/dependency boundary and the right safety review. [roadmap.md](roadmap.md)
links current priorities; search current code, issues and shipped work before reviving a prompt.

**What shipped (2026-10-18):** the provider boundary exists. Claude is a runtime dependency behind
`src/lib/claude/` and `runAssist` in `src/features/assists/store.ts`, dark without a key, with the shop's
"Claude suggestions" switch off, or past the shop's $15 monthly cap, and every call is costed in
`claude_usage` ([ADR 20261018-claude-assists](../../architecture/decisions/20261018-claude-assists.md)).
The features built on it (inbox drafts and sorting, import mapping, card reading, website setup and
the rest of the build plan) land in the layers above that ADR; each keeps the guardrails below. The
"app has no LLM dependency" baseline in the audit section is out of date for that reason.

**Front of house (2026-10-22)**, each rendered only while the shop's assists are on:

- **Inbox sort and translate**: an intent and urgency tag and a translation, stored on the message
  (`inbound_messages.assist_*`) by the inbound webhooks and the inbox view; the diver's words stay
  in view, and a cancellation still goes through the reply keyword's confirm.
- **Reply draft and translation**: Draft and Translate beside the diver record's reply box; a draft
  is thrown away when it quotes a number, in digits or words, the shop's facts did not give it (a
  number only the diver wrote does not count), or the diver asked a medical question; a translation
  is thrown away when its numbers are not the staffer's. Staff send.
- **Request and call note**: "Make a request" reads a message, and the Took-a-call scribble box
  reads a call, into the Took-a-call form's own fields for a staffer to log; admission decides
  after that. The scribble lands in the note as typed.
- **Import mapping**: headers and masked values from at most 50 rows, never a column that mentions
  health, map the columns the aliases miss; a card read through a suggested column imports pending.
- **Waiver from PDF**: the release editor's text drafted from the shop's PDF. Not legal advice; the
  owner publishes.
- **Website setup**: Import's Website tab reads the pasted host only (`web_fetch`), stores lines in
  `website_setup_drafts`, and writes one only when the owner accepts it, its source sentence beside
  every price.

**Content and desk assists (2026-10-22):** card-photo reading at the desk and at sign-up, the
gear-note fill, a same-person read on merge, review flags and monthly themes, the
Monday read in the weekly digest, trip and course description drafts, Spanish drafts of shop text
(`shop_text_translations`, shown on the shop's diver pages), dive-site briefs, the recap line
(drafted, or filled before send when the shop allows it), sightings matched from what the crew
said, and bench notes on work orders. Pure prompt and guard code is in `src/lib/assists/`, cached
reads in `assist_results`. No prompt carries medical or waiver answers; a fact the model must
repeat is passed as a placeholder, and an answer that invents a number or a species is refused.

## Claude assists in detail

The mechanics behind [ADR 20261018-claude-assists](../../architecture/decisions/20261018-claude-assists.md),
kept here so the ADR stays short.

- **Models**: `quick` (Haiku) sorts, extracts and writes short text; `draft` (Sonnet) drafts,
  onboards, reads a photo Haiku could not, and runs anything that uses `web_fetch`, which Haiku
  lacks.
- **Provider**: the SDK with its base URL pinned; the fake is in `src/test/fakes.ts`.
  `callStructured` sends the stable context first under `cache_control`. A refusal, a truncation,
  invalid JSON, low confidence or a provider error each return `null`.
- **The switch and the dark rules**: "Claude suggestions" is under Settings → Features, on by
  default. A demo shop is dark because anyone can mint one. The $15 cap counts the UTC month.
- **Ledger**: a `claude_usage` row holds the shop, feature code, model, outcome code, token counts,
  cost in micro-USD at list price, the call's latency and Anthropic's request id. A price change
  updates `models.ts`, Haiku's long-prompt rate included.
- **What was said, 30 days**: a `claude_call_content` row beside each usage row keeps the
  instructions, shop context, request and answer as text, every image and document a placeholder
  and every fetched page a URL. DiveDay reads it by SQL
  ([runbook](../../engineering/claude-call-content-runbook.md)); every erasure deletes the
  shop's rows.
- **Reservations**: each call reserves its likely cost under a per-shop lock, with at most two in
  flight, so concurrent calls overshoot the cap only by how far a call exceeds its reservation. A
  call that may have been billed and failed is charged its reservation.
- **Websites**: `webFetchTool` sets `allowed_domains` to the pasted host. A public suffix
  (`co.uk`, `wixsite.com`, from the Public Suffix List via `tldts`) or a shared service's root
  (`facebook.com`) is refused, since the allowance covers every subdomain.
- **On screen**: `AssistDraftButton` fills one field, `AssistFillButton` several boxes of one
  form, `AssistPhotoButton` a form from a card photo, `AssistReadButton` shows a read in place
  (the merge check), `CallNoteAssist` fills the Took-a-call form from a call note, `PdfDraftButton` drafts the release
  editor from a PDF, `TranslateReplyButton` puts a reply in the diver's language before Send, and
  `TranslationEditor` holds the Spanish of a shop field, saved on its own form.
- **A new assist** adds a prompt, a schema, a feature code and an action. Leaving Claude also
  drops `claude_usage` and `claude_call_content`.
- **The diver's card photo** fills agency, level and number. What the diver submits is filed as
  their own word, never as evidence. `scanCard` stops at Haiku when the photo is not a card. Every
  other assist runs for staff.

### Recap highlights, filled before send

With "Recap highlights" on (`shops.recap_assist_auto_approve`, Settings → Features, on for a new
shop since 2026-10-23), the recap send (`autoFillRecapLine` in `src/features/recap/recap-assist.store.ts`, called from
`src/features/recap/store.ts`) writes Claude's line into `trips.recap_shoutout` as if the crew had saved it,
and divers read it on the recap. Turning the switch on is the shop's standing approval. Its guards:

- It fills a blank highlight only. The update is conditioned on `recap_shoutout IS NULL`, so a
  crew's own words are never replaced, even by a race.
- It never runs on a departure with a live incident report: that recap may reach the diver it is
  about, or their family.
- The line is built from the crew's logged sightings, sites and conditions only. Crew notes are
  not sent. Every site, species and count goes in by placeholder, and a line that writes its own
  number, puts a creature at another site, or names a species the crew did not log is refused
  (`recapLine`).
- Any failure is no line. A refused line is remembered for that sightings log, so the next send
  does not ask again. The recap still sends, and the crew can still draft and save one by hand on
  Today.

## Guardrails

- AI suggests; the safety spine decides.
- Low-confidence extraction fails closed.
- AI output on safety, medical, certification, nitrox, payments, or boarding surfaces must cite the
  underlying app state and stay reviewable by a human.
- No AI clears readiness, boarding, medical review, nitrox fill authorization, or refund/payment
  state.
- At single-shop data scale, SQL aggregates and transparent scoring beat trained models everywhere
  except language tasks (moderation, translation, summarization), where the Claude API is the
  right tool. Prefer a named, auditable rule table over an opaque score on any safety-adjacent
  surface.

**Explicitly rejected as not worth building now** (per the 2026-07-31 specialist audit): training
any custom model — every surface here is below the data volume where one would beat a heuristic
or SQL aggregate; LLM-drafted replies to reviews;
LLM anything on cert gating, manifests, or medical decisions (hard rule: assistive only, and the
assistive versions are deliberately model-free where they touch those surfaces); and dynamic
pricing beyond the last-minute rule table (Stripe owns arithmetic; trust risk exceeds upside for a
delight-first product).

## Raw ideas — not yet scoped

Exploratory only. No effort estimate below the level of "big bet"; these need a design pass before
anyone writes a prompt. Card-photo reading, once listed here, is built (see above).

- **Diver-facing Q&A grounded in real state.** Answer questions like "Can I dive the wreck Saturday
  with Open Water?" from schedule and readiness logic. The answer can explain, but the readiness
  engine remains authoritative. *(L, cross-cutting, big bet.)*
- **Natural-language ops assistant.** Staff-only assistant for operational questions such as "Who is
  not ready for tomorrow's wreck trip?" Answers must cite the underlying app state. *(L,
  cross-cutting, big bet.)*

## Historical prompt sketches — from the 2026-07-31 specialist audit

The audit's eight ready-to-paste prompts were removed on 2026-11-10: their file paths and line
numbers had drifted, and every module except review moderation (shipped 2026-10-22) was still
unbuilt when the code was re-checked on 2026-11-10. The full text is in
[the archived audit](../archive/specialist-optimization-audit-20260731.md) and stays there as
history, not as scope. What is worth keeping:

- **Filed as issues**: lapsed-regular win-back list [#4246](https://github.com/AaronBuxbaum/diveday/issues/4246),
  next-course card on the recap page [#4249](https://github.com/AaronBuxbaum/diveday/issues/4249),
  Spanish drafting script [#4250](https://github.com/AaronBuxbaum/diveday/issues/4250).
- **Parked, no issue**: departure-demand signal on the schedule builder; a last-minute-deal discount
  advisor; a "answered differently than last time" note between a diver's waivers (informational,
  never gating); a boarding-attention checklist; Today-queue click instrumentation before any
  re-ranking. None has a user to learn from yet. If one is revived, check the current code first.
- **The rule that outlived the prompts**: at one shop's volume, a SQL aggregate or a named rule
  table beats a trained model, and every one of those ideas had to stay assistive and never gate
  boarding, medical review or payment. That is the Guardrails section above.

North-star measures these ideas could eventually feed are in
[the archived roadmap's measures](../archive/roadmap-20261110.md#measures): instrument before
ranking, never the reverse.
