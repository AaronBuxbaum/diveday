# Delight-first design principles

Delight is this product's differentiator (see [product/vision.md](../product/vision.md)). These
principles are testable rules, not vibes. The `design-review` skill checks against them.

## 1. Speed is the first delight

Nothing charms like instant. Navigation feels immediate (prefetch, server components); mutations
are optimistic where safe; loading states are skeletons shaped like the content, not spinners.
If an interaction needs a spinner for more than a beat, redesign the interaction.

## 2. Pass the dock test

Primary flows work one-handed on a phone, in glare, with wet fingers: touch targets ≥ 44 px,
critical text ≥ 16 px, strong contrast (AA minimum, AAA for manifest/roll-call surfaces),
forgiving inputs (autocomplete, sensible defaults, no precision gestures). A 44 px target must
center its own label, and fields in a row must share one baseline no matter how their captions
wrap — both come free from the primitives in
[forms-and-controls.md](forms-and-controls.md). Roll call gets the
most extreme version of this. Live and offline boat surfaces run in `boat-mode`, which follows the
device's own light/dark preference — bright by day so the manifest reads in full sun, dark for a
night dive when a white screen would blind the deck — while boosting ink, border, and action
contrast past the app's AA baseline to AAA in both schemes. Visible connectivity/freshness states,
a sticky progress cue, and an accessible skip link keep any operational state from hiding behind
deck glare.

## 3. Calm surfaces, earned moments of joy

The everyday UI is quiet: generous whitespace, few borders, muted ink for secondary text. Joy is
concentrated where the user finishes something — booking confirmed, waiver signed, roll call
complete — as a small, fast, coral-accented moment (≤ 400 ms). Delight loses meaning if it's
everywhere; `--accent` is rationed on purpose.

## 4. Words sound like a good dive briefing

Microcopy is warm, plain, and brief — a competent divemaster, not a lawyer or a mascot. Empty
states teach ("No trips yet — schedule your first charter"); errors say what happened and what
to do next; buttons are verbs ("Add diver", not "Submit"). No jargon divers don't use; correct
use of the jargon they do (see [product/glossary.md](../product/glossary.md)).

**Never surface the implementation.** Encryption, sync, snapshots, envelopes, reconciliation,
tokens, caching, tenancy, "fail-closed", and database words stay out of user-facing copy. The same
goes for our own process artifacts — ADRs, "requirements," specs, tickets, and any other
engineering-doc vocabulary have no place in anything a shop owner or diver reads; those words
belong in `docs/`, commit messages, and code comments, never in a page, email, or error message.
Say what the person gets — "saved on this phone", "works without signal", "DiveDay double-checks
it when you're back in service" — not how we built it, and not what we wrote down to decide to
build it. Two carve-outs:

- **Payment** may say "pay securely" — that is the reassurance people expect at a checkout, and
  nothing more technical than that.
- **Safety surfaces keep their precision, in human words.** A stale device copy must never look
  current — but the label is "Saved 4 hours ago — refresh before you rely on it", not "stale
  snapshot". Translating jargon is never license to blur an operational state.

**The name is DiveDay** — one word, two capitals. Use it as the actor when the system does
something on the user's behalf ("DiveDay will catch up when you're back in service"), and
otherwise stay out of the way: the product speaks as the shop's own tool, not as a character
with a personality.

**Empty states follow one rule: terminal vs. section.** A **terminal/whole-page** empty state —
nothing else renders on the page (see `src/app/shop/[shopSlug]/blockers/page.tsx`) — uses the
bespoke warm pattern: a large emoji in a rounded circle, a heading, and subtext, with no card
border. An **empty section within an otherwise-populated page** — a list or panel sitting below
filters, a header, or other real content — uses the shared `EmptyState` component
(`src/components/EmptyState.tsx`), the dashed-border card. Never a bare `<p>`/`<li>` styled
ad hoc for either case, and never the bespoke emoji pattern for a section that isn't the whole
page — the emoji circle reads as "you've reached the end," which is false when siblings above it
still have content.

## 5. Motion has a job

Animation exists to explain (where did it go, what changed), 150–250 ms, ease-out
(`--ease-out-soft`), transform/opacity only. Everything respects `prefers-reduced-motion` — the
kill-switch in `globals.css` stays.

## 6. Trustworthy by inspection

This app handles safety documents. Manifests and cert checks look exact: tabular numbers for
counts, unambiguous states (never color alone — icon + label), timestamps with timezone, print
output as considered as screen output.

## 7. Undo over confirm — one model everywhere it's safe

A reversible mutation gets an **undo**, never a blocking `confirm()` dialog. Two shapes:

- **High-frequency toggles** (board / not-board / aboard) use **re-tap**: tapping the confirmed
  "Aboard ✓" state clears it, with a "Tap to undo" hint. The correction is its own event, so the
  audit trail keeps it (never a delete).
