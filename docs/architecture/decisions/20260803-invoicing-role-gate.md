# 20260803-invoicing-role-gate — Raising an invoice is owner/manager work

- **Status:** Accepted
- **Date:** 2026-08-03

## Context

[20260724-role-authorization](20260724-role-authorization.md) (H-14) drew role boundaries on five
staff surfaces and closed with a rule for everything built afterwards: *a new staff surface must
consciously pick a gate — anything touching money, legal text, roster deletion, or trip definition
picks the matching predicate.*

`/shop/[shopSlug]/orders/new` did not. Its only gates were `requireStaffSession()` and "can this
shop take money", so any staff role — captain, crew, divemaster — could raise an invoice against a
diver on the shop's own connected Stripe account. Its sibling money surfaces had all picked one:
refunds are `canRefund` ("money out is owner/manager work"), discount codes are
`canManagePaymentSettings`, order refunds on the order detail page re-check live roles. Invoicing
was the hole between them. The 2026-08-03 test-system evaluation found it, and `e2e/invoicing.spec.ts`
pinned the permissive behaviour as current with a note saying this is where the decision would
become visible.

A second problem sat underneath: `createOrderAction` was an inline `"use server"` closure inside
`orders/new/page.tsx`, so any gate added to it could only be exercised through the page — which is
precisely the layer a crafted POST skips.

## Decision

Invoicing joins the H-14 owner/manager family.

- `canManageOrders` in `src/lib/authz.ts` (owner, manager — the shared `isOwnerOrManager`), with the
  live DB-checked companion `canPersonManageOrders` in `src/db/authz.ts`. A new predicate rather
  than reusing `canRefund` or `canManagePaymentSettings`: the roles admitted are identical today,
  but the surfaces are not, and a predicate named for the surface it guards is what makes a later
  divergence a one-line change instead of an archaeology exercise.
- Enforced in all three layers, per ADR-0006:
  1. `orders/new/page.tsx` redirects a denied viewer to the Orders index with `?notice=not_authorized`;
  2. `createOrderAction`, now an exported action in a sibling `actions.ts`, re-checks live roles and
     refuses the same way;
  3. `createOrder` (`src/db/orders.ts`) re-runs the check itself against `input.createdByPersonId`,
     answering authorization before it reads anything else and returning a new
     `not_authorized` outcome. An invoice that has left for a real customer is not something a later
     apology recalls — the same reason `anonymizeDiver` keeps a gate inside its own transaction.
     `createdByPersonId` is therefore the *actor*, not a provenance stamp.

**Scope: creating an order, nothing else.** Voiding one (`voidAction` on the order detail) and the
Today queue's one-tap invoice *resend* stay on `requireStaffSession` — a resend only re-mails an
existing open invoice and is exactly the chase-the-payment work the daily queue is for, and voiding
takes a bill *away*. If either is ever gated it should take `canManageOrders` rather than a new
predicate, but neither is gated by this decision.

The landing is the Orders **index** with the reason, not Today. Unlike the four full-page surfaces
of [20260724-role-gated-surfaces-hide-not-explain](20260724-role-gated-surfaces-hide-not-explain.md),
reading orders stays open to every staff role: a captain checking whether a diver has paid is
ordinary deck work. Only raising one is closed, so the refusal lands them on a page they can still
use, with the same explained-landing shape this route's existing "payments aren't connected"
refusal already had.

## Alternatives considered

- **Reuse `canManagePaymentSettings`** (what `promos/actions.ts` does). Rejected: an invoice is not a
  settings change, and folding it in would make the payment-settings predicate mean "anything
  money-adjacent", which is how a gate stops being reviewable.
- **Reuse `canRefund`.** Same roles, opposite direction of money. Reading `canRefund(...)` at the top
  of a *create-invoice* action misdescribes what is being authorized.
- **Open invoicing to instructors** (as `canConfigureTrips` does for course sessions). Rejected for
  now: billing is a books question, not a teaching one, and an instructor who needs a student billed
  has an owner or manager to ask. Widening later is one word in one predicate.
- **Gate the page and action only, leaving `createOrder` open.** Rejected — one caller today, but a
  money write whose only protection is that every caller remembered is a promise, not a control.
- **Hide the "New order" buttons from denied roles** (orders index, diver record, trip roster).
  Deliberately *not* in this change: the entry points now land on an explained refusal, which is
  honest, and hiding them is presentation work spanning three components. Worth doing, but as its own
  change with its own visual review.

## Consequences

- **Behaviour change:** captains, crew, divemasters, and instructors can no longer raise an invoice.
  They keep the Orders index, order detail, and every payment *reading* surface.
- `CreateOrderOutcome` gains a `not_authorized` reason. Callers that surface reasons to staff should
  route it to the same landing the gate uses.
- `createOrder`'s `createdByPersonId` must be a real, active staff member of the shop with the role —
  `src/db/orders.test.ts` fixtures now bill *from* the seeded owner rather than from the diver being
  billed, which is what they did when nothing checked.
- `src/app/shop/[shopSlug]/orders/new/actions.ts` + `actions.authz.test.ts` make the gate testable
  without the page; `e2e/invoicing.spec.ts`'s captain case is now the refusal.
