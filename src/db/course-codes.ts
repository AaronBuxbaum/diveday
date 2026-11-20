import { and, asc, count, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { parseElearningCodes } from "@/lib/course-codes";
import { nowDate } from "../lib/clock";
import type { DbExecutor } from "./client";
import { bookings, courseElearningCodes, courses, trips } from "./schema/index";
import { liveTrip, seatNotCancelled } from "./trips";

export type AddCodesOutcome =
  | { ok: true; added: number; skipped: number }
  | { ok: false; reason: "too_many" | "too_long" };

export type AssignCodeOutcome =
  | { ok: true; code: string; alreadyHeld: boolean }
  | { ok: false; reason: "not_found" | "not_a_course_session" | "none_left" };

/**
 * **Add what a shop pasted to a course's stock of eLearning codes** (ADR
 * 20261120-course-elearning-codes). A code the course already holds is skipped, not an error, so
 * pasting the same order twice is harmless. Scoped by `shopId` on the course. The codes are
 * secrets of the shop: nothing here logs one.
 */
export async function recordCourseCodes(
  db: DbExecutor,
  input: { shopId: string; courseId: string; text: string },
): Promise<AddCodesOutcome> {
  const parsed = parseElearningCodes(input.text);
  if (!parsed.ok) return parsed;
  if (parsed.codes.length === 0) return { ok: true, added: 0, skipped: 0 };
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.id, input.courseId), eq(courses.shopId, input.shopId)))
    .limit(1);
  if (!course) return { ok: true, added: 0, skipped: 0 };
  const inserted = await db
    .insert(courseElearningCodes)
    .values(parsed.codes.map((code) => ({ shopId: input.shopId, courseId: input.courseId, code })))
    .onConflictDoNothing()
    .returning({ id: courseElearningCodes.id });
  return {
    ok: true,
    added: inserted.length,
    skipped: parsed.codes.length - inserted.length + parsed.repeated,
  };
}

/** How many of a course's codes are still in stock, and how many students hold one. */
export async function courseCodeCounts(
  db: DbExecutor,
  input: { shopId: string; courseId: string },
): Promise<{ left: number; handedOut: number }> {
  const rows = await db
    .select({ held: isNotNull(courseElearningCodes.bookingId), n: count() })
    .from(courseElearningCodes)
    .where(
      and(
        eq(courseElearningCodes.shopId, input.shopId),
        eq(courseElearningCodes.courseId, input.courseId),
        isNull(courseElearningCodes.deletedAt),
      ),
    )
    .groupBy(isNotNull(courseElearningCodes.bookingId));
  return {
    left: rows.find((row) => !row.held)?.n ?? 0,
    handedOut: rows.find((row) => row.held)?.n ?? 0,
  };
}

/** The code each of these seats holds, by booking id. Seats with none are absent. */
export async function courseCodesByBooking(
  db: DbExecutor,
  input: { shopId: string; bookingIds: readonly string[] },
): Promise<Map<string, string>> {
  if (input.bookingIds.length === 0) return new Map();
  const rows = await db
    .select({ bookingId: courseElearningCodes.bookingId, code: courseElearningCodes.code })
    .from(courseElearningCodes)
    .where(
      and(
        eq(courseElearningCodes.shopId, input.shopId),
        inArray(courseElearningCodes.bookingId, [...input.bookingIds]),
        isNull(courseElearningCodes.deletedAt),
      ),
    );
  const held = new Map<string, string>();
  for (const row of rows) if (row.bookingId) held.set(row.bookingId, row.code);
  return held;
}

/**
 * **Hand the oldest unused code to a student's seat.** Idempotent: a seat that already holds one
 * keeps it. `staffPersonId` is the staffer who pressed the button, null when the confirmation
 * did it. Refuses a seat whose departure teaches no course, and says `none_left` when the stock is
 * empty, which informs and never blocks the seat. Scoped by `shopId` on the seat and the code.
 */
