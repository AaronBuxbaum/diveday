import { and, eq, gte, isNull } from "drizzle-orm";
import type { AppDb } from "../../db/client";
import { bookings, people, trips, waiverRecords } from "../../db/schema/index";
import { HOUR_MS } from "../../lib/clock";

/**
 * **A minor at the counter with nothing signed** — the row a refused paper
 * release is drawn on, and the one shape the demo deliberately does not have.
 *
 * The counter offers its paper-waiver control to a row whose *worst* blocker is
 * a waiver (`blockerFixFor`), and draws the guardian name and relationship
 * fields on it only for a diver the co-signature rule asks it of
 * (`PaperWaiverControl`'s `requiresGuardian`, ADR
 * 20260907-guardian-co-signature). So photographing that form — and the
 * refusal that lands under it — needs a diver who is **both**, and the seed has
 * a blocked adult (Priya Sharma, the deliberate waiver holdout) and an
 * unsigned-nothing minor (Lena Fischer, whose release is seeded complete with
 * her father's co-signature) and nobody who is both. Shot against the adult,
 * the capture would show a namesake refusal above a form with no name field in
 * it — the wrong subject, silently.
 *
 * Taking Lena's release out from under her is the same move
 * `boardADiverThenBlockThem` makes and for the same reason: it is what an
 * expiry does in production, it leaves the real readiness evaluation to decide
 * what that means, and it keeps the demo's own minor co-signed, which is the
 * lesson `seed-bookings.ts`' `DEMO_GUARDIANS` exists to teach.
 *
 * Returns the seat it made, because the notice this state exists to photograph
 * names its row by `bid` and the departure by `trip` — both random uuids, so a
 * capture cannot spell either one itself.
 */
export async function unsignTheSeededMinorsRelease(
  db: AppDb,
  shopId: string,
  now: Date,
): Promise<{ bookingId: string; tripId: string } | null> {
  // By name, for the reason `boardADiverThenBlockThem` spells out at length:
  // `bookings.id` is `defaultRandom()` and re-seeded before every test, so
  // anything ordered by it photographs a different diver each run.
  const [seat] = await db
    .select({ id: bookings.id, tripId: bookings.tripId, personId: bookings.personId })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(people.fullName, "Lena Fischer"),
        eq(bookings.status, "booked"),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, new Date(now.getTime() - HOUR_MS)),
      ),
    )
    .orderBy(trips.startsAt)
    .limit(1);
  if (!seat) return null;
  // Every live record for the *person*, not the one booking: a signature is
  // effective for the diver across every trip they are on
  // (`effectiveWaiverForBooking`), so superseding one seat's row would leave
  // the other seats' rows clearing this one.
  await db
    .update(waiverRecords)
    .set({ supersededAt: now })
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.personId, seat.personId),
        isNull(waiverRecords.supersededAt),
      ),
    );
  return { bookingId: seat.id, tripId: seat.tripId };
}
