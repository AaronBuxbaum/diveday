# FU-20260813-token-page-header-adoption — Adopt TokenPageHeader on /ready, /recap, and /claim

- **Status:** Open
- **Raised:** 2026-08-13 — the waiver-page redesign (branch `claude/design-waiver-token-header`), which extracted the shared bearer-token page header into a component
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `src/components/TokenPageHeader.tsx`, `src/app/ready/[token]/page.tsx`, `src/app/recap/[token]/page.tsx`, `src/app/claim/[token]/page.tsx`

## What I noticed

The bearer-token pages share one header idiom, hand-duplicated byte-for-byte: an uppercase tracked
shop-name eyebrow (`text-sm font-medium tracking-widest text-primary uppercase`), an `h1`
(`mt-2 text-3xl font-semibold tracking-tight text-balance`), then muted meta lines. The waiver
redesign extracted it as `src/components/TokenPageHeader.tsx` (eyebrow accepts one line or two,
since `/ready` and `/claim` stack a purpose line over the shop's name; meta lines pass through as
children, unstyled) and adopted it on `/waivers/[token]` only. The other three copies still sit
inline in `src/app/ready/[token]/page.tsx` (~line 697), `src/app/recap/[token]/page.tsx` (~line
255), and `src/app/claim/[token]/page.tsx` (~line 115) — so a future tweak to the idiom (say, the
eyebrow size) has to be found and repeated three more times or the pages drift apart.

## Why it isn't already done

Parallel design sessions were redesigning `/ready` and `/recap` at the same moment this component
was created, on branches that could not see each other. Touching those pages from the waiver
branch was explicitly out of scope to avoid merge collisions; adoption has to happen after
everything lands.

## Proposed change

In each of the three pages, replace the inline `<header>` block with `<TokenPageHeader>`: eyebrow
gets the current eyebrow line(s) (for `/ready` pass
`[t("capability.readinessTitle"), detail.shop.name]`, for `/claim`
`[t("seatClaim.eyebrow"), data.shopName]`, for `/recap` `shop.name`), `title` gets the current `h1`
content, and the existing meta lines move inside as children unchanged. If a post-merge redesign
changed a page's header shape, fold that shape into the component only if it is still the shared
idiom — do not force a page that deliberately diverged back into it; drop that page from this
cleanup instead and say so in the PR. No copy changes, no new keys. Expect `waiver-active`-style
visual diffs of zero for pixel-identical markup; if a page's header markup differs after its own
redesign, its captures move for that reason, not this one.

## Prompt

```text
Read src/components/TokenPageHeader.tsx first — it is the extracted shared header for bearer-token
pages (eyebrow line(s), h1 title, meta children), already used by src/app/waivers/[token]/page.tsx.
Then open src/app/ready/[token]/page.tsx, src/app/recap/[token]/page.tsx, and
src/app/claim/[token]/page.tsx and replace each page's hand-rolled <header> (uppercase tracked
eyebrow p, h1, meta lines) with <TokenPageHeader>, keeping every rendered string and meta element
exactly as it is. /ready and /claim stack two eyebrow lines — pass them as an array. Constraint:
these pages may have been redesigned since this entry was written; if a page's header no longer
matches the shared idiom, leave that page alone and note it in the PR rather than reshaping it.
Done means: the idiom exists in one place plus per-page meta, pnpm check passes, and the visual
captures for ready/recap/claim/waiver show no unexplained pixel movement (run the visual spec
filtered to those captures and read the PNGs). Delete
docs/product/follow-ups/FU-20260813-token-page-header-adoption.md as part of the change.
```
