# H-20261014-padi-divechek: May the extension check a PADI card on DiveChek, behind the shop's own PADI sign-in?

- **Status:** Implemented (amended 2026-10-15, confirmed by Aaron Buxbaum 2026-10-15; amended by Aaron Buxbaum 2026-10-23)
- **Human owner:** Product owner

## Decision or approval needed

**May the DiveDay browser extension look a diver up on PADI's DiveChek, on the PADI Pros' Site, in the staffer's own signed-in browser, and certify the PADI card on a match?** [H-20261008-cert-check-extension](H-20261008-cert-check-extension.md) built the check on the public lookups and left PADI for later. DiveChek is a member benefit behind the shop's PADI Pro sign-in, not a public page, so PADI's member terms may read "an extension filled the search" as automated use of a member tool. Nobody here has read those terms or seen the page.

## Minimum outcome to record

Whether to build it before PADI's member terms are read and before anyone has tried the real page, and what holds until then.

## Outcome

**Decided 2026-10-14 (Aaron Buxbaum, in the project thread):** "build those 3", taking the top three ideas for the extension, of which this is the second. PADI's member terms were weighed as the open question; the default is to build it, pending a read of the PADI Pros' Site terms and a test against the real page. Built as the PADI section of [20261008-cert-check-extension](../../architecture/decisions/20261008-cert-check-extension.md):

- "Check with PADI" on a pending PADI Open Water, Advanced Open Water or Rescue card whose diver has a birth date on file, on the diver record, a departure's Divers tab and Today, and inside a departure's "Check all". A divemaster or instructor card keeps its link.
- The extension types the diver's first name, last name and birth date into DiveChek's search boxes only, and only once every box and the search's own button are found; presses only that button, never a bare submit; never acts on a sign-in, sign-up or account page, one with a visible password box, or one with an email box that does not search; and hands back only the lines about this diver.
- A signed-out browser says "Sign in to the PADI Pros' Site first", and stops a "Check all" with that reason. The "(member sign-in)" link opens the same Pros' Site host.
- The server certifies only one diver: DiveChek's rows sharing the typed birth date are that diver's cards, and the record carrying the level must carry the birth date first and, when the card has one, its number. A namesake born another day, a transposed date, another level, a neighbor's row or a page listing several divers certifies nothing. An instructor named on the row is the trainer; a "Junior" rating counts as the level from the diver's 15th birthday, and under 15 is recorded by hand.

**Amended 2026-10-15** (requested in the project thread after research against PADI's published pages; **confirmed by Aaron Buxbaum on 2026-10-15**, who asked to keep iterating on the beta without a dive pro: a beta switch, off by default): both PADI checks, DiveChek and eLearning, sit behind a per-shop switch, **off by default**, "PADI checks (beta)" in Settings, Features (`shops.padi_checks_enabled`), which an owner or manager turns on. The shop that turns it on chooses the terms risk for the PADI membership of the Pro signed in, which is the member's license and not transferable. Off, a PADI card keeps only its "(member sign-in)" link, a staffer with the extension reads that PADI checks are off and who can turn them on, and the server refuses a check. Two exits, held apart:

- **"Beta" comes off** only after each of these has been seen on PADI's real pages: a match, a no record, a several-divers page, a signed-out page, a Junior (or "Jr.") card, a PADI Scuba Diver card, and the date format of a page read by a Pro outside the US (`dates: "mdy"` for PADI in `AGENCY_CHECKS` is a guess).
- **The default turns on** only after the Pros' Site terms are pasted into this record or PADI answers in writing; that call stays the product owner's. The same change moved the host to `pro.padi.com`, where PADI's own pages send pros (`pros.padi.com` is still read), and added DiveChek's published "Run Report" button.

**Amended 2026-10-23 (Aaron Buxbaum, in the project thread):** the switch starts **on**. Every switch on the Features page defaults on for a new shop, and "PADI checks (beta)" with them (`shops.padi_checks_enabled` default true; every seeded shop has it on; existing shops keep their value). This is the product owner's call the second exit above reserved, made before the Pros' Site terms were read. "Beta" stays until the real pages are seen. A shop whose Pros do not want the check turns it off in Settings, Features, and off still keeps the "(member sign-in)" link.

## Unblocks / follow-up

Two human steps before a shop relies on it: read the PADI Pros' Site terms for anything that rules out a browser extension filling DiveChek's search, and try it once signed in ([the cert-check extension runbook](../../engineering/cert-check-extension-runbook.md), "The PADI session", with the eLearning test of #2259). Until then the address, the form and the wording are a best guess, and a wrong guess answers "Couldn't read PADI's page" and writes nothing. If the terms rule it out, `padi` comes out of `AGENCY_CHECKS` and `extension/agencies.js`, and the card keeps its link. A design-partner shop that turns the switch on can run the real-page test in its own signed-in browser and paste the terms text from the same session.

Part of the [human decision log](README.md#decision-register).
