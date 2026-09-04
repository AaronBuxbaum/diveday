# 20260718-vercel-hosting — Deploy the web application on Vercel

- **Status:** Accepted; the automatic-preview clause amended 2026-09-04 (see Amendment below)
- **Date:** 2026-07-18

## Context

DiveDay is a Next.js application with pull-request review as its normal delivery path. The product
owner selected Vercel as the hosting platform. It should provide preview deployments for the same
GitHub branches the team reviews, without creating a second deployment topology for agents to
operate.

The current embedded PGlite database is intentionally a local-development and test vehicle. It is
not durable production storage and must not be used inside a Vercel function as a production
database. Vercel's current Postgres guidance is to connect an external Marketplace provider; the
former Vercel Postgres product is no longer available.

## Decision

Deploy this Next.js application through Vercel's Git integration. Each pull request receives a
preview deployment; `main` deploys to production only after the normal review and validation bar.

Production will use a managed Postgres provider connected to Vercel through its Marketplace, with
separate preview and production credentials. The provider, region, account owner, backups,
`DATABASE_URL` adapter, migration runner, domain, and incident owner remain explicit H-04 work;
this ADR deliberately does not choose a database vendor or store secrets.

## Alternatives considered

- **Continue treating a local PGlite directory as production storage** — unsafe on an ephemeral
  function platform and contradicts ADR-0005.
- **Pick a Postgres vendor in code before an account/region owner exists** — turns a deployment
  logistics choice into an accidental product commitment.
- **Self-host the initial web app** — adds operational work without improving the current
  Next.js/GitHub delivery loop.

## Consequences

Vercel becomes the canonical web host and PR previews become a required visual-validation input.
The app is not production-ready until a managed Postgres connection, production environment
variables, migration procedure, backups, and security review are recorded and implemented. Local
development and tests continue to use PGlite unchanged.

## Amendment — 2026-09-04: a preview is requested, not automatic

Two sentences above have aged out, and both are about previews rather than about hosting. The
decision to deploy through Vercel's Git integration stands unchanged.

**"Each pull request receives a preview deployment"** is no longer true, and
**"PR previews become a required visual-validation input"** was never how validation actually worked
once the visual suite existed. Visual baselines are rendered by CI's own Linux runners and compared
per-PR by reg-suit (ADR 20260729-reg-suit-visual-regression); the e2e and visual fleets run against
locally-built servers inside CI (`e2e/servers.ts`); review screenshots come from
`node scripts/screenshot.mjs` against a local dev server. Nothing in this repository reads a
`*.vercel.app` URL. The claim described an intent, and the tooling grew past it.

What changed on 2026-09-04 is that the cost of the untrue half became visible. Over the 63 hours to
that date this repository carried 170 branch commits against 69 merges to `main`, so roughly three of
every four Vercel builds were previews nothing consumed. `vercel.json`'s `git.deploymentEnabled` now
names `main` and nothing else, and `.github/workflows/preview.yml` deploys a preview on request — a
`preview` label on a pull request (sticky: every push previews while it is on), or a `/preview`
comment from someone with write access.

So the requirement this ADR recorded survives in a narrower form: **a preview URL for a branch,
available on request**. That is also what `docs/architecture/aws-migration-dossier.md`'s AWS-6 row is
now pricing, rather than a per-PR always-on environment. Mechanics and the credential it needs are in
[deploy-and-migrations-runbook.md](../../engineering/deploy-and-migrations-runbook.md).
