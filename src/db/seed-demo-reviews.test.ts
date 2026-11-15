import { and, eq, isNotNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getShopReviewAggregate } from "@/features/reviews/store";
import { fileScopedShopContext } from "@/test/db";
import { tripReviews } from "./schema";
import { resetDemoSchedule } from "./seed";

const ctx = fileScopedShopContext();

describe("demo review history", () => {
  it("restores a realistic published aggregate and written reviews on reset", async () => {
    const { db, shop } = ctx;
    for (let pass = 0; pass < 2; pass++) {
      await resetDemoSchedule(db, shop.id, "history");
      const aggregate = await getShopReviewAggregate(db, shop.id);
      expect(aggregate.average).toBeGreaterThanOrEqual(4.7);
      expect(aggregate.average).toBeLessThan(4.85);
      const written = await db
        .select({ id: tripReviews.id })
        .from(tripReviews)
        .where(
          and(
            eq(tripReviews.shopId, shop.id),
            eq(tripReviews.isPublished, true),
            isNotNull(tripReviews.comment),
          ),
        );
      expect(written.length).toBeGreaterThanOrEqual(10);
    }
  });
});
