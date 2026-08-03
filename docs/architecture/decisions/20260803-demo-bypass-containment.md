# 20260803-demo-bypass-containment — The demo sign-in bypass is a separate module with three required conditions

- **Status:** Accepted
- **Date:** 2026-08-03

Refines [20260724-per-visitor-demo-shops](20260724-per-visitor-demo-shops.md), which introduced the
bypass this ADR contains. Closes lens finding ARCH-8 in
[comprehensive-review-20260802](../../product/assessments/comprehensive-review-20260802.md).

## Context

`verifyCredentials` — the one chokepoint every credentials sign-in passes through — carried the demo
bypass inline:

```ts
if (shop.isDemo && password === DEMO_BYPASS_PASSWORD) ok = true;
```

Three things were wrong with that shape, none of them an exploitable defect today, all of them the
kind of thing that becomes one later.

1. **A single database column was the whole gate.** `shops.is_demo` is an ordinary boolean on an
   ordinary row. Anything that could set it — a bad migration, a CSV import bug, a future "convert
   this tenant to a sandbox" admin toggle, an operator with SQL access — would simultaneously turn
   the string `password` into a working credential for every staff account in that tenant. The
   feature's blast radius was not bounded by anything the feature itself controls.
2. **It was in the production verifier.** The branch sat between the bcrypt compare and the role
   check, so every future edit to the verifier had to reason about it, and a refactor that lost the
   `shop.isDemo` conjunct would have made the bypass universal with no test naming the loss.
3. **There was no way to turn it off.** A deployment that must never have a demo tenant (a
   self-hosted install, a compliance-scoped environment) had no switch.

The obvious hardening — "never in a production build" — is wrong here, and worth saying out loud
because it is the first thing a reviewer reaches for. Per-visitor demo shops *are* a production
feature: `/` 's "Try the live demo" mints a throwaway `isDemo` shop on the live site and signs the
visitor into its generated owner precisely so that no generated password has to be stored or
transmitted. Compiling the bypass out of production deletes that funnel.

The related timing finding (the missing-account short-circuit returning before the bcrypt compare)
and the bcrypt-cost magic number are fixed in the same change but need no decision record — they are
a constant-work compare and a named constant respectively.

## Decision

- **The bypass moves out of `src/lib/credentials.ts` into `src/lib/demo-bypass.ts`.** That module is
  the whole decision: the password constant, the environment gate, and one predicate,
  `demoBypassAccepted(candidate, env)`. `verifyCredentials` imports the predicate and never spells
  the rule out itself. `credentials.ts` re-exports `DEMO_BYPASS_PASSWORD` for the surfaces that
  *display* it; new importers take it from `demo-bypass.ts`.
- **Three independent conditions, all required.** No single misconfiguration is sufficient:
  1. **A recognized runtime and no kill switch.** `NODE_ENV` must be one of
     `development`/`test`/`production`; unset, empty, or anything else fails closed. A new optional
     `DIVEDAY_DEMO_BYPASS` variable disables the bypass when set to `off`; when it is *set* only the
     literal `on` re-enables it, so a typo (`0`, `false`, `disabled`) reads as off rather than as
     consent. Unset means the default in 20260724 — enabled.
  2. **`shops.is_demo`** — the original condition, retained.
  3. **The account's email sits in the reserved demo namespace** (`demo.invalid` or any subdomain of
     it, `isDemoAccountEmail` in `src/lib/demo-identity.ts`). This is the condition that bounds the
     blast radius: every demo account's address is generated in that namespace, and RFC 2606
     guarantees `.invalid` never resolves — so no *real* shop can be in it, because onboarding and
     staff invites both mail the address they are given and an account there would never receive its
     verification link. Flipping `is_demo` on a real tenant now grants nothing.
- **The environment gate takes its environment as a parameter**, typed as a plain string map rather
  than `NodeJS.ProcessEnv`. Next's ambient types narrow `NODE_ENV` to three literals and mark it
  required; a fail-closed guard must not trust a build-time narrowing it cannot enforce at runtime.
- **The demo namespace has one definition.** `DEMO_EMAIL_DOMAIN` lives next to the generator that
  mints the addresses (`generateDemoShopIdentity`), so the guard and the minting path cannot drift.

## Alternatives considered

- **Compile the bypass out of production builds** (a `process.env.NODE_ENV !== "production"` guard,
  or a module the production entry point does not import). Cleanest-looking, and wrong: it deletes
  the live-demo funnel that 20260724 built the whole per-visitor design around. Rejected.
- **Make `DIVEDAY_DEMO_BYPASS` required, failing closed when unset.** Strictly stronger, but it
  breaks zero-setup `pnpm dev` and the e2e fleet — every seeded staff account stores a random UUID
  hash and signs in *only* through the bypass — and it moves a security property into a variable
  every deployment must remember to set. The email-namespace condition already gives the containment
  a required variable was meant to give, without the footgun. Rejected; revisit if a deployment ever
  legitimately needs the bypass gone by default.
- **Bind the bypass to the minting session** (a cookie or nonce set when the demo is created, so
  only the minting visitor can sign in). This is the right answer *if demos ever hold private data*,
  and 20260724 already names it as that trigger. It is not this change: minted demos are deliberately
  world-readable playgrounds, and role-switching from a shared link is a demo feature, not a leak.
  Deferred, unchanged.
- **A timing-safe compare on the password.** The value is printed in the demo banner for the visitor
  to read. There is nothing to leak. Rejected as cargo cult.

## Consequences

The bypass is now greppable, unit-testable without a database, and impossible to widen by accident:
each of the three conditions has a test that fails if it is dropped, including one that flips
`is_demo` on and moves the account to a routable address and asserts the bypass still refuses.
Operators gain `DIVEDAY_DEMO_BYPASS=off` as a documented kill switch (optional, like
`DEMO_SHOP_MAX_LIVE`; not in `.env.example` and not checked by `pnpm check:env`).

The new coupling to cost: **any future demo-minting path must generate its staff addresses under
`DEMO_EMAIL_DOMAIN`**, or sign-in for that demo silently stops working. `generateDemoShopIdentity`
is the only mint today and builds on the constant directly, and `DEV_STAFF_LOGINS` sits in the same
namespace, so both are covered — but a new seeding path that invents its own domain is the failure
mode to watch for. Revisit this ADR if demos ever need to live outside `.invalid` (a demo that must
receive real mail), which would remove condition (3)'s guarantee and require replacing it with the
session-binding alternative above.
