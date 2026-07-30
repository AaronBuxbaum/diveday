# 20260730-feature-module-contracts — Give a feature a `src/features/<feature>/` module with one entry point

- **Status:** Accepted
- **Date:** 2026-07-30

## Context

`AGENTS.md` has said "domain logic in `src/lib/` or an approved feature module" for a while, and
nothing in the repo defined what an approved feature module *is*. Meanwhile `src/lib/` has grown
to 166 files and `src/db/` to 105, both flat. A feature's pieces end up scattered across three
flat directories with nothing but a shared filename prefix to say they belong together, and
nothing at all to say which of them are safe for other code to reach for.

The result is that every exported symbol is public by default. There is no way to split a helper
file, rename an internal function, or change a data shape without first grepping the whole repo,
because any file might be importing any other. That cost is small at 166 files and gets worse
monotonically.

The brainstorm item framed this correctly: try the shape on one feature before making it a
permanent layout rule. Calendar sync (20260730-calendar-feed-subscriptions) is that feature — it
has pure domain logic, its own queries, a route, and UI, so it exercises every boundary.

## Decision

A feature module is a directory under `src/features/` with a **published surface and an enforced
boundary**:

```text
src/features/<feature>/
  index.ts     # required — the only thing other code may import
  README.md    # required — what it owns, what it does not, its invariants
  *.ts         # internals: free to split, rename, and merge
  *.test.ts    # tests live beside what they test
```

`pnpm check:architecture` enforces four rules:

1. Every `src/features/<feature>/` has an `index.ts` and a `README.md`.
2. Nothing outside a module may import past its index — `@/features/x/feed-store` fails,
   `@/features/x` passes. Inside the module, any file may import any sibling.
3. A feature module may not import from `src/app/`.
4. `src/lib/` and `src/db/` may not import from `src/features/`.

Rule 4 is the layering claim: `lib` and `db` are *below* features. A feature composes them; they
never reach up. Together with the pre-existing "domain code must not import `src/app`" rule, the
dependency direction is `app → features → lib/db`, one way.

`pnpm check:clock` also now covers `src/features`, since feature modules hold the domain and data
code that its freeze depends on.

## What stays where

- **`src/db/schema.ts` keeps every table**, including a feature's. One schema file remains the
  source of truth (ADR-0005); a feature owns its rows' *lifecycle*, not their definition.
- **`src/lib/` keeps genuinely shared primitives.** The iCalendar writer serves both the diver's
  one-off download and the staff feed, so it stays in `src/lib/trip-calendar.ts`.
- **Routes and UI stay in `src/app/`** and import the module's index. A feature module is not a
  place to hide a page.

This is deliberately a convention proven on one feature, not a migration order. Nothing existing
moves. The next feature that has its own tables, its own queries, and a non-trivial surface is the
next candidate.

## Alternatives considered

- **Leave everything flat in `src/lib` and `src/db`** — rejected; it is the status quo whose cost
  this ADR describes, and it gets worse with every feature.
- **A pnpm workspace package per feature** — rejected. Real enforcement from the module resolver,
  but it reopens ADR-0003 (single app at the root) and adds build graph, versioning, and tooling
  cost for a boundary a 60-line check script already enforces.
- **A Biome/ESLint `no-restricted-imports` rule** — rejected. It would cover rules 2–4, but not
  "every module has an index and a README", and the repo's existing convention is a `check:*`
  script per invariant with a remediation hint in its failure output.
- **Feature-owned schema files** (`src/features/x/schema.ts`, merged at build) — rejected;
  splitting the Drizzle schema breaks the single-source-of-truth guarantee and the linear
  migration chain for no boundary benefit.
- **Colocating routes inside the feature** — rejected; Next's router owns `src/app/`, and a
  parallel routing tree would fight it.

## Consequences

- A module's internals are genuinely internal. `feed-store.ts` can be split in two with no edit
  outside its directory, and its surface is reviewable by reading one file.
- `index.ts` becomes the thing to review carefully: a lazy `export *` would hand back exactly the
  boundary this buys. The check enforces the *direction* of imports, not the taste of the index.
- Two places can now plausibly hold a helper (`src/lib/` or a feature module), which is a real
  judgement call and a source of churn. The README's "owns / does not own" sections exist to make
  each module state its answer rather than leaving it implicit.
- **Revisit if** two features need to share non-trivial logic. Today the answer is to push it down
  into `src/lib/`; if that starts producing a `src/lib/` full of two-caller helpers, feature-to-
  feature imports through indexes (already allowed by the check) may need explicit guidance.
