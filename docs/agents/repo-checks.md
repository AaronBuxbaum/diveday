# What each `pnpm check:repo` guard refuses, and why

`scripts/check-repo.mjs` runs 44 guard scripts concurrently and reports every failure in one
pass. **Nobody needs to read this file to run the check** — a failing guard names itself and prints
the offending line. Read the matching section below when you want the reasoning behind one: what it
protects, the incident that produced it, and the escape hatch for a line that genuinely means the
shape being refused.

Only the 27 guards whose reasoning is not obvious from their own failure message are
written up here. The rest say everything they need to say when they go red.

This is the long-form half of one row in [AGENTS.md](../../AGENTS.md)'s command table, and it lives
here rather than there because every session loads AGENTS.md in full and almost none of them needs
this. A session that does need it is one whose check just went red, and it arrives already holding
the guard's name.

## The full roster

environment, architecture/feature-module, design-token, tinted-ink, type-ramp, voice, logical-property, transaction-concurrency, image-sizes, ADR, design-canvas, doc-link, locale-coverage, hard-coded-copy, bundle-reach, domain-layer-copy, route-coverage, loading-skeleton, uuid-path-segment, notice-code, scroll-preservation, exit-curve, soft-delete-vocabulary, shop-word, live-trip-read, departure-buffer, capability-runbook, destructive-migration, migration-graph, e2e-hygiene, agent-layer (skills/index/rules/hooks/task-context), Open-Graph-site, infra-ASCII, CI-change-detection and Node-version safeguards.

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

The notice-code one (`scripts/check-notice-codes.mjs`) holds every literal staff `?notice=` code to `/^[a-z0-9-]+$/` — the raw query string, the second argument of `noticeUrl(…)`, a `searchParams.set("notice", …)`, a `notice === "…"` on the reader side, and a literal passed through a page-local helper that forwards its own parameter to `noticeUrl` (`done(path, notice)`, `backTo(base, notice, form?)`), at that parameter's position only and including both branches of a conditional there — because the two halves of that pattern live in different files and the only thing joining them is the code spelling identically on both sides. It did not: three meanings existed in **both** casings at once until 2026-08-15, and `orders/new/page.tsx` emitted two casings of one concept on adjacent lines of a single ternary. A code with no matching map key renders **no banner at all**, which looks exactly like a dead link and fails nothing.

### scroll-preservation

The scroll-preservation one (`scripts/check-scroll-preservation.mjs`) enforces two invariants under one theme, "a same-page tap must never silently send the reader back to the top of the page or force a hard reload" (docs/design/forms-and-controls.md). First, `PreserveFormScroll` renders from `src/app/layout.tsx`, the root layout, and from exactly that one file — it used to be mounted separately in the staff shop shell, the public shop shell, and the trip-prep "ready" route, and any new bearer-token or account-lifecycle route silently got no scroll preservation until someone remembered to add it there too; reset-password, claim, invite, recap, unsubscribe, and verify all had exactly this gap. A second mount anywhere is that duplication creeping back, and a missing root mount is the whole mechanism gone. Second, no file under `src/` renders a JSX `href` of the bare fragment `#` or a `javascript:` pseudo-protocol — neither is inert the way it looks: a keyboard Enter still activates the anchor, and `#` under `target="_top"` is a real navigation. The booking-confirmation readiness link fell back to exactly this shape whenever no capability token had been minted, styled inert with `aria-disabled`/`pointer-events-none` under `target="_top"` — a mouse click was blocked, but a keyboard Enter replaced the shop's own top-level page with a dead fragment at the moment a diver had just paid; a review caught it before it shipped, and `EmbedBookedNotice.test.tsx` now pins the destination is always real. Both cases want a real `<button type="button">` or a real destination `href` instead; a line that must legitimately keep either shape says `diveday:allow-scroll-preservation: <why>`.

### soft-delete-vocabulary

The soft-delete-vocabulary one (`scripts/check-soft-delete.mjs`) refuses Archive/Unarchive/Deactivate/soft-delete in any message **key or value** under `src/i18n/locales/` — the bundles are the one door user-facing words come through, since `check:copy` already refuses hard-coded copy in a component. 49 strings were in that state until 2026-08-20, each trailed by a sentence explaining which history survived, and the vocabulary drifted back twice on its own because it is what the storage model is called in the code (`archiveCertification`, `waiver_templates.archived_at` — internal names stay out of scope, deliberately: nobody reads them — they were brought into line by hand on 2026-08-20 anyway). Each locale states its own word list and one with none is a **failure**, not a pass: Spanish `archivo` is the ordinary word for a *file*, so only `archivar`/`archivando`/`desarchivar` are refused there (ADR 20260820-every-delete-is-soft).

### bundle-reach

