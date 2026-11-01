# H-20261023-medical-alert-for-the: Where does a diver tell the crew something medical they should know in an emergency?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**A shop could ask a health question as one of its own shop questions, where no answer is checked and every staffer reads it, while the crew on the boat had no place to read "bee-sting allergy, EpiPen in the blue dry bag."** Issue #2960 (from the shop-questions domain review, point 4) offered options; option 1 was recommended: a medical alert for the crew on the release itself.

## Decision

**Decided 2026-10-23 at 15:11Z (Aaron Buxbaum, on issue #2960: "Do recommended for 2960"): option 1.** One optional box after the medical questionnaire, sealed with the signature. It informs and never gates. Every staffer sees that one exists; an owner, a manager or the crew of the diver's departure reads the words, and each read is on the diver's trail. The offline copy carries the words only for those readers.

## Amendment, 2026-10-23: where the words travel (review fixes)

Accepted by the steering thread after the security review and two `dive-domain-expert` reviews of the build. Each point replaces what the decision above implied.

- **No words in a page payload.** The manifest and roll-call pages never put any diver's alert text in their HTML or RSC payload, for anyone, the owner included. The words reach a browser only through "Show the alert" (which checks the reader and records `medical_alert_read`) or an explicit offline save.
- **Offline words only on an explicit save.** The background save (the shop layout's auto-save, the service worker's refresh, `/api/offline-manifests/upcoming`) never carries the words. A permitted reader taps "Save the medical alerts for offline" on one departure; `POST /api/offline-manifests/[tripId]/medical-alerts` hands the words out and records one `medical_alert_saved_offline` line per diver on that departure (a sibling event, so the trail tells a read on screen from a save to a device). The stored copy records who saved the words and when. Background refreshes keep saved words for every diver the board still flags, while the viewer may still hold them (see the second amendment).
- **Shared device.** Signing out, or a different person signing in on the device (the next `/upcoming` answer names who is signed in), wipes the words from every stored copy and keeps the rest of each copy, queued roll call included.
- **What an offline copy says.** A copy without words says it was saved without them and who can save one with them. A crew member removed from the boat after saving keeps that copy, words included, until the next background refresh while online (second amendment), or until it expires at sea (at most 14 days, or the pending-roll-call grace), sign-out or another sign-in.
- **Reveal never takes down the page.** A failed "Show the alert" shows the words from a copy this phone saved with them, labeled with who saved it; with none, it says there is no signal and to save the trip for offline before leaving the dock. It never throws to the error page.
- **Who reads.** A crew assignment counts only while the person who made it is a live owner or manager of the shop (security review 2, M-1): crew who rostered themselves, or whom another instructor or divemaster rostered, do not count, and a manager demoted, disabled or removed since stops vouching for what they assigned. Owner and manager read however they got on the roster.
- **Read events.** At most one `medical_alert_read` per reader, diver and departure in ten minutes; every tap still shows the words.

## Amendment, 2026-10-23: security review 2

Accepted by the steering thread after the second security review of the build.

- **Who reads.** See the first amendment's "Who reads": only an assignment a live owner or manager made counts (M-1).
- **The diver page never shows an earlier release's words** (L-1, L-2). A waiver link is a bearer capability that may not be in the diver's hands, so it carries no person-level medical text from another record. When the link has no draft and the same person's **latest** signed release at this shop carried an alert, the box starts empty and the page says: their last waiver here had a medical alert for the crew, and to write it again if it still applies. Only the latest release counts, so an alert the diver cleared on purpose stays cleared. The link's own draft still restores as before. A held seat's link says nothing.
- **A refresh drops words the viewer may no longer hold** (L3). `/api/offline-manifests/upcoming` says, per departure, whether the signed-in viewer may still hold the words (the live "Who reads" check). The background refresh drops saved words for any departure where they may not, or where the answer is missing. A crew member taken off the boat, or a manager demoted, loses them at the next five-minute refresh while the device is online; a device already at sea keeps them until it expires, as accepted.
- **When the wipe runs, and when it cannot** (L4). Both sign-out doors wait for the wipe before they navigate. A session that ends without the sign-in page loading (the browser closed, or the session expiring while the tablet sits on the offline manifest, which needs no session) runs no wipe: the saved words stay readable to anyone holding the unlocked device until the copy expires or the next sign-in on it.

Not in this amendment, filed as decisions for the product owner: printing the words (paper keeps the flag and says who can read it in DiveDay), and an emergency logged read for staff who are not on the crew. Both were decided on 2026-10-24; see the third amendment.

## Amendment, 2026-10-24: print the words, and an emergency read (issue #2990)

**Decided 2026-10-24 at 00:48Z (Aaron Buxbaum, on issue #2990: "do recommended"): both parts as recommended.** Each point replaces what the earlier text said about paper and about who reads.

- **Print with medical alerts.** Beside "Print packet", an owner or a manager (live roles, `canPrintMedicalAlerts`) on a departure with an alert gets "Print with medical alerts". It prints the same packet with each diver's words under their manifest row, the line "Written by the diver. Nobody reviewed it, and it doesn't change who can dive." once above them, who printed it and when in the shop's zone, and a line to keep the sheet with the crew and destroy it after the trip. The words are read on the server for that print, never from a page payload, and reach the composed manifest under a key no URL can carry. The print is the read: the server writes one `medical_alert_printed` line per printed diver when it produces the sheet, every print its own line. A sibling event, so the trail tells a sheet from a read on screen. The default packet keeps the flag only; the day's paper, the dispute sheet and every other print never carry the words.
- **Emergency read.** In the reveal sheet, a staffer the crew rule refuses sees "Emergency: show the alert" under who can read it, only on the days of the trip in the shop's zone (from the server's clock) and only as an active staffer of that shop who can open that manifest (`canEmergencyReadMedicalAlert`). A confirm step says it is for emergencies only, that it goes on the diver's record and that the owner will see it. On confirm the server checks again and records `medical_alert_emergency_read`, naming the reader, before it answers; it is never de-duplicated, so every emergency read is its own line, and the words are not kept for the visit. A cross-site call is refused. Never on a bearer page, never offline: with no signal it says so and asks nothing.
- **Who sees the emergency reads.** The owner's and managers' Monday email lists last week's emergency reads (diver, departure, who read it, when, in the shop's zone); a week with none names nothing, and the crew's email never has the section. Owner and manager also see each line on the diver's trail. Names only, never the words, and the section stays out of the `monday` assist's opening sentences.
- **Offline is unchanged.** A copy without the words still says it was saved without them and who can save one with them; nothing new is offered offline.

