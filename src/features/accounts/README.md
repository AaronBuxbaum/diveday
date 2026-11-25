# accounts

Who is signed in, for which shop, and what they may do there: staff accounts, sessions, roles,
step-up and passkeys.

## Owns

- Sessions: `session.ts` (the live staff session and `requireShopSurface`), `session-activity.ts`,
  `account-session-device.ts`.
- Staff and roles: `staff-accounts.ts`, `shop-roles.ts`.
- Proof of presence: `step-up.ts`, `security-step-up.ts`, `passkeys.ts`, `email-sign-in.ts`.
- Diver sign-in (ADR 20261125-diver-sign-in): `diver-sign-in.ts` (the emailed link, the
  `diveday_diver` cookie scoped to one shop's `/s/<slug>` pages, and who it names) and
  `diver-profile.ts` (My profile's read and the diver's own contact edit). The rows are
  `src/db/diver-sign-in.ts`, two `capabilities` purposes.

## Does not own

The permission predicates (`src/db/authz.ts`), the edge proxy (`src/proxy.ts`) and the sign-in
pages in `src/app`. A diver's bearer links belong to the area that issues them.

## Invariants

- The edge proxy stays DB-free (cookie-cache reads only); actions and queries authorize on their
  own, whatever the route gate did; dev credentials never become production behavior.
- `requireStaffSession` re-reads the account live, and every path an action lands on is built
  from the session's own shop.
- `passkeys.ts` decides only whether the browser can offer the optional passkey action; it never
  infers that the device holds a credential. Verification, origin and relying-party binding stay
  in the authentication substrate.
- A diver session reads only its own person's rows in its own shop and is never a staff session:
  its cookie never rides `/shop/**`, and every read re-checks the person is still live there.
  A diver sign-in request answers the same whether or not the address is on file.
- `email-sign-in.ts` sends only to the account's current verified address, builds the link from
  the canonical origin, and takes its provider as a seam so tests never contact an email service.
