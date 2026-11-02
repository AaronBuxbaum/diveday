# server-action

The one way a staff mutation is written (issue #2763): `defineAction` turns a declaration — the
live gates it needs, the form schema it reads, and a `run` that answers with a `land(…)` — into
the server action. The pipeline is the only code in the action that reads the session, asks a
gate, revalidates or redirects; a notice code is spelled once, at the `land(…)` that produces it,
and the codes an action can land with are its type (`NoticeOf<typeof action>`), so a page's notice
map typed with it fails to compile when a code has no words.

Module shape: [20260730-feature-module-contracts](../../../docs/architecture/decisions/20260730-feature-module-contracts.md).
A feature module rather than `src/lib`, because the pipeline opens the database connection the
gates ask on, and `src/lib` takes only types from `src/db` (`pnpm check:architecture`).

## Owns

- `defineAction`, `land`, `arrive` and `actionContext` (the first half of the pipeline, for an
  action that answers inline rather than by landing).
- The order a declared action runs in: session, then every gate, then the form, then `run`, then
  one revalidate-and-redirect. Every refusal throws; nothing after it runs.
- `KebabCode`, which makes a notice code's one spelling a compile-time check at `land(…)`.

## Does not own

- The session and the tenant (`src/lib/session.ts`): `requireStaffSession` re-reads the account
  live; every path a declared action lands on is built from the session's own shop.
- The permission predicates (`src/db/authz.ts`) and each area's gates
  (`src/app/shop/[shopSlug]/settings/action-gates.ts`).
- The words: each page's notice map, typed with `NoticeOf`.

## Public surface

`./index.ts`. Deep imports are a `pnpm check:architecture` failure.

## May import

`@/lib/**`, `@/db/**` and `next/*`. Never `@/app/**`.
