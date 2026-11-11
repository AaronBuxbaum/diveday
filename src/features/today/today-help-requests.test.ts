import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { shops } from "@/db/schema";
import { DEMO_TODAY_TRIP_TITLE } from "@/db/seed-trips";
import { getTripRoster, upcomingTripsWithCounts } from "@/db/trips";
import { staffTranslator } from "@/i18n/staff-messages";
import { fileScopedShopContext } from "@/test/db";
import { recordHelpRequest } from "../help-requests";
import { shopClock } from "../shop-clock/rules";
import { getTodayWork } from "./today-reader";

const ctx = fileScopedShopContext();

// The shared seed is pinned to July 21, 2026. Both instants are already that
// date in UTC, but the request belongs to Tomorrow until the shop's midnight.
it.each([
  { timezone: "America/New_York", midnight: "2026-07-21T04:00:00.000Z" },
  { timezone: "Pacific/Honolulu", midnight: "2026-07-21T10:00:00.000Z" },
])("hands a saved request to Today at midnight in $timezone", async ({ timezone, midnight }) => {
  const { db, shop } = ctx;
  await db.update(shops).set({ timezone }).where(eq(shops.id, shop.id));
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (row) => row.title === DEMO_TODAY_TRIP_TITLE,
  );
  if (!trip) throw new Error("expected seeded reef trip");
  const [seat] = await getTripRoster(db, shop.id, trip.id);
  if (!seat) throw new Error("expected seeded diver");
  const dayOf = new Date(midnight);
  const dayBefore = new Date(dayOf.getTime() - 1);
  const saved = await recordHelpRequest(db, {
    shopId: shop.id,
    bookingId: seat.booking.id,
    kind: "first_timer",
    now: dayBefore,
  });
  expect(saved.ok).toBe(true);
  if (!saved.ok || !saved.request) throw new Error("expected saved request");
  const requestId = saved.request.id;

  for (const [now, expectedCount] of [
    [dayBefore, 0],
    [dayOf, 1],
  ] as const) {
    const work = await getTodayWork(
      db,
      shop.id,
      shop.slug,
      shopClock({ timezone }, now),
      undefined,
      staffTranslator("en-US"),
    );
    const requests = work.actions.filter((action) => action.helpRequest?.requestId === requestId);
    expect(requests).toHaveLength(expectedCount);
    if (expectedCount === 1) {
      expect(requests[0]?.helpRequest).toMatchObject({ requestId, status: "requested" });
    }
  }
});
