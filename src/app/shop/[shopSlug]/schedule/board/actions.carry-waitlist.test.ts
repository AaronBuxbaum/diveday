import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { interests, trips } from "@/db/schema";
import { createTrip } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { addCalendarDays, utcToWallTime } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";
import { createDiver } from "../../../../../features/divers/store";

const ctx = fileScopedShopContext();

/**
 * **Adding a departure from a demand banner carries its wait list** (#2559).
 * The add form's `carryFrom` is the full departure the banner was on; the new
 * departure takes every waiting interest and the staffer lands on it. A
 * source that is not an id, or not this shop's, changes nothing.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("../../../../../features/session/rules", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireShopSurface } = await import("../../../../../features/session/rules");
const { addDepartureAction } = await import("./actions");

const pad = (value: number) => String(value).padStart(2, "0");
const TITLE = "Second boat, carried";

async function signedInOwner() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
    db,
    shop,
  } as never);
  return { db, shop };
}

function dayFromNow(timeZone: string, days: number) {
  const day = addCalendarDays(
    utcToWallTime(new Date(nowDate().getTime() + 20 * 24 * 60 * 60 * 1000), timeZone),
    days,
  );
  return `${day.year}-${pad(day.month)}-${pad(day.day)}`;
}

async function fullDepartureWithOneWaiting() {
  const { db, shop } = await signedInOwner();
  const startsAt = new Date(nowDate().getTime() + 20 * 24 * 60 * 60 * 1000);
  const source = await createTrip(db, {
    shopId: shop.id,
    title: "Full Saturday",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
    capacity: 1,
    plannedDives: 2,
  });
  if (!source) throw new Error("source departure failed");
  const diver = await createDiver(db, {
    shopId: shop.id,
    fullName: "Wendy Waiting",
    email: "wendy-waiting-carry@example.com",
  });
  if (!diver) throw new Error("diver failed");
  await db.insert(interests).values({
    shopId: shop.id,
    tripId: source.id,
    scope: "departure",
    askedBy: "diver",
    personId: diver.id,
    askedAt: new Date("2030-08-01T12:00:00Z"),
    partySize: 1,
  });
  return { db, shop, source, diver };
}

function addForm(shop: { timezone: string }, carryFrom?: string, title = TITLE) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    title,
    date: dayFromNow(shop.timezone, 0),
    startTime: "09:00",
    endTime: "13:00",
    capacity: "8",
    plannedDives: "2",
  })) {
    form.set(key, value);
  }
  if (carryFrom !== undefined) form.set("carryFrom", carryFrom);
  return form;
}

async function addedTripId(db: typeof ctx.db, shopId: string, title = TITLE) {
  const [added] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), eq(trips.title, title)));
  return added?.id;
}

describe("adding a departure from the demand banner", () => {
  it("carries the source's wait list and lands on the new departure", async () => {
    const { db, shop, source, diver } = await fullDepartureWithOneWaiting();
    const to = await redirectedTo(() => addDepartureAction(shop.slug, addForm(shop, source.id)));
    const addedId = await addedTripId(db, shop.id);
    if (!addedId) throw new Error("the departure was not added");
    expect(to).toContain(`/trips/${addedId}`);
    expect(to).toContain("notice=waitlist-carried");
    expect(to).toContain("count=1");
    const carried = await db
      .select({ personId: interests.personId })
      .from(interests)
      .where(and(eq(interests.tripId, addedId), eq(interests.scope, "departure")));
    expect(carried).toEqual([{ personId: diver.id }]);
    // Copied, never moved: the source still holds its own.
    const kept = await db
      .select({ id: interests.id })
      .from(interests)
      .where(eq(interests.tripId, source.id));
    expect(kept).toHaveLength(1);
  });

  it("is the ordinary add, with the wait list left where it was, when there is no source", async () => {
    const { db, shop, source } = await fullDepartureWithOneWaiting();
    const sources = [undefined, "", "not-an-id", "00000000-0000-4000-8000-000000000000"];
    for (const [index, carryFrom] of sources.entries()) {
      const title = `${TITLE} ${index}`;
      const to = await redirectedTo(() =>
        addDepartureAction(shop.slug, addForm(shop, carryFrom, title)),
      );
      expect(to).toContain("builder=added");
      const addedId = await addedTripId(db, shop.id, title);
      if (!addedId) throw new Error("the departure was not added");
      expect(
        await db.select({ id: interests.id }).from(interests).where(eq(interests.tripId, addedId)),
      ).toEqual([]);
    }
    expect(
      await db.select({ id: interests.id }).from(interests).where(eq(interests.tripId, source.id)),
    ).toHaveLength(1);
  });
});

it("warns when off-shift crew are not assigned without losing a requested waitlist carry", async () => {
  const { db, shop, source, diver } = await fullDepartureWithOneWaiting();
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const form = addForm(shop, source.id, "Crew shift refusal");
  form.set("date", dayFromNow(shop.timezone, 200));
  form.append("crewPersonIds", owner);
  const to = await redirectedTo(() => addDepartureAction(shop.slug, form));
  expect(to).toContain("builder=added-no-crew");
  const id = await addedTripId(db, shop.id, "Crew shift refusal");
  if (!id) throw new Error("departure missing");
  const { tripAssignments } = await import("@/db/schema");
  expect(await db.select().from(tripAssignments).where(eq(tripAssignments.tripId, id))).toEqual([]);
  const carried = await db
    .select({ personId: interests.personId })
    .from(interests)
    .where(eq(interests.tripId, id));
  expect(carried).toEqual([{ personId: diver.id }]);
});
