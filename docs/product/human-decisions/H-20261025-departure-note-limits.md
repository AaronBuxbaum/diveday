# H-20261025-departure-note-limits: Who may send a note to everyone on a departure, and how much may it say?

- **Status:** Chosen
- **Human owner:** Product owner

## Current outcome — 2026-11-10

Keep any-staff access, 500 characters and three notes per departure, with the eight-second Undo
and audit trail. Links remain allowed under the 2026-11-06 decision. No new restriction or
expanded sending authority follows from this reconciliation.

Source: [owner-account decision record on #4193](https://github.com/AaronBuxbaum/diveday/issues/4193#issuecomment-6759804545).
The sections below preserve the original question and rationale, not a second unresolved worklist.

## Original question

**A note to everyone on a departure (batch 4, J4) puts a staffer's own words in front of every booked diver, by email or text, from the shop's sender.** That is the widest free-text channel staff have had: the last-minute deal is a template, the blow-out is DiveDay's own words, and a diver message answers one person. Somebody has to say who may send one and how far a note may go, because a login that can message every diver on a boat is also a way to spam them, or to send them a link they will trust because it came from their dive shop.

## What shipped, as the recommended default

- **Any staff member** may send one, from the trip's Details tab. The person at the counter at 6 AM is the one who knows the marina lot is closed.
- **At most 500 characters**, folded onto one line, and **three notes per departure**.
- **Links are allowed** (#4062, approved 2026-11-06 in the defensive-choices audit): "Park here: map link" is the note a marina needs. Protection removed: the box and server no longer refuse a scheme, `www.`, an email address or a bare domain, so a rogue staff login could now put a phishing link in front of every booked diver. What remains: the eight-second Undo, the audit row naming who sent it, the three-note cap and the 500-character cap.
- **Never to a canceled or sailed departure.** Those have their own messages. A multi-day course has sailed once its last day has, so the desk can still reach students between days (#2393).
- **A held send**: eight seconds with Undo, and every check runs again when the hold drains.
- Every note is kept (`departure_notes`, 400 days) with who sent it, how many it went to and how many were delivered, and it writes an activity line.

## Minimum outcome to record

Whether any staff may send, or only owners, managers and captains (the day weather call's set); whether 500 characters and three per departure are right.

## Recommendation

Keep the defaults. Restricting the sender to the day weather call's roles is a one-line gate in `holdDepartureNoteAction` if the shop wants it.

## Unblocks / follow-up

Nothing waits on it: the defaults are live. A change is a gate or a constant (`src/lib/departure-notes.ts`).

Part of the [human decision log](README.md#decision-register).
