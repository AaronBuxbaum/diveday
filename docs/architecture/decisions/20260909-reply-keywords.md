# 20260909-reply-keywords — A reminder can be answered with one letter, and a cancellation still takes two messages

- **Status:** Accepted
- **Date:** 2026-09-09

## Context

[20260907-two-way-inbox](20260907-two-way-inbox.md) gave divers a way back: a reply to any DiveDay
message lands on their record and in one shop inbox, and staff answer from there. What it did not
do is *tell* them. A diver whose plans change reads a reminder, finds no instruction, and phones the
shop — which is the call the inbox was supposed to save.

The owner approved N-21 on 2026-09-09 from the improvement-ideas decision sheet: reminders gain a
line like "Reply C to cancel, M to move", and those replies are handled on the inbound path N-20
already built, confirmed through the self-service cancel that already exists
([20260821-the-diver-may-release-their-own-seat](20260821-the-diver-may-release-their-own-seat.md)).
It is deliberately small: two keywords, and no command language.

The hard part is not the parse. **A `C` is a state change requested by a sender nobody
authenticated beyond an address.** Email's `From:` is written by whoever sent the mail, and the
reply-to address is on every message a shop has ever sent; WhatsApp's number is vouched for by Meta
but is still just a number. N-20 could afford to be relaxed about this because its worst outcome was
a sentence filed on the wrong record, which a staffer reads and dismisses. Cancelling a seat is not
that: it moves money, frees a place on a boat, and nobody looks at it before it happens.

## Decision

**One letter asks; a code sent to the address on file answers.**

1. **`C` never cancels.** The first `C` from an attributed diver answers with the departure named in
   full — title, date, and time in the shop's zone — plus a six-character confirmation code, sent
   back on the channel the message arrived on. Only a reply carrying that code releases the seat. The
   evidence a cancellation requires is therefore *possession of the mailbox or handset*, not the
   ability to send one message that looks like it came from one.
2. **The code is signed, never stored.** The same stateless-signed-token shape as
   [`recap-links.ts`](../../../src/lib/recap-links.ts), with its own HKDF-derived key over
   `AUTH_SECRET` so a code can never be a recap link and vice versa. It is an HMAC over the shop, the
   booking, the person, the channel and the address it was sent to, folded with a 30-minute window
   index; verification accepts the current window and the one before it, so a code lives between 30
   and 60 minutes. Six characters from a 31-character alphabet with `0`/`O`/`1`/`I`/`L` left out,
   because a person retypes it. No table, no prune, no row to leak.
3. **A code only means anything while a cancellation is pending**, and the pending state is a row
   this app wrote: the diver's own recent `C`, on the same channel, from the same address, inside the
   same two windows. A correctly-signed code arriving cold is filed as an ordinary message and acts
   on nothing.
4. **Only an attributed message is read for keywords at all, and the match has to be exact.**
   `inbound_messages.person_id` is written only when the channel vouched for the address *and* it
   matched a live diver inside that shop; a null one is a stranger, and a stranger's `C` is a
   sentence in the inbox. A keyword then asks for **more** than attribution did: the address on the
   diver's record, normalised, must equal the address the message arrived from. `phoneMatches`
   deliberately accepts a stored number typed without its country code when the inbound number ends
   in it — the right trade for filing a sentence a staffer reads, and the wrong one for a state
   change, since a foreign number sharing a diver's last ten digits would inherit their seat. A shop
   that stored a local number loses the shortcut, which is the safe way to lose it.
5. **A keyword is a short reply, and nothing else.** The body is normalised — accents folded,
   punctuation trimmed, whitespace collapsed — and matched against a fixed token list; anything over
   24 characters is prose by definition. "Can I cancel and move to Sunday?" reaches the inbox exactly
   as it did before this change.
6. **The cancellation goes through `selfCancelBooking`**, with `refundBookingOnCancellation`
   afterwards as the independent second step (H-07) — the same two calls `cancelMyBookingAction`
   makes from `/ready`. One policy, one refusal path, one late-departure buffer.
7. **`M` is a handoff, not a reschedule.** 20260821 settled that moving a seat is the shop's,
   because the money has to move with it, and a mnemonic is not a reason to build a rescheduling
   engine. `M` answers that the shop will be in touch and deliberately leaves the message
   **unanswered**, so it stays on the inbox worklist where a person will reach it.
8. **The keywords are fixed; the sentence that teaches them is translated.** `C` and `M` are tokens
   in a protocol, not prose. Reading the accepted letter out of the reader's locale would mean a
   diver whose language changed between the reminder and the reply types the letter they were shown
   and is told it means nothing, and every locale ever added widens what the parser must accept.
   The letters are also the initials in both languages DiveDay ships (cancel/cancelar, move/mover),
   and the whole words are accepted in both as a courtesy.
