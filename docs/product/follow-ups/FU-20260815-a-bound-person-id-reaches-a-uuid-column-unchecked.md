# FU-20260815-a-bound-person-id-reaches-a-uuid-column-unchecked — Narrow `personId` where a diver-record action binds it, the way `certificationId` now is

- **Status:** Open
- **Raised:** 2026-08-15 — while closing
  FU-20260815-a-refused-card-number-tells-the-staffer-to-do-what-they-just-did, which named the same
  bug class for `certificationId` and stopped there.
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/divers/[personId]/actions.ts`,
  `src/app/shop/[shopSlug]/divers/[personId]/card-sighting.action.test.ts`,
  `src/lib/uuid.ts`

## What I noticed

`certificationId` on the diver record is now parsed with `uuidParam()` in the five actions that put
it into `eq(certifications.id, …)` — Postgres does not coerce a malformed uuid literal, it raises,
so an unparseable id was a **500** where each action's own `?notice=invalid` belongs one line later.

`personId` on the same page has the identical shape and is not narrowed anywhere. It reaches every
one of those actions as a **bound server-action argument** (`action.bind(null, shopSlug, personId)`)
rather than a form field, and lands in `updateDiver`, `getDiverProfile`, `anonymizeDiver`,
`saveRentalFit`, `recordInPersonWaiver`, `clearNoCertificationDeclaration` and the rest, all of
which compare it against `people.id`. The page itself guards its route segment (`uuidParam(personId)`
then `notFound()`, `page.tsx`), so the ordinary path is safe; what is unguarded is a replayed or
hand-built action POST carrying a different bound argument.

Concretely: a signed-in staffer who edits the bound argument to `not-a-uuid` gets a stack trace and a
500 from a save, an erase or a card action, instead of the refusal every one of those actions already
knows how to give. Tenant isolation is unaffected — every query is `shopId`-narrowed either way — so
this is a robustness and error-quality bug, not an access-control one. The same is true of `orderId`
in `refundPaymentAction`.

**A second gap lives in the same three lines, and it is not a robustness one.** Every card action on
this page now re-reads live roles before it writes (`isLiveStaff`, added 2026-08-15 after a
`security-reviewer` pass), and so do the fit, refund, delete, restore and erase actions. Two do not:
`savePersonAction` and `markWaiverInPersonAction` still trust the JWT alone, so an account since
demoted, removed or disabled can rewrite a diver's contact details or record a paper waiver against
them until its token expires. Recording a release is the one of those that ends up in an incident
file. Both belong in whatever shared preamble this follow-up produces.

## Why it isn't already done

The follow-up that raised the `certificationId` half named five specific actions, and widening to
`personId` means touching roughly fifteen more in a file two other sessions were editing at the same
time. It also deserves one decision rather than fifteen: `personId` is the *subject* of the whole
route, so the honest fix is probably a single guard at the top of each action (or a small shared
`diverActionContext(shopSlug, personId)` helper that both resolves the session and narrows the id),
not a `uuidParam()` sprinkled per call site. That is a shape question worth answering once.

## Proposed change

Add one narrowing step for the route's own subject, and use it everywhere on this page:

1. A small helper beside `backTo` in that file — `requireDiverActionContext(shopSlug, personId)` —
   that calls `requireStaffSession()`, narrows `personId` with `uuidParam()` (redirecting to the
   diver roster, or `notFound()`, when it does not parse) and runs the existing `isLiveStaff` check.
   Every action's first two lines collapse into it, which is also what stops the next action added
   here from shipping without either guard.
2. `orderId` in `refundPaymentAction` gets the same `uuidParam()` treatment `certificationId` has.
3. `savePersonAction` and `markWaiverInPersonAction` pick up the liveness check through that helper.
4. Tests in `card-sighting.action.test.ts` (or a sibling) proving a malformed `personId` refuses
   rather than raising, mirroring the "a card id that is not a uuid" block already there, and that a
   revoked account cannot record a paper waiver.

**Not** proposed: extending `scripts/check-uuid-segments.mjs` to server actions. That script reads
route segments out of the filesystem; a bound argument is not visible to it, and a grep-level rule
over `.bind(` would fire on every action in the repo.

## Prompt

```text
On the diver record, `certificationId` is narrowed with `uuidParam()` before it reaches a uuid
column, but `personId` — the subject of the whole route — is not, in any of that file's ~15 server
actions. Postgres raises on a malformed uuid literal rather than matching zero rows, so a replayed
or hand-built action POST with a junk bound argument is a 500 where the action's own refusal
belongs. Tenant isolation is unaffected (every query is shopId-narrowed); the failure is that a
staff surface answers a bad id with a stack trace.

Read first:
  - docs/product/follow-ups/FU-20260815-a-bound-person-id-reaches-a-uuid-column-unchecked.md (this file)
  - src/app/shop/[shopSlug]/divers/[personId]/actions.ts — `cardIdFromForm`, `backTo`, and the
    `requireStaffSession()` line every action opens with
  - src/lib/uuid.ts — why `uuidParam()` exists and what a *required* id pairs it with
  - src/app/shop/[shopSlug]/divers/[personId]/page.tsx — how the route segment itself is guarded
  - src/app/shop/[shopSlug]/divers/[personId]/card-sighting.action.test.ts — the "a card id that is
    not a uuid" block, which is the test shape to mirror

There is a second gap in the same three lines and it is not a robustness one: every card action on
this page re-reads live roles before it writes (`isLiveStaff`), and so do fit, refund, delete,
restore and erase — but `savePersonAction` and `markWaiverInPersonAction` still trust the JWT alone,
so a demoted, removed or disabled account can rewrite a diver's contact details or record a paper
waiver against them until its token expires.

The work: one shared preamble for both — a `requireDiverActionContext(shopSlug, personId)` that
resolves the staff session, narrows the id and runs `isLiveStaff`, which reads better than fifteen
`uuidParam()` calls and is what stops the next action added here from shipping without either guard.
Plus the same `uuidParam()` treatment for `orderId` in `refundPaymentAction`, and tests proving a
malformed id refuses rather than raising and that a revoked account cannot record a paper waiver.

Constraints that make this non-obvious:
  - Do not weaken any existing gate while collapsing the preamble — several actions re-read live
    roles from the database on purpose (`loadActiveStaffRoles`), and a stale JWT is exactly what
    those re-reads exist to survive.
  - Pick one refusal for an unparseable subject and use it everywhere: an id that names no row is a
    404, not an `?notice=invalid` on a page that cannot render.
  - Two other sessions have edited this file recently — check `git log` and open PRs before starting.

Done when: pnpm check is green, a malformed personId on a diver-record action refuses instead of
raising, and docs/product/follow-ups/FU-20260815-a-bound-person-id-reaches-a-uuid-column-unchecked.md
is deleted as part of the change.
```
