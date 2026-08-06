# Comprehensive review — 2026-08-02

> A whole-app review — concept, product, and codebase — run 2026-08-02 through ten independent
> lenses, each investigated by a separate reviewer against the code as it stands (commit
> `be15104`): product strategy, architecture, security, dive-domain safety, data model, payments,
> testing, i18n/UX/accessibility, marketing conversion, and operations. An assessment, not a
> commitment: items that survive owner review move to [roadmap.md](../features/roadmap.md) or
> [human-decisions.md](../human-decisions.md).
>
> **Reconciled 2026-08-03** against what shipped, twice. First against merge `b514066` (PR #319):
> all fourteen rows of the original "findings that matter most", plus OPS-5, DATA-L2, and defects
> the two required reviews found *in that new work*. Then against branch
> `claude/pay-m1-and-residuals`: **PAY-M1, PAY-M3, DATA-M1/M2, the two DATA-H1 engineering
> residuals, DOM-M3 and the DOM-H1 residue**. Per [docs/README.md](../../README.md)'s assessment
> rule, delivered recommendations are **deleted here, not annotated as done** — the deliveries are
> in [shipped.md](../shipped.md#the-2026-08-02-comprehensive-review-fourteen-top-findings-delivered-2026-08-02)
> and [shipped.md](../shipped.md#the-2026-08-02-review-payments-data-and-crew-residuals-delivered-2026-08-03).
> Then, **third pass, 2026-08-03**, against this branch: the whole remaining engineering queue —
> **PAY-M2, PAY-L1/L2, DATA-M3, DATA-L3, DOM-M4, DOM-M6, ARCH-3, ARCH-5, ARCH-7, ARCH-8, I18N-2,
> I18N-3, I18N-5, MKT-F3/F4/F6–F9, TEST-4/5/6**, recorded in
> [shipped.md](../shipped.md#the-2026-08-02-reviews-engineering-queue-delivered-2026-08-03).
> Three of those closed *partly* and survive as residues that say which part (DOM-M6, ARCH-7,
> DATA-A10); one — DOM-M6 — grew four new human-decision rows out of its own `dive-domain-expert`
> review rather than closing.
>
> **Fourth pass, 2026-08-06.** The last residues an agent could close: **DATA-A10** (the export
> grew seven files), **DOM-L4**, **DOM-M7**, **DOM-L2**, **SEC-D3**, and the engineering half of
> **OPS-4**, which the owner unblocked by creating `alerts@dive.day`. Recorded in
> [shipped.md](../shipped.md#the-2026-08-02-reviews-last-buildable-residues-delivered-2026-08-06).
> With those gone this document contains **no buildable work of its own**, so the queue below was
> restructured rather than renumbered: what is left is sorted by *who can close it*, and a second
> list names what an agent should build next — drawn from the lens reports, not from the queue,
> because the queue no longer holds any.
>
> What follows is only what is still open, re-verified against the working tree; where a finding
> shipped *partly*, the residue survives and says which part.

## Verdict

The queue is empty. Everything this review ever asked an engineer to do has been built across four
passes and five days: the safety spine reads every site a trip visits, crew are named in the roll
call rather than counted, the ledger records what Stripe actually settled and reconstructs the
discount that produced it, a webhook claim can no longer outlive a failed handler, a diver can be
erased at the processor as well as locally, a leaving shop takes its notes, its activity trail, its
message outcomes and its unconverted leads with it, and there is a backup posture, an incident
runbook, a health endpoint and a real alert mailbox where there was none.

**Every row that survives in the queue is one an agent cannot close.** Two are Critical and
human-external. One is a live claim the owner must retract or authorize — its sibling, MKT-F5's
fabricated usage proof, is checkably false whichever way the ruling goes and is now on the buildable
list instead. One waits on a colour-guide decision, one on a spend decision, several on counsel, and
the sharpest two wait on a dive shop that has never been contacted. **This review is finished as an
engineering input**: re-reading the queue will not produce another task.

That is a good outcome and a dangerous one. It is good because a real backlog closed in five days.
It is dangerous because a repo that measures itself by this document will now read "nothing to do"
and go build something nobody asked for — which is theme 1 happening again, in the one place best
positioned to cause it. So the queue below is split by *who can close it*, and a separate list —
*What to build while those wait* — is assembled from the Low and Medium findings still sitting in the
lens reports, which were never promoted into a queue and are real work. That list is a holding
pattern, not a plan: nothing on it is on the launch critical path, nothing on it closes a gate row,
and none of it substitutes for a phone call to a dive shop.

The sharpest thing the third pass produced was not a delivery. DOM-M6 — "a diver can pay in full for
a charter they cannot qualify for" — was built, and its required `dive-domain-expert` review found
the shipped gate **inverted relative to risk**: it refuses the carded regular the shop already knows,
and never refuses the un-carded stranger who is likeliest to buy the wrong boat. The finding is
narrowed, not closed, and it left four decisions behind (H-27–H-30). That is the pattern theme 5
predicts, working: the review of the fix found more than the fix did.

The launch critical path is unchanged and is now **day 10 of the 30-day list** in
[rollout.md](../rollout.md), with **four of its seven items showing no closed gate row** and a fifth
naming no gate row to close (`pnpm gates`, run 2026-08-03: 32 gate rows — 16 open, 1 deferred, 15
closed; H-03, H-09, H-12 and H-18 unmoved for 10 days). The product has still never had a recorded
conversation with a dive shop. The gap has not narrowed — it has been *measured*, which is not the
same thing, and two days of engineering later it is measured at exactly the same number.

## Cross-cutting themes

Five patterns still recur; they matter more than any single finding. Two of the original six have
closed out — the safety spine's gaps, and the money-divergence class a first Stripe reconciliation
would have found — and theme 5 is new.

1. **The critical path is not code, and shipping code is what the repo does when it is blocked.**
   The review said this; the response to the review was 144 files of engineering, then 82 more, then
   a fourth pass that closed the last six residues. The remaining dependencies — H-01–H-03 and
   H-08's Rescue figure, V-02, the contrast fixes (HD-17), the erasure ADR's counsel gate
   (HD-10/HD-11), HD-7's crew-roll-call question, and the real-Postgres spend call (HD-19) — all
   terminate in the same place: work only the owner can do. `pnpm gates` prints the age of every one
   of those rows on demand; the instrumentation arrived, the movement did not. The list above is now
   not merely the *highest* priority but the *whole* priority.

   One dependency did move, and it is the proof the pattern is breakable: the owner created
   `alerts@dive.day`, and the engineering that had been waiting behind it — repointing the AWS cost
   alerts, clearing two `TODO(owner)` blocks, telling the runbook the truth — took under an hour.
   The mailbox had been blocking since 2026-08-02. Every other row on this list is the same shape:
   small owner action, engineering already written or trivially writable behind it.
2. **What has a ratchet holds; what has only prose drifts** — still true, with one fewer exception.
   Visual regression now posts a per-PR report and a neutral check (owner's choice: *warn loudly,
   never block* —
   [20260802-visual-diff-pr-comment](../../architecture/decisions/20260802-visual-diff-pr-comment.md)),
   so "account for every pixel" has evidence attached even though it still cannot fail a merge.
   The rest is unchanged: ADR-0004 tokens have no check (I18N-4), the lib↔db contract is unchecked
   and already violated (ARCH-1), `check-architecture.mjs` has a side-effect-import blind spot
   (ARCH-2), the `DiverIntlProvider` footgun is tribal knowledge (I18N-2), "revisit at GA" triggers
   live only in ADR text (ARCH-4). An invariant that isn't executable is a suggestion.
3. **Claims outrun the gates that authorize them** — the theme the original review only half-saw,
   and the one surviving finding that is neither Critical nor waiting on an outside professional:
   the owner can close it this afternoon by choosing. `migration-guides.ts` still tells
   buyers how "shops actually make the switch" and what "most shops" do, with zero customers
   (MKT-F5); and `marketing.ts:43` publishes the offline-roll-call claim that
   [rollout.md](../rollout.md) line 102 embargoes until V-02 passes (MKT-F10). Two live violations of
   the claims policy, one against the repo's own written embargo, are the sharpest form of theme 1: a
   promise made on the strength of a field test that has not happened. Note what the crew work did
   *not* change here — naming crew in the roll call made the offline gap **wider**, not narrower,
   because crew roll call is online-only.
4. **PGlite hides what production will do** — unchanged, and now the largest untouched class and the
   only one still in the top findings. The `FOR UPDATE` oversell guard is still dead code under test
   (TEST-2, DATA-L1); LISTEN/NOTIFY ceilings are still prod-only (OPS-8). OPS-2's *documentation*
   half shipped, but no CI job applies `drizzle/` to a real server, so production is still the first
   one they meet — and the 2026-08-03 work added five migrations to the set that will meet it: two
   tables, six indexes and three enum types. One real-Postgres CI job retires most of this class;
   the only thing standing in front of it is a spend decision (HD-19).
5. **A fix's residue is now recorded in its ADR rather than found by the next review.** Every
   2026-08-03 slice states in its own *Consequences* what it deliberately did not do — crew roll call
   is not recordable offline, the departure board stays assign-only, unassign-then-reassign drops a
   per-trip role, the count-level attestation deliberately raises no Today row, the invoice-snapshot
   erasure obligation is never auto-retried. That is the intended pattern and it is why this
   assessment's finding list shrank rather than rotated. The class it does not cover is the one
   theme 2 names: a residue written in prose still drifts, so the ones that matter carry a
   regression test (the reassign case) or a fail-closed surface (the offline crew panel) rather than
   a sentence alone.

## The findings that matter most

Nothing on this list is an engineering task. Each row names the human decision or the human action
that is the actual blocker. Three of them already have their code written down and waiting for the
decision that releases it: the two contrast fixes in
[roadmap §contrast](../features/roadmap.md#accessibility-contrast-fixes-blocked-on-a-color-guide-decision),
the real-Postgres CI job in
[roadmap's enablement backlog](../features/roadmap.md#p1--next), and the `CUTOVER_SECTION` rewrite in
the buildable list below.

| # | ID | Sev | Finding | Where |
| --- | --- | --- | --- | --- |
| 1 | PROD-C1 | Critical | Launch critical path unmoved and now measured: **day 10 of rollout.md's 30-day list, 4 of its 7 items with no closed gate row** (attorney H-01–H-03, Resend sender + H-09 consent, V-01/V-02/V-04, the design-partner one-pager), a 5th (DEMA) naming no gate row at all. 32 gate rows — 16 open, 1 deferred, 15 closed; the oldest open — H-03, H-09, H-12, H-18 — have not moved in 10 days. `pnpm gates` reports this on demand; nothing it reports is an agent's to close | `pnpm gates`, [rollout.md](../rollout.md), [human-decisions.md](../human-decisions.md) |
| 2 | PROD-C2 | Critical | Zero recorded customer contact, ever. Personas are synthetic; the 165-task persona review was AI evaluating AI against AI. Untouched by any engineering to date, and untouchable by any | — |
| 3 | MKT-F5 / MKT-F10 | High | Two live claims-policy violations, and they are **not the same kind of problem**. MKT-F5 — `migration-guides.ts` saying "here's how shops actually make the switch" and "most shops review, fix a handful of rows, and import for real in one sitting" — is fabricated usage proof with zero customers, checkably false whichever way HD-25 rules, so the rewrite needs no decision and is buildable today. MKT-F10 does need the owner: the offline roll-call claim is **published** against rollout.md's own written embargo ("Until V-02 passes, no marketing claim about offline roll call"), and the 2026-08-03 crew work widened the gap, since per-person crew roll call is online-only. Either the boat day happens or the claim comes down | `src/lib/migration-guides.ts:183,203`; `src/lib/marketing.ts:43` vs `rollout.md:102` |
| 4 | I18N-1 (residue) | High | **The WCAG-AA claim is still not true, and the scan is still blind to it.** Only the focus ring shipped (2.21:1 → 4.66:1 light, and it turned out `boat-mode` and `glare-mode` light were failing too — the roadmap had assumed they passed). The two token darkenings — tinted status-banner text (4.38/4.39:1) and placeholders (3.35:1) — remain deferred pending the colour-guide decision, and `e2e/a11y.spec.ts` still runs `.disableRules(["color-contrast"])` | `e2e/a11y.spec.ts:38-41`, [roadmap §contrast](../features/roadmap.md#accessibility-contrast-fixes-blocked-on-a-color-guide-decision) |
| 5 | TEST-2 / OPS-2 (residue) | High | No real Postgres anywhere in CI. The `FOR UPDATE` oversell guard cannot execute under PGlite, so the repo's most safety-critical concurrency control is untested; and `drizzle/` migrations still first meet a real server during the production deploy, even though the expand/contract rule and rollback procedure are now written down. The 2026-08-03 work added five migrations to the set that will meet it: two tables, six indexes and three enum types | `src/db/bookings.ts`, `.github/workflows/ci.yml`, `scripts/vercel-build.mjs` |
| 6 | DATA-H1 (gate) | High | The erasure mechanism is complete — local scrub, Stripe customer deletion, and a tracked obligation for the invoice snapshot no API reaches — but its ADR is deliberately **Proposed, not Accepted**. HD-10/HD-11 (counsel on erasure vs signed evidence, and retention windows) decide when it may point at a real diver. Nothing an agent does moves this | [20260802-diver-data-erasure](../../architecture/decisions/20260802-diver-data-erasure.md) |
| 7 | DOM-H1 (gate) | Medium-High | Both crew mechanisms now exist — a per-checkpoint count *and* a per-person roll call naming every rostered crew member. HD-7 is therefore no longer "which do we build" but "which does the launch jurisdiction **require**", which is a legal question and is unanswered | [20260803-per-person-crew-roll-call](../../architecture/decisions/20260803-per-person-crew-roll-call.md) |

Sections below hold the full per-lens findings, including everything Medium and Low.

## What is left, by who can close it

Nothing below is an engineering task, and that is not a figure of speech: as of 2026-08-06 this
document's buildable content is zero. The rows are grouped by **who can close them**, because the
only thing that distinguishes them now is which human is required. Two already have their code
written and waiting on nothing else: the two contrast fixes in
[roadmap §contrast](../features/roadmap.md#accessibility-contrast-fixes-blocked-on-a-color-guide-decision)
and the real-Postgres CI job in
[roadmap's enablement backlog](../features/roadmap.md#p1--next). A decision is the whole cost of
each.

### Only a real dive shop can supply this

Not a decision the owner can make at a desk — these need a shop, a boat, or a buyer on a phone.
They are first because they are the only rows on this list that no amount of thinking closes.

1. **(PROD-C2, Critical)** Talk to a dive shop. Any dive shop. The product has never had a recorded
   conversation with one, so every persona, every workflow assumption, and the 165-task persona
   review are AI evaluating AI against AI. This is the row that makes every other row's priority a
   guess.
2. **(PROD-C1 / HD-2, Critical)** Name the first three pilot shops. The recruiting kit exists —
   one-pager, call list template, first-call script, V-02 run sheet — and the call list ships with
   **no rows** on purpose. If shops cannot be named this week, recruiting outranks everything below
   it, including legal.
3. **(V-02, and MKT-F10 behind it)** Get on a boat with the offline manifest. It is
   differentiator #2, it is unproven, and until it passes, [rollout.md](../rollout.md) line 102
   embargoes the marketing claim that `src/lib/marketing.ts:43` is publishing today. The 2026-08-03
   crew work made the claim *less* true, not more: a checkpoint now also needs a per-person crew
   result and crew roll call does not record offline. **Either the boat day happens or the claim
   comes down** — the repo contradicting itself in public is the one option that is not available
   (HD-25).
4. **(PROD-M3)** Decide the DEMA posture. It has no gate row at all, so `pnpm gates` can only print
   "NO GATE ROW" against a deadline the docs acknowledge and the behaviour ignores.

### Only counsel or a licensed professional can answer this

5. **(H-01–H-03)** Book the attorney: waiver language, medical questions, typed-consent standard,
   evidence retention. Unmoved for ten days as of the third pass, and every day of that is a day
   the pilot cannot start.
6. **(DATA-H1 gate, HD-10/HD-11)** Erasure vs signed evidence, and the retention numbers. The
   mechanism is complete — local scrub, Stripe customer deletion, a tracked obligation for the
   invoice snapshot no API reaches — and its ADR sits at **Proposed** on purpose. Its retention half
   is now one edit: the numbers live in `RETENTION_DAYS` (`src/lib/retention.ts`). A second question
   rides along: **who files Stripe's data-deletion request, and on what cadence**, since that
   obligation closes only on a human attestation and is never auto-retried.
7. **(DOM-H1, HD-7, safety)** Which crew head count does the launch jurisdiction require — the
   per-checkpoint count, the per-person roll call, or both? **Both mechanisms ship.** The real
   question underneath is whether a wet boat should be made to do both.
8. **(DOM-M6 residue, H-27–H-30, safety)** The booking-time cert gate shipped and its mandatory
   `dive-domain-expert` review found it **inverted relative to risk**: it refuses the carded regular
   the shop already knows, and never refuses the un-carded stranger likeliest to buy the wrong boat.
   The trip's requirement now sits above the public booking form, which removes most of the harm.
   What is left is the attestation half, and it is four decisions, not a task.
9. **(HD-6 residual)** The Rescue Diver scenario-supervision figure, which nothing currently
   enforces. **(DOM-M2 residue)** Whether the cited PADI 8/+2/12 entry-level figure should apply to
   a non-PADI Open Water course — an SSI Open Water session with twenty students is capped only by
   the boat today.

### Only the owner can decide or spend

10. **(HD-17)** The colour-guide decision. Still the highest-leverage two-day decision in the
    register: it blocks the two remaining WCAG contrast fixes (light-mode `--success` at 4.38:1,
    `--warning` at 4.39:1, placeholders at 3.35:1), and until they land `e2e/a11y.spec.ts` keeps
    running with `color-contrast` disabled and **no claim of WCAG AA conformance in this repo is
    true**. The code is written; only the palette is not chosen.
11. **(HD-19)** Real-Postgres CI spend: nightly, per-PR on `src/db/**`, or not at all. Behind it
    sits TEST-2/OPS-2 — the `FOR UPDATE` oversell guard is dead code under test, and `drizzle/`
    migrations still first meet a real server during a production deploy. The migration set grew by
    five on 2026-08-03.
12. **(OPS-4 residue, owner)** Stand up the external uptime monitor on `/api/health` and the public
    schedule, plus the status page. The mailbox half closed 2026-08-06 and every alert path now
    terminates in a real inbox — but every one of those paths runs *inside* DiveDay's own
    infrastructure, so the outage that takes the app down takes the alerting with it. Nothing
    watches from outside.
13. **(SEC-D1/OPS-7)** Provision Upstash so sign-in/password-reset rate limits are global rather
    than per-instance. The two engineering halves beside it are **buildable now** and listed below.
14. **(OPS-9, HD-23)** Cost guardrails cover the smallest bill (AWS). Vercel, Neon, and Resend —
    the last with a hard 1,000/month free cap and no metering — have none. Same row: name the second
    human, or record solo-operator risk as accepted.
15. **(HD-5)** An explicit engineering scope rule until Phase 0 exits. The evidence got stronger
    again on 2026-08-06: this review's entire engineering backlog is now closed, four days after a
    pass that closed the rest of it, while the gate rows have not moved. Writing the rule down beats
    arguing it per-PR.
16. **(HD-21, HD-22, HD-20, HD-8, HD-14, HD-15, HD-16, HD-25)** The remaining register: the lib/db
    layer contract, whether feature modules get a second adopter or get shelved, the pre-release-
    stack GA migration budget, whether DiveDay is the nitrox fill log of record, whether to surface
    the payment-history trail now that it is written, abandoned-checkout seat holds, platform
    economics, and the remaining marketing calls. Each is a paragraph of owner thought, not a
    sprint.

### Watch, do not act

17. **(TEST-3)** The offline storage-eviction e2e flake is **not proven fixed.** Its investigation
    removed a real product bug — the shell asserted "nothing saved on this phone" before it had
    opened the store, and the service worker replayed one cached document per offline reload, so the
    page became correct only through React's hydration-error recovery — and that timing dependence
    is a plausible cause. It was never reproduced. Treat a recurrence as unexplained, not as new.

## What to build while those wait

**Read this section as a holding pattern, not a plan.** Nothing in it is on the launch critical
path, none of it closes a row above, and picking it up instead of making a phone call is theme 1
happening again. It exists so that engineering time which is going to be spent anyway lands on
something a real shop would eventually have hit, rather than on new surface area the sole human then
has to stand behind. Ordered by how much a first pilot would regret its absence.

1. **Stop exporting live Stripe invoice pages (new, from this branch's security review).**
   `orders.csv` carries `hosted_invoice_url` and `invoice_pdf_url` — unauthenticated, long-lived,
   publicly reachable Stripe-hosted pages rendering a diver's name, email, address and line items.
   The codebase already knows they are sensitive: `anonymize.ts` nulls both on erasure, with exactly
   that reasoning. So a leaked export bundle is not only data at rest, it is a folder of live links
   to named divers' billing pages, and the README's "Not included" list says nothing about it. This
   predates the 2026-08-06 export work and was found while reviewing it. `stripe_invoice_id` alone
   is enough to reconcile against the shop's own Stripe account, so dropping the two URL columns
   costs a leaving shop nothing — but it *is* a change to a published export contract, so it wants
   a deliberate decision rather than a quiet edit. Top of this list because it is the only row here
   with a real-world downside if left.
2. **Rewrite `CUTOVER_SECTION` (MKT-F5).** `src/lib/migration-guides.ts:183,203` tells buyers "here's
   how shops actually make the switch" and "most shops review, fix a handful of rows, and import for
   real in one sitting" — an install base that does not exist. HD-25 asks whether that *counts* as a
   claims-policy violation; the rewrite does not need the ruling, because the sentences are
   checkably false either way. Advice and shipped importer behaviour only. This is the single
   highest-value buildable item in the document and it is a copy edit.
3. **Give `checkRateLimit`'s fail-open catch a voice (SEC-D1/OPS-7).** `src/lib/rate-limit.ts:242`
   is a bare `catch { allowed: true }`: a store outage silently disables sign-in rate limiting with
   zero signal. Log it and capture to Sentry. Independent of the Upstash spend decision, and while
   you are there, fix the runbook's stale 30/hour figures (the code says 60).
4. **Close the money-path Lows (PAY-L2, PAY-L3).** A reused pending checkout does not re-verify the
   current price or deposit policy, so a price change between attempt and completion is charged at
   the stale figure; and `refundOrder` relies on Stripe rejecting an over-refund rather than taking
   a local lock. Both are small, both are the class of bug a first pilot finds with real money.
5. **Harden the migration path short of a real-Postgres job (DATA-L5).** Migrations run inside the
   Vercel build with no destructive-DDL guard. A guard that refuses a `DROP`/`ALTER … TYPE` without
   an explicit acknowledgement is cheap, needs no CI spend, and is the half of HD-19's problem that
   does not wait on HD-19.
6. **Pin Stripe contract fixtures to an API version (TEST-M2).** Stripe is tested only to the seam —
   injected fetchers and seeded fakes — so a provider-side shape change is invisible until
   production. Fixtures recorded against a named version turn that into a test failure.
7. **Index the ILIKE search arms (DATA-L6).** Orders and courses filter with `ILIKE` and no trigram
   index. Invisible on a demo shop, linear on a real one.
8. **Fix the jsonb parallel arrays on `courses.imageUrls`/`imageAlts` (DATA-L4).** Two arrays whose
   correspondence is positional and unenforced; one row's drift silently mis-captions a course page.
9. **Close the i18n/a11y Lows (I18N-L1–L3).** A diver whose language the product does not carry gets
   no signal at all (there is no switcher, by design); trip times are unlabelled with a timezone for
   a cross-timezone booker; the keyboard/a11y scan's breadth still lags the "every important
   surface" bar even at sixteen surfaces.
10. **Add the agencies the enum omits (DOM-L1).** CMAS, RAID and GUE are absent, which quietly means
   a diver holding one cannot be recorded honestly. Flagged as a separate backlog item by
   [20260805-rstc-medical-questionnaire](../../architecture/decisions/20260805-rstc-medical-questionnaire.md);
   confirm the list with the domain reviewer before widening a safety-adjacent enum.
11. **Document the capability-URL residual in Vercel access logs (OPS-L1).** Redaction covers
    Sentry, Analytics and Speed Insights; the platform's own access logs still retain the raw URLs,
    and that is currently written down nowhere.
12. **Give the offline shell a tenant-identity endpoint of its own (new, same review).** It learns
    one string — which shop this browser is signed in as, for the cross-shop purge — by calling
    `GET /api/offline-manifests/upcoming`, which answers with the shop's entire 48-hour roster:
    diver names, emergency contacts, readiness blockers. The 2026-08-06 work deduplicated the
    request to one per round, but the shape is still wrong, and the route sets no `Cache-Control:
    no-store`. A `{ shop: { slug } }` response (or `?identityOnly=1`) is a small change with a real
    data-minimization win on the one surface that runs on a shared boat tablet.

Two more are already sequenced elsewhere and should be planned from there, not from here: the
remaining prose invariants (ARCH-2/ARCH-4/I18N-4 — theme 2) in
[roadmap.md's P2 backlog](../features/roadmap.md#p2--when-parallelism-or-scale-proves-the-need),
and the per-page `<Suspense>` restructure behind ARCH-7's 46 undeletable `instant = false`
declarations, which is a safety-gated per-page job rather than a sweep
([20260803-instant-opt-out-placement](../../architecture/decisions/20260803-instant-opt-out-placement.md)).


## Human decision register

Grouped; each blocks the listed action items. The register in
[human-decisions.md](../human-decisions.md) is the durable home for whichever of these the owner
accepts. HD numbers are stable and are never reused: HD-3, HD-4, HD-9, HD-12, HD-13 and HD-18 have
been answered and are **removed** rather than renumbered, and HD-6 survives only as the one half of
its ask that is still outstanding. HD-7 and HD-11 survive with their *asks* rewritten: the
engineering they were blocking has shipped, so what is left in each is only the decision. See H-25, H-26, the H-08 and H-06 amendments, and
[20260802-visual-diff-pr-comment](../../architecture/decisions/20260802-visual-diff-pr-comment.md).

**Launch and business (the sharpest questions first):**
- **HD-1.** Have the three long-lead clocks started — attorney (H-01–H-03), Stripe platform
  application, AWS SNS SMS compliance, entity (H-18)? If not, what starts them this week, and which
  Phase 1 slip is being accepted in writing? Day 10 of 30, four of seven items unstarted.
- **HD-2.** Who are the first three pilot shops, *by name*? The recruiting kit exists now — the
  one-pager, the call list template, the first-call script, the V-02 run sheet — and the call list
  deliberately ships with **no rows**. If shops can't be named today, recruiting outranks everything
  above, including legal.
- **HD-5.** An explicit engineering scope rule until Phase 0 exits. The review's own evidence got
  stronger again: the response to a review that said "stop building" was 144 files, and the response
  to *that* was 82 more. It did close the review's entire engineering backlog — which is the
  strongest version of both arguments, and exactly why the rule needs writing down rather than
  arguing per-PR.

**Safety and domain (need professional/legal input):**
- **HD-6 (residual).** The DSD figure is settled (H-08, 2026-08-02). Still outstanding from the same
  ask: the **Rescue Diver scenario-supervision figure**, which nothing currently enforces.
- **HD-7 (open).** Crew-in-roll-call: does the launch jurisdiction require the head count to cover
  crew *per person*, or does the per-checkpoint count satisfy it? **Both mechanisms now ship**, so
  this is no longer a build question — it is whether a wet boat should be made to do both. → *Only counsel or a licensed professional can answer this*, row 7.
- **HD-8 (H-11 amendment).** Is DiveDay the nitrox fill log of record or explicitly not? The current
  H-11 wording overstates the product. → the human decision register below.
- **HD-10 (H-17 revisit, with counsel).** Imported waiver acceptance currently trusts a prior shop's
  medical clearance sight-unseen; present to the H-01 attorney as a package with the H-20/H-23
  verified-on-import choices. Also gates the erasure row (*Only counsel…*, row 6).

**Data, money, and legal posture:**
- **HD-11.** Erasure vs signed evidence: the mechanism is built — local scrub, Stripe customer
  deletion, and a tracked obligation for the invoice snapshot no API reaches — and its ADR sits at
  **Proposed** on purpose. Anonymize-and-keep (what shipped), hard-delete after a liability window,
  or refuse — and the retention windows for webhook/notification/token trails. A second question
  arrived with the obligation ledger: **who files Stripe's data-deletion request, and on what
  cadence**, since that obligation closes only on a human attestation and is never auto-retried.
  Blocks the erasure row (*Only counsel…*, row 6). **Its retention half narrowed 2026-08-03:** the pruning *mechanism* now ships, so all
  that is left is the numbers. They live in one place — `RETENTION_DAYS` in `src/lib/retention.ts`
  ([20260803-append-only-retention](../../architecture/decisions/20260803-append-only-retention.md)) —
  and changing one is a one-line edit, not a project. The `stripe_webhook_events` window is the one
  with a floor rather than a preference: those rows are the chronological evidence
  `hasNewerAccountUpdate` reads, so a test fails if it is shortened toward Stripe's own retry
  horizon.
- **HD-14 (rewritten).** Payment history ledger: **the local append-only trail is built** —
  `booking_payment_events`, written inside `setBookingPayment` in the same transaction as every
  mutation ([20260803-booking-payment-events](../../architecture/decisions/20260803-booking-payment-events.md)).
  So the question is no longer whether to build it but whether to keep it and whether to surface it:
  nothing reads the trail yet, deliberately, because history cannot be added retroactively but a
  screen can.
- **HD-15.** Abandoned checkout = seats held forever: confirm book-now-pay-later, or define an
  auto-release window.
- **HD-16.** Platform economics: confirm monetization stays subscription-only (no `application_fee`
  mechanics exist; retrofitting touches every provider seam).

**Process and platform:**
- **HD-17.** The colour-guide decision blocking the two remaining WCAG contrast fixes — still the
  highest-leverage two-day decision in the register, and the reason the repo cannot claim WCAG AA.
  → *Only the owner can decide or spend*, row 10.
- **HD-19.** Real-Postgres CI spend: nightly, per-PR on `src/db/**`, or not at all. → *Only the owner can decide or spend*, row 11. The
  migration set it would exercise grew on 2026-08-03 by five migrations — two tables, six indexes
  and three enum types.
- **HD-20.** GA migration budget for the pre-release stack (Next preview, next-auth beta, drizzle
  rc, TS 7): one scheduled hardening sprint or opportunistic — and is pre-release-major the default
  posture for a SaaS taking real payments? → the human decision register below.
- **HD-21.** The lib/db layer contract: bless the status quo (one layer, pure/IO naming) and fix
  overview.md's "framework-free" claim, or enforce lib→db type-only imports. Either; the ambiguity
  is the only bad option.
- **HD-22.** Feature modules: name the second adopter (reviews; trips series/crew) or shelve the
  pattern.
- **HD-23.** Who is the second human? Every alert path terminates at one person — in a real mailbox
  since 2026-08-06, but still one person, and still nothing watching from outside. Name a backup or
  record solo-operator risk as accepted. Vercel Pro (hourly crons, SSE limits, spend caps) approved when real shops onboard?
  Resend→SES cutover trigger decided before it's needed mid-incident?
- **HD-24.** Sign-in rate limiting fail-open vs fail-closed on store outage (documented tradeoff,
  re-confirm for production). Its offline-manifest half is **narrower since 2026-08-06**: the
  cross-shop purge now also runs on offline-shell load, so the residency window on a shared device
  is the gap between shops rather than the gap until someone opens a `/shop/**` page. The tradeoff
  itself is unchanged — a device that never comes online keeps what it holds, because a purge needs
  a server-verified tenant and guessing one would delete a captain's working copy.
- **HD-25.** Remaining marketing calls: renaming "Try the staff app" (MKT-F4); whether "most shops…"
  counts as a claims-policy violation (MKT-F5); **whether the published offline roll-call claim or
  the V-02 embargo gives way** (MKT-F10); Twitter-card policy.

---

# Lens reports

Condensed to findings and load-bearing strengths; action items above. Shipped findings are deleted,
not struck through — see
[shipped.md](../shipped.md#the-2026-08-02-comprehensive-review-fourteen-top-findings-delivered-2026-08-02)
and [shipped.md](../shipped.md#the-2026-08-02-review-payments-data-and-crew-residuals-delivered-2026-08-03).

## 1. Product concept & strategy

**Strengths.** The competitive analysis is unusually honest for a self-assessment. The
differentiators are real and structural — fail-closed readiness, append-only roll call, encrypted
offline manifest, the portability wedge — not "delight" vapor. The claims policy is a genuine asset.
The rollout plan is concrete, and the recruiting kit that turns it into phone calls now exists.

**Findings.**
- **PROD-C1 (Critical).** The critical path is 100% human-external and has moved ~0% in the ten days
  since rollout.md ordered it started "today". `pnpm gates` now reports it exactly: 16 open gate
  rows; H-03/H-09/H-12/H-18 unmoved for 10 days; four of the seven "next 30 days" items with no
  closed gate row (attorney, consent policy, V-01/V-02/V-04, the design-partner one-pager) and a
  fifth — DEMA — with no gate row to close. Phase 1 targets Sept–Oct in-season pilots; every
  blocking clock is long-lead and unstarted. The tooling changed; the situation got one day worse.
- **PROD-C2 (Critical).** Zero recorded customer contact, ever. Personas are synthetic; the 165-task
  persona review was AI evaluating AI against AI. The product may be excellent against an imagined
  buyer.
- **PROD-H1 (High).** No market-size or unit-economics statement anywhere: 25 shops × $99 = $2,475
  MRR against a published two-year price lock (pre-legal-review), a founder-direct support promise,
  and a six-service infra stack. H-26 named the posture (lifestyle-scale) without pricing the work.
- **PROD-H2 (High).** Liability stack all open simultaneously: medical data + indefinite retention
  placeholder + no entity + no insurance (H-19 deferred) + binding published promises. H-25 decided
  pilots may run on the provisional waiver flow with a signed risk acknowledgment — which raises,
  not lowers, the value of the entity and the contract set.
- **PROD-H3 (High).** Owner repeatedly overrode agent-recommended safer defaults on imported-evidence
  trust (H-17, H-20, H-23) ahead of the counsel review that governs them; rework lands on shipped
  ADR-encoded behavior if counsel disagrees.
- **PROD-M1 (Medium).** Scope still expanding post-"breadth is done", and the response to a review
  that identified building-by-default as the failure mode was the largest single PR in the repo's
  history. Each ship adds claims/support/i18n/baseline surface the sole human must stand behind.
- **PROD-M2 (Medium).** The gear register — purchase-blocker #3, "a disqualifier for the classic
  shop" — is sequenced *behind* the read API + webhooks, which no buyer in the research corpus asked
  for.
- **PROD-M3 (Medium).** DEMA/seasonality creates a hard deadline the docs acknowledge and the
  behavior ignores; it still has no gate row, so `pnpm gates` can only report "NO GATE ROW" against
  it. Every Phase-0 slip compresses Phase 1 against it.
- **PROD-L1 (Low).** The docs metabolism manufactures work: synthetic backlogs are deferred with
  ceremony but never discarded for lack of external demand.

## 2. Architecture & code quality

**Strengths.** Layering enforced and green; exceptional type discipline (no `as any`/`@ts-ignore`
anywhere); reason codes not sentences; `src/db/bookings.ts` carries its reasoning inline to an
unusual standard; 130+ ADRs with honest supersession records, including one deliberately left at
**Proposed** because a human gate has not cleared.

**Findings.**
- **ARCH-1 (Medium).** The documented layer model doesn't match reality: overview.md calls `src/lib`
  "framework-free" but `lib/auth.ts` imports next-auth and `getDb`; `src/db` imports `src/lib` in ~80
  files; the lib↔db direction is unchecked either way; `src/i18n` floats under no layer rule at all.
- **ARCH-2 (Medium).** `check-architecture.mjs`'s `importPattern` misses bare side-effect imports
  (`import "@/app/x"`).
- **ARCH-4 (Medium).** The entire critical path (framework, auth, ORM, compiler) is pre-GA
  simultaneously (Next 16.3 preview, next-auth 5 beta, drizzle 1.0-rc, TS 7); ADR-justified, but the
  "move promptly at GA" triggers exist only as prose. reg-suit 0.14.x is a low-activity-upstream risk
  (acknowledged).
- **ARCH-6 (Low).** Feature-module pattern has one adopter and every post-ADR feature went flat; one
  more all-flat month and it's decorative.

## 3. Security & privacy

**Verdict: no exploitable tenant-isolation, authorization, token, or secret-handling defects
found**, on either the original sweep or the second `security-reviewer` pass over the 2026-08-02
erasure and settlement work. Every data path sampled re-derives the session and re-scopes to
`shopId` server-side, independent of the proxy. Confirmed-correct under adversarial reading: export
isolation; token flows (256-bit CSPRNG, hashed at rest, atomic consumption, HKDF rotation-safe HMAC
links, timing-safe compares, analytics redaction + no-referrer); H-14 live role re-reads;
server-side price/MOD/gear derivation; SSRF host-pinning; fail-closed test/cron routes. The second
pass raised six other issues, all fixed before merge. A third `security-reviewer` pass over the
2026-08-03 webhook, discount-snapshot and erasure work found and closed a **fail-open regression an
earlier PAY-M1 fix had itself introduced**: releasing the claim by *deleting* the ledger row also
destroyed the only chronological evidence `hasNewerAccountUpdate` reads, so a redelivered stale
`account.updated` could regress `charges_enabled`. The claim and the evidence now sit on two
columns — `claimed_at` (nullable, the claim) and `occurred_at` (the evidence) — and the row is never
deleted. Neither pass left an open residual; DATA-H1 survives only as a human gate.

**Defense-in-depth notes.** SEC-D1: rate limiting per-instance and fail-open without Upstash, and
the fail-open `catch` in `src/lib/rate-limit.ts:242` still swallows store errors with zero signal.
SEC-D2: `x-forwarded-for` trust is Vercel-assumption-load-bearing. SEC-D3 **closed 2026-08-06**: the offline manifest store's
cross-shop purge ran only from the online autosave path, which mounts in the staff shop layout, so a
captain who lived on the offline shell never ran one; the shell now purges on load and on every
reconnect, against the same server-verified slug, and lists nothing until it has. SEC-D4: SES/Resend webhooks rely on
idempotent upserts rather than an event ledger — fine today, thinner than the Stripe path if a
non-idempotent handler is ever added.

## 4. Dive domain & safety

**Strengths.** Fail-closed readiness engine (`unavailableReadiness()` — a failed lookup can never
read "ready"); append-only roll call whose carry-forward can only propagate *absence*;
departure-gated boarding; the nitrox request gate re-checked at every read with card-sighting
attestation for imports; published metre/foot depth pairs killing the unit-conversion false-alarm
class; medical fail-closed with newer-hold-wins; offline rejects never falling back to stale
optimism; minors' ages purged from crew phones.

**Findings.**
- **DOM-H1 (gate, Medium-High).** Crew are now both counted *and* named: the per-checkpoint
  attestation stays as the count-level record, and `roll_call_crew_events` gives every rostered crew
  member their own subject, with `missing_crew`/`crew_uncounted` reaching Today and the schedule
  board on the same terms a diver's gap does. Nothing engineering-side is left. What is left is
  **HD-7** — whether the launch jurisdiction requires per-person coverage, and whether requiring
  both mechanisms is more taps than a wet boat will take. → *Only counsel or a licensed professional can answer this*, row 7.
- **DOM-H1 (recorded residues).** Deliberate, and stated in
  [20260803-per-person-crew-roll-call](../../architecture/decisions/20260803-per-person-crew-roll-call.md)
  and [20260803-per-trip-crew-role](../../architecture/decisions/20260803-per-trip-crew-role.md)
  rather than left to be rediscovered. **Crew roll call is not recordable offline** — the offline
  crew panel says so in a third, neutral tone rather than alarming on every dive, and the checkpoint
  stays open; this is the same cost 20260802 accepted for the attestation, and it makes MKT-F10's
  published claim *less* true, not more. **Today's departure board stays assign-only**: it is a
  drag-and-drop scheduling surface, and the job someone is doing is set on the trip page.
  **Unassign-then-reassign does not preserve a per-trip role** — the row and the role go together —
  which is exactly how staff fix a mis-tap; it is why the job picker exists, and it carries a
  regression test rather than only a sentence. **The count-level attestation deliberately raises no
  Today row**: most shops have never filled it in, so it would fire on nearly every trip and bury
  the rows that mean a person is in the water.
- **DOM-M2 (residue, Medium).** The intro/DSD cap is agency-agnostic and the glossary documents the
  carve-out, so the SSI-Try-Scuba hole is closed. The cited PADI 8/+2/12 entry-level figure is still
  PADI-only by deliberate choice (`course-ratios.ts:167`), so a non-PADI Open Water session carries
  no ratio cap. Recorded, not drifted — but still a gap. → *Only counsel or a licensed professional can answer this*, row 9.
- **DOM-M5 (Medium, addressed 2026-08-05).** The former "RSTC" questionnaire was an 8-question
  paraphrase of the 10-box form and referred every yes. The waiver now models the published
  2026-01-01 UHMS/DMSC form, including conditional Boxes A-G and its direct-referral questions;
  question 1 yes plus all Box A no answers clears as the source form specifies. See
  [20260805-rstc-medical-questionnaire](../../architecture/decisions/20260805-rstc-medical-questionnaire.md).
- **DOM-L1 (Low).** The agency enum omits CMAS, RAID and GUE, so a diver holding one of those cards
  cannot be recorded honestly. The only Low left under this lens; flagged as a separate backlog item
  by [20260805-rstc-medical-questionnaire](../../architecture/decisions/20260805-rstc-medical-questionnaire.md),
  and it widens a safety-adjacent enum, so confirm the list with the domain reviewer first.
  → *What to build while those wait*, row 10. (DOM-M7, DOM-L2 and DOM-L4 shipped 2026-08-06.)

## 5. Data model & persistence

**Strengths.** Uniform tenancy/naming/`timestamptz` discipline with null-meaning docblocks;
exemplary time modeling (instants vs calendar facts, two-pass DST refinement, date-only expiry
through end of local day); integer minor units with per-row currency; production-grade concurrency
design (trip-row `FOR UPDATE` everywhere it matters, atomic checkout claims, advisory-locked
seeding, partial-unique invariants with written race narratives); indexes commented with the query
they serve; real pagination; consistent soft-delete/append-only patterns.

**Findings.**
- **DATA-H1 (gate, High).** Both engineering residuals are closed: the Stripe **customer object is
  deleted** through a provider seam after the erasure transaction commits, and what no API reaches —
  the name and email Stripe snapshots onto each invoice at finalization — is recorded in
  `processor_erasure_obligations` beside it
  ([20260803-processor-erasure-obligations](../../architecture/decisions/20260803-processor-erasure-obligations.md)).
  `course_inquiries` gained a `person_id` resolved at capture time by **exact email match** against
  a live diver of the shop, never from a phone and never back-filled. What survives is the human
  gate: the ADR is still **Proposed** pending HD-10/HD-11. → *Only counsel or a licensed professional can answer this*, row 6.
- **DATA-H1 (recorded residues).** The invoice-snapshot obligation has **no API behind it and is
  never auto-retried** — it closes only when an owner attests they filed Stripe's data-deletion
  request, so an erasure with an undischarged obligation is genuinely incomplete and any promise
  made to a diver must say so. And the `course_inquiries` gap is *narrower, not closed*: a lead
  written with no email, or with an address no diver of the shop held at the time, and matching
  neither email nor phone at erasure, is still unreachable. Closing that needs a human saying "this
  lead is that diver", not fuzzier matching.
- **DATA-L1, L4–L6 (Low).** PGlite can't exhibit the prod races (lock ordering consistent but
  unenforced); migrations run inside the Vercel build with no destructive-DDL guard; ILIKE arms
  without trgm indexes (orders/courses); parallel-array jsonb on `courses.imageUrls/imageAlts`.
  (`default('usd')` on money columns — DATA-L3 — is gone, and **DATA-A10 closed 2026-08-06**: the
  bundle gained seven files, and the two families that stayed out — `day_closeouts` and
  `processor_erasure_obligations` — now say why in the bundle README and on the export page rather
  than only in a test comment.) → *What to build while those wait*, rows 5, 7 and 8.

## 6. Payments & money

**Strengths.** Layered webhook defense (correct hand-rolled signature verification, an event-id
claim ledger that now keeps the claim and the chronological evidence on separate columns so
releasing one cannot destroy the other, idempotent per-handler state machines, account cross-checks,
out-of-order `account.updated` and `deauthorized` protection); live/test-mode segregation enforced against the verifying secret;
intents-before-Stripe-calls with deterministic idempotency keys; seats-before-money so Stripe
failure degrades to pay-later; payment truth only from Stripe; percent-only promos that can't go
negative.

**Findings.**
- **PAY-L2, L3 (Low).** A reused pending checkout doesn't re-verify the current price/deposit
  policy; `refundOrder` relies on Stripe's over-refund rejection rather than a local lock.
  (`async_payment_failed` and the unbounded `stripe_webhook_events` both shipped 2026-08-03.)

## 7. Testing & quality engineering

**Strengths.** 200+ unit test files concentrated where risk lives; bookings tested like the
safety-critical code it is (adversarial cases credited to their finders); zero snapshots, zero
skips, restrained mocking; best-in-class e2e isolation (per-worker server + in-memory PGlite,
both-halves clock freeze, external HTTP blocked); `retries: 0` with root-caused flake history;
~2,000 lines of guardrail scripts with deliberately no prose-triggerable escape hatch.

**Findings.**
- **TEST-2 (High).** The `FOR UPDATE` oversell guard is dead code under test and no real Postgres
  runs anywhere in CI — the migration-apply path and the concurrency guard are both unexercised.
  → *Only the owner can decide or spend*, row 11.
- **TEST-3 (Medium, new).** The offline storage-eviction e2e flake is unproven. Its investigation
  removed a real product bug (the shell asserted an empty phone before reading the store; every
  offline reload completed only via React hydration-error recovery), which is a plausible cause —
  but the flake itself was never reproduced. A recurrence is unexplained, not new.
- **TEST-M1 (Medium).** `ci.yml` itself estimates residual 5–10% per-test flake risk on the contended
  set under `retries: 0`; red shards tax every PR.
- **TEST-M2 (Medium).** Stripe tested only to the seam (injected fetchers, seeded fakes); no contract
  fixtures pinned to an API version.
- **TEST-M3 (Medium).** App/component layer thin (pages covered mainly transitively via e2e).
- **TEST-L2, L3 (Low).** The perf budget is one number and never runs locally; guardrail scripts are
  regex-level (cooperative, not boundaries). (a11y breadth, the non-English e2e path and the visual
  mega-tests all closed 2026-08-03: the scan covers sixteen surfaces with a keyboard-only traversal
  beside it, one booking flow renders under `Accept-Language: es`, and `visual.spec.ts` is 162
  per-surface tests rather than 27 tours, so one diff no longer blinds its siblings. `color-contrast`
  is still excluded — see *Only the owner can decide or spend*, row 10.)

## 8. i18n, UX & accessibility

**Strengths.** Hardened two-pass locale negotiation with the render/record distinction feeding
per-person notification locale; coverage enforcement with a correct ICU-placeholder parser; the
English-only waiver disclosed in the signer's language with e2e proof; the diver/staff split held in
every sampled component; high-quality idiomatic es-ES on critical strings; above-baseline a11y
engineering (correct focus trap, live regions, boat/glare modes, 44px floor structural in
`buttonClass`); locale+timezone discipline at every sampled formatting call site.

**Findings.**
- **I18N-1 (residue, High).** Two of the three contrast tasks remain: light-mode `--success` on
  `bg-success/10` computes 4.38:1 and `--warning` 4.39:1 against a 4.5:1 requirement, and
  placeholders sit at 3.35:1 on white / 3.07:1 on `--surface-sunken`. The axe scan still disables
  `color-contrast`, so CI cannot see either. **No claim of WCAG AA conformance is true today.**
  Blocked only on HD-17. → *Only the owner can decide or spend*, row 10.
- **I18N-4 (Medium).** ADR-0004 has no automated enforcement (currently held by review alone;
  spot-check clean).
- **I18N-L1..L3 (Low).** Unsupported-language divers get no signal at all (no switcher by design);
  trip times unlabeled with timezone for cross-tz bookers; a11y/keyboard scan breadth lags the
  "every important surface" bar.

## 9. Marketing & conversion

**Strengths.** Disciplined demo-first funnel with closed `FunnelTag` attribution; pricing-card
hierarchy right; the zero-social-proof problem handled by argument-from-checkable-proof instead of
pretense; onboard preserves fields on bounce and signs the owner straight in; SEO substrate nearly
complete.

**Findings.**
- **MKT-F5 (High).** "most shops review… and import in one sitting" and "here's how shops actually
  make the switch" fabricate an install base — a claims-policy brush with zero customers.
  → the buildable list below.
- **MKT-F10 (High, new).** `src/lib/marketing.ts:43` publishes "Save the manifest to a phone and roll
  call keeps working with no signal" while [rollout.md](../rollout.md) line 102 states "Until V-02
  passes, no marketing claim about offline roll call". Either the embargo is stale or the claim
  shipped early; the repo currently contradicts itself in public — and the 2026-08-03 crew work
  widened the gap, since a checkpoint now also needs a per-person crew result and crew roll call is
  online-only. → *Only a real dive shop can supply this*, row 3, and HD-25.

## 10. Operations & production readiness

**Strengths.** Email is the most production-grade subsystem (durable rate permit, idempotency keys,
classified retries, parked-failure queue, staff-visible failure surfacing); capability-URL redaction
implemented and tested across all consumers; serverless-aware honesty in the stateful bits; sane
alert-only AWS cost guardrails; unusually good runbooks, which now cover backup/restore, deploy and
migrations, and incident response; fail-closed cron auth.

**Findings.**
- **OPS-4 (residue, High).** The mailbox half closed 2026-08-06: `alerts@dive.day` exists, and
  every alert path terminates in it — Sentry issue alerts, the cron monitor's missed check-in, the
  app's own new-account alert, and the AWS cost alerts, whose stack default had been a personal
  Gmail and was the last one landing outside the operational inbox. **What is left is that nothing
  watches from outside.** Every path above runs inside DiveDay's own infrastructure, so the outage
  that takes the app down takes the alerting with it; the external uptime monitor on `/api/health`
  and the public schedule, and the status page beside them, are still unprovisioned.
  → *Only the owner can decide or spend*, row 12.
- **OPS-2 (residue, High).** The runbooks exist, but no CI job applies `drizzle/` migrations to a
  real Postgres — production is still the first real server they touch. Folded into TEST-2 / *Only the owner can decide or spend*, row 11.
- **OPS-6 (Medium).** Retry cadence is daily (one Vercel cron entry, `0 14 * * *`), not the 30s–1h
  the backoff math implies; a failed waiver email waits ~24h for retry #1.
- **OPS-7 (Medium).** Rate limiting per-instance until Upstash; the fail-open catch swallows store
  errors with zero signal; runbook figures (30/hour) drifted from code (60).
- **OPS-8 (Medium).** SSE + LISTEN holds one direct Neon connection per warm instance forever;
  viewers pin instances (cost + connection ceiling + no scale-to-zero); undocumented cliff.
- **OPS-9 (Medium).** Cost guardrails cover the smallest bill (AWS); Vercel/Neon/Resend (hard
  1,000/month free cap, unmetered) have none.
- **OPS-L1..L3 (Low).** Vercel access logs retain raw capability URLs (undocumented residual); VRT
  bucket world-readable (fine pre-launch, revisit); Sentry errors-only.

---

## Method

Ten independent reviewers, one lens each, run in parallel against the working tree at `be15104`;
every finding required file:line evidence and was written to survive an adversarial re-read.
Overlapping findings (cron fragility, PGlite parity, Upstash, retention) were merged in the queue
and credited to each lens's numbering.

**Reconciliation, 2026-08-03 (first pass).** Every claim of delivery was re-verified against the
working tree before its recommendation was deleted, and every surviving finding re-verified as still
true at its cited file:line. Three shipped *partly* and were rewritten to their residue (DOM-H1,
DATA-H1, I18N-1); one shipped in a form its original text no longer described (DOM-M2); three new
findings entered from the 2026-08-02 work itself (MKT-F10, PAY-M3, TEST-3). The tension the original
Method section left deliberately visible — `shop_promo_redemptions.amountChargedCents` documented as
deliberately pre-discount versus the promos-page label reading as misleading — is resolved:
recording Stripe's settled amount made the pre-discount reading obsolete everywhere except the
fallback branch then tracked as PAY-M3.

**Reconciliation, 2026-08-03 (second pass).** Six more findings verified delivered against the
working tree and deleted — PAY-M1, PAY-M3, DATA-M1/M2, the two DATA-H1 engineering residuals,
DOM-M3, and the DOM-H1 residue — each read in the code rather than taken from a summary. Two shipped
in shapes their original text did not prescribe and are recorded as such: PAY-M1's release path is
`claimed_at` nulled beside an untouched `occurred_at`, **not** the outer transaction the queue asked
for, because deleting the row (the first attempt) destroyed the evidence `hasNewerAccountUpdate`
reads and reopened a fail-open the security review then caught; and DATA-M1/M2's indexes both lead
with an equality column the queries actually pin (`kind`, `status`) rather than the bare timestamp
the review prescribed. Two findings survive with their *engineering* content deleted and only a
human gate left standing (DATA-H1, DOM-H1), and one new finding entered from the new work itself
(DOM-M7). The residues each 2026-08-03 slice deliberately left are recorded under their lens rather
than as findings, because each is stated in the ADR that created it. Queue numbering was reallocated
in both passes; the fourth pass retired P-numbers entirely (see below). HD numbers were never
renumbered, so inbound references from [human-decisions.md](../human-decisions.md) still resolve.

**Reconciliation, 2026-08-03 (third pass).** The remaining engineering queue was built and deleted
here, each delivery read in the code rather than taken from a summary. Three findings shipped in a
shape their original text did not describe, and are recorded as residues rather than closures.
**DOM-M6** is the important one: the gate was built and its mandatory `dive-domain-expert` review
then found it inverted relative to risk, misdescribed by the glossary, and — on a course session at
a gated dive site — silently refusing the student from the very course that grants the card. Three
of those were fixed before merge; the shape question became H-27–H-30. **ARCH-7** disproved its own
finding's arithmetic: the review counted "51 of 56 pages", the tree held 46 of 62, and what had
actually grown was a duplicated comment. The 46 page-level opt-outs are not deletable without a
per-page Suspense restructure, so the ticket is re-scoped rather than closed. **DATA-A10** narrowed
by exactly one table, because the export coverage guard forced a portability decision on
`booking_payment_events` that would otherwise have gone unrecorded. Two findings closed *because* a
guardrail refused the change: the export coverage test, and `check-locale` on the es-ES sweep.

**Reconciliation, 2026-08-06 (fourth pass).** The last six buildable residues were built and
deleted here — **DATA-A10**, **DOM-M7**, **DOM-L2**, **DOM-L4**, **SEC-D3**, and the engineering
half of **OPS-4**, which stopped being blocked when the owner created the mailbox. Each delivery was
read in the code, and three of them found something the finding itself had not said:

- **DOM-L4's fixture was the reason it survived.** `canRecordOfflineStatus` read `manifests[0]`, and
  the test that would have caught it built a snapshot with *one* manifest where a real snapshot
  carries one per checkpoint. The finding was filed as a "latent trap"; it was actually an
  unrepresentative fixture, and the fixture was fixed with the code.
- **DOM-M7 was blocked by a second hand-typed copy of the seed cast.** Adding the shop's relief
  instructor left her outside `resetDemoSchedule`'s stable-staff allowlist, so the first reset
  purged her and the next seed threw. Both call sites now read one definition. The same change also
  removed a `where role = 'instructor' limit 1` with no ordering, which would have silently
  reshuffled the demo between runs the moment a second instructor existed.
- **DOM-L2 was two bugs, not one.** The composed metric string ignored the shop's `depth_unit`, as
  filed — and the fix surfaced that the product's bare `{value}` ICU placeholders interpolate as
  text rather than formatting per locale. Invisible for every whole-number measurement in the
  product; visible the moment a wave height carried a decimal, which is how a Spanish reader would
  have been shown "0.7 m" beside a correctly-formatted "27 °C".

And one pre-existing latent flake surfaced rather than being introduced: `shop-promos.test.ts` read
`[0]` off an unordered, unfiltered `select()` over `shop_promo_redemptions`, a table the demo seed
also populates. It had been asserting against whichever row the heap returned first; a seed change
that moved rows around is what made it fail. Fixed by scoping the read to the code under test.

**The document's queue was restructured rather than renumbered.** With no buildable rows left, an
ordered P0/P1/P2 list implied a sequencing that no longer exists — every remaining row waits on a
different human, and none of them wait on each other. They are grouped by who can close them
instead, and a separate *What to build while those wait* list was assembled from the Low and Medium
findings still sitting in the lens reports, which were never promoted into the queue. That list is
explicitly labelled a holding pattern: it exists because theme 1 predicts the engineering will
happen anyway, and it is better aimed at findings a real shop would eventually hit than at new
surface area.
