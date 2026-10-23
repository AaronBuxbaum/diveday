# H-153: Where does a diver tell the crew something medical they should know in an emergency?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**A shop could ask a health question as one of its own shop questions, where no answer is checked and every staffer reads it, while the crew on the boat had no place to read "bee-sting allergy, EpiPen in the blue dry bag."** Issue #2960 (from the shop-questions domain review, point 4) offered options; option 1 was recommended: a medical alert for the crew on the release itself.

## Decision

**Decided 2026-10-23 at 15:11Z (Aaron Buxbaum, on issue #2960: "Do recommended for 2960"): option 1.** One optional box after the medical questionnaire, sealed with the signature. It informs and never gates. Every staffer sees that one exists; an owner, a manager or the crew of the diver's departure reads the words, and each read is on the diver's trail. The offline copy carries the words only for those readers.

## Amendment, 2026-10-23: where the words travel (review fixes)

Accepted by the steering thread after the security review and two `dive-domain-expert` reviews of the build. Each point replaces what the decision above implied.

- **No words in a page payload.** The manifest and roll-call pages never put any diver's alert text in their HTML or RSC payload, for anyone, the owner included. The words reach a browser only through "Show the alert" (which checks the reader and records `medical_alert_read`) or an explicit offline save.
- **Offline words only on an explicit save.** The background save (the shop layout's auto-save, the service worker's refresh, `/api/offline-manifests/upcoming`) never carries the words. A permitted reader taps "Save the medical alerts for offline" on one departure; `POST /api/offline-manifests/[tripId]/medical-alerts` hands the words out and records one `medical_alert_saved_offline` line per diver on that departure (a sibling event, so the trail tells a read on screen from a save to a device). The stored copy records who saved the words and when. Background refreshes keep saved words for every diver the board still flags.
- **Shared device.** Signing out, or a different person signing in on the device (the next `/upcoming` answer names who is signed in), wipes the words from every stored copy and keeps the rest of each copy, queued roll call included.
- **What an offline copy says.** A copy without words says it was saved without them and who can save one with them. A crew member removed from the boat after saving keeps that copy, words included, until it expires (at most 14 days, or the pending-roll-call grace); removal reaches a device only through sign-out, another sign-in or expiry.
- **Reveal never takes down the page.** A failed "Show the alert" shows the words from a copy this phone saved with them, labeled with who saved it; with none, it says there is no signal and to save the trip for offline before leaving the dock. It never throws to the error page.
- **Who reads.** Crew who rostered themselves onto a departure do not count; only an assignment someone else made does (the rule of `src/db/training-mark-resolve.ts`). Owner and manager are unaffected.
- **Read events.** At most one `medical_alert_read` per reader, diver and departure in ten minutes; every tap still shows the words.

Not in this amendment, filed as decisions for the product owner: printing the words (paper keeps the flag and says who can read it in DiveDay), and an emergency logged read for staff who are not on the crew.

## What ships

Glossary *Medical alert for the crew*; ADR [20260729-staffing-waiver-audit-and-localized-copy](../../architecture/decisions/20260729-staffing-waiver-audit-and-localized-copy.md), amendment of 2026-10-23 (the second conditional seal key); ADR [20260718-offline-manifest-snapshots](../../architecture/decisions/20260718-offline-manifest-snapshots.md), amendment of 2026-10-23 (medical alert words on a device copy).

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
