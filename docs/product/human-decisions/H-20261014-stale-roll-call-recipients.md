# H-20261014-stale-roll-call-recipients: Who hears when an after-dive roll call is left open?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**When an after-dive roll call is still open after the boat was due back (batch 6, item 6; the hourly pass at `:06` alerts 30 to 90 minutes past the end for a count someone started and left open, and 60 to 120 minutes past it for one nobody started), DiveDay tells someone ashore.** The brief asked for the owner and the shop's shore/emergency contact. The shore contact on the emergency reference (`emergencyReference.shoreContact`) is free text — a name and a number written for a person to read in an emergency — with no address DiveDay can send to and no consent to receive messages, so nothing is sent to it.

## What shipped first, as the recommended default

- **Every active owner gets one email** naming the departure, the dive and two counts summed across the diver and crew rows ("N recorded not back aboard; M more have no result yet"), with a link to that roll call.
- **Every device following the departure's manifest gets one push**, in its owner's language.
- **Once per departure** (`trips.roll_call_alerted_at`); the Today row says when the owners were alerted. A pass that reaches nobody releases the claim and tries again next hour.
- It rides the hourly crew-notices pass at `:06`, so it arrives 60 to 120 minutes after the end for a count nobody started (the roll-call gap's own one-hour return buffer), and 30 to 90 minutes after for one started and left open.
- Never for a rehearsal, a canceled departure or a demo shop.

## Decision

**Decided 2026-10-15 (Product owner: Aaron Buxbaum, in the project thread): "Add shore contact".** The shore contact becomes a structured, consented recipient of the stale roll-call alert. Where the answer said nothing, the build took these defaults; each is a one-line change if Aaron wants another:

- **Channel: email only**, the channel the owner alert already uses. No SMS.
- **Managers: unchanged.** Owners only, plus the shore contact.
- **Window: unchanged.** 30 minutes, `STALE_ROLL_CALL_AFTER_MS`.
- **Consent: recorded by the shop.** The staff member who saves the address ticks that the shore contact agreed to receive these alerts; the shop row keeps when and who (`shops.shore_alert_consent_at`, `shore_alert_consent_by_person_id`). A new or changed address needs the box ticked again, and a tick drawn for one address never carries to another (the form posts the address it was drawn for; a different typed address is refused as `consent_missing`); the same address saved again keeps its first consent and confirmation; an empty address clears them all. Settings shows "Recorded {when} by {name}", and each set, change and clear is a line in the activity log. An address without a consent cannot be stored (`shops_shore_alert_consent`) and is never sent to.
- **The free-text `emergencyReference.shoreContact` stays as it is**, for a person to read in an emergency. The address lives beside it on the same settings page (Settings → Emergency reference).
- **Confirmed by its own inbox** (the review's addition, the #1288 pattern): saving an address with the tick sends a confirmation link to it, and nothing else goes there until it is opened (`shops.shore_alert_confirmed_at`, `shop_shore_alert_tokens`). Settings shows "confirmed" or "waiting for confirmation", with a control to send the link again. A demo shop sends nothing, the link included, and says so; the demo reset clears the address.
- **What the shore contact gets:** one email per departure, in the shop's default language, from the shop ("Blue Mantis via DiveDay"). It names the shop, the departure, the dive, the two counts and when the boat was due back; gives the shop's phone when one is on file (`shops.contact_phone`) with one action line, to call the shop first; says when it was sent, that it is the only message for this departure and that DiveDay sends no all-clear (ask the shop); and carries one link, the one that stops these alerts (also the `List-Unsubscribe` header), which takes the address off the shop. A stop link works once; using it writes a "safety" line in the shop's activity log with no actor and emails each owner. The due-back time carries its date when the alert goes on a later day than the boat was due. Today's row says "Owners and shore contact alerted" once the shore copy went. No diver or crew names, no staff sign-in (`roll_call_stale_shore`). If the address is also an owner's, that owner gets one copy, the owners'.
- **The claims:** the shore send has its own (`trips.roll_call_shore_alerted_at`). A shore send that failed is tried again next pass; a pass that reaches only the shore contact never marks the owners alerted.
- **Erasure:** forgetting a diver whose address is the shop's shore address clears it, with its links.
- **Never** for a rehearsal, a canceled departure or a demo shop (unchanged).
- **Not exported** in the shop's data bundle: a consent given to this installation is recorded again after a restore.

## Minimum outcome to record

Whether the shore contact should become a structured, consented recipient (a phone number or address with an opt-in), and if so by text, email or both; whether managers should hear as well as owners; whether 30 minutes is right.

## Recommendation (2026-10-14)

Keep owners only until a shop asks. A structured shore contact is a settings field, a consent line and one more recipient in `sendStaleRollCallAlerts` (`src/db/roll-call-alerts.ts`).

## Unblocks / follow-up

Nothing waits on it: the owner alert and the shore contact's are live. Still open, for whoever asks: SMS to the shore contact, and managers as recipients. H-20261014-physician-form-for-referral recorded the shore contact's structured, consented form again on 2026-10-16. The window is `STALE_ROLL_CALL_AFTER_MS` in `src/lib/roll-call-alerts.ts`.
