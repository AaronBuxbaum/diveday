# FU-20260811-desktop-shop-name-clamp — Decide whether the shop name's 10rem clamp still earns its place on desktop

- **Status:** Open
- **Raised:** 2026-08-11 — the mobile title-width change (branch `claude/mobile-title-sizing-nhk0lt`)
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/components/ShopIdentityMenu.tsx`, `src/components/ShopNav.tsx`, `src/components/ShopNavLinks.tsx`, `e2e/staff-nav.spec.ts`

## What I noticed

The staff header's shop name lost its fixed 10rem clamp below `lg` — it now takes the width the
phone dock freed and truncates only when the row genuinely runs out. From `lg` up the clamp is
still there (`lg:max-w-40` in `ShopIdentityMenu.tsx`), and at 1280px it is measurably early: a
shop called "Coral Coast Divers & Watersports" renders as "Coral Coast Divers &…" with the tab
strip ending around x=790 and the search block not starting until x=1031 — roughly 240px of unused
header beside a name that was cut at 160px.

## Why it isn't already done

The ask was the phone, and desktop is the one width where the name competes with something real:
the five nav tabs share that row (`ShopNavLinks`, `lg:flex-1`). Letting the name flex there is a
different judgement — how much of the tab strip's slack a long name may take before the tabs start
shrinking — and getting it wrong squeezes navigation to flatter a label. Keeping `lg` byte-identical
also kept this change's visual diff empty, which is worth something on its own.

## Proposed change

Measure first: at 1024px and 1280px, with the longest plausible shop name, find how much slack the
tab strip actually has before its labels wrap or clip. If there is real slack, replace `lg:max-w-40`
with a bound that leaves the tabs their measured minimum — a `lg:max-w-64`-style step, or letting
the identity block flex with a `lg:min-w-0` and giving `ShopNavLinks` `lg:shrink-0`, whichever keeps
the tabs whole. If the tabs turn out to have no slack at 1024, close this by writing that finding
into the comment in `ShopIdentityMenu.tsx` so the next reader doesn't re-measure it. Not proposing
that the name wrap to two lines or that the tab strip scroll horizontally — both cost more than a
longer label is worth.

## Prompt

```text
Read src/components/ShopIdentityMenu.tsx (the `lg:max-w-40` on the shop-name span and the comment
above it), src/components/ShopNav.tsx (the header row), and src/components/ShopNavLinks.tsx (the
tab strip, `lg:flex-1`). Below `lg` the name already flexes; this is about `lg` and up only.

With `pnpm dev` running, drive a browser at 1024px and 1280px against /shop/blue-mantis, override
the name span's textContent with a long name ("Coral Coast Divers & Watersports"), and measure how
much the tab strip can give up before its labels wrap or clip — the tabs are the constraint, the
name is not. If there is slack, loosen the clamp by that much and no more; if there isn't, delete
this file and record the measurement in the comment in ShopIdentityMenu.tsx instead. Either way the
five tabs must stay on one line with full labels at 1024px, and the phone behaviour must not move.

Done when: the staff-nav e2e spec passes (pnpm e2e:run staff-nav.spec.ts --reporter=line), pnpm
check is green, and light+dark screenshots at 1024px and 1280px are in the PR with an explanation
for any visual diff. Delete docs/product/follow-ups/FU-20260811-desktop-shop-name-clamp.md as part
of the change.
```
