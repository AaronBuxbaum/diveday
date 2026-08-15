# 20260815-course-roster-and-material-tracking — Add a per-enrollment roster row for material/e-learning status, staff-recorded only

- **Status:** Proposed
- **Date:** 2026-08-15

**Proposed, deliberately.** A product-owner decision, not an engineering one — it adds a new staff
surface and touches every locale bundle. This record exists so implementation starts from a scoped
shape rather than expanding to fill the whole "course/student management" gap in one pass.

## Context

A real DiveShop360-shop inquiry (2026-08-15) described courses as tying customers, instructors, and
resources together, appearing on the site and the calendar, differing by course (kids, private,
multi-day, one-day), tying back to the training agency for verbiage, and automatically assigning
learning materials, waivers, and reminders. Checking each claim against the running code:

| Claim | Status |
| --- | --- |
| Ties customers, appears on site, ties to calendar | ✅ built — a course session already *is* a trip (`trips.course_id`), so scheduling, the public page, and calendar-sync are the same machinery every trip uses |
| Ties instructors | ✅ built — `trip_assignments.tripRole` (`instructor`/`divemaster`/`captain`/`crew`) |
| Some allow kids | ✅ built — `courses.minimumAge` |
| Multiple days / one day | ✅ built — `courses.scheduleDays` (up to `MAX_SCHEDULE_DAYS`) |
| Ties back to the agency for verbiage | ✅ built — `courses.agency`, `course-templates.ts`'s published, agency-sourced content a shop copies |
| Sends the correct waivers | ✅ built, but not "correct" per-course — `seat-diver.ts`'s waiver-on-join fires the shop's one waiver automatically on every enrollment; there is no per-course waiver variant (see Context below) |
| Sends reminders | ✅ built — the scheduled 7-day/24-hour cadence applies to every trip, course sessions included |
| Private courses | ⚠️ partial — depends on `trips.visibility` from [20260804-boat-resource-model](20260804-boat-resource-model.md), which is itself Proposed and unaccepted |
| Resources | ⚠️ partial — a course session's implicit resource is its trip's site/schedule; no distinct classroom/pool-time entity exists |
| **Automatically assigns learning materials** | ❌ **missing** — no roster, progress, or e-learning status field exists anywhere in the schema |

The last row is the real gap, and it's already named independently in
[competitive-analysis.md](../../product/assessments/competitive-analysis.md#critical-vs-differentiator):
*"Course/student management ⚠️ Sessions + prerequisites; no rosters/progress/eLearning."*

Constraints a lower-context agent must not miss:

- **H-10 is Dropped**: no agency exposes a usable C-card or e-learning provisioning API
  ([20260721-manual-certification](20260721-manual-certification.md)). "Automatically assigns
  learning materials" can only ever mean *DiveDay tracks that a human assigned or issued
  something* — never a live agency integration. Overstating this in the UI would misrepresent a
  capability that structurally cannot exist yet.
- **A shop has exactly one waiver, versioned shop-wide** (`waiver_templates`'s unique index,
  CR-015) — a distinct per-course waiver is a separate, bigger decision this ADR does not make.
- This is bookkeeping, not a safety gate: nothing here may touch admission
  (`src/lib/trip-admission.ts`), readiness (`src/lib/readiness.ts`), or the manifest/roll-call
  spine, per AGENTS.md's safety-critical rule.

## Decision

**Add `course_enrollment_progress`, one row per booking whose trip has a `course_id`, staff-set and
free-text where it touches an agency-issued code — never agency-verified.**

### Schema (expand-only)

```
course_enrollment_progress
  id                uuid PK
  booking_id        uuid FK → bookings, not null, unique
  elearning_status  elearning_status not null default 'not_applicable'
                       ('not_applicable' | 'not_started' | 'assigned' | 'completed')
  elearning_code    text                    -- the agency-issued code a staff member pastes in;
                                             -- never fetched from an API (H-10)
  skills_note       text                    -- free-text staff note, not a structured checklist
  updated_by        uuid FK → people
  updated_at        timestamptz not null default now()
```

### Surfaces

- **A roster tab** on the course session's trip page, alongside the existing manifest/prep tabs:
  every enrolled diver, their `elearning_status`, and a bulk "mark assigned" action for the whole
  session (the common case — a shop assigns e-learning to everyone in a cohort at once).
- **A diver-visible line** on `/ready/[token]` when `elearning_status` isn't `not_applicable` —
  reuses the existing capability-URL pattern (`bearer-tokens.ts`); no new token type.
- **Explicitly not decided here, flagged rather than solved:**
  - *Private courses* — depends entirely on the boat-resource-model ADR's `trips.visibility`
    landing first; this ADR does not duplicate that decision or invent a parallel mechanism.
  - *Resources beyond a boat* — no classroom/pool-time entity is proposed. A course session's
    implicit resource stays its trip's own site/schedule until a real operator demonstrates that's
    insufficient.
  - *A per-course waiver variant* (e.g., a minor consent form, agency-specific liability text) —
    stays out of scope; solving it means deciding whether to break the one-waiver-per-shop
    invariant, which is a bigger, separate call.
  - *A structured, per-skill sign-off checklist* — real value, materially bigger scope (agency
    curriculum data entry, per-dive sign-off UI) than what closes the identified gap. Nothing in
    the inquiry or the roadmap asked for skill-level granularity, only "assigns... materials."

## Alternatives considered

- **A structured per-skill checklist instead of a status field** — rejected for this slice; bigger
  scope than the gap actually named, and no demonstrated demand for that granularity yet.
- **Attempt a live PADI/SSI provisioning integration** — rejected outright; H-10 already
  established no agency exposes one, so there is nothing to integrate against, only a status a
  human records.
- **Model progress directly on the `bookings` row** rather than a new table — rejected; `bookings`
  already carries person/trip/status semantics load-bearing for the safety spine, and bolting
  course-specific optional fields onto it risks the same column sprawl `order_line_items.kind`
  exists to avoid on the orders side.
- **A second waiver template per course, to fully answer "sends the correct waivers"** — rejected
  as out of scope for this ADR; it would reverse a documented invariant (CR-015) and deserves its
  own decision, not a side effect of a roster feature.

## Consequences

- **Easy:** purely additive — one small table, no touch to admission, readiness, or manifest; the
  UI is honest by construction (a free-text code field cannot imply agency verification the way a
  green checkmark might).
- **Hard / new:** another staff surface and its i18n keys in both locales; a bulk-action UI for a
  large cohort.
- **Commits us to:** never implying automated agency verification in this surface's copy — the same
  honesty the existing `agency` FAQ answer already states for certification.
- **Escape hatch:** if unused, the cost of leaving is one dormant table and an empty roster tab;
  removing the diver-facing line is a one-line revert. Widening to a full skill checklist later is
  additive (a new table referencing this one), not a rewrite.
- **On acceptance (not before):** move the "no rosters/progress/eLearning" line in
  `competitive-analysis.md`'s critical-vs-differentiator table from a gap to closed.
