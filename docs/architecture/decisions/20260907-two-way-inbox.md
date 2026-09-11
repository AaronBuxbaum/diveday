# 20260907-two-way-inbox — A diver's reply lands on their record, and the shop answers from it

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

Every message DiveDay sends has been one-way. Divers reply anyway: to the booking confirmation
("can I move to the afternoon boat?"), to the WhatsApp reminder ("running ten minutes late"), to the
recap. Until ADR [20260902-sender-standards-for-ses](20260902-sender-standards-for-ses.md) those
replies went to `noreply@ses.dive.day` and nobody; since it, to the shop's confirmed front-desk
mailbox, which the app cannot see and the counter does not open mid-morning. WhatsApp replies
already arrived at `/api/webhooks/whatsapp` and were dropped as "the shop's own inbox to answer".
The owner approved N-20 on 2026-09-07 (improvement-ideas decision sheet): replies on any channel
land on the diver's record and in one shop inbox, Today counts the unanswered, and staff answer
from the record in the diver's channel and language.

Two constraints shape it. Attribution has to be by something the provider vouches for, never by a
name a sender typed. And an inbound path is an unauthenticated surface: the receiving route trusts
the envelope's signature, and nothing in the envelope's *content* may name a tenant, a bucket, or a
URL the app then acts on without checking it against what the stack provisioned.

## Decision

1. **One table for what divers write, one for what the shop writes back.** `inbound_messages`
   holds a message on any channel (`inbound_channel`: `email`, `whatsapp`, and `sms` reserved),
   idempotent on the provider's message id per channel, soft-deleted, with `answered_at` as the
   inbox's one state. `staff_replies` holds the reply and its outcome in the delivery trail's own
   vocabulary. A reply is its own table rather than a `notification_deliveries` row because that
   table is keyed by booking and purpose — one row per booking per kind — and a reply is keyed by
   a person and a message, of which there may be any number.
2. **Attribution by address, inside the shop the message was sent to.** The receiving route
   resolves the tenant first — the reply-to token for email, the WhatsApp Business Account for
   WhatsApp — and only then matches the sender's address to a live person in that shop: an email
   exactly, a phone by its digits. No match leaves `person_id` null and the row reads as an
   unknown sender; nothing is guessed across shops, and a message for a token or a WABA no shop
   holds is dropped rather than filed unscoped. **And the address itself has to be one the
   provider vouched for.** Meta reports the number a WhatsApp message was sent from; email has no
   such guarantee, because the reply-to address is on every message a shop has ever sent and a
   `From:` header is written by whoever sent the mail. So the header address is taken when SES's
   DMARC verdict passed, or when SPF passed and the envelope sender agrees with the header;
   otherwise the row keeps the envelope's own address and `person_id` stays null. A sentence on a
   named diver's record is a sentence a staffer acts on, and no unauthenticated header may put
   one there.
3. **`Reply-To` is a per-shop routable address.** `shops.inbound_email_token` is minted by the
   database, and every email the shop sends carries
   `Reply-To: reply+<token>@inbound.ses.dive.day`. The receiving subdomain sits *under* the
   verified sending identity, so SES receives for it with no second identity or DKIM set — one MX
   record and an active rule set are the whole of the DNS and account work. The confirmed
   front-desk address remains the `Reply-To` only for a deployment that switched inbound mail off
   (`EMAIL_INBOUND_DOMAIN=`), and keeps its proof-of-ownership rule there. This amends
   20260902's first decision; the rest of that record stands.
4. **The inbound mail path is SES receipt rule → S3 → SNS → the app.** The rule stores the raw
   message in a private, unversioned bucket whose objects expire after 30 days and publishes a
   `Received` notification to its own topic; `/api/webhooks/email-inbound` verifies the envelope
   exactly as the delivery webhook does, refuses a bucket other than the one the stack provisioned,
   resolves the token to a shop, and only then reads the object with the SES sender's own
   credentials (one more grant, no fourth key). Text is taken from the `text/plain` part by an
   in-house reader (`src/lib/inbound-email.ts`) — headers unfolded, RFC 2047 words decoded,
   base64 and quoted-printable transfer encodings, the first `text/plain` of any nesting, HTML
   reduced to text when there is nothing else, the quoted history cut, attachments counted and
   never decoded. No parsing dependency: what the shop reads is a diver's reply, and that shape
   fits in a page.
5. **WhatsApp inbound rides the existing webhook.** The `messages` field the delivery parser
   skipped is read beside it; text is kept, media is counted with its caption and never fetched.
   A typed reply goes out as free text through a new `sendText` on the adapter, and is refused
   before sending when the diver's last message is older than Meta's 24-hour window.
