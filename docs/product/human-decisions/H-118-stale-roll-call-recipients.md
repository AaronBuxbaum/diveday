# H-118: Who hears when an after-dive roll call is left open?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**When an after-dive roll call is still open after the boat was due back (batch 6, item 6; the hourly pass asks from 30 minutes past the end, and a count nobody started opens an hour past it), DiveDay tells someone ashore.** The brief asked for the owner and the shop's shore/emergency contact. The shore contact on the emergency reference (`emergencyReference.shoreContact`) is free text — a name and a number written for a person to read in an emergency — with no address DiveDay can send to and no consent to receive messages, so nothing is sent to it.

## What shipped first, as the recommended default

- **Every active owner gets one email** naming the departure, the dive and how many people have no result, with a link to that roll call.
- **Every device following the departure's manifest gets one push**, in its owner's language.
- **Once per departure** (`trips.roll_call_alerted_at`); the Today row says when the owners were alerted. A pass that reaches nobody releases the claim and tries again next hour.
- It rides the hourly crew-notices pass, so it arrives between 60 and 96 minutes after the end for a count nobody started (the roll-call gap's own one-hour return buffer), and 30 to 90 minutes after for one started and left open.
- Never for a rehearsal, a canceled departure or a demo shop.

## Decision

**Decided 2026-10-15 (Product owner: Aaron Buxbaum, in the project thread): "Add shore contact".** The shore contact becomes a structured, consented recipient of the stale roll-call alert. Where the answer said nothing, the build took these defaults; each is a one-line change if Aaron wants another:

- **Channel: email only**, the channel the owner alert already uses. No SMS.
- **Managers: unchanged.** Owners only, plus the shore contact.
- **Window: unchanged.** 30 minutes, `STALE_ROLL_CALL_AFTER_MS`.
- **Consent: recorded by the shop.** The staff member who saves the address ticks that the shore contact agreed to receive these alerts; the shop row keeps when and who (`shops.shore_alert_consent_at`, `shore_alert_consent_by_person_id`). A new or changed address needs the box ticked again; the same address saved again keeps its first consent; an empty box clears both. An address without a consent cannot be stored (`shops_shore_alert_consent`) and is never sent to.
- **The free-text `emergencyReference.shoreContact` stays as it is**, for a person to read in an emergency. The address lives beside it on the same settings page (Settings → Emergency reference).
- **What the shore contact gets:** one email per departure, under the same `roll_call_alerted_at` claim, in the shop's default language, from the shop ("Blue Mantis via DiveDay"). It names the shop, the departure, the dive, how many people have no result and when the boat was due back, and says they get it as the shop's shore contact. No link, no diver or crew names, no staff sign-in (`roll_call_stale_shore`). If the address is also an owner's, that owner gets one copy.
- **The claim:** a pass that reaches nobody, the shore contact included, still releases the claim; a pass that reaches only the shore contact keeps it.
- **Never** for a rehearsal, a canceled departure or a demo shop (unchanged).
- **Not exported** in the shop's data bundle: a consent given to this installation is recorded again after a restore.

## Minimum outcome to record

Whether the shore contact should become a structured, consented recipient (a phone number or address with an opt-in), and if so by text, email or both; whether managers should hear as well as owners; whether 30 minutes is right.

## Recommendation (2026-10-14)

Keep owners only until a shop asks. A structured shore contact is a settings field, a consent line and one more recipient in `sendStaleRollCallAlerts` (`src/db/roll-call-alerts.ts`).

## Unblocks / follow-up

Nothing waits on it: the owner alert and the shore contact's are live. Still open, for whoever asks: SMS to the shore contact, managers as recipients, and whether the shore contact should confirm their own address by a link before the first alert. The window is `STALE_ROLL_CALL_AFTER_MS` in `src/lib/roll-call-alerts.ts`.
