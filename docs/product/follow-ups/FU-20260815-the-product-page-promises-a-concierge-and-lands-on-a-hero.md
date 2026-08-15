# FU-20260815-the-product-page-promises-a-concierge-and-lands-on-a-hero — Settle whether `/product`'s spreadsheet link keeps its second promise

- **Status:** Open
- **Raised:** 2026-08-15 — tagging `/product` and `/about`'s switching doors (branch `follow-ups/round-two`), acting on a `conversion-reviewer` pass
- **Kind:** question
- **Effort:** S
- **Touches:** `src/app/product/page.tsx`, `src/i18n/locales/en-US/diver.json`, `src/i18n/locales/es-ES/diver.json`, `src/components/SwitchingConcierge.tsx`, `src/lib/funnel.ts`, `docs/product/marketing.md`

## What I noticed

`/product`'s closing band links to the spreadsheet guide with
`marketing.product.spreadsheetLink` — *"On a spreadsheet today? Bring it across — we'll even do it
with you →"*. It makes two promises, and the guide answers them at opposite ends of itself:

- **"Bring it across"** — the column table, phase 1 of the move rail.
- **"we'll even do it with you"** — `SwitchingConcierge`, which renders **below the entire move
  rail**, after the column table, the scope table and the import steps. That is further from the
  top of the page than the column table the homepage's link was just anchored to reach.

So the same page now handles two doors onto the same guide by two different rules. The homepage's
door was anchored on 2026-08-15 (`#columns`, via `switchingHref`'s third argument) precisely
because a link that names something specific and lands two to three screens above it reads as bait.
This link names something even further down and was left alone in the same change — with nothing in
the code or the docs recording that the asymmetry is a decision rather than an oversight.

## Why it isn't already done

It needs a call I did not want to make silently, and the two answers point opposite ways.

The homepage reader has just looked at an import-preview mockup and is asking *"would it read
mine?"* — a table answers that. The `/product` reader is standing between a demo button and a trial
button in the page's closing band, and a ghost-weight third link there is a broad hand-off rather
than a specific one. Landing *that* reader on "email us" is a heavier ask than landing them on a
table, which argues for changing the words rather than the destination — and changing the words is
a copy edit in both locale bundles plus a conversion review, not a one-line `href`.

## Proposed change

Pick one, deliberately, and write the reason down:

**(a) Anchor it.** `SwitchingConcierge` has no `id` today; give the shared component one
(`id="concierge"`, with a `scroll-mt-*` the way `MovePhase` now carries one) and pass a third
argument to `switchingHref` at this call site. Keeps the copy, which is the more persuasive of the
two halves for a shop that is nervous about doing the move alone.

**(b) Reword the link** so it promises what the guide's top actually delivers, and let the
concierge be found by reading. This is my recommendation: unlike the homepage reader, this one has
two stronger doors in the same band, and the closing band is the wrong place to hand someone off to
an inbox. New copy lands in **both** `diver.json` bundles in the same change (read
`src/i18n/locales/es-ES/README.md` first) and goes past `conversion-reviewer`.

Either way, add a line to the funnel section of `docs/product/marketing.md` saying which in-page
switching doors carry a fragment and why, so the next reader does not have to re-derive it.

**Not** proposed: anchoring both halves, or splitting this into two links. One door per band.

## Prompt

```text
Read src/app/product/page.tsx's closing band (the Link built with switchingHref("/switching/
spreadsheet", "product-spreadsheet") and its label marketing.product.spreadsheetLink), then
src/app/switching/spreadsheet/page.tsx and src/components/SwitchingConcierge.tsx to see where on
that guide each half of the label's promise is answered, then the funnel section of
docs/product/marketing.md.

The label promises two things — "bring it across" (the column table, phase 1) and "we'll even do it
with you" (the concierge block, below the whole move rail). On 2026-08-15 the homepage's link to
the same guide was anchored at #columns because a specific promise landing screens above what it
names reads as bait; this link, which names something further down still, was left bare in the same
change. Settle it.

Two options, and (b) is the recommendation:
(a) give SwitchingConcierge an id and a scroll-mt, and pass it as switchingHref's third argument
    here.
(b) reword marketing.product.spreadsheetLink so it promises what the guide's top delivers. New copy
    goes in BOTH src/i18n/locales/en-US/diver.json and es-ES/diver.json in the same change — read
    src/i18n/locales/es-ES/README.md first — and through the conversion-reviewer agent.

Whichever you pick, record the reason in docs/product/marketing.md's funnel section so the
asymmetry between this door and the homepage's is legible.

Do NOT do both, and do NOT split this into two links: one door per band
(docs/product/marketing.md).

Done means: pnpm check green, pnpm check:locale green, pnpm e2e e2e/marketing.spec.ts
--reporter=line green (it asserts this link's href, so a fragment changes it — read the failure
rather than assuming it is unrelated), and the /product visual captures reviewed if the words
changed. Delete
docs/product/follow-ups/FU-20260815-the-product-page-promises-a-concierge-and-lands-on-a-hero.md as
part of the change.
```
