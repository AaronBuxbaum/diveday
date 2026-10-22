# 20261018-claude-assists — Use the Claude API for staff assists behind one dark-by-default seam

- **Status:** Accepted
- **Date:** 2026-10-18

## Context

Aaron picked twenty-one Claude features (inbox replies, import mapping, card reading, website
setup and more). All send shop data to an outside model, so they need one dependency, one gate,
one cost ledger and one rule about what a suggestion may do. Invariants: an
assist clears no gate (readiness, admission, cert, medical, nitrox, boarding), sends nothing to a
diver without a staff tap, and publishes nothing; every feature works identically without it.

## Decision

- **Dependency**: `@anthropic-ai/sdk` (runtime). Models by role, in `src/lib/claude/models.ts`:
  `quick` is `claude-haiku-5-5` (sorting, extraction, short text), `draft` is `claude-sonnet-5-5`
  (drafting, onboarding, vision fallback, and anything using `web_fetch`, which Haiku lacks).
- **Seam**: `src/lib/claude/` holds the provider (SDK with the base URL pinned; fake in
  `src/test/fakes.ts`), the dark rules, the price table and `callStructured`: stable context first
  under `cache_control`, the answer constrained by a zod schema and validated again. Refusal,
  truncation, invalid JSON, low confidence and provider errors return `null`; nothing throws.
- **Running**: every feature calls `runAssist` (`src/db/assists.ts`) with the session's shop. It is
  **dark** with no `ANTHROPIC_API_KEY`, with `DIVEDAY_DISABLE_EXTERNAL_HTTP=1`, when the shop's
  "Claude suggestions" switch (Features, on by default) is off, for a demo shop (anyone can mint
  one), or when the shop's spend this UTC
  month reached its cap: $15, `DIVEDAY_CLAUDE_SHOP_MONTHLY_CAP_USD` overrides it.
- **Ledger**: `claude_usage` records every call (shop, feature code, model, outcome code, token
  counts, cost in micro-USD at list price). It holds no prompt, answer or person. The cron's
  `anthropic_spend` ceiling ($200 a month, alert-only) sums it across shops.
- **Websites**: read through the server-side `web_fetch` tool restricted by `allowed_domains` to the
  exact host the owner pasted (`webFetchTool`); a registry or a builder's shared root (`co.uk`,
  `wixsite.com`) is refused, since the allowance covers every subdomain. DiveDay's servers never
  fetch it.
- **Screen**: quiet controls in `src/components/assists/`, each rendered only when
  `assistsAvailable` is true, each leaving the page's own save, send or merge as the way through:
  `AssistDraftButton` (one field), `AssistFillButton` (several boxes of one form),
  `AssistPhotoButton` (a card photo into a form), `AssistReadButton` (a read shown in place, for
  the merge check), `AssistAskForm` (plain words into the divers list's own filters),
  `CallNoteAssist` (a call note into the Took-a-call form), `PdfDraftButton` (a PDF into the
  release editor), `TranslateReplyButton` (a reply in the diver's language before Send) and
  `TranslationEditor` (the Spanish of a shop field, saved on its own form).

## Alternatives considered

- **Raw `fetch`**: the SDK carries the types, retries and error classes.
- **One switch per feature**: twenty-one switches nobody reads.
- **A hard $200 platform cutoff**: guardrails are alert-only (ADR
  20260806-provider-usage-guardrails); the per-shop cap bounds each shop.

## Consequences

Later layers add a prompt, a schema, a feature code and an action. Shop data now reaches
Anthropic and the switch is on by default, so the key is the gate: the privacy-policy subprocessor
entry and a confirmed retention setting come before `ANTHROPIC_API_KEY` is set in production
(issue #2836). A price change needs `models.ts` updated (Haiku's long-prompt rate included). Each
call reserves its likely cost under a per-shop lock, with at most two in flight, so concurrent calls
overshoot the cap only by how far a call exceeds its reservation; a call that may have been billed
and failed is charged its reservation. Prompt modules
never import medical readers (`check:assist-prompts`). Leaving: remove the callers and
`src/lib/claude/`; every feature already works dark, and `claude_usage` can be dropped.

## Amendment, 2026-10-22: one diver-facing door and one write without a tap

Review of the twenty-one features (#2923) found two places where the shipped code is wider than
the Context above says. Both stay; this records them so a reviewer finds them here.

**A diver can start one assist.** The card photo on the public register page
(`src/app/s/[shopSlug]/register/card-photo-action.ts`) runs `cert_scan` for an anonymous visitor.
It fills the three boxes the diver would type (agency, level, number), keeps no image and writes
no row; what the diver submits is filed as their own word, never as evidence. Every call spends
the shop's own cap, so it is rate limited twice and both buckets fail closed: 10 an hour per
address (`cardScanByIp`), then 40 a day per shop (`cardScanByShop`), and a photo Haiku says is not
a card never goes on to Sonnet (`scanCard`). Every other assist runs for staff.

**One assist can reach divers without a staff tap.** With the shop's "Recap highlights" switch on
(`shops.recap_assist_auto_approve`, Settings → Features, off by default), the recap send
(`autoFillRecapLine` in `src/db/recap-assist.ts`, called from `src/db/recap.ts`) writes Claude's
line into `trips.recap_shoutout` as if the crew had saved it, and divers read it on the recap.
Turning the switch on is the shop's standing approval. Its guards:

- It fills a blank highlight only. The update is conditioned on `recap_shoutout IS NULL`, so a
  crew's own words are never replaced, even by a race.
- It never runs on a departure with a live incident report: that recap may reach the diver it is
  about, or their family.
- The line is built from the crew's logged sightings, sites and conditions only. Crew notes are
  not sent. Every site, species and count goes in by placeholder, and a line that writes its own
  number, puts a creature at another site, or names a species the crew did not log is refused
  (`recapLine`).
- Any failure is no line. The recap still sends, and the crew can still draft and save one by
  hand on Today.

No other assist publishes, saves or sends to a diver on its own.
