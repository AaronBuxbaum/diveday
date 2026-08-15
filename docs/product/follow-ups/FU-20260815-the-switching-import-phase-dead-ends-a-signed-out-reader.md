# FU-20260815-the-switching-import-phase-dead-ends-a-signed-out-reader — Give phase 3 of every switching guide a door for the reader who has no shop yet

- **Status:** Open
- **Raised:** 2026-08-15 — anchoring the homepage's spreadsheet link at `#columns` (branch `follow-ups/round-two`), acting on a `conversion-reviewer` pass
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/app/switching/_components/guide.tsx`, `src/components/SwitchingImportCta.tsx`, `src/lib/funnel.ts`, `e2e/marketing.spec.ts`

## What I noticed

Every switching guide's move rail ends on `ImportPhase` — "Bring the file into DiveDay", three
steps reading *"Open Settings → Import contacts. The owner or manager uploads the CSV in your
DiveDay shop."* Under those steps sits `importCta`, which is `SwitchingImportCta`
(`src/components/SwitchingImportCta.tsx`). That component reads the session and **returns `null`
for anyone who isn't signed in as an owner or manager**, which is correct — an anonymous visitor
has no shop to deep-link into, and `e2e/marketing.spec.ts` asserts it stays hidden.

The consequence is that the peak-intent moment on the page is a dead end for the buyer the page is
written for. A prospect has just read that their columns match and what stays behind, and the page
tells them to open a shop they do not have and then offers them nothing. The next control below is
the concierge `mailto:`, and after that the closing demo/trial band — roughly 2,500px of scrolling,
with no sticky header to climb back up by (`MarketingNavView` is `border-b border-border
bg-background/95`, not `sticky`).

This was a mid-scroll weakness until 2026-08-15. It is now an *entry* experience: the homepage's
records-band link lands a reader at `#columns`, one phase above it, having skipped the hero where
the guide's first demo and trial doors live.

**A second thing to look at in the same stretch, since one session would meet both.** Order the
panels between `#columns` and the footer by visual weight and it reads: `SwitchingConcierge`
(`p-8 sm:p-10`, `border-primary/30 bg-primary/5`, a `text-2xl sm:text-3xl` heading, a primary-filled
button) ≫ the closing band ≫ `MidCta`. So the loudest object on a switching guide is the `mailto:`,
and the page's declared primary action — walk the demo — sits in its quietest panel. Emailing a
stranger about your shop's data is the *higher*-commitment act of the two, dressed as the easier
one. Both doors are legitimate and the concierge offer is owner-authorized
(docs/product/marketing.md, claims policy), so this is a rendered-page judgment rather than a rule
violation — look at it light and dark, phone and desktop, before deciding anything. It matters more
now for the same reason as above: an anchor-lander meets the concierge before they meet any demo
button.

## Why it isn't already done

Two reasons, both real.

Path ownership: `src/components/SwitchingImportCta.tsx` belonged to another agent in the concurrent
run that raised this, and the fix has to live there — `ImportPhase` renders inside a `"use cache"`
body and cannot itself know whether there is a session.

More importantly it is a **positioning call, not a cleanup**. Every switching guide today offers
exactly three demo doors and three trial doors — hero, hinge, close — and `e2e/marketing.spec.ts`
pins that count (`toHaveCount(3)`) as a deliberate ceiling. Adding a fourth trial door to five
pages is the kind of change docs/product/marketing.md wants argued, not slipped in beside an anchor
fix.

## Proposed change

Give `SwitchingImportCta` a signed-out branch instead of `null`: the trial link at secondary
weight, built with `trialHref(source)` and labelled `marketing.common.startTrial` — the control the
closing band already renders, with copy that already exists in both bundles. A signed-in owner
keeps "Open Import in your shop" exactly as today; the prospect gets a door to the shop they would
be importing *into*, at the moment they have just decided their file fits.

That needs `source` threaded into `ImportPhase` (it takes `locale`, `number`, `importerNote` and
`importCta` today, no funnel tag) and on to the component, so the door is attributable like every
other. It is one control on that screen, so the one-primary-CTA-per-screen budget is untouched.

Then update the two counts in `e2e/marketing.spec.ts` — the guide tests assert three demo buttons
and the EVE/spreadsheet tests assert `"Open Import in your shop"` is hidden, which stays true; what
changes is that a *trial* link now appears there for a signed-out reader, so assert it by tag
rather than letting the count drift silently.

**Not** proposed: a fourth *demo* door. The ask at that point in the page is "start the shop you
just decided your file fits", not "look at a sample one" — and the demo is already offered twice
above and once below.

## Prompt

```text
Read src/components/SwitchingImportCta.tsx, then ImportPhase in
src/app/switching/_components/guide.tsx and both of its callers
(src/app/switching/spreadsheet/page.tsx, src/app/switching/[competitor]/page.tsx), and the guide
tests in e2e/marketing.spec.ts ("migration guides walk a shop from an incumbent export into the
importer" and "the spreadsheet guide brings a no-system shop across for free").

Phase 3 of every switching guide tells the reader to open Settings → Import in their DiveDay shop,
and then renders nothing at all for a reader who has no shop — SwitchingImportCta returns null
without a session. That is the peak-intent moment on the page and it is a dead end for exactly the
buyer the page is written for, ~2500px above the next self-serve door, with no sticky header to
scroll back up by. It matters more since 2026-08-15, because the homepage's records band now lands
readers at #columns, one phase above it, past the hero's own demo and trial doors.

Give the signed-out reader the trial door there: trialHref(source) with the existing
marketing.common.startTrial label, at secondary weight (buttonClass({ variant: "secondary" })).
Keep "Open Import in your shop" unchanged for a signed-in owner. ImportPhase does not currently
take a funnel source — thread one in from both callers so the new door is attributed like every
other CTA on the page, and read src/lib/funnel.ts's header comment before choosing the tag name.

Do NOT add a fourth demo door: the ask at that point is "start the shop your file fits", and the
demo is already offered three times on the page. Do NOT write new copy — both labels exist in
src/i18n/locales/{en-US,es-ES}/diver.json already.

Done means: pnpm check green; pnpm e2e e2e/marketing.spec.ts --reporter=line green with the guide
tests updated deliberately (the "Open Import in your shop" hidden assertions must still hold); and
a look at /switching/spreadsheet and /switching/eve signed out, light and dark, phone and desktop.
Expect the switching-* visual captures to move — say why in the PR. Delete
docs/product/follow-ups/FU-20260815-the-switching-import-phase-dead-ends-a-signed-out-reader.md as
part of the change.
```
