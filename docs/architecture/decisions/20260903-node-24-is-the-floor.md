# 20260903-node-24-is-the-floor — DiveDay runs on Node 24, and one guard makes every declaration say so

- **Status:** Accepted
- **Date:** 2026-09-03
- **Alongside:** 20260903-the-dev-server-is-supervised and
  20260903-one-process-per-pglite-directory, the other two halves of the same afternoon's work on
  making local running boring.

## Context

Six places in this repository named a Node version and they disagreed. Issue #1326 found four of
them; an audit on the day this was decided found two more:

| Where | Said | Enforced by |
| --- | --- | --- |
| `package.json` `engines.node` | `>=24.0.0` | a **warning**, and only when a package manager reads the manifest |
| `README.md` Quickstart | Node 24 | nothing |
| `.github/actions/setup/action.yml` | `node-version: 24` | `actions/setup-node`, on CI only |
| the containers this project is developed in | 22.22.2 | n/a — nothing there reads `engines` as a gate |
| `@types/node` | `^26.4.1` | `tsc`, which type-checked the tree against a major nothing ran |
| four Lambdas in `infra/lib/infra-stack.ts` | `NODEJS_22_X` | AWS, at deploy — the only *executable* pin in the tree |

Only one of the six was enforced anywhere, and it was the one that mattered least.

**This is not a tidiness problem.** `engines` is warn-only by default, and pnpm writes that warning
to **stdout** — measured, not assumed: it is the first line of `pnpm install` and of every
`pnpm <script>`, while the `$ node scripts/…` echo that follows goes to stderr. That is how two MCP
servers launched through `pnpm` had `[WARN] Unsupported engine` delivered as the first line of their
JSON-RPC stream, never completed a handshake, and cost every session a 30-second connect timeout
each until #1324 pointed `.mcp.json` at the binaries directly. A version declaration nobody
reconciles is a version declaration that eventually ends up on a channel which cannot carry it.

The audit also found two things that change the shape of the answer:

- **Nothing in the tree needs Node 24.** The highest floor in first-party code is `fs.globSync`, at
  Node 22.0.0. `pnpm typecheck` and the unit suite both pass on 22.22.2 today. So `>=24` is a
  promise about what this project supports, not a consequence of what it uses — which is exactly
  why it is a decision for the owner rather than an inference from the code.
- **`>=24.0.0` was false anyway.** `jsdom@30`, the DOM environment the whole unit suite runs in,
  declares `engines.node: "^22.22.2 || ^24.15.0 || >=26.0.0"`. Node 24.0 through 24.14 satisfies a
  `>=24.0.0` field and violates a dependency we install on every machine.

## Decision

**DiveDay runs on Node 24.** The owner's call, answering #1326 on 2026-09-03, against a
recommendation in that issue to relax to 22+.

Three numbers say so, and they live in one file — `scripts/check-node-version.mjs`:

- `NODE_MAJOR = 24` — what we develop, test and deploy on.
- `NODE_FLOOR = "24.15.0"` — the floor inside that major, taken from the strictest dependency
  rather than rounded down to `.0`, so `engines` is a claim that is actually true. `engines.node`
  is `^24.15.0`, a **closed** range, and the caret is load bearing rather than stylistic:
  `>=24.15.0` would also advertise every Node 25 release, and jsdom's range excludes the whole odd
  major (25 satisfies neither `^24.15.0` nor `>=26.0.0`). Saying "Node 24" and meaning it closes
  both ends. The number is *derived* rather than trusted — a test reads `engines.node` off all 733
  installed manifests that declare one and asserts this is the lowest version on the major that
  every one of them accepts, so a dependency bump that raises the bar goes red instead of
  silently. Today two set it: `jsdom@30` at `^24.15.0` and `@napi-rs/lzma-linux-x64-gnu` at
  `^24.12`.
- `LAMBDA_NODE_MAJOR = 24` — what AWS runs the handlers in `infra/` on. Stated separately because
  it is a different question with a different clock: AWS publishes and retires runtimes on its own
  schedule, so the two can legitimately diverge for a while.

`pnpm check:node-version`, inside `pnpm check:repo`, refuses any file that drifts from them. It
covers ten declarations: `engines.node`, `.nvmrc`, the CI action's `node-version:` **and its own
description prose**, the README's Quickstart line, the `@types/node` major, every
`lambda.Runtime.NODEJS_*_X` in the stack, the esbuild bundling target beside them, the one test
that asserts a synthesized runtime — and the pnpm version, which is the one rule here that is not
about Node. The README's Quickstart claims the repository pins *both* the runtime and the package
manager; for a day only the runtime half was checked, and a merge that bumped `packageManager` to
pnpm 11.25.0 left that sentence saying 11.24.0. Same defect, one column over. `packageManager` is
the source of truth there, since Renovate bumps it, and the README has to follow.

