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
> What follows is only what is still open, re-verified against the working tree; where a finding
> shipped *partly*, the residue survives and says which part.

## Verdict

The code findings are gone. Twenty of the original ranked findings have now been built across two
days: the safety spine reads every site a trip visits, crew are named in the roll call rather than
counted, the ledger records what Stripe actually settled and reconstructs the discount that produced
it, a webhook claim can no longer outlive a failed handler, a diver can be erased at the processor as
well as locally, and there is a backup posture, an incident runbook and a health endpoint where there
was none.

**Every finding that survives is one an agent cannot close.** Two are Critical and human-external.
Two are live claims the owner must retract or authorize. One waits on a colour-guide decision, one on
a spend decision, two on counsel. That is the whole top list — and as of the third pass it is very
nearly the whole *document*: the engineering queue below it is now empty of buildable work except
three residues that each name a decision, not a task.

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
   The review said this; the response to the review was 144 files of engineering, and the response to
   *that* was 82 more. The remaining dependencies — H-01–H-03 and H-08's Rescue figure, V-02, the
   contrast fixes (HD-17), the erasure ADR's counsel gate (HD-10/HD-11), HD-7's crew-roll-call
   question, the real-Postgres spend call (HD-19), and the incident runbook's `alerts@dive.day` TODO
   — all terminate in the same place: work only the owner can do. `pnpm gates` prints the age of
   every one of those rows on demand; the instrumentation arrived, the movement did not. The list
   above is now not merely the *highest* priority but very nearly the *whole* priority.
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
P0-1.

