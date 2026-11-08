import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { liveTrip, seatNotCancelled } from "@/db/trips";
import type { ReferralPaper } from "@/features/referral-student";
import type { AppDb } from "../../db/client";
import { bookings, trips } from "../../db/schema/index";

import { nowDate } from "../../lib/clock";

export type ReferralOutcome =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_a_course_session" | "not_referred" };

/** The seat, read under its shop, on a live departure, still held. */
async function readSeat(db: AppDb, shopId: string, bookingId: string) {
  const [seat] = await db
    .select({ id: bookings.id, courseId: trips.courseId, referredInAt: bookings.referredInAt })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.shopId, shopId),
        eq(trips.shopId, shopId),
        seatNotCancelled,
        liveTrip(),
      ),
    )
    .limit(1);
  return seat ?? null;
}

/**
 * **Mark a course seat as a referral student, or take it back** (loop 5, row
 * 10). The same boundary as the materials tick: a departure with no course is
 * `not_a_course_session`. A second mark keeps the first stamp; taking it back
 * clears both papers with it, because a paper is only collected for a
 * referral (`bookings_referral_attributed`). Tenant-scoped on read and write.
 */
export async function markReferralStudent(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    staffPersonId: string;
    referred: boolean;
    now?: Date;
  },
): Promise<ReferralOutcome> {
  const seat = await readSeat(db, input.shopId, input.bookingId);
  if (!seat) return { ok: false, reason: "not_found" };
  if (!seat.courseId) return { ok: false, reason: "not_a_course_session" };
  const scope = and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId));
  if (input.referred) {
    await db
      .update(bookings)
      .set({ referredInAt: input.now ?? nowDate(), referredInByPersonId: input.staffPersonId })
      .where(and(scope, isNull(bookings.referredInAt)));
    return { ok: true };
  }
  await db
    .update(bookings)
    .set({
      referredInAt: null,
      referredInByPersonId: null,
      referralFormAt: null,
      referralFormByPersonId: null,
      referralRecordAt: null,
      referralRecordByPersonId: null,
    })
    .where(scope);
  return { ok: true };
}

/**
 * **Tick one paper collected, or take the tick back** (loop 5, row 10): the
 * referral form or the eLearning record, each stamped with who collected it.
 * Refused for a seat nobody marked as a referral; a repeat tick keeps the
 * first stamp. The write's WHERE says the seat is still a referral, so a mark
 * taken back in another tab is never contradicted.
 */
export async function recordReferralPaper(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    staffPersonId: string;
    paper: ReferralPaper;
    collected: boolean;
    now?: Date;
  },
): Promise<ReferralOutcome> {
  const seat = await readSeat(db, input.shopId, input.bookingId);
  if (!seat) return { ok: false, reason: "not_found" };
  if (!seat.referredInAt) return { ok: false, reason: "not_referred" };
  const at = input.paper === "form" ? bookings.referralFormAt : bookings.referralRecordAt;
  const scope = and(
    eq(bookings.id, input.bookingId),
    eq(bookings.shopId, input.shopId),
    isNotNull(bookings.referredInAt),
  );
  const stamp = input.collected
    ? { at: input.now ?? nowDate(), by: input.staffPersonId }
    : { at: null, by: null };
  const set =
    input.paper === "form"
      ? { referralFormAt: stamp.at, referralFormByPersonId: stamp.by }
      : { referralRecordAt: stamp.at, referralRecordByPersonId: stamp.by };
  const rows = await db
    .update(bookings)
    .set(set)
    .where(input.collected ? and(scope, isNull(at)) : scope)
    .returning({ id: bookings.id });
  if (rows.length === 0 && !input.collected) return { ok: false, reason: "not_referred" };
  return { ok: true };
}
