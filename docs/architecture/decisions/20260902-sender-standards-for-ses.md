# 20260902-sender-standards-for-ses — Every email meets the standards SES's production review reads for

- **Status:** Accepted
- **Date:** 2026-09-02

## Context

AWS refused DiveDay's first SES production-access request with its standard no-reason "final
decision" wording. The review is a human reading a use case against a fixed list — how addresses are
obtained, what happens on a bounce or a complaint, how a recipient opts out, whether the mail is
authenticated and monitored — and the app already did most of it (one-click unsubscribe, the
bounce/complaint webhook, account-level suppression, DKIM and a custom MAIL FROM,
[20260803-ses-sole-email-provider](20260803-ses-sole-email-provider.md)). Four things it did not do,
each of which a receiving mailbox or a regulator also expects of a legitimate sender:

- Every message left as `DiveDay <noreply@ses.dive.day>` with no `Reply-To`, while greeting as the
  shop. A diver who hit reply on a booking confirmation wrote to a dead letter box.
- The commercial kinds — the ones carrying an `unsubscribeUrl` — named no postal address, which
  CAN-SPAM (16 CFR 316.2) requires of the sender of a commercial message.
- A spam complaint reached SES's suppression list and the shop's dashboard, and nothing else: the
  person's record still offered them courtesy mail, and a later change of address on that record
  would have resumed it. The courtesy kinds also record no provider message id, so a complaint on
  one could not even be traced to a shop.
- Nobody was alarmed on the two numbers SES's enforcement actually reads, the account bounce and
  complaint rates, until AWS itself paused sending.

## Decision

- **A notification carries an optional `sender` profile** — `replyTo` and a one-line
  `postalAddress` — resolved from the shop row (`shops.contact_email`, `shops.address_*`) at the one
  place every shop-scoped send passes through (`src/db/notifications.ts`), never by the twenty
  composers. The SES adapter sets `Reply-To` from it; `render.ts` closes every commercial message
  with the shop's name and address. A shop with neither on file sends exactly as before: nothing is
  guessed, and there is no blank line.
- **Every send is tagged** with its shop and kind (`diveday_shop`, `diveday_kind` — SES `EmailTags`),
  which SES echoes on every event. That is what lets a complaint be filed by *address within a shop*
  rather than by a message id the courtesy kinds never stored.
- **A complaint is an unsubscribe.** The webhook opts the complained-about address out of courtesy
  mail (`people.courtesyEmailOptOutAt`) and off every live last-minute-list entry in that shop.
  Transactional mail is untouched, the same line `courtesyEmailOptOutAt` has always drawn. A bounce
  opts nobody out — SES's suppression list already refuses the next send and the dashboard already
  shows the staffer the record to fix.
- **Two CloudWatch alarms on `AWS/SES` `Reputation.BounceRate` and `Reputation.ComplaintRate`**, at
  AWS's own review thresholds (5%, 0.1%), on the existing observability topic. Alarms only: AWS
  publishes the metric.
- The production-access request is re-made with a case text that names every one of these
  mechanisms by file and behaviour (`docs/engineering/ses-email-runbook.md`, "Production access: the
  second request"), and the manual-action registry says so.

## Alternatives considered

- **Thread `replyTo`/`postalAddress` through every kind's schema and composer** — rejected: twenty
  call sites, and the one that forgot would ship a dead-letter sender silently. The send path is the
  choke point; the composer is not.
- **Send from the shop's own domain** — rejected for now: it needs per-shop DKIM verification and
  DNS a shop has to edit, and the review team's question is answered by `Reply-To` and alignment on
  `dive.day`. Worth revisiting when a shop asks for it.
- **Record a provider message id for the courtesy kinds so a complaint resolves by id** — rejected:
  a new tracking table per kind for a lookup the message tag already answers, and the tag also
  covers mail sent by a path that recorded nothing.
- **Opt a hard bounce out the same way as a complaint** — rejected: a bounce is a bad address, not a
  refusal, and the fix is a staffer correcting the record; suppressing courtesy mail on the record
  would hide the very thing they need to see.
- **Alarm earlier than AWS's review line** — deliberately not: on pilot volume one complaint in a
  thousand sends is already 0.1%, and a lower line would fire on noise nobody can act on.

## Consequences

`Reply-To` reaches the shop's front desk for every shop that filled in `contact_email`; the settings
form is the only place that address comes from. A commercial email grows one footer line for a shop
with an address on file. A complaint now writes to `people` and `last_minute_list_entries` from the
webhook, so `optOutAddressAfterComplaint` is scoped by the shop the tag names and blind to deleted
records. `observability.ts`'s cost arithmetic gains two alarms ($0.20/month). Supersedes nothing;
extends [20260814-checkout-recovery-is-commercial](20260814-checkout-recovery-is-commercial.md)'s
rule that a commercial send carries a way out with the rule that it also carries a sender.
