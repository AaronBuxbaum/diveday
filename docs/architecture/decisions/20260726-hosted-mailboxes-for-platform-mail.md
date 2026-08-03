# 20260726-hosted-mailboxes-for-platform-mail — Buy mailboxes for DiveDay's own mail; keep the webhook for delivery outcomes

- **Status:** Accepted
- **Date:** 2026-07-26
- **Supersedes:** [20260724-resend-webhook-email-events](20260724-resend-webhook-email-events.md)

> **Amended 2026-08-03:** the hosted-mailbox decision below is unaffected. The webhook it refers to
> is now SES's (`/api/webhooks/ses`), not Resend's — see
> [20260803-ses-sole-email-provider](20260803-ses-sole-email-provider.md).

## Context

The superseded decision solved two problems with one Resend webhook: delivery outcomes for mail
DiveDay sends, and receiving mail at DiveDay's own role addresses into an in-app `/admin` console.
The first half was right. The second was solving the wrong problem, and the requirements that
settled it arrived only after it was built:

- **Attachments are needed.** The stored-message model flagged attachments and dropped their
  content, because storing arbitrary uploads from anonymous senders is a real liability and Resend
  keeps the originals anyway. A lawyer emailing a marked-up contract is exactly the case that
  matters, and "open it in the Resend dashboard" is not an answer.
- **The interface is not wanted.** `/admin/inbox` reimplemented triage — read state, who's handling
  it — that every mail client already does better, and it could never do the rest: threading,
  search, replying, filing, mobile.
- **Mail must reach a specific person.** `aaron@dive.day` should land in Aaron's mailbox and
  `legal@dive.day` in the lawyer's, in whatever client each of them already uses. Per-mailbox
  membership inside DiveDay routed *reading rights*, not the mail itself.

There is no requirement beyond those plus ordinary domain authentication.

## Decision

**Buy mailbox hosting for DiveDay's own addresses; don't build it.** `aaron@` is a real hosted
mailbox and `legal@` a group or alias forwarding to the lawyer's own address. This is a solved
commodity that delivers attachments, threading, search, mobile clients, and the ability to *reply* —
none of which the in-app inbox had or was going to get cheaply.

The decisive technical fact is that **MX records name exactly one mail host.** Inbound-to-webhook
and hosted mailboxes are mutually exclusive for the same domain, not complementary. Pointing MX at a
mail host is therefore not an addition to the previous design; it deletes it.

**The webhook stays, for delivery outcomes only.** `email.sent`/`delivered`/`bounced`/`complained`/
`failed`/`suppressed` still land on `notification_deliveries` via `provider_status`, which is what
turns a booking confirmation that silently bounced into a shop's problem to chase. That half is
about mail DiveDay *sends* to divers, is unrelated to DiveDay's own role addresses, and is unaffected
by where MX points. `email.received` now parses to `ignored`, so an endpoint left subscribed to it
answers 200 rather than looping on retries.

**Transactional mail moves to a subdomain** (`send.dive.day`). Two independent senders now sign for
the org domain — the mail host for human correspondence, Resend for automated mail — and separating
them keeps a deliverability problem with bulk automated mail from damaging the reputation of the
domain people actually correspond on. DMARC on the org domain covers both; it is published at
`p=none` with `rua=` reporting until both senders show aligned, then tightened.

## Consequences

Removed: `inbound_emails`, `platform_mailboxes`, `platform_mailbox_members`, the `/admin` console,
`requirePlatformSession`, and the `PLATFORM_ADMIN_EMAILS` allowlist. The second access model the
superseded ADR introduced is gone with them, so shop roles are once again the only authorization
model in the app — a real simplification, and the reason `/admin` needing its own gate on every
future page is no longer a standing cost.

DiveDay's own correspondence is no longer visible to the application: there is no record in the
database of who wrote in or what was said, and no "who's handling this" state. That was the
superseded ADR's stated reason for storing rather than forwarding, and it is knowingly given up. If
a shared-triage need reappears — several people working one queue, with assignment — the answer is a
shared mailbox or a help desk, not rebuilding this.

Mail forwarded to an external address (the lawyer) fails SPF alignment at the destination, since the
forwarding hop rewrites the envelope sender. A group with an external member handles this better
than a raw forwarding rule, and ARC signing mitigates it, but occasional rejection by a strict
receiver is the standing cost of forwarding off-domain.

The security work on the superseded design — the seeded-membership hole, the allowlist keyed on a
tenant-writable `people.email` — is moot, since the code it hardened is deleted. It is preserved in
history at commit `2a810bf` should the inbound approach ever be revisited.

## Alternatives considered

- **Keep the console and add attachment storage** — the liability of storing anonymous uploads, plus
  building threading, search, and reply to reach parity with a client the operator already has open.
- **Forward from the Resend webhook to a personal Gmail** — keeps MX on Resend and would work, but
  it is a re-send rather than a delivery: attachments still aren't carried, the From header must be
  rewritten to survive DMARC, and replies go nowhere useful. All the fragility of a mail server with
  none of the features.
- **Cloudflare Email Routing instead of hosted mailboxes** — free and forwards attachments intact,
  but receive-only: sending as the address still needs an SMTP relay bolted onto another client, and
  there's no shared access to `legal@`. Reasonable if the budget is zero; more moving parts.
