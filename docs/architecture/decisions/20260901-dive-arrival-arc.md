# 20260901-dive-arrival-arc — Build the dive arrival arc as shared public facts

- **Status:** Accepted — built 2026-09-01
- **Date:** 2026-09-01
- **Scope:** Public trip, `/ready`, and Today

## Context

D03, D09, D10, D13, D16, and D29 are one arrival problem, not six unrelated features: a diver
needs a reliable place to go, a current account of plan changes, a party status, and a human hand-off
when the morning goes differently. The existing trip, readiness, and Today surfaces already own
those moments, so adding a parallel dashboard or notification channel would split the story. The
new records must remain tenant-scoped, public-safe, localized, and bounded to the departure that
created them.

## Decision

Build the arc across the existing surfaces:

- A trip owns optional shop-authored arrival guidance and a stored landmark photo. The shared
  arrival card appears on the public trip and `/ready`; its opt-in HTML download contains only the
  shop name, public contact, departure time, meeting place, and public URL.
- A trip owns an append-only change ledger for meeting-point and crew-conditions snapshots. It
  records the broad source and time, renders the resulting public fact chronologically, and never
  exposes a staff name, waiver, readiness, medical, or capability value.
- A party's Ready view shows claimed seats plus waiver completion and a copyable reminder link.
  This is a narrow group-status line; it never becomes a readiness, certification, medical, or
  notification-management surface.
- A booking can carry one controlled day-of help request. `/ready` writes `carry_gear`,
  `first_timer`, or `find_group`; Today shows it as a neutral departure row; staff acknowledge it
  and then mark it handled. The request is not active after the trip ends, and a handled request
  cannot be reopened through the diver form.

All writes are authorized by the existing readiness or staff session boundary and all readers filter
by shop, booking/trip ownership, scheduled status, and the relevant departure time. Copy stays in
the English and Spanish bundles; domain and persistence layers return codes or typed state rather
than prose.

## Alternatives considered

- **Create a separate arrival dashboard:** rejected because it would make a diver and staffer
  leave the surfaces that already own the trip, readiness, and day-of decisions.
- **Send a notification for every change or help request:** rejected because the useful promise is
  visible state, not a notification spray or a new delivery failure mode.
- **Store free-text support notes or medical capabilities:** rejected because the first slice needs
  three small operational choices and must not classify a person or leak private data.
- **Expose the actor's name in the change ledger:** rejected because role-level provenance answers
  who supplied the fact without publishing staff identity into a public page.

## Consequences

Divers get one reusable arrival reading on both pre-booking and day-of surfaces, and staff get one
settleable row in the Today spine. The app carries a small amount of durable history and an arrival
photo lifecycle, so migrations, demo reset/delete order, localization, and media cleanup must stay
in sync; the generated Drizzle migration and focused tests are part of this change. If shops later
need richer accessibility arrangements, free-text coordination, or outbound delivery, revisit this
decision with a separate privacy and domain review rather than expanding these records in place.
