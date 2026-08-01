# 20260724-resend-webhook-email-events — Ingest Resend webhooks: delivery outcomes and DiveDay's own inbound mail

- **Status:** Superseded by [20260726-hosted-mailboxes-for-platform-mail](20260726-hosted-mailboxes-for-platform-mail.md)
- **Date:** 2026-07-24

> The delivery-outcome half of this decision still stands and is restated in the superseding ADR.
> The inbound half — `inbound_emails`, `platform_mailboxes`, the `/admin` console — was built,
> reviewed, and removed without ever being deployed: attachments and per-person delivery are
> requirements it could not meet, and MX records make it mutually exclusive with the hosted
> mailboxes that can. The code is preserved in history at commit `2a810bf`.

## Context

Two different email gaps sat behind one missing integration.

**Outbound is write-only.** `notification_deliveries` records whether the send *call* to Resend
succeeded (20260718-notification-delivery-status, 20260720-notification-attempt-history). That is
not whether the diver got the email. A hard bounce, a spam complaint, or a suppression-list block
all look identical to a clean send, so a booking confirmation that never arrived shows green on the
staff dashboard — the exact failure a shop most needs to chase, and the one we were blind to.

**Inbound doesn't exist.** DiveDay has no way to receive mail at its own domain. Anyone writing to
`hello@dive.day` — a shop evaluating a switch, a lawyer asking about waiver retention — reaches
nobody, and role addresses can't be split between the people who should answer them.

Resend delivers both over one webhook endpoint, signed with Svix.

## Decision

**One endpoint, `POST /api/webhooks/resend`**, verified before anything is handled. Signature
verification is written by hand against the documented Svix scheme (`svix-id`, `svix-timestamp`,
`svix-signature`; HMAC-SHA256 over `id.timestamp.body`, base64) rather than pulling in the Svix
SDK — the same call already made for Stripe in `src/lib/payments/webhook.ts`, and the reason this
change adds no runtime dependency. It fails closed: a missing secret is 503, a bad or stale
signature is 400, and neither reaches the database.

Anything verified but unhandled answers **200**. Resend retries non-2xx, so erroring on an event
type we don't act on, or a message id we never tracked, would buy an endless redelivery loop.

**Delivery outcomes** land on the existing delivery row, found by Resend's message id.
`notification_deliveries` gains `provider_status` / `provider_status_at` / `provider_detail`,
deliberately *beside* `status` rather than folded into it: "our send call succeeded" and "the
provider says it bounced" are different facts, and a row can hold both. A bounce, complaint, or
provider-side failure joins the staff issue list; a re-send clears the previous message's outcome.
Out-of-order events are dropped by timestamp, since webhook delivery is at-least-once and unordered.
Open and click tracking are deliberately not recorded — they are the privacy-invasive half of email
analytics and answer no question a dive shop has.

**Inbound mail is platform mail, not tenant mail.** `platform_mailboxes` names each role address
and `platform_mailbox_members` says who may read it; `inbound_emails` stores received messages,
routed by the address they were sent to. None of these three carries a `shop_id`, which is the
whole point: someone emailing `hello@dive.day` is not any shop's customer, and inferring an
association from a `From` header anyone can forge would be inventing one. They are reachable only
from `/admin/**`.

Access has two tiers. **Operators** come from a `PLATFORM_ADMIN_EMAILS` deploy-time allowlist and
see everything, including mail to an address no mailbox claims; they alone manage addresses.
**Members** see exactly the mailboxes they belong to.

Both tiers resolve an email to a person through `user_accounts` — the credential a session was
actually minted from — never through `people.email`. That distinction is the whole security of the
allowlist: a person's roster email is ordinary profile data that any staff member can rewrite
through the diver editor, including on their own row, so keying a global capability on it would let
any shop owner type an allowlisted address into their own profile and be an operator on the next
request. `user_accounts.email` is globally unique and set only when an account is minted, which also
means an operator granting a mailbox can't be misdirected to a roster row some tenant squatted.
Self-signup refuses an allowlisted address for the same reason: sign-up takes an email on the
caller's word, so an allowlisted address with no account yet would otherwise be claimable. Neither is a `person_role` — every role in
this app is shop-scoped, and a global "sees everything" bit that shop staff could grant each other
is not something the role table should be able to express. A staff member with no platform access
gets **404**, not 403: a dive-shop employee has no business learning the console exists.

**Only the plain-text part of a received message is stored.** The HTML is discarded at ingest, so
there is no path by which an inbound body becomes markup on the admin screen — no sanitizer to keep
correct, no XSS surface. Bodies are truncated at 20k characters and attachments are recorded as a
flag, not stored. The body arrives via a second authenticated call (`GET
/emails/receiving/{id}`), because `email.received` carries metadata only; that fetch is best-effort,
and a message whose body never comes back is still filed rather than lost.

## Alternatives considered

- **The Svix SDK for verification** — a runtime dependency and an ADR for ~40 lines of documented
  HMAC we already had a working precedent for.
- **Folding provider outcomes into `notification_delivery_status`** — conflates two questions. A
  message can be both "sent successfully" and "bounced", and the pair is what staff need to read.
- **Forwarding inbound mail to a Gmail account instead of storing it** — simpler, and genuinely
  tempting, but leaves no record, no "who's handling this", and no way to split role addresses
  between people.
- **Routing replies to a shop's own inbox, keyed to a booking by a plus-addressed capability
  token** — built first, then removed. It answers a different question (diver↔shop conversation)
  than the one asked (mail to DiveDay). Worth revisiting on its own merits; it is not this.
- **A `platform_admin` person role** — puts a global capability in a shop-scoped table that shop
  owners already administer.

## Consequences

A bounced or complained-about email now shows up as a shop's problem to chase instead of looking
delivered. DiveDay can receive mail at its own domain, split role addresses between people, and
track what has been dealt with.

The cost: two access models now exist in the app — shop roles and platform access — and `/admin`
is a second surface family with its own gate, which every future page under it must call for
itself (a layout is not a security boundary in the App Router). `inbound_emails` stores
attacker-controlled text, bounded but not otherwise trusted. Mail to an address no mailbox claims
accumulates until an operator handles it.

**Sending from these addresses is deliberately not built.** Receiving is the half that was
load-bearing; replying happens in the operator's own mail client for now, which means those replies
are not recorded here. See `docs/product/features/roadmap.md`.
