# H-20261015-structured-shore-contact-for: Does a structured, consented shore contact hear the stale roll-call alert?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Should the shore contact (the person ashore who should hear when a boat is overdue) become a structured recipient of the stale roll-call alert: a name, one channel, a recorded consent (who obtained it and when), editable by staff, with nothing sent without a stored consent and the free-text field left as it is?** Issue #2601 asked because a free-text field cannot be messaged safely and must not be parsed for numbers, and because messaging a named third party from a safety event is a consent and privacy question.

## Decision

**Decided 2026-10-16 (Product owner: Aaron Buxbaum, on issue #2601, taking the recommended option from the ready-for-human decision report): yes.** A structured shore contact, with a recorded consent (who and when), edited by staff. The stale roll-call alert also reaches a contact with a consent, once per trip. Nothing is sent without a stored consent. The free-text `emergencyReference.shoreContact` stays as it is.

## What already satisfies it

The same question was answered a day earlier as part of H-20261014-stale-roll-call-recipients ("Add shore contact", 2026-10-15), and that build is live. Checked against this answer:

- **Structured, with a recorded consent:** `shops.shore_alert_email`, `shore_alert_consent_at` and `shore_alert_consent_by_person_id` (who and when), with a database check that an address cannot be stored without its consent (`shops_shore_alert_consent`). Saving needs the tick; a new or changed address needs it again.
- **Confirmed by its own inbox:** nothing goes to an address until its owner opens the link sent to it (`shore_alert_confirmed_at`), stricter than the answer asks.
- **Staff-editable:** Settings, Emergency reference, with each set, change and clear in the activity log.
- **Once per trip, and never without consent:** `trips.roll_call_shore_alerted_at` is its own claim; `shoreAlertRecipient` (`src/lib/shore-alert-contact.ts`) returns nothing for an address missing either its consent or its confirmation, and the tests cover both, and a rehearsal, a canceled departure and a demo shop (`src/db/roll-call-alerts.test.ts`).
- **The free text stays:** nothing parses it.

## What this answer adds, and what was left out

- **A name beside the address: not built.** The shore alert email addresses no one by name, the consented address is the recipient, and the free-text shore contact already holds the name and number for a person to read. A name column would be new personal data a third party never agreed to share, with its own erasure, export and settings work, and nothing would read it. It is a small addition to the shop row if Aaron wants the name shown in Settings.
- **One channel: email.** H-20261014-stale-roll-call-recipients chose email only. An SMS number for the shore contact is not built: it needs its own consent wording and its own confirmation by the number's owner (a text to a third party's phone is not covered by an email consent), and `courtesy.ts` picks between channels for divers, not for a recipient who agreed to one. Open, for whoever asks.
- **No other change.** The window, the owners, the managers and the email itself are as H-20261014-stale-roll-call-recipients left them.

## Minimum outcome to record

Whether the shore contact becomes a structured, consented recipient, what the consent records, and that nothing is sent without it.

## Unblocks / follow-up

Nothing waits on it. Still open, for whoever asks: a name on the shore contact, and SMS with its own confirmation. See also H-20261014-stale-roll-call-recipients and H-20261016-missing-diver-report-alerts (a filed report of a missing diver, which does not include the shore contact).
