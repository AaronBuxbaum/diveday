# H-114: May the extension check a PADI card on DiveChek, behind the shop's own PADI sign-in?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**May the DiveDay browser extension look a diver up on PADI's DiveChek, on the PADI Pros' Site, in the staffer's own signed-in browser, and certify the PADI card on a match?** [H-105](H-105-cert-check-extension.md) built the check on the public lookups and left PADI for later. DiveChek is a member benefit behind the shop's PADI Pro sign-in, not a public page, so PADI's member terms may read "an extension filled the search" as automated use of a member tool. Nobody here has read those terms or seen the page.

## Minimum outcome to record

Whether to build it before PADI's member terms are read and before anyone has tried the real page, and what holds until then.

## Outcome

**Decided 2026-10-14 (Aaron Buxbaum, in the project thread):** "build those 3", taking the top three ideas for the extension, of which this is the second. PADI's member terms were weighed as the open question; the default is to build it, pending a read of the PADI Pros' Site terms and a test against the real page. Built as the PADI section of [20261008-cert-check-extension](../../architecture/decisions/20261008-cert-check-extension.md):

- "Check with PADI" on a pending PADI level card whose diver has a birth date on file, on the diver record, a departure's Divers tab and Today, and inside a departure's "Check all".
- The extension types the diver's first name, last name and birth date into DiveChek's search boxes only, presses only that search's own button, never acts on a sign-in, sign-up or account page or one with a visible password box, and hands back only the lines about this diver.
- A signed-out browser says "Sign in to PADI first", and stops a "Check all" with that reason.
- The server certifies only one record with this diver's name, birth date and PADI's own wording for the level; a namesake, another level, or a page listing several divers certifies nothing.

## Unblocks / follow-up

Two human steps before a shop relies on it: read the PADI Pros' Site terms for anything that rules out a browser extension filling DiveChek's search, and try it once signed in (`extension/README.md`, "Test DiveChek against the real page", with the eLearning test of #2259). Until then the address, the form and the wording are a best guess, and a wrong guess answers "Couldn't read PADI's page" and writes nothing. If the terms rule it out, `padi` comes out of `AGENCY_CHECKS` and `extension/agencies.js`, and the card keeps its link.

Part of the [human decision log](README.md#decision-register).
