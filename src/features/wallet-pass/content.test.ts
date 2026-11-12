import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { bookings, people, shops, tripStageEvents, trips } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import { readPassContent } from "./content";

const ctx = fileScopedShopContext();
it.each([
  ["days early", "2026-07-23T12:00:00Z", "2026-07-23T16:00:00Z", "2026-07-21T13:00:00Z", false],
  [
    "previous local day on the same UTC date",
    "2026-07-21T12:00:00Z",
    "2026-07-21T16:00:00Z",
    "2026-07-21T03:59:59Z",
    false,
  ],
  [
    "previous meeting day",
    "2026-07-20T12:00:00Z",
    "2026-07-22T16:00:00Z",
    "2026-07-20T13:00:00Z",
    false,
  ],
  [
    "current local day",
    "2026-07-21T12:00:00Z",
    "2026-07-21T16:00:00Z",
    "2026-07-21T04:00:00Z",
    true,
  ],
])("applies eligibility for %s evidence on a wallet pass", async (_name, start, end, at, shown) => {
  const { db, shop } = ctx;
  await db.update(shops).set({ timezone: "America/New_York" }).where(eq(shops.id, shop.id));
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Public stage diver" })
    .returning();
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Day-scoped boat",
      startsAt: new Date(start),
      endsAt: new Date(end),
      capacity: 4,
    })
    .returning();
  const [booking] = await db
    .insert(bookings)
    .values({ shopId: shop.id, tripId: trip.id, personId: person.id, bookedAs: "diver" })
    .returning();
  const [raw] = await db
    .insert(tripStageEvents)
    .values({
      shopId: shop.id,
      tripId: trip.id,
      stage: "underway",
      recordedAt: new Date(at),
      recordedByPersonId: person.id,
    })
    .returning();
  const result = await readPassContent(
    db,
    shop.id,
    booking.id,
    "en-US",
    new Date("2026-07-21T13:30:00Z"),
  );
  expect(result).not.toBeNull();
  expect(result?.content.headerFields).toEqual(
    shown ? [{ key: "stage", label: "", value: "Underway" }] : [],
  );
  expect(
    (await db.select().from(tripStageEvents).where(eq(tripStageEvents.id, raw.id)))[0],
  ).toEqual(raw);
});
