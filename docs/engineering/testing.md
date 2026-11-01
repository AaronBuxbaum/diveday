# Testing

The strategy: what each layer is for, what runs when, and how a change chooses its tests. The
mechanics of each layer follow. A decision that changes a rule below edits its own row or line;
every other section stands.

## What each layer is for

| Layer | Tool, where | Owns | Never |
| --- | --- | --- | --- |
| Rules | Vitest `lib`, colocated `src/lib/**/*.test.ts` | every decision with a branch: cert gating, capacity, pricing, dates; the refusal case is mandatory | rendering |
| Database | Vitest `db` on PGlite, `src/db/**/*.test.ts` | queries, transactions, erasure, reset | proving a race (PGlite is one connection) |
| Real Postgres | Vitest + a `postgres:16` container, `src/db/*.postgres.test.ts` | every lock and race guard; the committed `drizzle/` set applying to a real server ([below](#the-real-postgres-suites)) | anything else |
| Component | Vitest `ui` + Testing Library, colocated `.test.tsx` | interactive widgets: what a person clicks and sees, by role and label | class names, server pages |
| Fetch boundary | Vitest + MSW, e.g. `offline-manifest-store.test.ts` | client code calling one of our own `/api/*` routes ([ADR 20260719](../architecture/decisions/20260719-msw-offline-sync-only.md)) | server-side providers |
| Request-level | Playwright's `request` fixture, or a route-handler unit test | redirects, sitemap, feeds, webhooks, status probes, refusals | a browser |
| Browser | Playwright, `e2e/*.spec.ts` | the [critical journeys](#critical-journeys) and the flows a change touches: the happy path plus the refusals that protect safety or money; found by role and message key | exact wording, layout, edge cases a rules test can carry |
| Screenshots | reg-suit + S3, `e2e/visual-*.spec.ts` | a surface's populated and trouble states, per [captures.md](../../.claude/skills/e2e-and-visual/captures.md): light at phone and desktop, dark at desktop only, plus print ([ADR 20260729](../architecture/decisions/20260729-reg-suit-visual-regression.md)) | proving behavior |
| Repo checks | `pnpm check:repo` (`scripts/check-*.mjs`) and the Vitest `guards` project | every rule that reads source: "every X has Y", no raw colour, one way imports | a single page's markup |
| Coverage floors | `@vitest/coverage-v8`, ci.yml's `coverage-floors` ([below](#coverage-floors)) | branch coverage of every safety file never falling | a coverage target for the rest of the tree |
| Nightly and weekly | `simulate-day.yml`, `persona-bots.yml`, ci.yml's schedule | a whole shop day, persona walks, real Postgres against what other branches merged | blocking a PR |

Almost every page in `src/app/` is an `async function Page()` reading the database directly and
mutating through inline `"use server"` closures, which is the shape Next's own docs say Vitest
does not support (`node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`). Such a flow
belongs in `e2e/`; MSW is for the rare client component that fetches one of our own routes.

**Mock the framework edge, never `@/db/*`.** A unit test may replace `next/*` (headers,
navigation, cache), the session, and provider HTTP (Stripe, email, SMS: `src/test/fakes.ts`). The
database is always real PGlite: a test that mocks `@/db/*` pins call shapes, breaks on a harmless
refactor and stays green when the query's contract drifts. Files that still mock it move to a real
database when touched; `src/app/s/[shopSlug]/trips/[id]/actions.gear-fit.test.ts` is the worked
example.

**Fixtures come from `src/test/`.** `db.ts` hands out the database (`fileScopedShopContext`,
`seededShopContext`, `unseededTestDb`; [below](#the-test-database-is-a-snapshot-not-a-boot)),
`fakes.ts` the providers, `staff-session.ts` a signed-in staff member, `frozen-clock.ts` the
clock, `source.ts` the tree a guard walks. Rows come from `src/test/factories.ts` (`secondShop()`,
`aDiver`, `aTrip`, `aBooking`, `staffWithRole`) before a raw `insert`: a cross-tenant case is then
one line, so it gets written.

**A rule over source is a guard.** A test that reads files to assert a rule lives in `check:repo`
or the `guards` project ([repo-checks.md](../agents/repo-checks.md)), never beside a component. A
class name, a marker order or a JSX count pinned in a unit test is a change detector: it fails on a
refactor and passes on a broken render. **A geometry fix is proven by a capture**, not a class
assertion: the screenshot shows the overlap gone.

**No automated accessibility scans in the suite.** The axe scans (`e2e/a11y.spec.ts`,
`e2e/a11y-map.spec.ts`, `e2e/a11y-scan.ts`) were removed 2026-10-24: the scans were the week's top
failure site and the product does not prioritize automated a11y (Aaron, 2026-10-24). Markup fixes
that are free still land: a name on a control, a label on an input, a real heading. The weekly
persona walk's axe probe went the same day, and `@axe-core/playwright` with it.

## How a change decides its tests

1. A new rule or branch: a rules test, the refusal included. Always.
2. New stored data: a database test. If it locks or can race: a real-Postgres test.
3. A new or changed flow: extend the spec that walks it; a new spec file only for a new kind of
   user or a new entry point. A new journey a shop could not run a day without gets a row in
   [Critical journeys](#critical-journeys).
4. A new screen or state: a capture in its feature's `e2e/visual-*.spec.ts`, in the matrix above;
   [captures.md](../../.claude/skills/e2e-and-visual/captures.md) says which states earn one.
5. A wording-only change: no new test.
6. A redirect, feed, webhook or probe: a request-level test.

Safety-critical logic (manifests, roll call, readiness, cert gating, medical, waivers, nitrox,
erasure) merges with tests for the failure paths, not only the happy path.

## Critical journeys

The walks a shop cannot lose, each with the browser test that proves it. This list is the e2e
floor, not "every important flow" (testing review decision 2, 2026-10-14):
`pnpm check:critical-journeys` (in `check:repo`) fails when a row's spec is gone or its test is
renamed, deleted or statically disabled. Comments and quoted examples cannot satisfy a row; skipped
suites, skip hooks, callback skips, expected failures and quarantine tags are rejected. This source
check cannot prove fixture-driven runtime outcomes; the browser run supplies that evidence.
Renaming a journey's test renames its row in the same change.

| Journey | Spec | Test |
| --- | --- | --- |
| A diver books a seat | `e2e/booking.spec.ts` | full loop: staff schedules, visitor books, staff sees the roster |
| A diver pays online at booking | `e2e/booking.spec.ts` | a diver's card payment at booking settles their Pay step |
| A full boat takes a wait list, not a seat | `e2e/booking.spec.ts` | a full boat lets a diver join the wait list without taking a seat |
| The charter's gate refuses a booking | `e2e/trip-admission.spec.ts` | the public trip page states what the charter requires above the form, and says so again when the booking is refused |
| A diver signs a waiver with a medical yes | `e2e/waivers.spec.ts` | one waiver button sends a resumable link and a medical yes surfaces follow-up |
| A minor's waiver needs a parent | `e2e/guardian-co-signature.spec.ts` | a minor's release asks for a parent, refuses without one, and names who co-signed |
| Staff verify a certification | `e2e/certifications.spec.ts` | staff captures and verifies level and specialty certifications before either can be trusted |
| The counter checks a diver in | `e2e/check-in.spec.ts` | counter check-in finds a diver's boat, confirms live readiness, and keeps blocked rows out of the line |
| Roll call on the live manifest | `e2e/manifest.spec.ts` | live manifest retains blocked divers and records an explicit not-boarded result |
| Roll call offline | `e2e/manifest.spec.ts` | captain saves the full checkpoint manifest, reloads it offline, and reconciles roll call |
| A canceled booking flags its refund | `e2e/refunds.spec.ts` | canceling a paid counter booking inside the free-cancellation window flags a manual refund |
| Staff sign in and out | `e2e/auth.spec.ts` | staff sign-in lands on the shop dashboard and sign-out locks it again |
| A role is refused what it may not touch | `e2e/role-permissions.spec.ts` | the daily crew (captain) is denied money, legal, deletion, and trip config |
| One shop never reaches another's | `e2e/tenant-isolation.spec.ts` | a second shop's owner reaches none of Blue Mantis's staff surfaces |
| A diver prepares from their own link | `e2e/readiness.spec.ts` | a booked diver's readiness page lets them act and answers its questions |
| A deleted diver can be erased | `e2e/divers.spec.ts` | erase is absent on a live diver's record and appears once they are deleted |
| The shop exports its data | `e2e/export.spec.ts` | staff download the whole shop as documented CSVs |

## What runs when

| When | What runs |
| --- | --- |
| Before a commit | the guard you touched, `pnpm lint`, `pnpm typecheck`, `pnpm test <file>`; a changed flow's specs; a changed surface's captures in light (the **verify** skill) |
| Before a push, optional (CI is the gate) | `pnpm verify:push`: regen and a clean tree, check:repo and `guards`, every source-reading test, `vitest related`, and the specs `pnpm e2e:affected` names ([verifying.md](../agents/verifying.md#the-pre-push-gate)) |
| Every pull request | repo checks, lint, typecheck (one job), all unit tests (4 shards) with the coverage floors, the build, every Playwright spec (6 shards), the light-mode captures `visual-affected` selects (up to 8 shards, 7 for every light capture), the fast lane; real Postgres when `src/db/**` or `drizzle/**` changed |
| Push to `main` | all of the above with every capture, light and dark: the next baseline |
| Nightly | real Postgres (ci.yml's schedule), the one-day simulation, quarantined tests and the flake hunt (`e2e-nightly.yml`), CodeQL, the follow-up scan |
| Weekly | the persona walk, the shard-duration refresh |

**A scheduled run that goes red files itself.** `simulate-day.yml`, `durations-refresh.yml` and
`e2e-nightly.yml` end with `node scripts/workflow-alert.mjs`: a red run on the
default branch opens one `ci-red` + `needs-triage` issue in the follow-up format, each later red
run comments on it, and the first green run closes it. A manual run on another branch files
nothing.

**Flakes.** Playwright runs `retries: 0` locally and in CI, so a flake fails the run that meets it.
One exception, decided 2026-10-16 (#2633): a functional or visual shard may rerun its failed tests
once with `--last-failed` when `scripts/e2e-retry-policy.mjs` proves every initial failure from the
structured Playwright report. Proof is the visual screenshot probe's explicit wedge error, or a
timed-out test's own `browser-activity` attachment with the renderer probe verdict. Mixed ordinary
failures, missing evidence, global errors and unexecuted tests keep the shard red. Both attempts'
JSON reports and attachments are retained; duration and budget consumers keep the initial report.
A second exception, decided 2026-10-23 (H-156), on main only: a visual shard reruns its failed
captures once whatever the cause, because a failed shard on main publishes no screenshot baseline
and blinds visual review for every branch. A capture that passes only on that rerun is filed as a
`needs-triage` issue naming its spec (`scripts/visual-flake-issue.mjs`, CI's `visual-flakes` job),
or comments on the one already open. Pull requests keep the wedge-only rule above.
A failing or flaky test is part of the work that meets it, even when unrelated: fixed, after
searching open PRs for a fix in flight, or quarantined; never skipped, never given a wider timeout
(AGENTS.md, testing review decision 4).

- **Flaky needs evidence**: it failed and passed on one sha with no code change, or failed in the
  nightly flake hunt.
- **Quarantine** is the tag `@quarantine` (in the title or the `tag:` option) with, on its line
  or the four above, `// diveday:quarantine #<open issue> until <YYYY-MM-DD>: <what flakes>`.
  `pnpm check:e2e-hygiene` refuses a tag without both, an expiry more than 7 days out, an expired
  one (so a lapsed quarantine turns every branch red the next day), and more than 3 at once. The
  fix removes the tag; the date is never moved.
- **Where it runs**: `playwright.config.ts`'s `grepInvert` leaves quarantined tests out of every
  PR, push-gate and local run. `.github/workflows/e2e-nightly.yml` sets
  `DIVEDAY_RUN_QUARANTINE=1` and runs them every night, then runs each spec that failed on CI in
  the last 7 days five times (`--repeat-each=5`, `scripts/e2e-recent-failures.mjs`, at most 8
  specs). The history reader paginates failed workflow runs, Playwright and visual jobs, and their
  annotations. It resolves helper-thrown failures from the reporter title's spec identity and
  reports the inspected run count and date window. Authentication, API and partial-page failures
  fail the hunt explicitly. An empty result means no existing spec was identified in those
  annotations; it does not establish an exhaustive clean history.

## Selection

What a diff runs is decided by reading it, at two places:

- **Captures on a pull request**: `scripts/visual-affected.mjs`, in ci.yml's `visual-plan`. It
  follows each changed declaration by name (`scripts/symbol-reach.mjs`: through imports, barrels
  and re-exports, not whole files) to the routes that render it, a changed message key to the
  modules that name it, a `public/` asset to the code that names its path, and picks the captures
  that visit those routes plus a fixed smoke set; an edit inside an `e2e/visual-*.spec.ts` or a capture
  helper picks the captures it touched. A schema edit is followed from the tables it changes to the
  modules that read them, and a seed scenario's (`src/db/seed-<scenario>.ts`) from the tables it
  writes, never through a seed module (the demo action that runs the seed is on every public page).
  It captures everything for the capture harness, the seed's orchestrator (`src/db/seed.ts`), the
  catalog seed, a stylesheet, a root config or renderer dependency, a module every page runs (the
  proxy, the service worker), and its own plumbing (`ci.yml`, the setup action, these scripts).
  **A pull request captures light mode only** (`--light-only`, 2026-10-24: dark was 339 of 836
  captures and a third of the capture time) unless the diff touches a colour token or theme module
  (`THEME`: `globals.css`, `brand.ts`, `BrandStyle.tsx`, `_brand/colors.ts`, `postcss.config.mjs`);
  a push to `main` captures both. The accepted risk is a dark-only regression first seen on main's
  run. The `visual-all` label forces everything, dark included; every surface not captured is
  copied from the baseline before the compare. Locally, `--grep <file>` writes the light-mode
  Playwright grep for the same selection.
- **Specs before a push**: `scripts/e2e-affected.mjs`, run by `verify:push`. *Strong*: a spec or
  helper the diff edits, a spec quoting text the diff removed (a seeded name included), a spec
  reading an en-US key whose value changed by its full dotted key, a spec naming a seeded record
  or seed constant on a changed seed line when at most three specs name it, a spec visiting a
  route whose own directory changed. *Smoke*: five tests (booking, a waiver, check-in, roll call offline, sign-in)
  whenever the app changed. *Reach*: specs visiting a route the changed names reach, ranked by how
  much of the diff's vocabulary they name, run while they fit the time budget. `--commit <sha>`
  replays one commit, to score the selector against what CI caught.

**One `capture()` is three images** (four for a `TABLET_SURFACES` name): light at 390 and 1280
(and 820 for a tablet surface), dark at 1280 only (`DARK_VIEWPORTS` in `e2e/visual-viewports.ts`);
`captureStickyFoot()` follows the same rule and the phone fold capture is light only. A full run is
912 images, down from 1,218. The accepted risk is a dark-only defect that shows only at phone
width.

The mobile behavior lane (`.github/workflows/mobile-behavior.yml`) runs nightly and on manual
dispatch, outside PR shards. `playwright.mobile.config.ts` runs only `e2e/mobile*.spec.ts` under
touch Chromium (Pixel 7) and mobile WebKit (iPhone 13). Tests assert the engine and touch/mobile
context and use real taps for public navigation, booking, guardian signature and offline manifest
save/reload/reconciliation. The frozen clock, isolated worker databases and provider isolation
come from the normal fleet. WebKit gets no Chromium launch flags. Failures retain screenshots
and traces and open a `ci-red` issue; the first green run closes it.

Run `pnpm e2e:build`, then `E2E_WORKERS=1 pnpm exec playwright test --config playwright.mobile.config.ts`.
Install engines with `pnpm exec playwright install chromium webkit` (Linux also needs
`--with-deps`). This is browser/device emulation, including mobile input and storage behavior;
real iOS Safari verification remains a separate manual release check. Chromium screenshot
baselines continue through the normal config unchanged.

CI's normal Playwright shards exclude `e2e/mobile*.spec.ts`; `e2e/pixel-probe.spec.ts` runs on `main` and when
the probe, its spec, `e2e/fixtures.ts`, `globals.css`, a dependency or `ci.yml` changed
(`changes.pixel_probe`).

### Where a visual shard's time goes

Measured 2026-10-24 on shard 1/8 of the full list (104 tests, one worker, a shared 4-core box)
with `e2e/visual-timing-reporter.ts`:

| Item | Seconds | Share of wall |
| --- | --- | --- |
| Wall | 1,336 | 100% |
| Sum of test durations | 1,285 | 96% |
| Outside any test (server boot, global setup's migrate and seed, browser warm-up) | 52 | 4% |
| `demoReset` before every test | 479 | 36% |
| `privateShop` (9 tests: mint, sign-in, drop) | 42 | 3% |
| `context` and `page` | 33 | 2% |
| Worker starts | 1 for 104 tests | |

Two suspects are cleared. Every `test.use` in the visual specs sets test-scoped options
(`colorScheme`, `viewport`, `locale`, the step bounds, `privateShopSlug`), and Playwright keys a
worker only on worker-scoped fixtures, so the whole shard runs in one worker and one browser.
`privateShop` costs 3%. The largest cost outside the captures is the per-test reset.

On CI, the "7.1 minutes recorded" per shard counted only the 622 of 836 captures that
`scripts/e2e-durations.json` had durations for. The deal weighs each unrecorded capture at the
recorded mean, which puts the shard at about 9.5 minutes. The rest of the 12.3-minute job is
about 50 s of job steps and the run's own setup.

To measure again, run `pnpm e2e:build`, deal a shard with `node scripts/e2e-shard.mjs`, then
run `E2E_WORKERS=1 VISUAL_TIMING_OUT=.agent-out/timing.json pnpm exec playwright test e2e/visual --test-list <list> --reporter=line,./e2e/visual-timing-reporter.ts`.

**CI uses two workers per visual shard under option B.** A worker-count trial workflow and its
byte-comparison script were deleted; unexplained visual differences remain unapproved.

Byte equality is stricter than reg-suit would be, which ignores anti-aliasing (`enableAntialias` in
`regconfig.json`). Two one-worker runs of shard 1 on 2026-10-24 differed in three of 201 PNGs. Two
were a timed toast caught at one width and gone at the next, now waited out before the capture
(`blowout-cascade`, `staffing-shift-remove-disclosure`). The third was anti-aliasing on one map
pin (`dive-sites-library-pin-selected`, a channel difference of at most 3). So a difference in a
trial is a worker-count effect only when one-worker runs agree on that capture.

## Commands

```bash
pnpm test          # unit + component, once
pnpm test:watch    # during development
pnpm e2e           # Playwright (auto-detects sandbox Chromium; CI installs its own)
pnpm visual        # capture screenshots and run reg-suit comparison and publish to S3
pnpm check         # repo safeguards + lint + typecheck + unit — the pre-commit bar
pnpm simulate:day  # one whole dive day against the built server, clock advancing (nightly)
pnpm persona:bots  # the fifteen personas walked against the demo shop (weekly; --dry-run files nothing)
```

### The one-day simulation

`pnpm simulate:day` is V-04's rehearsal run by a machine: a fresh shop is minted, its clock set to
six in the morning, and the day is driven as its people would drive it — a diver books a seat on
the public page, signs the waiver from their link and files their certification card from it, the
counter sights the card, verifies it and checks them in, the crew say
*Boarding*, run roll call before departure, tap *Underway*, count heads after every dive, say
*Heading in* and *Home*, the shop closes the day, the recap pass runs after its four-hour floor,
and the diver reads the recap. Between states the frozen clock is moved forward through
`POST /api/test/clock`, so every stamp lands at the hour it would on a real day.

It is the e2e fleet's own machinery under a config of its own, not a second harness:
`scripts/simulate-day/playwright.config.ts` starts one of the fleet's worker servers with the
fleet's environment (`e2eServerEnv`, exported from `playwright.config.ts`) at the top of this
checkout's port block, and `scripts/simulate-day/day.spec.ts` drives it with `e2e/helpers.ts` and
`e2e/fixtures.ts`'s `makeActivitySafe`. The states are `DAY_STATES` in
`scripts/simulate-day/lib.mjs` (their timing and the transcript are the pure, unit-tested half),
one serial `test` each, so the first state the day cannot reach fails by name and stops the run.

The spec lives under `scripts/simulate-day/` rather than `e2e/` because the fleet discovers every
spec in that tree and CI deals them into shards, and this one takes minutes, owns its clock and
belongs to a nightly job. The clock route is likewise for this runner alone: a fleet worker's clock
is shared by every spec it runs (`seed-evening` moves the whole day's departures instead, and
`depart-trip` moves the one a spec names), so no `e2e/` spec may call it.

What it leaves behind (`simulation/`, gitignored): a full-page screenshot per state, and `day.md`
listing each state with the shop-clock time it was reached, how long it really took, and its
screenshot — with a failed state named and everything after it marked *not attempted*.
`.github/workflows/simulate-day.yml` runs it every night (and on `workflow_dispatch`), builds
once, and uploads `simulation/` whether or not the day completed. Options: `--no-build` (reuse
the build on disk, as the workflow does), `--keep`, `--out <dir>`, `--start <iso>`.

### The weekly persona walk

`pnpm persona:bots` re-reads [the persona frame](../product/personas.md) with a machine (N-61). It
opens every surface the fifteen personas name, against the demo shop, as the persona who lives on
it — anonymously for the diver-facing pages, signed in as that persona's role for the staff ones,
and in Spanish for Ingrid, whose findings are invisible in English — runs a fixed set of probes on
each, photographs the surfaces the findings name, and files what it found as `needs-triage` issues.

**Every probe is deterministic.** Each one answers yes or no from the rendered DOM, the response
status: a missing skip link, a message key that reached the screen instead of a sentence, a page
that did not render, a browser console error, a `/s/**` page that does not name its shop, an image
with neither dimensions nor lazy loading. The persona doc's softer lines stay a human's reading — a
bot guessing at those would file opinions into a tracker one person reads.

**It may file three issues a week, and stops filing at forty.** The volume policy is
`scripts/persona-bots/findings.mjs`, unit-tested in `findings.test.mjs`: one issue per finding
*class* however many surfaces it fires on, a comment rather than a second issue when the class is
already open, never a re-file once a human has closed it, three new issues per run, and nothing at
all once the `needs-triage` inbox is at forty. Every rendered body is put through
`findIssueProblems` — the same function `pnpm check:follow-ups` runs over the live tracker every
day — before anything is filed, because one malformed issue fails that scan for everyone. ADR
[20260907-persona-bots-file-under-a-ceiling](../architecture/decisions/20260907-persona-bots-file-under-a-ceiling.md)
carries the reasoning and the numbers.

**Forty means forty *awaiting triage*.** An issue also carrying `parked` or `waiting-on-external`
has been read and deliberately deferred, and does not count against the brake — parking is an act of
triage, and triage is what the ceiling exists to reward, so ten parked findings must not silence the
walk forever (#1497). Those issues are still deduplicated against: a class whose issue is parked gets
the ordinary comment, never a second issue. The run summary states both numbers on every run, braked
or not, so the difference between the two is visible rather than inferred. The ceiling itself did not
move; forty is changed by deciding it is wrong.

**An opt-in second pass judges rather than measures** (#1498). `pnpm persona:bots --judge` — off by
default, and reachable in CI only from `workflow_dispatch`, never from the Monday cron — reads the
screenshots the walk already took back against two personas' own sections of
[personas.md](../product/personas.md): Nadia's and Kai's, whose "hold the line on" lists are almost
entirely about words on a screen. `scripts/persona-bots/judge.mjs` builds the prompt, drops any
finding that names a surface the persona was not shown or quotes nothing off the screen, and
fingerprints on the persona, the stop, and a *normalised* claim, so two runs that say the same thing
in different words collide and a closed judged issue is never re-filed. Judged findings sit in the
last severity band, below every mechanical one, so they can only ever spend issue budget the
measurements did not. Every other rule — the brake, the comment ceiling, the suppression, the
`findIssueProblems` self-check — applies to them unchanged. With the flag off nothing here runs and
the walk takes exactly the screenshots it always did. ADR
[20260907-persona-bots-file-under-a-ceiling](../architecture/decisions/20260907-persona-bots-file-under-a-ceiling.md)'s
"The judged pass" section carries the reasoning.

Like the one-day simulation it is the e2e fleet's own machinery under a config of its own:
`scripts/persona-bots/playwright.config.ts` starts a worker server on this checkout's port block,
`walk.spec.mts` drives it, and the screenshots come from `scripts/screenshot.mjs` rather than a
capture driver written for the occasion. **Nothing in it is a gate**, in either direction: a
finding is data written to `persona-bots/findings.json` and never a red test, and every way the run
can break — no browser, no build, an incomplete walk, an unreachable `gh` — prints `DID NOT RUN` or
`DID NOT FILE` with the reason and exits 0.

`.github/workflows/persona-bots.yml` runs it at 07:00 UTC on Mondays (and on `workflow_dispatch`,
which offers a dry run), builds once, and uploads `persona-bots/` whether or not the walk finished.
Options: `--dry-run` (shape the issues and print them, file nothing — what a session runs),
`--judge` (the opt-in judged pass; needs `ANTHROPIC_API_KEY`, and prints `DID NOT JUDGE` and carries
on without it), `--no-build`, `--keep`, `--out <dir>`.

### Coverage floors

`vitest.config.ts` measures coverage only with `--coverage.enabled`, and only on the safety
files: every non-test `src/lib` and `src/db` file the `dive-domain-expert` patterns in
`scripts/check-pr-body.mjs` match (minus seed and copy files), plus `trips`, `authz`, `checkouts`,
`refunds`, `promo-caps` and `account-security` (`scripts/coverage-safety-files.mjs`). CI's four unit shards run with
`--coverage.enabled --reporter=blob`; the `coverage-floors` job merges the blobs (`vitest run
--merge-reports --coverage.enabled`, no second test run) and runs `node scripts/coverage-floors.mjs`,
which fails when a file's branch coverage falls below its floor in `scripts/coverage-floors.json`. On a pull request that changed none of the safety files, their tests or the shared harness (`scripts/coverage-relevant.mjs`, the `changes` job's `safety` output) the shards run without coverage and the job is skipped; a push to main always runs both.
A higher reading prints "can rise" and passes. The merged summary is the `coverage-summary`
artifact, so a floor can be raised without a local full run. Locally: `pnpm coverage:floors` (a full
unit run).

Floors only rise: `--write <summary>` banks rises and refuses falls; `--write --absorb "<why>"`
records a fall with its reason. The first floors for the original eleven (2026-10-15, branch coverage): readiness 97.07%,
trip-admission 97.61%, lib/waivers 93.39%, roll-call 83.33%, lib/trips and lib/authz 100%, bookings
86.41%, checkouts 87.29%, refunds 83.15%, promo-caps 75%, account-security 81.81%; the rest were seeded on 2026-11-01 from their measured values. ADR
[20261015-coverage-and-mutation-testing](../architecture/decisions/20261015-coverage-and-mutation-testing.md);
mutation testing was cut by [20261101-cut-mutation-testing](../architecture/decisions/20261101-cut-mutation-testing.md).

### Why `playwright-core` is pinned in devDependencies

`playwright-core` is declared explicitly at the exact version `@playwright/test` resolves to. It is
not a dependency anything imports directly. It was added to decide which copy `@axe-core/playwright`
bound its `playwright-core` **peer** to: without it, two copies sat in the tree (`@playwright/test`'s
and the exact alpha `@playwright/mcp` pins), and `AxeBuilder` wanted a `Page` from the other copy, a
hard `tsc` error that turned `main` red after a routine bump. The axe package went on 2026-10-24;
the pin stays so the tree keeps one browser driver.

Keep the pin equal to `@playwright/test`'s version when either moves. One browser driver in the
tree is also what ADR 20260730-pinned-browser-visual-determinism assumes.

## The route coverage ledger

`pnpm check:route-coverage` (part of `pnpm check:repo`) checks static source associations for every
`src/app/**/page.tsx` route: an `e2e/*.spec.ts` file and an `e2e/visual-*.spec.ts` capture, or a written
`exempt` reason for the half it lacks. A spec's path literal associates it with a route; a capture
uses the last such literal within its test. These associations are candidates for coverage, not
proof that a route was visited or a capture ran. A capture never counts as a route's flow spec.

The ledger's `a11y` column has been empty since the suite's scans were removed (2026-10-24,
[above](#what-each-layer-is-for)). `scripts/route-coverage.json` retains explicit click-reached
associations and written exemptions for what source inference cannot resolve.

It exists because a page with no test is silent by construction: it produces no failure for anyone
to notice. A 2026-08-03 evaluation of the test system found three staff pages that had shipped with
neither an e2e spec nor a visual capture — `/shop/[shopSlug]/orders/new`,
`/shop/[shopSlug]/dive-sites/catalog`, and `/shop/[shopSlug]/staffing`. All three have since been
covered. Closing an exemption means writing the missing coverage and deleting its reason in the
same change.

The hand-written half is the part no string shows. A spec sometimes reaches a route by *clicking* —
`e2e/waivers.spec.ts` gets to `/waivers/[token]` by pressing "Send waiver" and following the link out
of a toast — and guessing those would invent coverage, so they are named by hand. A path literal
that associates a spec with a route needs no edit: the ledger used to list every route's specs by
hand, and it was the file every feature layer of a stack conflicted on.

```bash
node scripts/check-route-coverage.mjs            # the gate
node scripts/check-route-coverage.mjs --report   # per-route table, derived and hand-written: ok / GAP / EXEMPT
node scripts/check-route-coverage.mjs --write    # prune the file back to its exceptions
```

`--write` is a ratchet, like `scripts/check-copy.mjs`. It drops an entry for a deleted route, drops
hand-written names from a column the tree now covers for that route, and banks a closed gap by
removing an exemption the route has outgrown. It never writes an entry for a new route and never
adds an exemption — an uncovered route stays red until someone writes a test or types a reason — and
if a hand-named spec or capture has vanished it refuses and says so; `--absorb` is the loud escape
hatch for the one honest case, a merge from a branch that deleted it.

## The test database is a snapshot, not a boot

Database-backed tests call `seededTestDb()` / `seededShopContext()` from `@/test/db`. They still
get a fully isolated in-memory PGlite database per test — but it is hydrated from a template
snapshot (migrated + demo-seeded, built once per run by `src/test/global-setup.ts` and cached in
`node_modules/.cache/diveday/`), not by replaying migrations per test. Replaying was ~3s per test;
hydrating is a few hundred milliseconds. Two rules keep this sound:

- Never cache or share a database across tests; call the helper per test.
- Don't call `createTestDb()` + `seedDemo()` directly in tests — that's the slow path the helper
  exists to avoid. (`createTestDb()` alone is fine for the rare test that wants an *unseeded* db.)

The snapshot is keyed on a content hash of `drizzle/`, `src/db/` and the frozen test clock, and
never expires: the demo seed is clock-anchored (one trip always sails *today*), but it reads time
only through the frozen `DIVEDAY_CLOCK`, so rebuilding it tomorrow produces the same bytes. CI
restores `node_modules/.cache/diveday/` from `actions/cache` under the same inputs, so a unit shard
only rebuilds the two snapshots (initdb, every migration, the seed — twice) when one of them moved.

### One database per file, when a file can take it

`seededTestDb()` hydrates per **test**. `fileScopedShopContext()` hydrates per **file** and gives
each test a transaction that is rolled back afterwards — the same isolation, arrived at differently,
and typed as `AppDb` so query code needs no change:

```ts
const ctx = fileScopedShopContext();

it("…", async () => {
  const { db, shop } = ctx;   // `db` is this test's transaction
});
```

Measured on 2026-09-02 across the three files converted so far (`trips-queries`, `readiness`,
`divers` — 132 tests): **109.3s of test time down to 12.8s**, and 48.8s of wall-clock down to 11.2s.
The 38 database-backed files under `src/db` carried 849 of 988 test-seconds in a measured CI shard,
so this is most of the unit suite's cost.

On 2026-10-10 the 76 heaviest files still hydrating per test were converted (code review
2026-10-10, finding 6). The ten heaviest, each run alone on one loaded machine before and after:
3,480s of wall-clock down to 833s — `waivers` 447s to 96s, `checkouts` 501s to 90s, `manifests`
549s to 106s, `orders` 477s to 60s, `notifications` 354s to 44s, `reporting` 337s to 57s,
`executed-dives` 252s to 80s, `courses` 221s to 91s, `stripe/route.replay` 170s to 57s, and `seed`
172s to 152s (most of `seed` is the reset and seeding it tests, on unseeded databases).

**The rollback is the whole mechanism**, so a *test* that needs a committed database, or its own
transaction semantics, takes its own `seededShopContext()` while the rest of its file shares the
file's. The exception is made per test, not per file: a file's setup helper takes
`{ fresh = false }` and returns `fresh ? await seededShopContext() : ctx`, and the one test that
needs it calls `context({ fresh: true })`, with the reason in a comment beside `ctx`. Four cases,
the last of which is the surprising one:

- **A test that opens its own transaction** gets a savepoint instead of a top-level one — and the
  outer transaction has already frozen `now()`. `src/db/manifests.test.ts`'s same-transaction,
  same-timestamp tie-break tests would still pass and prove less, and so would any test that needs
  `created_at` to advance between two writes (`src/db/tips.test.ts`'s "most recently started"), or
  forces a `created_at` tie on purpose (`src/db/waivers-trip-status.test.ts`).
- **Concurrency races** (`Promise.all` of two calls that each write). Inside one transaction their
  nested transactions become interleaved savepoints on one connection, so the race proves nothing
  and can fail for reasons of its own.
- **A test that builds its fixture twice** and so collides with itself on a unique key
  (`src/db/diver-merge-preview.test.ts`).
- **A test that provokes a database error and keeps querying.** Postgres aborts the *whole*
  transaction on a failed statement (`current transaction is aborted, commands ignored until end of
  transaction block`, 25P02), so every line after an expected `.rejects.toThrow()` fails too — or
  worse, a second expected refusal passes for the wrong reason. In autocommit only the failing
  statement fails. `src/db/divers.test.ts`'s erasure test and `src/db/shop-subscriptions.test.ts`'s
  two "another shop holds this Stripe id" tests take their own for this reason.

A file whose tests mock `getDb` or hydrate an *unseeded* database (`unseededTestDb()`, for the seed
itself) keeps those tests as they are; the rest of the file still shares one.

### When a db-backed test suddenly takes twelve times as long

`seededTestDb()` falls back to `initdb + migrate + seed` — about **8.5 seconds per test**, against a
hydration's ~0.7s — whenever there is no usable snapshot. Nothing fails; the run just gets twelve
times slower, and the first thing anyone sees is a test tripping the 20-second `testTimeout` on a
suite that was fine yesterday. **It now says so**, once per worker per variant, naming both causes:

- **Global setup did not run** — a foreign Vitest config, or a runner invoked directly. The
  documented case.
- **The snapshot is missing, empty, or being rewritten.** This repo expects parallel sessions in one
  working directory (AGENTS.md's *Parallel work*), and worktrees can share a single `node_modules`
  volume — which is why `DIVEDAY_TEST_CACHE_DIR` exists. A second Vitest invocation whose fingerprint
  misses rebuilds both ~70MB snapshots, so a reader can land mid-write.

Two things make that window safe rather than mysterious, both added while investigating #1157.
`ensureTestDbTemplate` writes to a sibling temp file and `rename`s onto the live path, so a reader
sees the whole old snapshot or the whole new one and never a prefix of either. And `templateBytes`
answers `null` for a **zero-length** read: an empty `Uint8Array` is truthy, so it used to sail past
the `if (!bytes)` fallback and reach PGlite as an empty tar, which throws `Error: PGlite failed to
initialize properly` — a message naming neither the cause nor the fix.

Vitest defaults to the `node` environment. A test that exercises browser APIs (DOM rendering,
IndexedDB, `navigator`) opts in with a `// @vitest-environment jsdom` docblock on line 1.

## The real-Postgres suites

PGlite is the right default for everything above, but it is **single-connection**, and it is not the
engine production runs. Two claims are therefore unprovable on it, and both were live gaps:

- **The migrations had never met a real server before the production deploy did.** PGlite satisfies
  `CREATE EXTENSION pg_trgm` out-of-band, with a wasm extension loaded in JavaScript before any
  migration runs — so `drizzle/` could contain Postgres-invalid SQL and the whole suite stays green.
- **No `FOR UPDATE` in `src/db/` had ever been contended.** Two transactions cannot sit in the same
  critical section on one connection, so the oversell guard in `createBookingRecord` and the
  serialization in `withBookingPaymentLock` could both be deleted without a single test failing.
  `src/db/money-replay.test.ts` states the same limitation from the money side.

The `src/db/*.postgres.test.ts` suites close those — all opt-in, all skipped unless a server is
named, and all picked up by that glob rather than by a list anyone has to remember to update:

| File | Proves |
| --- | --- |
| `migrations.postgres.test.ts` | `drizzle/` applies from empty, *and* on top of the previous release's schema, *and* both land on an identical schema (read from `information_schema`/`pg_constraint`, not from Drizzle's model) |
| `bookings.postgres.test.ts` | Two — and five — genuinely concurrent transactions racing for the last seat sell exactly the seats that exist |
| `account-security.postgres.test.ts` | Two and five competing sign-ins consume one recovery code once; different codes cannot resurrect each other; simultaneous sign-ins spend one TOTP step once |
| `integration-events.postgres.test.ts` | Two independent workers claiming one integration delivery award one claim and increment its attempt count once |
| `notifications.postgres.test.ts` | Two overlapping retry drains send one queued message once, while the provider remains suspended until the losing drain returns; final counters and payload cleanup agree |
| `payments.postgres.test.ts` | Two simultaneous payment writes leave one unbroken `booking_payment_events` chain rather than a fork |
| `refunds.postgres.test.ts` | Two — and five — simultaneous taps of Refund on one paid order reach Stripe exactly once; the losers are refused locally with `in_progress` rather than by Stripe's over-refund rejection (PAY-L3) |
| `roll-call.postgres.test.ts` | The counter marking a diver not here and the crew boarding them at the rail serialise on the booking row, so a standing `boarded` result and a released seat never both stand — the rail overrules the desk, and never refuses |
| `seat-lock-order.postgres.test.ts` | Seat writers meeting on one departure (an undo of a no-show, a counter check-in, a participant-type change, the rail boarding) take the trip and then the booking, so none of the pairs deadlocks (#2324) |
| `seat-locks.postgres.test.ts` | `lockSeatDeparture` parks a second counter action on the departure before it holds the seat, leaves a roll-call insert's `KEY SHARE` alone, and gives up a wait on a stuck departure in five seconds (`55P03`, `boundLockWaits`) |
| `work-orders.postgres.test.ts`, `waivers-templates.postgres.test.ts` | Two simultaneous tickets, or two saves of a release, get consecutive numbers; and neither waits behind an insert elsewhere in the shop, because the shop row is locked `for no key update` |
| `course-forms.postgres.test.ts` | Two course syncs in one shop, each holding its course insert's `KEY SHARE`, both finish with one form per title; with the shop locked `for update` Postgres kills one with `40P01` |
| `promo-caps.postgres.test.ts` | The last use of a capped code goes to exactly one of two checkouts |
| `waitlist.postgres.test.ts` | One diver joining a full departure's wait list twice at once leaves one person and one entry |
| `tips.postgres.test.ts` | One booking tipping twice at once asks Stripe for one session |
| `postgres-harness.postgres.test.ts` | The harness itself: finishing a test never terminates a connection that is still alive, and an unreleased `holdRowLock` gate does not hang teardown |

A new suite needs no wiring beyond the name: write `src/db/<thing>.postgres.test.ts` against
`@/test/postgres` and CI runs it. Do not add one outside that glob — it would skip in the unit shards
for want of `DIVEDAY_TEST_POSTGRES_URL` and never run anywhere else.

### Reading a race test correctly

These use `holdRowLock` + `waitForLockWaiters` from `src/test/postgres.ts`. A third connection takes
the contested row's lock first; the contenders are started and the test waits until Postgres itself
reports them all parked on it before the gate is released. Without that, "fire two promises and
assert one won" passes for a sequential run exactly as it does for a contended one.

**The gate establishes simultaneity; it does not detect the guard.** This is worth stating plainly
because the intuitive reading is wrong: a contender blocks on the gate whether or not the code under
test locks anything, because its `INSERT` takes a `KEY SHARE` lock on the referenced row during the
foreign-key check, and that already conflicts with the gate's `FOR UPDATE`. What catches a missing
guard is always the **outcome** assertion — the seat count, the event chain.

That is measured, not assumed. Deleting the `.for("update")` in `createBookingRecord` and rerunning:
`waitForLockWaiters` still passes, and the one-seat trip sells **2** seats while the two-seat trip
sells **5**. Deleting it in `withBookingPaymentLock`: both payment events come back claiming no
predecessor — a forked trail. Anyone tempted to simplify these tests should re-run that experiment
first.

For the same reason, **never order a race test's rows by a column that does not order the writes**.
`booking_payment_events.id` is `defaultRandom()`, `occurred_at` comes from the frozen clock and is
identical across contenders, and `created_at`'s `now()` is transaction-*start* time — the same
instant for two contenders released from one gate. An earlier draft of the payments test sorted by
`id` and passed about half the time. Assert the invariant (follow `previous_status` to rebuild the
chain), not an incidental storage order.

**A fake that returns instantly is not a stand-in for a network round trip, and the difference is a
flake.** `refunds.postgres.test.ts` asserts the losing taps are refused with `in_progress` while the
winner is away at Stripe. In production that call takes hundreds of milliseconds and the losers
certainly answer inside it; against a fake provider that resolved on the next microtask the winner
came straight back, asked for the order row again to write `status = 'refunded'`, and could be
granted that lock ahead of losers still queued — which then read a refunded order and answered
`not_paid`. Correct behaviour, different refusal, red test:
`in_progress, not_paid, not_paid, not_paid, refunded` turned up once in fifteen full-suite runs. The
fix is `tapsMeetingAtStripe`, which holds the winner inside the provider until every other tap has
answered, so the scenario the test describes is the scenario it runs. It counts a tap that *reaches*
the provider as having arrived, not only one that answered — otherwise deleting the guard (all five
claim, all five reach Stripe, none can answer) would deadlock and report a timeout instead of the
five idempotency keys that are the real evidence.

### The teardown may not drop a database out from under a live connection

`await pool.end()` does **not** mean the server-side connections are gone. pg-pool's shutdown removes
each idle client from its own bookkeeping synchronously and then calls the asynchronous
`client.end()` without waiting for it, so the promise resolves once a Terminate message has been
*queued* — measured on pg-pool 3.14.0, seven pools opened, queried and ended together left a live
backend behind in **153 of 200** iterations.

The teardown in `src/test/postgres.ts` used to follow that straight into
`DROP DATABASE … WITH (FORCE)`, which terminates whatever is still attached — so it was racing the
graceful disconnects it had itself just started. When the drop won, the surviving client took
`FATAL 57P01 terminating connection due to administrator command` with no query in flight, pg
re-emitted it as an unhandled `'error'` event on its pool, and the job died reporting
`Tests 9 passed (9)` and `Errors 1 error` in the same summary (observed on f476e58). Every assertion
in the suites had already passed; nothing they check could have caught it.

Teardown now waits for `pg_stat_activity` to report the scratch database empty and then drops it
without `FORCE`, so there is nothing left to terminate. `FORCE` survives only on the path where the
wait times out — a connection that never drained is a real leak, so that path drops the database
anyway (no orphans on the server) and then **fails the test** naming it. Two rules follow for anyone
touching the harness:

- **Every pool it creates gets an `error` listener.** A `pg.Pool` without one turns any death of an
  idle client into an uncaught exception that kills the worker; the harness collects them instead and
  reports them against the test that caused them. Collected, never swallowed.
- **A `holdRowLock` gate is released even if the test never releases it.** Its transaction otherwise
  never commits, its client never returns to the pool, and `pool.end()` — which *does* wait for
  checked-out clients — waits forever, so an ordinary assertion failure is reported as a teardown
  timeout. The safety release is an `onTestFinished` registered inside `holdRowLock`; Vitest runs
  those in reverse registration order, so it always runs before the teardown that closes its pool.

`postgres-harness.postgres.test.ts` holds both to account, and does it by arranging the race rather
than waiting for it: a race that fires on a small fraction of runs proves nothing when it does not
fire.

### Running the real-Postgres suites locally

One environment variable is the whole switch. It is deliberately **not** `DATABASE_URL` — that is
what `getDb()` reads, and `vitest.config.ts` and `src/test/global-setup.ts` both pin it to `""` so no
test can reach a real database by accident. Reusing it would point every unrelated test in the run at
the server.

```bash
docker run --rm -d --name diveday-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16

DIVEDAY_TEST_POSTGRES_URL=postgres://postgres:postgres@localhost:5432/postgres \
  pnpm exec vitest run --reporter=dot src/db/*.postgres.test.ts
```

Any Postgres 16 reachable by URL works — a local `initdb`/`pg_ctl` cluster is fine, and the account
needs `CREATEDB` because each test creates and drops its own scratch database. Run it against a
server holding anything you care about and it will happily create databases there; point it at a
throwaway.

With the variable unset, `describePostgres` registers a skipped suite: no connection attempted, no
service required, `pnpm check` and CI's four unit shards completely unaffected. If these ever *fail*
rather than skip on a plain `pnpm test`, that is a bug in the harness, not a missing server.

The second migration test needs real git history (it reconstructs the previous release's `drizzle/`
tree via `scripts/previous-release-migrations.mjs`) and **throws rather than skips** when it cannot
resolve a base commit — deliberately, so a too-shallow clone cannot quietly turn it into a test that
proves nothing. On a shallow local clone, `git fetch --unshallow`.

### In CI

The `real-postgres` job in `.github/workflows/ci.yml` runs them all against a `postgres:16` service
container. It is gated two ways: on any PR touching `src/db/**`, `drizzle/**`, or the harness, and on
a nightly `schedule:` regardless of the diff — because what invalidates the proof usually arrives
from another branch. Every pre-existing job in that workflow carries
`if: github.event_name != 'schedule'` so the nightly runs this job and nothing else; those guards are
load-bearing. What the job does *not* prove — anything involving production data volumes — is in
[deploy-and-migrations-runbook.md](deploy-and-migrations-runbook.md#what-ci-rehearses-and-what-it-still-doesnt).

`vitest.config.ts` sets `pool: "threads"` (Vitest 4 otherwise defaults to `forks`, one child process
per test file): reusing one process across files skips Node's startup and the module-graph re-import
(Next, Drizzle, PGlite's WASM) that every fresh fork repays, without weakening per-file isolation —
`isolate` still gives each file its own module registry regardless of pool. Measured ~13% faster on
the full suite locally with identical pass counts across repeated runs.

## Conventions

- **A spec never quotes a sentence.** A `getByText`/`toContainText` string of 40+ characters is
  counted per file by `pnpm check:e2e-hygiene` (`e2e-long-literals` in `scripts/ratchets.json`,
  testing review decision 8): the count may only fall, so a new one is refused. Find the element by
  role and name, or read the sentence from its bundle by key (`diverTranslator("en-US")`,
  `staffTranslator("en-US")`; `.claude/rules/e2e.md` shows both). Seed data (a shop's tagline, a
  diver's review) is not copy: import its constant from the seed, or quote fewer words.
- **Prefer `getByRole`/`getByLabel` over `getByText` in Playwright specs**, but don't hand-roll the
  visibility filter — `e2e/fixtures.ts`'s `page` fixture patches `getByText`, `getByRole`,
  `getByLabel`, and `getByPlaceholder` to `.filter({ visible: true })` automatically, so a
  React `<Activity mode="hidden">` boundary (`cacheComponents`, on since
  [ADR 20260801-cache-components-e2e-activity-migration](../architecture/decisions/20260801-cache-components-e2e-activity-migration.md))
  can't strict-mode-fail a `page.<query>(...)` call against a hidden previous route. A raw
  `.locator()` used as a final matcher, or a second actor's page opened via
  `browser.newContext()`/`context.newPage()` (wrap it with `makeActivitySafe(...)`, also exported
  from `./fixtures`), aren't covered by the fixture and need the filter or wrapper at the call
  site. See the **e2e-and-visual** skill for the full pattern and its exceptions (elements with no
  layout box, intentional hidden-element assertions).
- **Time and zone are explicit.** Any date/time test passes an explicit `timeZone`; never depend
  on the runner's locale or clock. Fixed dates, not `new Date()`.
- **E2E keeps real application boundaries and disables third-party HTTP.** Exercise Next, auth,
  and the isolated PGlite database together. Test provider adapters with injected fakes in Vitest;
  do not add browser-level service-worker mocks for server-side providers.
- **E2E staff tests reuse a per-worker session.** Each worker signs in through the real form
  once (`ownerStorageState` in `e2e/fixtures.ts`) and staff specs opt in with
  `signedInAsOwner()` at file or describe scope instead of walking the sign-in form per test.
  `auth.spec.ts` — and the mid-flow sign-out/sign-in legs of the booking loop — still exercise
  the live form; tests that must start signed out simply don't opt in.
- **E2E runs parallel against a precompiled server fleet.** `pnpm e2e` builds once (`next build`)
  and Playwright starts one `next start` server per worker, each with its own in-memory PGlite
  database (`e2e/servers.ts`, `playwright.config.ts`). Precompiled routes avoid the dev-mode
  first-hit compile; the isolated per-worker databases let specs run `fullyParallel`. Every spec
  imports `test`/`expect` from `e2e/fixtures.ts`, not `@playwright/test` directly — the fixtures
  point each worker at its own server and reset the demo shop's schedule (`POST /api/test/reset`)
  before each test. A server's first reset is a real `resetDemoSchedule` and copies what it wrote;
  every later one runs the delete half and replays that copy (`src/db/demo-reset-snapshot.ts`, ADR
  20261024-e2e-reset-replays-a-snapshot), and says in a `Server-Timing` header how it was served and
  what it cost. Iterating on a
  single spec, `playwright test <spec>` reuses the existing build; `next start`'s production runtime
  needs `AUTH_SECRET`/`AUTH_TRUST_HOST` and the `DIVEDAY_E2E` reset opt-in, which the config supplies.
- **The reset restores the shop's schedule, not its settings — and a spec that writes settings takes
  a shop of its own.** `resetDemoSchedule` puts back trips, bookings, waivers, roll call, the roster,
  the catalog and the promo codes, so a spec that cancels a departure or fills a boat leaves nothing
  behind. It deliberately does not put back the shop's configuration: four shop-scoped tables
  (`shop_backup_destinations`, `shop_backup_deliveries`, `shop_whatsapp_accounts`,
  `media_deletion_attempts`), every `shops` column but three, and the shifts and calendar feeds of
  the permanent staff. The list is `RESET_KEEPS` in `src/db/delete-path-coverage.test.ts`, and it
  fails when a new shop-scoped table joins it without a written reason. A test writing any of those
  asks for the `privateShop` fixture (`e2e/fixtures.ts`), which mints a whole seeded shop for that
  one test and signs in as its owner; the next test's reset purges it. See ADR
  20260815-per-test-private-shops for why this is per test rather than per file, and why a
  `finally` that restores the setting is not the answer.
- **Every `/api/test/*` route is guarded, and that is enforced.** The harness's own endpoints
  (`reset`, `depart-trip`, plus the `seed-*` routes) reset and seed state and mint real tokens — `seed-account-token`
  hands back a valid password-reset or invite token for any account by email — so each handler must
  open with `e2eTestRouteAuthorized(request)` (`src/lib/e2e-test-routes.ts`: env predicate plus a
  `DIVEDAY_E2E_SECRET` bearer token, failing closed). `pnpm check:e2e-fixtures` fails when a handler
  under `src/app/api/test/**` doesn't call it, and each route carries auth-gate unit tests asserting
  the refusal lands before any database work.
- **Visual regression freezes the clock, never masks.** The `e2e/visual-*.spec.ts` files photograph each
  surface through `capture()` (or `capturePrint()` for the dock surfaces). Nothing is masked: the
  server clock is pinned by `DIVEDAY_CLOCK` and the browser clock by fixture setup, so
  clock-derived text is pixel-stable and a regression in a date stays visible. Each capture first
  waits on the heading or control it photographs, so a moved heading fails the capture as a test;
  a changed look never does: it is a reg-suit diff against the S3 baseline for the fork point.
  `pnpm visual` runs the capture and `reg-suit run`. There is no local baseline to update:
  merging is what makes a change the next baseline.

## Adding a test

Unit: create `thing.test.ts` next to `thing.ts` — Vitest picks it up. Component: same, `.tsx`,
setup already imports jest-dom matchers. Fetch boundary: same, using `msw/node`'s `setupServer` —
see `src/lib/offline-manifest-store.test.ts`. E2E: add `e2e/flow.spec.ts`, importing `test`/`expect`
from `./fixtures` (not `@playwright/test`) so it gets the per-worker server and per-test reset; the
config builds and boots the server fleet itself. Request-level: a test in the spec that owns the route, taking
the `request` fixture instead of `page` (`e2e/seo.spec.ts`), with `maxRedirects: 0` to read a
redirect's own status and `location`.

A new e2e spec or visual capture that reaches its routes by URL is credited to them with no edit. One
that reaches a route only by clicks names itself on that route's entry in
`scripts/route-coverage.json` — the same change, not a follow-up. If it closes a gap, delete that
route's `exempt` line while you are there (`--write` does).

### Measuring fixture cost

Run `node --import tsx src/test/db-template-profile.ts .agent-out/fixture-profile.json` to measure
fingerprinting, cache lookup, any rebuilt variants, snapshot reads, and PGlite hydration on the
current machine. This explicit diagnostic writes one JSON file and closes every database it
opens. Normal tests remain quiet. It records durations, variant names and byte counts only;
no rows, credentials, or environment values. Compare repeated observations with the same input
and machine before narrowing the conservative fixture fingerprint.

Form source-policy sweeps live in `src/components/ui/form-source.test.ts`, selected by the
existing `guards` project. `form.test.tsx` holds the rendered behavior tests. The existing
`check-form-controls.mjs` guard still owns placeholder labels and action-submit rules, once in
`check:repo`. Booking diver-detail queries live in `src/db/bookings-diver-details.ts`; callers
continue importing the stable public exports from `src/db/bookings.ts`.
