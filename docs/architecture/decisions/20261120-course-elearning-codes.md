# 20261120-course-elearning-codes — The shop's own ledger of eLearning codes, one per student

- **Status:** Accepted
- **Date:** 2026-11-20

## Context

A course-led shop buys eLearning codes from its agency in bulk, hands one to each student, and kept
that list in a spreadsheet (issues #4321 and #4632). DiveDay already bills the eLearning price and
sends the learning materials ([20261008-course-learning-materials](20261008-course-learning-materials.md)),
which deferred a code per student until a shop asked. No agency issues codes through an API
(H-20261007-request-supported-c-card), so this is only the shop's record.

## Decision

1. **A table of codes per course, `course_elearning_codes`.** One row per code: shop, course, the
   code as pasted, and, once handed out, the booking holding it, when, and which staffer (null when
   the confirmation did it). `(shop, course, code)` is unique, so pasting an order twice adds nothing;
   a booking holds at most one code, by a partial unique index. `assigned_at` and `booking_id` are
   paired by a check.
2. **Staff paste codes into the course editor.** A box in the editor's one Save takes one code per
   line (or separated by commas, semicolons or spaces), always empty on arrival: a stored code is
   counted, never drawn back into the form. A paste over 500 codes, or with a code over 64
   characters, is refused whole.
3. **A code is handed out two ways.** By hand: the roster's "Give a code" hands the oldest unused
   code to that student, "Take back" returns it to stock. Automatically: when a booking confirmation
   goes out for a course whose eLearning price is above zero, the seat takes the next code, so the
   student has it with everything else. A course with no eLearning price never hands one out by
   itself. A seat keeps its code, so a resend repeats it.
4. **Where a code shows.** The student's confirmation email and their `/ready` page (with the
   course materials), the staff roster beside the student's name, and the shop export. Never on a
   public page, never in a log, never in a reminder text.
5. **It informs, never gates.** An empty stock refuses nothing but the handing-out, and says so. A
   handed-out code is not evidence the theory is done; the materials tick stays the shop's word.
6. **Erasure and merge.** The code belongs to the shop, not the person: an erased student's booking
   keeps the code as spent. `assigned_by_person_id` is an actor column, left on merge.

## Alternatives considered

- **A code column on `bookings`.** Rejected: the stock exists before any student, and its count is the point.
- **Assigning when payment settles.** Rejected: the confirmation already runs after the seat is taken, and hooking each payment path adds writers for the same effect.
- **Encrypting codes at rest.** Rejected: staff read them back on the roster, and the experience-over-hardening rule applies.

## Consequences

- **Easy:** one additive table; the export carries the ledger.
- **Commits us to:** copy that never implies a code means finished theory.
- **Not built:** removing an unused code, and any agency integration.