A missing declaration file is a failure, not a pass — a guard that reads a deleted `.nvmrc` as
"nothing to check" goes green exactly when the pin it protects is gone.

Four things changed to make the tree agree:

1. `engines.node` `>=24.0.0` → **`^24.15.0`**, closed at both ends for the reason above.
2. **`.nvmrc` added**, holding `24`. It is what makes the README's "the repository pins both the
   runtime major and the package-manager version" a true sentence: nvm, fnm, mise and asdf all read
   it, and before this nothing in the repo selected a Node at all.
3. `@types/node` `^26.4.1` → **`^24.13.3`**, so the type surface describes the runtime we promise.
   A Node-26-only API used to pass the whole gate and fail at runtime. Verified before the change
   and again after: **0 errors** on both `tsc` projects.
4. The four `NODEJS_22_X` Lambdas, the `target: "node22"` beside them and the one test asserting
   `nodejs22.x` → **24**. This also makes the stack uniform: `aws-cdk-lib` already synthesizes
   three helper Lambdas of its own — the custom-resource provider framework, `AwsCustomResource`,
   the OIDC provider — at `nodejs24.x` via `determineLatestNodeRuntime`, so pinning ours lower was
   running two majors in one stack.

**What this deliberately does not do is make the requirement bite.** A container on Node 22 still
runs everything, and still prints the warning on every `pnpm` script. That is the cost of the
decision, it is written down where a session will meet it (the debug skill's symptom table), and
the alternatives that remove it are below.

## Alternatives considered

**Relax `engines` to `>=22.0.0`** — issue #1326's own recommendation, and the cheapest answer: the
warning disappears everywhere, including in whatever pipes pnpm's stdout next, and the evidence
says nothing breaks. Declined by the owner. It widens what the project promises to run on, and CI
would no longer be testing the floor.

**`engine-strict=true` in `.npmrc`** — turns the warning into `exit 1` on every `pnpm run` and
`pnpm install`. The most honest expression of "requires 24, and means it", and the reason it is not
here: in a container shipping Node 22 it stops every session dead before it can do anything,
including the sessions that would fix the container. A requirement whose enforcement removes the
ability to work on the requirement is not enforcement.

**`use-node-version=24.x` in `.npmrc`** — pnpm's own mechanism: it downloads and runs the named
Node for every script, so the requirement becomes *true* in any container rather than merely
declared, and the warning goes away by fixing its cause. Verified working in an agent container on
2026-09-03. Not taken here because it puts a download from an external host on the critical path of
every `pnpm` command — in CI, in the Vercel build (`scripts/vercel-build.mjs` shells to
`pnpm db:migrate` and `pnpm build`), and on every developer machine — trading a warning that has a
known, guarded blast radius for a hard failure whose blast radius is "the network". Filed for the
owner rather than decided here.

**Leaving the Lambdas on 22.** Defensible — AWS supports `nodejs22.x` for years yet, and nothing
about the handlers needs 24. Declined because it leaves a fifth declaration contradicting the other
four, which is the disease rather than a symptom of it, and because the stack was already running
`nodejs24.x` for three functions nobody had noticed.

**Prose instead of a guard.** It was prose for a day, in the README and the issue. The repository's
own history is that a rule which can be checked mechanically eventually has to be —
`guard-bash.mjs` and `stray-processes.mjs` exist for the same reason.

## Consequences

- Six disagreeing declarations became ten agreeing ones, and an eleventh cannot be added without
  the guard noticing.
- `engines` is now a claim that survives contact with the dependency tree. Node 24.0–24.14 and the
  whole of 25 are refused rather than quietly admitted and then refused by `jsdom` under a
  different name.
- The type layer stops describing a runtime nobody runs. This closes one hole and leaves a bigger
  one open: `tsconfig.json` still says `lib: ["dom","dom.iterable","esnext"]`, which hands the
  compiler ES2025-and-later library types regardless of Node — so an API neither Node 24 nor any
  browser baseline has still compiles green. `lib` and `@types/node` are independent knobs and that
  one is a separate decision, because the same setting governs client code, where the relevant
  floor is browsers rather than Node. Filed as a follow-up.
- A `pnpm` command in a Node 22 container still prints `[WARN] Unsupported engine` to stdout. It is
  harmless today — every machine consumer of a subprocess stream here spawns a direct binary or
  `pnpm exec`, which does not warn — and the debug skill now says so, along with what would make
  it fatal.
- Deploying moves four Lambdas to `nodejs24.x`. No handler code changed; the CDK snapshot test was
  updated in the same change.
