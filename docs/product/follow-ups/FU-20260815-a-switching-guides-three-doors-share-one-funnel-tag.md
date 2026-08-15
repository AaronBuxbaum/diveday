# FU-20260815-a-switching-guides-three-doors-share-one-funnel-tag — Split a guide's hero / hinge / close CTAs by position, like every other page's

- **Status:** Open
- **Raised:** 2026-08-15 — anchoring the homepage's spreadsheet link at `#columns` (branch `follow-ups/round-two`), acting on a `conversion-reviewer` pass
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/lib/funnel.ts`, `src/lib/funnel.test.ts`, `src/app/switching/_components/guide.tsx`, `src/app/switching/spreadsheet/page.tsx`, `src/app/switching/[competitor]/page.tsx`, `docs/product/marketing.md`

## What I noticed

`src/lib/funnel.ts` states the rule in its own header comment: *"A page that offers the same action
from more than one place splits its tag by position … otherwise a mid-page door added to answer
'one CTA at the bottom of ten sections' folds into the page total and can never be shown to have
earned its place."* `/product` and `/pricing` follow it (`product`/`product-mid`,
`pricing`/`pricing-close`).

Every switching guide breaks it. `GuideHero`, `MidCta` and `ClosingCta`
(`src/app/switching/_components/guide.tsx`) each take a `source`, and each page passes the **same
value** to all three — `"switching-spreadsheet"` on the spreadsheet guide, `guideSource(slug)` on
each incumbent one. So six pages' worth of hero, hinge and closing doors all land in one bucket per
guide, and no question about position can be asked of them.

That became load-bearing on 2026-08-15. The homepage's records-band link now lands a reader at
`#columns`, **below** the hero and the hinge CTA — so an entire inbound segment now skips the
mid-page door that exists precisely so a convinced reader need not scroll the rest of the page. The
next review that asks "did anchoring cost us the hinge CTA?" will re-open it with the same evidence
vacuum that put the anchor follow-up here in the first place.

## Why it isn't already done

Scope. The change that raised this was asked to tag the two *untagged* in-page switching doors on
`/product` and `/about`; re-cutting the tag vocabulary of six existing pages is a different and
larger decision about what the switching funnel measures, and it deserves to be made on purpose
rather than as a fourth thing in an anchor fix.

## Proposed change

`guideSource(slug)` grows a position, the way `trialHref`'s callers already name one:

```ts
guideSource(slug)              // "switching-eve"        — the hero, unchanged
guideSource(slug, "mid")       // "switching-eve-mid"
guideSource(slug, "close")     // "switching-eve-close"
```

The unsuffixed tag stays the hero's, so attribution history spans the change — the same rule
`product`/`product-mid` follows. `FunnelSource`'s `switching-${string}` template already admits the
suffixed forms, and `eventSource` needs the matching widening so an arriving `?from=` still
round-trips (its current check is `MIGRATION_GUIDE_SLUGS.some((slug) => value === guideSource(slug))`
— that will reject the new ones until it is widened, which is a test worth writing first).

`/switching/spreadsheet` is the one that is not slug-derived: it needs `switching-spreadsheet-mid`
and `switching-spreadsheet-close` added to `FIXED_SOURCES` beside the existing entry.

**Not** proposed: a fourth position, or retagging the hero. And not renaming `switching-hub` /
`switching-spreadsheet`, which are the *destinations* readers arrive at rather than doors out.

## Prompt

```text
Read src/lib/funnel.ts end to end (especially the header comment about splitting a tag by position
and about a retired tag never being reused), src/lib/funnel.test.ts, then
src/app/switching/_components/guide.tsx (GuideHero, MidCta, ClosingCta — each takes a `source`) and
its two callers, src/app/switching/spreadsheet/page.tsx and
src/app/switching/[competitor]/page.tsx.

Every switching guide passes ONE funnel tag to all three of its demo/trial doors, so the hinge CTA
and the closing CTA fold into the page's own bucket and neither can be shown to have earned its
place — the exact failure funnel.ts's header comment says the position split exists to prevent, and
which /product and /pricing already avoid. It matters now because the homepage's records-band link
lands readers at /switching/spreadsheet#columns, below the hero and below the hinge CTA, so a whole
inbound segment skips a door nobody can count.

Give guideSource a position argument — guideSource(slug) stays the hero's tag so history spans the
change, guideSource(slug, "mid") and guideSource(slug, "close") are new — and widen eventSource so
the suffixed forms still round-trip off a request (write that test first; it fails today). The
spreadsheet guide is not slug-derived, so add switching-spreadsheet-mid and
switching-spreadsheet-close to FIXED_SOURCES beside the existing entry. Then update the position
paragraph in docs/product/marketing.md to say the switching guides split their doors too.

Do NOT retag the hero, and do NOT touch switching-hub / switching-spreadsheet as destination tags.
A misspelled or reused tag is the failure that file exists to prevent — read it before naming one.

Done means: pnpm check green, pnpm test src/lib/funnel.test.ts --reporter=dot green with a case per
new tag, and pnpm e2e e2e/marketing.spec.ts --reporter=line green — that spec asserts
/onboard?from=switching-eve and /onboard?from=switching-spreadsheet on the HERO links, which must
still hold. Delete
docs/product/follow-ups/FU-20260815-a-switching-guides-three-doors-share-one-funnel-tag.md as part
of the change.
```
