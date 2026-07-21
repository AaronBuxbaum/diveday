# 20260718-vercel-hosting — Deploy the web application on Vercel

- **Status:** Accepted
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
