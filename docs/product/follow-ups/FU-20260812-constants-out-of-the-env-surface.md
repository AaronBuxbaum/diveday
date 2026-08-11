# FU-20260812-constants-out-of-the-env-surface — Compile the four constant config values, and move the reg-suit client id out of the app's env

- **Status:** Open
- **Raised:** 2026-08-12 — the PR that introduced `config/env-registry.mjs`
  (ADR 20260812-env-provenance-registry)
- **Kind:** cleanup
- **Effort:** M
- **Touches:** `config/env-registry.mjs`, `src/lib/platform-mail.ts` (the pattern to copy),
  `.env.example`, `regconfig.json`

## What I noticed

Sorting every environment variable by who produces it turned up five that no one produces: they are
checked into `.env.example` and have been for months.

- `APP_HOST`, `SES_FROM_EMAIL`, `STRIPE_CONNECT_CLIENT_ID`, `NEXT_PUBLIC_SENTRY_DSN` — DiveDay's own
  identifiers. None is a secret. They are carried through Secrets Manager, written into three target
  files, and pushed to Vercel on every deploy, so that the deployment can be told a value the
  repository already knows.
- `REG_SUIT_GITHUB_CLIENT_ID` — reg-suit's own client id. The application never reads it. It is CI
  configuration sitting in the application's configuration surface.

The registry marks all five `constant`, which is honest but is still a fifth provenance where there
should be four. The pattern that replaces it already exists: `ALERT_EMAIL` is compiled into
`src/lib/platform-mail.ts`, and `OPS_ALERT_EMAIL` exists only as a fork/self-host override.

## Why it isn't already done

Scope. The registry PR was already large, and moving a value from the env surface into code changes
what a fork or a self-hosted instance has to do to change it — that deserves its own diff, where the
override path for each one can be looked at properly rather than bundled into a refactor of the
distribution machinery.

## Proposed change

1. For each of the four: a module-level constant next to the code that reads it, and a reader that
   prefers `process.env.<KEY>` when set, exactly as `platform-mail.ts` does. Then drop the key from
   the registry.
2. `REG_SUIT_GITHUB_CLIENT_ID` moves into `regconfig.json` (or its plugin options), out of the
   registry and out of `.env.github`. Confirm `pnpm visual` and the CI visual job still authenticate.
3. Regenerate `.env.example` and check the CDK stack still synths — `fillEnvExample` refuses a key
   the template does not declare, so removing declarations is the direction that needs care.

Not proposing to remove the env override for `APP_HOST`: local Stripe Connect testing legitimately
points it at `http://localhost:3000`, and the code already accepts that outside production.

## Prompt

```text
Four values in DiveDay's environment surface are checked-in constants rather than configuration —
APP_HOST, SES_FROM_EMAIL, STRIPE_CONNECT_CLIENT_ID, NEXT_PUBLIC_SENTRY_DSN — and a fifth,
REG_SUIT_GITHUB_CLIENT_ID, is CI configuration the application never reads. Move them out.

Read first: config/env-registry.mjs (the four provenances and the `constant` rows),
src/lib/platform-mail.ts (ALERT_EMAIL — the compiled-constant-with-env-override pattern to copy),
and docs/architecture/decisions/20260812-env-provenance-registry.md.

Do this: give each of the four a module-level constant beside its reader, preferring
process.env.<KEY> when set, then delete its registry row. Move REG_SUIT_GITHUB_CLIENT_ID into
regconfig.json and out of .env.github. Regenerate .env.example with
`node scripts/render-env-example.mjs --write`.

The constraint that makes this non-obvious: the CDK stack reads .env.example at synth
(readEnvExample in infra/lib/infra-stack.ts) and fillEnvExample refuses a key the template does not
declare, so removing a declaration the stack still writes fails the synth — check envValues in
infra/lib/infra-stack.ts before deleting any row.

Done means: `pnpm check` green, `pnpm test infra` green, and the four values no longer appear in
.env.example or any generated target file. Delete
docs/product/follow-ups/FU-20260812-constants-out-of-the-env-surface.md as part of the change.
```
