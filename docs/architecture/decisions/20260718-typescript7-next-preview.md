# 20260718-typescript7-next-preview — Adopt TypeScript 7 with the Next.js 16.3 preview

- **Status:** Accepted, **amended 2026-08-15** (a repository check imports `typescript/unstable/ast` —
  see the [Amendment](#amendment-2026-08-15--one-repository-check-rides-an-unstable-typescript-entry-point))
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

## Amendment 2026-08-15 — one repository check rides an unstable TypeScript entry point

TypeScript is no longer only a compiler we run; one repository check now *imports* it.
`scripts/check-db-concurrency.mjs` (added 2026-08-14, run by `pnpm check:repo`) refuses a
`Promise.all` inside a function that can receive a drizzle transaction, and to do that it has to know
where a function *body* begins and ends — so that a `Promise.all` in a comment, in a string, or in a
sibling function is not a match. It gets that from TypeScript's own lexer:

```js
import { createScanner, LanguageVariant, SyntaxKind } from "typescript/unstable/ast";
```

That entry point is named `unstable` by the package and TypeScript 7 means it, so a TypeScript major
upgrade may remove or reshape it and take `pnpm check` with it. **If you are reading this mid-upgrade
because that just happened: this is the expected failure, and the decision was already made to accept
it rather than design around it.** The reason is that it breaks *loudly* — the check throws, or the
twelve cases in `scripts/check-db-concurrency.test.mjs` go red — so the rule can never silently stop
catching the fan-out it exists to catch, which is the only failure that would actually cost anything.
The alternatives were weighed and cost more than the risk: hand-rolling a string/template/comment-aware
brace matcher is about sixty lines of exactly the code TypeScript already ships correctly, and it
becomes *our* bug when it is wrong; `@babel/parser` sits in `node_modules` only transitively, so using
it means declaring a new runtime dependency and writing its own ADR.

Two names have already moved from what an older TypeScript offered, and both are worth knowing before
you edit that file. The end-of-file token is `SyntaxKind.EndOfFile`, not the classic `EndOfFileToken` —
reading the old name yields `undefined`, and a `while (token !== undefined)` loop then spins forever
rather than failing, so the symptom is a hang rather than an error. And the scanner emits trivia tokens
rather than skipping them. The classic `ts.createSourceFile` / `ts.forEachChild` AST API is gone from
the package's exports altogether.

The supported replacement, and the migration target when this does break, is
`typescript/unstable/sync`'s `Program`/`Project`. Measure before porting rather than assuming: it wants
a real project setup rather than the one string of source that check's tests hand it, and it builds a
program per run while the check reads every file under `src/db` and `src/features`. If a program build
over those two directories comes in under a second, take it — that is the stable answer and this stops
being a question.