The bundle-reach one (`scripts/check-bundle-reach.mjs`) reports message-bundle keys **nothing can read**. `check:locale` proves every key exists in every locale and `check:copy` proves no sentence is hard-coded at a call site; neither proves a key has a reader, so a bundle grows dead copy silently and every deletion has to be re-derived by grep. Two were found by accident mid-recomposition — `requests.groupCount`, noticed only because the slice deleting its neighbours read past it, and `trip.crewPrediction`, orphaned when `ForecastSection` became `ConditionsLine` and worth a separate issue (#1110) to spot.

**The design question is the false positive**, and it is why this took a while to exist. A grep for `t("…")` alone reports every map-reached key as dead, and this repo reaches keys through `Record<…, StaffMessageKey>` tables on purpose — `READINESS_STATUS_KEYS`, `CARD_STATUS_KEYS`, `BUDDY_ALERT_KEYS` and a dozen more. Telling somebody to delete a live sentence is worse than saying nothing. So the rule is stricter and simpler than a call-site parse: **a key is reached if the tree holds a string literal equal to it**, which covers a `t()` call, a map value, an `as const` array and a helper that passes a key along, all without knowing which is which — because every one writes the whole key out. Nothing is prefix-matched.

The one exception is a key assembled at runtime (`` t(`switching.common.facts.${fact}.label`) ``), which has no literal anywhere. The static head of such a call is collected and every key under it is treated as reached — prefix matching, deliberately, because that prefix is *read out of a dynamic call* rather than guessed, and declining to decide is the only sound answer there.

Ratcheted like `check:copy` (`--write` / `--absorb` / `--report <path>`), because the first run found 135 keys across 12 bundles and a guard that goes red on arrival gets a baseline entry per file and stops meaning anything. **A baseline entry is a list to triage, never a list to delete on sight**: some will be a hole in the walk rather than dead copy, and each of those is a fix to the walk or an exemption with a written reason.

### capability-runbook

The capability-runbook one (`scripts/check-capability-runbook.mjs`) fails when a bearer capability has no mention in [../engineering/capability-telemetry-runbook.md](../engineering/capability-telemetry-runbook.md), the rotate-and-revoke table an operator reads when a capability URL leaks. A capability missing from that file is a credential nobody can revoke under pressure, because the only index of them does not know it exists. The cost was measured rather than hypothetical: three live capabilities were absent at once — the `handoff` purpose, `/shelf/[token]` and `/gift/[token]` — while the file's own post-mortem sentence, a few lines above the table, said that "a list that silently omits an entry is how the `confirm` token stayed unprotected through the first CR-001 fix". That sentence was describing the present tense three times over and nothing went red; two stale claims about a closed redaction gap survived in the same document for the same reason, that no script opened the file.

Two decisions inside it are the reason this is written up rather than left to its failure message. It is keyed on **three** lists — `CAPABILITY_ROUTE_PREFIXES` and `CAPABILITY_QUERY_PARAMS` (`src/lib/capability-urls.ts`) and the `CapabilityPurpose` union (`src/db/booking-capabilities.ts`) — because the purpose union alone would have caught `handoff` and missed the other two, re-creating the same omission one table over. It reads them out of *source text* rather than importing the module: `CAPABILITY_QUERY_PARAMS` is module-local, and widening a module's exports to suit a script is the wrong direction. A list it cannot find is a failure, not a pass.

And it does **not** parse the Markdown table. `?gate=` is deliberately prose and deliberately not a row — its signature unlocks a sentence rather than a resource, so it is redacted for what its value says rather than as a bearer credential — and a guard permanently red on a correct entry gets routed around. So the bar is that the member appears in the file as its own word, table or prose, which is why the failure message has to say that a mention is not a row and that choosing between them is still the author's call. Delimited rather than substring, with a hyphen counting as part of the word, because the members are short and ordinary: otherwise "onboarding" covers `board`, "already" covers `ready`, "mitigate" covers `gate`, and `/confirm-contact` stands in for the `confirm` purpose. It is a **hard fail with no baseline**, unlike its ratcheted neighbours: the list is short, a new bearer capability is a rare and deliberate act, and a baseline would let the next omission live in a JSON file instead of in the runbook, which is this guard's own failure one file to the left.

### shop-word

The shop-word one (`scripts/check-shop-word.mjs`) refuses `tienda` in any `es-ES` message value: in Spanish a dive shop is **el centro**, and `tienda` means *retail* — a string carrying it tells a diver their retail store will check their certification. `src/i18n/locales/es-ES/README.md` settled that in a 2026-08-03 sweep and calls its decisions binding "which is what stops two agents rendering the same word two ways"; the word came back anyway, and six strings were carrying it on 2026-08-21 — including `common.certification.levelDescription`, the one sentence explaining why the certification question is asked, on all three public forms at the point of sale. The pattern is anchored on a word boundary rather than a substring, which is what keeps `trastienda` (a shop's *back office*, all over the switching guides) and `entiendas` ("no firmes nada que no entiendas") out — the README warns in as many words not to let a find-and-replace on "tienda" eat the first of those. Only `es-ES` has an entity word to get wrong, so unlike the check above it demands no word list per locale. It is a **table of nine rules** now rather than that one pattern, each quoting the README decision it enforces at the rule itself — and the file's own prose is the best illustration of why the table exists: it claimed on 2026-09-04 that `comprobar` and `pulsar` were "absent from both bundles" while six files were carrying 24 of them, the offline checklist's own "Comprobado — pulsa para quitar la marca" among them (issue #1503). Both are rules now, and each needed a pattern narrow enough to leave its innocent reading alone: `pulsar` is enumerated by inflection and anchored word-initial, because `Impulso` and `expulse` carry the letters mid-word and `pulso` and `pulsera` are nouns a medical string may yet need; `comprobar` matches the stem behind a negative lookahead for `comprobante`, which is a rental receipt and correct. The ninth, `intro-session` (2026-09-11, issue #1339), is narrower still and for a reason the others do not have: it refuses only *sesión / ratio / clase de iniciación*, because a taster dive is **un bautismo** while `iniciación` keeps the entry-level sense — *curso de iniciación* is the certification course the *sibling* ratio chip governs, and *límite de iniciación* is the depth an Open Water card carries, so both stay. Naming them the same way told a manager one fact twice and hid the only difference that matters: an intro session is closed by another instructor, the entry-level one by a divemaster. The near misses are tests rather than comments, so the next person to widen a pattern finds out immediately.

### rental-fit-caps, and the rule that was declined

`scripts/check-rental-fit-caps.mjs` refuses a zod field named after one of `rental_fit_profiles`' text columns (`bcdSize`, `wetsuitSize`, `drysuitSize`, `bootSize`, `finSize`, `weightPreference`) that is not bounded by `RENTAL_FIT_TEXT_LIMITS`.

**It exists because the same bug shipped three times** — #1062, #1728, #1754 — and all three are one shape: a value stored through a door with no cap, met later by a form asked to re-submit it. These columns are written by several boundaries and read back by all of them, and each re-posts whatever is stored, so a value one door accepts makes every *other* door's save fail `safeParse` on a form where every visible box reads right.

**The general rule was declined** (#1794). "Never refuse a save on an over-long value the submitter did not change" cannot be built: an HTML post cannot tell a retyped value from an unchanged one, so it would need every form to carry an `original-<field>` hidden input — a second copy of every stored value on the wire, on bearer-token surfaces where the extra field is one more thing a hand-crafted post can lie about. What the three incidents actually shared is narrower, and it is what this guard checks: the cap was on the reader and not on the writer.

**What it leaves alone, on purpose.** `src/db/rental-fit.ts`, which writes every one of these columns and is deliberately the layer with no opinion about length — a second cap there puts the number in two places, which is the thing #1728 fixed. The JSX `maxLength` attributes, which already read the constant and are a courtesy to the typist rather than a bound (HTML `maxlength` does not constrain a value the visitor never typed, which is how #1728 reached production). And every reader. It anchors on `z.` rather than on the field name, so an object literal that merely carries a size — every writer's `values()`, every reader's projection — is not mistaken for a door that accepts one. The escape hatch is `diveday:allow-unbounded-size: <why>` on the field or the line above it; there are none today.

### locale-coverage, and the count that is now zero on purpose

The locale one (`scripts/check-locale.mjs`) holds three invariants, and only the third needs a write-up.

Rules 1 and 2 say what they mean when they go red: no compiled-in `"en-US"` under `src/app` or `src/components`, and every key in the default bundle present in every other locale with the same ICU placeholders.

Rule 3 is newer (issue #1757) and exists because of a fallback nobody could see: **a key missing from the es-ES bundle falls back to the English string rather than throwing.** So a key somebody pasted into the Spanish bundle untranslated passes rule 2 (same key, same placeholders), passes `src/i18n/icu-messages.test.ts` (it compiles fine), and renders English to a Spanish reader forever. 206 of the roughly 7,900 comparable keys were byte-identical between the two bundles when this landed, and nothing in the repo reported that number or stopped it rising.

**How it counts, because the floor is meaningless without the rule.** Both bundles are flattened to dotted paths; only keys present in *both* with a string on each side are compared; the comparison is byte-for-byte. A key the other bundle is missing is **not** counted as identical — that is rule 2's failure, and conflating the two produces a floor nobody can reproduce. The count is per bundle **file** (`es-ES/diver.json`, `es-ES/staff/gear.json`, …) in `scripts/locale-baseline.json`, not one total: one number over 7,900 keys is a number the next untranslated string can hide inside, and a paste into `staff/gear.json` moves that file off its own line whatever the total does. Both directions fail — a rise is refused, a fall must be banked — so the baseline always describes what is on disk. `--write` banks a fall and refuses a rise, `--absorb` records growth arriving from a merge, `--report [prefix]` lists every key still identical.

**The count is zero, and the thing that would still be the bug is inventing Spanish for Divemaster.** The floor used to be 188 across 23 files, and it was never debt — it meant "unexamined". Issue #1797 examined all 188, and every one turned out to be a brand, an acronym, a place, a unit, a loanword Spanish diving uses, example data in a placeholder attribute, or a template with no word in it. Two were genuinely wrong and are translated: the import wizard's "Waivers" and "Waiver" now read "Exenciones" and "Exención", in a file that already wrote "exención" six keys away. The training-agency acronyms (PADI, SSI, NAUI, SDI, TDI, CMAS, RAID, GUE, BSAC), the course-name ladder a Spanish-speaking shop says in English (Open Water, Advanced Open Water, Divemaster, Instructor — `rescue` is the exception and *is* translated, "Buceador de Rescate"), "Plan", the brands (GoPro, Stripe, Shopify, Xero), the unit abbreviations and five of the eight compass points are declared rather than translated, one line and one reason each.

**A zero baseline is the stricter guard, not the weaker one.** Every file now starts from nothing, so one untranslated paste into any bundle fails on that file's own line instead of hiding inside a number over a hundred. Read a hit as "somebody pasted English", and answer it by translating the value or by declaring it with its reason — never by raising a baseline.

**Saying one is deliberate, without a blanket exemption.** `DELIBERATELY_IDENTICAL` in the script takes one line per key — `<bundle file> <dotted key inside it>` and a reason — and those keys leave the count. It is held both ways: a declared key that stops being identical fails, so an entry cannot rot into an exemption for something that later got translated. Eighteen entries seeded it, the ones #1757 examined; #1797 added the rest, one line at a time. The one exemption that is not per-key is `nothingToTranslate`: a value qualifies only while every letter in it sits inside an ICU placeholder or a rich-text tag, which covers the ~50 templates like `"{date} · {trip}"` that have no word to translate. It is decidable and self-revoking — add one word to such a template and it is back in the count — which is what keeps it from being the blanket exemption the per-key list exists to avoid. `src/i18n/label-maps.test.ts`'s `SAME_IN_BOTH_LOCALES` stays alongside it and asserts a different thing — that a *rendered* label is identical, which a resolver's interpolation and key redirection make neither implied by nor implying two identical bundle values — and that file's own comment says why both live.

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

It also holds the **house apostrophe**: `’` (U+2019) everywhere a person reads it, and a straight
`'` is a hit. This one is typography rather than a mannerism, and it lives here because both
spellings had been landing since the bundles existed — 613 strings carrying 726 straight apostrophes
against 216 strings spelling it `’`, colliding inside single objects (`shared.json`'s
`medicalClearance` group held `"Date of the physician's evaluation"` a few keys from `"Nothing of
this diver’s is waiting…"`). Nothing on screen distinguishes them. Playwright's `getByRole(name)`
and `getByText` do, and every e2e spec here deliberately hard-codes the English a user sees, so a
spec author had to guess which spelling a bundle used and found out from a shard ten minutes later:
PR #1365 (`24f18a2`) cost a full CI round on one character (issue #1367). The rule sits beside
`proseDashes` rather than in `RULES`, so a third locale inherits it without naming a word list.

Six values keep a straight apostrophe, all of them ICU MessageFormat quoting rather than prose: in
DOUBLE_OPTIONAL mode `'` opens a literal span only when the next character is `{`, `}` or `#`, which
is what shows a shop the literal `'{depth18}'` marker to type and what escapes WhatsApp's `'{{1}}'`
past ICU. A curly quote there would print *and* leave `{depth18}` to be read as a missing argument.
The guard strips exactly `'[{}#][^']*'` first — the same shape as `namesAnArgument` in
`src/i18n/raw-messages.test.ts`, and deliberately not a blanket `'[^']*'`, which would swallow
everything between two prose apostrophes. The keys are `courses.edit.depthMarkersHint` and
`courses.edit.errorDepthPlaceholder` in both locales, and `notifications.whatsappTemplate.body` in
both. Note that the sweep also forced the `leadIn` and `notJust` patterns to spell contractions
`['’]`: a pattern naming only `'` would have kept passing its own fixtures and never fired on a real
string again.

It holds the **house quotation marks** the same way: `“ ”` everywhere a person reads them, and a straight `"` is a hit. Same collision as the apostrophe at a fifth of the volume — 24 strings carrying 54 straight characters against 238 spelling them curly when this was swept (issue #1664), and colliding one scroll apart: `marketing.guides.fareharbor.coexist.intro` read *everything between "booked" and "back at the dock"* while `…eve.coexist.intro` made the same move in `“ ”`. On a page whose whole purpose is to be believed that reads as a typographic slip rather than a choice.

**It has no exemption list, which is the difference worth knowing.** The apostrophe rule must strip ICU-quoted spans because a straight `'` is what *makes* `'{depth18}'` a literal. `"` means nothing to ICU in any mode, so no value needs it, and the rule landed at zero the same day it was written. More than half the sweep was not marketing prose but the CSV importer's row notes in `settings.json`, which quote an interpolated value — `Email “{email}” doesn’t look valid` — and those are prose too: the value is read aloud inside a sentence rather than set as a code literal. Spanish sweeps identically; `src/i18n/locales/es-ES/README.md` settles `“ ”` over the peninsular `« »`, so like the apostrophe this sits beside `proseDashes` rather than in `RULES`.

**Four shapes joined it on 2026-09-24** (H-89, the voice decision), on the public pages' strings
only — `marketing.*`, `switching.*`, `account.onboard.*` and every route's `metadata` — because
the 2026-09-03 sweep had removed the words a model overuses and left its shapes: measured
afterwards over the five marketing pages, a mirrored pair in the hero of three of them, a list of
three with a tail in most founder paragraphs, 36 sentences of five words or fewer most of them a
beat after a long one, and "from day one" seven times
([docs/design/voice-strategies-20260917.md](../design/voice-strategies-20260917.md)). Each is named
as narrowly as a regex can name it, and the "leaves alone" cases in `scripts/check-voice.test.mjs`
carry at least as much weight as the refusals:

- The **mirrored pair**: two clauses of one sentence, each three or more words, joined by a
  conjunction, that open with the same two words or close on the same two words before the last
  ("nothing gets asked twice and nothing gets missed once"; "come in with a file and leave with a
  button"). A pair opening on an article or possessive ("a wait list … and a last-minute list") is
  a list of two things and is left alone, as is any factual pair with different words at both ends.
- The **anaphoric triplet**: a comma list whose second and third items open with the same word,
  carried by the first item too ("paper never crashes, never logs you out, and never needs five
  taps"). Articles, possessives, "one", the infinitive's "to" and the ledger's "no"/"ni"/"sin"
  are exempt, so "a whiteboard, a clipboard, a spreadsheet", "your colour, your typeface, your
  cover photo", "one roster, one waiver, one crew" and "no setup fee, no contract, no card" are
  lists of things and stay.
- The **tag sentence**: a value's last sentence of four words or fewer, carrying no digit,
  placeholder or arrow, after a sentence of seven or more ("One answer, all day." "It does not
  decide."). A short sentence mid-paragraph is speech and stays, which is what lets `/about`'s
  spoken register keep "That's the bar." A key under `.errors.` is a notice and is never measured
  for shape: its short last sentence is the next action.
- The **house phrase**: three consecutive words, at least two of them content words, on more than
  two distinct pages of one bundle. Pages are the second key segment (`marketing.home`,
  `switching.spreadsheet`); the shared namespaces rendered on several pages by design
  (`marketing.common`, `features`, `featureChrome`, `price`, `export`, `capabilities`,
  `guides.shared`, `switching.common`, `switching.concierge`) are never compared, the five
  competitor guides count as one page because they mirror each other's structure on purpose, the
  twelve feature pages count as twelve (`marketing.featurePages.waivers` is the waivers page: they
  share a template, whose words are `featureChrome`, and none of each other's), and a conjunction ends a
  phrase so "rental sizes and certification records" is two names rather than one. Number words
  are content ("from day one", "one ZIP"): the sixteen "one ZIP / button / number / price" were
  the phrase this rule was written for. `HOUSE_PHRASE_ALLOWLIST` holds the names of things
  ("the live demo", "your own Stripe account", "hoja de cálculo"), and a phrase joins it because
  it is what the thing is called, never because it reads well. The hit is reported once per
  phrase, naming the pages.

**American spelling joined it on 2026-10-06** (H-95): *colour*, *centre*, *cancelled*, *grey*,
*enrolment* and the rest of `BRITISH_SPELLINGS` are refused in every English bundle value, in a
route's metadata, and in every prose literal (a string with a space in it) in a non-test `.ts`/`.tsx`
under `src/` — the course and dive-site templates, the demo seeds and the export descriptions are
copy that never passes through a bundle. A one-word literal is a name (the `cancelled` booking
status) and is not read; comments and tagged templates (``sql`…` ``) are skipped by a small tokenizer
(`stringLiterals`). The list names every form whole rather than matching `-ise` or `-our`, which
would refuse *advise*, *promise*, *four* and *your*.

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

### trip-revision

The trip-revision one (`scripts/check-trip-revision.mjs`) fails any `.update(trips)` whose `.set()` literal writes `startsAt` without also writing `revision`. `trips.revision` is published as the RFC 5545 `SEQUENCE` on both calendar surfaces (`src/lib/trip-calendar.ts`), and a client that re-fetches an event whose `SEQUENCE` has not moved treats it as the event it already holds — so a departure that slides an hour with a flat revision leaves every subscribed calendar on the old `DTSTART`, and a diver on the dock at the old time. That is issue #1165, which was fixed at the two writers that existed then; nothing made the third one carry it.

The anchor is the table rather than the column, and that is the whole reason the rule is affordable. `moveTrip` bumps the trip and then shifts each of its child days — `.update(tripScheduleDays).set({ startsAt: shift(day.startsAt), endsAt: shift(day.endsAt) })`, three statements below its own bump — and a rule anchored on `startsAt` would have failed that correct line on day one. A schedule day has no `SEQUENCE` of its own; only the trip does. A `.set()` that never mentions `startsAt` is not a calendar move and is not inspected further, which is what keeps the status writers, the minimum sweep, the recap writers, the series cancellations and the soft delete outside the gate.

Five writes touch `trips.startsAt` today and the rule reads all five. `moveTrip` (`src/db/trips-schedule.ts`) bumps unconditionally — the equal-instant case has already returned, so reaching the write means the boat really moved. `updateTrip` (`src/db/trips-record.ts`) renames and moves in one statement, so its bump is a `...(revisionMoved ? { revision: … } : {})` spread that collapses to nothing when only the words changed; that shape and the `${…}` inside the `sql` template literal are the two the brace matcher has to survive, and both are pinned in `scripts/check-trip-revision.test.mjs`. `refreshDemoShop` (`src/db/demo-refresh.ts`) bumps because the demo shop's own `.ics` is real. The two `/api/test/*` fixtures — `seed-evening` and `depart-trip` — say `diveday:allow-flat-revision: <why>`, because a per-worker test database has no subscriber to mislead.

The `.set()` search, and the brace match that reads its literal, both end at the next `.update(trips)`. That bound is issue #635's lesson ported from `scripts/check-live-trips.mjs` rather than re-learned there: a fixed line window once let one write pass because a *neighbour* carried the thing being looked for.

**A `.set()` given anything but an object literal is refused, not passed.** `.set(patch)`, `.set(buildPatch())` and `.set({ ...timesPatch, status })` give the brace matcher nothing of this write to read — it would take the first `{` anywhere after `.set(`, which for the last anchor in a file means the rest of the file, and conclude from someone else's object that no departure moved. That is the shape a developer writes the moment two branches share a patch, and the failure would be silent: the guard's own move count would drop by one with nothing watching it. So the rule says it cannot read the write and asks for the literal to be inlined, or for the exemption by name. The move count is pinned in the tests for the same reason (`security-reviewer`, issue #1394).

**The exemption's reason is required.** `diveday:allow-flat-revision:` with nothing after the colon is refused; `check-db-concurrency.mjs` already spell theirs the same way.

The anchor is matched per line, so a `.update(\n  trips,\n)` split across three lines is not an anchor and the write goes uninspected. Biome keeps it on one line today. If that ever changes, this is the line to change with it.

The opposite mistake the issue names — bumping for something immaterial, which re-alerts every diver's phone for a typo fixed in a conditions note — is deliberately left un-guarded. It has no mechanical signature; guarding the cheap half of a rule beats guarding neither.

### departure-buffer

The departure-buffer one (`scripts/check-departure-buffer.mjs`) refuses three shapes outside `src/lib/trips.ts`: an offset added to a `startsAt`/`endsAt` on a line that also *compares*; the same offset bound to a name and compared against *now* a few lines later; and any `*_BUFFER_MS` declaration. All three mean the same thing — somebody asked "has this sailed?" without going through `hasSailed()` / `hasReturned()`. The split-across-lines rule arrived in review: the first version matched only within one line, so `const cutoff = new Date(trip.startsAt.getTime() + HOUR_MS)` followed by `if (cutoff <= now)` was a prohibited check the guard called clean. Comparing a derived date against anything other than the clock is left alone, which is what keeps the seeds — full of exactly that arithmetic — out of it.

It exists because AGENTS.md's late-arrival rule was enforced by a sentence for as long as the rule existed, and a sentence does not scale. When the guard was written the hour was spelled **fifteen** times: nine separate `const … = 60 * 60 * 1000` declarations (`closeout`, `ready`, `today`, `roster-facts`, `find-my-booking`, `crew-requests`, `thread-steps`, the diver record's status split, and `COUNTER_DEPARTED_BUFFER_MS` at the walk-in counter) plus six bare literals compared inline in `bookings`, `blowouts`, `today`, `trips-overview` and the diver-facing departure page — behind three different predicate names.

The interesting part is that every one of the nine was *correct*, and every one carried a docstring citing the rule. What they did not have was a centre: `today` cited `ready`, `ready` cited `selfCancelBooking`, `roster-facts` cited the diver record, the diver record and `crew-requests` cited AGENTS.md, and `find-my-booking` said "same 1-hour buffer every other check uses". A ring of citations with no source is what a rule looks like shortly before one of its copies is edited alone. Two had already drifted: most sites treated the departure as gone at `startsAt + 1h` exactly, while the roster's "ahead" flag and the diver record's held it upcoming a millisecond longer — a difference nothing depended on, which is why it survived. `hasSailed` settles it on the majority reading (the boundary instant counts as past), and `src/lib/trips.test.ts` pins that instant.

The failure it catches is quiet and customer-facing: a site that forgets the hour does not throw and does not look wrong in review, it tells a diver standing on the dock at 07:05 that the 07:00 boat they are waiting to board is in their history, or turns away a walk-in the desk would have taken. The comparison operator is the anchor rather than the arithmetic because the seeds construct dates from a departure constantly and ask nothing about the clock. An offset that genuinely asks a different question says `diveday:allow-departure-offset: <why>` on the line or anywhere in the comment block above it; there is one, the recap's own delay in `src/lib/thread-steps.ts`, which waits its scheduled hours after a boat this rule has already counted as home.

### action-race

The action-race rule inside `scripts/check-e2e-hygiene.mjs` refuses a `page.goto`/`page.reload` written as the **immediately following code statement** of a submit-shaped click. The click resolves when the request is *sent*, not when the write has landed, so navigating from it can tear the page down mid-flight and the destination then renders the state from before the save.

What makes this worth a guard rather than a note is where the failures point. Neither of the two that reached CI pointed at the race. One closed the destination's stream early and surfaced as a server error on a page the spec had already left. The other spent the visual shard's entire 210-second budget and then failed on an assertion forty lines below, on a banner that was behaving correctly — and "slow CI" and "flaky banner" are both the natural wrong turn from that stack. Neither is findable by reading the failure; both are obvious by reading the two adjacent lines.

Two clauses keep it honest, and each is load-bearing against the suite as it actually reads. **Immediately preceding** is what clears the prevailing convention: nearly every spec here clicks, asserts what the click produced, then navigates, and any `expect`, `waitFor` or `waitForURL` between the two makes the rule not fire — which is precisely the shape it is asking for, with the one exception below for an assertion that waits for nothing. **Submit-shaped** clears the two `"Copy link"` clicks followed by `page.goto(await waiverLinkFromToast(page))`, which are not races at all, since that helper opens by awaiting the toast. Dropping the label clause takes the sweep from two hits and no false positives to two and two, and a rule that fires on correct code is one people learn to silence — the failure mode the issue that asked for this named in its own body.

**One statement does not count as standing between them, and finding that out cost a third failure.** An `expect` on a form control asserting `toHaveValue`/`toBeChecked` against the value this same test typed into it is syntactically a wait and semantically nothing: the field already holds it, so the assertion passes on its first poll whether or not the write ever landed. One stood in `e2e/visual.spec.ts` from 2026-09-05, satisfying this rule while leaving the race untouched, until it cost a visual shard its whole 210-second budget on PR #1618 — the trace showing the action's POST at status `-1` and the library rendering the row with no note (issue #1644). The rule now steps over such an assertion as if it were a comment and keeps looking for the submit above it.

The narrowing is deliberately the decidable case rather than an attempt to prove in general that an assertion depends on the action, which no line scanner can do. The awaited expression has to be the *same source text* the test passed to `fill` earlier in the same test body — an identifier or a literal, since `fill(NOTE)` and `toHaveValue(NOTE)` is the shape that got through — or, for a checkbox, the same quoted name a `check`/`uncheck` in that body opened its chain with. "The same body" is bounded by the enclosing `test(`, so a fill in a sibling test cannot make an honest assertion look vacuous. A value the *destination* produced (an id the save minted, a total the server computed) is not one the test typed, and keeps counting as the wait; so does any assertion whose subject is not a form control, since a row, a heading or a toast is rendered rather than typed.

Round-tripping a saved value is still a legitimate assertion — this only refuses it as *the wait*. Wait on the save's own confirmation first and then assert whatever you like, which is what `e2e/depth-and-age-surfaces.spec.ts` and `e2e/courses.spec.ts` already do.

The remedy differs by the shape of the action, so the message names both: `page.waitForURL()` on the action's own `?notice=`/`?created=` redirect, or, for a `useActionState` form that re-renders in place and never redirects, an `expect(locator)` on what the row shows once it has landed. The two instances the sweep found were one of each.

The label list is a maintenance surface and is not meant to be complete. It only bites when a click carrying one of those labels is immediately followed by a navigation, which is rare, so the cost of it drifting is low; a client-only button that happens to say "Send" would be a false positive and says `diveday:allow-e2e-hygiene action-race: <why>`.

#### "The destination stream closed early" is not, by itself, a defect

The dev server logs `⨯ Error: The destination stream closed early.` during runs that pass, and it has cost more than one session an afternoon, so this is what it is. It is React's own text: `createCancelHandler` in `react-server-dom-webpack-server.node.production.js` is registered on the destination's **`close`** event and calls `abort(request, Error("The destination stream closed early."))`. In other words it is the cancellation path, not an error path — a client closed a streaming response before React finished writing it, and React is saying so. Next surfaces the abort through its error logger, which is why it arrives looking like a crash, with a digest and `at ignore-listed frames`.

What closes the stream is almost always a **prefetch nobody wanted any more**. Measured on `e2e/import.spec.ts`'s re-import test by recording the in-flight set at the moment of the navigation: two `?_rsc=` requests — `<Link>` prefetches of `/settings` and `/dive-sites` that the staff nav had fired speculatively — plus a Vercel insights script. Abandoning a prefetch is what a prefetch is for; the router fires them constantly and the next navigation drops whichever have not landed. A real user does this every time they click before a hover-prefetch finishes.

It can also be the tail of a server action's response, and that is benign for a different reason: the action's *write* is committed server-side and does not roll back when the response socket closes, and a spec that asserted the action's own result before navigating has already proved the write landed. What is thrown away is the remainder of a re-render for a page nobody is on any more.

The line is not useless, though, which is why the answer is a paragraph and not a suppression. **The same message is what a genuine action-race produces** — the section above records exactly that, "one closed the destination's stream early and surfaced as a server error on a page the spec had already left". The message tells you a client closed a stream; whether that matters depends entirely on whether anything still needed it. The cheap discriminator is the one the `action-race` rule already encodes: is there an assertion between the click and the navigation? With one, the write has landed and the abandoned stream is surplus. Without one, the navigation may be racing the write, and the rule fires.

The experiment, so nobody has to redo it: inserting `await page.waitForLoadState("networkidle")` before that test's `page.goto` makes the line disappear, and the spec passes 7/7 either way. That proves the navigation is the closer and that nothing in the test depended on what was closed. It is **not** a fix to adopt — the wait is dead weight on a passing spec, and `networkidle` is a blunt instrument that would sit there absorbing real slowness. The finding is that there was nothing to fix.

Do not try to catch this with a guard. `check-e2e-hygiene.mjs` reads lines; knowing whether a stream still had a reader means knowing what is in flight, which no line-based scanner can answer. Issue #1560 asked the question and this is the answer.

#### A negative assertion keyed on copy is measured, not guarded

The sibling rule that keeps being proposed for this guard is one refusing `.toHaveCount(0)` / `.not.toBeVisible()` on a locator built from a string literal. The failure is real and this repo has had it: slice 16f renamed a region's accessible name from "Next boat out" to "Next boat with space", the assertion that the card **is** visible failed and was fixed, and the two asserting the card is **absent** kept passing, because a locator that matches nothing satisfies them for the wrong reason. `e2e/schedule-embed.spec.ts`'s was the only assertion in the suite proving `?embed=1` drops that card, and it had stopped proving it silently and permanently (issue #1403).

It is not built, and the reason is a count rather than an opinion. The rule was implemented as specified — read at statement scope, exempt when the identical string appears in another locator anywhere in the same file — and swept over `e2e/` twice, on 2026-09-10 and again on 2026-09-12 after the suite had grown from 487 negative assertions to 498. The flagged counts did not move:

| Variant | Lines flagged |
| --- | ---: |
| The rule as specified in #1403 | **98**, across 46 of the 112 files in `e2e/` |
| Same, exemption loosened to the string appearing anywhere in the file | 78 |
| `getByRole(…, { name })` only — the narrower form #1403 itself nominates | **56** |
| That, restricted to `.toHaveCount(0)` alone | 55 |
| `getByRole(…, { name })` whose name **and** role are never queried positively in the file | 9, in 6 files |

#1403 pre-committed to a threshold before anyone built anything: "if it is a handful, fix them. If it is fifty, the rule is wrong and the answer is something narrower — perhaps only `getByRole(…, { name })`." The rule as written is roughly twice that line and the narrower form named in the same sentence is above it too. What the 98 are matters more than the number: most are honest single-purpose absence assertions — `e2e/whatsapp-settings.spec.ts:58` proving Embedded Signup asks for no access token, `e2e/tenant-isolation.spec.ts:108-110` proving another shop's staff nav is unreachable, `e2e/marketing.spec.ts:577-579` proving three pricing claims do not repeat on the door. Annotating those is not a fix; it is 98 sentences explaining that an absence assertion asserts absence, which is the failure the `action-race` write-up above names in one line — a rule that fires on correct code is one people learn to silence.

So the decision is the owner's and it is open on #1403, which carries the four options: build it and pay the sweep, take the issue's own narrower fallback and pay 56, narrow past both to the one shape that actually rotted (the last row of the table — a name nothing queries positively in a file that never queries that role either, which is the `e2e/schedule-embed.spec.ts:24` case that stood alone), or decline and close since the three lines that prompted it are fixed. Nothing is blocked on it: the pairing that saved the visual capture is written into `.claude/rules/e2e.md` as a convention either way.

Re-measure before re-proposing this; the number is what the argument turns on and it is cheap to get, while re-deriving it from scratch is a day. The sweep's definitions and script are in #1403's own comment thread. If a variant is ever built, it needs a statement-scope hook rather than a per-line `pattern` — five of the 98 have their locator on a preceding line — and it should be built on the `statementStart` helper already in the script rather than re-deriving a walker that will drift from it.

### loading-skeleton

The loading-skeleton one (`scripts/check-loading-skeletons.mjs`) requires every `page.tsx` under `src/app` to have a sibling `loading.tsx`, and where both declare a container the two widths to match — the hard rule below and `docs/design/principles.md` §10, neither of which anything checked. A route with no boundary of its own does not go without one: Next falls back to the nearest **ancestor**, so the defect is a skeleton that is a picture of a *different page*. Three routes were in that state until 2026-08-23 — a diver tapping "83 reviews" watched the public schedule's day headers and departure rows at `max-w-6xl` before the page snapped to a `max-w-4xl` column of cards, and a staffer tapping "Add a dive site" watched the site *library* before landing on a narrow form. It is invisible in a diff (each page is individually fine; the missing file is the defect) and invisible locally, where the data is instant — it needs a cold navigation over a slow link. The width half compares the first `mx-auto w-full max-w-*` container each file declares and no further: a page that delegates its container to a component (the legal pages render `LegalDocument`) is reported as delegated and skipped rather than guessed at; a pair that spells no width in either file (the trip family under its layout, every settings route through `settingsPaneClass`) counts as owning none, its parity resting on that owner (the one layout, or `settings-pane.test.ts`) rather than on this guard; and the counts print on success so the coverage is stated rather than implied. A route that genuinely needs no skeleton — the five with no ancestor boundary to fall back to — goes in the script's `SKELETON_EXEMPT` with its reason.

### exit-curve

The exit-curve one (`scripts/check-exit-curves.mjs`) holds every exit animation in `src/app/globals.css` to `--ease-in-soft`, the leaving curve. `docs/design/principles.md` §5 has said so since the schedule board's row menu was fixed, and three of the four exits in the file were still on the *arrival* curve weeks later (issue #756) — including `.toast-dismiss`, which fires on every reversible mutation in the app and is therefore the most-seen exit in the product. `--ease-out-soft` front-loads its travel, so an exit on it barely moves for three quarters of its duration and then vanishes: a jump, a dead pause, and a hard cut. Nothing swept for the other three because nothing could tell an entrance keyframe from a departing one, which is what makes the naming convention load-bearing rather than decorative: a keyframe animating something *away* carries `out` or `dismiss` as a hyphen-separated **word** — `slide-out-right` is an exit and a `-out$` suffix pattern misses it — and the selector is read as well as the keyframe name, so renaming a rule away from its keyframe does not slip past. The `animation-name:` longhand is refused outright rather than parsed, since splitting a name from its curve across two declarations is exactly how an exit would evade a check that reads the shorthand. Durations are **not** in scope; only the curve. It reads names, not travel, so an exit called `fade-away` is invisible to it — the cost of a rule a grep can check at all — and a keyframe that names itself an exit and genuinely is not one says `diveday:allow-exit-curve: <why>`.

### design-canvas

The design-canvas one (`scripts/check-design-canvases.mjs`) holds the mechanical half of [docs/design/design-artifacts.md](../../docs/design/design-artifacts.md), the conventions written when this repo got its first design drawn *before* the code (2026-08-27). Two silent failures are what it exists for: a canvas naming no ADR is a set of pictures nobody can hold code to — which collapses the split that whole document rests on, that pictures argue and **the ADR decides** — and the seeded canvas payload is a ~2.6 MB single file with the editor inlined, regenerable from the artboards beside it, trivially committed by accident because it is written into the same working directory as its sources. So every `docs/design/canvases/<YYYYMMDD-slug>/` needs a README carrying a status word and a link to an ADR that exists, artboards named `<Name>.dc.html` and each placed by `canvas.json`, and no file over 400 KB. It reads no artboard's contents: a picture is not checkable, which is the reason the ADR and not the canvas is normative

### closing-keywords

The closing-keywords one (`scripts/check-closing-keywords.mjs`) fails a commit message on this branch that writes a closing keyword and then a list — `Closes #1392, #1393, #1395` — because GitHub honours the keyword only where it sits immediately before the number. The first issue closes on merge; every later number in the list is an ordinary cross-reference and stays open. Nothing anywhere reports this. The pull request merges green, one issue closes, and the rest sit there looking untouched.

It cost eight issues on 2026-09-12. `Closes #1392, #1393, #1395, #1506, #1511, #1632` (#1740) and `Closes #1356, #1394, #1497, #1498` (#1743) closed #1392 and #1356 between them and left the other eight open over work that had already shipped — found days afterwards by reading the tracker against the tree, and closed by hand. Both lines are still legible in `git log origin/main`.

**It reads commit messages rather than pull request bodies, and that is not a compromise.** The keyword has to reach the default branch to fire at all, and on a stack it gets there through the commit: a layer merges into the layer below, and what finally lands on `main` is the commit carrying whatever its message says. Both incidents above are in `main`'s history for exactly that reason. Reading the commit also means the guard runs on the branch, before the pull request exists, where the message can still be amended — and it is the same range `pnpm test:changed` uses, `git merge-base origin/main HEAD` to `HEAD`, so on a stack it reads every layer and never `main`'s own history. A keyword written *only* in a pull request body is a second way to lose a closure and is out of reach from here; [issue-tracker.md](issue-tracker.md) asks for the keyword in the commit message for that reason.

**A finding stops at anything that is not a comma or `and`.** `Closes #12. Related: #13, #14` is two sentences and only the first is a closure, so #13 and #14 are never claimed. That bound is what makes the rule affordable: half of every message in this repository is cross-reference — "the same defect a reviewer flagged in #1687", "filed rather than widened: #1724, #1725" — and a rule that read those as intended closures would fail honest branches constantly and be routed around inside a week. A bare `#N` that no keyword governs is never a finding.

**Failure is a reason, not a skip.** A clone with neither `origin/main` nor `main` exits 1 naming the remedy (`actions/checkout` with `fetch-depth: 0`, or `git fetch --unshallow`), the same message and the same trunk fallback `scripts/previous-release-migrations.mjs` uses. Exit 2 belongs to the one guard that makes a network call, which is not in `check:repo` at all (see follow-ups below). A checkout this guard cannot read is one the destructive-migration guard and `pnpm test:changed` cannot read either.

**Quoting a broken line is itself refused, and there is no exemption for it.** This guard's own first commit was rejected, because its message quoted the two incident lines verbatim as evidence. That is the right answer rather than a rough edge: a keyword in a commit message is live wherever it appears, so a message quoting `Closes #1392, #1393` really would close #1392 on merge, and nothing downstream can tell an illustration from an intention. Write about the shape without executing it — name the keyword and the numbers separately, as the paragraphs above do — and the guard has nothing to find. An exemption marker was considered and left out: the one thing it would be reached for is the one case the rule cannot distinguish from the failure.

On `main` itself the merge base is `HEAD`, the range is empty, and the guard passes on nothing — which is right, since `main`'s keywords have already had whatever effect they were going to have.

### follow-ups, outside `check:repo`

The follow-ups guard (`scripts/check-follow-ups.mjs`) is the one guard that makes a **network call** — `gh issue list` for every open `needs-triage` issue — and it is deliberately **not** in this table. What it reads is the tracker, not the branch: while it ran here, one malformed issue (#2036, and #1097, #1526, #1555 before it) turned every open pull request red at once, for a problem none of them contained and none could fix. Since 2026-10-07 it runs daily in `.github/workflows/follow-ups.yml` with the repository token, and on demand as `pnpm check:follow-ups`; [issue-tracker.md](issue-tracker.md)'s "Filing a follow-up" says when a session runs it.

It keeps its three outcomes. Exit 0 is clean, exit 1 is a malformed issue, and exit **2** is `SKIPPED`: `gh` could not answer, so nothing was validated. That code is unreachable from any validation path, so a genuine failure can never downgrade itself into a skip. Every guard in `check:repo` exits 0 or fails; none reads the network, and `check-repo.mjs` no longer has a skipped outcome at all.

## Now Biome rules

Four guards that were one syntactic pattern each are rules in `pnpm lint` now: a GritQL plugin in `scripts/lint-rules/<rule>.grit`, scoped and exempted by an `overrides` entry in `biome.json`, and tested through that real config by `scripts/lint-rules/lint-rules.test.mjs`. A rule reads the syntax tree, so a comment or a string that only *mentions* the call is no longer refused; nothing else moved. That was checked before the guards were deleted: each old guard and its rule ran over every `.ts`/`.tsx` under `src/` with scopes and exemptions lifted, then over a copy with the refused shapes and their look-alikes injected into every `try` body, `catch` body and function in the tree (from 722 refused lines for `timezone` to 4,733 for `redirectInTry`), and the two sets of refused lines were identical apart from the twelve comment lines `clock` used to count. `pnpm lint:rules` runs these rules alone.

The escape hatch is Biome's own, and its reason is required: `// biome-ignore lint/plugin/<rule>: <why>` on the line above. One with nothing after the rule name is itself an error, so the hatch cannot be taken silently. A file-wide exemption is a negated glob in the rule's `biome.json` override, with its reason in this section.

### clock

Refuses `new Date()` and `Date.now()` in `src/lib`, `src/db` and `src/features`, tests included; read time through `nowDate()` / `nowMs()` in `src/lib/clock.ts`. The demo seed is clock-anchored and dozens of surfaces render relative time, so a live wall-clock read in domain or data code is what makes visual baselines drift: the clock module is the one seam the e2e fleet freezes (`DIVEDAY_CLOCK`), and in production it is the native call byte for byte. `src/app` is out of scope because client components read the browser clock, which the e2e specs freeze with `page.clock`. Tests are in scope because dozens of them once drifted into depending on real time running ahead of the frozen instant (`new Date(Date.now() + 1000)` as an upper bound, a session placed relative to real time and read back against `nowMs()`), and failed as a mass the day the instant moved. Exempt: `src/lib/clock.ts`, and `src/lib/clock.test.ts`, whose assertion is bracketing `nowMs()` between two real readings.

### intlCache

Refuses `new Intl.*` (except `Intl.Locale`, a parsed value with nothing to compile) and `.toLocaleString` / `.toLocaleDateString` / `.toLocaleTimeString`, optional-chained or not, outside tests in `src/app`, `src/components`, `src/lib`, `src/db`, `src/features` and `src/i18n`. Build formatters through `src/lib/intl-cache.ts`; a date goes through a `src/lib/format.ts` helper. Constructing a formatter is ~12x the cost of reusing one and this app formats on essentially every render; it regressed twice before it was checked (ADR 20260807-intl-formatter-cache). The `toLocale*` family is on the list because each call builds a formatter internally *and* picks its own fields: the forecast's "last updated" line told divers `10:33:06` (issue #799). `toLocaleLowerCase` / `toLocaleUpperCase` fold case and are allowed. Exempt: `src/lib/intl-cache.ts`, which is the cache.

### timezone

Refuses `new Intl.DateTimeFormat(…)` and the three `toLocale*String` calls whose arguments do not mention `timeZone`, outside tests in `src/app`, `src/components`, `src/lib`, `src/db` and `src/features`. Every timestamp is a UTC instant shown in the shop's zone, and these APIs fall back to the host zone — UTC on every server and in CI — so a 7:30 AM Key Largo departure renders 11:30 AM, plausibly and silently. The rule is "name a zone", not "name the shop's zone": `timeZone: "UTC"` for a date-only value (`src/lib/calendar-date.ts`) is a visible choice and passes. `timeZoneName` alone does not count. Within its scope it overlaps `intlCache`, which refuses the same calls everywhere except `src/lib/intl-cache.ts`; this is the rule that holds the cache itself to naming a zone.

### redirectInTry

Refuses a call that unwinds the render — `redirect`, `permanentRedirect`, `notFound`, `forbidden`, `unauthorized`, this repo's `revalidateAndRedirect`, `requireStaffSession` and `requireShopSurface`, and any function the same file declares `: never` or `: Promise<never>` — written inside a `try` body (callbacks nested in it included), or with `.catch(…)` chained straight onto it, anywhere in `src/` outside tests. These throw a sentinel the framework turns into a 307/404/403/401, so a `try` around one catches the refusal itself and the page below the gate renders for someone the gate said no to: a tenant-isolation bug, since `requireShopSurface`'s whole contract is that every refusal throws. `catch { redirect(…) }` is a refusal decided by the failure and is correct; so is a redirect after the `try`. Tests are exempt because asserting a helper throws means catching the sentinel. The guard this replaced was a 439-line lexical masker that had to fail loudly when it lost its footing; Biome parses the file, and one that does not parse fails lint. Not covered, stated rather than implied: a `return` inside `finally`, which lint already refuses.

## The path-scoped rules, in full

Each `.claude/rules/<area>.md` is a short list of rules, each naming the guard or hook that enforces it and pointing here. What those files used to carry in full (the reasoning, the incidents, and the longer route-map entries) is kept below as it stood on 2026-10-07, one section per area, so a session that needs the *why* finds it without every session paying for it.

### The surfaces rules

For `src/app/` and `src/components/`; the rules themselves are in `.claude/rules/surfaces.md`.

#### Where things are

- **Public pages** (landing, sign-in): `src/app/`. **Diver-facing shop pages**:
  `src/app/s/[shopSlug]/**` — its own namespace, no auth anywhere in it; path strings come from
  `src/lib/public-routes.ts`, which also holds the 308s from the old `/shop/**` URLs (ADR
  20260803-public-shop-namespace). `/shop/**` is staff, without exception.
- **Where a diver can go**: the header nav in `src/components/PublicShopNav.tsx`, assembled once in
  `src/app/s/[shopSlug]/layout.tsx` and rendered by `src/components/PublicShopChrome.tsx`. Add a
  public destination there, never as a per-page cross-link; the whole header is dropped in
  `?embed=1`.
- **Where staff can go**: derive from `src/lib/staff-destinations.ts`, a registry of
  destinations each filed under one **section** — Today, Schedule, Divers, Inbox, Money, Courses,
  Gear, Settings (ADR 20261001-logbook). It has **two** consumers:
  `src/components/ShopSectionNav.tsx` (the labelled sidebar from `lg` up, the phone tab bar below
  it — Today, Schedule, Divers, Inbox and More) and `src/components/search/CommandPalette.tsx`, the
  shortcut to everything. `staffNavSections` decides which rows a viewer sees (a gated section is
  absent; Courses and Gear only for a shop that teaches or keeps a fleet) and `currentStaffSection`
  is the one answer to "which row is lit". Add a destination to the registry with its section,
  never to a consumer. The sidebar is its own `<Suspense>` boundary in the staff layout, beside the
  page; the tab bar sets `--tabbar-h`, which anything fixed to the foot (toasts, the sticky Save
  bar) stands off. A diver the search finds opens their record, `divers/[personId]`.
  `src/components/ShopIdentityMenu.tsx` holds what is the reader's own: their calendar feed, their
  language, sign out.
- **Bearer-token pages** (`src/app/waivers/[token]`, `ready/[token]`, `recap/[token]`,
  `verify/[token]`, `reset-password/[token]`, `calendar/[token]`): the URL *is* the capability;
  read [docs/engineering/capability-telemetry-runbook.md](../engineering/capability-telemetry-runbook.md)
  before touching. Never structured data or telemetry that could carry the token.
- **The four lines every staff page opens with**: one helper, `requireShopSurface` in
  `src/lib/session.ts`: `requireStaffSession()` → the shop row read by `session.user.shopId` (never
  the URL slug) → `notFound()` when it is missing **or** disagrees with the slug → an optional live
  `src/db/authz.ts` gate → a `?notice=` refusal redirect. Every refusal *throws*; there is no path
  that returns after deciding against the caller, and `src/lib/session.test.ts` pins that. Never
  `return null`, `redirect("/")`, or a bounce to the shop home for a cross-tenant miss — all of those
  are now `notFound()`.
- **Server actions**: inline `"use server"` closures for single-page mutations; `src/app/actions/`
  only for actions shared across pages; a large page colocates its actions/zod schemas in a sibling
  `actions.ts`. **Seating a diver** from any surface goes through `src/app/actions/seat-diver.ts`
  and the per-surface table in `seat-diver-surfaces.ts`; the global door is
  `src/app/shop/[shopSlug]/bookings/new` then `bookings/new/[tripId]` — the trip is a path segment,
  not a `?tripId=`, so a refusal can land back on it.
- **The schedule builder**: `src/app/shop/[shopSlug]/schedule/board/_components/ScheduleBuilder.tsx`
  + `schedule/board/actions.ts`; mutations in `src/db/trips-schedule.ts`. The add panel is the
  **one place a trip is created**; `/shop/[shopSlug]/trips/new` is a 308 to
  `schedule/board?add=full` (ADR 20260806-one-trip-create-form).
- **Schedule is one place with two views** (ADR 20261001-logbook): Week (`schedule/board`, the
  departures and the builder) and Crew (`staffing/`, the same week by who is working it), both
  titled "Schedule" under `schedule/_components/ScheduleViews.tsx`, which carries `?week=` across.
  A third reading of the week is a third view there, never a page of its own.
- **A departure is four tabs under one header** (ADR 20261001-logbook, decision 3):
  Divers (`trips/[id]/page.tsx`, the roster, which is also the arrival desk inside the arrivals window:
  `_arrivals/arrival-desk.tsx`, its walk-in form at `walk-in/`), Boat (`manifest/`), Gear (`prep/`, the packing list) and Details (`trips/[id]?view=details`,
  the About panel). One component draws them, `_components/TripTabs.tsx`; every tab wears `TripPageHeader`, whose
  stage pill's phase (Prep, Check-in, Aboard, Back) comes from `src/lib/trip-phase.ts`, where the crew's tap
  on the manifest beats the clock. Add to a tab, never a fifth surface; a second list of the same divers is the duplicate this cut removed. A gear form redirects to
  `prep#{PREP_SECTION_ID}`; an About form redirects to the departure with its `form`, which opens
  Details. **A cancelled departure keeps its Boat tab and packs nothing**: the roll call is a
  record of people, the packing list an instruction about a check-in that is not happening
  (dive-domain review 20260920). `print/` composes prep as a component for the paper day.
  Finding which boat an arriving diver is on is Today's arrival lookup (`?q=`), never a search on
  the tab.
- **The shop home** is the day's departures, then one "Needs you" list (ADR 20261001-logbook,
  decision 4): `_components/today/DaySpine.tsx` composes them, `DayStation.tsx` is a departure
  card (time, stage pill from `tripPhaseOf`, readiness bar), and every job on the day, at a boat
  or at the desk, ranks in the one list and names its own boat. Its evening state is the settled
  stations (`ClosingStation.tsx`) and the day's takings; there is no act of closing the day. `?view=` and `/blockers` 308 home (ADR 20260827-clearwater-surface-language). A
  departure's **log** is generated from there (`trips/[id]/log`, owner-only).
- **The back-office queues** are **not on Reports** — each sits with the object it is about and
  renders *nothing* when empty: stuck payment operations on the Orders index behind
  `canPersonManagePaymentSettings`; stuck media deletions and owed processor erasures lead Settings'
  "Data" group in `settings/SettingsPage.tsx`. `/shop/[shopSlug]/reports` is the
  shop's own reading of itself and nothing else: the month by default, the year at `?range=year`,
  one segmented control between them, and **no money at all on the year** (ADR 20260908-one-hand,
  decision 6, lever T). The year prints as a 3:2 card at `reports/card`, staff-only.
- **A diver asking for a day not on the board**: one composer, `src/components/DateRequestForm.tsx`,
  behind one action `src/app/actions/inquiry.ts`; staff read them at `shop/[shopSlug]/requests`.
  Never the wait list or the last-minute deal list — those answer "tell me when a seat frees".
- **A dive site's briefing**: written on `dive-sites/_components/SiteFields.tsx`; read on the
  departure page as four beats in `_components/TripDayPlan.tsx` — `TripLookFor`, `TripRoutes`,
  `TripMoments`, `TripSiteNotes`. Every sentence comes off the site row, uncaptioned; the fit tone
  is one word and there is no canned filler (ADR 20260813-dive-site-briefings-are-the-shops-own-words).
  The field guide is the one exception — a *selection* of catalog species whose words are DiveDay's
  (`src/i18n/marine-life-labels.ts`).
- **Design tokens**: `src/app/globals.css` (semantic only, ADR-0004). **Wrappers**:
  `src/components/ui/` — `form.tsx` (`Field`, `FieldGrid`, `controlClass`, `FormStatus`,
  `FieldErrorFocus`, and `StatusInView`, which `FormStatus` carries), `button.ts` (`buttonClass`),
  `card.tsx` (`SectionCard`, `sectionCardClass`), `tone.ts` (`toneMark`). Readiness words: `src/i18n/readiness-labels.ts` — never spell a status
  inline. Heading levels come from `src/components/ui/typography.ts` (`pnpm check:type-ramp`).
- **Paging a staff list**: `src/components/Pager.tsx` + `offsetPage` in `src/db/paging.ts`. Every
  paged staff list wears it with `words={staffPagerWords(t)}`, and the public reviews archive with
  the diver bundle's words (ADR 20260803-one-pagination-model); keyset cursors (`src/db/cursor.ts`)
  are the one earned exception. A list's **count must share the row query's exact scope** (joins,
  `where`, `having`, `now`), or the pager promises pages that render nothing.
- **Link previews and icons** (`ImageResponse`): every surface that rasterizes at request time —
  DiveDay's own card at `link-card/route.tsx`, the three `opengraph-image.tsx` cards under
  `/recap/` and `/s/`, `pwa-icon-maskable/route.tsx` and `/shop/[shopSlug]/reports/card` — calls `allowSvgRasterization()` (`src/lib/og-rasterizer.ts`)
  first, and so does any new one: `next/image` disables libvips' SVG loader process-wide on first
  use and satori's output is SVG, so without it the card severs the socket mid-stream (ADR
  20260804-og-svg-rasterizer). **A metadata module that imports `next/og` reaches every page entry
  in its segment's subtree**, so one in the *root* segment reaches the whole app — which is how the
  favicon and then the root card each put 3.07 MiB of renderer into every closure in it. The
  favicon and touch icon are committed PNGs now, re-rendered by `pnpm brand:icons` (issue #1361),
  and DiveDay's card is a route handler named by `sharedLinkCardImage` in `src/lib/site-metadata.ts`
  (issue #1709); `src/app/_og/card.test.tsx` refuses a new root metadata module and holds every card
  to the shared chrome. **Every page that exports an `openGraph` block spreads `openGraphSite`**
  (`src/lib/site-metadata.ts`): Next merges `metadata` shallowly, so a page-level block *replaces*
  the root layout's. `sharedLinkCard` (`src/lib/marketing.ts`) is this plus the card image — and the
  card is deliberately *not* inside `openGraphSite`, because a level that names `images` makes Next
  skip that segment's own `opengraph-image.tsx`. Structured data (`JsonLd`) never renders in
  `?embed=1` mode or on a bearer-token page.
- **Design for a surface that does not exist yet**: read
  [docs/design/design-artifacts.md](../design/design-artifacts.md) first — the canvas
  argues in pictures, the ADR decides, code obeys the ADR. Reach for a canvas only when a surface is
  significant enough for an ADR; for a component, a form or a copy change, the screenshot script and
  the **design-review** skill answer faster against the real app.

#### Semantic tokens only

No raw hex, no palette-scale classes in components (ADR-0004; `pnpm check:tokens`). Next
metadata-file conventions (OG images, icons, manifest) are exempt by design — tokens cannot reach a
Satori bitmap.

#### Forms, buttons and panels go through the wrappers

Stacked fields via `<Field>`/`<FieldGrid>`, button-shaped things via `buttonClass()`, controls via
`controlClass`, the bordered panel a page is made of via `<SectionCard>` (and its `loading.tsx`
twin via `sectionCardClass()`). Hand-rolled class strings are how fields fall out of alignment,
button labels drift off-center, and sibling routes one tap apart end up at two different corner
radii. Never pass a `text-<colour>` through `className` to `buttonClass()` — Tailwind emits colour
utilities **alphabetically by token name**, so the override silently loses to the variant's own
colour; that read as an instruction and did nothing at 31 call sites until 2026-08-15, and
`button.test.ts` now fails on it. If you find yourself cancelling a variant's own styles, the
variant is wrong. `SectionCard` has **deliberately no `radius` prop** — one that let each call site
keep its current corner would preserve the drift behind an abstraction. Pages space their sections
with `space-y-10` rather than per-section `mt-*`. See
[docs/design/forms-and-controls.md](../design/forms-and-controls.md).

#### Where a form says what happened

**Beside the form, never in a banner at the top of the page.** Field-level refusals go on the field
(`Field`'s `error` prop, which wires `aria-invalid`/`aria-describedby`); form-level ones go in the
action row (`FormStatus`), with `FieldErrorFocus` to move the cursor to the offending box. A page's
`?notice=` is routed to the form that produced it by `noticeForForm` (`src/lib/staff-notices.ts`);
the page banner is left for what is genuinely about the page.

**And it has to be on screen, or it said nothing.** Putting the outcome in its own section fixed a
confirmation appearing off-screen *above* a reader who saved halfway down, and left the mirror image
open: `PreserveFormScroll` puts them back exactly where they submitted from, so an outcome rendered
below the submit button can land below the fold. `FormStatus` carries `StatusInView`, which brings
it into view **only when it is off screen** — a status that yanks the viewport when the reader can
already read it is worse than one that does nothing — and never for `danger`, whose `FieldErrorFocus`
has the better destination. It waits for three conditions rather than a duration: the status is
something the renderer is drawing (`checkVisibility()`, not a zero-sized rect inside a `<details>`
that has just opened), `PreserveFormScroll` has stamped `SCROLL_SETTLED_ATTRIBUTE`, and the page has
stopped moving. All three were found by measuring: on the diver record's gear group the status read
viewport 138 mid-flight and 748 once the disclosure, the restore and the browser's smooth animation
between them had all landed.

#### A new page ships with a `loading.tsx` and `export const instant = true`

That file is the route's `<Suspense>` boundary — what a client navigation into the segment paints,
and what stands in the static shell while the page's request-scoped reads stream in. Shape it like
the body it replaces (an `animate-pulse` wrapper, `bg-surface-sunken` bars, `border-border
bg-surface` cards), never a spinner. **Never put an `await` above `{children}` in a `layout.tsx`**:
a layout wraps the page, so no boundary can be placed between them, and one request-scoped read
there costs every route beneath it its static shell — put the read in an async child inside its
own `<Suspense>`, with a fallback that holds its height. `next build` fails on a route that breaks
this (`blocking-prerender-dynamic` / `blocking-prerender-client-hook`), naming the component.
`instant = false` survives on exactly one layout, `src/app/shop/[shopSlug]/trips/[id]/layout.tsx`.
The staff shell is no longer the second: its six reads — session, shop row, locale, demo roles, nav
badge, boat link — moved into `_components/ShopChrome.tsx` behind a `<Suspense>` that holds the
bar's height, and its cross-tenant `notFound()` went with them, which is safe because every staff
page gates itself as well (ADR 20260804-instant-navigation; the **instant-navigation** skill).

#### Never hard-code a locale, and every rendered date names its zone

Every date, time and money figure formats for the negotiated request locale (`requestLocale`) —
never a literal `"en-US"` (`pnpm check:locale`). Timestamps are stored as UTC instants and
displayed in the shop's own zone, so every date/time render passes `shop.timezone` alongside the
locale. This is not a style preference: `Intl` falls back to the *host* zone when no zone is given,
and every DiveDay server and CI box is UTC, so an omission renders a 7:30 AM departure as 11:30 AM —
plausible, green, and four hours wrong on the screen a diver uses to decide when to leave. A value
with no instant in it says `timeZone: "UTC"` explicitly (`src/lib/calendar-date.ts`).
Biome's `timezone` rule enforces the rest ([Now Biome rules](#now-biome-rules)).

#### Copy comes from a message bundle, never a component

Diver copy in `src/i18n/locales/<locale>/diver.json`, staff copy in
`locales/<locale>/staff/<namespace>.json` (one file per area). `pnpm check:copy` is a full gate over
`src/app`, `src/components` and `src/features`: any hard-coded copy fails it. **Never add English
(or any language) as a string the user will read outside `src/i18n/locales/`** — every new sentence
lands in *every* locale's bundle in the same change, and a key missing from one locale fails
`pnpm check:locale`. Waiver/medical wording stays English pending H-01/H-03. **Any diver Client
Component that reads copy needs `DiverIntlProvider` above it** — without one it throws during the
server render and the page silently degrades to a blank client-only 200;
`src/i18n/provider-coverage.test.ts` fails on a consumer with no provider in an ancestor segment.
Staff Client Components take words as props (`staffTranslator` is server-side only). See the
**i18n-copy** skill and the i18n rules.

#### Every sentence earns its place, or it is deleted

Before writing a string — and every time you read past an existing one — ask whether the reader
would get something wrong without it. Only two kinds survive: one carrying a state or consequence
the surface cannot show on its own, and one that is genuine delight. A caption restating its own
heading, a clause explaining which rule won, a second manual path to what a nearby button already
does, and an apology for a refusal all go — deleted, not shortened, along with the element that held
them. Deleting a key means all three edits in one change: the call site, `en-US`, and `es-ES`. See
the **copy-restraint** skill. Where restraint and accessibility genuinely conflict, build for the
standard user and record the trade in
[docs/design/accessibility-tradeoffs.md](../design/accessibility-tradeoffs.md) — never a
follow-up, never silence. That licence stops at safety surfaces (manifests, roll call, cert gating,
medical flags), at keyboard reach, and at anything that costs the sighted user nothing.

#### Delete says Delete

Every delete is soft (`deleted_at`) and the word on screen is still "Delete" — never Archive,
Deactivate, Retire, Hide or "soft delete", and never a caption explaining which history survived.
A publish toggle is "Hidden", not deleted. The full rule and its exceptions are in the db rules
(`.claude/rules/db.md`) and ADR 20260820-every-delete-is-soft.

#### A panel that only renders when something has gone wrong

is photographed through `/api/test/seed-trouble-states`
(`src/app/api/test/seed-trouble-states/route.ts`), never by seeding the failure into the demo shop:
add the new state to that route and a capture beside the surface's calm one. A demo permanently
shouting that four payments are broken is a worse demo. Mutating is safe because each Playwright
worker owns its own database and resets it before every test (`e2e/servers.ts`).

#### Every surface gets looked at

A user-facing change is verified by looking at it — `node scripts/screenshot.mjs <path…>` against a
running `pnpm dev`, phone and desktop, light only unless the work is colour (then `--both`) — and by
the **design-review** skill for a significant surface. Every important flow gets an `e2e/` spec and
every important surface a capture in `e2e/visual.spec.ts` (the **e2e-and-visual** skill).
Safety-critical surfaces get a `dive-domain-expert` review.

### The db rules

For `src/db/` and `drizzle/`; the rules themselves are in `.claude/rules/db.md`.

#### Where things are

- **Schema** (source of truth — never read `drizzle/`): `src/db/schema.ts`. Locate a table with
  Grep and read the range; the file is 8,700 lines and the Read guard refuses it whole.
- **Client / test db factory**: `src/db/client.ts` (`getDb()`, `createTestDb()`).
- **Queries and seed data**: `src/db/shops.ts`, plus two barrels over sibling modules —
  `src/db/trips.ts` re-exports `trips-create/-series/-record/-schedule/-crew/-roster.ts`, and
  `src/db/seed.ts` orchestrates the `seed-*.ts` scenarios. Import from the barrel; edit the
  sibling.
- **Demo/seed data**: a new `src/db/seed-<scenario>.ts` plus one line in `src/db/seed.ts`'s
  orchestrator — never wedge rows into an existing scenario, which is how that file became the
  repo's top conflict magnet (ADR 20260803-seed-scenario-modules). Do **not** seed a failure state
  into blue-mantis (see the e2e rules: trouble states are seeded through
  `/api/test/seed-trouble-states`); `src/db/seed-front-desk.ts` says so at the row it deliberately
  seeds `succeeded`.
- **The booking transaction** (capacity enforcement): `src/db/bookings.ts` — read its tests first.
- **Staff seating a diver**: one consequence path, `src/db/seat-diver.ts` (booking + waiver-on-join
  + activity trail + analytics). Never re-implement the post-booking side effects at a call site.
- **Retention / pruning of append-only tables**: `src/lib/retention.ts` holds `RETENTION_DAYS` (the
  one table a human edits; the values are HD-11's call), `src/db/retention.ts` runs the bounded
  prune, `src/app/api/cron/retention/` is the weekly surface. The `stripe_webhook_events` window is
  asserted against Stripe's retry horizon, not merely commented.
- **Recurring trips**: materialization in `src/db/trips-series.ts`, cadence math in
  `src/lib/recurrence.ts`. A run has **no limit** (`trip_series.ends_on` null keeps going into a
  rolling `SERIES_HORIZON_DAYS` window). Every instance is an ordinary independent `trips` row — a
  deleted one leaves a `trip_series_skips` row so the roll never puts it back, and a moved one keeps
  its `series_occurrence_date` so the roll never re-fills the slot it left. **Narrowing a cadence
  cancels nothing** — orphaned dates are listed back with head counts and taken off only on a
  second tap (ADR 20260810-open-ended-recurring-trips).
- **Gear register**: opt-in **by presence** — zero `gear_items` rows means no gear UI anywhere
  (ADR 20260815-minimal-gear-register). The double-booking guard is the
  `gear_reservations_no_overlap` **exclusion constraint** (btree_gist, hand-added SQL in the
  migration, raced for real in `gear-reservations.postgres.test.ts`): catch 23P01 via
  `violatesExclusionConstraint`, never pre-check availability as truth. Service clocks are the
  newest `gear_service_events` row per kind and **inform, never gate**. `pnpm task:context gear`.
- **Buddy teams**: `src/db/buddy-pairs.ts` (named for its table, `buddy_pair_members`; every word a
  human reads says "team"). A team is two or more, a member is a booking **or** a crew person, and
  every act appends to `buddy_team_events` — informs, never gates (ADR 20260804-buddy-teams).
- **Starting content a shop copies and then owns**: `src/db/dive-site-templates.ts` and
  `src/db/course-templates.ts`, both `i18n-exempt-file` — picking one **copies** its words onto the
  shop's row, and nothing is read back at render, so a later correction never rewrites what a shop
  published. The **opposite** contract is `src/db/marine-life-catalog.ts`: 148 species as slug +
  Latin binomial + category code and no prose; DiveDay writes the words once in every language
  (`marineLife.*` in `diver.json`), and `MARINE_LIFE_CATALOG` is `as const`, so a species added
  without its copy is a **compile** error (ADR 20260813-marine-life-is-diveday-copy). A species
  DiveDay does not carry lands in `marine_life_requests` — a table nothing renders.
- **Course inquiries** (`course_inquiries`, `src/db/course-inquiries.ts`): `course_id` is nullable
  and the check constraint refuses a row naming neither a course nor an interest (ADR
  20260814-a-date-request-is-a-course-inquiry).
- **Integrations**: rows in `src/db/integrations.ts` (credentials sealed by `src/lib/secret-box.ts`)
  and `src/db/integration-events.ts` (the at-least-once outbox); OAuth state in
  `integration_oauth_states`, consumed once and bound to the shop **and** the person who started it.

#### Changing the schema

Follow the **schema-change** skill. The short form: edit `src/db/schema.ts`, `pnpm db:generate`
with a `--name`, review the generated SQL once, seed if e2e needs rows, and **before you push** run
the four coverage guards that assert over `schema.ts` from files you will never touch:

```bash
pnpm test src/db/export.test.ts src/db/diver-merge.test.ts src/db/delete-path-coverage.test.ts src/db/retention.test.ts --reporter=dot
```

Touching `schema.ts` at all is the trigger, not the shape of the change — `pnpm test:changed`
selects the whole suite after a schema edit, and that run belongs to CI
([docs/agents/verifying.md](verifying.md)). Never hand-edit or hand-merge
anything under `drizzle/`; a migration is generated, and a conflict there is resolved by reverting
your migration files, rebasing, and regenerating.

#### There is no legacy. Delete it.

DiveDay is pre-pilot: no users, no data anyone would miss (H-49, extending H-47). A table nothing
writes gets **dropped**, not carried behind a `seq` column so its dead rows sort nicely. A code path
that exists only to tolerate old rows gets **deleted**, not documented. A lifecycle rule that exists
only to age out abandoned objects gets **removed**, not waited out. Do not write reconciliation,
backfill, dual-read, or version-tolerance code for pre-pilot data, and do not read the absence of
one as an oversight to fix — three follow-ups proposed exactly that in one week, and each was a
migration spent on rows that have never had a reader. When in doubt the answer is the smaller tree.

**Two things this does not relax**, because they are not about the value of the data: the
**destructive-migration guard** and the expand/contract rule keep the *previous release* alive
while a migration runs inside the production build, and having no users does not help a shop
watching its schedule mid-deploy — a destructive migration still carries its
`-- diveday:allow-destructive <rule> <table>.<column>: <why>` line, where "pre-pilot, no users,
H-49" is now a sufficient *why*. And **H-02's retention windows and the erasure path** are promises
about data we *will* hold; they stand. This rule expires the moment the first pilot shop has real
divers in the system — Aaron will say so, and it is not an agent's call to make.

#### Every delete is soft, and the word on screen is still "Delete."

A user pointing at a thing and asking for it gone sets `deleted_at`; the row stays and history holds
(ADR 20260820-every-delete-is-soft, extending 20260719-crud-archive-semantics to every entity). This
is the default, not a list of blessed tables: a new table holding anything a user can delete gets
`deleted_at`, a partial index over the live rows only, and `deleted_at is null` in every
active-workspace read. The column is `deleted_at` — `archived_at` is not a second spelling of it.

**Never say so.** Not Archive, Unarchive, Deactivate, Retire, Hide, or "soft delete" in anything a
person reads — button, confirm, toast, notice, filter, empty state; a staff list of deleted records
is "Deleted" and its action is "Restore". No sentence explains which history survived: a caption
reassuring the reader about an outcome they never doubted earns nothing, and "archive" makes a shop
stop mid-afternoon to work out whether we mean the thing they asked for. The euphemism does not have
to be one of those words to be one: "Takes this diver off your active lists", under a heading saying
**Delete** and above a button saying **Delete Adaeze Nwosu**, was the only one of the three that
declined to say it (issue #779). `pnpm check:repo` refuses that family over the message bundles.

**A publish state is not a delete, and says so.** Hiding a review and taking a course off the public
site are both *unpublishing*: `tripReviews.isPublished` is reversible by republishing and a hidden
review still counts against the shop's suppression share (ADR
20260813-review-moderation-has-a-floor), and `courses.is_active` is the toggle on the "Live at
/s/<slug>/courses/<slug>" line — neither table has a delete at all. So "Hidden" is the honest word
in both, and the test is whether the thing is *gone* or merely *not shown*.

**Two exceptions.** *Legal erasure*, where an obligation requires real destruction — it stays
one-way, stays a separate column from `deleted_at` (`people.anonymized_at` plus its check
constraint), never becomes the primary action, and is the one place the distinction *is* expressed,
because the reader is choosing between two outcomes and one has no undo. And *machinery nobody
pointed at*: H-02's bounded retention prune, child rows rewritten wholesale when their parent saves
(`trip_dives`, `trip_schedule_days` — a replace), a single-use token consumed on use, seed and test
teardown. This does **not** touch the rule above it: "There is no legacy" governs the *tree*; this
one governs *rows at runtime*.

`deleteTrip` (`src/db/trips-schedule.ts`) stamps `trips.deleted_at` and leaves all five child tables
attached, and `scripts/check-live-trips.mjs` (in `pnpm check:repo`) fails the build on any read of
`trips`, or any join from a surviving child table, that neither carries `liveTrip()`
(`src/db/trips-live.ts`) nor says `diveday:allow-deleted-trips: <why>`. That gate exists because the
failure is silent and public: an unfiltered read shows an anonymous visitor a departure the shop
took off the board. `deleted_at` is the only spelling in the tree, internal names included.

A departure that *moves* has a second obligation: `trips.revision` is published as the RFC 5545
`SEQUENCE` (`src/lib/trip-calendar.ts`), so a write of `trips.starts_at` that leaves the revision
flat leaves every subscribed calendar on the old `DTSTART` (issue #1165).
`scripts/check-trip-revision.mjs` (also in `pnpm check:repo`) fails any `.update(trips)` writing
`startsAt` whose `.set()` neither bumps `revision` nor says `diveday:allow-flat-revision: <why>`
— the reason being required, and a `.set()` handed anything but an object literal being refused
rather than guessed at.

#### Tenant isolation

Every domain table carries `shop_id`; every query filters by the session's shop; a lookup by id,
slug or token cannot return another shop's row. A change to rows holding personal or medical data,
to export/import, or to a token flow gets a `security-reviewer` review before merge.

### The domain rules

For `src/lib/` and `src/features/`; the rules themselves are in `.claude/rules/domain.md`.

#### Where things are

- **Domain logic**: `src/lib/` — capacity in `trips.ts`, dates in `format.ts`.
- **Whether a diver may *buy* a seat vs. *board***: two different gates, deliberately. **Trip
  admission** (`src/lib/trip-admission.ts`, booking-time — "could this diver ever be cleared?") is
  weaker than **readiness** (`src/lib/readiness.ts`, boarding-time — "are they cleared now?"), and
  admission may never refuse someone readiness would clear. Both compose the same effective
  requirement via `getTripSiteRequirement`.
- **Payments and orders** (Stripe Connect): `src/lib/payments/` (checkout, connect, invoicing,
  promotions, webhook); order/refund state in `src/db/orders.ts`, `payments.ts`, `checkouts.ts`,
  `refunds.ts`, `stripe-accounts.ts`. Discount codes: shop-wide in `src/lib/promo-codes.ts` +
  `src/db/shop-promos.ts`; one-trip last-minute deals in `src/db/trip-promos.ts`. Both resolve in
  `bookSpot`; Stripe owns the arithmetic.
- **The Today work queue**: `src/lib/today.ts` / `src/db/today.ts`. `assembleDaySpine` re-files what
  `getTodayWork` ranked; no second detector. The end-of-day close-out composes from Today's own
  readers (`src/lib/closeout.ts`, `src/db/closeout.ts`) — never a second detector; closing is a
  recorded act, never a gate (ADR 20260804-day-closeout).
- **Notifications**: `src/lib/notifications/` (SES email, SNS SMS, Meta Cloud API WhatsApp);
  `courtesy.ts` picks WhatsApp-or-SMS; delivery/retry state in `src/db/notifications.ts`. A shop's
  own WhatsApp sender: `whatsapp-signup.ts`, tokens sealed by `src/lib/secret-box.ts`.
- **Offline manifests**: `src/lib/offline-manifests.ts` + `offline-manifest-store.ts` (encrypted
  IndexedDB); worker `src/worker/manifest-sw.ts`. Two API routes, deliberately not one:
  `api/offline-manifests/upcoming` answers with the whole 48-hour board, `identity` answers
  `{ shop: { slug } }` and nothing else. Both `no-store`; both read through the response types in
  `offline-manifests.ts`, never an inline cast (ADR 20260726-shopwide-offline-manifest-priming).
- **Dive-site difficulty**: `dive_sites.difficulty_level`, one of three codes
  (`src/lib/dive-site-difficulty.ts`), worded by `src/i18n/dive-site-labels.ts`. Never free text
  (ADR 20260813-dive-site-difficulty-is-a-code). `siteFit()` believes a chosen level outright and
  only falls back to its keyword sniff when there is none.
- **Recurrence**: `src/lib/recurrence.ts` is a pure `seriesOccurrenceDates`; materialization lives in
  `src/db/trips-series.ts` (see the db rules).
- **Retention windows**: `src/lib/retention.ts` — `RETENTION_DAYS` is the one table a human edits.
- **Course content**: shapes and parsers in `src/lib/courses.ts`. A depth in course prose is a
  **marker**, not words: `{depth18}` reads "18 meters" or "60 feet" by the shop's `depth_unit`,
  resolved once per page by `resolveCourseContentDepths` as a lookup into the agency pairs. A
  *broken* marker is refused when the editor saves (`courseDepthPlaceholderIssues`), never rendered
  — shop prose deliberately never touches ICU (ADR 20260814-course-depth-markers).
- **Auth**: `src/lib/auth.ts` (better-auth + credentials plugin) / `auth-secret.ts` / `authz.ts` +
  `session.ts`; edge layer in `src/proxy.ts`. `/shop/**` is staff-only end to end — there is no
  public-route allowlist any more. The proxy is convenience, not the security boundary.
- **Staff destinations**: one registry, `src/lib/staff-destinations.ts` — path, permission gate,
  badge source, and the nav **section** each destination lights (ADR 20261001-logbook). The nav is
  the sections, by name, always on screen; the search is a shortcut, never the only door.
- **Staff notices**: `src/lib/staff-notices.ts` — `noticeUrl(path, code, extra?)` writes,
  `noticeFromParam` reads, `shopPath(slug, ...segments)` builds. `noticeUrl` percent-encodes every
  value, merges `&bid=`/`&count=`/`&form=`, keeps an existing query and `#fragment`, and normalises
  the code to kebab; `shopPath` escapes each segment, which is what stops a client-supplied slug
  traversing out of `/shop/`. Codes are enforced kebab by `pnpm check:repo`; never hand-build the
  string.
- **SEO**: `src/lib/structured-data.ts`; `openGraphSite` in `src/lib/site-metadata.ts` (see the
  surfaces rules for why every page with an `openGraph` block spreads it).
- **Feature modules**: `src/features/<feature>/` — one `index.ts` is the whole public surface,
  `README.md` states what it owns; deep imports fail `pnpm check:architecture` (ADR
  20260730-feature-module-contracts). `calendar-sync`, `backup-export` and `integrations` exist.
  Integrations: one registry (`registry.ts`) names each provider and its event types,
  `dispatcher.ts` drains the outbox, one adapter per provider; a Zapier hook URL is pinned to
  `hooks.zapier.com` over https — never an arbitrary host.

#### Dependency direction

`app → features → lib/db`, one way, enforced by `pnpm check:architecture`: `src/lib`/`src/db` may
import neither `src/app` nor `src/features`. Routes stay thin; the rules live here.

#### Read time through the clock

`src/lib`, `src/db`, and `src/features` never call `new Date()` / `Date.now()` directly — use
`nowDate()` / `nowMs()` from `src/lib/clock.ts` (default a `now` parameter to it). This is what lets
the e2e fleet freeze one instant so the clock-anchored seed and every render stay pixel-stable for
visual regression; in production the clock is the native call, unchanged. Biome's `clock` rule
enforces it. Never stabilise a visual test by masking moving text — freeze the clock at the
Playwright harness boundary.

#### Trips late-arrival and departure buffer

Because trips often run late, every check deciding whether a departure has sailed, ended, or is
"in the past" allows a **1-hour buffer** on the scheduled time. Ask it through `hasSailed()` /
`hasReturned()` (`src/lib/trips.ts`), never a second `*_BUFFER_MS` and never the comparison by
hand: stated in prose alone the hour reached fifteen spellings, and `pnpm check:repo` refuses the
sixteenth ([docs/agents/repo-checks.md](repo-checks.md)).

#### Codes, not sentences

`src/lib` and `src/db` return **codes, not sentences**; the UI picks the words (ADR
20260731-domain-layer-copy-leaks, enforced by `pnpm check:domain-strings`). A data module that
*feeds* the UI (marketing claims, switching guides, demo roles) holds **message-bundle keys, never
words** — the key-registry pattern of `src/lib/marketing.ts` / `src/lib/demo-roles.ts` — and the
registries listed in `scripts/check-domain-strings.mjs`'s `proseFreeFiles` hard-fail on any
unexempted prose literal.

#### Every formatter names its zone

The `src/lib/format.ts` formatters take `timeZone` as a **required** parameter so a missing zone is
a compile error rather than a wrong time. A value with no instant in it (a date-only calendar date,
a wall-clock time of day) says `timeZone: "UTC"` explicitly — see `src/lib/calendar-date.ts`.
Every `Intl` formatter is built through `src/lib/intl-cache.ts`, never a bare `new Intl.*` at the
call site (constructing one costs ~12x reusing it; Biome's `intlCache` rule).

A formatted date or time is one unit on the line: every formatter in `format.ts` and
`calendar-date.ts` that prints one joins its parts through `keepUnitsWhole`
(`src/lib/date-parts.ts`), so "Jul 21" and "7:05 AM EDT" carry U+00A0 inside them and a line
breaks only where the pattern has more than a space (a comma, a range dash, Spanish "de"). A new
one joins the same way. A test matches them with a *string* query, which normalizes whitespace
(`getByText("Jul 21")`, `toHaveTextContent`), or with a regex that spells `\s` or `\u00A0` \u2014 a
regex is matched against the raw text, so `/Jul 21/` never matches, in `getByText` and `toHaveText`
alike; a string that leaves the page plain says so where it leaves (the SMS transport, a field's
own value in `formatWallTime`).

#### Safety and security

Safety-critical logic (manifests, roll call, cert gating, medical flags) gets boring code,
failure-path and adversarial tests, and a `dive-domain-expert` review. Auth/authz, token flows and
anything touching personal or medical data get a `security-reviewer` review before merge.

### The e2e rules

For `e2e/`; the rules themselves are in `.claude/rules/e2e.md`.

- **Focused runs only, locally.** `pnpm e2e <spec> --reporter=line`, or `pnpm e2e:run <spec>` after
  one `pnpm e2e:build`. The whole suite belongs to CI, and `scripts/guard-bash.mjs` refuses the
  bare form ([docs/agents/verifying.md](verifying.md)).
- **Every worker owns a server and a database**, and `/api/test/reset` restores the shared
  `blue-mantis` fixture's **schedule** before each test — but not the shop's **configuration**
  (the `RESET_KEEPS` list in `src/db/delete-path-coverage.test.ts`). **A test that writes shop-wide
  settings takes a shop of its own**: the lazy `privateShop` fixture in `e2e/fixtures.ts` (ADR
  20260815-per-test-private-shops). Never a `finally` that puts the setting back — nothing enforces
  it and it does not survive the failure it is there for. Each invocation derives a per-worktree
  base port; `E2E_BASE_PORT` overrides it.
- **No timing guesses.** `waitForTimeout`, `networkidle`, spec-level `retries:` and hand-rolled retry
  loops are refused by `pnpm check:e2e-hygiene` unless the line carries
  `diveday:allow-e2e-hygiene <rule>: <why>` naming the mechanism that makes it deterministic. The
  suite runs `retries: 0` so a flake fails loudly and gets root-caused; the fix for a race is always
  waiting for what the destination page itself renders.
- **Never navigate straight off a submit.** A `goto`/`reload` as the next statement after a
  submit-shaped click races the action it just sent, and `check:e2e-hygiene`'s `action-race` rule
  refuses it: the click resolves when the request leaves, not when the write lands, so the
  navigation can tear the page down mid-flight and the destination renders the state from before
  the save. Put the wait between them — `page.waitForURL()` on the action's own `?notice=`
  redirect, or an `expect(locator)` on what the row shows for a `useActionState` form that
  re-renders in place. **Reading the field back is not a wait**: an `expect(field).toHaveValue(…)`
  or `.toBeChecked()` naming what this same test typed passes on its first poll whether or not the
  write landed, so the rule steps straight over it — assert the round trip after a real wait, never
  as one. Both instances that reached CI failed dozens of lines away from the cause
  ([docs/agents/repo-checks.md](repo-checks.md)).
- **An absence assertion pairs with a positive query.** A locator naming a string nothing renders
  any more satisfies `.toHaveCount(0)` for the wrong reason, so keep the same string queried
  positively somewhere in the spec — that pairing is the only thing that proves the name still
  matches anything. It is a convention, not a guard: the rule was written and swept, and it flags
  98 lines across 46 of the 112 files here, so it is not live (#1403, counts in
  [docs/agents/repo-checks.md](repo-checks.md)).
- **A failing or flaky test is part of the work, even when unrelated to your change.** Never skip
  it, widen a timeout, or leave it red. Search open PRs first for a fix already in flight on the same
  spec.
- **Screenshots are full-size and unfiltered; bound the *page*, not the capture.** A surface that
  screenshots enormous is telling you the page is unbounded, and the fix is pagination (or a default
  range) in the product — never a `?filter=` in the spec that shrinks the picture. Narrowing a
  capture to make it cheap silently narrows what it can catch; the orders index was found this way:
  323 seeded orders, no pager, no baseline at all.
- **A panel that only renders when something has gone wrong** is photographed through
  `/api/test/seed-trouble-states`, never by seeding the failure into the demo shop. Add the state to
  `src/app/api/test/seed-trouble-states/route.ts` and a capture beside the surface's calm one.
- **Route coverage**: every `src/app/**/page.tsx` route is listed in `scripts/route-coverage.json`
  with the specs and `e2e/visual.spec.ts` captures that cover it, or a written `exempt` reason. The
  lists are hand-maintained (a spec usually *clicks* its way to a route); `--write` rewrites only
  mechanical facts, `--absorb` records a merge-in loss, `--report` prints the table. The `a11y`
  column is what `pnpm agent:health` reads for the axe share.
- **Fixtures**: prefer `staffContext.newPage()` and the exported fixtures; `pnpm check:e2e-fixtures`
  flags a hand-built context.
- **The clock is frozen at the harness boundary** (`TEST_FROZEN_CLOCK`); never stabilise a capture
  by masking moving text.
- **Visual diffs**: baselines live in S3 keyed by git commit (ADR
  20260729-reg-suit-visual-regression) — nothing to regenerate locally. "Approving" an intentional
  change means saying in the PR *why* the pixels moved and merging. Baselines are rendered on CI's
  Linux runners; on macOS nearly everything reads as changed — triage from the CI report.
- **Every important flow gets a spec, every important surface a capture** — if unsure whether
  something qualifies, it does.

### The scripts rules

For `scripts/`, `.claude/` and `.github/`; the rules themselves are in `.claude/rules/scripts.md`.

- **Every subprocess is bounded.** A synchronous `spawnSync`/`execFileSync` in `scripts/` goes
  through `runBounded`/`readBounded` in `scripts/subprocess.mjs`, with a ceiling from
  `SUBPROCESS_TIMEOUTS` — an unbounded one is how `pnpm check` hung permanently on a cloud runner
  (2026-08-14). Argument arrays, never a shell string, when any argument comes from a payload.
- **A hook fails open.** Every script wired in `.claude/settings.json` exits 0 on an unparseable
  payload, a missing binary, a timeout, or its own bug: a hook that blocks a session because it
  broke is worse than the thing it prevents. A `Stop` hook honours `stop_hook_active` so it cannot
  loop a session against itself. A refusal names the correct form, because a guard that only says
  no gets routed around. The full roster and each hook's reasoning:
  [docs/agents/session-hooks.md](session-hooks.md). Hooks load at session start,
  so a change to one needs a restart to take effect.
- **A guard gets a test beside it.** `scripts/check-<name>.mjs` ships with
  `scripts/check-<name>.test.mjs`, and a hook with `scripts/<name>.test.mjs`; `pnpm agent:health`
  lists the ones without. The "leaves alone" cases carry at least as much weight as the refusals.
- **A guard is spawned by `scripts/check-repo.mjs`** or it never runs; `pnpm check:agents` fails on
  one that is not in the table, and on the `check:repo` row in `AGENTS.md` naming the wrong count.
- **Ratchets turn one way.** `--write` banks a fall and refuses a rise; `--absorb "<why>"` records a
  deliberate rise with its reason in the baseline diff. `copy`, `domain-strings`, `tokens`,
  `architecture`, `type-ramp`, `voice`, `logical-properties`, `bundle-reach`, `route-coverage`,
  `locale` and `context-budget` all work this way. `locale`'s count is the one that will never
  reach zero — an acronym and a course name are the same word in Spanish, so read it as
  "unexamined" and name a deliberate one in `DELIBERATELY_IDENTICAL`
  ([docs/agents/repo-checks.md](repo-checks.md)).
- **The agent layer is checked** (`scripts/check-agents.mjs`): every skill has frontmatter whose
  `name` matches its directory and a `description` (the only part every session pays for); every
  skill is in `.claude/skills/README.md` and mentioned in `AGENTS.md`; every reviewer agent is in
  the index; every `task:context` path exists; every backticked repo path in `AGENTS.md` and in
  `.claude/rules/*.md` exists; every allowlist entry and every hook command in
  `.claude/settings.json` names a real script or package script; nothing in `.mcp.json` launches
  through a package manager.
- **Always-loaded context is budgeted** (`scripts/check-context-budget.mjs`): `AGENTS.md`,
  `CLAUDE.md`, any `.claude/rules/*.md` **without** `paths:` frontmatter, and every skill's and
  agent's `description:` line. A path-scoped rule is paid for only by the session that reads a
  matching file, which is why a rule that only matters under one directory goes in `.claude/rules/`
  with `paths:` and never in `AGENTS.md`. The fix for a red budget is to move the long half into
  `docs/` or a scoped rule and leave a pointer — never to compress the prose.
- **CI** (`.github/workflows/ci.yml`) shards the unit suite four ways and runs the whole e2e and
  visual suites; a local session runs the focused forms only. `scripts/check-ci-change-detection.mjs`
  pins how CI decides what to run — read
  [docs/agents/repo-checks.md](repo-checks.md) before touching it. Every layer of
  a stack runs the whole gate (ADR 20261003-every-stack-layer-runs-ci).
- **Skills** state *how*, docs state *what and why*; a skill that contradicts an ADR or the code is
  stale and is fixed in the same change. Keep a `description:` specific about its trigger, then
  short — the body is where length belongs. A reviewer agent lists only the tools it needs.
- **Text a human will copy is written unwrapped** — one line per paragraph — in a script's output as
  in a doc.

### The i18n rules

For `src/i18n/`; the rules themselves are in `.claude/rules/i18n.md`.

- **Bundles**: diver messages in `locales/<locale>/diver.json` (`diverTranslator`,
  `DiverIntlProvider` + `useTranslations()` for Client Components); staff messages in
  `locales/<locale>/staff/<namespace>.json` — one file per area, composed by `staff-messages.ts`
  (ADR 20260807-per-area-staff-bundles). A new area is a new file plus one import there, so parallel
  branches stop colliding in one 3,500-line bundle. `staffTranslator` is **server-side only** —
  staff Client Components take words as props.
- **Every key lands in every locale in the same change.** There is no "translate it later": a key
  missing from one locale fails `pnpm check:locale`, which also refuses a literal locale in the
  app. Deleting a key means all three edits at once: the call site, `en-US`, and `es-ES`.
- **Spanish**: read `src/i18n/locales/es-ES/README.md` first — terminology ("centro" for the shop
  entity, the retail-vs-entity split) and LatAm register are already decided.
- **Locale resolution** happens in one order: the reader's own choice (the
  `diveday_locale` cookie, `src/i18n/locale-cookie.ts`) → `Accept-Language` →
  `shops.default_locale`. The switcher is three doors onto one Server Action
  (`src/app/actions/set-locale.ts`), each language named in itself via `localeEndonym`, never from
  a bundle. Still **no `[locale]` route**: a locale in the path would fork every public URL and every
  canonical link (ADR 20260812-reader-chosen-language).
- **Provider coverage**: any diver Client Component that reads copy needs `DiverIntlProvider` above
  it, with a `namespaces` list that is not short; `src/i18n/provider-coverage.test.ts` fails
  otherwise, because the failure mode is a blank client-only 200.
- **Voice**: no message bundle reads as machine-written — a prose em-dash, an intensifier
  (*actually*, *genuinely*, *simply*), a "Here's how" lead-in, a "not just X" contrast or a "No X.
  No Y." run fails `pnpm check:voice`, per locale. So does a British spelling in English
  (*colour*, *centre*, *cancelled*, *grey*): DiveDay spells American (H-95). The reasoning and the before/after table are in
  [docs/design/brand.md](../design/brand.md)'s "What gives us away".
- **The apostrophe is `’` (U+2019)**, in every locale and in a route's `metadata` literals. A
  straight `'` fails `pnpm check:voice` unless it is ICU quoting — `'{depth18}'`, `'{{1}}'` — where
  the straight character is what makes the span a literal and a curly one would print. Both spellings
  render identically and no reader notices; Playwright matches them as different strings and every
  e2e spec hard-codes its English, which is what made this worth a guard (issue #1367).
- **Vocabulary the guards refuse**: Archive/Unarchive/Deactivate/soft-delete in any key or value
  (`scripts/check-soft-delete.mjs`, ADR 20260820-every-delete-is-soft; each locale states its own
  word list); "shop" where the entity word is decided otherwise (`scripts/check-shop-word.mjs`);
  ICU plurals that do not cover every category (`scripts/check-icu-plurals.mjs`).
- **Words that are DiveDay's, not a shop's**: the marine-life field guide (`marineLife.*` in
  `diver.json`, resolved by `marine-life-labels.ts`), readiness words (`readiness-labels.ts`),
  dive-site difficulty (`dive-site-labels.ts`), buddy-team words (`buddy-labels.ts`), gear words
  (`gear-labels.ts`). Never spell any of these inline in a surface.
- **Every sentence earns its place.** A caption restating its heading, an explanation of which rule
  won, an apology for a refusal — deleted, not shortened (the **copy-restraint** skill).
- Waiver and medical wording stays English pending H-01/H-03 — its date formatting is still
  locale-negotiated.
