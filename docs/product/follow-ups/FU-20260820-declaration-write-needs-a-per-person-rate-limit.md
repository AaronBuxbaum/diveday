# FU-20260820-declaration-write-needs-a-per-person-rate-limit — The one public write that names a victim has only the wide net

- **Status:** Open
- **Raised:** 2026-08-20 — the `security-reviewer` pass on ADR 20260820-attested-at-booking-verified-at-boarding
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/lib/rate-limit.ts`, `src/app/s/[shopSlug]/trips/[id]/actions.ts`

## What I noticed

A completed public booking now writes a self-declared certification onto the named person's record.
That write is protected by `RATE_LIMITS.booking` — `perHour(10)` keyed **by IP**.

Every other endpoint in this repo that can write to *a named person's* record carries a second bucket
keyed to that person. `waiverLinkResendByBooking` makes the argument verbatim: on its own an IP net
"would let anyone holding a leaked stale URL spray that diver's inbox from a rotating set of
addresses." The declaration write is now the same shape and has only the wide net — and the default
store is in-process per instance unless Upstash is provisioned, and fails open on a store error, so
the effective ceiling across a serverless fleet is well above ten an hour.

What bounds the severity today is that each write costs a real booking row on a real departure, which
staff see. That bound is softer than it looks: "completed booking" means a booking *row*, not a paid
seat, so on a pay-at-booking trip the attacker's cost is one abandoned Stripe checkout.

## Why it isn't already done

It is defence in depth on a path whose *primary* defence — the anti-displacement rule — was widened
in the same change to cover all three card tables, so a diver the shop holds any real evidence for
cannot be written to at all. The remaining population is divers the shop knows nothing about, where
the write is closer to spam than to tampering. That makes this worth doing and not worth rushing
into a safety-critical change under review.

## Proposed change

A second bucket keyed to the declaration's target — `rateLimitKey("declaration", shopId, leadEmail)`
— checked in the public booking action beside the existing IP net, or around `persistDeclaration`'s
target. Mirror `waiverLinkResendByBooking`'s shape and its comment, since the reasoning is identical.

Do **not** raise or narrow `RATE_LIMITS.booking` itself: it protects seat inventory, which is a
different thing from a person's record, and conflating them would make one of the two wrong.

## Prompt

```text
Read src/lib/rate-limit.ts's `waiverLinkResendByBooking` entry and the comment above it — it is the
pattern and the argument.

Add a per-person bucket for the self-declaration write on the public booking path
(src/app/s/[shopSlug]/trips/[id]/actions.ts), keyed to the shop and the lead booker's email, beside
the existing per-IP RATE_LIMITS.booking net. Leave RATE_LIMITS.booking alone — it guards seat
inventory, not a person's record.

Add a test that the second bucket refuses a repeated declaration against the same email from a fresh
IP, and confirm a legitimate second booking by the same diver on a different trip is unaffected.

Delete docs/product/follow-ups/FU-20260820-declaration-write-needs-a-per-person-rate-limit.md in the
same commit.
```
