# 20261018-claude-assists — Use the Claude API for staff assists behind one dark-by-default seam

- **Status:** Accepted
- **Date:** 2026-10-18

## Context

Aaron picked twenty-one Claude features. All send shop data to an outside model, so they need one
dependency, one gate, one cost ledger and one rule about what a suggestion may do. Invariants: an
assist clears no gate (readiness, admission, cert, medical, nitrox, boarding), sends nothing to a
diver without a staff tap, and publishes nothing; every feature works identically without it.
Detail: [ai-ml.md](../../product/features/ai-ml.md#claude-assists-in-detail).

## Decision

- **Dependency**: `@anthropic-ai/sdk`. Models by role in `src/lib/claude/models.ts`: `quick` is
  `claude-haiku-5-5`, `draft` is `claude-sonnet-5-5`.
- **Seam**: `src/lib/claude/` holds the provider, the dark rules, the price table and
  `callStructured`: the answer zod-constrained and validated again. Every failure returns `null`;
  nothing throws.
- **Running**: every feature calls `runAssist` (`src/db/assists.ts`). It is **dark** with no
  `ANTHROPIC_API_KEY`, with `DIVEDAY_DISABLE_EXTERNAL_HTTP=1`, when the shop's "AI
  suggestions" switch is off, or past the shop's monthly cap ($15;
  `DIVEDAY_CLAUDE_SHOP_MONTHLY_CAP_USD`); demos $1, all together $10.
- **Ledger**: `claude_usage` records each call's tokens and cost, never a prompt, answer or
  person. The cron's `anthropic_spend` ceiling ($200 a month, alert-only) sums it.
- **Websites**: read by `web_fetch` limited to the exact host the owner pasted, never a shared
  root; DiveDay's servers never fetch it.
- **Screen**: controls in `src/components/assists/`, rendered only when `assistsAvailable`, each
  leaving the page's own save, send or merge as the way through: `AssistDraftButton`,
  `AssistFillButton`, `AssistPhotoButton`, `AssistReadButton`, `CallNoteAssist`,
  `PdfDraftButton`, `TranslateReplyButton` and `TranslationEditor`.

## Alternatives considered

- **Raw `fetch`**: the SDK carries the types, retries and error classes.
- **One switch per feature**: twenty-one switches nobody reads.
- **A hard $200 platform cutoff**: guardrails are alert-only (ADR
  20260806-provider-usage-guardrails); the per-shop cap bounds each shop.

## Consequences

Shop data now reaches Anthropic with the switch on by default, so the key is the gate: the
privacy-policy entry and a confirmed retention setting come before `ANTHROPIC_API_KEY` is set in
production (issue #2836). Prompt modules never import medical readers (`check:assist-prompts`).
Leaving: remove the callers and `src/lib/claude/`; every feature already works dark.

## Amendment, 2026-10-22: one diver-facing door and one write without a tap

Review #2923 found two exceptions to the Context; both stay.

- **A diver can start one assist.** The public register page's card photo
  (`src/app/s/[shopSlug]/register/card-photo-action.ts`) runs `cert_scan` for an anonymous
  visitor. It fills the boxes the diver would type, keeps no image and records no diver. It spends the
  shop's cap, so two limits apply, both failing closed: 10 an hour per address (`cardScanByIp`),
  40 a day per shop (`cardScanByShop`). A photo Haiku says is not a card never reaches Sonnet.
- **The recap line can reach divers without a tap.** With "Recap highlights" on
  (`shops.recap_assist_auto_approve`, on by default from 2026-10-23), the recap send fills
  a blank highlight; turning it on is the shop's standing approval. It never replaces the crew's
  words, never runs with a live incident report, and any failure is no line. Every guard:
  [ai-ml.md](../../product/features/ai-ml.md#recap-highlights-filled-before-send).

No other assist publishes, saves or sends to a diver on its own.
