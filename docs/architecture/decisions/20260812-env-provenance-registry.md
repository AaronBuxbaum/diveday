# 20260812-env-provenance-registry — One registry says who produces each environment value, and nothing merges

- **Status:** Accepted
- **Date:** 2026-08-12
- **Supersedes:** nothing. Amends the environment-distribution half of
  20260805-cdk-minted-credentials.

## Context

DiveDay's configuration has three producers — the CDK stack (which mints IAM credentials and names
ARNs and ids), third-party consoles (Stripe, Neon, Meta, the read-only usage tokens), and a small
set of checked-in constants — and four destinations: the generated `.env.local` a dev run reads,
Vercel Production, GitHub Actions, and named AWS CLI profiles.

Until now none of that was written down in one place. The facts were spread across four files that
nothing kept in agreement:

| Fact | Where it lived |
| --- | --- |
| which keys exist | `.env.example` |
| which the stack produces | `envValues` in `infra/lib/infra-stack.ts` |
| which a local file may override | three hand-maintained `Set`s in `scripts/distribute-env.mjs` |
| which may legitimately be absent | seven hand-written skip cases in `scripts/check-env.mjs` |

`scripts/distribute-env.mjs` then **merged** the stack's document into whatever `.env.local` already
contained, letting the file win for any key outside its `stackManaged` set. That set named the SNS
*topic ARNs* the stack writes but not the IAM pairs minted beside them, so `PLACES_AWS_ACCESS_KEY_ID`
fell through: a value typed onto that line once was pinned, and every later `pnpm infra:deploy` read
the real credential out of Secrets Manager and discarded it, leaving a file that looked correct.

It did not stay local. `scripts/infra-deploy.mjs` rendered `.env.vercel` from the freshly merged
`.env.local` rather than from the secret, so the hand-typed key was carried into Vercel Production by
the import step and re-confirmed on every deploy. The deployed address type-ahead spent a week
answering every keystroke with `UnrecognizedClientException` — a 403 from a service whose credential
was sitting right there in the environment (#458, #460).

## Decision

**One registry, `config/env-registry.mjs`, states for every key who produces it, which destinations
carry it, and what being absent costs.** Everything else derives from it, and nothing merges.

- **Provenance is one of four values.** `stack` (the CDK mints or names it), `derived` (computed from
  `APP_SECRET_SEED` by HKDF), `manual` (no system can mint it — a human pastes it), `constant` (a
  non-secret identifier of this deployment, checked in).
- **`.env.manual` is the only file a human edits.** It holds exactly the `manual` keys. Blank is a
  supported state for all of them, and `pnpm check:env` prints what is unset and what each one
  switches off — the reasons that used to be skip cases in that script are now `absent:` rows.
- **`.env.local` is generated** from the stack's document plus `.env.manual`, and overwritten on
  every deploy. `.env.vercel` and `.env.github` are generated from the same two sources — never from
  another target file.
- **A stack-produced key in `.env.manual` is refused**, not ignored, by both the distributor and
  `pnpm check:env`. There is no local override for a minted credential: an IAM access key is not a
  preference, and a private copy is a stale copy waiting to happen. Refusing rather than dropping it
  matters because a silently discarded value is exactly what hid the original bug.
- **`.env.example` is generated** from the registry and committed, because the stack reads it at
  synth (`readEnvExample()`) to build the credentials secret and a self-hoster reads it to see what
  exists. `pnpm check:env` fails when the committed copy has drifted.

## Consequences

- The merge is gone, and with it the whole category. There is no precedence rule to reason about
  because two files cannot claim the same key: a test asserts no key is both `manual` and
  stack-produced.
- `.env.local` leaves the production path. A value on a workstation can no longer reach Vercel.
- Adding a variable is one edit. Forgetting to teach the distributor or the checker about it is no
  longer possible, which is the specific failure this replaces.
- **Editing `.env.local` no longer does anything durable** — the next deploy overwrites it. Anyone
  used to putting a Stripe key there must move it to `.env.manual`; `pnpm infra:deploy` performs that
  migration once, automatically, by lifting the manual values out of an existing `.env.local`.
- `pnpm check:env` stopped being a gate on a complete `.env.local` and became a report on
  `.env.manual`. That is a deliberate weakening: every manual value is legitimately absent (a local
  run has no Stripe account and no Neon database), so the old failure mode could only be sustained by
  the skip list that kept growing. What is fatal now are the two structural invariants —
  `.env.example` matches the registry, and `.env.manual` speaks only for manual keys.
- The registry is plain `.mjs`, not TypeScript, because all three consumers must import it: the
  `scripts/*.mjs` tooling runs under bare `node`, `infra/` is a separate CDK app with its own
  tsconfig, and `src/` is the Next application. Inference from the exported literal gives types
  without a second declaration to keep in sync.
- Not done here: the four `constant` values (`APP_HOST`, `SES_FROM_EMAIL`, `STRIPE_CONNECT_CLIENT_ID`,
  `NEXT_PUBLIC_SENTRY_DSN`) still travel as environment variables rather than as compiled defaults
  with an env override, which is the `ALERT_EMAIL` pattern in `src/lib/platform-mail.ts` and where
  they belong. `REG_SUIT_GITHUB_CLIENT_ID` is CI configuration that the application never reads and
  should not be in this surface at all. Both are follow-on work, tracked in
  `docs/product/follow-ups/`.

## Alternatives considered

- **Add the minted credentials to `stackManaged` and keep the merge.** The one-line version of this
  fix, shipped in #460 as a pattern rule. It closes the specific hole but keeps the mechanism: the
  next value that is stack-written and not credential-shaped (a RUM monitor id, a log group name)
  falls through the same way. Kept as a belt only until this replaced it.
- **Make every non-empty stack value win, with no list at all.** Simpler, and wrong: it would force
  `APP_HOST` to `https://dive.day` on every workstation, since the stack writes it non-empty.
  Provenance, not emptiness, is the right discriminator.
- **A third file for legitimate local overrides.** Considered and dropped — there is nothing to put
  in it. The repo already degrades without local values: no `DATABASE_URL` means embedded PGlite, no
  `APP_HOST` means relative links. A file for developer preferences would have re-introduced
  precedence for the sake of an empty set.
