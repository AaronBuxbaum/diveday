import { describe, expect, it } from "vitest";
import { monthSightings } from "@/features/sites/month-sightings";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";

const ctx = fileScopedShopContext({ history: true });

describe("the seeded month shelf", () => {
  it("names at least three animals for the current month", async () => {
    const { db, shop } = ctx;
    const shelf = await monthSightings(db, shop.id, shop.timezone, nowDate());
    expect(shelf?.species.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