**Review fixes, 2026-10-24 (steering thread, after two `dive-domain-expert` runs and a `security-reviewer` run).** Each point narrows or corrects the amendment above.

- **"The days of the trip", not "the day the departure leaves".** The emergency read opens at the start of the departure's start date in the shop's zone and stays open until the later of the end of the date `endsAt` falls on and the moment the departure is marked returned (`hasReturned`), the same reading the *Trip phase* gives a late boat (`emergencyReadWindow`). Why: the first wording shut the read at midnight on a night boat still at sea and on every later day of a multi-day trip, which is exactly when the listed crew is thin and someone is helping out. A boat at sea is still the trip.
- **The server decides.** The button shows to a refused staffer whenever the window has not ended, so a tab opened the night before still has it at sea. If the server refuses because the window has not opened, the sheet says it opens on the day of the trip; if it has closed, or for any other refusal, that it can't be opened now and to ask the owner or a manager. Neither says "Try again".
- **Weak signal.** The confirm gives up after 15 seconds, Cancel works while it waits, and a failure or timeout says there's no signal right now, offers the retry, and points to the printed alerts sheet if the shop printed one. The confirm promises the diver's record and the owner, not an email the owner may have turned off.
- **The sheet.** It prints its own title ("Trip packet with medical alerts"), a keep-with-the-crew-and-destroy line under every alert so each page with words carries it, the row numbers and names of the divers with an alert at the top, and a line that it is a snapshot from the time printed. The default sheet's flag line says any staffer can open it in an emergency during the trip and points to the alerts sheet if one was printed.
- **The Monday email** gives the total count of emergency reads, a count per reader, up to 50 lines, then "and N more". A blank diver, reader or departure name is said as a neutral stand-in and never stops the email.
- **Cross-site.** The print with medical alerts refuses a cross-site navigation with the same 404 before it reads or records anything, and the emergency action asks the same shared same-origin rule (`isCrossSiteHeaders`), which accepts DiveDay's public origin.

## What ships

Glossary *Medical alert for the crew*; ADR [20260729-staffing-waiver-audit-and-localized-copy](../../architecture/decisions/20260729-staffing-waiver-audit-and-localized-copy.md), amendment of 2026-10-23 (the second conditional seal key); ADR [20260718-offline-manifest-snapshots](../../architecture/decisions/20260718-offline-manifest-snapshots.md), amendment of 2026-10-23 (medical alert words on a device copy).

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
