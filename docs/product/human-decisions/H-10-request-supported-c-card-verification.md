# H-10: ~~Request supported C-card verification access from PADI, SSI, and NAUI, then choose the authorized…

- **Status:** Dropped
- **Human owner:** Product owner + operations lead

## Decision or approval needed

~~Request supported C-card verification access from PADI, SSI, and NAUI, then choose the authorized verification source for each agency.~~

## Minimum outcome to record

—

## Unblocks / follow-up

Dropped: no agency exposes a usable C-card verification API, so the automated seam was removed in favour of manual staff certification — staff look the number up with the agency and mark the card certified. See [20260721-manual-certification](../../architecture/decisions/20260721-manual-certification.md). A card waiting for a check carries a **Check with <agency>** link to that agency's own lookup where one exists (SSI, NAUI, SDI, TDI, GUE; CMAS as a portal search with gaps; PADI through the member sign-in, labelled so), from one registry, `src/lib/agency-verification.ts` (2026-10-07, market audit item 30): a link, never a call.

Part of the [human decision log](README.md#decision-register).
