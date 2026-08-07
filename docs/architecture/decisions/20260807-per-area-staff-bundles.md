# 20260807-per-area-staff-bundles — Store staff copy as one file per namespace, composed by an index

- **Status:** Accepted
- **Date:** 2026-08-07
- **Amends:** [20260730-staff-copy-localization](20260730-staff-copy-localization.md) (storage layout only; the translator API, server-side-only rule, and coverage checks are unchanged)

## Context

`src/i18n/locales/<locale>/staff.json` was the repo's top merge-conflict magnet: 50 touches per
locale in three days of history — ahead of even `src/db/seed.ts` before its scenario split
(ADR 20260803-seed-scenario-modules). The mechanism is structural, not behavioral: every parallel
branch that touches a staff surface adds copy, every addition lands in the same 3,500-line file in
both locales, and JSON offers no append point that keeps two branches out of each other's diff
hunks. The result in history: manual conflict resolutions that broke formatting, and rebase replays
that duplicated commits.

The seed split proved the cure: give each area its own file and an orchestrator that composes them,
so concurrent additions touch disjoint files and the shared surface shrinks to one import line.

## Decision

- The staff bundle becomes a directory: `src/i18n/locales/<locale>/staff/<namespace>.json`, one
  file per top-level namespace (26 at the split), each holding that namespace's object — the
  filename *is* the key.
- `staff/index.ts` in each locale composes them into the same object shape `staff.json` had.
  `src/i18n/staff-messages.ts` imports the index; `staffTranslator`, `StaffMessages`, and every
  call site are unchanged, and the split was verified lossless (merged output byte-equal to the
  original JSON for both locales).
- A new namespace is a new `<namespace>.json` in **every** locale plus one import line in each
  locale's `index.ts`. New keys in an existing area touch only that area's file.
- `pnpm check:locale` reads the directory exactly the way `index.ts` composes it, and adds the
  integrity checks the layout makes necessary: the same namespace-file set in every locale, and
  every file imported by its locale's `index.ts` — an orphaned file would otherwise read as
  "translated" while never shipping.

`diver.json` stays a single file for now: it holds fewer, larger page-scoped namespaces and its
churn is materially lower. If its conflict rate approaches what staff copy showed, the same split
applies mechanically.

## Alternatives considered

- **Alphabetically sorting keys in one file** — spreads inserts but cannot separate two branches
  adding to the same section, which is the actual collision observed.
- **A git merge driver for JSON** — needs per-clone configuration; sessions run in fresh ephemeral
  checkouts, so it would silently not exist exactly where it is needed.
- **Per-surface bundles loaded dynamically by route** — a bigger win for payload but changes the
  server-only loading model 20260730-staff-copy-localization deliberately chose; not warranted for
  a conflict problem.

## Consequences

- Two branches adding copy to different staff areas no longer conflict at all; the same area still
  conflicts, but over a file scoped to that area's few hundred lines.
- The composition index is a new shared touch point, but only for *new namespaces* — rare (26 in
  five weeks) versus new keys (daily), the same trade `seed.ts`'s orchestrator accepted.
- Filename = namespace is a contract: renaming a namespace means renaming files in every locale and
  both index lines, and `check:locale` fails on any half-done rename.
- Escape hatch: recombining is the split script run in reverse — the index defines the merge, so
  one commit can restore a single-file bundle if the layout ever loses its value.