9. **Which booking, when there are several.** One cancellable seat is the subject. With more than
   one, an emailed reply that threads back to a delivery row (`in_reply_to_delivery_id`, which names
   its booking) picks that seat; with no thread to read — every WhatsApp, and mail from a client that
   dropped the header — the diver is told the shop will sort it and the message stays on the
   worklist. Guessing between two departures is the one mistake this feature must not make.
10. **Two columns, no new table.** `inbound_messages.keyword_intent` (`cancel` / `move` / `confirm`,
    null on everything a person wrote in sentences) is what lets the inbox render a row whose whole
    body is "M". `staff_replies.sent_by_person_id` becomes **nullable**: an automatic reply is a
    reply the shop sent with no staffer behind it, and the record says "Sent automatically" rather
    than naming a colleague who typed nothing. This amends 20260907's decision 1 — that table is now
    what the shop wrote back, by hand or on its behalf — and inherits its retention, erasure and
    merge coverage unchanged.
11. **The offer line appears only where the answer can be heard.** On the reminder email when a
    receiving domain is configured (`EMAIL_INBOUND_DOMAIN`; without one the `Reply-To` is the shop's
    own front desk and the app never sees the reply), and on the WhatsApp courtesy text — never on
    SMS, which has no inbound path (20260907 decision 7). Since `sendCourtesyMessage` decides
    WhatsApp-or-SMS itself, and falls back to SMS after a failed WhatsApp send, both bodies travel
    together as `body` and `whatsAppBody` rather than one being chosen at the call site.
12. **A cap on how much one address is listened to.** Ten messages per hour per address per channel
    per shop; over it the message is filed and nothing is interpreted. It is a brute-force ceiling on
    the six-character code before it is anything else, and it fails safe — a chatty diver loses the
    shortcut, not the inbox.

## What a diver sees

> Blue Mantis: Two-Tank Reef sails tomorrow (Sat 12 Sep, 8:00 AM – 11:30 AM). Please be at the dock
> 30 min early. Reply C to cancel your seat, or M to ask about moving it.

> C

> Two-Tank Reef, Sat 12 Sep at 8:00 AM – 11:30 AM. Reply 4KQ2ZP in the next half hour to give up
> your seat. Nothing has changed yet.

> 4KQ2ZP

> Your seat on Two-Tank Reef, Sat 12 Sep, is cancelled.

## Consequences

- A diver on a reachable channel can release a seat without opening a link, and the shop gets the
  seat back before the boat leaves rather than after.
- The shop inbox now carries rows whose body is one letter, and a fact beside them saying what it
  meant. The `M` rows are ordinary unanswered work; the `C` rows are not.
- `staff_replies` holds sentences no staffer wrote. Nullable `sent_by_person_id` is how they are
  told apart, and the diver's record says so.
- A shop whose divers' phone numbers are stored without a country code gets the reminder line on
  WhatsApp and no keyword handling behind it, which is a worse experience than either extreme. It is
  the conservative half of decision 4 and the price of not letting a suffix collision cancel a seat.
- An outage of the inbound path degrades to what shipped before it: the line goes out, replies land
  in the inbox unanswered, and staff work them by hand.
- Rolling `AUTH_SECRET` invalidates every code in flight. That is at most an hour of them, and the
  diver's next `C` mints a new one.

## Alternatives considered

- **Honour a bare `C` outright.** Rejected: one spoofable message would cancel a stranger's seat.
  The round trip is the whole security argument, and without it the feature is a vandalism tool.
- **A stored one-time token table.** Rejected: it buys single-use and an attempt counter, and costs a
  table with retention, erasure, merge and export obligations for a value that lives thirty minutes.
  The signed code gets expiry from its window, replay-safety from `selfCancelBooking`'s own
  idempotence (the second confirmation finds a cancelled seat), and the attempt ceiling from the
  message cap.
- **A shorter code, or a fixed word like `YES`.** Rejected: a fixed word is not a round trip at all —
  anyone able to send one message can send two. Four characters was tempting for typing and gives up
  a factor of a thousand against guessing for very little.
- **Localise the keyword letters.** Rejected for the reason in decision 8. The whole *words* are
  accepted in both languages, which recovers most of the benefit at none of the cost.
- **Cancel the most imminent seat when a diver holds several.** Rejected: it is right most of the
  time, and the times it is wrong take a diver off a boat they meant to be on. A handoff is a worse
  experience and an honest one.
- **Build a self-service move.** Rejected, again: 20260821 rejected it on the merits and nothing
  about a mnemonic changes them. `M` promises only what the app can keep.
- **Put the offer line on SMS too.** Rejected: SNS cannot receive a text, so the reply would reach
  nobody. The line is a promise, and it goes only where it is true.

## Follow-ups

- Two-way SMS is still `waiting-on-external` (20260907 decision 7). The day it lands, the keyword
  path needs only the channel to start writing `sms` rows — the parse, the code and the copy are
  channel-agnostic already.
