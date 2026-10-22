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
- **Seam**: `src/lib/claude/` holds the provider interface (`ClaudeProvider`, real one over the SDK
  with the base URL pinned, fake in `src/test/fakes.ts`), the dark rules, the price table and
  `callStructured`: stable instructions and shop context first under `cache_control`, the
  per-request content last, the answer constrained by `output_config.format` from a zod schema and
  validated again with it. Refusal, truncation, invalid JSON, low confidence and provider errors
  all return `null`; nothing throws.
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
- **Screen**: one pattern, `AssistDraftButton`: a quiet button that fills a field for editing,
  rendered only when `assistsAvailable` is true.

## Alternatives considered

- **Raw `fetch`** — the SDK carries the types, retries and error classes.
- **One switch per feature** — twenty-one switches nobody reads.
- **A hard platform-wide cutoff at $200** — the guardrail posture is alert-only (ADR
  20260806-provider-usage-guardrails); the per-shop cap bounds each shop.
- **Server-side refusal fallbacks** — a refused suggestion is simply no suggestion; a second model
  is cost without need.

## Consequences

Later layers add a prompt, a schema, a feature code and an action; the gate, ledger and UI are
shared. Shop data now reaches Anthropic, and the switch is on by default, so the key is the gate:
the privacy-policy subprocessor entry and a confirmed retention setting come before
`ANTHROPIC_API_KEY` is set in production (human-task issue #2836 orders them that way). Cost is read
from our own price table, Haiku's long-prompt rate included, so a price change needs `models.ts`
updated. Each call reserves its likely cost under a per-shop lock before it is sent, and a shop has
at most two calls in flight, so concurrent calls overshoot the cap only by how far a call exceeds its
reservation; a call that may have been billed and failed is charged its reservation. Prompt modules
never import medical readers (`check:assist-prompts`). Leaving: remove the callers and
`src/lib/claude/`; every feature already works dark, and `claude_usage` can be dropped.
