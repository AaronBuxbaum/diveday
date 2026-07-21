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

- **Person as a single spine, roles not types.** A person is simultaneously customer, student,
  staff (glossary). Every feature reads/writes one person record. This is the precondition for
  "welcome back," blocker queues, and cross-feature intelligence. *(M, cross-cutting, big bet —
  foundational.)*
- **Everything hangs off the trip/session spine.** The manifest is a *view* of checked-in bookings +
  staff, not separate data entry (glossary). Certs, gear, waivers all reference the same booking.
  Resist any feature that forks the spine. *(architectural invariant — enforce in review.)*
- **A generic requirement/evidence/readiness core** (next-steps Phase C) reused by certs, medical,
  gear service, payment. One tested engine, many surfaces. *(M, cross-cutting, big bet.)*
- **Multi-tenant to the core.** `shop_id` everywhere already; design every new table for it so
  multi-shop (M7+) is a config, not a rewrite. *(architectural invariant.)*
- **Temporal correctness.** Local-time trip entry, timezone-aware storage (`src/lib/zoned.ts`
  exists) — every date the diver or captain sees is unambiguous. *(S–M, cross-cutting.)*

## B. Reporting & business intelligence

Owners watch the calendar and the money (vision). Give them answers, not exports.

- **Owner dashboard.** Bookings trend, capacity utilization, no-show rate, revenue by trip type,
  gear utilization — glanceable, not a BI tool. *(M, cross-cutting, big bet — M7+.)*
- **Utilization insights.** Which trips sell out, which sites underperform, which gear sits idle,
  which instructors are over/under-booked. Turns the connected data into decisions. *(M,
  cross-cutting.)*
- **Readiness analytics** (the measures in next-steps) — waiver completion rate before arrival,
  % of departures fully ready before the day, median blocker-resolution time. Proves the product
  works. *(M, cross-cutting.)*
- **Cohort & retention view** — repeat-diver rate, course-funnel conversion (within the non-goal:
  serves the shop's growth, not a social graph). *(M, cross-cutting.)*
- **Exportable, print-clean reports** for accountants and coast-guard records. *(S–M,
  cross-cutting.)*

## C. Automation & intelligence (AI where it earns trust)

AI suggests; humans and the safety spine decide. Never fail open.

- **Smart gear assignment.** Constraint solver proposes a valid gear set per diver (size, service
  state, availability, nitrox eligibility) with clear alternatives; staff confirm (next-steps Phase
  D). *(M, gear, big bet.)*
- **Cert-card OCR.** Photograph a C-card → extract agency, level, number, date for staff to verify.
  Removes hand-entry; verification stays human (fail closed on low confidence). *(M, certs, big
  bet.)*
- **Anomaly & blocker prediction.** "This Saturday trip has 4 divers still missing waivers 48h out
  — nudge them now." Proactive, not reactive. *(M, cross-cutting.)*
- **Demand/waitlist intelligence.** Suggest adding a boat or a second trip when demand + waitlist
  cross a threshold. *(M, bookings.)*
- **Natural-language ops assistant (staff-only).** "Who's not ready for tomorrow's wreck trip?" /
  "Move Dana to Sunday." Reads the connected model, proposes actions, never executes a safety change
  without confirmation. *(L, cross-cutting, big bet.)*
- **Copy assistance in briefing voice** — draft confirmations, reminders, condition-hold notices
  that staff edit. *(S–M, cross-cutting.)*

**AI guardrails (hard):** every AI output on a safety surface is a *suggestion* a human confirms;
low-confidence extraction fails closed; no AI decides gating, boarding, or medical clearance.

## D. Integrations & interoperability

- **Payments/deposits** (M7) — deposit at booking, balance at check-in; reduces no-shows. Needs an
  ADR for the processor. *(L, bookings, big bet.)*
- **Notifications channel** (M7) — email/SMS for confirmations, reminders, condition holds, waitlist
  hits. One channel abstraction, many triggers. *(M, cross-cutting.)*
- **Calendar sync** — trips to staff calendars, bookings to diver calendars (.ics already cheap on
  the diver side). *(S–M, cross-cutting.)*
- **Agency card verification** — where agencies expose it, verify a C-card against the agency
  directly (glossary — we *track* certs, don't *issue* them; verification ≠ issuance, stays in
  bounds). *(L, certs — park until an agency API is real.)*
- **DAN / dive-insurance field** capture (glossary — "worth a field, not a feature"). *(S, certs,
  quick win.)*
- **Accounting export** — clean data out for the shop's books; not a POS. *(S–M, cross-cutting.)*

**Every new runtime dependency or external service → an ADR** (hard rule). Integrations are where
that rule earns its keep.

## E. Agent-native development platform (faster agent delivery)

This is the fourth north-star outcome and the least visible moat: the repo makes the *correct*
implementation path easier than the expedient wrong one (next-steps).

- **Task packets everywhere.** Extend `pnpm task:context -- <area>` to every area (bookings,
  waivers, certs, gear, manifests, design, database, auth) so a fresh agent gets bounded paths,
  invariants, tests, and "do-not-read" lists without scanning the repo. *(M, tooling, big bet.)*
- **Mechanical quality gates** (next-steps §5, in order): architecture-boundary import checks, ADR
  validation, doc-link checks, schema/tenant-ownership checks, UI raw-color lints, changed-UI
  screenshot evidence, feature-completeness prompts. Weaker agents pass because the *checks* catch
  them. *(M, tooling, big bet.)*
- **Module contracts.** The `src/features/<feature>/` shape (service/queries/schema/tests/README)
  applied to the next new feature, migrated on touch, ADR'd before it's permanent (next-steps §3).
  *(M, tooling.)*
- **Provider-neutral canonical workflow** with thin adapters — an ADR comparing the skill-layout
  options, then a drift-detection test so `.claude/` can't diverge from canonical rules
  (next-steps §1). *(M, tooling.)*
- **Path-aware CI** — smallest trustworthy check set per change, full gate before merge
  (next-steps §5). *(M, tooling.)*
- **Sharded feature/entity docs** with a *generated* aggregate (not a hand-maintained hotspot) —
  only when the roadmap outgrows the small files (next-steps P2). *(M, tooling — earn it first.)*
- **Machine-readable task manifest** for external orchestrators (next-steps P2) — only when
  parallelism proves the need. *(M, tooling — earn it first.)*
- **Safety-invariant + adversarial test libraries** as reusable harnesses so every safety feature
  inherits the same rigor cheaply. *(M, tooling.)*

## F. Observability & measurement

- **Event instrumentation** (delight backlog) for abandonment, blocker frequency, staff recovery
  paths — so "delight" and "efficiency" stay measurable, not asserted. *(M, cross-cutting.)*
- **Performance budgets** enforced in CI for staff pages on ordinary phones and weak marina Wi-Fi
  (delight backlog). Speed is the first delight — measure it. *(M, tooling.)*
- **The north-star measures** (next-steps) tracked from real data: blocker-resolution time, waiver
  completion rate, % fully-ready departures, agent time-to-first-test, PR rework from missed
  invariants. *(M, cross-cutting.)*

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