- **Destructive or rare** actions (delete a diver) confirm *after* the fact with an **Undo
  banner** — the action lands immediately and the banner offers a one-tap reversal.

A blocking `confirm()` is reserved for what is genuinely **irreversible or a send** — issuing or
reissuing a waiver link (the old link stops working, an email may go out), removing a booking
(inside the shop's refund window it fires an automatic Stripe refund; undo restores the seat but
can't claw back money already sent), or resending a waiver to someone already notified. A
`confirm()` on a purely reversible action is a bug: it slows the common path to guard against a
mistake that undo already handles calmly.

Three narrower carve-outs, found while sweeping the app's `confirm()` sites onto this rule — each
looks like it should be undo-able on its face, but isn't, for a concrete reason rather than "hard
to implement":

- **Sign out** stays a two-tap confirm, not an undo banner. An undo window means the session (or a
  passwordless resume) has to stay valid for a few seconds after the person walked away — on a
  shared boat or front-desk device, that's a real window for whoever touches the device next to
  reclaim the previous login, not just an inconvenience.
- **Removing a trip from the schedule board** (the builder's "remove", for a departure nobody has
  touched yet — distinct from cancelling one with a roster) stays a confirm. It deliberately hard-
  deletes across several related tables rather than leaving a cancelled ghost behind ("clutter, not
  history" — `src/db/trips.ts`); reconstructing that from an undo-toast payload would just
  reintroduce the ghost-row problem it was built to avoid.
- **Removing a recap photo** stays a confirm. The delete queues the stored image for deletion in
  the same step; a true undo would mean holding that deletion back until the undo window passes,
  which needs storage-layer support the surface doesn't have today.

Everything else — a private note, a promo code that never went live, hiding a review, a staff
member's roles and access — recreates cleanly from what the undo action already has on hand, so it
gets the banner.

## 8. Fewer controls, one obvious action

Every screen should tell the user what to do next without making them choose among equals. A row
of same-weight buttons is the user doing triage work that the design should have done for them.

- **One primary per view.** At most one primary-weight control rendered at a time (no explicit
  `variant`, an explicit `variant: "primary"`, or `variant: "danger-solid"`) per screen or
  section — count what's actually on screen together, not `buttonClass()` call sites: mutually
  exclusive branches don't stack, a call inside a loop can render many. Everything else competing
  for the same moment is `secondary`, `ghost`, `link`, or `danger` weight, not a second primary.
  If two actions feel equally important, one of them isn't as important as it feels; demote it.
- **Merge before you stack.** Three buttons that do variations on one action ("Approve",
  "Approve & note", "Approve & notify") are usually one button with good defaults — approving
  always notifies, and a note is a follow-up affordance, not a fork in the primary flow. Before
  shipping a row of buttons, ask what it looks like as one button plus sensible defaults.
- **State toggles, don't duplicate buttons.** Two buttons for opposite states ("Board" / "Remove
  from boat") are one re-tap control that reflects current state (principle 7) — never a pair
  that both stay visible.
- **Collapse the rare path.** An action used by a minority of users at a minority of moments
  (advanced filters, rare settings, "more options") sits behind progressive disclosure, not at
  equal visual weight to the common path. The default state should be good enough that most users
  never open it.
- **Test it by counting.** Look at a section at rest: more than two or three controls competing
  for attention is a finding. The fix is a merge, a demotion, or a disclosure — never a new
  wrapper that makes three buttons look tidier.

## Tokens (the mechanics)

Defined in `src/app/globals.css`, bound to Tailwind — see
[ADR-0004](../architecture/decisions/0004-design-tokens.md) for the rules. Palette story: sunlit
sand (light) / open ocean at depth (dark); **lagoon** (`--primary`) is the action color;
**coral** (`--accent`) is rationed for earned moments; feedback colors (`--success`,
`--warning`, `--danger`) never carry meaning alone.

## Review checklist

- [ ] Semantic tokens only (no raw hex / palette-scale classes)
- [ ] Light **and** dark verified (screenshots)
- [ ] Dock test: targets ≥ 44 px, text ≥ 16 px, AA contrast
- [ ] Buttons and button-shaped links via `buttonClass()`; labels centered in the target
- [ ] Stacked form fields via `<Field>`/`<FieldGrid>`; controls aligned across columns
- [ ] Loading = content-shaped skeletons; no layout shift
- [ ] Motion ≤ 250 ms, transform/opacity, reduced-motion respected
- [ ] Copy: verbs on buttons, teaching empty state, actionable errors
- [ ] State never conveyed by color alone
- [ ] Keyboard reachable, focus visible, semantic HTML
- [ ] One primary action per view/section; the rest are demoted, merged, or disclosed — not a
      row of same-weight buttons
- [ ] Empty-state pattern matches terminal-vs-section (bespoke emoji pattern for a whole empty
      page, shared `EmptyState` for an empty section within a populated page)
