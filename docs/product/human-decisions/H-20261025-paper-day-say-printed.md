# H-20261025-paper-day-say-printed: Does the paper day say who printed it?

- **Status:** Implemented
- **Human owner:** Product owner

## Current outcome — 2026-11-10

Print the shop name and timestamp, not the staff member's name. Current source already matches:
ShopDayPrintPage and TripPacket format print time with the shop zone; each PacketSheet delegates
the shop identity and print timestamp to ShopSheet. This source reconciliation does not claim
physical-printer field testing, and no duplicate implementation issue is needed.

Source: [owner-account decision record on #4193](https://github.com/AaronBuxbaum/diveday/issues/4193#issuecomment-6759760819).
The sections below preserve the original question and rationale, not a second unresolved worklist.

## Original question

**Does the paper day say who printed it?** The day packet (`/shop/<slug>/print`, N-54) puts every departure of today on paper: each boat's dive plan, its manifest — which carries every diver's emergency contact and their readiness — and its packing list, in a document designed to leave the building. A security review of #1587 asked whether the sheet should carry a **"Printed by ⟨name⟩ at ⟨time⟩"** line, the way the incident-record export already does, so a sheet found on a dock has provenance. Issue #1599 closed the measurement half of that gap: opening the day packet now emits `day_print_opened` the way the per-trip packet emits its own, and that is product analytics rather than a per-person trail. The line on the paper is the other half and is not an agent's call — it prints a staff member's name onto a document that leaves the shop, and the same line is what makes a stray sheet attributable.

## Minimum outcome to record

Yes or no to the line, and if yes: the name it prints (the staffer's own name, or the shop's), whether the time carries the shop's zone, and whether it prints on every sheet or only the first.

## Unblocks / follow-up

The event landed with #1599 and does not wait on this. The line is a change to `src/app/shop/[shopSlug]/print/page.tsx`'s header plus one message key in both locales; nothing else depends on it.

Part of the [human decision log](README.md#decision-register).
