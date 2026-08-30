# First light — implementation spec

Companion to [the ADR](../../../architecture/decisions/20260827-first-light.md), per
[design-artifacts.md](../../design-artifacts.md#the-spec-is-the-implementation-half-and-it-expires-the-same-way):
below the ADR, above the artboards, expiring per slice. Interface names are proposals; pinned
behavior is not. Standing repo obligations apply unstated.

**Contracts no slice may move**: forgot-password is enumeration-safe (every outcome redirects to
`?sent=1`); `/verify`'s bare GET never mutates and its `?confirmed=1` is re-proven by
`wasAccountTokenConsumed`; a dead invite never names the shop; onboard's `?error=` code table and
its field routing (`ONBOARD_ERROR_MESSAGES` / `ONBOARD_ERROR_FIELDS`) and value echo; claim's five
`?error=` refusals including the `requirement` special case; `EntryShell` reads no translator —
words arrive as props; sign-in's success is always `redirect("/shop")` (the proxy forwards), never
`callbackUrl`; all rate limits.

---

## The journeys

- **F1 — June opens Torchlight** (anonymous → owner, Tue Sep 1). A marketing page's "Start a
  trial" → `/onboard`: two labeled groups, the slug hint reading `diveday.com/s/torchlight` as she
  types, one primary. Submit lands her signed in on `/shop/torchlight`, where the first morning
  leads; the verify email waits in her inbox and `/verify/<token>` is one tap.
- **F2 — The first morning** (June, the same day). The checklist's remaining steps — three, in
  this reading — lead the spine as one ledger group: *add your first dive site* → the site
  library; *put a departure on the board* → the board's add panel; *connect payments* →
  settings. A done step settles into a checked line; the group leaves at the first departure;
  and when her first real booking arrives, it carries the coral mark and the home is just the
  home.
- **F3 — A staffer joins** (Blue Mantis hires Tessa Brandt). The team page sends the invite;
  Tessa's email link lands on `/invite/<token>` — set a password, one primary, and she is on the
  shop home. A stale forwarded link shows the account-tier dead door: no shop named.
- **F4 — Noor claims her seat** (the thread's first page). Yara booked two seats for Saturday
  11:00 French Reef and forwarded Noor the claim link. `/claim/<token>` wears `ThreadShell` —
  eyebrow Blue Mantis Divers, the trip as the title — asks name · email · phone, and lands her on
  `/ready/<token>?saved=claimed`, already inside the thread.
- **F5 — Dana forgets her password.** One field; every outcome is the same "Check your email"
  door (enumeration-safe); the emailed link sets a new password and signs her in.
- **F6 — A dead link, both tiers.** An account token (verify, reset, invite) says only "request a
  new one" — no shop. A booking token (waiver, ready, recap, claim) offers the shop's hand: name,
  phone, email, and the reassurance that the booking is safe.

---

## 10a — The door speaks Clearwater

```ts
// src/components/account/EntryShell.tsx — EntryDone's glyph becomes a closed drawn set:
export type DoorGlyphId = "sent" | "expired" | "done" | "quiet" | "cancelled";
// sent: mail stroke · expired: clock stroke · done: check stroke · quiet: resting bell · cancelled: calendar
export function EntryDone(props: {
  glyph: DoorGlyphId;
  title: string;
  text: string;
  action?: ReactNode;          // unchanged slot; at most one quiet link
}): JSX.Element;
// The strokes live in this file (inline SVG, stroke="currentColor", stroke-width 1.8, 24px
// viewBox) inside the existing size-14 rounded-full bg-surface-sunken circle. No caller may
// pass markup or an emoji; all eight callers move in this change.
```

- `EntryShell` itself keeps its contract (`width`, `wordmark`, `eyebrow`, `panel`, `footer`); the
  convergence is visual: the panel is flat (border, no shadow anywhere), headings take the
  Clearwater ramp (h1 `text-3xl font-bold tracking-tight` per ThreadShell's scale), footer links
  are quiet text. A door renders **one** primary and nothing else button-shaped — sign-in's
  "Forgot password?" stays a text link, right-aligned under the password field.
- `ExpiredLinkCard` keeps its contract and adopts the `expired` glyph through `EntryDone`.
- **Undrawn, specified**: sign-in's `?error=` states keep today's grammar (danger `FormStatus`
  under the button; the two-factor variant adds its one field above the submit); reset-password
  is the invite artboard's twin (two password fields, one primary); unsubscribe is `EntryDone`
  with the `quiet` glyph, naming the shop as today.
- **Tests**: a component test that `DoorGlyphId` is exhaustive and no `account/` component
  contains an emoji literal (pin with a regex over the file, the same shape as the tinted-ink
  guards); visual captures re-point for sign-in, forgot-sent, verify, invite, and both dead
  tiers; the a11y spec re-runs on the door routes.

## 10b — Onboard is the shop's first form

- The two h2-over-`border-b` sections become two `GroupLabel` groups (**Your shop** / **You**);
  field order, names, and the timezone `<select>` are unchanged. The four concatenated
  reassurance strings collapse to one sentence under the primary —
  `account.onboard.trialNote` ("Free for 3 weeks, no card — and nothing switches off when the
  window ends.", the day-22 answer from
  [marketing-review-20260827.md](../../../product/marketing-review-20260827.md); soft expiry per
  `src/lib/trial.ts`) — and the four old keys delete from the call site and **both** locales in
  the same change.
- The slug field's hint becomes the live URL line: "Your schedule will live at
  **diveday.com/s/&lt;slug&gt;**", rendering the current normalized slug from the same client
  state `SuggestShopLink` already owns (extend that component; no new one). When the slug field
  errors (`slug_taken` etc.), the field error replaces the hint — never both.
- Error routing, value echo, `trial_started` analytics, and the `after()` notification fan-out
  are untouched.
- **Tests**: unit — the hint renders the normalized slug and yields to the field error; the
  existing onboarding e2e extends one assertion (hint visible before submit); visual capture
  `onboard` re-baselines.

## 10c — Claim joins the thread

- `/claim/[token]` recomposes onto `ThreadShell`
  (see [the diver's-thread SPEC](../20260827-the-divers-thread/SPEC.md), 7a): eyebrow the shop,
  title interpolating the trip, meta the date · time line. The hand-rolled `TokenPageHeader` +
  panel markup deletes. The form (name · email · optional phone, one primary "Claim this seat")
  and the privacy footnote render as the thread's terminal card; the five `?error=` refusals keep
  the thread's one notice grammar, `requirement` still rendering the trip-requirement sentence
  with the shop's contact.
- The dead claim link becomes **booking-tier**: when the token row is readable (consumed or
  expired), `ExpiredLinkCard` names the shop and says the booking is safe; only a token that
  resolves to nothing at all falls back to the bare account-tier door, since there is no shop to
  name. Success (`/ready/<token>?saved=claimed`) is unchanged.
- The diver's-thread SPEC lists `/claim` as a 7a adopter in the same change (one line, its
  "Adopters in this slice" bullet).
- **Tests**: an e2e claim flow — extend the party/claim spec if one exists in `e2e/`, else a new
  `e2e/seat-claim.spec.ts` (book two seats, follow the claim link, land on `/ready`); a component
  test that a readable dead token names the shop and an unreadable one does not; visual captures
  for the claim ask and its dead state.

## 10d — The first morning

**Scope.** `FirstRunChecklist`
(`src/app/shop/[shopSlug]/_components/today/FirstRunChecklist.tsx`) recomposes onto the ledger
primitives. Nothing about *when* it renders moves: the `countShopTrips === 0` condition, the demo
exclusion, the five persisted facts behind its steps, `FIRST_RUN_STEP_COUNT`
(`src/lib/onboarding.ts`), the `data-first-run-primary`/`data-first-run-next` test hooks, the
`Copyable` schedule link, and the Stripe step's plain `<a>` (OAuth redirect) all stay.

```ts
// The card of nested step boxes becomes one spine group:
// GroupLabel "First morning" over one LedgerRow per step —
//   a done step is a settled line (SettledCheck mark + its fact),
//   exactly ONE open step carries the page's one primary (its existing target),
//   the remaining open steps are quiet rows with their doors.
// Rendered by the same assembly that renders the rest of the day spine (Clearwater 6c);
// the 6c/6d SPEC sections own the precedence rules: first-run suppresses the quiet-day
// collapse, and the two compositions never co-render.
```

- The site step's door points at `/shop/[shopSlug]/dive-sites` (the empty library's two-door
  state makes the write-vs-import choice), replacing the current `/dive-sites/new` target — the
  one target change in this slice, mirrored in the shops-shelves SPEC's 9a day-zero clause.
- **The coral morning**: while the shop's live bookings count is exactly **1** and that booking's
  trip is upcoming (`liveTrip()` + the standing 1-hour buffer), the booking's spine row carries
  the coral dot and the word **Your first booking** — the condition self-expires at booking #2 or
  when the trip sails; no column, no seen-flag, no acknowledgement (H-57's grammar). A staff-
  seated walk-in counts (it is still the shop's first booking — say so in the reader's doc
  comment); imported prior visits live outside `bookings` and never false-fire. One coral element
  per page: while this renders, no other earned moment does (the coral budget, Clearwater ADR
  decision 11).
- Copy lives in `staff/shopHome.json` under `firstRun.*` (the group label joins the existing
  step keys; the first-booking word is new), in both locales.
- **Undrawn, specified**: the phone composition is the same rows at ledger scale (nothing
  collapses); a reading with one step left renders one row, not a celebration; `QuietDay` (drawn
  in the Clearwater canvas) is the *working* shop's empty day and never renders while this group
  does.
- **Tests**: the existing first-run tests retarget (step hooks and `FIRST_RUN_STEP_COUNT`
  unchanged); spine ordering — the group leads and never co-renders with the quiet-day
  composition; the coral mark over its transitions (first booking renders it; second booking or
  a sailed trip removes it; a walk-in seat fires it; imported history does not); an e2e
  extension of the onboarding spec — a fresh shop's home shows the group, adding a site settles
  one row; visual captures `FirstMorning` and `FirstBooking`.

---

## What this canvas deliberately does not draw

Marketing pages (their own voice; the **marketing-page** skill owns them), `/offline-manifest`
(staff chrome; converges only through the components it already imports), the sign-in error and
two-factor variants, the reset-password form (the invite ask's twin), and the unsubscribe
confirms (one-button `EntryShell panel={false}` asks, per the anatomy above). Each is one state
of a drawn grammar; none needs its own picture to be built correctly.
