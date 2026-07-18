# 20260718-typescript7-next-preview — Adopt TypeScript 7 with the Next.js 16.3 preview

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

Dependabot bumped `typescript` to 7.0.2 — now the npm `latest`. TypeScript 7 is the native (Go)
compiler; it no longer exposes the in-process JS compiler API that Next.js 16.2.10 uses for its
build-time type check, so `next build` reported TypeScript as "not installed", failed, and broke the
Vercel deploy (the merged nitrox PR pinned back to `^5.9.3` as a stopgap). We want to run the current
TypeScript rather than hold the toolchain on the previous major.

## Decision

Use `typescript@^7.0.2` and bump Next to `16.3.0-preview.6`, which supports TS 7 by driving the
TypeScript **CLI** (`tsgo`) instead of the removed JS API. Enable it with
`experimental: { useTypeScriptCli: true }` in `next.config.ts`. `pnpm typecheck` (`tsc --noEmit`)
already runs TS 7 directly and gates CI independently of the build. This matches the project's existing
pre-release posture (React 19, `next-auth` 5 beta).

## Alternatives considered

- **Pin `typescript` to `^5` (the stopgap on `main`)** — stable, but freezes the toolchain a major
  behind and fights future Dependabot bumps.
- **Keep stable Next 16.2.10 + `typescript.ignoreBuildErrors: true`** — works (type safety stays with
  `pnpm typecheck`/CI), but `next build` no longer type-checks, and it's a workaround, not TS 7 support.
- **Wait for a Next GA that supports TS 7** — no stable release supports it yet; blocks on upstream.

## Consequences

Makes easy: staying on current TypeScript with real in-build type checking again. Commits us to a Next
**preview** release in production until 16.3 reaches GA — a preview can churn or be pulled, so the Next
version is now a thing to watch and move to GA promptly. `experimental.useTypeScriptCli` is
experimental and may be renamed. Escape hatch: revert to stable Next 16.2.10 with
`typescript.ignoreBuildErrors: true` (keeps TS 7) or pin `typescript` to `^5` — both are one-line
changes and were verified to build. Revisit when Next 16.3 goes GA (drop the experimental flag if it
becomes default) or if the preview proves unstable.
