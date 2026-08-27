import { and, eq, inArray, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { SupportNeeds } from "@/lib/support-needs";
import type { AppDb, DbExecutor } from "./client";
import { bookings, diveSupportNeeds, people } from "./schema";

/**
 * Reads and writes for the accessible-dive support-needs record (ADR
 * 20260827-support-needs-are-a-record-about-the-dive).
 *
 * Every function here takes a `shopId` and every query filters on it. That is
 * not ceremony: `people` is shop-scoped, the diver writes through a bearer token
 * on `/ready/[token]`, and the whole point of the record is that a *returning*
 * diver is not asked twice — so the tempting shortcut, a profile keyed on the
 * person alone that follows them between shops, is exactly the tenant-isolation
 * defect to avoid on health-adjacent data. `saveSupportNeeds` proves the person
 * belongs to the shop before it writes anything, the same way `saveRentalFit`
 * does beside it.
 */

/** What a caller may state. Absent fields are left alone; `null` clears. */
export type SupportNeedsInput = {
  shopId: string;
  personId: string;
  supportDiversNeeded: number | null;
  needsBoardingAssistance: boolean;
  needsWaterEntryLift: boolean;
  briefingInSign: boolean;
  briefingInWriting: boolean;
  briefingBySignals: boolean;
  equipmentAdaptation: string | null;
  divesWithName: string | null;
};

function optional(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

const COLUMNS = {
  supportDiversNeeded: diveSupportNeeds.supportDiversNeeded,
  needsBoardingAssistance: diveSupportNeeds.needsBoardingAssistance,
  needsWaterEntryLift: diveSupportNeeds.needsWaterEntryLift,
  briefingInSign: diveSupportNeeds.briefingInSign,
  briefingInWriting: diveSupportNeeds.briefingInWriting,
  briefingBySignals: diveSupportNeeds.briefingBySignals,
  equipmentAdaptation: diveSupportNeeds.equipmentAdaptation,
  divesWithName: diveSupportNeeds.divesWithName,
} as const;

/**
 * State (or restate) what this diver's dive needs.
 *
 * One row per person per shop, upserted — a living preference like a rental fit,
 * not evidence, so a diver who arranges something different next season simply
 * says so. The whole record is written at once because the diver answers it as
 * one form; there is no half-write to guard against the way `saveRentalFitNote`
 * guards the note against a size edit.
 *
 * Returns `null` when the person is not this shop's, which is what makes a
 * copied `/ready` URL unable to write into a neighbouring tenant.
 */
export async function saveSupportNeeds(
  db: AppDb,
  input: SupportNeedsInput,
): Promise<typeof diveSupportNeeds.$inferSelect | null> {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .limit(1);
  if (!person) return null;

  const values = {
    supportDiversNeeded: input.supportDiversNeeded,
    needsBoardingAssistance: input.needsBoardingAssistance,
    needsWaterEntryLift: input.needsWaterEntryLift,
    briefingInSign: input.briefingInSign,
    briefingInWriting: input.briefingInWriting,
    briefingBySignals: input.briefingBySignals,
    equipmentAdaptation: optional(input.equipmentAdaptation),
    divesWithName: optional(input.divesWithName),
    // The diver answered, whatever they answered. An all-false record is a real
    // statement and a crew reading it wants to know somebody was asked — see
    // the column's own note in schema.ts.
    statedAt: nowDate(),
    updatedAt: nowDate(),
  };
  const [row] = await db
    .insert(diveSupportNeeds)
    .values({ shopId: input.shopId, personId: input.personId, ...values })
    .onConflictDoUpdate({
      target: [diveSupportNeeds.shopId, diveSupportNeeds.personId],
      set: values,
    })
    .returning();
  return row ?? null;
}

/** One diver's record, or null when they have never been asked. */
export async function getSupportNeeds(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<SupportNeeds | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(diveSupportNeeds)
    .where(and(eq(diveSupportNeeds.shopId, shopId), eq(diveSupportNeeds.personId, personId)))
    .limit(1);
  return row ?? null;
}

/**
 * The records for a set of people, keyed by person id.
 *
 * How the prep list and the manifest read a whole roster at once. An empty
 * `personIds` short-circuits rather than issuing `in ()`, which Postgres accepts
 * but which is a query nobody meant to run.
 */
export async function supportNeedsByPerson(
  db: DbExecutor,
  shopId: string,
  personIds: readonly string[],
): Promise<Map<string, SupportNeeds>> {
  if (personIds.length === 0) return new Map();
  const rows = await db
    .select({ personId: diveSupportNeeds.personId, ...COLUMNS })
    .from(diveSupportNeeds)
    .where(
      and(
        eq(diveSupportNeeds.shopId, shopId),
        inArray(diveSupportNeeds.personId, [...new Set(personIds)]),
      ),
    );
  return new Map(rows.map(({ personId, ...needs }) => [personId, needs]));
}

/**
 * The records for one departure's active roster, keyed by person id.
 *
 * Joined from `bookings` rather than read for the whole shop, the same shape
 * `rentalFitByBooking` uses beside it: a manifest wants one trip's answers and
 * a shop-wide read would grow with the shop to deliver the same handful of rows.
 * Keyed by **person**, not booking, because the record is on the person — one
 * diver on two of the day's departures has one record, not two.
 */
export async function supportNeedsByTripPerson(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<Map<string, SupportNeeds>> {
  const rows = await db
    .select({ personId: diveSupportNeeds.personId, ...COLUMNS })
    .from(bookings)
    .innerJoin(
      diveSupportNeeds,
      and(
        eq(diveSupportNeeds.personId, bookings.personId),
        eq(diveSupportNeeds.shopId, bookings.shopId),
      ),
    )
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
      ),
    );
  return new Map(rows.map(({ personId, ...needs }) => [personId, needs]));
}
