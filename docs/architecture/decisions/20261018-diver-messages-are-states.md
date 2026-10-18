# 20261018-diver-messages-are-states — Every diver reminder is a state, one sentence and the link

- **Status:** Accepted
- **Date:** 2026-10-18

## Context

The 24-hour reminder carried the forecast, what to bring, who to text and a first-timer note, the
recap carried fly-safe advice, and the thread page the link opens already shows each of them.
Two surfaces said the same thing and could drift. The roadmap also held the second booking-time
email as an owner call. Aaron decided on 2026-10-17 (issue #2660, option 2): one shape.

## Decision

A reminder email is a subject that names the state, one sentence, the one link and the shop's
name as its line. The states are notification kinds: `trip_reminder_7d` is `week_out`,
`trip_reminder_24h` is `tonight`, `trip_recap` is `home`, and `booking_confirmation` is `booked`.
One renderer (`src/lib/notifications/diver-state-email.ts`) and one bundle namespace
(`notifications.tripReminder`, `notifications.tripRecap`) serve all three reminders.

- The 7-day and 24-hour cadences, the recap's four-hour floor and the per-(booking, kind) dedup
  rows are unchanged, so `notification_kind` gains no value and nothing migrates.
- The payload shrinks to what the sentence and link are made of: a count of what the diver still
  has to finish (`open`), the departure's start, the course flag and the reply-line flag. The
  recap's sentence is the fly-safe sentence when one exists, the same words the after-state page
  uses, so the safety fact is never dropped and never worded twice.
- The night-before sentence names the dock time, the departure minus the shop's dock call
  (`dockCallMinutes`, the glossary's dock call time), and says "today" or "tomorrow" by the
  calendar day in the shop's zone, so a send held to the morning of the trip never says "tomorrow".
  A course session keeps its start and names no dock. A medical answer waiting on a doctor has its
  own sentence in place of the count (`medicalReview`).
- The text channels keep their own bodies. The night-before brief is now only the text.
- Booking sends one message. The waiver link already rides in the confirmation, so there is no
  second booking-time email; the confirmation keeps its terms, materials and waiver link.

## Alternatives considered

- **A middle shape that keeps who to text** — Aaron chose the full shape.
- **Shrinking the booking confirmation too** — it carries the waiver link, a course's materials
  and the terms the diver agreed to, which have no earlier home than that email.

## Consequences

- A diver who reads only the email loses the forecast and packing list unless they tap the link,
  and the link needs a data connection at the dock. The text channel still carries the brief.
- One template replaces three per-kind copies, and the thread is the only surface that can go stale.
- Revisit if no-shows rise after the change; the cost of restoring a line is one bundle key.
