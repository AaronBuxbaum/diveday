# 0001 — Use full-stack Next.js with no separate backend

- **Status:** Accepted
- **Date:** 2026-07-17

## Context

Greenfield product developed exclusively by AI agents. The stack should maximize agent
effectiveness (deep training-data coverage, one language everywhere), minimize moving parts, and
still scale to a real multi-tenant SaaS.

## Decision

One **Next.js 16** (App Router) application serves UI and API. **TypeScript strict** everywhere.
Server components by default, server actions / route handlers for mutations. React 19.

## Alternatives considered

- **Separate backend (Fastify/Nest) + SPA** — two deployables, two type boundaries, more glue;
  no capability we need that Next lacks.
- **Remix / TanStack Start** — capable, but thinner agent familiarity and ecosystem than Next.
- **Rails / Django + Hotwire/HTMX** — strong batteries, but splits the codebase's language and
  weakens the typed seam between domain logic and UI.

## Consequences

- One repo, one deploy, end-to-end types; agents touch a single idiom.
- Caveat: Next.js 16 has breaking changes vs. training data — `AGENTS.md` requires reading
  `node_modules/next/dist/docs/` before framework work. This is a standing tax; pay it.
- Escape hatch: if a non-web client (mobile app) or heavy background processing arrives, extract
  an API/worker then — domain logic already lives framework-free in `src/lib/`, which is the
  migration seam.
