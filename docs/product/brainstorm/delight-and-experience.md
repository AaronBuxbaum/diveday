# Brainstorm 1 — Delight & experience

**Lens:** the actual bet. Feature parity on the five pillars is table stakes; we win because staff
*want* to open the app and a diver compliments the booking flow. This document explores where joy,
speed, and feel can become a moat competitors (EVE, DiveShop360, spreadsheets) structurally can't
copy without rewriting their product.

Grounded in [design/principles.md](../../design/principles.md): speed is the first delight; pass the
dock test; calm surfaces with earned moments; briefing-voice copy; motion has a job; trustworthy by
inspection.

---

## Where delight compounds

The everyday surfaces are *calm*; the finishing moments are *joyful*. The competition has neither.
The opportunity is to make the calm parts feel effortless and the finishing parts feel earned — and
to do it on a wet phone in glare.

### A. Speed as a feature you can feel

- [x] **Instant navigation everywhere.** (Shipped) Prefetch on hover/touch-start for staff routes; server components + streaming so the schedule never blanks.
- [x] **Optimistic mutations with honest rollback.** (Shipped) Cancelling a booking, assigning crew, checking a diver in — all reflect instantly and reconcile in the background, but *only where rollback is safe and obvious*. Never optimistic on safety state (boarded/not-boarded).
- [x] **Content-shaped skeletons, never spinners.** (Shipped) A schedule skeleton looks like trip cards; a manifest skeleton looks like the roster. No layout shift when data lands.
- [x] **Perceived-performance polish.** (Shipped) Warm the next-likely route (a trip detail after you view the schedule); keep already-seen data on screen while revalidating.

### B. The earned moments

`--accent` (coral) is rationed on purpose. Each pillar deserves *one* concentrated ≤400 ms moment:

- [x] **Booking confirmed** (Shipped) — the diver's "you're on the boat" moment (already the M2 confirmation).
- [x] **Waiver signed** (Shipped) — "You're all set for Saturday — nothing left to bring but yourself."
- [x] **Cert verified** (Shipped) — a quiet green check that says exactly what it unlocked ("Cleared for the Blue Hole").
- [x] **Roll call complete** (Shipped) — the captain's moment: every diver accounted for, one satisfying state change, timestamped. Safety-serious, not confetti.
- [x] **Trip closed out** (Shipped) — end-of-day "everyone's home" summary for staff.

*(S each, per-pillar, quick win — these are copy + one animation, high delight-per-effort.)*

### C. Micro-interactions that say "someone cared"

- [x] **Undo over confirm.** (Shipped) Reversible staff actions (cancel booking, remove certification, remove from manifest) get a 5-second undo toast instead of a modal. Fewer dialogs, safer flow.
- [x] **Forgiving inputs.** (Shipped) Name autocomplete from prior divers, email typo detection (`gmial.com` → suggest `gmail.com`), phone/date masks, "same as last trip" rental size defaults.
- [x] **Empty states that teach.** (Shipped) Every list's zero-state names the first action in briefing voice ("No trips yet — schedule your first charter").
- **Haptics on key moments** (mobile web where supported): a single soft tap on roll-call confirm. *(S, manifests)*
- **Sound, optional and off by default** — a short surface-break chime on trip close-out for shops that want it. *(S, cross-cutting — park unless requested.)*

### D. The "wet phone at the dock" flagship

The dock test is our most defensible differentiator because it's a *whole-product* commitment, not a
feature. Ideas that make it visceral:

- **Glare mode** — a high-contrast, larger-type variant that a captain toggles (or that auto-suggests at high ambient brightness where the sensor is available). AAA contrast, ≥16 px text, ≥44 px targets everywhere it's on. *(M, manifests/cross-cutting, big bet)*
- [x] **One-handed roll call.** (Shipped) Big targets down one side of the screen, reachable with a thumb; no precision gestures; works with a dripping finger.
- [x] **Sunlight-safe palette check.** (Shipped) A design-review gate that verifies the roll-call and manifest surfaces hit AAA and target sizes automatically.

### E. Voice as delight

Microcopy is a competent divemaster, never a lawyer or a mascot. This is nearly free and almost no
competitor does it.

- [x] **A copy pass per surface.** (Shipped) Reviewed against principle #4 — verbs on buttons, actionable errors, teaching empty states, no jargon divers don't use.
- [x] **Context-aware reassurance.** (Shipped) Where we ask for something sensitive (medical answers, cert number), a one-line plain-language *why*.
- **Seasonal/local warmth without kitsch** — e.g. surface-interval microcopy that reads like a briefing, not filler. Keep it rationed like `--accent`.

---

## Bigger bets on feel

- [x] **A staff "home" that feels like a cockpit, not a dashboard.** (Shipped) Today's trips, who's not ready, what needs a human — glanceable, calm, and the same shape every morning so muscle memory forms.
- **Motion language as brand.** A small, consistent set of transitions (150–250 ms, ease-out, transform/opacity) so the app *moves* like one product. Codify in the design system, enforce in review. *(M, cross-cutting.)*
- [x] **Delight regression tests.** (Shipped) Visual regression + interaction snapshots on the earned moments so polish doesn't rot as agents iterate. Delight you can't measure, you lose.
- [x] **Personality in demo data.** (Shipped) The seed tells a believable shop's story (a returning diver, a sold-out wreck trip, a diver blocked on a medical referral) so every screenshot sells the product.

---

## What NOT to do (delight anti-patterns)

- Confetti everywhere — dilutes the earned moment to zero (principle #3).
- Animation for decoration — motion must explain, or it's noise (principle #5).
- Color-only state on any safety surface — banned by principle #6 regardless of prettiness.
- A mascot or cutesy voice — we're a competent divemaster, not a brand character.
- Optimistic UI on boarded/not-boarded — feel must never outrank truth on safety state.

## Highest delight-per-effort (if picking today)

1. Per-pillar earned moments (copy + one animation each) — **S, quick win.**
2. Undo-over-confirm for reversible staff actions — **S–M, quick win.**
3. Content-shaped skeletons + prefetch on the schedule and manifest — **S–M, quick win.**
4. A microcopy + empty-state pass across shipped surfaces — **S, quick win.**
5. Glare mode for roll call — **M, big bet, the flagship dock-test statement.**
