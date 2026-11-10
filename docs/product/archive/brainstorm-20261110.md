# Brainstorm (archived 2026-11-10)

> Archived 2026-11-10. GitHub Issues is now where ideas live; this file is kept for the lenses,
> the effort and bet-size tags, and the reasoning behind each idea. Not current scope.
>
> Where each remaining idea went: safety record page [#4255](https://github.com/AaronBuxbaum/diveday/issues/4255),
> emergency text draft [#4256](https://github.com/AaronBuxbaum/diveday/issues/4256), no-boats-day suggestions
> [#4257](https://github.com/AaronBuxbaum/diveday/issues/4257), multi-boat days
> [#4258](https://github.com/AaronBuxbaum/diveday/issues/4258), course cohorts
> [#4259](https://github.com/AaronBuxbaum/diveday/issues/4259), buddy referral credit
> [#4260](https://github.com/AaronBuxbaum/diveday/issues/4260), crew thank-yous
> [#4261](https://github.com/AaronBuxbaum/diveday/issues/4261), retention and north-star measures
> [#4262](https://github.com/AaronBuxbaum/diveday/issues/4262), and the small parked delight and growth
> ideas [#4263](https://github.com/AaronBuxbaum/diveday/issues/4263). Earlier moves: alternative-day
> salvage [#4244](https://github.com/AaronBuxbaum/diveday/issues/4244), credit ledger
> [#4245](https://github.com/AaronBuxbaum/diveday/issues/4245), receipt printing
> [#4247](https://github.com/AaronBuxbaum/diveday/issues/4247), deck head count
> [#4248](https://github.com/AaronBuxbaum/diveday/issues/4248). The AI ideas went the same way; see
> [claude-assists.md](../../engineering/claude-assists.md).

Every idea is tagged so you can triage fast:

- **Effort** - S (days), M (a milestone slice), L (multi-milestone).
- **Pillar** - bookings / waivers / certs / gear / manifests / cross-cutting / tooling.
- **Bet size** - quick win (obvious value, low risk) or big bet (could define the product, higher
  risk).

## Safety And Trust

Lens: make unsafe departure harder. Safety ideas require boring code, failure-path and adversarial
tests, and `dive-domain-expert` review. The deck head-count comparison is now
[#4248](https://github.com/AaronBuxbaum/diveday/issues/4248).

- **Safety record page.** Publish honest, computed shop safety stats such as boarded divers,
  roll-call completion, and readiness completion. The page must display the real numbers, even when
  imperfect. *(S-M, manifests, quick win.)*
- **Emergency SMS quick-draft.** Emergency contacts on the manifest offer a one-tap draft text with
  shop/captain context. Human sends it; the app does not automate emergency escalation. *(S,
  manifests, quick win.)*

## Staff Operations

Lens: give a busy front desk its day back by turning repeated coordination work into a glance or a
single action. Receipt-printer tickets are now
[#4247](https://github.com/AaronBuxbaum/diveday/issues/4247).

- **No-boats-today suggestions.** Empty operational days suggest useful shop tasks such as reviewing
  course sign-ups or upcoming blockers. The quiet-day state already says "No boats today, and nothing
  is waiting on you"; this adds suggestions to it. *(S, cross-cutting, quick win.)*
- **Multi-boat / multi-trip day orchestration.** A shop running several boats can see all departures,
  move divers and crew carefully, and avoid collisions. *(L, cross-cutting, big bet.)*

## Diver Experience And Growth

Lens: help a diver book, prepare, show up confident, return, and bring a buddy without turning DiveDay
into a social network.

- **Course cohorts as groups.** Reuse the shipped group-claim mechanics for a course roster so each student owns
  their readiness while the instructor sees the whole cohort. *(M, bookings/certs, big bet.)*
- **Buddy referral credit.** When a diver brings a buddy, issue a simple trip credit for a future
  booking. Needs the credit ledger first ([#4245](https://github.com/AaronBuxbaum/diveday/issues/4245)). *(M, bookings, quick win.)*
- **One-tap crew thank-you shoutouts.** The recap page can collect moderated compliments for crew
  members, useful for morale and review prompts. *(S-M, cross-cutting, quick win.)*
- **Personal roster cue.** Let a diver choose a small, staff-visible preference or symbol that helps a
  crew member recognize them and start a friendly dock conversation. Keep it optional and non-cutesy.
  *(S, manifests, parked.)*

## Revenue And Recovery

Lens: a dive shop sells perishable seats under weather risk. These ideas protect revenue without
breaking community trust. Alternative-day salvage is now
[#4244](https://github.com/AaronBuxbaum/diveday/issues/4244) and the credit ledger
[#4245](https://github.com/AaronBuxbaum/diveday/issues/4245).

- **Insurance leverage.** Once incident and safety exports exist, package the evidence a shop can use
  in liability-premium discussions. No marketing claim until real operators validate it. *(No build,
  manifests, parked.)*

## Platform, Data, And Intelligence

Lens: make connected data compound while keeping safety facts human-verifiable and fail-closed.

- **Cohort and retention view.** Show repeat-diver rate, course-funnel conversion, and retention by
  trip/course type. *(M, cross-cutting, quick win.)*
- **North-star measures from real data.** Track blocker-resolution time, waiver completion rate, and
  fully-ready departures from production data — the list to instrument is
  [roadmap.md's measures](roadmap-20261110.md#measures). *(M, cross-cutting, quick win.)*

Tooling ideas that were duplicated here — sharded feature/entity docs, and a machine-readable task
manifest for external orchestrators — now live once, in
[roadmap.md's engineering enablement backlog](roadmap-20261110.md#p2--when-parallelism-or-scale-proves-the-need).

## Delight And Micro-Interactions

Lens: speed, feel, and authentic divemaster voice. Keep delight rationed; safety truth outranks feel.

- **Interval chitchat tips.** Empty states may teach small local or marine facts while waiting, but
  only where they do not distract from operational work. *(S, cross-cutting, parked.)*
- **Sub-surface page slide.** A small set of brand transitions for page changes, using transform and
  opacity only. Must respect reduced motion. *(S, cross-cutting, parked.)*
## Completed Or Superseded Brainstorms

Completed work does not live here. Private-charter inquiry/quotes and cancellation cascades
already exist; inspect current source and shipped history before proposing either again.
Use these records instead:

- [../shipped.md](../shipped.md) is the canonical index of delivered slices.
- [../archive/delight-and-experience.md](delight-and-experience.md) is the completed
  delight-and-experience brainstorm.
- [../archive/diver-booking-delight-20260729.md](diver-booking-delight-20260729.md) is the
  completed diver-booking-delight follow-on brainstorm.
- The nitrox maximum-depth calculator (`src/features/nitrox-mod`, shown on the diver's ready page),
  the swipe-away undo toast, and expiring group holds with an organizer ledger (#4209) are built.
- [ai-ml.md](../../engineering/claude-assists.md) holds AI-required ideas, including natural-language assistants and
  model-based evidence extraction.
- [../shipped.md](../shipped.md#demand-crew-and-staff-context-delivered-2026-07-29) covers demand
  intelligence, conflict-safe crew assignment, private booking notes, and operational activity.
- [../shipped.md](../shipped.md#bookings-m2) covers the returning-diver picker; existing people carry
  their certs, waivers, contact details, and rental fit forward instead of being re-entered.
- [../shipped.md](../shipped.md#growth-layer-reviews-discounts-seo-and-languages-delivered-2026-07-29)
  covers localization-ready copy, which shipped as a real next-intl layer with Spanish alongside
  English.
- [../shipped.md](../shipped.md#operational-surfaces-m7) covers the automated marine outlook and the
  first-timer night-before brief; [../shipped.md](../shipped.md#rental-fit-and-trip-prep-m5) covers the
  rental-fit prep work that the gear-status indicator builds on.
- Superseded gear-inventory ideas are represented by the smaller gear-register question in
  [shipped.md](../shipped.md) — the gear register shipped 2026-08-20 (ADR 20260815-minimal-gear-register).
