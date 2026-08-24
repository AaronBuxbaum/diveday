# 20260824-staff-session-live-revalidation — A disabled staff account loses every surface on its next request, not its next sign-in

- **Status:** Accepted — extends [0006-auth](0006-auth.md), narrowing one of its accepted
  consequences
- **Date:** 2026-08-24

## Context

[0006-auth](0006-auth.md) chose stateless JWT sessions with no session table, and accepted this
consequence explicitly: "JWT sessions mean role changes take effect on next sign-in, not
instantly — fine at dive-shop scale; revisit with a session table if instant revocation ever
matters."

Issue #701 asked whether that gap is still fine, in light of what one staff session can do: refund
money on the shop's connected Stripe account, export every diver's name, phone, date of birth,
emergency contact and waiver history as CSV, and configure a weekly backup to a bucket it chooses.
The issue's own first instruction was to verify this before designing anything larger (TOTP,
step-up auth, a session list) — because if disabling an account does not actually end its access,
that is a more urgent, narrower problem than the second-factor question the rest of the issue asks.

It does not. `requireStaffSession()` (`src/lib/session.ts`) — "the four lines every staff page
opens with" — checked only `isStaff(session.user.roles)`, the roles cached in the JWT at sign-in.
Nothing re-read the account. `requireShopSurface`'s own doc comment already claimed the opposite
("a demoted or disabled staff member loses the surface immediately"), but that was only true for
the ~12 `canPerson*`-gated actions (`src/db/authz.ts`'s `loadActiveStaffRoles`, added for the
export/import/reports surfaces) — reached only when a page opted into `requireShopSurface`'s
`allow` parameter. 27+ ordinary staff pages did not: the diver roster, the schedule board, walk-in
booking, the departure log, gear, dive sites, orders, staffing. A disabled account's already-issued
JWT kept those working for up to 30 days (Auth.js's default `session.maxAge`, which this repo
leaves unset).

Several `src/db` writer doc-comments (`check-in.ts`, `buddy-pairs.ts`, `manifests.ts`,
`waivers.ts`) already say, in almost identical language, that `setStaffAccountStatus` "revokes
sign-in and leaves `person_roles` entirely intact" — which is true only of *future* sign-in
attempts (`src/lib/credentials.ts` refuses a non-active account at the Credentials provider). It
does not touch a session already issued, because there is no session row to revoke against; the
JWT itself is the only record.

## Decision

- **`requireStaffSession()` re-reads the account on every call**, not only the H-14 gates. A new
  `loadActiveStaffRolesByPerson(db, personId)` (`src/db/authz.ts`) — the person-scoped sibling of
  the existing shop-scoped `loadActiveStaffRoles` — answers "is this specific account still an
  active, undeleted staff member of whatever shop it belongs to, and what are its live roles."
  `requireStaffSession()` redirects to `/sign-in?session=ended` when it comes back null or
  no-longer-staff-shaped.
- **Deliberately person-scoped, not shop-scoped, at this call site.** `requireStaffSession()` runs
  *before* any shop has been resolved from the session's own claim — re-verifying that claim here
  would conflate "the account is gone" with "the token's `shopId` is stale" (the shop itself was
  deleted). The second question stays exactly where it already lived: `requireShopSurface`'s
  tenant assert, which 404s on it. `people.shop_id` is never reassigned once a person row exists,
  so scoping by `personId` alone is unambiguous.
- **The edge proxy's `authorized()` callback (`src/lib/auth.config.ts`) stops bouncing
  `?session=ended` away from `/sign-in`.** The edge has no database access by design (ADR-0006)
  and can only ever see the same stale, `isStaff`-shaped JWT claims this whole fix exists to
  stop trusting — so its existing "already signed in, skip the sign-in form" shortcut would
  otherwise redirect a just-forced-out request straight back to `/shop/<slug>`, which
  `requireStaffSession()` would immediately reject again: an infinite loop between the one layer
  that knows the account is stale and the one that structurally cannot.
- **No session table, still.** This is a live re-check on the request path, not a revocation list
  — a disabled account's JWT still decodes successfully and still carries its original claims; it
  simply no longer passes the one gate every `/shop/**` surface already funnels through. The
  0006-auth tradeoff (no session store, one fewer database write on every sign-in) is kept; only
  its "not instantly" half is narrowed to "one extra indexed read on every staff request."
- **Not addressed here:** enrolling a second factor, step-up prompts on money/export/backup
  surfaces, an explicit "sign out everywhere" action, or a visible session list. Those remain
  open on issue #701 — this ADR covers only the verification step the issue asked to be done
  first, because it turned out to be broken.

## Alternatives considered

- **A session table (database-backed sessions).** Would allow true revocation (delete the row) and
  a real session list for free. Rejected for this narrower fix as more than the gap requires —
  0006-auth's stated reason to avoid it (a customer/diver-account milestone that hasn't arrived,
  plus an extra write on every sign-in) still holds. Worth revisiting if issue #701's remaining
  "session list" acceptance criterion is built; noted there rather than decided here.
- **Shorten `session.maxAge`/`updateAge` instead.** Reduces the exposure window without removing
  it, and does nothing for the money/export/backup surfaces specifically — those need to close to
  zero, not to a shorter number of days. Live re-validation subsumes this; a maxAge change remains
  a cheap defense-in-depth addition but isn't a substitute.
- **Re-check only inside `requireShopSurface`, not `requireStaffSession`.** Would still leave any
  future caller of the bare `requireStaffSession()` (Server Actions and Route Handlers that never
  call `requireShopSurface`, e.g. several files under `src/app/actions/`) unprotected. Fixing the
  one function every caller already goes through closes the gap for all of them at once, matching
  how the function is already documented ("the four lines every staff page opens with").

## Consequences

- Every `/shop/**` page and page-level action pays one extra indexed database read
  (`loadActiveStaffRolesByPerson`) per request, on top of `requireShopSurface`'s own existing shop
  lookup. Acceptable at this product's scale (small dive shops, not high-QPS SaaS); revisit if it
  ever shows up in latency measurements.
- A disabled, deleted, or fully-demoted staff member is signed out of every `/shop/**` surface on
  their very next request, with a plain-language reason on the sign-in page
  (`account.signIn.sessionEnded`) — rather than continuing to work, silently, for up to 30 days.
- 0006-auth's accepted consequence "role changes take effect on next sign-in, not instantly" no
  longer describes account status or complete role removal — only a role *change that keeps the
  account staff-shaped* (e.g. captain → manager) still waits for the next sign-in, since
  `isStaff(session.user.roles)` is still checked against the cached JWT claim first, and the live
  re-check only asks "is this person still *any* kind of active staff member," not "does the JWT's
  specific role list still match." Narrowing that further is out of scope here and not asked for by
  issue #701.
