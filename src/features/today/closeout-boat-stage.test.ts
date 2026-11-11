import { expect, it } from "vitest";
import { listStaff } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { bringEveryBoatHome } from "@/test/shop-facts/bring-every-boat-home";
import { recordTripStage } from "../trip-stages/store";
import { getDayCloseout } from "./closeout-reader";

const ctx = fileScopedShopContext({ history: true });

it("keeps a completed seeded roll call separate from an overdue boat's recorded stage", async () => {
  const { db, shop } = ctx;
  const { departures } = await bringEveryBoatHome(db, shop, { heads: "closed" }, nowDate());
  const trip = departures[0];
  const [staff] = await listStaff(db, shop.id);
  if (!trip || !staff) throw new Error("fixture departure or staff missing");
  const read = async () =>
    (await getDayCloseout(db, shop.id, shop.timezone)).departures.find(
      (row) => row.tripId === trip.id,
    );
  const completed = await getDayCloseout(db, shop.id, shop.timezone);
  for (const moved of departures) {
    expect(completed.departures.find((row) => row.tripId === moved.id)?.status).toBe("all_home");
  }
  for (const stage of ["underway", "home"] as const) {
    const tap = await recordTripStage(db, {
      shopId: shop.id,
      tripId: trip.id,
      stage,
      recordedByPersonId: staff.person.id,
    });
    if (!tap.ok) throw new Error(`stage refused: ${tap.reason}`);
    expect(await read()).toMatchObject({
      status: stage === "home" ? "all_home" : "still_out",
      gapReason: null,
    });
  }
});
