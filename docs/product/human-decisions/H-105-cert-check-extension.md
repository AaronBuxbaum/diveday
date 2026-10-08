# H-105: May a browser extension check a card on the agency's page, and certify it on a match?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**May the DiveDay browser extension look a diver up on the agency's own lookup page from the staffer's browser, and certify the card when the page shows it?** H-10 dropped agency integration because no agency offers an API, and the registry of lookup links promised DiveDay "never fetches, scrapes or posts to" those pages. An extension in the staffer's own browser can do what the staffer does by hand there, including a member sign-in.

## Minimum outcome to record

Whether the "never fetches" stance stands for the staffer's own browser; whether a match needs a staffer's tap; and whether PADI is in the first build.

## Outcome

**Decided 2026-10-08 (Aaron Buxbaum, in the project thread):** "1 and 3: recommended, 2 auto". The staffer's own browser may do the lookup (DiveDay's servers still never call an agency); a match certifies the card without a second tap; PADI comes later, after the public agencies. Built as [20261008-cert-check-extension](../../architecture/decisions/20261008-cert-check-extension.md): a match is the diver's name beside the claimed level's own wording, and Undo takes it back.

## Unblocks / follow-up

Publishing the extension to the Chrome Web Store (DiveDay's developer account, privacy policy, listing) is a human step; until then Settings offers no install link. PADI DiveChek needs a PADI Pro sign-in to build against.

Part of the [human decision log](README.md#decision-register).
