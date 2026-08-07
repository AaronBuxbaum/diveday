# Comprehensive review — 2026-08-02

> ## 📦 Archived — fully dissolved 2026-08-07
>
> Every engineering finding this review ever raised has shipped, across five reconciliation passes.
> What survived the fifth pass — two Criticals with no engineering path, one live claims-policy
> violation still gated on the V-02 field test, the full human-decision register, and the two small
> items that turned out still genuinely open — is dissolved into the durable docs: the register is
> now [human-decisions.md](../human-decisions.md)'s **H-31 through H-44**, and the agency free-text
> companion field (DOM-L1) is a bullet in
> [roadmap.md](../features/roadmap.md#smaller-follow-ons-live-with-their-adrs). This file holds no
> open work of its own any longer — retained below for the rationale behind each finding, not as a
> plan. See the fifth-pass note at the end of the reconciliation history immediately below, and
> [human-decisions.md](../human-decisions.md)'s 2026-08-07 change-history row for what moved where.

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
>
> **Fifth pass, 2026-08-07 — dissolved and archived.** The fourth-pass bullet above named six
> residues; it did not name the other **eighteen** findings that shipped the same day in two more
> `shipped.md` sections —
> [data, i18n and telemetry](../shipped.md#the-2026-08-02-reviews-data-i18n-and-telemetry-residue-delivered-2026-08-06)
> and
> [operations, testing and payments](../shipped.md#the-2026-08-02-reviews-operations-testing-and-payments-residue-delivered-2026-08-06)
> — so the "What to build while those wait" list below and three engineering halves inside "who can
> close it" kept naming work that no longer existed. Re-verified in the code, not taken from either
> list: **DATA-L4, DATA-L5, DATA-L6, PAY-L2, PAY-L3, TEST-M2, I18N-L1, I18N-L2, I18N-L3, OPS-L1, and
> the new offline-identity-endpoint finding** are shipped and gone from every list below; **SEC-D1's
> and OPS-7's engineering half** (the fail-open catch now logs and captures to Sentry) and **OPS-9's
> Vercel/Neon guardrails** are shipped, leaving only their owner-spend halves (Upstash provisioning;
> naming a second alert-inbox human) open. **MKT-F5 is closed, not merely buildable** —
> `migration-guides.ts`'s cutover copy no longer claims an install base; it now reads as advice and
> shipped importer behavior only. **ARCH-6 is answered** — `src/features/backup-export/` is a real
> second feature-module adopter, shipped 2026-08-04, so HD-22 needed no new decision row. What
> survived this pass — PROD-C1/C2 (human-external), MKT-F10 (gated on V-02), DOM-L1's residual
> companion-field gap, the live Stripe-invoice-URL export finding (new, found reviewing the
> 2026-08-06 export work), and the full human-decision register — is dissolved into
> [human-decisions.md](../human-decisions.md) as **H-31 through H-44** and one bullet in
> [roadmap.md](../features/roadmap.md#smaller-follow-ons-live-with-their-adrs). This document is
> archived rather than reconciled a sixth time: it has nothing further to reconcile.

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
fabricated usage proof, was checkably false whichever way the ruling went, and **closed 2026-08-07**:
`migration-guides.ts` no longer makes an install-base claim. One waits on a colour-guide decision, one
on a spend decision, several on counsel, and
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

The launch critical path is unchanged in kind, and by 2026-08-07 is **day 14 of the 30-day list** in
[rollout.md](../rollout.md), with **four of its seven items still showing no closed gate row** and a
fifth (DEMA) naming no gate row to close (`pnpm gates`, run 2026-08-07: 36 gate rows — 20 open, 1
deferred, 15 closed; H-03 and H-18 the oldest, unmoved for 14 days — H-09 and H-12 have since moved).
The product has still never had a recorded conversation with a dive shop. The gap has not narrowed —
it has been *measured*, which is not the same thing, and five days of engineering later it is measured
at a larger number of gate rows (H-27–H-30 registered in between), not a smaller one.

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
2. **What has a ratchet holds; what has only prose drifts** — still true, with three fewer exceptions
   than when this theme was written. Visual regression now posts a per-PR report and a neutral check
   (owner's choice: *warn loudly, never block* —
   [20260802-visual-diff-pr-comment](../../architecture/decisions/20260802-visual-diff-pr-comment.md)),
   so "account for every pixel" has evidence attached even though it still cannot fail a merge.
   **ARCH-2, I18N-4 and the I18N-2 residue shipped 2026-08-04** (`pnpm check:architecture` now sees
   bare side-effect imports and ratchets pre-existing debt; `pnpm check:tokens` fails raw hex and
   palette-scale classes; `provider-coverage.test.ts` now traces `src/components` consumers too — see
   [roadmap P2](../features/roadmap.md#p2--when-parallelism-or-scale-proves-the-need)) — this theme's
   text below was never updated to say so. What is still unchecked: the lib↔db contract, unchecked
   and already violated (ARCH-1, [H-40](../human-decisions.md)); "revisit at GA" triggers that live
   only in ADR text (ARCH-4, [H-39](../human-decisions.md)). An invariant that isn't executable is a
   suggestion.
3. **Claims outrun the gates that authorize them** — the theme the original review only half-saw.
   **MKT-F5 closed 2026-08-07:** `migration-guides.ts` no longer tells buyers how "shops actually
   make the switch" or names what "most shops" do; the cutover copy now reads as advice and shipped
   importer behavior only. **MKT-F10 is the one surviving violation**, and it is the sharpest form of
   theme 1: `marketing.ts`'s claim keys still resolve (via `marketing.features.diveDay.item5`) to the
   offline-roll-call claim that [rollout.md](../rollout.md) line 102 embargoes until V-02 passes — a
   promise made on the strength of a field test that has not happened, and the repo's own written
   embargo, not just policy. Note what the crew work did *not* change here — naming crew in the roll
   call made the offline gap **wider**, not narrower, because crew roll call is online-only.
4. **PGlite hides what production will do** — narrowed, not closed, and no longer in the top
   findings. The `FOR UPDATE` oversell guard is no longer dead code under test: a real-Postgres CI job
   shipped 2026-08-06, gated on `src/db/**`/`drizzle/**` plus nightly (its cadence — nightly and
   path-gated rather than per-PR — is [human-decisions.md](../human-decisions.md) H-38, not a
   blocker). What PGlite still hides: DATA-L1 (lock ordering is consistent but unenforced under
   single-connection PGlite) and OPS-8's LISTEN/NOTIFY ceiling remain prod-only-observable, and the
   real-Postgres job rehearses migrations against an *empty* database, so lock duration and backfill
   runtime at production row counts are still found in production, not CI.
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
that is the actual blocker. **Superseded 2026-08-07 by [human-decisions.md](../human-decisions.md)'s
H-31 through H-44** — the table below is the fifth-pass-verified snapshot at closure, kept for
rationale; for current status read the register, not this table.

| # | ID | Sev | Finding | Where |
| --- | --- | --- | --- | --- |
| 1 | PROD-C1 | Critical | Launch critical path unmoved: as of 2026-08-07, day 14 of rollout.md's 30-day list, 4 of its 7 items with no closed gate row (attorney H-01–H-03, Resend sender + H-09 consent, V-01/V-02/V-04, the design-partner one-pager), a 5th (DEMA, H-33) naming no gate row at all. `pnpm gates` (2026-08-07): 36 gate rows — 20 open, 1 deferred, 15 closed; the oldest open — H-03 and H-18 — unmoved for 14 days. `pnpm gates` reports this on demand; nothing it reports is an agent's to close | `pnpm gates`, [rollout.md](../rollout.md), [human-decisions.md](../human-decisions.md) H-31/H-32/H-33 |
| 2 | PROD-C2 | Critical | Zero recorded customer contact, ever. Personas are synthetic; the 165-task persona review was AI evaluating AI against AI. Untouched by any engineering to date, and untouchable by any | [human-decisions.md](../human-decisions.md) H-31 |
| 3 | MKT-F10 | High | The offline roll-call claim is **published** against rollout.md's own written embargo ("Until V-02 passes, no marketing claim about offline roll call"), and the 2026-08-03 crew work widened the gap, since per-person crew roll call is online-only. Either the boat day happens or the claim comes down. (MKT-F5, its original sibling finding, closed 2026-08-07: `migration-guides.ts`'s cutover copy no longer claims an install base.) | `src/i18n/locales/en-US/diver.json`'s `marketing.features.diveDay.item5` vs `rollout.md:102`; tracked under V-02 |
| 4 | I18N-1 (residue) | High | **The WCAG-AA claim is still not true, and the scan is still blind to it.** Only the focus ring shipped (2.21:1 → 4.66:1 light, and it turned out `boat-mode` and `glare-mode` light were failing too — the roadmap had assumed they passed). The two token darkenings — tinted status-banner text (4.38/4.39:1) and placeholders (3.35:1) — remain deferred pending the colour-guide decision, and `e2e/a11y.spec.ts` still runs `.disableRules(["color-contrast"])` | `e2e/a11y.spec.ts:38-41`, [human-decisions.md](../human-decisions.md) H-37 |
| 5 | ~~TEST-2 / OPS-2~~ | — | **Closed 2026-08-06.** A real-Postgres CI job now applies `drizzle/` from empty and from the previous release's schema and exercises the `FOR UPDATE` oversell guard under genuine contention. See [20260806-real-postgres-ci-job](../../architecture/decisions/20260806-real-postgres-ci-job.md). Its cadence (nightly + path-gated, not per-PR) is [human-decisions.md](../human-decisions.md) H-38 | — |
| 6 | DATA-H1 (gate) | High | The erasure mechanism is complete — local scrub, Stripe customer deletion, and a tracked obligation for the invoice snapshot no API reaches — but its ADR is deliberately **Proposed, not Accepted**. Counsel on erasure vs. signed evidence and retention windows (H-02) decides when it may point at a real diver; who files Stripe's own deletion request and on what cadence is [human-decisions.md](../human-decisions.md) H-36. Nothing an agent does moves this | [20260802-diver-data-erasure](../../architecture/decisions/20260802-diver-data-erasure.md) |
| 7 | DOM-H1 (gate) | Medium-High | Both crew mechanisms now exist — a per-checkpoint count *and* a per-person roll call naming every rostered crew member. The question is no longer "which do we build" but "which does the launch jurisdiction **require**", a legal question tracked as [human-decisions.md](../human-decisions.md) H-35 | [20260803-per-person-crew-roll-call](../../architecture/decisions/20260803-per-person-crew-roll-call.md) |

Sections below hold the full per-lens findings, including everything Medium and Low.

## What is left, dissolved 2026-08-07

The three sections this heading used to introduce — "What is left, by who can close it," "What to
build while those wait," and the "Human decision register" — are gone from this file. Verifying each
row against the working tree found most of the second list already shipped and unrecorded here (see
the fifth-pass note above), and everything that remained genuinely open is now tracked at its durable
home instead of duplicated in an archived assessment:

- **The full human-decision register, including every HD item this review ever raised**, is
  [human-decisions.md](../human-decisions.md)'s Decision register, rows **H-31 through H-44**. Each
  new row names its originating finding (PROD-C1, PROD-C2, PROD-M3, HD-6/DOM-M2, HD-7, HD-11, HD-17,
  HD-19, HD-20, HD-21, HD-23, HD-5, HD-25, and the live Stripe-invoice-URL export finding) so the
  provenance is one click from the live row.
- **The two contrast fixes** (I18N-1 residue) are written and waiting in
  [roadmap §contrast](../features/roadmap.md#accessibility-contrast-fixes-blocked-on-a-color-guide-decision),
  gated on H-37.
- **The real-Postgres CI job** shipped 2026-08-06 —
  [roadmap's enablement backlog](../features/roadmap.md#p1--next) — with its cadence question as
  H-38.
- **DOM-L1's agency free-text companion field**, the one item from the old "what to build" list that
  is still open and still buildable, is a bullet in
  [roadmap's smaller follow-ons](../features/roadmap.md#smaller-follow-ons-live-with-their-adrs).
- **Everything else the old "what to build" list named** — the rate-limit fail-open log voice
  (SEC-D1/OPS-7), the two payment-quote/refund-lock findings (PAY-L2/L3), the destructive-migration
  guard (DATA-L5), the Stripe fixture version pin (TEST-M2), the trigram indexes (DATA-L6), the
  `courses` gallery-photo jsonb fix (DATA-L4), the i18n/a11y lows (I18N-L1–L3), the cost-guardrail
  registry (OPS-9), the capability-URL access-log writeup (OPS-L1), and the offline shell's
  tenant-identity endpoint — **shipped 2026-08-06** and is recorded in
  [shipped.md](../shipped.md#the-2026-08-02-reviews-data-i18n-and-telemetry-residue-delivered-2026-08-06)
  and
  [shipped.md](../shipped.md#the-2026-08-02-reviews-operations-testing-and-payments-residue-delivered-2026-08-06).

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
- **ARCH-2 (Medium). Closed 2026-08-04.** `check-architecture.mjs`'s `importPattern` now sees bare
  side-effect imports (`import "@/app/x"`), holds `src/i18n`/`src/components` to the layer direction,
  and ratchets pre-existing debt in `scripts/architecture-baseline.json`.
- **ARCH-4 (Medium).** The entire critical path (framework, auth, ORM, compiler) is pre-GA
  simultaneously (Next 16.3 preview, next-auth 5 beta, drizzle 1.0-rc, TS 7); ADR-justified, but the
  "move promptly at GA" triggers exist only as prose. reg-suit 0.14.x is a low-activity-upstream risk
  (acknowledged). → [human-decisions.md](../human-decisions.md) H-39.
- **ARCH-6 (Low). Answered 2026-08-04.** `src/features/backup-export/` shipped as a genuine second
  adopter of the feature-module pattern (its own `index.ts`/README, per
  [20260730-feature-module-contracts](../../architecture/decisions/20260730-feature-module-contracts.md)),
  alongside `calendar-sync`. HD-22's "name the second adopter or shelve the pattern" needed no new
  decision row.

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
  both mechanisms is more taps than a wet boat will take. → [human-decisions.md](../human-decisions.md) H-35.
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
  no ratio cap. Recorded, not drifted — but still a gap. → [human-decisions.md](../human-decisions.md) H-34.
- **DOM-M5 (Medium, addressed 2026-08-05).** The former "RSTC" questionnaire was an 8-question
  paraphrase of the 10-box form and referred every yes. The waiver now models the published
  2026-01-01 UHMS/DMSC form, including conditional Boxes A-G and its direct-referral questions;
  question 1 yes plus all Box A no answers clears as the source form specifies. See
  [20260805-rstc-medical-questionnaire](../../architecture/decisions/20260805-rstc-medical-questionnaire.md).
- **DOM-L1 (Low). Narrowed 2026-08-06, not closed.** CMAS, RAID and GUE added to
  `certification_agency` via `ALTER TYPE … ADD VALUE`, which the destructive-migration guard shipped
  in the same branch correctly passes as additive; **BSAC** followed the same day on the
  `dive-domain-expert` review of that change — a national governing body with a full ISO-aligned
  ladder and, on UK visitor traffic, the most common non-listed card on a Florida or Caribbean boat.
  A diver holding one of those four can now be recorded honestly rather than as `other`.
  **What is still open, and why this is not a closure.** There is **no free-text companion to
  `other` anywhere in the schema**, so a diver holding an IANTD, SEI, ANDI, ACUC, PSAI or NASE card
  is still recorded as "Other agency" with nowhere to write which one — and the staffer who later
  has to look that number up has no idea whose portal to open. Each widening narrows the problem for
  the next shop; the companion field is what would close it. The three ladders the level enum cannot
  express (CMAS stars, RAID's 35 m Advanced, GUE's Fundamentals/Rec/Tech progression) are now
  written down in [glossary.md](../glossary.md) and on the cert form's own level picker rather than
  left as tribal knowledge.
  **Two things the first widening got wrong, both fixed in the review's own change.** The importer's
  agency matcher was a **substring** test, so with `gue` in the list an "Agency" column holding a
  booking source ("Guest", "Direct Guest") or a European federation name ("Ligue Francophone", a
  *CMAS* body) resolved to a GUE card — silently, because `agency_unrecognized` is only raised when
  nothing matched. It now matches whole tokens (`src/lib/import.ts`), with the adversarial cells as
  tests. And the same branch added the new agencies to `AGENCY_FULL_NAME_KEYS` in
  `CourseSections.tsx`, which is keyed on the **free-text `courses.agency`**, not on the enum — so
  the product renders a polished full-name expansion on the **public course hero** for a RAID or GUE
  course, presenting a competence it does not have, while every non-intro entry-level session under
  those agencies carries **no in-water ratio cap at all** (`src/lib/course-ratios.ts:167`, PADI-only
  by deliberate choice). That map was left at its current eight and its docblock now says it is not
  a mirror of the enum; BSAC was deliberately **not** added to it. The PADI-only ratio scope is
  itself unchanged and still recorded — widening the enum widens who that applies to without
  changing the rule.
  The companion field is a buildable bullet in [roadmap.md](../features/roadmap.md#smaller-follow-ons-live-with-their-adrs); DOM-M7, DOM-L2 and DOM-L4 shipped 2026-08-06.

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
  gate: the ADR is still **Proposed** pending H-02 (retention) and [human-decisions.md](../human-decisions.md) H-36 (who files Stripe's own deletion request).
- **DATA-H1 (recorded residues).** The invoice-snapshot obligation has **no API behind it and is
  never auto-retried** — it closes only when an owner attests they filed Stripe's data-deletion
  request, so an erasure with an undischarged obligation is genuinely incomplete and any promise
  made to a diver must say so. And the `course_inquiries` gap is *narrower, not closed*: a lead
  written with no email, or with an address no diver of the shop held at the time, and matching
  neither email nor phone at erasure, is still unreachable. Closing that needs a human saying "this
  lead is that diver", not fuzzier matching.
- **DATA-L4–L6 (Low). Closed 2026-08-06.** `scripts/check-migrations.mjs` reads every migration
  newer than the previous release and refuses fourteen destructive statement shapes, while proving
  in tests that `ALTER TYPE … ADD VALUE`, `CREATE INDEX` and `ADD COLUMN` still pass — a guard that
  refuses the common safe case teaches everyone to wave it through. It runs in `pnpm check:repo`
  and again in `scripts/vercel-build.mjs` immediately before `pnpm db:migrate`, and its escape
  hatch is a marker in the migration SQL itself rather than an env var a rushed deploy can flip
  (ADR [20260806-destructive-migration-guard](../../architecture/decisions/20260806-destructive-migration-guard.md)).
  It paid for itself on its first run by refusing this same branch's gallery-photos migration,
  which dropped `courses.image_urls`/`image_alts` in the release that added their replacement while
  the still-serving deployment selected both; that migration shipped expand-only and dual-writing,
  and `20260806105408_drop-course-legacy-gallery` is the contract release that drops the pair
  behind an acknowledged marker (DATA-L4). The parallel arrays are one `gallery_photos` object per photo, with a backfill that
  decides what an already-drifted row becomes rather than leaving it to whichever array was
  shorter. Three genuinely uncovered ILIKE arms gained trigram indexes — `courses.title`,
  `dive_sites.location_name`, `orders.description`; the orders arm the finding named turned out to
  be already covered by `people_full_name_trgm_idx`, which is the honest answer rather than a
  fourth index (DATA-L6). **DATA-L1 remains**: PGlite can't exhibit the prod races (lock ordering
  consistent but unenforced).
  (`default('usd')` on money columns — DATA-L3 — is gone, and **DATA-A10 closed 2026-08-06**: the
  bundle gained seven files, and the two families that stayed out — `day_closeouts` and
  `processor_erasure_obligations` — now say why in the bundle README and on the export page rather
  than only in a test comment.)

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
- **TEST-2 (High). Closed 2026-08-06.** A real-Postgres CI job now exercises both the migration-apply
  path and the `FOR UPDATE` oversell guard under genuine contention. See
  [20260806-real-postgres-ci-job](../../architecture/decisions/20260806-real-postgres-ci-job.md); its
  cadence is [human-decisions.md](../human-decisions.md) H-38.
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
  is still excluded — see [human-decisions.md](../human-decisions.md) H-37.)

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
  Blocked only on H-37 in [human-decisions.md](../human-decisions.md).
- **I18N-4 (Medium). Closed 2026-08-04.** `pnpm check:tokens` now fails raw hex and palette-scale
  classes, ratcheted in `scripts/tokens-baseline.json` — ADR-0004 is enforced, not just reviewed.
- **I18N-L1..L3 (Low). Closed 2026-08-06.** The negotiation now answers a third question about the
  same header — `unsupportedLanguage()` reports the highest-quality `Accept-Language` tag no bundle
  exists for, distinct from both "what do I render" and "what may I remember" — and the public shop
  shell renders one slim band naming the requested language by its own endonym, so the single token
  a non-English reader recognises sits inside a sentence they cannot otherwise read. No switcher
  and no `[locale]` route: the finding was silence, not absence of choice, and the notice's test
  asserts it contains no interactive element so it cannot quietly grow into one (I18N-L1). The
  public booking hero — the one screen where a diver commits — now names its zone, closing the only
  step of the flow whose neighbours already did; the schedule states it once at the top rather than
  stamping a zone onto twenty rows, thirty calendar cells and every card's aria-label, which would
  make the page worse for a screen-reader user (I18N-L2). The a11y scan went from sixteen tests to
  twenty-one and gained eleven scans, picked by consequence: three more bearer-token diver
  surfaces, the close-out and blow-out in their post-write renders, the incident export, backup
  settings, a full course page, and the schedule as an unsupported-language visitor sees it
  (I18N-L3). `color-contrast` stays disabled and untouched — I18N-1/HD-17 own it, and re-enabling
  it here would only hold CI red over debt a human deliberately deferred.

## 9. Marketing & conversion

**Strengths.** Disciplined demo-first funnel with closed `FunnelTag` attribution; pricing-card
hierarchy right; the zero-social-proof problem handled by argument-from-checkable-proof instead of
pretense; onboard preserves fields on bounce and signs the owner straight in; SEO substrate nearly
complete.

**Findings.**
- **MKT-F5 (High). Closed 2026-08-07.** "most shops review… and import in one sitting" and "here's
  how shops actually make the switch" had fabricated an install base — a claims-policy brush with
  zero customers. `migration-guides.ts`'s CUTOVER_SECTION now reads as advice and shipped importer
  behavior only (`src/i18n/locales/en-US/diver.json`'s `marketing.guides.shared.cutover.*`); no
  install-base language remains in any locale.
- **MKT-F10 (High).** `marketing.features.diveDay.item5` (`src/i18n/locales/*/diver.json`, resolved
  through `src/lib/marketing.ts`'s key registry) still publishes "Save the manifest to a phone and
  roll call keeps working with no signal" while [rollout.md](../rollout.md) line 102 states "Until
  V-02 passes, no marketing claim about offline roll call". Either the embargo is stale or the claim
  shipped early; the repo currently contradicts itself in public — and the 2026-08-03 crew work
  widened the gap, since a checkpoint now also needs a per-person crew result and crew roll call is
  online-only. → tracked under V-02 in [human-decisions.md](../human-decisions.md).

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
  → [human-decisions.md](../human-decisions.md) H-04 (external monitor) and H-41 (second human).
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

- **OPS-L1 (Low). Documented 2026-08-06.** The residual is real and now written down where the
  reasoning lives: `redactCapabilityUrl` runs in-process, in three `beforeSend` hooks, while Vercel
  records the request line before any DiveDay code is entered — so nothing that can be written in
  this repository changes what those logs contain.
  [capability-telemetry-runbook.md](../../engineering/capability-telemetry-runbook.md) states the
  exposure, the compensating controls with their exact limits rather than their headlines, an audit
  procedure that treats the result as a credential list, and why the cookie-exchange, fragment and
  POST alternatives have not been taken — each breaks re-tapping a link, arriving via Stripe's
  return redirect, or the static shell, and with it the paste-into-an-SMS property the capability
  model exists for. Two findings came out of writing it: `/unsubscribe/[token]` was a tenth
  capability URL `CAPABILITY_ROUTE_PREFIXES` had never covered (now fixed, and the list is asserted
  against the `[token]` directories on disk so the next one fails on the commit that creates it),
  and a *completed* waiver link still mints a readiness capability, so "already signed" is not
  "already spent". What remains is not engineering's: who may hold a Vercel seat with log access,
  and whether a log drain may ever be configured.
- **OPS-L2, L3 (Low).** VRT bucket world-readable (fine pre-launch, revisit); Sentry errors-only.

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

**Reconciliation, 2026-08-07 (fifth pass) — dissolved and archived.** No new engineering shipped
against this review since the fourth pass; what the fifth pass found instead was that the holding
pattern the fourth pass assembled had already emptied out the same day it was written; `shipped.md`
gained two more sections dated 2026-08-06 that this document never cross-checked against. Verifying
every remaining claim line-by-line against the working tree closed ten of the twelve "what to build"
items, the engineering halves of three "who can close it" rows, MKT-F5, ARCH-2, I18N-4, and ARCH-6 —
each corrected in place above rather than silently deleted, so the gap between what this document
said and what the code did stays visible rather than vanishing into an edit. What survived — two
human-external Criticals, one live claims-policy violation gated on V-02, the full human-decision
register, and two genuinely still-open small items — is dissolved into
[human-decisions.md](../human-decisions.md) (H-31 through H-44) and
[roadmap.md](../features/roadmap.md#smaller-follow-ons-live-with-their-adrs) (DOM-L1's companion
field). This document is archived rather than reconciled again: everything it could still say has a
more current home now.
