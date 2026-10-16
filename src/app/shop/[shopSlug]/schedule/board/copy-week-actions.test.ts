import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { activityEvents, tripDives, tripScheduleDays, trips } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

const ctx = fileScopedShopContext();

/**
 * **"Copy them here"** (fifth loop, item 30): the act is the builder's, so
 * the builder's gate; a refusal writes nothing.
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
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { auth } = await import("@/lib/auth");
const { copyLastYearWeekAction } = await import("./copy-week-actions");

// Far past the seed's own departures: Monday, June 3, 2030, and a year before.
const WEEK = "2030-06-03";
const WEEK_FROM = new Date("2030-06-03T00:00:00Z");
const WEEK_TO = new Date("2030-06-11T00:00:00Z");

async function context() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const start = new Date("2029-06-05T13:00:00Z");
  const end = new Date(start.getTime() + 3 * 3_600_000);
  const [source] = await db
    .insert(trips)
    .values({ shopId: shop.id, title: "Year-ago wreck", startsAt: start, endsAt: end, capacity: 8 })
    .returning();
  if (!source) throw new Error("trip insert failed");
  await db.insert(tripDives).values({ tripId: source.id, diveNumber: 1 });
  await db
    .insert(tripScheduleDays)
    .values({ tripId: source.id, dayNumber: 1, startsAt: start, endsAt: end });
  return {
    db,
    shop,
    owner: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
    captain: await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL),
  };
}

function signIn(shop: { id: string; slug: string }, personId: string) {
  vi.mocked(auth).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }) as never,
  );
}

async function weekTrips(db: typeof ctx.db, shopId: string) {
  return db
    .select({ id: trips.id, title: trips.title })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        isNull(trips.deletedAt),
        gte(trips.startsAt, WEEK_FROM),
        lt(trips.startsAt, WEEK_TO),
      ),
    );
}

const formFor = (weekStart: string) => {
  const form = new FormData();
  form.set("weekStart", weekStart);
  return form;
};

describe("copyLastYearWeekAction", () => {
  it("copies last year's week for an owner and logs each copy under their name", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    expect(await redirectedTo(() => copyLastYearWeekAction(shop.slug, formFor(WEEK)))).toContain(
      `week=${WEEK}&builder=week-copied&count=1`,
    );
    const copies = await weekTrips(db, shop.id);
    expect(copies.map((row) => row.title)).toEqual(["Year-ago wreck"]);
    const lines = await db
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.tripId, copies[0]?.id ?? ""),
          eq(activityEvents.code, "departure_copied"),
        ),
      );
    expect(lines).toEqual([expect.objectContaining({ actorPersonId: owner })]);
  });

  it("refuses a captain and copies nothing", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);
    expect(await redirectedTo(() => copyLastYearWeekAction(shop.slug, formFor(WEEK)))).toContain(
      "builder=not-authorized",
    );
    expect(await weekTrips(db, shop.id)).toEqual([]);
  });

  it("refuses a week that does not start on a Monday", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    expect(
      await redirectedTo(() => copyLastYearWeekAction(shop.slug, formFor("2030-06-04"))),
    ).toContain("builder=invalid");
    expect(await weekTrips(db, shop.id)).toEqual([]);
  });
});
