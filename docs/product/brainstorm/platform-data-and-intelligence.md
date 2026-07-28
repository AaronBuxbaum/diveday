# Brainstorm 5 — Platform, data & intelligence

**Lens:** the compounding layer. The other four documents explore *surfaces*; this one explores the
*substrate* — the data model's reach, automation and AI, integrations, and the agent-native
development platform that lets many short-lived AI agents build DiveDay safely and in parallel. The
north star's fourth outcome is *faster agent delivery* ([next-steps](../next-steps.md)); this is
where that lives, alongside the intelligence features that make the product smarter over time.

Grounded in the architecture direction in [next-steps](../next-steps.md) (module contracts, task
packets, mechanical quality gates) and the modeling notes in [glossary.md](../glossary.md) (one
person, many roles; everything hangs off the trip/session spine).

---

## The platform thesis

DiveDay's data is unusually *connected*: bookings, waivers, certs, gear, and manifests all hang off one
trip/session spine, and one person plays many roles. That connectedness is a moat — it lets the app
answer questions no spreadsheet can, automate what shops do by hand, and let agents build features
without re-deriving where anything lives. Every idea is judged on: does it make the data compound, or
the delivery faster?

Guardrail: intelligence must stay **trustworthy by inspection** (principle #6) and **fail closed** on
safety. AI *suggests*; the safety spine *decides*.

---

## A. The data-model spine (make it reach further)

- [x] **Person as a single spine, roles not types.** (Shipped) Single person record with multiple roles.
- [x] **Everything hangs off the trip/session spine.** (Shipped) The manifest is a view of checked-in bookings + crew.
- [x] **A generic requirement/evidence/readiness core.** (Shipped) Fail-closed readiness checks for waivers, certs, nitrox, payments.
- [x] **Multi-tenant to the core.** (Shipped) `shop_id` is present on all relevant schema tables.
- [x] **Temporal correctness.** (Shipped) Timezone-aware date and time helpers.

## B. Reporting & business intelligence

Owners watch the calendar and the money (vision). Give them answers, not exports.

- [x] **Owner dashboard.** (Shipped) Monthly reporting dashboard with revenue, bookings, seat fill, and waiver completion status.
- [x] **Utilization insights.** (Shipped) Real-time capacity utilization and per-trip seat-fill metrics.
- [x] **Readiness analytics.** (Shipped) Pre-departure waiver completion metrics on the owner dashboard.
- **Cohort & retention view** — repeat-diver rate, course-funnel conversion. *(M, cross-cutting.)*
- [x] **Exportable, print-clean reports.** (Shipped) Full-shop ZIP data export settings, clean browser manifest print layouts.

## C. Automation & intelligence (AI where it earns trust)

AI suggests; humans and the safety spine decide. Never fail open.

- [Superseded] **Smart gear assignment.** *(Gear inventory assignment was removed in M5 in favor of direct rental sizes tracking. Replaced in requirements by a lightweight who-has-what register).*
- **Cert-card OCR.** Photograph a C-card → extract agency, level, number, date for staff to verify. *(M, certs, big bet.)*
- [x] **Anomaly & blocker prediction.** (Shipped) Today work queue flags missing waivers/certs, unverified nitrox, freed waitlist seats, etc.
- **Demand/waitlist intelligence.** Suggest adding a boat or a second trip when demand + waitlist cross a threshold. *(M, bookings.)*
- **Natural-language ops assistant (staff-only).** "Who's not ready for tomorrow's wreck trip?" *(L, cross-cutting, big bet.)*
- [x] **Copy assistance in briefing voice.** (Shipped) Night-before briefing and post-trip recap automation.

**AI guardrails (hard):** every AI output on a safety surface is a *suggestion* a human confirms;
low-confidence extraction fails closed; no AI decides gating, boarding, or medical clearance.

## D. Integrations & interoperability

- [x] **Payments/deposits.** (Shipped) Stripe Connect, checkouts, refund capabilities, deposit options.
- [x] **Notifications channel.** (Shipped) Unified notify helper for Resend email and Twilio SMS.
- **Calendar sync** — trips to staff calendars, bookings to diver calendars (.ics already cheap on the diver side). *(S–M, cross-cutting.)*
- [Superseded] **Agency card verification.** *(Agency-verification API seam was removed as speculative in M4. Staff look up agency verification manually and confirm card sightings).*
- [x] **DAN / dive-insurance field.** (Shipped) Surfaced on the diver profile.
- [x] **Accounting export.** (Shipped) Settings → Data export generates documented CSV files.

**Every new runtime dependency or external service → an ADR** (hard rule). Integrations are where
that rule earns its keep.

## E. Agent-native development platform (faster agent delivery)

This is the fourth north-star outcome and the least visible moat: the repo makes the *correct*
implementation path easier than the expedient wrong one (next-steps).

- [x] **Task packets everywhere.** (Shipped) Bounded paths, invariants, and validation for 11 specific area tasks via `pnpm task:context`.
- [x] **Mechanical quality gates.** (Shipped) safeguards, lints, typecheck, unit tests, and CI gates checks.
- **Module contracts.** The `src/features/<feature>/` shape applied to the next new feature. *(M, tooling.)*
- [x] **Provider-neutral canonical workflow.** (Shipped) canonical processes, review checklists, and drift safeguards.
- [x] **Path-aware CI.** (Shipped) `pnpm check:repo` and fast pre-commit check tooling.
- **Sharded feature/entity docs** with a *generated* aggregate. *(M, tooling — earn it first.)*
- **Machine-readable task manifest** for external orchestrators. *(M, tooling — earn it first.)*
- [x] **Safety-invariant + adversarial test libraries.** (Shipped) Core testing harnesses and robust mock frameworks.

## F. Observability & measurement

- [x] **Event instrumentation.** (Shipped) `src/lib/analytics.ts` instrumenting checkout abandons and blocker resolution path activities.
- [x] **Performance budgets.** (Shipped) gzip checks for JS bundles in CI pipelines.
- **The north-star measures** (next-steps) tracked from real data: blocker-resolution time, waiver completion rate, % fully-ready departures. *(M, cross-cutting.)*

---

## What NOT to do

- Don't let AI decide a safety fact — it suggests, the spine decides, low confidence fails closed.
- Don't build the heavy agent-platform machinery before a real collision or scale problem demands it
  (next-steps "do not copy yet") — complexity must earn its maintenance cost.
- Don't fork the trip/person spine for a feature's convenience — the connectedness *is* the moat.
- Don't add an integration without an ADR — every external dependency is a hard-rule decision.
- Don't become a POS, an LMS, or a social network (vision non-goals) even when the data tempts it.

## Highest leverage-per-effort (if picking today)

1. Task packets for every area + the mechanical quality-gate ladder — **M, the multiplier on every future agent.**
2. The generic requirement/evidence/readiness core — **M, one tested engine behind certs, medical, gear, payment.**
3. Owner dashboard + readiness analytics — **M, turns connected data into the owner's reason to stay.**
4. Cert-card OCR + smart gear assignment (AI-suggests, human-confirms) — **M, removes hand-entry, keeps safety human.**
5. Performance budgets + event instrumentation in CI — **M, keeps "delight" and "speed" measurable as agents iterate.**
