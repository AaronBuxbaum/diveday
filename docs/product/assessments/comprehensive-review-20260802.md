# Comprehensive review — 2026-08-02

> A whole-app review — concept, product, and codebase — run 2026-08-02 through ten independent
> lenses, each investigated by a separate reviewer against the code as it stands (commit
> `be15104`): product strategy, architecture, security, dive-domain safety, data model, payments,
> testing, i18n/UX/accessibility, marketing conversion, and operations. An assessment, not a
> commitment: items that survive owner review move to [roadmap.md](../features/roadmap.md) or
> [human-decisions.md](../human-decisions.md). Prior reviews
> ([codebase-review-20260723](../archive/codebase-review-20260723.md), the
> [2026-07-31 specialist audit](../archive/specialist-optimization-audit-20260731.md)) are closed;
> nothing here re-reports their shipped findings — every finding below was verified against
> current code with file:line evidence.

## Verdict

The engineering is ahead of the company. Across ten lenses the code holds up remarkably well —
the security lens found **zero exploitable defects** in tenant isolation, authz, tokens, or
secrets; the concurrency, time, and money modeling drew "production-grade" from reviewers told to
be skeptical; test discipline (zero snapshots, zero skips, adversarial cases on safety paths) is
real. But the review surfaced two genuine Criticals in shipped behavior — a **safety gate that
ignores every dive site except the primary** (DOM-C1) and a **refund idempotency collision that
silently shorts a party's lead booker** (PAY-C1) — plus a business-level Critical: the launch
critical path is 100% human-external (attorney, entity, pilots, field test) and has recorded no
movement since [rollout.md](../rollout.md) was written on 2026-07-24, while engineering output
continued daily. The product has never had a recorded conversation with a dive shop.

## Cross-cutting themes

Six patterns recur across independent lenses; they matter more than any single finding.

1. **The critical path is not code.** The product lens's stall finding, ops's missing
   backup/incident/uptime posture, the dive lens's open H-01–H-03/H-08/V-02 dependencies, and
   i18n's contrast fixes blocked on a color decision all terminate at the same place: work only
   the owner can do. Every additional engineering week widens the gap
   ([rollout.md](../rollout.md): "Nothing that blocks rollout is code").
2. **What has a ratchet holds; what has only prose drifts.** Copy, clock, locale, and
   architecture gates are green and effective. Every drift found lives where enforcement is
   prose: visual diffs never block CI (TEST-1), ADR-0004 tokens have no check (I18N-4), the
   lib↔db layer contract is unchecked and already violated (ARCH-1), the DiverIntlProvider
   footgun is tribal knowledge (I18N-2), "revisit at GA" dependency triggers live only in ADR
   text (ARCH-4). In an agent-built repo, an invariant that isn't executable is a suggestion.
3. **Decision log and shipped code have started to disagree.** The rental set contradicts H-06
   and the glossary (DOM-M1); H-11's nitrox wording describes a fill log the product doesn't
   have (DOM-M4); the glossary's "checked at booking and boarding," jurisdiction-questionnaire,
   and ratio-scope claims don't match code (DOM-M2/M5/M6). The doc system is this repo's
   greatest asset precisely because agents trust it; each stale record is now actively
   misleading.
4. **PGlite hides what production will do.** The `FOR UPDATE` oversell guard is dead code under
   test (TEST-2, DATA-L1); prod migrations first touch real Postgres during the production
   deploy (OPS-2); LISTEN/NOTIFY connection ceilings are prod-only behavior (OPS-8). One
   real-Postgres CI job retires most of this class.
5. **The local money ledger diverges from Stripe reality.** Pre-discount amounts recorded as
   charged, refunded at list price (PAY-H1); gear cents invisible to refunds and Reports
   (PAY-H2); tips absent from Reports (PAY-M2). Individually small; together they guarantee the
   first shop that reconciles against its Stripe dashboard finds unexplained deltas — fatal for
   a trust-positioned product.
6. **The safety spine is right; three gaps are exactly what a field test and professional review
   would catch.** Fail-closed readiness, append-only roll call, and the nitrox request gate are
   genuinely good. The three High/Critical safety gaps (multi-site gating, crew outside roll
   call, the DSD ratio sourced from a blog) are the kind found by running a real boat day
   (V-02) and paying for an hour of a PADI pro's time (H-08) — reinforcing theme 1.

## The findings that matter most

