# FU-20260815-staff-route-and-action-preamble — Compose the staff page/action preamble once, and settle the notice-code vocabulary

- **Status:** Open
- **Raised:** 2026-08-15 — the app-wide consistency sweep on `worktree-bridge-cse_015vZRaiUc7FVWBrtgdhSeER`
- **Kind:** cleanup
- **Effort:** L
- **Touches:** `src/lib/session.ts`, `src/lib/staff-notices.ts`, `src/app/shop/[shopSlug]/orders/new/page.tsx`, `src/app/shop/[shopSlug]/staffing/actions.ts`, `src/app/shop/[shopSlug]/settings/actions.ts`

## What I noticed

The primitives are good and shared — `requireStaffSession` (154 call sites), `uuidParam`,
`revalidateAndRedirect` (163 call sites), `noticeFromParam` (26 files). What is missing is the layer
*above* them: nothing composes "resolve the shop, assert the tenant, check the live permission,
build the refusal redirect", so ~50 files hand-assemble it and the assembly has drifted.

**"Which shop am I on" has four spellings.** 45 pages use `getShopById(db, session.user.shopId)`;
two use `getShopBySlug` plus an explicit tenant assert (`check-in/page.tsx:98`); three call
`getShopById(await getDb(), …)` inline.

**"The shop row is missing" has five outcomes** for one condition: `notFound()` (12 sites),
`return null` — a blank page, no 404 (6 sites: `page.tsx:192`, `orders/page.tsx:140`,
`reports/page.tsx:107`, `waivers/page.tsx:48`, `waivers/signatures/page.tsx:164`,
`divers/page.tsx:86`), `redirect("/")` — which bounces a signed-in staffer out to marketing (5
settings routes), `redirect(\`/shop/${shopSlug}\`)` (2), and a `?notice=` redirect (5 actions).

**The notice vocabulary has forked.** There are 216 hand-built `` `…?notice=…` `` strings across 45
files (top: `trips/[id]/actions.ts` ×55, `settings/actions.ts` ×26), and three codes now exist in
both casings for one meaning:

| Meaning | snake_case | kebab-case |
| --- | --- | --- |
| not authorized | `settings/actions.ts:95` `not_authorized` | `staffing/actions.ts:28` `not-authorized` |
| stripe not connected | `orders/new/page.tsx:102` `payment_not_connected` | `orders/new/page.tsx:101` `payment-not-connected` |
| demo blocked | `orders/[id]/page.tsx:77` `demo_disabled` | `divers/[personId]/actions.ts:596` `demo-disabled` |

`orders/new/page.tsx:101-102` is the clearest: **one ternary emits two different casings of the same
concept on adjacent lines**, because the two destination pages' notice maps were written by
different hands. A staffer hitting the wrong branch gets a page with no banner at all.

Two sites also interpolate a value into the URL without encoding it (`check-in/actions.ts:49`,
`staffing/actions.ts:48`).

## Why it isn't already done

Scope, and sequencing. The sweep that raised this was a presentation-layer consolidation; this is a
change to how every staff route and server action is *structured*, and a wrapper that redirects on
refusal is exactly the kind of code that must not be introduced casually — an authz helper that
silently returns instead of redirecting is a tenant-isolation bug rather than a style regression.
It needs its own PR and a `security-reviewer` pass (AGENTS.md hard rule: authz changes get one).

The notice codemod is mechanical but touches 216 strings across 45 files, several of which other
sessions have open work in; landing it inside a large UI PR would guarantee conflicts.

## Proposed change

Two PRs, in order.

**1. `noticeUrl` + the code vocabulary.** Add to `src/lib/staff-notices.ts`:

```ts
export function noticeUrl(path: string, notice: string, extra?: Record<string, string | number>): string
export function shopPath(slug: string, ...segments: string[]): string
```

`noticeUrl` encodes the value (fixing the two raw interpolations) and merges `&bid=`/`&count=`/
`&form=` instead of string-concatenating them. Normalise the three forked codes to **kebab-case**
(the majority spelling in the newer surfaces) and add a `check:repo` rule asserting
`/^[a-z0-9-]+$/` on every literal after `notice=`, so the fork cannot reopen.

**2. `requireShopSurface`.** One helper performing `requireStaffSession()` → `getShopById(db,
session.user.shopId)` → `if (shop.slug !== shopSlug) notFound()` → optional live gate → refusal
redirect. Settle the missing-shop outcome on `notFound()`; the `return null` and `redirect("/")`
spellings are both worse (a blank 200, and ejecting a signed-in staffer to marketing).

Do **not** fold the server-action preamble (`staffAction`) into either PR — that is a third, larger
step and it composes these two. Do **not** start with it.

## Prompt

```text
Give DiveDay one way to build a staff `?notice=` redirect, and settle the notice-code vocabulary.

Read first: src/lib/staff-notices.ts, src/lib/navigation.ts (revalidateAndRedirect),
src/app/shop/[shopSlug]/orders/new/page.tsx around lines 95-105, and
docs/product/follow-ups/FU-20260815-staff-route-and-action-preamble.md.

The constraint that makes this non-obvious: `staff-notices.ts` today owns only the READ side
(noticeFromParam/noticeForForm/noticeRole). The write side is 216 hand-built template strings across
45 files, and the code vocabulary has forked into snake_case and kebab-case for three separate
meanings. orders/new/page.tsx:101-102 emits BOTH casings of one concept on adjacent lines, so one
branch lands on a page whose notice map has no entry and renders no banner at all.

Do: add `noticeUrl(path, notice, extra?)` and `shopPath(slug, ...segments)` to staff-notices.ts.
noticeUrl must encodeURIComponent the value — check-in/actions.ts:49 and staffing/actions.ts:48
interpolate a raw reason today. Migrate the 216 call sites. Normalise not_authorized /
payment_not_connected / demo_disabled to kebab-case, updating BOTH the emitters and the destination
pages' notice maps — a missed map entry is a silent blank banner, so grep each code's readers.
Add a check:repo rule asserting /^[a-z0-9-]+$/ on every literal after `notice=`.

Do NOT also build the requireShopSurface route helper or a staffAction wrapper in this PR; they are
separate follow-ups that build on this one.

Done when: `pnpm check` is green, every notice code matches the new rule, and you have grepped each
renamed code to confirm its destination page resolves it. Run the e2e specs covering settings,
staffing and orders, since those are the surfaces whose refusal paths change.

Delete docs/product/follow-ups/FU-20260815-staff-route-and-action-preamble.md as part of the change.
```
