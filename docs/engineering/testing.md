# Testing

## Layers

| Layer | Tool | Where | What it proves |
| --- | --- | --- | --- |
| Unit | Vitest | colocated `src/**/*.test.ts(x)` | domain logic: cert gating, capacity, pricing, formatting |
| Component | Vitest + Testing Library | colocated | interactive components behave (role-based queries) |
| E2E | Playwright | `e2e/*.spec.ts` | critical user flows survive integration |

## Commands

```bash
pnpm test          # unit + component, once
pnpm test:watch    # during development
pnpm e2e           # Playwright (auto-detects sandbox Chromium; CI installs its own)
pnpm check         # lint + typecheck + unit — the pre-commit bar
```

## Conventions

- **Test behavior, not implementation.** Query the DOM by role/label, assert outcomes; don't
  reach into component internals or test styling classes.
- **Domain logic is where coverage lives.** `src/lib/` functions get thorough cases — edges
  included (full boat, expired service, uncertified diver, physician-flagged medical). UI tests
  stay thin.
- **Time and zone are explicit.** Any date/time test passes an explicit `timeZone`; never depend
  on the runner's locale or clock. Fixed dates, not `new Date()`.
- **E2E is a smoke layer, not a matrix.** One spec per critical flow (book a trip, sign a
  waiver, run roll call), kept fast and unflaky; edge cases belong in unit tests.
- **Safety-critical logic** (manifest counts, roll-call state, cert gating) merges only with
  tests for the failure paths, not just the happy path.

## Adding a test

Unit: create `thing.test.ts` next to `thing.ts` — Vitest picks it up. Component: same, `.tsx`,
setup already imports jest-dom matchers. E2E: add `e2e/flow.spec.ts`; the config boots the dev
server itself.
