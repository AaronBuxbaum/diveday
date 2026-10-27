# 20261012-course-forms-on-charters-and-counter — Training marks and a phone hand-off

- **Status:** Accepted for decision 1 (2026-10-17); decision 2 amended and accepted (Aaron, 2026-10-22)
- **Date:** 2026-10-12

## Context

Course forms were asked only on course sessions. A training dive on a regular charter could miss
those forms, and a group at the counter needed a way to sign one student at a time (#2275).

## Decision

**1. A training dive on a charter is an explicit staff mark, never an inference.**

- `bookings.training_enrollment_booking_id` names the diver's live course seat, with who marked it
  and when. Owner, manager or instructor (`canConfigureTrips`) set it from the Divers tab. It must
  be a confirmed diving enrollment at this shop, for the same diver, on a session that has not
  ended and ends no earlier than the charter leaves. One enrollment per charter seat.
- `resolveTrainingMarks` is shared by readers and writers. A valid marked seat asks the enrollment's
  held-at-start forms and uses its records. An invalid mark stays `training_mark_invalid` until
  cleared, rather than making the forms disappear. Mark and clear refresh the manifest.
- Clearing a mark with forms owed, or an invalid mark, requires `canManageWaiverTemplates` or the
  enrollment's instructor, rostered by another. The manifest names who cleared it.
- **Amended 2026-10-17 (#2731, Aaron):** A standing mark may lower the required level to the
  course minimum only when the course certifies it; never for an intro session. Its instructor
  must be aboard, and the seat must fit that instructor's ratio across the departure. No known
  ratio means no lowering.

**2. Counter hand-off (amended 2026-10-22, Aaron).** Students sign on their own phones; staff
show one student's forms-only QR at a time. The staff-signed-in device is not handed over. The
QR carries that seat's existing live, reusable `course_forms` capability, with its usual expiry
and revocation rules. Scanning is not signing or boarding clearance. A student and any required
guardian use the existing signing flow.

## Alternatives considered

- Infer training from an enrollment: rejected because a fun dive is not necessarily training.
- Copy forms to the charter: rejected because signatures belong to the enrollment.
- Several enrollments per seat: deferred until shops need one dive to count toward multiple courses.
- A kiosk on a staff session: rejected because its holder could reach staff records. The original
  proposed single-use counter-device capability was superseded by Aaron's phone-only decision.

## Consequences

The training mark adds five booking columns and one resolver; the QR hand-off reuses an existing
capability and adds no dependency. Revisit if shops need multiple courses on a dive or a separate,
securely managed signing device.
