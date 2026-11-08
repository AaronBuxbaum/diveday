import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ACTIVITY_REDACTED } from "@/lib/activity";
import { fileScopedShopContext } from "@/test/db";
import { ANONYMIZED_PERSON_NAME } from "../features/anonymization/rules";
import { anonymizeDiver } from "../features/anonymize/store";
import { activityEvents, bookings, people, personRoles } from "./schema";

/**
 * Issue #3807: erasing a former staffer keeps the shop's trail of the safety
 * acts they did on other divers, without their name. Lines about the erased
 * person themselves are still redacted whole.
 */
const ctx = fileScopedShopContext();

async function fixtures() {
  const { db, shop } = ctx;
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  const [seat] = await db
    .select({ id: bookings.id, tripId: bookings.tripId, personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.shopId, shop.id))
    .orderBy(bookings.id)
    .limit(1);
  if (!owner || !seat) throw new Error("expected the seeded owner and a seat");
  // A former staffer: a diver role is all that is left of them.
  const [former] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Marta Quill" })
    .returning({ id: people.id });
  if (!former) throw new Error("fixture insert failed");
  await db.insert(personRoles).values({ personId: former.id, role: "diver" });
  return { db, shop, owner: owner.id, seat, formerId: former.id };
}

describe("erasing a former staffer's activity lines", () => {
  it("keeps a clearance on another diver's record and drops only the staffer's name", async () => {
    const { db, shop, owner, seat, formerId } = await fixtures();
    await db.insert(activityEvents).values([
      {
        shopId: shop.id,
        actorPersonId: formerId,
        subjectPersonId: seat.personId,
        code: "note_added",
        params: { actor: "Marta Quill", diver: "Priya Sharma" },
      },
      {
        shopId: shop.id,
        tripId: seat.tripId,
        bookingId: seat.id,
        actorPersonId: formerId,
        code: "booking_no_show_boarded",
        params: { actor: "Marta Quill", diver: "Priya Sharma" },
      },
      // About the erased person themselves: still redacted whole.
      {
        shopId: shop.id,
        actorPersonId: owner,
        subjectPersonId: formerId,
        code: "note_added",
        params: { actor: "Dana Reyes", diver: "Marta Quill" },
      },
      {
        shopId: shop.id,
        actorPersonId: formerId,
        subjectPersonId: formerId,
        code: "note_added",
        params: { actor: "Marta Quill", diver: "Marta Quill" },
      },
    ]);

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: formerId,
      actorPersonId: owner,
    });
    expect(erased.ok).toBe(true);

    const rows = await db.select().from(activityEvents).where(eq(activityEvents.shopId, shop.id));
    const onOther = rows.find((row) => row.subjectPersonId === seat.personId);
    expect(onOther).toMatchObject({
      code: "note_added",
      actorPersonId: formerId,
      params: { actor: ANONYMIZED_PERSON_NAME, diver: "Priya Sharma" },
    });
    const onSeat = rows.find((row) => row.bookingId === seat.id && row.actorPersonId === formerId);
    expect(onSeat).toMatchObject({
      code: "booking_no_show_boarded",
      tripId: seat.tripId,
      params: { actor: ANONYMIZED_PERSON_NAME, diver: "Priya Sharma" },
    });
    const aboutThem = rows.filter((row) => row.subjectPersonId === formerId);
    expect(aboutThem).toHaveLength(2);
    for (const row of aboutThem) expect(row).toMatchObject(ACTIVITY_REDACTED);
    expect(JSON.stringify(rows.map((row) => row.params))).not.toContain("Marta Quill");
  });
  it("tells the erased diver's own seat from another diver's seat when they also own bookings", async () => {
    const { db, shop, owner } = await fixtures();
    const seats = await db
      .select({ id: bookings.id, tripId: bookings.tripId, personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.shopId, shop.id))
      .orderBy(bookings.id);
    const own = seats[0];
    const other = seats.find((seat) => seat.personId !== own?.personId);
    if (!own || !other) throw new Error("expected seats for two different people");
    await db.insert(activityEvents).values([
      {
        shopId: shop.id,
        tripId: other.tripId,
        bookingId: other.id,
        actorPersonId: own.personId,
        code: "booking_no_show_boarded",
        params: { actor: "Erased Diver", diver: "Someone Else" },
      },
      {
        shopId: shop.id,
        tripId: own.tripId,
        bookingId: own.id,
        actorPersonId: own.personId,
        code: "booking_no_show_boarded",
        params: { actor: "Erased Diver", diver: "Erased Diver" },
      },
    ]);

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: own.personId,
      actorPersonId: owner,
    });
    expect(erased.ok).toBe(true);

    const rows = await db
      .select()
      .from(activityEvents)
      .where(
        and(eq(activityEvents.shopId, shop.id), eq(activityEvents.actorPersonId, own.personId)),
      );
    const onOther = rows.find((row) => row.bookingId === other.id);
    expect(onOther).toMatchObject({
      code: "booking_no_show_boarded",
      params: { actor: ANONYMIZED_PERSON_NAME, diver: "Someone Else" },
    });
    const onOwn = rows.find((row) => row.bookingId === own.id);
    expect(onOwn).toMatchObject(ACTIVITY_REDACTED);
  });
});
