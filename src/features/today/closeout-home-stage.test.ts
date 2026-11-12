import { expect, it } from "vitest";
import { trips as tripsTable } from "@/db/schema";
import { listStaff } from "@/db/trips";
import { nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { recordTripStage } from "../trip-stages/store";
import { getDayCloseout } from "./closeout-reader";

const HOUR = 60 * 60 * 1000;

const shared = fileScopedShopContext();

it("settles a departure the return buffer still calls still out, once the crew tap Home", async () => {
  // **Issue #1480, through the plumbing.** The promotion is decided in
  // `src/features/today/closeout.ts`, but it only ever fires if the db half actually
  // carries the crew's last tap onto the departure — this is the test that
  // catches that being forgotten.
  const { db, shop } = shared;
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("seed staff missing");

  // Due back five minutes ago: `hasReturned` says no for another 55.
  const endsAt = new Date(nowMs() - 5 * 60 * 1000);
  const [trip] = await db
    .insert(tripsTable)
    .values({
      shopId: shop.id,
      title: "Just In — Molasses & French",
      startsAt: new Date(endsAt.getTime() - 4 * HOUR),
      endsAt,
      capacity: 12,
      plannedDives: 2,
      priceCents: 13000,
    })
    .returning();
  if (!trip) throw new Error("fixture trip insert returned no row");

  const before = await getDayCloseout(db, shop.id, shop.timezone);
  expect(before.departures.find((d) => d.tripId === trip.id)?.status).toBe("still_out");

  const tap = await recordTripStage(db, {
    shopId: shop.id,
    tripId: trip.id,
    stage: "home",
    recordedByPersonId: staff.person.id,
  });
  if (!tap.ok) throw new Error(`stage refused: ${tap.reason}`);

  const after = await getDayCloseout(db, shop.id, shop.timezone);
  expect(after.departures.find((d) => d.tripId === trip.id)?.status).toBe("all_home");
});