| # | ID | Sev | Finding | Where |
| --- | --- | --- | --- | --- |
| 1 | DOM-C1 | Critical | Cert/specialty/nitrox gates read only the trip's primary site; the deep dive-2 site never reaches the gate (the depth *advisory* already spans all sites and its comment explains why the gate is wrong) | `src/db/readiness.ts:89-112` |
| 2 | PAY-C1 | Critical | Refund idempotency key `refund:{pi}:{amount}` collides when two same-amount refunds hit one payment intent (two party members cancel); Stripe replays the first refund, local rows say both were returned | `src/lib/payments/checkout.ts:235` |
| 3 | PROD-C1 | Critical | Launch critical path (attorney, entity, Stripe/Twilio applications, V-01–V-06) shows zero recorded movement since 2026-07-24 while engineering shipped daily; zero customer contact in the entire record | `rollout.md`, `human-decisions.md` |
| 4 | DOM-H2 | High | Enforced entry-level ratio (8:1→12:1 with DMs) applied to DSD/intro sessions is likely 2–3× PADI's actual 4:1 DSD standard; the gate *certifies* the overload as compliant; `is_intro_course` exists but is never read by the gate | `src/lib/course-ratios.ts:13-17` |
| 5 | DOM-H1 | High | Crew are never roll-call subjects — the after-dive head count excludes exactly the people most reliably in the water | `src/db/manifests.ts:260-275` |
| 6 | DOM-H3 | High | Nothing chases an unfinished after-dive roll call; a trip can return with every diver "awaiting" and no surface escalates | `src/db/today.ts:141-172` |
| 7 | OPS-1 | High | No backup/DR posture for legally significant data: no documented Neon PITR window, no scheduled export, no Blob backup, no restore test — while waiver retention is "indefinite" (H-02) | `human-decisions.md` H-02/H-04 |
| 8 | PAY-H1/H2 | High | Promo checkouts recorded/refunded/reported at pre-discount list price (shop loses money on every within-window promo cancellation); gear money invisible to refunds and Reports | `src/db/checkouts.ts:427-437`, `src/db/refunds.ts:76` |
| 9 | DATA-H1 | High | No erasure/anonymization path for medical data: `deleteDiver` is soft-delete only; `medicalAnswers`, DOB, emergency contacts persist forever | `src/db/divers.ts:161-165` |
| 10 | OPS-2/3/4 | High | Bad-migration blast radius unmitigated (no expand/contract rule, no real-Postgres rehearsal, no rollback doc); one silent daily cron drives eight jobs with no dead-man's switch (the Sentry cron monitor is configured via a webpack hook that is inert under Turbopack); no uptime check, health endpoint, or incident runbook — `alerts@dive.day` doesn't exist yet | `scripts/vercel-build.mjs`, `next.config.ts:110-116` |
| 11 | MKT-F2 | High | The onboard timezone select is a closed list of 16 zones missing Bonaire, Cayman, Belize, Roatán, Indonesia, Maldives, Fiji — a hard block at the last step of the funnel | `src/app/onboard/page.tsx:166-216` |
| 12 | TEST-1 | High | Visual regression never blocks CI — "account for every pixel," the strongest-worded hard rule in AGENTS.md, has the weakest enforcement in the pipeline | `e2e/visual.spec.ts:21` |
| 13 | I18N-1 | High | The WCAG-AA claim is currently false in light mode (focus ring ~2.3:1, placeholders 3.35:1) and the axe scan has `color-contrast` disabled; fixes are small and blocked only on the color-guide decision | `e2e/a11y.spec.ts:38-41`, roadmap §contrast |
| 14 | MKT-F1 | High | Switching guides — the highest-intent landers — have no actionable CTA until ~7 sections deep; the mid-page CTA renders `null` for signed-out buyers | `src/app/switching/[competitor]/page.tsx` |

Sections below hold the full per-lens findings, including everything Medium and Low.

## Consolidated action queue

Prompt-ready; ordered. P0 = before any real shop touches the product. Each task cites its lens
finding; safety-marked tasks need `dive-domain-expert` review, security-marked need
`security-reviewer`, per AGENTS.md hard rules.

### P0 — correctness of safety and money (this week)

1. **(DOM-C1, safety)** In `src/db/readiness.ts`, extend `getTripSiteRequirement` and the batch
   variant in `listTripsReadiness` to compose the stricter `minimumCertificationLevel`, the union
   of `requiredSpecialties`, and `requiresNitrox` across `trips.diveSiteId` **and** every
   `trip_dives.dive_site_id`, mirroring `getTripMaxDepthMeters`'s join. Regression tests: OW
   diver + shallow primary + AOW/Deep dive-2 site → blocked; nitrox-required dive-2 → nitrox
   blocker.
2. **(PAY-C1)** In `refundBookingOnCancellation` (`src/db/refunds.ts`), pass
   `idempotencyKeyFor(intent.id)` down to `refundCheckoutSession` and use it as the
   Idempotency-Key instead of `refund:${paymentIntentId}:${amountCents}`
   (`src/lib/payments/checkout.ts:209-247`), mirroring `refundInvoice`. Regression test: party of
   two, both cancel in-window, assert two distinct refund POSTs with distinct keys.
3. **(DOM-H2, safety)** Read `is_intro_course` in `src/lib/course-ratios.ts` /
   `src/db/bookings.ts`: gate intro/DSD sessions at 4:1 with no assistant bonus pending the
   Instructor Manual verification (HD-3 below); keep 8+2→12 for OW training sessions only.
   Normalize the `courses.agency` comparison (lowercase/trim — DATA-L2's "PADI" typo silently
   drops the cap today) in the same change. Update the glossary entry to match what ships.
4. **(OPS-5)** Add `calendar` to `CAPABILITY_ROUTE_PREFIXES` in `src/app/observability.ts` with a
   regression test; audit Sentry history for leaked `/calendar/<token>` URLs per the
   capability-telemetry runbook.
5. **(OPS-3)** Make the cron un-silent: per-scan try/catch + `Sentry.captureException` in
   `src/app/api/cron/reminders/route.ts` so one failure can't starve later scans, export
   `maxDuration`, and add a dead-man's switch (explicit Sentry Cron Monitors check-in from the
   route — `webpack.automaticVercelMonitors` is inert under Turbopack — or a healthchecks.io
   ping). Verify the alert fires by suspending the cron once.
