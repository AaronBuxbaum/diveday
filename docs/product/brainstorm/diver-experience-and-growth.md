# Brainstorm 4 — Diver experience & growth

**Lens:** the customer. The vision promises *a public booking flow a diver finishes in under a minute*
and *never needs an account manual*. The north star's second outcome is *more diver confidence* —
clear next actions, visible readiness, reassuring confirmations ([next-steps](../next-steps.md)). This
document explores the diver-facing funnel (`src/app/` public surfaces) — discovery → book → prepare →
show up ready → come back → bring a buddy — and how a delightful customer experience becomes the
shop's growth engine.

Persona: **the diver**. They book, sign, upload a cert. They should never feel like they're using
"software." Note the vision non-goal: *not a dive-log social network* — engagement serves booking and
readiness, not vanity.

---

## The growth thesis

Dive shops grow by word of mouth and repeat visits. A diver who books in 40 seconds, arrives without
a single "did you get my waiver?" phone call, and gets a warm "you're all set" is a diver who returns
and tells their buddy. **Diver delight is the shop's marketing.** Every idea is judged on: does it
raise confidence, remove a pre-dive uncertainty, or turn one diver into two?

---

## A. The sub-minute booking flow (the front door)

- [x] **No-account booking.** (Shipped) Name + email, capacity enforced transactionally, confirmation moment.
- [x] **Ruthless field minimization.** (Shipped) Ask only what's needed to hold the seat; everything else moves to the `/ready` step.
- [x] **Forgiving inputs.** (Shipped) Email typo detection, phone masks, sensible date/time defaults, autocomplete for returning divers.
- [x] **Trip pages that sell the dive.** (Shipped) Site name, depth, cert requirements stated plainly up front.
- [x] **Real-time seat honesty.** (Shipped) Seats left and sold-out/waitlist states.
- [x] **Guest checkout for a group.** (Shipped) Book multiple divers (up to six) in one flow.

## B. The "prepare" arc — confidence between booking and boarding

The gap between *booked* and *ready* is where shops lose time and divers lose confidence. Own it.

- [x] **A personal readiness page (no login).** (Shipped) A secure `/ready/[token]` link shows the diver exactly what's done and what's left (waiver, cert, gear sizes, medical, contact) in plain language, resumable on mobile.
- [x] **Progress in meaningful steps, not a spinner** (Shipped) — Clear waiver step sequence.
- [x] **Plain-language *why*.** (Shipped) One-line reassurance when asking for sensitive info like medical questions and certs.
- [x] **Self-service cert upload.** (Shipped) The diver uploads their C-card photo; staff verify.
- [x] **Self-service gear sizing.** (Shipped) A friendly rental size prompt (BCD, wetsuit, regulator, fins) so gear size requirements are ready before they arrive.
- [x] **Resumable, expiring links** (Shipped) — Expired and already-completed states are handled gracefully.

## C. Confirmations & reassurance

- [x] **Confirmations that say exactly what's complete and what remains** (Shipped) — Displays booking details and states outstanding waivers/requirements.
- [x] **A calendar add + directions to the dock.** (Shipped) Every public trip and confirmation
  offers a portable calendar download, a mapped location when the shop supplied one, and the live
  trip link.
- [x] **Pre-dive briefing note.** (Shipped) Night-before brief email/SMS with conditions, arrival time, checklist.
- [x] **Weather/condition-hold honesty.** (Shipped) A crew hold pauses booking, puts the live state
  on the trip immediately, and sends a best-effort email to booked divers when delivery is
  configured.

## D. Retention & repeat visits (within non-goals)

Not a social network — but a returning diver should feel *known*.

- [x] **"Welcome back" recognition.** (Shipped) Returning diver picker matches by email, pulling prior certs, sizes, contact information.
- [x] **Post-dive close-the-loop.** (Shipped) Post-trip recap page (`/recap/[token]`) generated and emailed/texted automatically.
- [x] **Cert-progression nudges.** (Shipped) A confirmation with an insufficient-level blocker
  gently links the shop's active Advanced Open Water course; clear divers and unrelated blockers
  see no prompt.
- [x] **Personal dive history with the shop** (Shipped) — Prior visits imported verbatim as an inert history list on the diver's profile.

## E. Referral & word-of-mouth mechanics

- [x] **Bring-a-buddy booking.** (Shipped) Post-trip recap includes a "bring a buddy" nudge.
- [x] **Shareable trip pages.** (Shipped) Public trip pages use native device sharing with a
  copy-link fallback and book directly — the trip *is* the ad.
- [x] **Gift a dive / DSD.** (Shipped) Discover Scuba booking explicitly supports entering the
  recipient's identity while the giver pays on their device; readiness goes to the recipient.

## F. Accessibility as reach

- [x] **The whole flow passes the dock test on the diver's phone too** (Shipped) — ≥44 px targets, ≥16 px text,
  AA contrast, one-handed. Divers book from phones on boats and beaches. *(S–M, cross-cutting, quick
  win.)*
- [x] **Reduced-motion, screen-reader-clean, keyboard-reachable** public flow (Shipped) — reach is growth. *(S,
  cross-cutting, quick win.)*
- **Localization-ready copy** for shops in multilingual markets (park until a shop needs it, but
  don't hard-code English into the data model). *(M, cross-cutting — architecture note now, feature
  later.)*

---

## Bigger growth bets

- [x] **The shop's public schedule as a booking channel.** (Shipped) schedule page, embeddable schedule widget for the shop's website, pricing pages, etc.
- [x] **Waitlist as demand signal + recovered revenue.** (Shipped) Waitlist with first-come seat recovery and one-tap invite from the Today work queue.
- [x] **Course funnel.** (Shipped) SSI/PADI template course sessions scheduled on the trip spine, gating visibility and registration based on cert requirements.

## What NOT to do

- Don't require an account — the vision's non-goal and the flow's signature (no account manual).
- Don't build a dive-log social network — engagement serves booking/readiness only (vision
  non-goal).
- Don't turn nudges into nagging — cert/course prompts are rationed like `--accent`.
- Don't let "prepare" bloat the booking flow — booking stays sub-minute; preparation is a separate,
  resumable arc.

## Highest growth-per-effort (if picking today)

1. The no-login personal readiness page — **M, the diver-side mirror of the blocker queue; kills "did you get my waiver?" calls.**
2. Confirmations that state exactly what's done and next — **S, quick win, pure confidence.**
3. Self-service cert upload + gear sizing — **M, removes the counter bottleneck, arrives-ready divers.**
4. Bring-a-buddy / shareable trip pages — **S–M, one booking becomes two.**
5. "Welcome back" returning-diver recognition — **M, the retention payoff of the person spine.**
