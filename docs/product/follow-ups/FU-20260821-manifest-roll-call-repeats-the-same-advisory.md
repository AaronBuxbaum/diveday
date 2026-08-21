# FU-20260821-manifest-roll-call-repeats-the-same-advisory — Hoist the manifest's repeated depth advisory to the checkpoint header

- **Status:** Open
- **Raised:** 2026-08-21 — trip-page redesign branch `claude/trip-page-redesign-45e8d6` (shell + Overview slice)
- **Kind:** improvement
- **Effort:** M
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/manifest/_components/DiverRollCall.tsx`, `src/app/shop/[shopSlug]/trips/[id]/manifest/page.tsx`, `src/i18n/locales/en-US/staff/trips.json`, `src/i18n/locales/es-ES/staff/trips.json`, `e2e/manifest.spec.ts`, `e2e/depth-and-age-surfaces.spec.ts`

## What I noticed

The manifest's roll-call list renders the identical amber depth advisory ("Reaches 40 m — deeper
than the 18 m their certification qualifies them for. Not a block — plan shallower, or confirm the
guide keeps them within limits.") inside nine of ten diver rows on the seeded Wreck Trip, plus the
same three blocker bullets per row — a 5,500px safety document whose signal (who is *not* boarded)
competes with a warning photocopied nine times. The chip strip at the top already counts the
blocked divers once.

## Why it isn't already done

The manifest is a safety-critical surface (hard rules: boring code, failure-path tests,
`dive-domain-expert` review), and its per-row content is also what prints as the coast guard
document — a change to what each row carries needs the print layout thought through
(`print:block` duplication of disclosure content) and its own review. Too much risk to ride along
in a visual redesign PR.

## Proposed change

When the same depth advisory resolves identically for N≥3 divers at the current checkpoint, state
it once under the checkpoint summary panel with the divers' names ("Applies to Priya, Diego, June,
+4 more"), and mark each affected row with a short chip ("Past cert depth") instead of the full
paragraph; a diver whose advisory differs (junior depth cap, no card at all) keeps their full
sentence on the row. Blocker bullets stay per-row — at the rail, "why can't this person board" must
be answerable at the row — but consider the same one-line compaction with the full sentences a
tap away on Guests, where the fix lives. Print keeps the full per-row advisory (paper cannot
follow a chip to a header). A dive-domain-expert review is part of the change, not optional.

## Prompt

```text
In the DiveDay repo, reduce repetition on the staff trip Manifest without weakening it as a
safety document. Read docs/design/principles.md #9,
"src/app/shop/[shopSlug]/trips/[id]/manifest/_components/DiverRollCall.tsx" and
manifest/page.tsx, and src/i18n/depth-labels.ts. When the identical depth advisory applies to 3+
divers at the current checkpoint, say it once under the SummaryPanel naming the affected divers,
and give each affected row a short chip in its place; divers with a different advisory (junior
cap, no card) keep their full row sentence, blocker bullets stay per-row, and the print layout
keeps full per-row advisories (closed disclosures render nothing on paper — see the print:block
pattern already in DiverRollCall). Do not touch roll-call controls, their aria names, or
checkpoint remount keys (RollCallButton's key={checkpoint} contract). All new copy lands in both
en-US and es-ES bundles. Update e2e/manifest.spec.ts and e2e/depth-and-age-surfaces.spec.ts
assertions, and check the manifest visual captures including the print block in
e2e/visual.spec.ts. Launch a dive-domain-expert review before calling it done. Run pnpm check
and the touched e2e specs. Delete
docs/product/follow-ups/FU-20260821-manifest-roll-call-repeats-the-same-advisory.md in the same
change.
```
