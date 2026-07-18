# Scuba — agent guide

Delight-first dive shop operations: **bookings, waivers, cert checks, gear, boat manifests**.
Competitors have the features; we win on experience. AI agents are the developers. This file,
`docs/`, scripts, and tests are the provider-neutral source of truth; provider-specific folders are
adapters and must not introduce unique requirements.

## Read first

1. This file.
2. Run `pnpm task:context -- <area>` when the task matches a supported area.
3. Read [docs/README.md](docs/README.md) and only the documents relevant to the task.
4. Read the Next.js warning at the bottom before framework-touching work.

## Context economy

- Do not read `pnpm-lock.yaml`, generated `drizzle/`, `.next/`, `playwright-report/`, or
  `test-results/` unless diagnosing a specific failure in that artifact.
- Locate symbols with search and read the narrow surrounding range instead of opening large files.
- Read `foo.test.ts` before `foo.ts` when asking what behavior is intended; tests are compressed
  specifications.
- Iterate with one focused test and quiet output. Run the full pre-commit gate once.
- Successful tooling should be quiet; inspect only the failed step or useful tail of a log.

## Commands

| Command | What |
| --- | --- |
| `pnpm dev` | dev server at localhost:3000 |
| `pnpm task:context -- <area>` | bounded paths, invariants, and validation for a task |
| `pnpm check:repo` | architecture, ADR, and documentation-link safeguards |
| `pnpm check` | repository safeguards + lint + typecheck + unit tests — **the pre-commit bar** |
| `pnpm lint` / `pnpm lint:fix` | Biome check / autofix |
| `pnpm typecheck` | tsc |
| `pnpm test -- <file> --reporter=dot` | focused Vitest run with low-noise success output |
| `pnpm e2e -- <spec> --reporter=line` | focused Playwright run |
| `pnpm build` | production build |
| `node scripts/screenshot.mjs [routes]` | light/dark × desktop/phone PNGs → `.screenshots/` |

## Route map (don't re-derive this)

| You need | Go to |
| --- | --- |
| Public pages (landing, schedule, sign-in) | `src/app/` — `/trips` is the public schedule |
| Staff surfaces (all `/shop/**`, auth-gated) | `src/app/shop/` |
| DB schema (source of truth — never read `drizzle/`) | `src/db/schema.ts` |
| DB client / test db factory | `src/db/client.ts` (`getDb()`, `createTestDb()`) |
| Queries and seed data | `src/db/queries.ts`, `src/db/seed.ts` |
| The booking transaction (capacity enforcement) | `src/db/bookings.ts` — read its tests first |
| Domain logic (framework-free) | `src/lib/` — capacity in `trips.ts`, dates in `format.ts` |
| Auth: edge config / providers / gates | `src/lib/auth.config.ts` / `auth.ts` / `authz.ts` + `session.ts`; edge layer in `src/proxy.ts` |
| Dev/e2e staff logins | `src/db/dev-credentials.ts` |
| Design tokens | `src/app/globals.css` (semantic only, ADR-0004) |
| "What should this code do?" | Read `foo.test.ts` before `foo.ts` — tests are the contract |

## Skills and providers

The canonical process is this file, `docs/`, scripts, and tests. Claude-specific playbooks are indexed
in [.claude/skills/README.md](.claude/skills/README.md): **new-feature**, **verify**,
**design-review**, **schema-change**, **debug**, and **adr**. Other providers should read the
corresponding `SKILL.md` directly when useful. If a skill conflicts with canonical docs, tests, or
code, the skill is stale and must be fixed in the same change.

## Parallel work

- Use a unique branch/feature slug and open a draft PR early for non-trivial concurrent work.
- State owned paths, expected schema changes, and planned ADR ids in the PR description.
- New ADRs use collision-resistant `YYYYMMDD-short-slug` ids; do not allocate the next integer.
- Do not use branch-local reservation ledgers: other pending branches cannot see them.
- Split work by vertical slice or non-overlapping paths. Trial-merge the target branch before calling
  work complete.

## Hard rules

- **Verify before commit** — `pnpm check` green minimum; e2e when flows changed; *look at* UI
  you changed (screenshots, light + dark). Never report unverified work as done.
- **Semantic tokens only** in components — no raw hex, no palette-scale classes (ADR-0004).
- **New runtime dependency → ADR.** New domain concept → glossary. Invalidated doc → fix in
  the same PR.
- **Safety-critical surfaces** (manifests, roll call, cert gating, medical flags) get boring
  code, failure-path and adversarial tests, and a `dive-domain-expert` review.
- **Layout**: domain logic in `src/lib/` or an approved feature module; routes in `src/app/` stay
  thin; e2e specs live in `e2e/`; domain code never imports from `src/app/`.
- **Tests travel with behavior.** New features include happy-path and important failure-path tests;
  bug fixes begin with a failing regression test.
- **Secrets never enter the repo** — `.env*` is gitignored.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.
<!-- END:nextjs-agent-rules -->