export async function issueCourseCode(
  db: DbExecutor,
  input: { shopId: string; bookingId: string; staffPersonId: string | null },
): Promise<AssignCodeOutcome> {
  const [seat] = await db
    .select({ courseId: trips.courseId })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.shopId, input.shopId),
        seatNotCancelled,
        liveTrip(),
      ),
    )
    .limit(1);
  if (!seat) return { ok: false, reason: "not_found" };
  if (!seat.courseId) return { ok: false, reason: "not_a_course_session" };
  const held = await courseCodesByBooking(db, {
    shopId: input.shopId,
    bookingIds: [input.bookingId],
  });
  const existing = held.get(input.bookingId);
  if (existing) return { ok: true, code: existing, alreadyHeld: true };

  // Another desk may take the same code between the read and the write; the guarded update then
  // matches nothing and the loop takes the next one.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [next] = await db
      .select({ id: courseElearningCodes.id })
      .from(courseElearningCodes)
      .where(
        and(
          eq(courseElearningCodes.shopId, input.shopId),
          eq(courseElearningCodes.courseId, seat.courseId),
          isNull(courseElearningCodes.bookingId),
          isNull(courseElearningCodes.deletedAt),
        ),
      )
      .orderBy(asc(courseElearningCodes.createdAt), asc(courseElearningCodes.code))
      .limit(1);
    if (!next) return { ok: false, reason: "none_left" };
    const [taken] = await db
      .update(courseElearningCodes)
      .set({
        bookingId: input.bookingId,
        assignedAt: nowDate(),
        assignedByPersonId: input.staffPersonId,
      })
      .where(
        and(
          eq(courseElearningCodes.id, next.id),
          isNull(courseElearningCodes.bookingId),
          isNull(courseElearningCodes.deletedAt),
        ),
      )
      .returning({ code: courseElearningCodes.code })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) return [];
        throw error;
      });
    if (taken) return { ok: true, code: taken.code, alreadyHeld: false };
    const again = await courseCodesByBooking(db, {
      shopId: input.shopId,
      bookingIds: [input.bookingId],
    });
    const raced = again.get(input.bookingId);
    if (raced) return { ok: true, code: raced, alreadyHeld: true };
  }
  return { ok: false, reason: "none_left" };
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } } | null) ?? {};
  return code.code === "23505" || code.cause?.code === "23505";
}

/**
 * **Remove the codes of a course nobody holds** (a mistaken paste). A handed-out code stays: a
 * student has it. Soft: the row keeps `deleted_at`, and the same text can be pasted again.
 */
export async function cancelUnusedCourseCodes(
  db: DbExecutor,
  input: { shopId: string; courseId: string },
): Promise<{ removed: number }> {
  const rows = await db
    .update(courseElearningCodes)
    .set({ deletedAt: nowDate() })
    .where(
      and(
        eq(courseElearningCodes.shopId, input.shopId),
        eq(courseElearningCodes.courseId, input.courseId),
        isNull(courseElearningCodes.bookingId),
        isNull(courseElearningCodes.deletedAt),
      ),
    )
    .returning({ id: courseElearningCodes.id });
  return { removed: rows.length };
}

/** Take a student's code back into the course's stock (a wrong student, or a student who dropped). */
export async function releaseCourseCode(
  db: DbExecutor,
  input: { shopId: string; bookingId: string },
): Promise<{ released: boolean }> {
  const rows = await db
    .update(courseElearningCodes)
    .set({ bookingId: null, assignedAt: null, assignedByPersonId: null })
    .where(
      and(
        eq(courseElearningCodes.shopId, input.shopId),
        eq(courseElearningCodes.bookingId, input.bookingId),
      ),
    )
    .returning({ id: courseElearningCodes.id });
  return { released: rows.length > 0 };
}

/**
 * **The code a booking confirmation prints for one seat.** The code the seat already holds; and
 * for a course that sells eLearning (`e_learning_price_cents` above zero), the next one in stock
 * when the seat holds none yet, so a student is told the moment they are told everything else. A
 * course with no eLearning price never hands one out by itself: a staffer does, from the roster.
 * Null when there is none to show (no stock left included).
 */
export async function codeForConfirmation(
  db: DbExecutor,
  input: { shopId: string; bookingId: string; sellsElearning: boolean },
): Promise<string | null> {
  const held = await courseCodesByBooking(db, {
    shopId: input.shopId,
    bookingIds: [input.bookingId],
  });
  const existing = held.get(input.bookingId);
  if (existing) return existing;
  if (!input.sellsElearning) return null;
  const issued = await issueCourseCode(db, {
    shopId: input.shopId,
    bookingId: input.bookingId,
    staffPersonId: null,
  });
  return issued.ok ? issued.code : null;
}