6. **A reply is a notification kind.** `staff_reply` carries the staffer's words and the diver's
   own `Message-ID`; the SES adapter sets `In-Reply-To` and `References` from it, so the answer
   lands in the diver's thread. It goes out in the diver's recorded locale, falling back to the
   shop's, and is recorded on `staff_replies` whether it was sent, failed, or could not be sent.
7. **SMS inbound is not built.** SNS cannot receive a text; two-way SMS needs a dedicated number
   through AWS End User Messaging, a carrier registration, and a webhook of its own. The channel
   enum, the table and the surface are channel-agnostic so that lands as a webhook rather than a
   migration; the gap is a `waiting-on-external` issue.
8. **Retention and erasure answer for both tables.** 400 days, the delivery trail's window and for
   the same reason; erasure redacts the diver's words, address and subject and the shop's replies
   to them, by link and by address, and leaves the rows as the record that a conversation
   happened. A merge moves both tables with the diver; the export bundle excludes them for now.
9. **The inbox is owner-and-manager work, and answering happens on the record.** Added
   2026-09-07 with the surface (issue #1429, layer 3). `canAnswerShopInbox` is its own gate rather
   than a reuse of Reports': what a staffer types leaves *as the shop*, over the shop's own sender,
   which is the accountability `canManageMessagingSettings` already puts on connecting that sender
   — and the list holds messages from addresses nobody on the roster holds, arriving with a
   stranger's contact details, which is the argument that put the requests board behind a gate.
   `/shop/<slug>/inbox` is therefore a **worklist and nothing more**: it ranks and it opens
   records, and the composer lives on the diver's record, where the rest of the conversation is
   and where the shop can see who it is talking to. One composer, one place. Widening the gate to
   the daily crew is a decision for a shop that has run the inbox for a season, not for the change
   that built it.

   **Amended 2026-09-10: widened to every live staff role** (issues #1505/#1518, an H-14
   amendment made by the product owner). Reading and answering both open; `canAnswerShopInbox` and
   `canPersonAnswerShopInbox` are deleted rather than relaxed, because "any live staff role" is
   what `requireShopSurface` and `requireDiverActionContext` already assert, and an ungated staff
   surface in this repo carries no predicate. The season of experience the paragraph above waited
   for was not the thing the owner needed: the message that most wants answering at 7am is
   answered by whoever is at the dock, and the insider risk of a staffer typing over the shop's own
   sender is the one a shop manages by choosing who it employs, not by making a captain wait for a
   manager. What remains is the live check — a demoted, disabled or deleted account loses both the
   worklist and the composer on its next request, not at its next sign-in. The rest of this
   decision stands unchanged: the composer still lives only on the diver's record, and
   `/shop/<slug>/inbox` is still a worklist that ranks and opens records. Today's
   `unanswered_messages` row widened with it, because a role that may answer a waiting diver has to
   be told one is waiting.

## Alternatives considered

- **Keep `Reply-To` on the front desk and forward a copy into the app** — rejected: two inboxes
  for one message, and the app's one would always be the one nobody answered.
- **Attribute by the diver's name or the booking in the subject** — rejected: a typed name is
  attacker-controlled and a subject is rewritten by every client; the address is what the provider
  vouched for.
- **Trust the `From:` header outright** — rejected for the same reason, one level down: the header
  is as typed as the name is. SES's DMARC and SPF verdicts are the vouching, and a message with
  neither is a stranger's.
- **A parsing dependency for MIME** — rejected: thousands of lines for attachments and encodings
  the inbox never renders; the `text/plain` part of a reply is a page of code and a test file.
- **SES's SNS action carrying the message inline** — rejected: it caps at 150 KB and drops the
  body past it; the S3 action has no such cliff and leaves a replayable copy for a failed webhook.
- **Record a reply as a `notification_deliveries` row** — rejected for the keying reason in
  decision 1.
- **Build two-way SMS now** — rejected: a phone number, a carrier registration and a Support case
  before the first message; the owner's decision sheet said not to.

## Consequences

Every outbound email changes its `Reply-To`; the runbook's "What every message carries" table
says so. The stack grows a bucket, a topic, a receipt rule set and two manual actions (MX record,
activation), and the credentials secret two keys. The SES sender user reads one bucket. A shop
whose divers reply gets an inbox that fills; the Today row and the record's thread are what empty
it. Escape hatch: `EMAIL_INBOUND_DOMAIN=` puts `Reply-To` back on the confirmed front desk with no
code change; dropping the feature is two tables and a column.
