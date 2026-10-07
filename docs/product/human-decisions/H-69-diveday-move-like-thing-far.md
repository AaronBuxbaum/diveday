# H-69: Does DiveDay move like a thing, and how far does that reach?

- **Status:** Ready
- **Human owner:** Product owner

## Decision or approval needed

**Does DiveDay move like a thing, and how far does that reach?** The 2026-09-07 loop ([canvas](../../design/canvases/20260907-nothing-from-nowhere/README.md), ADR [20260907-nothing-from-nowhere](../../architecture/decisions/20260907-nothing-from-nowhere.md)) read the app's motion from the running tree: a figure that changes in place swaps, a row that leaves takes 200ms and the gap beneath it closes in none, the More sheet cannot be dragged and dismisses at the top of the screen, timing is ten copied numbers in two languages, and a pressed row does nothing under the finger. The ADR proposes one physics (three rungs as tokens, three curves, the press, an event table) and six moves: a figure rolls, a row closes its own gap, the sheet follows the thumb, the title folds into the bar, the press answers within a frame, and the departure on the lock screen as a Wallet pass. Three of the six move on the ADR alone; three carry a call.

## Minimum outcome to record

**(a)** Whether `--ease-spring`, rationed today to the one menu that unfolds, may also be spent on the two places a finger gave a thing weight: the sheet settling back from a short drag and a pressed control letting go. Recommended yes, those two and no other. **(b)** Whether DiveDay signs Wallet passes, which needs an Apple Developer Program membership and Pass Type ID certificate, an Apple push credential, and a Google Wallet issuer account. Recommended yes, with the slice `waiting-on-external` until the certificate is held. **(c)** Whether the slide (a row closing its own gap) may reach the manifest roster after the server commit, where drawn motion is banned. Recommended yes for the slide, after the commit; the head count never rolls under any answer.

## Unblocks / follow-up

**(b) Chosen 2026-09-07 (Aaron Buxbaum, in session): yes** — "we definitely want the wallet pass" — built now and shipped dark until the Apple and Google credentials are held; the contract is the canvas's [SPEC.md](../../design/canvases/20260907-nothing-from-nowhere/SPEC.md) and slice 18f is startable. **(a) and (c) still open.** The ADR moves to Accepted when they are answered; slices 18a–18d shipped on the ADR alone.

Part of the [human decision log](README.md#decision-register).
