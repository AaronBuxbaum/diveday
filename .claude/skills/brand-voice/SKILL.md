---
name: brand-voice
description: Create or review DiveDay brand, voice, visual, merch, vendor, or promotional collateral, and any run of user-facing prose, so it stays consistent with the current identity and claims policy and carries none of the tells that mark copy as machine-written.
---

# Brand and voice

Use this skill for brand guidelines, copy standards, vendor briefs, merch purchasing guidance,
physical collateral, campaign concepts, or any request that asks what DiveDay should look or sound
like. The canonical identity is [docs/design/brand.md](../../../docs/design/brand.md); this skill is
the workflow for applying it.

## Before writing

1. Run `pnpm task:context brand-voice`.
2. Read `docs/design/brand.md` end to end.
3. Read `docs/design/principles.md` and `docs/product/vision.md` for the underlying experience.
4. For public or sales copy, read `docs/product/marketing.md` and apply its claims policy.
5. If the request concerns the implemented visual system, inspect the current source anchors:
   `src/app/globals.css`, `src/app/layout.tsx`, and `src/components/Logo.tsx`.

## Procedure

1. Classify the artifact: product copy, public marketing, internal collateral, merch, or a proposed
   campaign. Apply the strictest relevant claims and safety rules.
2. Reuse the current identity. Do not invent a new color, font, logo treatment, or personality
   trait merely to make one item feel distinctive. Creativity lives in composition, not in new
   ingredients (`docs/design/principles.md` §11): within the fixed palette, type, and mark, a
   piece may — and for a significant piece should — get a bespoke layout shaped by its content,
   judged by whether it makes the piece clearer and more instinctive, never by novelty alone.
3. Make the outcome concrete. The default voice is a competent divemaster: warm, plain, brief,
   and exact when safety or money is involved.
4. Read every sentence against "What gives us away" in `docs/design/brand.md` before it ships. A
   divemaster says the thing; they do not set it up, pivot to it with a dash, contrast it with what
   it is not, or tell you it is true. No em-dash in prose, no "not a project, a file", no
   "No X. No Y. No Z.", no *actually*/*genuinely*/*plainly*, no "Here's how", no aphorism or
   rhetorical question as a heading, no closing flourish. `pnpm check:voice` refuses the mechanical
   half in every message bundle; the rest is this step.
5. For merch or vendor work, provide the ground color, imprint colors, type treatment, placement,
   production constraints, and proof checklist. Keep coral as a small accent and use the bubble
   trail without stretching, rotating, or decorating it.
6. Separate current facts from proposals. Any new slogan, font, logo variant, palette change, or
   campaign claim must be labeled proposed and require product-owner approval before purchase or
   publication.
7. Keep implementation language out of user-facing copy. Translate machinery into the human
   outcome; use the product glossary for dive terms.
8. Update `docs/design/brand.md` when the approved identity changes. Do not hide brand decisions in
   a one-off vendor note or chat transcript.

## Review checklist

- [ ] Name is spelled `DiveDay`.
- [ ] Voice is calm, capable, warm, plain, and not mascot-like.
- [ ] Copy leads with a concrete outcome and uses verbs for actions.
- [ ] No prose em-dash, staccato run, "not X, Y" contrast, intensifier, lead-in, aphorism heading,
      rhetorical-question heading, or closing flourish (`docs/design/brand.md`, "What gives us away").
- [ ] Read aloud, it sounds like one person briefing a crew, not a landing page.
- [ ] No fabricated proof, unsupported superlatives, or unapproved commercial claims.
- [ ] Colors match the current palette; coral is restrained.
- [ ] Geist Sans is the default type direction; Geist Mono is utility-only.
- [ ] Bubble-trail mark keeps its proportions, ascent, and coral top bubble.
- [ ] Feedback colors are not used as decorative brand colors.
- [ ] Physical goods have been checked on the actual material and in daylight.
- [ ] Proposed changes are clearly labeled and routed for product-owner approval.

## Validation

For documentation-only work, run:

```bash
pnpm check:docs
pnpm check:agents
pnpm check:voice
```

If code or public pages changed, also follow the relevant `design-review`, `marketing-page`, or
`verify` skill. This skill never authorizes purchasing merch, sending collateral, or publishing a
campaign on the founder's behalf.