6. **(OPS-1)** Write `docs/engineering/backup-and-restore-runbook.md`: record Neon's actual PITR
   window for the current plan, document branch-from-timestamp restore, add a scheduled export
   (full-shop CSV from `src/db/export.ts` + Blob listing) to a versioned private S3 bucket in
   `infra/`, schedule a quarterly restore test. Waiver records are legal evidence.
7. **(MKT-F2)** Replace the closed onboard timezone `<select>` with the full IANA list
   (`Intl.supportedValuesOf("timeZone")`), keeping curated dive-region optgroups on top.
8. **(PAY-M1)** Make the Stripe webhook claim atomic with handling in
   `src/app/api/webhooks/stripe/route.ts` (claim + handler in one transaction, or release the
   claim on handler exception) so redelivery can repair a crashed handler; today a crash after
   claim permanently loses `invoice.paid`/`invoice.voided`. Test: handler failure then
   redelivery.

### P1 — before/with the first pilot

9. **(PAY-H1/H2)** Persist the session's actual `amount_total` on `booking_checkouts` at
   completion, derive per-booking paid amounts (trip share + gear, post-discount), write those
   to `booking_payments.amountCents`, and base refunds on them. Fix
   `recordShopPromoRedemption.amountChargedCents` (or rename the column/UI label to "list
   price" — the schema docblock says pre-discount is deliberate; the promos page label is what
   misleads). Requires HD-12/HD-13 (refund basis, gear policy) first.
10. **(DOM-H3, safety)** Alarm on incomplete after-dive roll calls: top-severity Today item +
    schedule-board badge for any trip past its end with an after-dive checkpoint that has
    awaiting divers or zero events.
11. **(DOM-H1, safety)** ADR + design for crew as roll-call subjects (per-person, not
    per-booking); interim slice: a per-checkpoint "crew aboard: N of N" attestation that blocks
    the checkpoint reading complete. Pair with HD-4 (jurisdiction question).
12. **(TEST-2/DATA/OPS-2)** Add a real-Postgres CI job (service container): apply `drizzle/`
    migrations from empty and from the previous release's schema, and run the booking/payments/
    payment-operations suites with genuinely concurrent connections — two transactions racing
    for the last seat, asserting exactly one wins. Nightly or gated on `src/db/**`.
13. **(TEST-1)** Make unreviewed visual diffs block merge: `visual-report` parses reg-suit's
    `out.json` and fails on unexplained `failedItems`/`newItems` unless a PR explanation/label
    is present. Converts the AGENTS.md hard rule into an enforced check (pending HD-16).
14. **(I18N-1)** Once the color-guide decision (HD-15) lands: implement the three contrast
    fixes as written in the roadmap, re-enable `color-contrast` in `e2e/a11y.spec.ts`, triage
    the visual diffs.
15. **(OPS-6)** `/api/health` route (DB `select 1` + commit SHA) + external uptime monitor on it
    and the public schedule; create `alerts@dive.day` and confirm Sentry alert rules target it.
    Write the incident-response runbook H-04 acknowledges is missing (severity ladder, Vercel
    instant-rollback steps, Neon restore, comms template).
16. **(OPS-4)** `docs/engineering/deploy-and-migrations-runbook.md`: expand/contract rule,
    rollback procedure (revert + forward migration), concurrent-deploy serialization posture.
17. **(SEC-D1/OPS-7)** Provision Upstash so sign-in/password-reset rate limits are global;
    add log + Sentry capture inside `checkRateLimit`'s fail-open catch; fix the runbook's stale
    30/hour figures (code says 60).
18. **(DATA-H1, security+safety)** Design the diver-erasure path: anonymize identity fields and
    strip `medicalAnswers` while preserving the signed-evidence skeleton; ADR reconciling
    erasure with immutable safety evidence. Blocked on HD-10.
19. **(MKT-F1/F3)** Above-the-fold demo CTA on every switching guide + a repeat after the scope
    table; mid-page CTA on `/product` after the "At the dock" section.
20. **(MKT-F5)** Rewrite `CUTOVER_SECTION` in `src/lib/migration-guides.ts` to drop "how shops
    actually make the switch" / "most shops…" — with zero customers this is fabricated usage
    proof under the claims policy. Advice + shipped importer behavior only.
21. **(DOM-M1)** Resolve the rental-set three-way contradiction (code+tests vs glossary+H-06)
    once HD-6 answers which is right; fix the losing artifact.
22. **(DOM-M4)** Amend H-11/V-05 wording to state DiveDay gates the fill *request* and holds no
    fill log (or build the minimal fill-analysis log if HD-5 chooses that).
23. **(DATA-M1/M2)** Add the missing hot-path indexes: partial
    `payment_operation_intents(started_at) WHERE status='started'` (stale-claim scan runs on
    every checkout start, cross-shop, unindexed) and plain `trips.starts_at` / `trips.ends_at`
    for the cross-shop cron scans.
