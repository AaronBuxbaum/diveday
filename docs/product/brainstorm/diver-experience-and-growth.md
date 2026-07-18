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

- **No-account booking.** Name + email, capacity enforced transactionally, confirmation moment —
  already the M2 flow. Protect it fiercely; it's the vision's signature. *(shipped — extend, don't
  regress.)*
- **Ruthless field minimization.** Ask only what's needed to hold the seat; everything else moves to
  a *prepare* step after booking. Time-to-confirmation is the metric. *(S, bookings, quick win.)*
- **Forgiving inputs.** Email typo detection, phone masks, sensible date/time defaults, autocomplete
  for returning divers by email. *(S, bookings, quick win — mirrors delight doc.)*
- **Trip pages that sell the dive.** Site name, depth, what you'll see, cert requirement stated
  plainly up front ("Advanced Open Water needed for this wreck") so nobody books what they can't
  dive. *(S–M, bookings, quick win.)*
- **Real-time seat honesty.** "3 seats left" / "Sold out — join the waitlist" with no lie and no
  double-book. *(M, bookings.)*
- **Guest checkout for a group.** Book multiple divers in one flow (a family, a class) without an
  account each. *(M, bookings.)*

## B. The "prepare" arc — confidence between booking and boarding

The gap between *booked* and *ready* is where shops lose time and divers lose confidence. Own it.

- **A personal readiness page (no login).** A secure link shows the diver exactly what's done and
  what's left: waiver ☐, cert ☐, gear sizes ☐, medical ☐ — in plain language, resumable on mobile.
  *(M, cross-cutting, big bet — this is the diver-side mirror of the staff blocker queue.)*
- **Progress in meaningful steps, not a spinner** (next-steps Phase B) — "Step 2 of 3: sign your
  waiver," never a generic bar. *(S, waivers, quick win.)*
- **Plain-language *why*.** Each sensitive ask (medical, cert number) gets a one-line reassurance so
  it feels like care, not bureaucracy. *(S, waivers/certs, quick win.)*
- **Self-service cert upload.** The diver photographs their C-card; staff verify. Removes the
  counter bottleneck and the "bring your card" reminder. *(M, certs, big bet.)*
- **Self-service gear sizing.** A friendly height/weight/foot-size prompt that maps to BCD/wetsuit
  sizes, so gear is ready before they arrive (glossary — sizing must be respected, not guessed).
  *(M, gear.)*
- **Resumable, expiring links** handled gracefully — expired and already-completed states are
  polished, never a dead end (next-steps Phase B). *(M, waivers.)*

## C. Confirmations & reassurance

- **Confirmations that say exactly what's complete and what remains** (next-steps Phase B) — not
  "success!" but "You're booked for Saturday's two-tank. Next: sign your waiver (2 min)." *(S,
  cross-cutting, quick win.)*
- **A calendar add + directions to the dock** in the confirmation — reduce day-of confusion. *(S,
  bookings, quick win.)*
- **Pre-dive briefing note.** The day before: conditions, what to bring, arrival time, in briefing
  voice. Replaces the "what time again?" call. *(M, cross-cutting — pairs with M7 notifications.)*
- **Weather/condition-hold honesty.** If the shop flags a hold, the diver hears it from the app
  immediately, not a scramble of texts. *(M, bookings.)*

## D. Retention & repeat visits (within non-goals)

Not a social network — but a returning diver should feel *known*.

- **"Welcome back" recognition.** A returning diver's certs, sizes, and emergency contact are on
  file; booking their next trip is two taps. *(M, cross-cutting, big bet — the person-spine payoff,
  diver-side.)*
- **Post-dive close-the-loop.** A warm "thanks for diving with us — here's what's next" with the
  shop's upcoming trips they're now qualified for. *(M, cross-cutting.)*
- **Cert-progression nudges.** A diver with OW who keeps booking sites needing AOW sees a gentle
  "ready to go deeper? here's the course" — sells courses (M-later) without nagging. *(M,
  certs/bookings.)*
- **Personal dive history with the shop** — trips taken, sites seen — as *booking context*, not a
  social feed. Stays inside the non-goal. *(S–M, cross-cutting.)*

## E. Referral & word-of-mouth mechanics

- **Bring-a-buddy booking.** "Add a buddy to this trip" in the confirmation — one link, buddy books
  in under a minute. Turns one booking into two. *(M, bookings, big bet.)*
- **Shareable trip pages.** A trip page a diver can text to a friend that books directly — the trip
  *is* the ad. *(S, bookings, quick win.)*
- **Gift a dive / DSD.** Book a Discover Scuba experience for someone else (glossary — DSD is an
  experience, not a cert; stricter ratios apply). A gateway funnel for new divers. *(M, bookings.)*

## F. Accessibility as reach

- **The whole flow passes the dock test on the diver's phone too** — ≥44 px targets, ≥16 px text,
  AA contrast, one-handed. Divers book from phones on boats and beaches. *(S–M, cross-cutting, quick
  win.)*
- **Reduced-motion, screen-reader-clean, keyboard-reachable** public flow — reach is growth. *(S,
  cross-cutting, quick win.)*
- **Localization-ready copy** for shops in multilingual markets (park until a shop needs it, but
  don't hard-code English into the data model). *(M, cross-cutting — architecture note now, feature
  later.)*

---

## Bigger growth bets

- **The shop's public schedule as a booking channel** (`/trips` already exists) — SEO-clean,
  fast-loading, shareable, so a shop can point all its marketing at one delightful page. *(M,
  bookings, big bet.)*
- **Waitlist as demand signal + recovered revenue** — divers join, get auto-notified on a
  cancellation, book instantly. Growth *and* efficiency. *(M, bookings.)*
- **Course funnel** (M-later, gated on cert levels/DSD rules) — DSD → Open Water → Advanced, each
  step nudged from real booking behavior. The lifetime-value engine. *(L, certs/bookings, big
  bet.)*

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
