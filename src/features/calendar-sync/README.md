# calendar-sync

Staff subscribe to their DiveDay departures from Google Calendar, Apple Calendar, or Outlook. The
subscription is a read-only iCalendar feed at a token-bearing URL; the calendar client polls it.

Decision record: [20260730-calendar-feed-subscriptions](../../../docs/architecture/decisions/20260730-calendar-feed-subscriptions.md).
Module shape: [20260730-feature-module-contracts](../../../docs/architecture/decisions/20260730-feature-module-contracts.md).

## Owns

- The `calendar_feeds` table's lifecycle — issue, rotate, verify, revoke, touch.
- Which departures a feed publishes, and the iCalendar document it renders to.
- The subscribe URL shape (`/calendar/<token>.ics`, and its `webcal:` form).

## Does not own

- The `calendar_feeds` table *definition*, which lives in `src/db/schema.ts` with every other
  table — one schema file stays the source of truth (ADR-0005).
- The iCalendar primitives (`src/lib/trip-calendar.ts`), shared with the diver's one-off `.ics`
  download.
- Route wiring and staff UI, which live under `src/app/` and import this module's `index.ts`.

## Public surface

Everything importable from outside is re-exported by `./index.ts`. Deep imports
(`@/features/calendar-sync/feed-store`) are a `pnpm check:architecture` failure — the index is the
contract, so an internal file can be split or renamed without a cross-repo edit.

## May import

`@/lib/**`, `@/db/**`, and other feature modules' `index.ts`. Never `@/app/**` — the dependency
direction is one-way, and `check:architecture` enforces it.

## Invariants

- **Authorization is re-derived on every fetch**, never trusted from issue time. Staff leave; a
  feed must stop updating when their roles go away, without anyone remembering to revoke it. That
  includes a *suspended* account: disabling sign-in deliberately leaves `person_roles` intact, so a
  roles-only gate would keep serving someone who was just locked out.
- **The feed has no expiry** — one that lapsed would silently stop updating a captain's calendar,
  which is worse than a long-lived credential. Rotation is the remedy, so issuing and rotating are
  the same operation.
- **Only the token hash is stored.** The raw token exists solely in the response that minted it,
  which is why the settings panel can show a URL once and thereafter only offers to rotate.
- **`shop_trips` scope is owner/manager only**; `assignments` is any staff role.
- **Cancelled trips are dropped, not published as cancelled.** `METHOD:PUBLISH` has no reliable
  cancellation verb across clients, so removing the UID is what removes the event.
- **UIDs derive from trip identity, never contents** — a UID that moved with the title would
  duplicate every edited departure in the subscriber's calendar.
- **No diver ever appears in a feed.** `listFeedTrips` reads trips, courses, sites, and crew, and
  never touches `bookings`. A feed URL gets pasted into Google's servers and synced to a phone; the
  roster — and one join away its medical and waiver state — has no business there. There is a test
  asserting it.
- **Feed copy is translated** like any other user-facing copy: `feedDocument` takes its words as a
  `FeedLabels` argument rather than embedding English.