24. **(PROD-1)** Gate-freshness dashboard atop `human-decisions.md` (days-open per H/V row,
    reconciliation against rollout.md's "next 30 days" list) + the pilot-recruiting kit
    (one-pager, 10-shop Florida call list, first-call script, printable V-02 run sheet).

### P2 — hardening and hygiene

25. **(ARCH-2)** Fix `check-architecture.mjs`'s side-effect-import blind spot
    (`import "@/app/x"` doesn't match the regex); add `src/i18n`/`src/components` to the
    forbidden table.
26. **(ARCH-3)** Extract `SettingsPage.tsx`'s 11 inline server actions to a sibling
    `actions.ts` (the repo's own convention; 25 other pages comply). Split `src/db/trips.ts`
    (53 exports) along its series/crew/schedule seams; decompose `src/db/seed.ts` (4,419 lines,
    top conflict magnet) into scenario modules; split `src/lib/notifications/index.ts`.
27. **(ARCH-5)** Retype `createBookingRecord`/`revokeBookingCapabilities` + `src/db/tips.ts` to
    accept the existing `DbExecutor`, deleting all 11 `tx as unknown as AppDb` casts.
28. **(ARCH-4)** A scheduled check (Routine or `check:deps` warning) watching Next 16.3 GA,
    drizzle 1.0 stable, next-auth v5 stable — the ADRs commit to prompt migration; nothing
    tracks it.
29. **(I18N-2)** Static check walking each `useTranslations()` call site to a
    `DiverIntlProvider` with the namespace listed — converts both documented silent failure
    modes (blank page, raw-key render) into a gate.
30. **(I18N-4)** `scripts/check-tokens.mjs`: fail raw hex / palette-scale classes in guarded
    roots (allowlist `opengraph-image.tsx`/`*icon.tsx`) — makes ADR-0004 a ratchet like copy
    and clock.
31. **(I18N-5)** es-ES terminology sweep (pick "centro" over "tienda"; drop Spain-isms);
    decide the token-page `error.tsx` language tradeoff (six routes hard-code English for
    exactly the diver the English-only waiver notice worries about).
32. **(PAY-L1/L2)** Handle `checkout.session.async_payment_failed` (permanent pending-desync
    today); retention/pruning for `stripe_webhook_events` and the other unbounded append-only
    tables (DATA-M4) per the retention ADR (HD-11).
33. **(DATA-M3)** Append-only `booking_payment_events` trail alongside `booking_payments`
    mutations (currently one mutable row; history reconstruction depends on Stripe) — or a
    recorded decision to accept Stripe as sole ledger (HD-14).
34. **(DATA-L3)** Drop `default('usd')` from money-table currency columns; all writers now pass
    currency explicitly.
35. **(TEST-4/5/6)** Extend a11y scans to the unscanned staff surfaces + one keyboard-only
    booking traversal; split visual.spec.ts's 90-second mega-tests per surface; one e2e booking
    flow under `Accept-Language: es`.
36. **(DOM-M5)** Retitle the medical questionnaire "RSTC-style" pending H-01; make
    `questionnaireForJurisdiction` honor `uk` or remove the dead seam; add
    `cmas`/`raid`/`gue` to the agency enum or document the "other" policy.
37. **(DOM-L2/L3)** Marine forecast unit preference (Florida crews read feet); add WaterLocker
    false-trigger rate to the V-02 field-test checklist.
38. **(SEC-D3)** Call the offline-manifest purge on offline-shell load, not only online, to
    shorten cross-tenant residency on shared devices.
39. **(ARCH-8)** Burn down `instant = false` (46 of 56 pages carry the identical TODO) in
    measured tranches.
40. **(DATA-A10)** Extend the CSV export or record deliberate exclusions for `internal_notes`,
    `activity_events`, `course_inquiries`, checkout/redemption/notification history — the
    portability pledge currently has undocumented boundaries.

## Human decision register

Grouped; each blocks the listed action items. The register in
[human-decisions.md](../human-decisions.md) is the durable home for whichever of these the owner
accepts.

**Launch and business (from the product lens — the sharpest questions first):**
- **HD-1.** Have the three long-lead clocks started — attorney (H-01–H-03), Stripe platform
  application, Twilio A2P, entity (H-18)? If not, what starts them this week, and which Phase 1
  slip is being accepted in writing?
- **HD-2.** Who are the first three pilot shops, *by name*? If they can't be named today,
  recruiting outranks everything above, including legal.
- **HD-3.** What game is this — calm lifestyle-scale business or venture-scale? The $99 price,
  25-shop cap, no-platform-fee stance, and two-year lock all quietly assume the former; say so
  in vision.md or rework pricing before the founding lock binds. (Also: can one person deliver
  the published same-day support promise, at what hour budget?)
- **HD-4.** Pilot-before-counsel policy, decided now and in writing: paper waivers + DiveDay
  ops, provisional flow + signed risk acknowledgment, or hold.
- **HD-5.** An explicit engineering scope rule until Phase 0 exits (the review's own evidence:
  the development model's failure mode is that building continues by default).

**Safety and domain (need professional/legal input):**
- **HD-6 (H-08 reopen).** Obtain the actual PADI Instructor Manual DSD ratio and the Rescue
  scenario-supervision figure. The enforced 8→12:1 for zero-experience participants is the most
  consequential number in the product and is currently sourced from a blog. → P0-3.
- **HD-7 (new).** Crew-in-roll-call: does the launch jurisdiction require the head count to
  cover crew, and which mechanism (per-person roll call vs attestation)? → P1-11.
- **HD-8 (H-11 amendment).** Is DiveDay the nitrox fill log of record or explicitly not? The
  current H-11 wording overstates the product. → P1-22.
- **HD-9 (H-06 re-confirmation).** Dive computer in or out of the priced rental set? Decision
  log and glossary say out; shipped code and tests say in. One sentence settles it. → P1-21.
- **HD-10 (H-17 revisit, with counsel).** Imported waiver acceptance currently trusts a prior
  shop's medical clearance sight-unseen; present to the H-01 attorney as a package with the
  H-20/H-23 verified-on-import choices.

**Data, money, and legal posture:**
- **HD-11.** Erasure vs signed evidence: anonymize-and-keep, hard-delete after a liability
  window, or refuse — blocks P1-18. Retention windows for webhook/notification/token trails —
  blocks P2-32.
- **HD-12.** Refund basis under promos: discounted share, list price, or staff decision —
  blocks P1-9.
- **HD-13.** Gear money on cancellation: refund with the trip fee, keep, or staff-mediated —
  blocks P1-9.
- **HD-14.** Payment history ledger: invest in the local append-only trail now, or accept
  Stripe as sole historical ledger until the first dispute — P2-33.
- **HD-15.** Abandoned checkout = seats held forever: confirm book-now-pay-later, or define an
  auto-release window.
- **HD-16.** Platform economics: confirm monetization stays subscription-only (no
  `application_fee` mechanics exist; retrofitting touches every provider seam).

**Process and platform:**
- **HD-17.** The color-guide decision blocking the three WCAG contrast fixes — the
  highest-leverage two-day decision in the register. → P1-14.
- **HD-18.** Should unexplained visual diffs hard-block CI? → P1-13.
- **HD-19.** Real-Postgres CI spend: nightly, per-PR on `src/db/**`, or not at all. → P1-12.
- **HD-20.** GA migration budget for the pre-release stack (Next preview, next-auth beta,
  drizzle rc, TS 7): one scheduled hardening sprint or opportunistic — and is pre-release-major
  the default posture for a SaaS taking real payments?
- **HD-21.** The lib/db layer contract: bless the status quo (one layer, pure/IO naming) and
  fix overview.md's "framework-free" claim, or enforce lib→db type-only imports. Either; the
  ambiguity is the only bad option.
- **HD-22.** Feature modules: name the second adopter (reviews; trips series/crew) or shelve
  the pattern.
- **HD-23.** Who is the second human? Every alert path terminates at one person; name a backup
  or record solo-operator risk as accepted. Vercel Pro (hourly crons, SSE limits, spend caps)
  approved when real shops onboard? Resend→SES cutover trigger decided before it's needed
  mid-incident?
- **HD-24.** Sign-in rate limiting fail-open vs fail-closed on store outage (documented
  tradeoff, re-confirm for production); shared-device offline-manifest residency tradeoff
  (SEC-D3).
- **HD-25.** Timezone/CTA marketing calls: full IANA list vs curated (MKT-F2); renaming "Try
  the staff app" (MKT-F4); whether "most shops…" counts as a claims-policy violation (MKT-F5);
  Twitter-card policy.

---

# Lens reports

Condensed to findings and load-bearing strengths; action items above.

## 1. Product concept & strategy

**Strengths.** The competitive analysis is unusually honest for a self-assessment (deal-kill
list, conceded disqualifiers, verified rival claims, the *Power Ventures* guardrail). The
differentiators are real and structural — fail-closed readiness, append-only roll call,
encrypted offline manifest, the portability wedge — not "delight" vapor. The claims policy is a
genuine asset with a documented enforcement history. The rollout plan is concrete and
channel-literate.

**Findings.**
- **PROD-C1 (Critical).** The critical path is 100% human-external and has moved ~0% in the nine
  days since rollout.md ordered it started "today": H-01/H-02/H-03, H-18 still Ready; V-01–V-06
  all open including V-02 ("the single most important pre-pilot task"); meanwhile the git log
  shows continuous engineering (dormant SES infra, CI sharding, budget alerts). Phase 1 targets
  Sept–Oct in-season pilots; every blocking clock is long-lead and unstarted.
- **PROD-C2 (Critical).** Zero recorded customer contact, ever. Personas are synthetic; the
  165-task persona review was AI evaluating AI against AI. The product may be excellent against
  an imagined buyer.
- **PROD-H1 (High).** No market-size or unit-economics statement anywhere: 25 shops × $99 =
  $2,475 MRR against a published binding same-day-support promise, a two-year price lock
  (pre-legal-review), and a six-service infra stack.
- **PROD-H2 (High).** Liability stack all open simultaneously: medical data + indefinite
  retention placeholder + no entity + no insurance (H-19 deferred) + binding published promises.
- **PROD-H3 (High).** Owner repeatedly overrode agent-recommended safer defaults on
  imported-evidence trust (H-17, H-20, H-23) ahead of the counsel review that governs them;
  rework lands on shipped ADR-encoded behavior if counsel disagrees.
- **PROD-M1 (Medium).** Scope still expanding post-"breadth is done" (birthday callouts,
  upsells, dormant SES); each ship adds claims/support/i18n/baseline surface the sole human must
  stand behind.
- **PROD-M2 (Medium).** The gear register — purchase-blocker #3, "a disqualifier for the classic
  shop" — is sequenced *behind* the read API + webhooks, which no buyer in the research corpus
  asked for.
- **PROD-M3 (Medium).** DEMA/seasonality creates a hard deadline the docs acknowledge and the
  behavior ignores; every Phase-0 slip compresses Phase 1 against it.
- **PROD-L1 (Low).** The docs metabolism manufactures work: synthetic backlogs are deferred with
  ceremony but never discarded for lack of external demand.

## 2. Architecture & code quality

**Strengths.** Layering enforced and green; exceptional type discipline (no `as any`/
`@ts-ignore` anywhere; 18 `as unknown as` total); reason codes not sentences; the lib/db pairing
genuinely clean in sampled pairs; `src/db/bookings.ts` carries its reasoning inline to an
unusual standard; 130 ADRs with honest supersession records.

**Findings.**
- **ARCH-1 (Medium).** The documented layer model doesn't match reality: overview.md calls
  `src/lib` "framework-free" but `lib/auth.ts` imports next-auth and `getDb`; `src/db` imports
  `src/lib` in 80 files; the lib↔db direction is unchecked either way; `src/i18n` floats under
  no layer rule at all.
- **ARCH-2 (Medium).** `check-architecture.mjs:25` regex misses bare side-effect imports
  (`import "@/app/x"`).
- **ARCH-3 (Medium).** Complexity concentrated in the files every feature touches:
  `src/db/seed.ts` 4,419 lines (top conflict magnet); `src/db/trips.ts` 1,811 lines / 53
  exports; `src/lib/notifications/index.ts` 1,026 lines; `SettingsPage.tsx` 1,067 lines with 11
  inline `"use server"` closures against the repo's own convention.
- **ARCH-4 (Medium).** The entire critical path (framework, auth, ORM, compiler) is pre-GA
  simultaneously (Next 16.3 preview, next-auth 5 beta, drizzle 1.0-rc, TS 7); ADR-justified,
  but the "move promptly at GA" triggers exist only as prose. reg-suit 0.14.x is a
  low-activity-upstream risk (acknowledged).
- **ARCH-5 (Low).** 11 `tx as unknown as AppDb` casts inside the money/capacity transactions;
  `DbExecutor` already exists and sibling functions use it.
- **ARCH-6 (Low).** Feature-module pattern has one adopter and every post-ADR feature went
  flat; one more all-flat month and it's decorative.
- **ARCH-7 (Low).** 46 of 56 pages carry the identical `instant = false` Cache-Components TODO.
- **ARCH-8 (Low).** Auth-path notes: missing-account short-circuit skips the bcrypt compare
  (timing side-channel for enumeration); `DEMO_BYPASS_PASSWORD` lives in the production verify
  function gated only by `isDemo`; bcrypt cost 10 as a magic number at three sites.

## 3. Security & privacy

**Verdict: no exploitable tenant-isolation, authorization, token, or secret-handling defects
found.** Every data path sampled re-derives the session and re-scopes to `shopId` server-side,
independent of the proxy. Confirmed-correct under adversarial reading: export isolation (all ~35
tables scoped, CSV-injection neutralization phone-aware, owner/manager gate re-checked live);
token flows (256-bit CSPRNG, hashed at rest, atomic consumption, HKDF rotation-safe HMAC links,
timing-safe compares, analytics redaction + no-referrer); H-14 live role re-reads; server-side
price/MOD/gear derivation; SSRF host-pinning with manual redirects and bounded bodies on SNS and
image ingest; fail-closed test/cron routes; demo-bypass confined to `isDemo` rows with Stripe
attachment refused.

**Defense-in-depth notes.** SEC-D1: rate limiting per-instance and fail-open without Upstash
(documented; provision before production scale). SEC-D2: `x-forwarded-for` trust is
Vercel-assumption-load-bearing. SEC-D3: offline manifest store's cross-shop purge is best-effort
— a shared device can retain the previous shop's roster decryptable until the purge endpoint
runs. SEC-D4: SES/Resend webhooks rely on idempotent upserts rather than an event ledger — fine
today, thinner than the Stripe path if a non-idempotent handler is ever added.

## 4. Dive domain & safety

**Strengths.** Fail-closed readiness engine (`unavailableReadiness()` — a failed lookup can
never read "ready"); append-only roll call whose carry-forward can only propagate *absence*;
departure-gated boarding with pure body-count after-dive checkpoints; the nitrox request gate
re-checked at every read with card-sighting attestation for imports; published metre/foot depth
pairs killing the unit-conversion false-alarm class; medical fail-closed with newer-hold-wins;
offline rejects never falling back to stale optimism; minors' ages purged from crew phones.

**Findings.** DOM-C1 (Critical — multi-site gate), DOM-H1 (crew outside roll call), DOM-H2 (DSD
ratio), DOM-H3 (no after-dive chase) — see the top table. Plus:
- **DOM-M1 (Medium).** Rental set folds in the dive computer against glossary + recorded H-06;
  tests lock the wrong behavior in.
- **DOM-M2 (Medium).** Ratio gate and crew-gap check are PADI-only (`course.agency ===
  "padi"`); an SSI Try Scuba with 20 booked gets no cap; glossary claims no carve-out.
- **DOM-M3 (Medium).** A DM assigned as boat captain still counts as an in-water certified
  assistant (no per-trip role on `trip_assignments`) — known gap, now load-bearing on a safety
  number.
- **DOM-M4 (Medium).** H-11/V-05 describe a nitrox fill log (mix %, MOD math,
  analysis-signature) the product doesn't hold; an owner reading H-11 will believe DiveDay is
  their fill log of record.
- **DOM-M5 (Medium).** The "RSTC" questionnaire is an 8-question paraphrase of the 10-box 2020
  RSTC form (hard contraindications buried, behavioral-health and over-45 factors absent) and
  `questionnaireForJurisdiction` ignores its argument — the UK variant the glossary promises is
  dead code.
- **DOM-M6 (Medium).** Trip cert requirements aren't checked at booking (glossary says booking
  *and* boarding); a diver can pay in full for a charter they can't qualify for.
- **DOM-L1..L4 (Low).** Agency enum omits CMAS/RAID/GUE; marine forecast composes English
  metric strings ignoring unit preference; WaterLocker's spray lock is plausibly triggered by
  rapid two-thumb roll-call taps (make it a V-02 measurement); `canRecordOfflineStatus` reads
  `manifests[0]` regardless of checkpoint (latent trap).

## 5. Data model & persistence

**Strengths.** Uniform tenancy/naming/`timestamptz` discipline with null-meaning docblocks;
exemplary time modeling (instants vs calendar facts, two-pass DST refinement, date-only expiry
through end of local day); integer minor units with per-row currency and evidence-grade settled
amounts; production-grade concurrency design (trip-row `FOR UPDATE` everywhere it matters,
parent-row locking where the child may not exist, atomic checkout claims, advisory-locked
seeding, partial-unique invariants with written race narratives); indexes commented with the
query they serve; real pagination; consistent soft-delete/append-only patterns; 63 coherent
migrations including a deliberate merge migration.

**Findings.** DATA-H1 (erasure gap — top table). Plus:
- **DATA-M1 (Medium).** `claimBookingsForCheckout`'s stale-intent scan is cross-shop and
  unindexed — a growing seq scan on every checkout click.
- **DATA-M2 (Medium).** Cross-shop cron scans on `trips.starts_at`/`ends_at` windows have no
  supporting index (only `(shop_id, starts_at)` exists).
- **DATA-M3 (Medium).** `booking_payments` is one mutable row; refunds overwrite in place; no
  local money history.
- **DATA-M4 (Medium).** No retention policy on any append-only table (webhook events,
  notification attempts, activity events, expired tokens).
- **DATA-L1..L6 (Low).** PGlite can't exhibit the prod races (lock ordering consistent but
  unenforced); migrations run inside the Vercel build with no destructive-DDL guard; ILIKE arms
  without trgm indexes (orders/courses); `default('usd')` on money columns contradicts the
  explicit-currency rule; parallel-array jsonb on `courses.imageUrls/imageAlts`; export omits
  six tables without a recorded portability decision.

## 6. Payments & money

**Strengths.** Layered webhook defense (correct hand-rolled signature verification, event-id
claim ledger, idempotent per-handler state machines, account cross-checks, out-of-order
`account.updated` protection); live/test-mode segregation enforced against the verifying
secret; intents-before-Stripe-calls with deterministic idempotency keys and stuck-intent
surfacing; seats-before-money so Stripe failure degrades to pay-later; payment truth only from
Stripe (return URLs prove nothing); percent-only promos that can't go negative, one code per
session, local scope checks before Stripe.

**Findings.** PAY-C1 (refund idempotency collision), PAY-H1 (pre-discount ledger), PAY-H2
(invisible gear money) — top table. Plus:
- **PAY-M1 (Medium).** Webhook event claimed before handling; a handler crash permanently loses
  the event (redelivery reads as duplicate); `invoice.paid`/`invoice.voided` have no self-heal.
- **PAY-M2 (Medium).** Reports won't reconcile with Stripe: promo overstatement + missing gear
  revenue + tips absent entirely.
- **PAY-L1..L4 (Low).** `async_payment_failed` unhandled (permanent pending desync); reused
  pending checkout doesn't re-verify current price/deposit policy; `refundOrder` relies on
  Stripe's over-refund rejection rather than a local lock; `stripe_webhook_events` unbounded.

## 7. Testing & quality engineering

**Strengths.** 206 unit test files concentrated where risk lives; bookings tested like the
safety-critical code it is (46 behavioral cases on a real database, adversarial cases credited
to their finders); zero snapshots, zero skips, restrained mocking; best-in-class e2e isolation
(per-worker server + in-memory PGlite, both-halves clock freeze, external HTTP blocked);
`retries: 0` with root-caused flake history; well-factored ~20-25 min CI; ~2,000 lines of sharp
guardrail scripts with deliberately no prose-triggerable escape hatch.

**Findings.** TEST-1 (visual never blocks CI), TEST-2 (oversell guard untestable on PGlite; no
real-Postgres anywhere in CI) — top table. Plus:
- **TEST-M1 (Medium).** ci.yml itself estimates residual 5-10% per-test flake risk on the
  contended set under `retries: 0`; red shards tax every PR.
- **TEST-M2 (Medium).** Stripe tested only to the seam (injected fetchers, seeded fakes); no
  contract fixtures pinned to an API version.
- **TEST-M3 (Medium).** App/component layer thin (pages covered mainly transitively via e2e).
- **TEST-L1..L4 (Low).** a11y five surfaces with contrast off; perf budget is one number and
  never runs locally; guardrail scripts are regex-level (cooperative, not boundaries); e2e pins
  literal English copy and no non-English path is e2e-rendered; visual mega-tests blind sibling
  captures on first failure.

## 8. i18n, UX & accessibility

**Strengths.** Hardened two-pass locale negotiation with the render/record distinction feeding
per-person notification locale; coverage enforcement with a correct ICU-placeholder parser; the
English-only waiver disclosed in the signer's language with e2e proof; the diver/staff split
held in every sampled component; high-quality idiomatic es-ES on critical strings; above-baseline
a11y engineering (correct focus trap, live regions, boat/glare modes, 44px floor structural in
`buttonClass`); locale+timezone discipline at every sampled formatting call site.

**Findings.** I18N-1 (WCAG-AA currently false in light mode; scan blind to it) — top table.
Plus:
- **I18N-2 (Medium).** DiverIntlProvider's two silent failure modes (blank page; raw-key
  render) are documented tribal knowledge with no static guard.
- **I18N-3 (Medium).** All six bearer-token `error.tsx` boundaries are hard-coded English — for
  exactly the diver the waiver notice worries about; deferred in comments, tracked nowhere.
- **I18N-4 (Medium).** ADR-0004 has no automated enforcement (currently held by review alone;
  spot-check clean).
- **I18N-5 (Low-Med).** es-ES terminology drift ("tienda" vs "centro" for the same entity,
  sometimes on one page); Spain-isms for a mostly-LatAm audience.
- **I18N-L1..L3 (Low).** Unsupported-language divers get no signal at all (no switcher by
  design); trip times unlabeled with timezone for cross-tz bookers; a11y/keyboard scan breadth
  lags the "every important surface" bar.

## 9. Marketing & conversion

**Strengths.** Disciplined demo-first funnel with closed `FunnelTag` attribution; pricing-card
hierarchy right; the zero-social-proof problem handled by argument-from-checkable-proof instead
of pretense; onboard preserves fields on bounce and signs the owner straight in; SEO substrate
nearly complete.

**Findings.** MKT-F1 (switching-guide CTA burial), MKT-F2 (timezone hard-block) — top table.
Plus: **MKT-F3** `/product` has one CTA at the bottom of ~8 sections; **MKT-F4** homepage
primary CTA says "Try the staff app" (jargon, inconsistent with every other page); **MKT-F5**
"most shops review… and import in one sitting" fabricates an install base — a claims-policy
brush; **MKT-F6** `/switching/spreadsheet` missing its OG block (and no page sets Twitter
cards); **MKT-F7..F9 (Low)** `/about` hero fails the rulebook's own paste-test, homepage hero
decision density (~9 controls), pricing never anchors against the per-booking fees documented
in the switching guides.

## 10. Operations & production readiness

**Strengths.** Migration sequencing documented honestly; email is the most production-grade
subsystem (durable rate permit, idempotency keys, classified retries, parked-failure queue,
staff-visible failure surfacing, dormant SES fallback); capability-URL redaction actually
implemented and tested across all three consumers; serverless-aware honesty in the stateful
bits; sane alert-only AWS cost guardrails; unusually good runbooks; fail-closed cron auth.

**Findings.** OPS-1 (no backup/DR), OPS-2 (migration blast radius), OPS-3 (silent cron SPOF —
including the inert-under-Turbopack Sentry monitor), OPS-4 (no uptime/health/incident/status
posture; `alerts@dive.day` not yet created) — top table. Plus:
- **OPS-5 (Medium).** `/calendar/[token]` missing from `CAPABILITY_ROUTE_PREFIXES` — the one
  bearer route the redaction map forgot; a route error sends the raw feed token to Sentry.
- **OPS-6 (Medium).** Retry cadence is daily, not the 30s–1h the backoff math implies (Hobby
  cron limit); a failed waiver email waits ~24h for retry #1.
- **OPS-7 (Medium).** Rate limiting per-instance until Upstash; fail-open swallows store errors
  with zero signal; runbook figures drifted from code.
- **OPS-8 (Medium).** SSE + LISTEN holds one direct Neon connection per warm instance forever;
  viewers pin instances (cost + connection ceiling + no scale-to-zero); undocumented cliff.
- **OPS-9 (Medium).** Cost guardrails cover the smallest bill (AWS); Vercel/Neon/Resend (hard
  1,000/month free cap, unmetered) have none.
- **OPS-L1..L3 (Low).** Vercel access logs retain raw capability URLs (undocumented residual);
  VRT bucket world-readable (fine pre-launch, revisit); Sentry errors-only.

---

## Method

Ten independent reviewers, one lens each, run in parallel against the working tree at
`be15104`; every finding required file:line evidence and was written to survive an adversarial
re-read. Overlapping findings across lenses (cron fragility, PGlite parity, Upstash, retention)
were merged in the queue above and credited to each lens's numbering. One known tension is left
visible rather than resolved: the schema documents `shop_promo_redemptions.amountChargedCents`
as deliberately pre-discount while the payments lens flags the promos-page label as misleading —
P1-9 carries both readings to the owner.
