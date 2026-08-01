# Brainstorm

Idea exploration, not commitments. This is the active backlog for raw DiveDay ideas that are not yet
scheduled and do not require AI. Ideas that require AI live in [ai-ideas.md](ai-ideas.md). Nothing
here is approved scope until it moves into [roadmap.md](../roadmap.md) with a milestone and a note.

Keep this file to open ideas. When an idea ships, remove it from here and capture the delivered slice
in [shipped.md](../shipped.md) or the ADR that made the decision. When a whole brainstorm is complete,
move that snapshot to [archive/](../archive/).

Every idea is tagged so you can triage fast:

- **Effort** - S (days), M (a milestone slice), L (multi-milestone).
- **Pillar** - bookings / waivers / certs / gear / manifests / cross-cutting / tooling.
- **Bet size** - quick win (obvious value, low risk) or big bet (could define the product, higher
  risk).

## Safety And Trust

Lens: make unsafe departure harder. Safety ideas require boring code, failure-path and adversarial
tests, and `dive-domain-expert` review.

- **Buddy pairs / teams.** Let staff pair divers so roll call can surface "this diver's buddy is not
  back yet." Mirrors how dives actually run. *(M, manifests, quick win.)*
- **Physical headcount reconciliation.** A captain enters the count they see on deck; the app
  cross-checks it against boarded/not-boarded state. *(M, manifests, big bet.)*
- **Incident-ready export.** One tap exports the manifest, roll-call timeline, cert evidence, and
  relevant waiver state for a given departure as a signed PDF for authorities and insurers. *(S-M,
  manifests, quick win.)*
- **Safety record page.** Publish honest, computed shop safety stats such as boarded divers,
  roll-call completion, and readiness completion. The page must display the real numbers, even when
  imperfect. *(S-M, manifests, quick win.)*
- **Emergency SMS quick-draft.** Emergency contacts on the manifest offer a one-tap draft text with
  shop/captain context. Human sends it; the app does not automate emergency escalation. *(S,
  manifests, quick win.)*

## Staff Operations

Lens: give a busy front desk its day back by turning repeated coordination work into a glance or a
single action.

- **Thermal receipt print layout.** A compact manifest/check-in ticket layout for common lobby
  receipt printers. *(M, manifests, quick win.)*
- **No-boats-today suggestions.** Empty operational days suggest useful shop tasks such as reviewing
  course sign-ups or upcoming blockers. *(S, cross-cutting, quick win.)*
- **Multi-boat / multi-trip day orchestration.** A shop running several boats can see all departures,
  move divers and crew carefully, and avoid collisions. *(L, cross-cutting, big bet.)*
- **End-of-day close-out.** Reconcile who dove, gear returned, incidents logged, and tomorrow's
  blockers in one "everyone is home" ritual. *(M, cross-cutting, quick win.)*

## Diver Experience And Growth

Lens: help a diver book, prepare, show up confident, return, and bring a buddy without turning DiveDay
into a social network.

- **Group organizer surface.** One organizer holds several seats; invitees claim their own seat, sign
  their own waiver, upload certs, and optionally pay their own share. *(L, bookings/waivers/certs,
  big bet.)*
- **Course cohorts as groups.** Reuse group-claim mechanics for a course roster so each student owns
  their readiness while the instructor sees the whole cohort. *(M, bookings/certs, big bet.)*
- **Private charter inquiry to quote to booking.** Replace email ping-pong for high-value group trips
  with a structured inquiry and quote flow. *(M, bookings, quick win after groups.)*
- **Buddy referral credit.** When a diver brings a buddy, issue a simple trip credit for a future
  booking. Requires the credit ledger. *(M, bookings, quick win.)*
- **One-tap crew thank-you shoutouts.** The recap page can collect moderated compliments for crew
  members, useful for morale and review prompts. *(S-M, cross-cutting, quick win.)*
- **Personal roster cue.** Let a diver choose a small, staff-visible preference or symbol that helps a
  crew member recognize them and start a friendly dock conversation. Keep it optional and non-cutesy.
  *(S, manifests, parked.)*

## Revenue And Recovery

