# What each `pnpm check:repo` guard refuses, and why

`scripts/check-repo.mjs` runs 45 guard scripts concurrently and reports every failure in one
pass. **Nobody needs to read this file to run the check** — a failing guard names itself and prints
the offending line. Read the matching section below when you want the reasoning behind one: what it
protects, the incident that produced it, and the escape hatch for a line that genuinely means the
shape being refused.

Only the 24 guards whose reasoning is not obvious from their own failure message are
written up here. The rest say everything they need to say when they go red.

This is the long-form half of one row in [AGENTS.md](../../AGENTS.md)'s command table, and it lives
here rather than there because every session loads AGENTS.md in full and almost none of them needs
this. A session that does need it is one whose check just went red, and it arrives already holding
the guard's name.

## The full roster

environment, architecture/feature-module, design-token, tinted-ink, type-ramp, voice, logical-property, clock, transaction-concurrency, timezone, Intl-cache, image-sizes, ADR, design-canvas, doc-link, locale-coverage, hard-coded-copy, bundle-reach, domain-layer-copy, route-coverage, loading-skeleton, uuid-path-segment, notice-code, scroll-preservation, exit-curve, soft-delete-vocabulary, shop-word, live-trip-read, departure-buffer, destructive-migration, migration-graph, e2e-hygiene, follow-ups, agent-layer (skills/index/task-context), Open-Graph-site, infra-ASCII, stack-CI-skip, CI-change-detection and Node-version safeguards.

## The guards worth reading about

### Node-version

