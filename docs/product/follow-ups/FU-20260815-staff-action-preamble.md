# FU-20260815-staff-action-preamble — Decide whether the *server action* preamble wants a `staffAction` wrapper too

- **Status:** Open
- **Raised:** 2026-08-15 — the third step deliberately left out of the `noticeUrl` + `requireShopSurface` change on `worktree-bridge-cse_017Xz6AACPW3YpfdzpyRX8E1`
- **Kind:** question
- **Effort:** L
- **Touches:** `src/lib/session.ts`, `src/app/shop/[shopSlug]/settings/actions.ts`, `src/app/shop/[shopSlug]/promos/actions.ts`, `src/app/shop/[shopSlug]/settings/team/actions.ts`, `src/app/shop/[shopSlug]/trips/[id]/actions.ts`

## What I noticed

`requireShopSurface` (`src/lib/session.ts`) now composes the *page* preamble: session, shop row,
tenant assert, live permission gate, refusal redirect. Server actions run four of those same five
steps and are not on it. `requireStaffSession` still has 206 call sites under `src/app`, 18 of them
`actions.ts` files, and each of those re-derives its own path and gate by hand:

```ts
// settings/actions.ts
async function settingsGate(session) {
  const allowed = await canPersonManageShopSettings(db, session.user.shopId, session.user.personId);
  return allowed ? null : noticeUrl(shopPath(session.user.shopSlug), "not-authorized");
}
// promos/actions.ts
if (!allowed) revalidateAndRedirect(promos, noticeUrl(promos, "not-authorized"));
// staffing/actions.ts
if (!allowed) redirect(noticeUrl(shopPath(session.user.shopSlug, "staffing"), "not-authorized"));
```

Three shapes for one sentence: a gate that *returns a redirect target* the caller must remember to
use, a gate that redirects with revalidation, and a gate that redirects without. The first is the
one worth staring at — `settingsGate` hands back a string, and nothing makes a caller act on it.

The pages are now consistent; the actions are not, and the actions are where the write happens.

## Why it isn't already done

Deliberately scoped out, twice. The original follow-up (FU-20260815-staff-route-and-action-preamble)
called it "a third, larger step" that composes the other two, and the session that did those two was
told explicitly not to build it. That instruction was right: an action wrapper is a different shape
from a page helper, and it is not obvious it should exist at all.

The honest uncertainty is whether a `staffAction` wrapper is *better* than what is there now, rather
than merely more uniform. A server action is already an exported async function; wrapping it means
either a higher-order function (which obscures the `"use server"` export boundary and the argument
shapes Next binds) or a first-line call that looks exactly like `requireShopSurface` and saves two
lines. The second is cheap and probably right; the first is a real architectural change and needs a
human's call, which is why this is filed as a **question** rather than a cleanup.

## Proposed change

Decide between three, in increasing order of ambition:

1. **Nothing.** Actions keep `requireStaffSession()` plus an explicit gate line. The gate is visible
   at the top of every action, which is arguably the point on a write path. Close this entry.
2. **Reuse `requireShopSurface` in actions that already have a slug** (most take `shopSlug` as their
   first argument, or read `session.user.shopSlug`). Mechanical, no new abstraction, and it deletes
   the `settingsGate`-returns-a-string shape. This is the recommendation.
3. **A `staffAction` higher-order wrapper.** Only if (2) leaves a repeated shape worth naming. State
   in the ADR why the `"use server"` export boundary survives it.

Whatever is chosen, the `settingsGate`/`teamGate` "returns a redirect target" shape should go: a
gate whose refusal is a *value* is one forgotten `if` away from not being a gate. That much is not a
question.

## Prompt

```text
Decide whether DiveDay's staff *server actions* should share the page preamble helper, and act on
the decision.

Read first: src/lib/session.ts (`requireShopSurface`, added 2026-08-15), src/lib/staff-notices.ts
(`noticeUrl`/`shopPath`), src/app/shop/[shopSlug]/settings/actions.ts around lines 88-120,
src/app/shop/[shopSlug]/promos/actions.ts around line 51, src/app/shop/[shopSlug]/staffing/actions.ts
around line 29, and docs/product/follow-ups/FU-20260815-staff-action-preamble.md.

The constraint that makes this non-obvious: `requireShopSurface` is a *page* helper — it resolves a
route param, and every refusal throws to unwind a render. A server action has no route params, is
bound by Next through a `"use server"` export, and often wants `revalidateAndRedirect` rather than a
bare `redirect`. So this is not a copy of the page migration; the question is whether the same
helper genuinely fits, and the answer may be "no, and here is the smaller fix instead".

The shape that is definitely wrong either way: `settingsGate` (settings/actions.ts) and the team
equivalent RETURN a redirect target string instead of redirecting. Nothing makes a caller use it —
one forgotten `if` and the gate is not a gate. Fix that regardless of what you decide about the
wrapper, and add a test that pins the refusal path throwing rather than returning (see
src/lib/session.test.ts for how requireShopSurface pins exactly this).

This is authz-touching: AGENTS.md requires a `security-reviewer` pass on the finished diff.

Done when: `pnpm check` is green, the decision is written down (an ADR if you build a wrapper, this
entry's deletion plus a line in the PR description if you don't), and the refusal-returns-a-value
shape is gone. Run the *.authz.test.ts suites under src/app/shop, and the e2e specs for settings,
staffing and promos.

Delete docs/product/follow-ups/FU-20260815-staff-action-preamble.md as part of the change.
```