| # | ID | Sev | Finding | Where |
| --- | --- | --- | --- | --- |
| 1 | PROD-C1 | Critical | Launch critical path unmoved and now measured: **day 10 of rollout.md's 30-day list, 4 of its 7 items with no closed gate row** (attorney H-01–H-03, Resend sender + H-09 consent, V-01/V-02/V-04, the design-partner one-pager), a 5th (DEMA) naming no gate row at all. 32 gate rows — 16 open, 1 deferred, 15 closed; the oldest open — H-03, H-09, H-12, H-18 — have not moved in 10 days. `pnpm gates` reports this on demand; nothing it reports is an agent's to close | `pnpm gates`, [rollout.md](../rollout.md), [human-decisions.md](../human-decisions.md) |
| 2 | PROD-C2 | Critical | Zero recorded customer contact, ever. Personas are synthetic; the 165-task persona review was AI evaluating AI against AI. Untouched by any engineering to date, and untouchable by any | — |
| 3 | MKT-F5 / MKT-F10 | High | Two live claims-policy violations. `migration-guides.ts` still says "here's how shops actually make the switch" and "most shops review, fix a handful of rows, and import for real in one sitting" — fabricated usage proof with zero customers. And the offline roll-call claim is **published today** against rollout.md's own written embargo ("Until V-02 passes, no marketing claim about offline roll call") — a gap the crew work widened, since per-person crew roll call is online-only | `src/lib/migration-guides.ts:183,203`; `src/lib/marketing.ts:43` vs `rollout.md:102` |
| 4 | I18N-1 (residue) | High | **The WCAG-AA claim is still not true, and the scan is still blind to it.** Only the focus ring shipped (2.21:1 → 4.66:1 light, and it turned out `boat-mode` and `glare-mode` light were failing too — the roadmap had assumed they passed). The two token darkenings — tinted status-banner text (4.38/4.39:1) and placeholders (3.35:1) — remain deferred pending the colour-guide decision, and `e2e/a11y.spec.ts` still runs `.disableRules(["color-contrast"])` | `e2e/a11y.spec.ts:38-41`, [roadmap §contrast](../features/roadmap.md#accessibility-contrast-fixes-blocked-on-a-color-guide-decision) |
| 5 | TEST-2 / OPS-2 (residue) | High | No real Postgres anywhere in CI. The `FOR UPDATE` oversell guard cannot execute under PGlite, so the repo's most safety-critical concurrency control is untested; and `drizzle/` migrations still first meet a real server during the production deploy, even though the expand/contract rule and rollback procedure are now written down. The 2026-08-03 work added five migrations to the set that will meet it: two tables, six indexes and three enum types | `src/db/bookings.ts`, `.github/workflows/ci.yml`, `scripts/vercel-build.mjs` |
| 6 | DATA-H1 (gate) | High | The erasure mechanism is complete — local scrub, Stripe customer deletion, and a tracked obligation for the invoice snapshot no API reaches — but its ADR is deliberately **Proposed, not Accepted**. HD-10/HD-11 (counsel on erasure vs signed evidence, and retention windows) decide when it may point at a real diver. Nothing an agent does moves this | [20260802-diver-data-erasure](../../architecture/decisions/20260802-diver-data-erasure.md) |
| 7 | DOM-H1 (gate) | Medium-High | Both crew mechanisms now exist — a per-checkpoint count *and* a per-person roll call naming every rostered crew member. HD-7 is therefore no longer "which do we build" but "which does the launch jurisdiction **require**", which is a legal question and is unanswered | [20260803-per-person-crew-roll-call](../../architecture/decisions/20260803-per-person-crew-roll-call.md) |

Sections below hold the full per-lens findings, including everything Medium and Low.

## Consolidated action queue

Prompt-ready; ordered. P0 = before any real shop touches the product. Each task cites its lens
finding; safety-marked tasks need `dive-domain-expert` review, security-marked need
`security-reviewer`, per AGENTS.md hard rules.

### P0 — before a real shop touches it

1. **(MKT-F5/F10)** Resolve both live claims conflicts. Rewrite `CUTOVER_SECTION` in
   `src/lib/migration-guides.ts` to drop "how shops actually make the switch" / "most shops…" —
   advice and shipped importer behavior only. And put the offline roll-call claim to the owner:
   either pull `src/lib/marketing.ts:43` back to something V-02 does not gate, or record a decision
   lifting the `rollout.md:102` embargo. Leaving the repo contradicting itself in public is the one
   option that is not available (HD-25). Note the claim got *less* true on 2026-08-03: a checkpoint
   now also needs a per-person crew result, and crew roll call does not record offline.
2. **(OPS-4 residue, owner)** Create `alerts@dive.day` as a real mailbox and point everything that
   currently aims at it there — Sentry issue alerts, the Sentry Cron Monitor's missed check-in, the
   CDK stack's `alertEmail` context, and the app's own notifications — then stand up the external
   uptime monitor on `/api/health` and the public schedule that
   [incident-response-runbook.md](../../engineering/incident-response-runbook.md) specifies. The
   runbook, the probe, and the cron check-in all shipped; every alert path still ends nowhere.

### P1 — before/with the first pilot

3. **(TEST-2/DATA-L1/OPS-2)** Add a real-Postgres CI job (service container): apply `drizzle/`
   migrations from empty and from the previous release's schema, and run the booking/payments/
   payment-operations suites with genuinely concurrent connections — two transactions racing for
   the last seat, asserting exactly one wins. Nightly or gated on `src/db/**` (HD-19). Also carried
   in [roadmap.md's engineering-enablement backlog](../features/roadmap.md#p1--next).
4. **(I18N-1 residue)** Once the colour-guide decision (HD-17) lands: implement the two remaining
   contrast fixes as written in the roadmap, re-enable `color-contrast` in `e2e/a11y.spec.ts`,
   triage the visual diffs. Until then nothing in the repo may claim WCAG AA conformance. The scan
   itself is no longer the narrow part — it covers sixteen surfaces as of 2026-08-03 — but it still
   runs with `color-contrast` disabled, and the reason is recorded at the exclusion.
5. **(DATA-H1 gate, owner + counsel)** Once HD-10/HD-11 land, move
   [20260802-diver-data-erasure](../../architecture/decisions/20260802-diver-data-erasure.md) from
   Proposed to Accepted. Both engineering residuals it recorded are closed
   ([20260803-processor-erasure-obligations](../../architecture/decisions/20260803-processor-erasure-obligations.md)),
   so nothing remains here but the decision — and the operational habit it implies, since the
   invoice-snapshot obligation closes only when a human attests they filed Stripe's data-deletion
   request. Decide who does that and on what cadence.
6. **(DOM-H1, HD-7, safety)** Put the crew head count to counsel now that **both** mechanisms
   exist — the per-checkpoint count and the per-person roll call. The question is which the launch
   jurisdiction requires, and whether requiring both (today's behaviour) is more taps than a wet
   boat will actually take. Nothing is blocked on engineering.
7. **(SEC-D1/OPS-7)** Provision Upstash so sign-in/password-reset rate limits are global; add log +
   Sentry capture inside `checkRateLimit`'s fail-open catch (`src/lib/rate-limit.ts:242`, currently
   a bare `catch { allowed: true }`); fix the runbook's stale 30/hour figures (code says 60).
8. **(DOM-M6 residue, safety, owner)** The booking-time trip cert gate **shipped 2026-08-03** and
   narrowed this finding rather than closing it. A `dive-domain-expert` review found the gate is
   inverted relative to risk: it refuses carded regulars, and never refuses the un-carded stranger
   who is likeliest to buy the wrong charter. The trip's requirement is now stated above the public
   booking form, which removes most of the harm; what is left is the attestation half, and it is a
   decision, not engineering — **H-27**. See also **H-28** (composed gates can only tighten, which
   makes a real mixed-level Keys charter unsellable), **H-29** (`shopHasAdjudicated` triggers on a
   verified card only) and **H-30** (the public form's succeed/fail signal is still a
   certification-level oracle, against H-22's ruling).
9. **(TEST-3, watch)** The offline storage-eviction e2e flake is **not proven fixed.** The
   investigation found and removed a real product bug — the offline shell asserted "nothing saved
   on this phone" before it had opened the store, and the service worker replayed one cached
   document for every offline reload so the page only became correct through React's
   hydration-error recovery — and that timing dependence is a plausible cause. It was never
   reproduced, so treat a recurrence as unexplained rather than as a new flake.

### P2 — hardening and hygiene

10. **(ARCH-2, ARCH-4, I18N-2, I18N-4 — theme 2)** Make the remaining prose invariants executable.
    Carried to
    [roadmap.md's engineering-enablement backlog](../features/roadmap.md#p2--when-parallelism-or-scale-proves-the-need),
    which holds the four tasks; do not plan them from here. **I18N-2 is closed** as of 2026-08-03:
    `src/i18n/provider-coverage.test.ts` fails on a diver Client Component with no
    `DiverIntlProvider` above it, or a provider whose `namespaces` list is short.
11. **(DOM-M5, addressed 2026-08-05)** Retitle and replace the paraphrase with the published
    2026 UHMS/DMSC RSTC participant questionnaire; conditional Box logic and the direct-referral
    questions now match the source. The separate UK seam is removed until a jurisdiction-specific
    form is approved. The unrelated agency-enum question remains a separate backlog item; see
    [20260805-rstc-medical-questionnaire](../../architecture/decisions/20260805-rstc-medical-questionnaire.md).
12. **(DOM-M2 residue)** Decide whether the cited PADI 8/+2/12 entry-level figure should apply to a
    non-PADI Open Water course. The intro/DSD cap is now agency-agnostic and the glossary documents
    the carve-out, so this is a recorded, deliberate scope rather than a drift — but an SSI Open
    Water session with twenty students is still capped only by the boat.
13. **(DOM-M7)** Seed an instructor rostered as a session's **divemaster** — the one
    (shop roles × trip role) combination the seed does not cover. The rule itself is asserted by the
    monotonicity test in `src/lib/crew-roles.test.ts`; what is missing is a *visible* example. Add a
    second seeded instructor first — carried in
    [roadmap.md's engineering-enablement backlog](../features/roadmap.md#p1--next).
14. **(DOM-L2)** Marine forecast unit preference (Florida crews read feet).
15. **(DOM-L4)** `canRecordOfflineStatus` still reads `manifests[0]` regardless of checkpoint
    (`src/lib/offline-manifests.ts`) — a latent trap once a snapshot carries more than one.
16. **(SEC-D3)** Call the offline-manifest purge on offline-shell load, not only from
    `OfflineManifestAutoSave` (the online path), to shorten cross-tenant residency on shared
    devices (HD-24).
17. **(OPS-6)** Retry cadence is daily, not the 30s–1h the backoff math implies (one Vercel cron
    entry, `0 14 * * *`); a failed waiver email waits ~24h for retry #1.
18. **(OPS-9)** Cost guardrails cover the smallest bill (AWS); Vercel/Neon/Resend (hard 1,000/month
    free cap, unmetered) have none (HD-23).
19. **(ARCH-7 residue)** The duplication is gone — nine layout-level `instant = false` declarations
    that were provably covering nothing are deleted and 39 byte-identical TODO comments are down to
    zero ([20260803-instant-opt-out-placement](../../architecture/decisions/20260803-instant-opt-out-placement.md)).
    The review's "51 of 56 pages" did not reconcile: the real figure was 46 of 62 pages, and what had
    grown was the comment, not the opt-out. **The 46 page-level declarations are not deletable.**
    Each comes out only by wrapping that page's request-scoped read in a real `<Suspense>` boundary —
    the pattern `/sign-in`, `trips/new`, `trips/[id]/guests` and `dive-sites/new` already use — which
    is a per-page restructure gated by the safety-critical-surfaces rule, not a comment sweep.
20. **(DATA-A10 residue)** `booking_payment_events` is exported as its own CSV, by analogy with
    `roll_call_events`: append-only, booking-scoped, evidentiary, and the whole reason the table
    exists is to stop depending on Stripe for history — excluding it would have rebuilt that
    dependency for any shop that leaves. Still undecided and still unrecorded: `internal_notes`,
    `activity_events`, `course_inquiries`, `processor_erasure_obligations`, and the
    checkout/redemption/notification history. Extend the export or write the exclusions down.


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
  this is no longer a build question — it is whether a wet boat should be made to do both. → P1-7.
- **HD-8 (H-11 amendment).** Is DiveDay the nitrox fill log of record or explicitly not? The current
  H-11 wording overstates the product. → P1-9.
- **HD-10 (H-17 revisit, with counsel).** Imported waiver acceptance currently trusts a prior shop's
  medical clearance sight-unseen; present to the H-01 attorney as a package with the H-20/H-23
  verified-on-import choices. Also gates P1-6.

**Data, money, and legal posture:**
- **HD-11.** Erasure vs signed evidence: the mechanism is built — local scrub, Stripe customer
  deletion, and a tracked obligation for the invoice snapshot no API reaches — and its ADR sits at
  **Proposed** on purpose. Anonymize-and-keep (what shipped), hard-delete after a liability window,
  or refuse — and the retention windows for webhook/notification/token trails. A second question
  arrived with the obligation ledger: **who files Stripe's data-deletion request, and on what
  cadence**, since that obligation closes only on a human attestation and is never auto-retried.
  Blocks P1-6. **Its retention half narrowed 2026-08-03:** the pruning *mechanism* now ships, so all
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
  → P1-5.
- **HD-19.** Real-Postgres CI spend: nightly, per-PR on `src/db/**`, or not at all. → P1-3. The
  migration set it would exercise grew on 2026-08-03 by five migrations — two tables, six indexes
  and three enum types.
- **HD-20.** GA migration budget for the pre-release stack (Next preview, next-auth beta, drizzle
  rc, TS 7): one scheduled hardening sprint or opportunistic — and is pre-release-major the default
  posture for a SaaS taking real payments? → P2-13.
- **HD-21.** The lib/db layer contract: bless the status quo (one layer, pure/IO naming) and fix
  overview.md's "framework-free" claim, or enforce lib→db type-only imports. Either; the ambiguity
  is the only bad option.
- **HD-22.** Feature modules: name the second adopter (reviews; trips series/crew) or shelve the
  pattern.
- **HD-23.** Who is the second human? Every alert path terminates at one person — and as of today
  terminates at a mailbox that does not exist (P0-2). Name a backup or record solo-operator risk as
  accepted. Vercel Pro (hourly crons, SSE limits, spend caps) approved when real shops onboard?
  Resend→SES cutover trigger decided before it's needed mid-incident?
- **HD-24.** Sign-in rate limiting fail-open vs fail-closed on store outage (documented tradeoff,
  re-confirm for production); shared-device offline-manifest residency tradeoff (SEC-D3).
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
SEC-D2: `x-forwarded-for` trust is Vercel-assumption-load-bearing. SEC-D3: the offline manifest
store's cross-shop purge runs only from the online autosave path, so a shared device can retain the
previous shop's roster decryptable until that path runs. SEC-D4: SES/Resend webhooks rely on
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
  both mechanisms is more taps than a wet boat will take. → P1-7.
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
  no ratio cap. Recorded, not drifted — but still a gap. → P2-22.
- **DOM-M5 (Medium, addressed 2026-08-05).** The former "RSTC" questionnaire was an 8-question
  paraphrase of the 10-box form and referred every yes. The waiver now models the published
  2026-01-01 UHMS/DMSC form, including conditional Boxes A-G and its direct-referral questions;
  question 1 yes plus all Box A no answers clears as the source form specifies. See
  [20260805-rstc-medical-questionnaire](../../architecture/decisions/20260805-rstc-medical-questionnaire.md).
- **DOM-M7 (Low-Med).** The seed covers every (shop roles × trip role) combination except one: an
  **instructor rostered as a session's divemaster**. The demo shop has a single instructor, so
  seeding it would leave that session with nobody on the ratio and move seeded bookings, staffing
  and Today across the whole demo. The rule itself is asserted by the monotonicity test in
  `src/lib/crew-roles.test.ts`; what is missing is a visible example. Add a second seeded instructor
  first.
- **DOM-L1, L2, L4 (Low).** Agency enum omits CMAS/RAID/GUE; marine forecast composes English metric
  strings ignoring the shop's unit preference; `canRecordOfflineStatus` reads `manifests[0]`
  regardless of checkpoint (latent trap).

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
  gate: the ADR is still **Proposed** pending HD-10/HD-11. → P1-6.
- **DATA-H1 (recorded residues).** The invoice-snapshot obligation has **no API behind it and is
  never auto-retried** — it closes only when an owner attests they filed Stripe's data-deletion
  request, so an erasure with an undischarged obligation is genuinely incomplete and any promise
  made to a diver must say so. And the `course_inquiries` gap is *narrower, not closed*: a lead
  written with no email, or with an address no diver of the shop held at the time, and matching
  neither email nor phone at erasure, is still unreachable. Closing that needs a human saying "this
  lead is that diver", not fuzzier matching.
- **DATA-L1, L4–L6 (Low).** PGlite can't exhibit the prod races (lock ordering consistent but
  unenforced); migrations run inside the Vercel build with no destructive-DDL guard; ILIKE arms
  without trgm indexes (orders/courses); parallel-array jsonb on `courses.imageUrls/imageAlts`. The
  export gained `booking_payment_events` on 2026-08-03 but still omits `internal_notes`,
  `activity_events`, `course_inquiries`, `processor_erasure_obligations` and the
  checkout/redemption/notification history without a recorded portability decision (DATA-A10).
  (`default('usd')` on money columns — DATA-L3 — is gone.)

## 6. Payments & money

**Strengths.** Layered webhook defense (correct hand-rolled signature verification, an event-id
claim ledger that now keeps the claim and the chronological evidence on separate columns so
releasing one cannot destroy the other, idempotent per-handler state machines, account cross-checks,
out-of-order `account.updated` and `deauthorized` protection); live/test-mode segregation enforced against the verifying secret;
intents-before-Stripe-calls with deterministic idempotency keys; seats-before-money so Stripe
failure degrades to pay-later; payment truth only from Stripe; percent-only promos that can't go
negative.

**Findings.**
- **PAY-L2, L3 (Low). Closed 2026-08-06.** Reuse now re-derives the price, deposit policy,
  currency and promotion and re-mints when any of them moved — and the investigation found the
  finding understated: the confirmation panel's "Finish paying" button is an `<a href>` straight to
  the stored `checkout_url`, so the most-travelled path never reached the pricing code at all.
  `refundOrder` now claims the order row locally inside the transaction that records the intent, so
  a double tap is refused here rather than at Stripe — Stripe remains payment truth and its
  over-refund rejection remains the outer gate
  ([20260806-stale-quote-and-refund-lock](../../architecture/decisions/20260806-stale-quote-and-refund-lock.md)).
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
  → P1-3.
- **TEST-3 (Medium, new).** The offline storage-eviction e2e flake is unproven. Its investigation
  removed a real product bug (the shell asserted an empty phone before reading the store; every
  offline reload completed only via React hydration-error recovery), which is a plausible cause —
  but the flake itself was never reproduced. A recurrence is unexplained, not new.
- **TEST-M1 (Medium). Root-caused further 2026-08-06; `retries: 0` deliberately kept.** The `Intl`
  memoization credited with the earlier 6/18 → ~1/18 improvement had stopped at `src/lib/format.ts`'s
  file boundary: sixteen other modules still constructed their own formatters, `src/lib/zoned.ts`
  worst of all at *three* `Intl.DateTimeFormat`s per wall-clock conversion on a module 26 others
  import, and several surfaces built an `Intl.ListFormat` inside a `.map()`. Measured on a CI-class
  box: 12.3x for construct-vs-reuse on `DateTimeFormat`, 8.6x on `ListFormat`. All now share
  `src/lib/intl-cache.ts`. What this does **not** fix, and `ci.yml` now says so: two workers each
  running a browser *and* a `next start` server is four heavy processes on a four-core runner —
  deliberate oversubscription bought for half the runner minutes, removable only by paying for it.
- **TEST-M2 (Medium). Closed 2026-08-06.** Contract fixtures for every Stripe object and event the
  repo consumes, each recording the API version it was captured under, driving the real parsers
  rather than asserting against themselves; a guard fails when the code's pin and the fixtures'
  version diverge. It paid for itself immediately by catching a live bug the seam-level tests could
  not: `refundInvoice` asked Stripe to expand `payment_intent` (rejected outright by a current
  account) and then read the intent from a field Stripe has removed, so every invoiced refund
  returned `not_refundable` with no money moved while the hand-written payloads stayed green.
  Honest limit: no network or Stripe keys here, so the fixtures are **hand-authored** and the guard
  enforces internal consistency, not truth about Stripe — the fixtures' README documents the
  re-capture against a real test-mode account that would.
- **TEST-M3 (Medium). Narrowed 2026-08-06.** Direct component coverage added where e2e reaches only
  one path, picked by risk rather than convenience: the medical questionnaire's hidden-yes defence
  (clearing child answers when a parent flips to No — safety-critical and unreachable by e2e's
  single path), `BlockerGroups` (almost every decision is a *count*, and a wrong one reads
  plausibly), and roll call's tap-to-jump (invisible to screenshots). Each was proven able to fail by
  mutating the code path and confirming a targeted red. The layer is no longer untested, but it is
  three surfaces, not the whole app — this is narrowed, not closed.
- **TEST-L2, L3 (Low).** The perf budget is one number and never runs locally; guardrail scripts are
  regex-level (cooperative, not boundaries). (a11y breadth, the non-English e2e path and the visual
  mega-tests all closed 2026-08-03: the scan covers sixteen surfaces with a keyboard-only traversal
  beside it, one booking flow renders under `Accept-Language: es`, and `visual.spec.ts` is 162
  per-surface tests rather than 27 tours, so one diff no longer blinds its siblings. `color-contrast`
  is still excluded — see P1-4.)

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
  Blocked only on HD-17. → P1-5.
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
  → P0-1.
- **MKT-F10 (High, new).** `src/lib/marketing.ts:43` publishes "Save the manifest to a phone and roll
  call keeps working with no signal" while [rollout.md](../rollout.md) line 102 states "Until V-02
  passes, no marketing claim about offline roll call". Either the embargo is stale or the claim
  shipped early; the repo currently contradicts itself in public — and the 2026-08-03 crew work
  widened the gap, since a checkpoint now also needs a per-person crew result and crew roll call is
  online-only. → P0-1, HD-25.

## 10. Operations & production readiness

**Strengths.** Email is the most production-grade subsystem (durable rate permit, idempotency keys,
classified retries, parked-failure queue, staff-visible failure surfacing); capability-URL redaction
implemented and tested across all consumers; serverless-aware honesty in the stateful bits; sane
alert-only AWS cost guardrails; unusually good runbooks, which now cover backup/restore, deploy and
migrations, and incident response; fail-closed cron auth.

**Findings.**
- **OPS-4 (residue, High).** Every alert path now terminates at `alerts@dive.day` — a mailbox that
  **does not exist**, flagged `TODO(owner)` at the top of the incident runbook. The external uptime
  monitor the runbook specifies is likewise unprovisioned, so nothing watches from outside. The
  documentation shipped; the operational posture is still zero. → P0-2.
- **OPS-2 (residue, High). Closed 2026-08-06.** A `postgres:16` service-container job now applies
  `drizzle/` from empty and from the previous release's schema, and races two real connections for
  the last seat; the `FOR UPDATE` guard fails the job when removed. Gated on `src/db/**`/`drizzle/**`
  plus nightly. TEST-2 closes with it
  ([20260806-real-postgres-ci-job](../../architecture/decisions/20260806-real-postgres-ci-job.md)).
  Residual, stated in the runbook rather than left implied: the rehearsal is against an *empty*
  database, so lock duration and backfill runtime at production row counts are still unrehearsed.
- **OPS-6 (Medium). Closed 2026-08-06.** The cadence stays daily — sub-daily crons are a
  hosting-plan question — and the arithmetic stopped lying about it. The 30s–1h ladder is gone; a
  retry lands on the next daily pass, the budget is three passes stated in days rather than eight
  attempts stated as a count (which silently meant eight *days*), and a provider `Retry-After`
  longer than a pass is still obeyed. `src/lib/cron-schedule.ts` is the single home for the cadence
  and its test reads `vercel.json`, so the dead-man's switch and the retry window can no longer
  drift apart.
- **OPS-7 (Medium). Engineering half closed 2026-08-06.** The fail-open catch stays fail-open and
  now reports: a damped `rate_limit.store_failed` log plus a Sentry capture, carrying the store kind
  and error name but never the key. The runbook was re-audited row by row against `RATE_LIMITS` —
  the 30/hour figures were the least of it, and **three prose claims were wrong**, including a
  materially false security claim that every throttled caller gets the same generic notice (sign-in
  and password reset are deliberately generic; the capability-token surfaces deliberately are not).
  Still open and **not** engineering's: provisioning Upstash, without which the limits stay
  per-instance.
- **OPS-8 (Medium). Closed 2026-08-06.** The real defect was narrower and worse than "held per warm
  instance": the shared LISTEN connection was *never torn down*, so it was held by an instance's
  history rather than by any current viewer — which also stopped Neon's compute autosuspending. It
  now closes 120s after the last subscriber leaves, behind a generation counter so a failing
  instance stops re-dialling a database already out of connections. The cliff is documented in
  [realtime-manifest-events-runbook.md](../../engineering/realtime-manifest-events-runbook.md), and
  a refused viewer degrades to the existing five-minute poll — provably, not promised: the
  freshness pill reads snapshot age, never stream state
  ([20260806-manifest-listen-connection-ceiling](../../architecture/decisions/20260806-manifest-listen-connection-ceiling.md)).
- **OPS-9 (Medium). Closed 2026-08-06.** One correction to the finding: **Resend is not used** —
  SES has been the sole email provider since 20260803-ses-sole-email-provider, and SES spend is
  already inside the AWS budget. The real gap was Vercel and Neon, and both now have a ceiling
  registry (`src/lib/cost-guardrails.ts`) polled by a daily cron that mails the founder alert inbox
  once per ceiling per period. Alert-only, mirroring the AWS posture — nothing auto-disables. A
  probe with no credentials reports `not_configured`, never `ok`, because a monitor that reports
  healthy because it could not measure is worse than none
  ([20260806-provider-usage-guardrails](../../architecture/decisions/20260806-provider-usage-guardrails.md)).
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
in both passes, so the P-numbers cited above refer to **this** queue; HD numbers were not
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
