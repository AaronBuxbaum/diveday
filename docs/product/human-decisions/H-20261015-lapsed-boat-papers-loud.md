# H-20261015-lapsed-boat-papers-loud: Does lapsed hull insurance ever stop a departure?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Should an expired hull insurance, registration or safety inspection refuse a departure?** It read as a yellow warning, the same tone as kit flagged for service (2026-10-15 safety sheet, item 8).

## Minimum outcome to record

Whether a lapsed paper gates a departure, and how loudly it is said.

## Outcome

**Decided 2026-10-16 (Product owner: Aaron Buxbaum, in the "Improvement loop" thread, "Do all recommended decisions and actions in the list"), the recommended option:** no, loud only. DiveDay cannot know a policy was renewed offline, so a lapsed paper never stops a departure; it reads in danger ink.

Built 2026-10-16 (safety build, layer 1): an expired insurance, registration or inspection is tone "danger" (`boatSafetyNoticeTone`, `src/lib/boat-safety.ts`) on the manifest's boat section, and on Today as the owner's "Papers lapsed" row, with the boat's name and the date ("Hull insurance ended Oct 8, 2026"). Nothing refuses a booking, a check-in or a departure for it.

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
