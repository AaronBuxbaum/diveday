# 20260827-shop-authorized-provider-connectors — DiveDay may call a provider's API when a shop authorizes it, on private apps only

- **Status:** Accepted
- **Date:** 2026-08-27

**Supersedes [20260815-outbound-integration-webhooks-and-zapier](20260815-outbound-integration-webhooks-and-zapier.md)**,
whose one-directional constraint the shipped code contradicts.

## Context

On 2026-08-25 a Shopify connector and a QuickBooks Online connector merged: OAuth against
`*.myshopify.com` and Intuit, an Admin API catalog push, and idempotent SalesReceipt/RefundReceipt
writes into a shop's company file. Both **read and write another system's API**.

The governing record said DiveDay never does that. 20260815's decision was one-directional by
design — "No DiveDay-built Shopify app, no DiveShop360 connector", recorded as confirmed with the
product owner — and it was still marked **Proposed**, so on paper nothing had been decided at all
while three adapters shipped underneath it. [`vision.md`](../../product/vision.md#non-goals-for-now)
and [`roadmap.md`](../../product/features/roadmap.md) both still said the same thing. That
contradiction is worse than either answer, because the next agent to read the ADR would believe it
(issue #1017).

**How this was settled.** Issue #1017 asked the product owner to choose: accept the connectors, or
plan their removal. The instruction that came back was to build #1015 (disconnect destroys the
outbox and the idempotency map) and #1016 (event payloads hold diver PII with no erasure arm) —
two issues that exist only *because* the connectors exist, and that removal would close for free.
Paying to fix them is the decision to keep them, so this record states it plainly rather than
leaving the tree contradicting itself for a second week.

Constraints a lower-context agent must not miss:

- **The reason 20260815 said "never" was a competitor argument, and it does not reach these two.**
  Its worked example was a DiveShop360 connector — a direct competitor with no reason to build the
  receiving end, the same dead end as PADI/SSI's absent C-card API (H-10). Shopify and Intuit are
  not competitors, they already publish stable public APIs, and the receiving end exists whether or
  not DiveDay writes anything.
- **H-26 is the live constraint, and it bounds the *commitment*, not the direction.** DiveDay is a
  founder-run lifestyle business ([`vision.md`](../../product/vision.md#what-kind-of-business-this-is));
  what it cannot carry is "an ongoing platform-review or support-queue commitment", named in
  20260815 as a public Zapier listing or a Shopify App Store submission. A private app a shop
  authorizes carries API-version maintenance but no review relationship and no support queue.
- **A connector is not a POS.** `vision.md`'s retail/repair non-goal is untouched: DiveDay still
  never sells or repairs items, and a shop's own POS stays authoritative. Pushing a rental price
  list out to Shopify and a receipt out to QuickBooks is the *export* the non-goal already
  contemplates, taking the shape the target system reads instead of a CSV a human re-keys.
- **Direction is not the safety property. Authorization and blast radius are.** Every call is made
  under credentials a shop granted for its own account, sealed with `SECRET_ENCRYPTION_KEY`, and
  the outbound scopes are narrow (`write_products`; `com.intuit.quickbooks.accounting`). Nothing
  DiveDay reads back from a provider is authoritative for anything in DiveDay.

## Decision

**DiveDay may call a third-party provider's API on a shop's behalf, when that shop has authorized
it, for a provider on the register in `src/features/integrations/registry.ts` — and only through a
private app that is never submitted to a public directory.**

- **Private apps only.** No Shopify App Store submission, no public Zapier App Directory listing,
  no Intuit marketplace listing beyond what production credentials strictly require. A shop
  connects a DiveDay deployment's own registered app; the app is not offered to anyone who is not
  already a DiveDay customer. This is the H-26 line, restated as the rule it always was: the ban is
  on the review-and-support relationship, not on the outbound call.
- **Outbound writes are one-way and non-authoritative.** A connector may push DiveDay's own facts
  into a shop's other system and read back only what it needs to make that push idempotent (an
  existing customer id, a product id). No provider's data is ever read *into* DiveDay as truth —
  no inventory sync back, no order import, no cert lookup. `integration_sync_records` is a mapping
  table, not a cache of a provider's state.
- **A provider must be reachable without one.** Every integration stays optional and off by
  default; absent credentials, no UI element fires and no cost is paid. The Zapier adapter — a
  shop pasting its own `hooks.zapier.com` URL — remains the no-code path for everything not on the
  register, exactly as 20260815 intended.
- **20260815's transport decisions survive intact** and are not re-litigated here: at-least-once
  delivery with an idempotency key, exponential backoff, an attempt ceiling, a staff-visible
  delivery log, and one-time SHA-256-digested OAuth state bound to both the shop and the person who
  started it. What changes is only whether an adapter may be the caller.
- **The maintenance this takes on, stated rather than discovered:** two OAuth client registrations
  to keep alive, two API deprecation cycles to follow (Shopify's dated Admin API versions —
  `SHOPIFY_API_VERSION`, pinned at `2026-07` — and Intuit's), a QuickBooks production app that
  requires Intuit's own app review to leave sandbox, and refresh-token rotation on the Intuit side.
  Adding a third provider is a new ADR, not a new file: the point of the register is that the cost
  is visible each time.

`vision.md`'s non-goal and `roadmap.md` §1 are amended in the same change to say this instead of
the opposite.

## Alternatives considered

- **Remove the Shopify and QuickBooks adapters, keep only Zapier** — the honest reading of
  20260815, and cheapest now. Rejected: a no-code bridge cannot write an idempotent SalesReceipt
  keyed to a DiveDay order, so the accounting integration a shop actually asked for degrades to a
  row in a spreadsheet. Two open issues (#1015, #1016) exist *because* the connectors exist and
  would close with them; that they are worth fixing is the same judgment as keeping the adapters.
- **Keep them behind an off-by-default flag and decide later** — rejected as the status quo with a
  flag on it. They are already off by default (absent client credentials, nothing renders); a flag
  would add a switch without settling what the tree says.
- **Publicly list the Shopify app so any shop can self-install** — rejected on H-26: a store
  listing is the review-and-support commitment a one-person company cannot durably hold, and it
  buys nothing while every DiveDay shop is hand-recruited.
- **Amend 20260815 in place** — rejected on the ADR skill's own rule: a superseded record keeps its
  content so the reasoning that was true in August stays readable.
- **Two-way sync (read a provider's inventory or orders into DiveDay)** — rejected, and this is
  the line the non-goal is really about. It would make a second system authoritative for DiveDay
  state and put reconciliation on the founder's desk.

## Consequences

- **Easy:** the shape a shop expects — a receipt appears in QuickBooks, a rental price list appears
  in Shopify — with no CSV round trip and no double entry; the register makes the fourth provider a
  known amount of work.
- **Hard / new:** DiveDay now has outbound API dependencies it does not control. A provider's
  breaking change is a support incident on someone else's schedule, and the QuickBooks production
  app puts one review relationship on the books despite the private-app rule (Intuit requires it to
  leave sandbox) — accepted knowingly, and the ceiling.
- **Commits us to:** keeping every connector optional and non-authoritative; treating a new
  provider as an ADR; never listing publicly. If a listing ever becomes worth it, this record is
  what must be superseded — that is the trigger, not a judgment call in a PR.
- **Escape hatch:** the adapters are leaf modules behind one register. Deleting a provider is
  removing its file, its registry entry, its env keys and its rows; nothing in admission,
  readiness, the manifest spine, or payments depends on any of them. A shop that loses a connector
  loses a convenience and keeps every fact, because DiveDay never made the provider authoritative
  for anything.
- **Not in the stack table** in [`overview.md`](../overview.md) beyond what is already recorded, on
  the same precedent 20260815 cites: an integration a deployment may not configure at all is not
  part of the stack every deployment runs.
