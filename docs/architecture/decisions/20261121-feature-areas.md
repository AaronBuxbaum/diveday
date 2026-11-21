# 20261121-feature-areas — Group feature concepts into areas, one file or one door each

- **Status:** Accepted
- **Date:** 2026-11-21
- **Supersedes:** [20261108-concept-leaves](20261108-concept-leaves.md) for the layout; amends
  rules 1 and 2 of [20260730-feature-module-contracts](20260730-feature-module-contracts.md)

## Context

The concept-leaves move left `src/features/` as 376 folders in one flat list. 293 held one real
file wrapped in a pass-through `index.ts`, and 308 READMEs were the same paragraph. Nothing said
which concepts belong together, and plumbing (`net`, `sentry-dsn`, `e2e-port`) sat beside
`seat-diver` and `today`. An agent looking for "everything about gear" guessed from names.

## Decision

`src/features/` holds only area folders, each named with a word a shop person would recognize:
`accounts`, `after-the-dive`, `ai`, `boarding`, `bookings`, `certifications`, `crew-and-boats`,
`day`, `demo`, `gear`, `messages`, `money`, `people`, `platform`, `public-site`, `records`,
`reports`, `safety`, `shop-setup`, `sites`, `training`, `trips`, `waivers`. `platform` is plumbing,
not a shop concept, and says so.

- An area has a `README.md`: what it owns, what it does not, and its invariants.
- A concept with one source file is that file, `<area>/<concept>.ts`, with its tests beside it
  (`<concept>.test.ts`, `<concept>.<case>.test.ts`). A concept with several files is a folder,
  `<area>/<concept>/`, whose `index.ts` is its door; a hand-written concept README stays there.
- From outside a concept, `@/features/<area>/<concept>` is the only importable form: the file, or
  the folder's index. Nothing deeper. Siblings inside one concept folder import each other
  freely; concepts in one area still go through each other's doors. An area has no door.
- A new feature goes into the area it serves; a new area needs a reason a shop person would give.
- The leaf rule stands: a production `src/lib` or `src/db` file with no other production substrate
  importer belongs in a feature area unless `scripts/substrate-primitives.json` explains it.

`pnpm check:architecture` (rule 3) enforces the area README, the concept-folder index, nothing
loose under `src/features`, and the doors. The 2026-11-08 ratchets carry over by path.

## Alternatives considered

- **Keep the flat list** — rejected; it is the cost described above, and it grows with every concept.
- **Keep every concept a folder** — rejected; a pass-through index and a copied README per file
  doubles the files and says nothing.
- **An index per area** — rejected; a barrel over unrelated concepts hides which one a caller needs
  and puts every concept's server code behind one import.
- **Group `src/lib` the same way now** — deferred until this shape proves itself.

## Consequences

Each area README is the map an agent reads first, and a concept's surface is still one file. A
one-file concept publishes every export it has; when it needs a private helper it becomes a
folder with an index. Choosing an area is a judgement call; a concept moves by `git mv` and an
import rewrite, with no compatibility path. Revisit if an area passes about forty concepts (split
it) or if areas start importing each other's internals to share logic (push that down into
`src/lib`).