Lens: a dive shop sells perishable seats under weather risk. These ideas protect revenue without
breaking community trust.

- **One-tap cancellation cascade.** Captain calls a blow-out; staff taps once; booked divers receive
  rebooking links filtered to trips they qualify for plus a trip-credit option ahead of refund. *(M,
  bookings, big bet.)*
- **Alternative-day salvage.** A cancellation can offer what the shop can still run, such as a pool
  session, shore dive, or classroom day. *(M, bookings, quick win after cancellation cascade.)*
- **Credit ledger.** First-class trip credit balance on the diver, visible and spendable at booking.
  Requires schema change and ADR. *(M, bookings, big bet.)*
- **Insurance leverage.** Once incident and safety exports exist, package the evidence a shop can use
  in liability-premium discussions. No marketing claim until real operators validate it. *(No build,
  manifests, parked.)*

## Platform, Data, And Intelligence

Lens: make connected data compound while keeping safety facts human-verifiable and fail-closed.

- **Cohort and retention view.** Show repeat-diver rate, course-funnel conversion, and retention by
  trip/course type. *(M, cross-cutting, quick win.)*
- **North-star measures from real data.** Track blocker-resolution time, waiver completion rate, and
  fully-ready departures from production data — the list to instrument is
  [roadmap.md's measures](../roadmap.md#measures). *(M, cross-cutting, quick win.)*

Tooling ideas that were duplicated here — sharded feature/entity docs, and a machine-readable task
manifest for external orchestrators — now live once, in
[roadmap.md's engineering enablement backlog](../roadmap.md#p2--when-parallelism-or-scale-proves-the-need).

## Delight And Micro-Interactions

Lens: speed, feel, and authentic divemaster voice. Keep delight rationed; safety truth outranks feel.

- **Nitrox MOD calculator.** After enriched-air verification, show a clean maximum-operating-depth
  calculator in the diver prep surface. Planning aid only; never fill authorization. *(S, certs,
  quick win.)*
- **Interval chitchat tips.** Empty states may teach small local or marine facts while waiting, but
  only where they do not distract from operational work. *(S, cross-cutting, parked.)*
- **Sub-surface page slide.** A small set of brand transitions for page changes, using transform and
  opacity only. Must respect reduced motion. *(S, cross-cutting, parked.)*
- **Swipe-dismiss undo toast.** Toasts can be dismissed with a touch gesture while preserving the
  undo window and keyboard/screen-reader access. *(S, cross-cutting, quick win.)*

## Completed Or Superseded Brainstorms

Completed work does not live here. Use these records instead:

- [shipped.md](../shipped.md) is the canonical index of delivered slices.
- [archive/delight-and-experience.md](../archive/delight-and-experience.md) is the completed
  delight-and-experience brainstorm.
- [archive/diver-booking-delight-20260729.md](../archive/diver-booking-delight-20260729.md) is the
  completed diver-booking-delight follow-on brainstorm.
- [ai-ideas.md](ai-ideas.md) holds AI-required ideas, including natural-language assistants and
  model-based evidence extraction.
- [shipped.md](../shipped.md#demand-crew-and-staff-context-delivered-2026-07-29) covers demand
  intelligence, conflict-safe crew assignment, private booking notes, and operational activity.
- [shipped.md](../shipped.md#bookings-m2) covers the returning-diver picker; existing people carry
  their certs, waivers, contact details, and rental fit forward instead of being re-entered.
- [shipped.md](../shipped.md#growth-layer-reviews-discounts-seo-and-languages-delivered-2026-07-29)
  covers localization-ready copy, which shipped as a real next-intl layer with Spanish alongside
  English.
- [shipped.md](../shipped.md#operational-surfaces-m7) covers the automated marine outlook and the
  first-timer night-before brief; [shipped.md](../shipped.md#rental-fit-and-trip-prep-m5) covers the
  rental-fit prep work that the gear-status indicator builds on.
- Superseded gear-inventory ideas are represented by the smaller gear-register question in
  [roadmap.md](../roadmap.md#3-minimal-gear-register-an-m5-reversal-deliberately-smaller).
