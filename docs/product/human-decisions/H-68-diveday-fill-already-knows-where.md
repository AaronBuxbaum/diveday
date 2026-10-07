# H-68: Does DiveDay fill in what it already knows, and where does a person still…

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

**Does DiveDay fill in what it already knows, and where does a person still get asked?** The 2026-09-06 loop ([canvas](../../design/canvases/20260906-before-you-ask/README.md), ADR [20260906-before-you-ask](../../architecture/decisions/20260906-before-you-ask.md)) found the product keeping its knowledge to itself: a diver on her third booking types her card and sizes again, the add panel opens blank on a shop that has run the same Saturday boat for two years, a half-filled form is lost to a phone call, the palette opens a record where the desk asked a question, and four sends ask "are you sure?" where a held send could be undone. The ADR proposes one rule (fill what is known, show its source, leave the last tap to a person, render nothing otherwise, never reach a safety fact) on six surfaces. Three of the six move on the ADR alone; three carry a call.

## Minimum outcome to record

**(a)** Whether the four sends that ask a confirming question today (issue or reissue a waiver link, resend a waiver, send a last-minute deal, offer a freed seat) take an eight-second server-side hold with Undo instead, recommended yes on all four. **(b)** Whether an email typed cold into the booking form that matches a diver on file may receive one link to bring their details across; nothing shows on the page either way. Recommended yes, one email, only while a booking form is mid-fill with that address. **(c)** Whether the add panel's learned weekday pattern may fill the crew field, which schedules people; recommended yes, with the sentence saying who ran the last six and that neither is booked elsewhere that morning.

## Unblocks / follow-up

**Decided 2026-09-06 (Aaron Buxbaum, in session): every recommended option.** **(a)** the four sends take the eight-second server-side hold with Undo and their confirm dialogs go. **(b)** yes, one email, only while a booking form is mid-fill with a matching address; nothing shows on the page. **(c)** the pattern fills the crew field, under the sentence saying who ran the last six and that neither is booked elsewhere. The ADR is Accepted with those decisions; slices 17a–17f in the roadmap, started the same day.

Part of the [human decision log](README.md#decision-register).
