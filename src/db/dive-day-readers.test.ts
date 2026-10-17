import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { getRecapPageData } from "./recap";
import { bookings } from "./schema";
import { createTrip } from "./trips";
import { diveDayCountForSeat } from "./welcome-cues";
import { listYourDays } from "./your-days";

/**
 * **One number for every reader of a diver's numbered days** (glossary
 * **Dive day**; dive-domain review of layer r5-4, second pass, F1; security
 * review, second pass, N-b). The milestone, the recap's ordinal and the rows of
 * "Your days" count the same days: diver seats only, never a held seat. A day
 * they rode along while somebody else dived is not one of their dive days, and
 * a seat matched to them on a guess may not be theirs at all.
 */

const ctx = fileScopedShopContext();
const DAY = 24 * 60 * 60 * 1000;
const EMAIL = "lena.readers@example.com";

async function departure(db: AppDb, shopId: string, title: string, offsetDays: number) {
  const startsAt = new Date(nowDate().getTime() + offsetDays * DAY);
  const trip = await createTrip(db, {
    shopId,
    title,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
    capacity: 6,
    plannedDives: 2,
  });
  if (!trip) throw new Error(`trip "${title}" not created`);
  return trip.id;
}

/** Lena's seat ahead, booked as a diver would; her past seats written as they stand. */
async function lena(db: AppDb, shopId: string) {
  const outcome = await createBooking(db, {
    actor: "staff",
    shopId,
    tripId: await departure(db, shopId, "Next Saturday", 4),
    fullName: "Lena Readers",
    email: EMAIL,
  });
  if (!outcome.ok) throw new Error("expected booking to succeed");
  const [own] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, outcome.bookingId));
  if (!own) throw new Error("seat missing");
  const past = async (
    title: string,
    offsetDays: number,
    extra: Partial<typeof bookings.$inferInsert> = {},
  ) => {
    const [seat] = await db
      .insert(bookings)
      .values({
        shopId,
        tripId: await departure(db, shopId, title, offsetDays),
        personId: own.personId,
        bookedAs: "diver",
        status: "checked_in",
        ...extra,
      })
      .returning({ id: bookings.id });
    if (!seat) throw new Error("seat not created");
    return seat.id;
  };
  return { ahead: outcome.bookingId, past };
}

describe("the three readers of a diver's numbered days", () => {
  it("agree when a rider seat and a held seat sit between two dive days", async () => {
    const { db, shop } = ctx;
    const { ahead, past } = await lena(db, shop.id);
    await past("First reef", -20);
    await past("Rode along", -12, { participantType: "rider", bookedAs: "rider" });
    await past("Held wreck", -8, { identityUnconfirmedAt: nowDate(), identityBookedAs: "L. R." });
    const second = await past("Second reef", -3);

    const recap = (await getRecapPageData(db, second))?.visitCount;
    const milestone = await diveDayCountForSeat(db, shop.id, second);
    const row = (
      await listYourDays(db, { shopId: shop.id, bookingId: ahead, now: nowDate() })
    ).past.find((day) => day.bookingId === second)?.dayNumber;

    expect([recap, milestone, row]).toEqual([2, 2, 2]);
  });
});
