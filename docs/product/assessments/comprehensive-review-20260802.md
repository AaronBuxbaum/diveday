# Comprehensive review — 2026-08-02

> A whole-app review — concept, product, and codebase — run 2026-08-02 through ten independent
> lenses, each investigated by a separate reviewer against the code as it stands (commit
> `be15104`): product strategy, architecture, security, dive-domain safety, data model, payments,
> testing, i18n/UX/accessibility, marketing conversion, and operations. An assessment, not a
> commitment: items that survive owner review move to [roadmap.md](../features/roadmap.md) or
> [human-decisions.md](../human-decisions.md).
>
> **Reconciled 2026-08-03** against what shipped (merge `b514066`, PR #319): all fourteen rows of
> the original "findings that matter most", plus OPS-5, DATA-L2, and defects the two required
> reviews found *in that new work*. Per [docs/README.md](../../README.md)'s assessment rule,
> delivered recommendations are **deleted here, not annotated as done** — the delivery is in
> [shipped.md](../shipped.md#the-2026-08-02-comprehensive-review-fourteen-top-findings-delivered-2026-08-02).
> What follows is only what is still open, re-verified against the working tree; where a finding
> shipped *partly*, the residue survives and says which part.

## Verdict

The engineering is further ahead of the company than it was. Fourteen ranked findings — three
Criticals and eleven Highs — were built and merged inside a day, and two independent reviews found
and closed eight further defects in that new work before it landed. The safety spine now reads every
site a trip visits, the ledger records what Stripe actually settled, a diver can be erased, and
there is a backup posture, an incident runbook, and a health endpoint where there was none.

None of that moved the thing that is actually blocking. The launch critical path is still 100%
human-external, and it is now **day 10 of the 30-day list** in [rollout.md](../rollout.md) with
**four of its seven items showing no closed gate row**, and a fifth naming no gate row to close. The
product has still never had a recorded conversation with a dive shop. The gap has not narrowed — it
has been *measured* (`pnpm gates`), which is not the same thing.

The highest-priority **code** item is now **PAY-M1**: the Stripe webhook claims an event before
handling it, in no transaction, with no release on failure, so a handler crash permanently loses
`invoice.paid`/`invoice.voided`. It was already a P0 in the original ordering and is the one P0 that
was not built.

## Cross-cutting themes

Five patterns still recur; they matter more than any single finding. The original sixth — the safety
spine's three gaps — largely closed, and its remainder is folded into theme 5.

1. **The critical path is not code, and shipping code is what the repo does when it is blocked.**
   The review said this; the response to the review was 144 files of engineering. The dive lens's
   remaining dependencies (H-01–H-03, H-08's Rescue figure, V-02), the contrast fixes (HD-17), the
   erasure ADR's counsel gate (HD-10/HD-11), and the incident runbook's `alerts@dive.day` TODO all
   terminate in the same place: work only the owner can do. `pnpm gates` now prints the age of every
   one of those rows on demand — the instrumentation arrived, the movement did not.
2. **What has a ratchet holds; what has only prose drifts** — still true, with one fewer exception.
   Visual regression now posts a per-PR report and a neutral check (owner's choice: *warn loudly,
   never block* —
   [20260802-visual-diff-pr-comment](../../architecture/decisions/20260802-visual-diff-pr-comment.md)),
   so "account for every pixel" has evidence attached even though it still cannot fail a merge.
   The rest is unchanged: ADR-0004 tokens have no check (I18N-4), the lib↔db contract is unchecked
   and already violated (ARCH-1), `check-architecture.mjs` has a side-effect-import blind spot
   (ARCH-2), the `DiverIntlProvider` footgun is tribal knowledge (I18N-2), "revisit at GA" triggers
   live only in ADR text (ARCH-4). An invariant that isn't executable is a suggestion.
3. **Claims outrun the gates that authorize them** — the theme the original review only half-saw.
   `migration-guides.ts` still tells buyers how "shops actually make the switch" and what "most
   shops" do, with zero customers (MKT-F5); and `marketing.ts:43` publishes the offline-roll-call
   claim that [rollout.md](../rollout.md) line 102 embargoes until V-02 passes (MKT-F10, found
   during the 2026-08-02 work, absent from the original review). Two live violations of the claims
   policy, one against the repo's own written embargo, are the sharpest form of theme 1: a promise
   made on the strength of a field test that has not happened.
4. **PGlite hides what production will do** — unchanged, and now the largest untouched class. The
   `FOR UPDATE` oversell guard is still dead code under test (TEST-2, DATA-L1); LISTEN/NOTIFY
   ceilings are still prod-only (OPS-8). OPS-2's *documentation* half shipped, but no CI job applies
   `drizzle/` to a real server, so production is still the first one they meet. One real-Postgres CI
   job retires most of this class and is the highest-value enablement item left.
5. **What remains is what a real boat day and a real reconciliation would find.** The ledger now
   records Stripe's settled amount, post-discount and gear-inclusive, so the large money divergence
   is closed; left are tips missing from Reports (PAY-M2) and one recorded over-refund residual
   (PAY-M3). The multi-site gate, the DSD ratio, and the unfinished-roll-call alarm are closed, and
   crew enter the head count through a per-checkpoint attestation — but *per-person* crew roll call
   is still a design item waiting on `trip_assignments` gaining a per-trip role (DOM-M3). V-02 and a
   first Stripe reconciliation would surface both immediately, reinforcing theme 1 again.

## The findings that matter most

| # | ID | Sev | Finding | Where |
| --- | --- | --- | --- | --- |
| 1 | PAY-M1 | **High** (re-graded from the payments lens's Medium — it is now the only way this product silently loses a shop's money event, and every larger money defect around it shipped) | The Stripe webhook claims an event id before handling it, outside any transaction and with no release on failure; a handler crash permanently loses the event because redelivery reads as a duplicate. `invoice.paid`/`invoice.voided` have no self-heal — a shop's order silently never goes paid. Already a P0 in the original ordering; the one P0 not built | `src/app/api/webhooks/stripe/route.ts:119` |
| 2 | PROD-C1 | Critical | Launch critical path unmoved and now measured: **day 10 of rollout.md's 30-day list, 4 of its 7 items with no closed gate row** (attorney H-01–H-03, Resend sender + H-09 consent, V-01/V-02/V-04, the design-partner one-pager), a 5th (DEMA) naming no gate row at all. 16 open gate rows; the oldest — H-03, H-09, H-12, H-18 — have not moved in 10 days. `pnpm gates` reports this on demand; nothing it reports is an agent's to close | `pnpm gates`, [rollout.md](../rollout.md), [human-decisions.md](../human-decisions.md) |
| 3 | PROD-C2 | Critical | Zero recorded customer contact, ever. Personas are synthetic; the 165-task persona review was AI evaluating AI against AI. Untouched by any engineering to date, and untouchable by any | — |
| 4 | MKT-F5 / MKT-F10 | High | Two live claims-policy violations. `migration-guides.ts` still says "here's how shops actually make the switch" and "most shops review, fix a handful of rows, and import for real in one sitting" — fabricated usage proof with zero customers. And the offline roll-call claim is **published today** against rollout.md's own written embargo ("Until V-02 passes, no marketing claim about offline roll call") | `src/lib/migration-guides.ts:183,203`; `src/lib/marketing.ts:43` vs `rollout.md:102` |
| 5 | DATA-H1 (residue) | High | The erasure mechanism shipped, but its ADR is deliberately **Proposed, not Accepted** — HD-10/HD-11 (counsel on erasure vs signed evidence, and retention windows) decide when it may point at a real diver. Three residuals stay open behind it: `orders.stripe_customer_id` is a `NOT NULL` pointer erasure cannot rewrite, so processor-side erasure is a separate manual step; a `course_inquiries` row matching neither the erased diver's email nor phone is unreachable by the sweep, because no person link exists | [20260802-diver-data-erasure](../../architecture/decisions/20260802-diver-data-erasure.md), `src/db/anonymize.ts:820-836` |
| 6 | I18N-1 (residue) | High | **The WCAG-AA claim is still not true, and the scan is still blind to it.** Only the focus ring shipped (2.21:1 → 4.66:1 light, and it turned out `boat-mode` and `glare-mode` light were failing too — the roadmap had assumed they passed). The two token darkenings — tinted status-banner text (4.38/4.39:1) and placeholders (3.35:1) — remain deferred pending the colour-guide decision, and `e2e/a11y.spec.ts` still runs `.disableRules(["color-contrast"])` | `e2e/a11y.spec.ts:38-41`, [roadmap §contrast](../features/roadmap.md#accessibility-contrast-fixes-blocked-on-a-color-guide-decision) |
| 7 | TEST-2 / OPS-2 (residue) | High | No real Postgres anywhere in CI. The `FOR UPDATE` oversell guard cannot execute under PGlite, so the repo's most safety-critical concurrency control is untested; and `drizzle/` migrations still first meet a real server during the production deploy, even though the expand/contract rule and rollback procedure are now written down | `src/db/bookings.ts`, `.github/workflows/ci.yml`, `scripts/vercel-build.mjs` |
| 8 | DOM-H1 (residue) / DOM-M3 | Medium-High | Crew enter the after-dive head count only as a per-checkpoint aggregate attestation ("crew aboard: N of N"), which blocks the checkpoint reading complete but names nobody. Per-person crew roll call is still a design item, and still blocked on `trip_assignments` carrying a per-trip role — a DM assigned as boat captain still counts as an in-water certified assistant | `src/db/manifests.ts`, `src/db/schema.ts` (`trip_assignments`) |
| 9 | PAY-M3 (new) | Medium | Recorded in code as a KNOWN RESIDUAL by the security review of the settlement work: when Stripe reports no `amount_total`, a **party** checkout on a **discounted** session falls back to per-diver quoted (pre-discount) amounts, so the recorded shares sum above what the intent captured. The first member to cancel can be over-refunded out of the shared pot and a later one left under-funded | `src/db/checkouts.ts:519-533` |
| 10 | DATA-M1/M2 | Medium | Still no supporting indexes for the two hot cross-shop scans: `claimBookingsForCheckout`'s stale-intent scan (runs on every checkout click) and the cron's `trips.starts_at`/`ends_at` windows. Only `(shop_id, status)` and `(shop_id, starts_at)` exist | `src/db/schema.ts:758-761,1839` |

Sections below hold the full per-lens findings, including everything Medium and Low.

## Consolidated action queue

Prompt-ready; ordered. P0 = before any real shop touches the product. Each task cites its lens
finding; safety-marked tasks need `dive-domain-expert` review, security-marked need
`security-reviewer`, per AGENTS.md hard rules.

### P0 — before a real shop touches it

1. **(PAY-M1)** Make the Stripe webhook claim atomic with handling in
   `src/app/api/webhooks/stripe/route.ts` (claim + handler in one transaction, or release the claim
   on handler exception) so redelivery can repair a crashed handler. Test: handler failure, then
   redelivery, asserting the state machine advances the second time.
2. **(MKT-F5/F10)** Resolve both live claims conflicts. Rewrite `CUTOVER_SECTION` in
   `src/lib/migration-guides.ts` to drop "how shops actually make the switch" / "most shops…" —
   advice and shipped importer behavior only. And put the offline roll-call claim to the owner:
   either pull `src/lib/marketing.ts:43` back to something V-02 does not gate, or record a decision
   lifting the `rollout.md:102` embargo. Leaving the repo contradicting itself in public is the one
   option that is not available (HD-25).
3. **(OPS-4 residue, owner)** Create `alerts@dive.day` as a real mailbox and point everything that
   currently aims at it there — Sentry issue alerts, the Sentry Cron Monitor's missed check-in, the
   CDK stack's `alertEmail` context, and the app's own notifications — then stand up the external
   uptime monitor on `/api/health` and the public schedule that
   [incident-response-runbook.md](../../engineering/incident-response-runbook.md) specifies. The
   runbook, the probe, and the cron check-in all shipped; every alert path still ends nowhere.

### P1 — before/with the first pilot

4. **(TEST-2/DATA-L1/OPS-2)** Add a real-Postgres CI job (service container): apply `drizzle/`
   migrations from empty and from the previous release's schema, and run the booking/payments/
   payment-operations suites with genuinely concurrent connections — two transactions racing for
   the last seat, asserting exactly one wins. Nightly or gated on `src/db/**` (HD-19). Also carried
   in [roadmap.md's engineering-enablement backlog](../features/roadmap.md#p1--next).
5. **(PAY-M3)** Stop recording an unsettled party checkout at quoted amounts: prorate against
   `totalCents`, or refuse to attribute per-booking amounts at all until a settled total exists.
   Regression test: party of two on a discounted session, no `amount_total`, both cancel.
6. **(PAY-M2)** Bring tips into Reports — the last remaining Stripe-vs-Reports divergence now that
   promo overstatement and gear revenue are settled.
7. **(I18N-1 residue)** Once the colour-guide decision (HD-17) lands: implement the two remaining
   contrast fixes as written in the roadmap, re-enable `color-contrast` in `e2e/a11y.spec.ts`,
   triage the visual diffs. Until then nothing in the repo may claim WCAG AA conformance.
8. **(DATA-H1 residue, security)** Once HD-10/HD-11 land, move
   [20260802-diver-data-erasure](../../architecture/decisions/20260802-diver-data-erasure.md) from
   Proposed to Accepted, and close its two recorded residuals: document (or automate) the
   processor-side Stripe-customer deletion step, and give `course_inquiries` a person link so a row
   matching neither email nor phone is still reachable by the sweep.
9. **(DOM-H1/DOM-M3, safety)** Add a per-trip role to `trip_assignments`, then design per-person
   crew roll call on top of it. The aggregate attestation is the interim; a DM assigned as boat
   captain still counts as an in-water certified assistant until this lands. Pair with HD-7.
10. **(SEC-D1/OPS-7)** Provision Upstash so sign-in/password-reset rate limits are global; add log +
    Sentry capture inside `checkRateLimit`'s fail-open catch (`src/lib/rate-limit.ts:242`, currently
    a bare `catch { allowed: true }`); fix the runbook's stale 30/hour figures (code says 60).
11. **(DATA-M1/M2)** Add the missing hot-path indexes: partial
    `payment_operation_intents(started_at) WHERE status='started'` and plain `trips.starts_at` /
    `trips.ends_at` for the cross-shop cron scans.
12. **(DOM-M4)** Amend H-11/V-05 wording to state DiveDay gates the fill *request* and holds no fill
    log (or build the minimal fill-analysis log if HD-8 chooses that).
13. **(DOM-M6, safety)** Check a trip's own certification/specialty requirement at booking, not only
    at boarding — a diver can currently pay in full for a charter they cannot qualify for. (The
    *course* gate does run at booking; the trip-site gate does not.)
14. **(MKT-F3)** Mid-page CTA on `/product` after the "At the dock" section — it still carries one
    CTA at the bottom of ten sections.
15. **(TEST-3, watch)** The offline storage-eviction e2e flake is **not proven fixed.** The
    investigation found and removed a real product bug — the offline shell asserted "nothing saved
    on this phone" before it had opened the store, and the service worker replayed one cached
    document for every offline reload so the page only became correct through React's
    hydration-error recovery — and that timing dependence is a plausible cause. It was never
    reproduced, so treat a recurrence as unexplained rather than as a new flake.

### P2 — hardening and hygiene

16. **(ARCH-2, ARCH-4, I18N-2, I18N-4 — theme 2)** Make the remaining prose invariants executable.
    Carried to
    [roadmap.md's engineering-enablement backlog](../features/roadmap.md#p2--when-parallelism-or-scale-proves-the-need),
    which holds the four tasks; do not plan them from here.
17. **(ARCH-3)** Extract `SettingsPage.tsx`'s inline server actions to a sibling `actions.ts` (the
    repo's own convention). Split `src/db/trips.ts` along its series/crew/schedule seams; decompose
    `src/db/seed.ts` (4,504 lines, top conflict magnet) into scenario modules; split
    `src/lib/notifications/index.ts`.
18. **(ARCH-5)** Retype `createBookingRecord`/`revokeBookingCapabilities` + `src/db/tips.ts` to
    accept the existing `DbExecutor`, deleting the `tx as unknown as AppDb` casts.
19. **(I18N-3/I18N-5)** es-ES terminology sweep (pick "centro" over "tienda"; drop Spain-isms);
    decide the token-page `error.tsx` language tradeoff (six routes hard-code English for exactly
    the diver the English-only waiver notice worries about).
20. **(PAY-L1/L2)** Handle `checkout.session.async_payment_failed` (permanent pending-desync today);
    retention/pruning for `stripe_webhook_events` and the other unbounded append-only tables
    (DATA-M4) per the retention half of HD-11.
21. **(DATA-M3)** Append-only `booking_payment_events` trail alongside `booking_payments` mutations
    (currently one mutable row; history reconstruction depends on Stripe) — or a recorded decision
    to accept Stripe as sole ledger (HD-14).
22. **(DATA-L3)** Drop `default('usd')` from money-table currency columns; all writers now pass
    currency explicitly.
23. **(TEST-4/5/6)** Extend a11y scans to the unscanned staff surfaces + one keyboard-only booking
    traversal; split `visual.spec.ts`'s mega-tests per surface; one e2e booking flow under
    `Accept-Language: es`.
24. **(DOM-M5)** Retitle the medical questionnaire "RSTC-style" pending H-01; make
    `questionnaireForJurisdiction` honor `uk` or remove the dead seam (it returns the RSTC form for
    both arguments today, while the glossary promises a UK variant); add `cmas`/`raid`/`gue` to the
    agency enum or document the "other" policy.
25. **(DOM-M2 residue)** Decide whether the cited PADI 8/+2/12 entry-level figure should apply to a
    non-PADI Open Water course. The intro/DSD cap is now agency-agnostic and the glossary documents
    the carve-out, so this is a recorded, deliberate scope rather than a drift — but an SSI Open
    Water session with twenty students is still capped only by the boat.
26. **(DOM-L2)** Marine forecast unit preference (Florida crews read feet).
27. **(DOM-L4)** `canRecordOfflineStatus` still reads `manifests[0]` regardless of checkpoint
    (`src/lib/offline-manifests.ts:286`) — a latent trap once a snapshot carries more than one.
28. **(SEC-D3)** Call the offline-manifest purge on offline-shell load, not only from
    `OfflineManifestAutoSave` (the online path), to shorten cross-tenant residency on shared
    devices (HD-24).
29. **(OPS-6)** Retry cadence is daily, not the 30s–1h the backoff math implies (one Vercel cron
    entry, `0 14 * * *`); a failed waiver email waits ~24h for retry #1.
30. **(OPS-9)** Cost guardrails cover the smallest bill (AWS); Vercel/Neon/Resend (hard 1,000/month
    free cap, unmetered) have none (HD-23).
31. **(ARCH-7)** Burn down `instant = false` (51 of 56 pages carry the identical TODO) in measured
    tranches.
32. **(ARCH-8)** Auth-path hygiene: the missing-account short-circuit skips the bcrypt compare
    (timing side-channel for enumeration); `DEMO_BYPASS_PASSWORD` lives in the production verify
    function gated only by `isDemo`; bcrypt cost 10 is a magic number at three sites.
33. **(DATA-A10)** The CSV export gained crew attestations and the erased-diver markers; it still
    omits `internal_notes`, `activity_events`, `course_inquiries`, and checkout/redemption/
    notification history with no recorded portability decision. Extend it or write the exclusions
    down.
34. **(MKT-F4/F6/F7-F9)** Homepage primary CTA still says "Try the staff app" (jargon, inconsistent
    with every other page); `/switching/spreadsheet` still has no OG block and no page sets Twitter
    cards; `/about`'s hero still fails the rulebook's own paste-test; the homepage hero's decision
    density (~9 controls); pricing never anchors against the per-booking fees the switching guides
    document (HD-25).

## Human decision register

Grouped; each blocks the listed action items. The register in
[human-decisions.md](../human-decisions.md) is the durable home for whichever of these the owner
accepts. HD numbers are stable and are never reused: HD-3, HD-4, HD-9, HD-12, HD-13 and HD-18 have
been answered and are **removed** rather than renumbered, and HD-6 survives only as the one half of
its ask that is still outstanding. See H-25, H-26, the H-08 and H-06 amendments, and
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
  stronger, not weaker: the response to a review that said "stop building" was 144 files.

**Safety and domain (need professional/legal input):**
- **HD-6 (residual).** The DSD figure is settled (H-08, 2026-08-02). Still outstanding from the same
  ask: the **Rescue Diver scenario-supervision figure**, which nothing currently enforces.
- **HD-7 (open).** Crew-in-roll-call: does the launch jurisdiction require the head count to cover
  crew *per person*, or does the shipped per-checkpoint attestation satisfy it? → P1-9.
- **HD-8 (H-11 amendment).** Is DiveDay the nitrox fill log of record or explicitly not? The current
  H-11 wording overstates the product. → P1-12.
- **HD-10 (H-17 revisit, with counsel).** Imported waiver acceptance currently trusts a prior shop's
  medical clearance sight-unseen; present to the H-01 attorney as a package with the H-20/H-23
  verified-on-import choices. Also gates P1-8.

**Data, money, and legal posture:**
- **HD-11.** Erasure vs signed evidence: the mechanism is built and its ADR sits at **Proposed** on
  purpose. Anonymize-and-keep (what shipped), hard-delete after a liability window, or refuse —
  and the retention windows for webhook/notification/token trails. Blocks P1-8 and P2-20.
- **HD-14.** Payment history ledger: invest in the local append-only trail now, or accept Stripe as
  sole historical ledger until the first dispute — P2-21.
- **HD-15.** Abandoned checkout = seats held forever: confirm book-now-pay-later, or define an
  auto-release window.
- **HD-16.** Platform economics: confirm monetization stays subscription-only (no `application_fee`
  mechanics exist; retrofitting touches every provider seam).

**Process and platform:**
- **HD-17.** The colour-guide decision blocking the two remaining WCAG contrast fixes — still the
  highest-leverage two-day decision in the register, and the reason the repo cannot claim WCAG AA.
  → P1-7.
- **HD-19.** Real-Postgres CI spend: nightly, per-PR on `src/db/**`, or not at all. → P1-4.
- **HD-20.** GA migration budget for the pre-release stack (Next preview, next-auth beta, drizzle
  rc, TS 7): one scheduled hardening sprint or opportunistic — and is pre-release-major the default
  posture for a SaaS taking real payments? → P2-16.
- **HD-21.** The lib/db layer contract: bless the status quo (one layer, pure/IO naming) and fix
  overview.md's "framework-free" claim, or enforce lib→db type-only imports. Either; the ambiguity
  is the only bad option.
- **HD-22.** Feature modules: name the second adopter (reviews; trips series/crew) or shelve the
  pattern.
- **HD-23.** Who is the second human? Every alert path terminates at one person — and as of today
  terminates at a mailbox that does not exist (P0-3). Name a backup or record solo-operator risk as
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
[shipped.md](../shipped.md#the-2026-08-02-comprehensive-review-fourteen-top-findings-delivered-2026-08-02).

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
- **ARCH-3 (Medium).** Complexity concentrated in the files every feature touches: `src/db/seed.ts`
  4,504 lines (top conflict magnet); `src/db/trips.ts` 1,790 lines; `src/lib/notifications/index.ts`
  1,026 lines; `SettingsPage.tsx` with its inline `"use server"` closures against the repo's own
  convention.
- **ARCH-4 (Medium).** The entire critical path (framework, auth, ORM, compiler) is pre-GA
  simultaneously (Next 16.3 preview, next-auth 5 beta, drizzle 1.0-rc, TS 7); ADR-justified, but the
  "move promptly at GA" triggers exist only as prose. reg-suit 0.14.x is a low-activity-upstream risk
  (acknowledged).
- **ARCH-5 (Low).** `tx as unknown as AppDb` casts inside the money/capacity transactions;
  `DbExecutor` already exists and sibling functions use it.
- **ARCH-6 (Low).** Feature-module pattern has one adopter and every post-ADR feature went flat; one
  more all-flat month and it's decorative.
- **ARCH-7 (Low).** 51 of 56 pages carry the identical `instant = false` Cache-Components TODO — up
  from 46, because new pages inherit it.
- **ARCH-8 (Low).** Auth-path notes: missing-account short-circuit skips the bcrypt compare (timing
  side-channel for enumeration); `DEMO_BYPASS_PASSWORD` lives in the production verify function gated
  only by `isDemo`; bcrypt cost 10 as a magic number at three sites.

## 3. Security & privacy

**Verdict: no exploitable tenant-isolation, authorization, token, or secret-handling defects
found**, on either the original sweep or the second `security-reviewer` pass over the 2026-08-02
erasure and settlement work. Every data path sampled re-derives the session and re-scopes to
`shopId` server-side, independent of the proxy. Confirmed-correct under adversarial reading: export
isolation; token flows (256-bit CSPRNG, hashed at rest, atomic consumption, HKDF rotation-safe HMAC
links, timing-safe compares, analytics redaction + no-referrer); H-14 live role re-reads;
server-side price/MOD/gear derivation; SSRF host-pinning; fail-closed test/cron routes. The second
pass raised six other issues, all fixed before merge; two of its residuals stay open above (DATA-H1
residue, PAY-M3).

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
- **DOM-H1 (residue, High).** Crew are counted, not named. The per-checkpoint "crew aboard: N of N"
  attestation blocks a checkpoint reading complete, and "0 of 0" deliberately still needs a human —
  but the after-dive head count still cannot say *which* crew member is unaccounted for. → P1-9.
- **DOM-M2 (residue, Medium).** The intro/DSD cap is agency-agnostic and the glossary documents the
  carve-out, so the SSI-Try-Scuba hole is closed. The cited PADI 8/+2/12 entry-level figure is still
  PADI-only by deliberate choice (`course-ratios.ts:167`), so a non-PADI Open Water session carries
  no ratio cap. Recorded, not drifted — but still a gap. → P2-25.
- **DOM-M3 (Medium).** A DM assigned as boat captain still counts as an in-water certified assistant
  (no per-trip role on `trip_assignments`) — known gap, load-bearing on a safety number *and* on
  DOM-H1's design.
- **DOM-M4 (Medium).** H-11/V-05 describe a nitrox fill log (mix %, MOD math, analysis-signature) the
  product doesn't hold; an owner reading H-11 will believe DiveDay is their fill log of record.
- **DOM-M5 (Medium).** The "RSTC" questionnaire is an 8-question paraphrase of the 10-box 2020 RSTC
  form (hard contraindications buried, behavioral-health and over-45 factors absent), and
  `questionnaireForJurisdiction` ignores its argument — `"uk"` returns the RSTC form, so the UK
  variant the glossary promises is dead code.
- **DOM-M6 (Medium).** A trip's own cert/specialty requirement is not checked at booking, only at
  readiness — a diver can pay in full for a charter they can't qualify for. (The *course* admission
  gate does run at booking.)
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
- **DATA-H1 (residue, High).** The erasure mechanism ships; its ADR is **Proposed** pending
  HD-10/HD-11, and two residuals stay open — `orders.stripe_customer_id` is a `NOT NULL` pointer
  into Stripe's own records that erasure cannot rewrite (processor-side erasure is a separate manual
  step), and a `course_inquiries` row matching neither the erased diver's email nor phone is
  unreachable by the sweep because no person link exists. → P1-8.
- **DATA-M1 (Medium).** `claimBookingsForCheckout`'s stale-intent scan is cross-shop and unindexed —
  a growing seq scan on every checkout click.
- **DATA-M2 (Medium).** Cross-shop cron scans on `trips.starts_at`/`ends_at` windows have no
  supporting index (only `(shop_id, starts_at)` and `(series_id, starts_at)` exist).
- **DATA-M3 (Medium).** `booking_payments` is one mutable row; refunds overwrite in place; no local
  money history.
- **DATA-M4 (Medium).** No retention policy on any append-only table (webhook events, notification
  attempts, activity events, expired tokens).
- **DATA-L1, L3–L6 (Low).** PGlite can't exhibit the prod races (lock ordering consistent but
  unenforced); migrations run inside the Vercel build with no destructive-DDL guard; ILIKE arms
  without trgm indexes (orders/courses); `default('usd')` on money columns contradicts the
  explicit-currency rule; parallel-array jsonb on `courses.imageUrls/imageAlts`; the export gained
  crew attestations and erasure markers but still omits several tables without a recorded
  portability decision (DATA-A10).

## 6. Payments & money

**Strengths.** Layered webhook defense (correct hand-rolled signature verification, event-id claim
ledger, idempotent per-handler state machines, account cross-checks, out-of-order `account.updated`
protection); live/test-mode segregation enforced against the verifying secret;
intents-before-Stripe-calls with deterministic idempotency keys; seats-before-money so Stripe
failure degrades to pay-later; payment truth only from Stripe; percent-only promos that can't go
negative.

**Findings.**
- **PAY-M1 (Medium as this lens graded it; re-graded High on reconciliation — top priority).**
  Webhook event claimed before handling, in no
  transaction and with no release on failure; a handler crash permanently loses the event
  (redelivery reads as duplicate); `invoice.paid`/`invoice.voided` have no self-heal. → P0-1.
- **PAY-M2 (Medium).** Reports still won't fully reconcile with Stripe: tips are absent entirely.
  (Promo overstatement and missing gear revenue are closed.)
- **PAY-M3 (Medium, new).** The pre-discount fallback in `src/db/checkouts.ts:519-533`: with no
  `amount_total` from Stripe, a party checkout on a discounted session records quoted amounts that
  sum above what the intent captured, so the first canceller can be over-refunded out of the shared
  pot. Recorded in code as a KNOWN RESIDUAL rather than fixed. → P1-5.
- **PAY-L1..L4 (Low).** `async_payment_failed` unhandled (permanent pending desync); reused pending
  checkout doesn't re-verify current price/deposit policy; `refundOrder` relies on Stripe's
  over-refund rejection rather than a local lock; `stripe_webhook_events` unbounded.

## 7. Testing & quality engineering

**Strengths.** 200+ unit test files concentrated where risk lives; bookings tested like the
safety-critical code it is (adversarial cases credited to their finders); zero snapshots, zero
skips, restrained mocking; best-in-class e2e isolation (per-worker server + in-memory PGlite,
both-halves clock freeze, external HTTP blocked); `retries: 0` with root-caused flake history;
~2,000 lines of guardrail scripts with deliberately no prose-triggerable escape hatch.

**Findings.**
- **TEST-2 (High).** The `FOR UPDATE` oversell guard is dead code under test and no real Postgres
  runs anywhere in CI — the migration-apply path and the concurrency guard are both unexercised.
  → P1-4.
- **TEST-3 (Medium, new).** The offline storage-eviction e2e flake is unproven. Its investigation
  removed a real product bug (the shell asserted an empty phone before reading the store; every
  offline reload completed only via React hydration-error recovery), which is a plausible cause —
  but the flake itself was never reproduced. A recurrence is unexplained, not new.
- **TEST-M1 (Medium).** `ci.yml` itself estimates residual 5–10% per-test flake risk on the contended
  set under `retries: 0`; red shards tax every PR.
- **TEST-M2 (Medium).** Stripe tested only to the seam (injected fetchers, seeded fakes); no contract
  fixtures pinned to an API version.
- **TEST-M3 (Medium).** App/component layer thin (pages covered mainly transitively via e2e).
- **TEST-L1..L4 (Low).** a11y covers five surfaces with `color-contrast` off; perf budget is one
  number and never runs locally; guardrail scripts are regex-level (cooperative, not boundaries);
  e2e pins literal English copy and no non-English path is e2e-rendered; visual mega-tests blind
  sibling captures on first failure.

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
  Blocked only on HD-17. → P1-7.
- **I18N-2 (Medium).** `DiverIntlProvider`'s two silent failure modes (blank page; raw-key render)
  are documented tribal knowledge with no static guard.
- **I18N-3 (Medium).** All six bearer-token `error.tsx` boundaries are hard-coded English — for
  exactly the diver the waiver notice worries about; deferred in comments, tracked nowhere.
- **I18N-4 (Medium).** ADR-0004 has no automated enforcement (currently held by review alone;
  spot-check clean).
- **I18N-5 (Low-Med).** es-ES terminology drift ("tienda" vs "centro" for the same entity, sometimes
  on one page); Spain-isms for a mostly-LatAm audience.
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
  → P0-2.
- **MKT-F10 (High, new).** `src/lib/marketing.ts:43` publishes "Save the manifest to a phone and roll
  call keeps working with no signal" while [rollout.md](../rollout.md) line 102 states "Until V-02
  passes, no marketing claim about offline roll call". Either the embargo is stale or the claim
  shipped early; the repo currently contradicts itself in public. → P0-2, HD-25.
- **MKT-F3 (Medium).** `/product` still has one CTA at the bottom of ten sections.
- **MKT-F4 (Medium).** Homepage primary CTA says "Try the staff app" — jargon, inconsistent with
  every other page.
- **MKT-F6 (Medium).** `/switching/spreadsheet` is missing its OG block, and no page sets Twitter
  cards.
- **MKT-F7..F9 (Low).** `/about` hero fails the rulebook's own paste-test; homepage hero decision
  density (~9 controls); pricing never anchors against the per-booking fees documented in the
  switching guides.

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
  documentation shipped; the operational posture is still zero. → P0-3.
- **OPS-2 (residue, High).** The runbooks exist, but no CI job applies `drizzle/` migrations to a
  real Postgres — production is still the first real server they touch. Folded into TEST-2 / P1-4.
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

**Reconciliation, 2026-08-03.** Every claim of delivery was re-verified against the working tree
before its recommendation was deleted, and every surviving finding re-verified as still true at its
cited file:line. Three shipped *partly* and were rewritten to their residue (DOM-H1, DATA-H1,
I18N-1); one shipped in a form its original text no longer described (DOM-M2); three new findings
entered from the 2026-08-02 work itself (MKT-F10, PAY-M3, TEST-3). The tension the original Method
section left deliberately visible — `shop_promo_redemptions.amountChargedCents` documented as
deliberately pre-discount versus the promos-page label reading as misleading — is resolved:
recording Stripe's settled amount made the pre-discount reading obsolete everywhere except the
fallback branch now tracked as PAY-M3. Queue numbering was reallocated, so the P-numbers cited above
refer to **this** queue; HD numbers were not renumbered, so inbound references from
[human-decisions.md](../human-decisions.md) still resolve.