The Node-version one (`scripts/check-node-version.mjs`) holds the three numbers that say which Node this project runs on — `NODE_MAJOR`, `NODE_FLOOR`, `LAMBDA_NODE_MAJOR` — and refuses any of the ten declarations that drifts from them: `engines.node`, `.nvmrc`, the CI setup action's `node-version:` **and its own description prose**, the README's Quickstart line, the `@types/node` major, every `lambda.Runtime.NODEJS_*_X` in the stack, the esbuild bundling target beside them, the one test that asserts a synthesized runtime, and — the one rule here not about Node — the pnpm version, which the README also claims is pinned and which follows `packageManager` rather than a constant. Change the numbers here first; the guard then names every file still to follow. It exists because six declarations disagreed and only one was enforced (issue #1326, ADR 20260903-node-24-is-the-floor), and because the consequence of the drift was not cosmetic: `engines` is warn-only, pnpm writes that warning to **stdout** as the first line of `pnpm install` and every `pnpm <script>`, and that is how two MCP servers launched through `pnpm` had their JSON-RPC handshake corrupted and cost every session a 30-second connect timeout each (fixed in #1324; `check:agents`' check 8 keeps `.mcp.json` off package managers). Two details worth knowing before editing it. The floor is `24.15.0` rather than `24.0.0` because `jsdom@30` declares `^22.22.2 || ^24.15.0 || >=26.0.0`, so a `>=24.0.0` field admits versions the tree cannot install on — a floor rounded down to `.0` is the same false declaration one level down, and it is derived by a test from every installed manifest that declares an `engines.node`, rather than asserted here. And the Lambda major is a *separate* constant from the toolchain major, deliberately: AWS publishes and retires runtimes on its own schedule, so the two can legitimately diverge, and the guard's job is to make that a decision rather than an accident. A missing declaration file fails rather than passes — a guard that reads a deleted `.nvmrc` as "nothing to check" goes green exactly when the pin it protects is gone.

### CI-change-detection

The CI-change-detection one (`scripts/check-ci-change-detection.mjs`) reads the `filter` step of `.github/workflows/ci.yml`'s `changes` job and pins *how it asks* what a pull request touched: the base resolves by **ref**, never `github.event.pull_request.base.sha`; a push to main keeps its own range off `github.event.before`; and every `git diff --name-only` range is three-dot. It is a guard rather than a comment because the failure is silent in the direction that costs money. `base.sha` is the base *as recorded when the pull request was opened* and never advances, while `actions/checkout` hands the job `refs/pull/N/merge` — which already contains everything main merged since. So `base.sha` is an ancestor of HEAD, `merge-base(base.sha, HEAD)` is `base.sha` itself, the three-dot form degenerates, and main's own new files are reported as the branch's. Nothing goes red: change detection fails **open**, so the whole gate simply runs. On #1291 — two lines under `docs/design/canvases/` — that meant the build, four Playwright shards, four visual shards, reg-suit and real-postgres, plus 196 changed and 8 new surfaces charged to a pull request that cannot move a pixel, every one of which AGENTS.md requires a reviewer to account for (issue #1295). Two traps the guard also holds: collapsing both events into one range makes `origin/main...github.sha` empty on a push, so main publishes no visual baseline and every branch cut from that commit resolves none (issue #1277); and a two-dot range reports every file main added since the fork as a *deletion*, which `--name-only` lists identically. The third trap is not checkable and is written at the call site instead — the step's checkout already ran `fetch-depth: 0`, so a `--depth=1` fetch of the base ref would graft a shallow boundary on and make `merge-base` compute against truncated history. This guard does **not** cover the second, independent cause of charged visual diffs on a *code* pull request whose base has moved: the capture shards shoot the merge commit while `scripts/reg-suit-keys.mjs` keys the baseline to the fork point. Correct detection only stops a docs-only branch reaching the compare at all.

### infra-ASCII

The infra-ASCII one (`scripts/check-infra-ascii.mjs`) refuses any non-ASCII character in the text a deploy carries out of this repo — all of `infra/`, plus `config/env-registry.mjs`, `scripts/render-env-example.mjs`, and the generated `.env.example`, since the credentials secret embeds that file at synth. Comments and string literals in those end up in a deployed CloudFormation template and Secrets Manager secret string, and something in that pipeline mangles non-ASCII: an em dash and two `≤`/`≥` symbols came back from a real deploy as `?` (ADR 20260812-diff-role-assumes-file-publishing-role). Everywhere else in the repo keeps its normal punctuation.

### destructive-migration

The destructive-migration one (`scripts/check-migrations.mjs`, also run by `scripts/vercel-build.mjs` before `pnpm db:migrate`) refuses a `DROP`/rename/type-change in any migration newer than the previous release unless the SQL itself carries a `-- diveday:allow-destructive <rule> <table>.<column>: <why>` line — migrations apply inside the production build while the *previous* release is still serving, and there are no down migrations (ADR 20260806-destructive-migration-guard).

### migration-graph

The migration-graph one (`scripts/check-migration-graph.mjs`, also run by `scripts/vercel-build.mjs` before `pnpm db:migrate`) runs `drizzle-kit check` over the committed `drizzle/` folder and refuses a tree with more than one open head whose branches touch the same object. drizzle-kit 1.0 keeps a full snapshot per migration folder naming its parents in `prevIds`, so `drizzle/` is a **DAG**, not a list: a branch cut from main today points at whatever main's head was then, and two migrations authored in parallel and merged normally leave two heads behind. Two columns added to `shops` in the same afternoon is all it takes — which is exactly what happened on 2026-08-22, and because the identical walk runs inside `drizzle-kit migrate`, the first thing to notice was the production build of `main` dying at 11:58 with a tree diagram, the change already merged and the only way forward a fresh commit. The fix is never to rewrite either migration: `pnpm db:merge` writes one folder whose SQL is empty and whose snapshot names every head as a parent, and a fork whose branches reach a common leaf is skipped by the walk. This check reads files and opens no connection; two branches that *genuinely* add the same column twice are caught by the `real-postgres` CI job, which applies every committed migration to a live server.

### Open-Graph-site

The Open-Graph-site one (`scripts/check-open-graph.mjs`) refuses an `openGraph` block under `src/app` that does not spread `openGraphSite` (or `sharedLinkCard`, which contains it) — Next merges `metadata` shallowly, so a page-level block *replaces* the root layout's and silently takes `og:site_name`/`og:type` with it. Six pages were in that state before 2026-08-12, and the marketing surface had lost its card image the same way in 2026-08-03; the failure only renders in someone else's chat window, and the e2e route lists that assert the tags are hand-maintained, so a page added tomorrow is not on them. A route that genuinely must not name the site says `diveday:allow-bare-open-graph: <why>`

### uuid-path-segment

The uuid-path-segment one (`scripts/check-uuid-segments.mjs`) requires every dynamic `[id]`/`[*Id]` route segment to be narrowed with `uuidParam()` before the page's first read — Postgres does not coerce a malformed literal in `eq(orders.id, $1)`, it raises, so a mistyped URL is a **500** where the page's own `notFound()` belongs two lines later. Twelve routes were in that state until 2026-08-14, including the unauthenticated `/s/<slug>/trips/[id]`, where an anonymous visitor could 500 a shop's booking page from the address bar. A `generateMetadata` in the same file runs its own read and needs its own guard, returning fallback metadata rather than calling `notFound()`. A segment that genuinely is not a uuid goes in the script's `NON_UUID_SEGMENTS` with its reason.

### transaction-concurrency

The transaction-concurrency one (`scripts/check-db-concurrency.mjs`) refuses a `Promise.all`/`allSettled` inside any function in `src/db`/`src/features` whose parameter is typed `DbExecutor` or `AppTransaction` — a drizzle transaction is **one checked-out `pg` client**, so that fan-out is not parallel: `pg` queues it and warns it will refuse it in pg@9, which reached production twice (issue #517 in `trips-schedule.ts`, then the 2026-08-14 counter check-in through `checkInBooking` → `listTripReadiness`). The fix it names is `queryAll` (`src/db/client.ts`), which asks the executor which one it is, **never** hand-serializing a hot roster read — and the rule stops at functions that can receive a transaction, because a reader that only ever takes `AppDb` is on the pool where the fan-out is real. A fan-out that genuinely is not over queries says `diveday:allow-db-concurrency: <why>` on the line.

### notice-code

The notice-code one (`scripts/check-notice-codes.mjs`) holds every literal staff `?notice=` code to `/^[a-z0-9-]+$/` — the raw query string, the second argument of `noticeUrl(…)`, and a `searchParams.set("notice", …)` alike — because the two halves of that pattern live in different files and the only thing joining them is the code spelling identically on both sides. It did not: three meanings existed in **both** casings at once until 2026-08-15, and `orders/new/page.tsx` emitted two casings of one concept on adjacent lines of a single ternary. A code with no matching map key renders **no banner at all**, which looks exactly like a dead link and fails nothing.

### scroll-preservation

The scroll-preservation one (`scripts/check-scroll-preservation.mjs`) enforces two invariants under one theme, "a same-page tap must never silently send the reader back to the top of the page or force a hard reload" (docs/design/forms-and-controls.md). First, `PreserveFormScroll` renders from `src/app/layout.tsx`, the root layout, and from exactly that one file — it used to be mounted separately in the staff shop shell, the public shop shell, and the trip-prep "ready" route, and any new bearer-token or account-lifecycle route silently got no scroll preservation until someone remembered to add it there too; reset-password, claim, invite, recap, unsubscribe, and verify all had exactly this gap. A second mount anywhere is that duplication creeping back, and a missing root mount is the whole mechanism gone. Second, no file under `src/` renders a JSX `href` of the bare fragment `#` or a `javascript:` pseudo-protocol — neither is inert the way it looks: a keyboard Enter still activates the anchor, and `#` under `target="_top"` is a real navigation. The booking-confirmation readiness link fell back to exactly this shape whenever no capability token had been minted, styled inert with `aria-disabled`/`pointer-events-none` under `target="_top"` — a mouse click was blocked, but a keyboard Enter replaced the shop's own top-level page with a dead fragment at the moment a diver had just paid; a review caught it before it shipped, and `EmbedBookedNotice.test.tsx` now pins the destination is always real. Both cases want a real `<button type="button">` or a real destination `href` instead; a line that must legitimately keep either shape says `diveday:allow-scroll-preservation: <why>`.

### soft-delete-vocabulary

The soft-delete-vocabulary one (`scripts/check-soft-delete.mjs`) refuses Archive/Unarchive/Deactivate/soft-delete in any message **key or value** under `src/i18n/locales/` — the bundles are the one door user-facing words come through, since `check:copy` already refuses hard-coded copy in a component. 49 strings were in that state until 2026-08-20, each trailed by a sentence explaining which history survived, and the vocabulary drifted back twice on its own because it is what the storage model is called in the code (`archiveCertification`, `waiver_templates.archived_at` — internal names stay out of scope, deliberately: nobody reads them — they were brought into line by hand on 2026-08-20 anyway). Each locale states its own word list and one with none is a **failure**, not a pass: Spanish `archivo` is the ordinary word for a *file*, so only `archivar`/`archivando`/`desarchivar` are refused there (ADR 20260820-every-delete-is-soft).

### bundle-reach

The bundle-reach one (`scripts/check-bundle-reach.mjs`) reports message-bundle keys **nothing can read**. `check:locale` proves every key exists in every locale and `check:copy` proves no sentence is hard-coded at a call site; neither proves a key has a reader, so a bundle grows dead copy silently and every deletion has to be re-derived by grep. Two were found by accident mid-recomposition — `requests.groupCount`, noticed only because the slice deleting its neighbours read past it, and `trip.crewPrediction`, orphaned when `ForecastSection` became `ConditionsLine` and worth a separate issue (#1110) to spot.

**The design question is the false positive**, and it is why this took a while to exist. A grep for `t("…")` alone reports every map-reached key as dead, and this repo reaches keys through `Record<…, StaffMessageKey>` tables on purpose — `READINESS_STATUS_KEYS`, `CARD_STATUS_KEYS`, `BUDDY_ALERT_KEYS` and a dozen more. Telling somebody to delete a live sentence is worse than saying nothing. So the rule is stricter and simpler than a call-site parse: **a key is reached if the tree holds a string literal equal to it**, which covers a `t()` call, a map value, an `as const` array and a helper that passes a key along, all without knowing which is which — because every one writes the whole key out. Nothing is prefix-matched.

The one exception is a key assembled at runtime (`` t(`switching.common.facts.${fact}.label`) ``), which has no literal anywhere. The static head of such a call is collected and every key under it is treated as reached — prefix matching, deliberately, because that prefix is *read out of a dynamic call* rather than guessed, and declining to decide is the only sound answer there.

Ratcheted like `check:copy` (`--write` / `--absorb` / `--report <path>`), because the first run found 135 keys across 12 bundles and a guard that goes red on arrival gets a baseline entry per file and stops meaning anything. **A baseline entry is a list to triage, never a list to delete on sight**: some will be a hole in the walk rather than dead copy, and each of those is a fix to the walk or an exemption with a written reason.

### shop-word

The shop-word one (`scripts/check-shop-word.mjs`) refuses `tienda` in any `es-ES` message value: in Spanish a dive shop is **el centro**, and `tienda` means *retail* — a string carrying it tells a diver their retail store will check their certification. `src/i18n/locales/es-ES/README.md` settled that in a 2026-08-03 sweep and calls its decisions binding "which is what stops two agents rendering the same word two ways"; the word came back anyway, and six strings were carrying it on 2026-08-21 — including `common.certification.levelDescription`, the one sentence explaining why the certification question is asked, on all three public forms at the point of sale. The pattern is anchored on a word boundary rather than a substring, which is what keeps `trastienda` (a shop's *back office*, all over the switching guides) and `entiendas` ("no firmes nada que no entiendas") out — the README warns in as many words not to let a find-and-replace on "tienda" eat the first of those. Only `es-ES` has an entity word to get wrong, so unlike the check above it demands no word list per locale.

### tinted-ink

The tinted-ink one (`scripts/check-tinted-ink.mjs`) refuses a `bg-<hue>/10` fill on an element whose own text is `text-<hue>`. That fill is **translucent**, so the colour the text is read against is the hue composited over whatever happens to be behind the element — and every ratio in `docs/design/forms-and-controls.md` was computed against `--surface`. Turning axe's `color-contrast` rule back on found 24 failing nodes on 2026-08-23 and every one was this: a status pill on `--background` rather than a card (4.21:1 where the table says 4.86), a `bg-primary/10` badge nested inside the green of a boarded row on `/check-in` (**4.09:1**, the worst in the app), and in dark mode a danger count badge inside the current nav tab's own primary tint. The fix is the opaque `--<hue>-tint` token, which resolves against `--surface` once and is the table's number wherever the element is mounted — or `Badge`, which does it for you. The check exists because the axe scan reaches about thirty routes and the pill that started this was on none of them; it matches the same element only and the `/10` fill only, since a parent's tint under a child's ink is invisible to a grep and the `/15` roll-call states render under `.boat-mode`, a different palette with its own measurements. A line that genuinely means the translucent form says `diveday:allow-tinted-ink: <why>`.

### type-ramp

The type-ramp one (`scripts/check-type-ramp.mjs`) refuses a **bare heading spelling** — a
`text-lg`/`xl`/`2xl`/`3xl`/`4xl` beside a `font-semibold`/`font-bold` — anywhere under `src/app` or
`src/components`. Headings take a named level from `src/components/ui/typography.ts` instead.

ADR 20260827-clearwater-surface-language decision 3 closed the ramp to seven levels. A grep on
2026-09-01 found **fourteen spellings** still typed at the call site: `text-lg font-semibold` 62
times, `text-3xl font-semibold` 27, and twelve more down to a single use. Two constants existed
(`SHELL_TITLE_CLASS`, `SectionCard`'s private `TITLE_CLASS`) and everything else picked its own
size, which is how `text-xl` and `text-2xl` section headings drifted in beside the `text-lg` the ADR
names.

Reading the fourteen is what shaped the guard. They were not fourteen drifting levels of one ramp —
they were **two ramps**, and the ADR excludes one of them from itself ("the marketing, legal and
error surfaces are also outside every recomposition here"). That second ramp was already uniform:
the marketing section heading was byte-identical at twenty-odd call sites. Unnamed, not broken. So
`typography.ts` names both, and this guard covers both, because a guard that stopped at the app's
half would leave the larger and more repetitive half of the drift surface unwatched.

Two details worth knowing when it goes red. It matches **either order** with up to forty characters
between the two classes, so `text-3xl tracking-tight font-semibold` cannot slip past a fixed-order
grep — that alone found six figures the issue's own grep had missed, including three the ADR
explicitly calls figures. And a `sm:`/`dark:`/`group-hover:` prefix is *not* a bare spelling: a call
site pairs a ramp constant with its own breakpoint step (`` `${BANNER_TITLE_CLASS} sm:text-4xl` ``),
which is where that decision belongs.

Ratcheted per file in `scripts/type-ramp-baseline.json` exactly like `check:copy` — `--write` banks
a fall and refuses a rise, `--absorb` records growth arriving from a merge, `--report` prints the
per-file table. It lands at zero, so it behaves as a full gate today; the ratchet is there for the
branch cut before the sweep, whose spellings are pre-existing debt rather than new drift. A heading
that genuinely is not on the ramp — a rendered email, an `ImageResponse` card Tailwind never reaches
— says `diveday:allow-type-ramp: <why>` on the line or the line above.

### voice

The voice one (`scripts/check-voice.mjs`) refuses the mechanical half of the list in
[docs/design/brand.md](../design/brand.md)'s "What gives us away": a **prose em-dash** (one between
two clauses of three or more words, or anywhere in a string carrying a sentence terminator), the
**intensifiers** (*actually, genuinely, simply, quietly, truly, seamless, effortless, robust,
empower, streamline, leverage*), the **lead-ins** (*here's how, the best part, rest assured, say
goodbye to, whether you're*), the **"not just" contrast**, and the **staccato run** of short
sentences that each begin "No". Every message bundle under `src/i18n/locales/`, per locale, and a
locale with no word list is a failure rather than a pass.

It exists because every word of DiveDay is written by a language model, and a language model has a
house style. On 2026-09-03 the marketing bundle carried an em-dash in one sentence out of five, the
"not a project, a file" contrast twenty-eight times, four "Here's how" lead-ins and a "No X. No Y.
No Z." pricing hero; the staff bundles carried 573 more prose dashes. Each sentence read well on its
own. Together they read as the voice a buyer has learned to skim, and a page that exists to be
believed cannot afford that. A regex cannot see an aphorism heading or a rhetorical question, so
those stay in the brand doc and the [brand-voice](../../.claude/skills/brand-voice/SKILL.md)
checklist; what it *can* see it refuses outright.

A short label separator is deliberately not a hit: "Boarded — tap again to undo" and "Checked in —
2" are not sentences, and the tell is the dash that replaced a full stop or a comma in running
prose. Ratcheted per file in `scripts/voice-baseline.json` exactly like `check:copy` (`--write`
banks a fall and refuses a rise, `--absorb` records growth arriving from a merge, `--report
[prefix]` lists every hit with its key and rule). It landed at zero, so it behaves as a full gate
today; the ratchet is there for the branch cut before the sweep.

### logical-property

The logical-property one (`scripts/check-logical-properties.mjs`) refuses a new `ml-`/`mr-`/`pl-`/`pr-`/`left-`/`right-`/`text-left`/`text-right`/`border-l`/`border-r`/`rounded-l`/`rounded-r` under `src/app`, `src/components` or `src/features`, ratcheted per file in `scripts/logical-properties-baseline.json` exactly like `check:tokens` — 126 across 62 files are grandfathered, the count may never rise, and a fall is banked with `--write`. `src/components` already carries ~190 *logical* utilities against those few dozen physical ones: somebody has been writing direction-agnostic layout for a long time and nothing protected it (issue #733). The stakes are nil today — both shipped locales read left to right, so `ml-2` and `ms-2` are the same pixels — and that is the point: the cost lands all at once on the day a third locale arrives, which is the shape of debt a ratchet is for. Comments are stripped before counting, because prose is full of "right-hand" and "left-aligned" and neither is a class. It is **not** a claim of RTL support: no RTL locale ships and nobody has looked at the app in one (docs/design/principles.md's "Writing direction").

### image-sizes

The image-sizes one (`scripts/check-image-sizes.mjs`) checks every `sizes` attribute under `src/` against the slot it actually fills, because the visual suite structurally cannot. `pnpm e2e:build` sets `DIVEDAY_E2E=1`, `next.config.ts` turns that into `images.unoptimized`, and Next's `generateImgAttrs` then returns `{ srcSet: undefined, sizes: undefined }` — so `sizes` selects from nothing, no capture can move, and the attribute is not even in the DOM for a Playwright assertion to read (which is what defeats the obvious fix of asserting `img.srcset`). That switch is right and stays: sharp's lossy re-encodes are not bit-reproducible between runs, which once made the course-page captures a permanent coin flip. The gap it leaves is silent in both directions — an over-declared `sizes` wastes a diver's bandwidth invisibly, an under-declared one ships a visibly soft photo — and it was found the day PR #1347 took a fetched candidate from 1080px to 384px for a 171px slot and reg-suit reported **0 differences across 732 surfaces with a baseline resolved**. A real comparison that could not see it.

So the check is arithmetic rather than pixels: it resolves what a browser would compute from the attribute at 390/768/1280/1920, and compares the **candidate that gets fetched** rather than the raw number — 352px declared for a slot measured at 355 lands on the same file and is not a defect, which is what keeps the tolerance a step of a discrete ladder instead of a percentage somebody has to argue about. One step of slack absorbs a container's own padding; two is a file nobody needed, and #1347's case was four.

A slot's width is known two ways. **Derived** is the half that cannot go stale: a bare `Npx` on an element whose own Tailwind class fixes its width (`size-12`, `w-32`) is read straight off the class, so resizing the element and forgetting the attribute fails by name. Six declarations are on that path. **Registered** is everything responsive — `scripts/image-sizes.json`, measured in a real browser against `pnpm dev`, where the optimizer is on and `sizes` does reach the DOM. That half genuinely can drift: change a container's `max-w-*` and the guard keeps checking the old number. It is the cost of the only shape where the optimizer switch is irrelevant rather than worked around, and an entry nobody has measured says `exempt` with a reason naming the surface, the way `scripts/route-coverage.json` does — a written gap beats a guessed number. Nine are exempt today, each naming what would have to be reachable to measure it.

Writing it found two live defects, which is the argument for it: a single published moment on a departure page rendered at 528px against a `17rem` (272px) declaration, and the course gallery declared `33vw` for cells that stop growing at 273px once their container hits its max width — 634px declared against 273px rendered at 1920, fetching a 1920px file where 640px covers it. Both are fixed in the same change.

### live-trip-read

The live-trip-read one (`scripts/check-live-trips.mjs`) fails any read of `trips` — a `.from(trips)`, or a join from one of the child tables that now survives a delete — that neither carries `liveTrip()` (`src/db/trips-live.ts`) nor says `diveday:allow-deleted-trips: <why>`. Deleting a departure stamps `trips.deleted_at` and leaves the row and its five children in place, and the table is read from 91 places; a reader that forgets the filter does not throw and does not fail a test written before the column existed, it shows an anonymous visitor a departure the shop took off the board. Joins from `bookings`, `tripWaitlistEntries` and the roll-call tables are outside the gate on purpose — `deleteTrip` refuses a departure carrying any of those, so no such row exists to arrive through.

### departure-buffer

The departure-buffer one (`scripts/check-departure-buffer.mjs`) refuses three shapes outside `src/lib/trips.ts`: an offset added to a `startsAt`/`endsAt` on a line that also *compares*; the same offset bound to a name and compared against *now* a few lines later; and any `*_BUFFER_MS` declaration. All three mean the same thing — somebody asked "has this sailed?" without going through `hasSailed()` / `hasReturned()`. The split-across-lines rule arrived in review: the first version matched only within one line, so `const cutoff = new Date(trip.startsAt.getTime() + HOUR_MS)` followed by `if (cutoff <= now)` was a prohibited check the guard called clean. Comparing a derived date against anything other than the clock is left alone, which is what keeps the seeds — full of exactly that arithmetic — out of it.

It exists because AGENTS.md's late-arrival rule was enforced by a sentence for as long as the rule existed, and a sentence does not scale. When the guard was written the hour was spelled **fifteen** times: nine separate `const … = 60 * 60 * 1000` declarations (`closeout`, `ready`, `today`, `roster-facts`, `find-my-booking`, `crew-requests`, `thread-steps`, the diver record's status split, and `COUNTER_DEPARTED_BUFFER_MS` at the walk-in counter) plus six bare literals compared inline in `bookings`, `blowouts`, `today`, `trips-overview` and the diver-facing departure page — behind three different predicate names.

The interesting part is that every one of the nine was *correct*, and every one carried a docstring citing the rule. What they did not have was a centre: `today` cited `ready`, `ready` cited `selfCancelBooking`, `roster-facts` cited the diver record, the diver record and `crew-requests` cited AGENTS.md, and `find-my-booking` said "same 1-hour buffer every other check uses". A ring of citations with no source is what a rule looks like shortly before one of its copies is edited alone. Two had already drifted: most sites treated the departure as gone at `startsAt + 1h` exactly, while the roster's "ahead" flag and the diver record's held it upcoming a millisecond longer — a difference nothing depended on, which is why it survived. `hasSailed` settles it on the majority reading (the boundary instant counts as past), and `src/lib/trips.test.ts` pins that instant.

The failure it catches is quiet and customer-facing: a site that forgets the hour does not throw and does not look wrong in review, it tells a diver standing on the dock at 07:05 that the 07:00 boat they are waiting to board is in their history, or turns away a walk-in the desk would have taken. The comparison operator is the anchor rather than the arithmetic because the seeds construct dates from a departure constantly and ask nothing about the clock. An offset that genuinely asks a different question says `diveday:allow-departure-offset: <why>` on the line or anywhere in the comment block above it; there is one, the recap's own delay in `src/lib/thread-steps.ts`, which waits its scheduled hours after a boat this rule has already counted as home.

### loading-skeleton

The loading-skeleton one (`scripts/check-loading-skeletons.mjs`) requires every `page.tsx` under `src/app` to have a sibling `loading.tsx`, and where both declare a container the two widths to match — the hard rule below and `docs/design/principles.md` §10, neither of which anything checked. A route with no boundary of its own does not go without one: Next falls back to the nearest **ancestor**, so the defect is a skeleton that is a picture of a *different page*. Three routes were in that state until 2026-08-23 — a diver tapping "83 reviews" watched the public schedule's day headers and departure rows at `max-w-6xl` before the page snapped to a `max-w-4xl` column of cards, and a staffer tapping "Add a dive site" watched the site *library* before landing on a narrow form. It is invisible in a diff (each page is individually fine; the missing file is the defect) and invisible locally, where the data is instant — it needs a cold navigation over a slow link. The width half compares the first `mx-auto w-full max-w-*` container each file declares and no further: a page that delegates its container to a component (`settings` re-exports `SettingsPage`) is reported as delegated and skipped rather than guessed at, and the counts print on success so the coverage is stated rather than implied. A route that genuinely needs no skeleton — the five with no ancestor boundary to fall back to — goes in the script's `SKELETON_EXEMPT` with its reason.

### exit-curve

The exit-curve one (`scripts/check-exit-curves.mjs`) holds every exit animation in `src/app/globals.css` to `--ease-in-soft`, the leaving curve. `docs/design/principles.md` §5 has said so since the schedule board's row menu was fixed, and three of the four exits in the file were still on the *arrival* curve weeks later (issue #756) — including `.toast-dismiss`, which fires on every reversible mutation in the app and is therefore the most-seen exit in the product. `--ease-out-soft` front-loads its travel, so an exit on it barely moves for three quarters of its duration and then vanishes: a jump, a dead pause, and a hard cut. Nothing swept for the other three because nothing could tell an entrance keyframe from a departing one, which is what makes the naming convention load-bearing rather than decorative: a keyframe animating something *away* carries `out` or `dismiss` as a hyphen-separated **word** — `slide-out-right` is an exit and a `-out$` suffix pattern misses it — and the selector is read as well as the keyframe name, so renaming a rule away from its keyframe does not slip past. The `animation-name:` longhand is refused outright rather than parsed, since splitting a name from its curve across two declarations is exactly how an exit would evade a check that reads the shorthand. Durations are **not** in scope; only the curve. It reads names, not travel, so an exit called `fade-away` is invisible to it — the cost of a rule a grep can check at all — and a keyframe that names itself an exit and genuinely is not one says `diveday:allow-exit-curve: <why>`.

### design-canvas

The design-canvas one (`scripts/check-design-canvases.mjs`) holds the mechanical half of [docs/design/design-artifacts.md](../../docs/design/design-artifacts.md), the conventions written when this repo got its first design drawn *before* the code (2026-08-27). Two silent failures are what it exists for: a canvas naming no ADR is a set of pictures nobody can hold code to — which collapses the split that whole document rests on, that pictures argue and **the ADR decides** — and the seeded canvas payload is a ~2.6 MB single file with the editor inlined, regenerable from the artboards beside it, trivially committed by accident because it is written into the same working directory as its sources. So every `docs/design/canvases/<YYYYMMDD-slug>/` needs a README carrying a status word and a link to an ADR that exists, artboards named `<Name>.dc.html` and each placed by `canvas.json`, and no file over 400 KB. It reads no artboard's contents: a picture is not checkable, which is the reason the ADR and not the canvas is normative

### follow-ups, and the third outcome

The follow-ups one (`scripts/check-follow-ups.mjs`) is the only guard here that makes a **network call** — `gh issue list` for every open `needs-triage` issue — and therefore the only one that can end in something other than pass or fail. It fails open by design: a commit is never blocked on GitHub's availability, which is the same refusal `pnpm check:e2e-hygiene` makes about the e2e suite.

What that cost, until 2026-08-28: `check-repo.mjs` labelled a check by its exit code alone, so a guard that had skipped printed under the same `ok` header as one that had validated, and the run still ended `check:repo: all checks passed`. `gh` is not installed in the remote containers this repo is mostly developed in, so that was **every local run there** — while a malformed `needs-triage` issue filed by another session was failing this same check on CI and reddening every open pull request. Several sessions read a fully green `pnpm check` with no way to learn that the one guard which would have caught it had never run (issue #1097). It is the shape AGENTS.md already names for visual regression: a zero visual count with no baseline resolved is nothing compared, not nothing wrong.

So a check has three outcomes. Exit 0 is `ok`, exit 1 is `FAILED`, and exit **2** is `SKIPPED` — its own header, the reason printed under it, and a summary line reading `all checks passed (1 skipped: follow-ups)` instead of claiming otherwise. The overall exit stays 0; nothing is blocked. Two things about that code are load-bearing: it is unreachable from any validation path in the script, so a genuine failure can never downgrade itself into a skip, and it is deliberately a **one-off for the network-dependent guard** rather than a mechanism any check may reach for — one that lets a check opt out of running is one a future check will use when it is merely slow.

When you see `SKIPPED`, the inbox was not validated. Run it where `gh` exists, or read the CI log.
