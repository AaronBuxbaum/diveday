# FU-20260815-refusal-landings-that-say-nothing — Close the three remaining places a staff refusal can land somewhere that renders no banner

- **Status:** Open
- **Raised:** 2026-08-15 — the `security-reviewer` pass on the `noticeUrl` + `requireShopSurface` change (`worktree-bridge-cse_017Xz6AACPW3YpfdzpyRX8E1`)
- **Kind:** risk
- **Effort:** M
- **Touches:** `src/app/shop/[shopSlug]/check-in/page.tsx`, `src/app/shop/[shopSlug]/check-in/walk-in/page.tsx`, `src/app/actions/seat-diver-surfaces.ts`, `src/db/check-in.ts`, `scripts/check-notice-codes.mjs`, `src/lib/session.ts`

## What I noticed

The 2026-08-15 change settled the notice vocabulary and added
`scripts/check-notice-codes.mjs` to keep it settled. A security review of that change found one
live instance of the bug it was built to prevent (a `notice === "walkin_trip_prerequisite"`
comparison left behind by the rename, which silently turned the counter's "which card is missing"
sentence back into the generic one — fixed, and the check now sees that shape). It also found
three *latent* ones the check still cannot see:

1. **A refusal code with no entry, that nothing currently emits.** `checkInBooking`'s reason union
   includes `already_checked_in` (`src/db/check-in.ts:152`) and `checkInAction` passes any reason
   straight through, but the queue's `noticeCopy` map (`check-in/page.tsx`) has no
   `already-checked-in` entry. Today the code path answers `not_bookable` instead, so it is
   unreachable — the day someone restores that return, the counter says nothing at all.
2. **A landing page that reads no notice.** `SEAT_SURFACES["walk-in"].refusedPath` falls back to
   `/shop/<slug>/check-in/walk-in` when there is no `tripId`
   (`src/app/actions/seat-diver-surfaces.ts`), and that page reads no `notice` param. A
   `walkin-invalid` that lands there is silent.
3. **Nothing stops a `try`/`catch` around `requireShopSurface`.** Next's `redirect()` and
   `notFound()` unwind by *throwing*, so a `catch` anywhere above one swallows it and the caller
   proceeds as though the refusal never happened. Every one of the ten current call sites is clean
   (I checked), and `src/lib/session.test.ts` pins that the helper itself always throws — but
   nothing pins that its callers let the throw through.

Each is the same shape: a refusal that renders nothing looks exactly like a dead link, and nothing
in CI goes red.

## Why it isn't already done

(1) and (2) are unreachable today, so fixing them means adding copy for a state no user can
currently reach — worth doing, but not worth doing blind. (1) in particular needs a real sentence
in both locales, and "this diver is already checked in" may want to be a *neutral* re-tap
confirmation rather than a refusal, which is a copy/tone call rather than a mechanical one.

(3) is a new `check:repo` rule, and the honest question is whether it earns a script. It would be
narrow (refuse `try` in a function that also calls `requireShopSurface`/`requireStaffSession`), and
narrow rules that fire rarely can be more noise than signal. It also overlaps a more general
problem — any Next `redirect()` inside a `try` is a bug — so the rule might want to be about
`redirect` rather than about these two helpers.

## Proposed change

- **(1)** Add `already-checked-in` to `noticeCopy` in `check-in/page.tsx` with a key in both
  locales' `staff/check-in` bundle, *or* narrow `CheckInRefusal` so the unreachable reason is not
  in the union. Prefer the second if `not_bookable` really is the permanent answer — a union
  member nothing returns is its own small lie.
- **(2)** Give `check-in/walk-in/page.tsx` a `notice` param and a small map covering
  `walkin-invalid`, mirroring the `[tripId]` page beside it.
- **(3)** Decide whether to add the rule. If yes, make it about `redirect()`/`notFound()` inside a
  `try` block generally, not about these two helpers specifically. If no, say so in the PR and
  close this bullet.

Do **not** widen `scripts/check-notice-codes.mjs` to try to catch (1) and (2) statically — it would
have to prove that every code a domain union can produce has a map entry on every page that might
receive it, which is a type-system job (an exhaustive `Record<Reason, …>`), not a grep's.

## Prompt

```text
Close the three remaining places a DiveDay staff refusal can land somewhere that renders no banner.

Read first: docs/product/follow-ups/FU-20260815-refusal-landings-that-say-nothing.md,
src/lib/staff-notices.ts (noticeUrl/noticeCode, added 2026-08-15), scripts/check-notice-codes.mjs,
src/app/shop/[shopSlug]/check-in/page.tsx (the `noticeCopy` map), src/db/check-in.ts around line
152, src/app/shop/[shopSlug]/check-in/walk-in/page.tsx, and src/app/actions/seat-diver-surfaces.ts
(the "walk-in" surface's refusedPath).

The constraint that makes this non-obvious: all three are currently UNREACHABLE, so no test goes
red and no screenshot changes. You are hardening against a future edit, which means the value is
entirely in choosing the right shape rather than in the diff being green. For the check-in one,
decide between adding copy and narrowing the union — a union member nothing returns is its own
small lie, and `not_bookable` may be the permanent answer.

Any new user-facing sentence lands in EVERY locale bundle in the same change (src/i18n/locales/
en-US and es-ES) or `pnpm check:locale` fails. Read src/i18n/locales/es-ES/README.md first.

The third bullet is a judgement call and "no, and here is why" is an acceptable answer, recorded in
the PR description.

Done when: `pnpm check` is green, and each of the three is either fixed or explicitly declined with
a reason. Run the check-in and add-diver e2e specs.

Delete docs/product/follow-ups/FU-20260815-refusal-landings-that-say-nothing.md as part of the
change.
```
