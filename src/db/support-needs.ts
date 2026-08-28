import { and, eq, inArray, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { hasSupportNeeds, type SupportDiverProvider, type SupportNeeds } from "@/lib/support-needs";
import type { AppDb, DbExecutor } from "./client";
import { activityEvents, bookings, diveSupportNeeds, people } from "./schema";

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

/**
 * Who is stating the record, which the trail below records and nothing else
 * reads.
 *
 * A diver states their own on `/ready/[token]`, where the actor *is* the
 * subject; staff state one taken over the phone. The distinction is the whole
 * point of the trail: a readiness link gets forwarded -- a group organiser's
 * address on five seats, a hotel front desk's shared inbox -- so "did this
 * come from the diver's own link or from the shop" is the question somebody
 * will eventually need answered (issue #1070).
 */
export type SupportNeedsActor = { kind: "diver" } | { kind: "staff"; personId: string };

/** What a caller may state. Absent fields are left alone; `null` clears. */
export type SupportNeedsInput = {
  shopId: string;
  personId: string;
  actor: SupportNeedsActor;
  supportDiversNeeded: number | null;
  supportDiversProvidedBy: SupportDiverProvider | null;
  needsBoardingAssistance: boolean;
  needsWaterLift: boolean;
  briefingInSign: boolean;
  briefingInWriting: boolean;
  briefingAloud: boolean;
  briefingBySignals: boolean;
  equipmentAdaptation: string | null;
  divesWithName: string | null;
};

function optional(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/**
 * The eight stated facts plus `stated_at`, and nothing else.
 *
 * A projection rather than `.select()`, for the reason `toDiverRentalFit` is one:
 * the row also carries `id`, `shop_id`, `person_id` and two housekeeping
 * timestamps, and a reader that hands the whole row to a component is one
 * `"use client"` away from shipping internal ids into a browser payload with
 * nothing failing (`security-reviewer`, 2026-08-27). **Every** read of this
 * table goes through here, including the joins in other modules.
 */
export const SUPPORT_NEEDS_COLUMNS = {
  supportDiversNeeded: diveSupportNeeds.supportDiversNeeded,
  supportDiversProvidedBy: diveSupportNeeds.supportDiversProvidedBy,
  needsBoardingAssistance: diveSupportNeeds.needsBoardingAssistance,
  needsWaterLift: diveSupportNeeds.needsWaterLift,
  briefingInSign: diveSupportNeeds.briefingInSign,
  briefingInWriting: diveSupportNeeds.briefingInWriting,
  briefingAloud: diveSupportNeeds.briefingAloud,
  briefingBySignals: diveSupportNeeds.briefingBySignals,
  equipmentAdaptation: diveSupportNeeds.equipmentAdaptation,
  divesWithName: diveSupportNeeds.divesWithName,
  statedAt: diveSupportNeeds.statedAt,
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

  const count = input.supportDiversNeeded;
  const values = {
    supportDiversNeeded: count,
    // The check constraint pairs these, so normalise here rather than let a form
    // that forgot to clear one fail the write: nobody to supply means nobody to
    // name as the supplier.
    supportDiversProvidedBy: (count ?? 0) > 0 ? input.supportDiversProvidedBy : null,
    needsBoardingAssistance: input.needsBoardingAssistance,
    needsWaterLift: input.needsWaterLift,
    briefingInSign: input.briefingInSign,
    briefingInWriting: input.briefingInWriting,
    briefingAloud: input.briefingAloud,
    briefingBySignals: input.briefingBySignals,
    equipmentAdaptation: optional(input.equipmentAdaptation),
    divesWithName: optional(input.divesWithName),
    // The diver answered, whatever they answered. An all-false record is a real
    // statement and a crew reading it wants to know somebody was asked — see
    // the column's own note in schema.ts.
    statedAt: nowDate(),
    updatedAt: nowDate(),
  };
  return await db.transaction(async (tx) => {
    // Read before write: the trail says whether this save *emptied* a record
    // that held something, which is the one shape a reader cannot reconstruct
    // afterwards -- the row that is left looks identical to one nobody ever
    // filled in beyond its `stated_at`.
    const before = await getSupportNeeds(tx, input.shopId, input.personId);
    const [row] = await tx
      .insert(diveSupportNeeds)
      .values({ shopId: input.shopId, personId: input.personId, ...values })
      .onConflictDoUpdate({
        target: [diveSupportNeeds.shopId, diveSupportNeeds.personId],
        set: values,
      })
      .returning();
    if (!row) return null;
    await recordSupportNeedsChange(tx, {
      shopId: input.shopId,
      personId: input.personId,
      actor: input.actor,
      emptied: hasSupportNeeds(before) && !hasSupportNeeds(row),
    });
    return row;
  });
}

/**
 * One line on the diver's trail saying the record changed -- never what it
 * says.
 *
 * Whoever holds a `/ready` link can read that a diver arranged a hoist and a
 * sign-language briefing, and can empty the whole record with one save: every
 * unticked box is a real `false` by design, so a form reset and submitted
 * clears it. That is deliberate -- the record is a living preference and a
 * diver must be able to retract an arrangement as easily as they made one --
 * but a retraction has to be *visible afterwards*, or a support-diver count
 * silently lost between `/ready` and the manifest is a diver in the water
 * without the help they arranged, with no way to find out when it went or
 * from where (ADR 20260827-support-needs-are-a-record-about-the-dive; issue
 * #1070).
 *
 * The arrangements themselves stay out of the message on purpose. This table
 * has its own retention window, and copying a health-adjacent detail into a
 * second one buys nothing the record itself does not already answer.
 */
async function recordSupportNeedsChange(
  tx: DbExecutor,
  input: { shopId: string; personId: string; actor: SupportNeedsActor; emptied: boolean },
) {
  const [diver] = await tx
    .select({ name: people.fullName })
    .from(people)
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .limit(1);
  if (!diver) return;
  const verb = input.emptied ? "cleared" : "updated";
  if (input.actor.kind === "staff") {
    const [actor] = await tx
      .select({ name: people.fullName })
      .from(people)
      .where(and(eq(people.id, input.actor.personId), eq(people.shopId, input.shopId)))
      .limit(1);
    // A staff actor who is not this shop's leaves no line rather than an
    // unattributed one: `actor_person_id` is `notNull` and a trail that
    // invents an author is worse than one that is short.
    if (!actor) return;
    await tx.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: null,
      bookingId: null,
      actorPersonId: input.actor.personId,
      subjectPersonId: input.personId,
      // i18n-exempt: an activity-trail line, stored as written like every
      // other row in this table; it is staff-facing history, not UI copy.
      message: `${actor.name} ${verb} what to set up for ${diver.name}'s dives`,
      occurredAt: nowDate(),
    });
    return;
  }
  await tx.insert(activityEvents).values({
    shopId: input.shopId,
    tripId: null,
    bookingId: null,
    // The diver is both author and subject here -- they wrote it on their own
    // page. Both handles are set anyway: `actor_person_id` is what attributes
    // the line, and `subject_person_id` is what ties it to the record it was
    // written on (`pagedDiverActivity`).
    actorPersonId: input.personId,
    subjectPersonId: input.personId,
    // i18n-exempt: see above.
    message: `${diver.name} ${verb} what to set up for their dives`,
    occurredAt: nowDate(),
  });
}

/** One diver's record, or null when they have never been asked. */
export async function getSupportNeeds(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<SupportNeeds | null> {
  const [row] = await db
    .select(SUPPORT_NEEDS_COLUMNS)
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
    .select({ personId: diveSupportNeeds.personId, ...SUPPORT_NEEDS_COLUMNS })
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
    .select({ personId: diveSupportNeeds.personId, ...SUPPORT_NEEDS_COLUMNS })
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
