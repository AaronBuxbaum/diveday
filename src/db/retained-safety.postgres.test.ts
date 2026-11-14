import { expect, it } from "vitest";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { retainedSafetyShopWarnings } from "./retained-safety";
import { shops, unresolvedSafetyScanIncidents } from "./schema";

describePostgres("retained safety warnings on PostgreSQL", () => {
  it("decodes existence flags and isolates orphaned incidents by shop", async () => {
    const { db } = await postgresTestDb();
    const [shop, other] = await db
      .insert(shops)
      .values([
        { name: "Safety", slug: `safety-${crypto.randomUUID()}`, timezone: "UTC" },
        { name: "Other", slug: `safety-${crypto.randomUUID()}`, timezone: "UTC" },
      ])
      .returning();
    expect(await retainedSafetyShopWarnings(db, shop.id)).toEqual({
      evidence: false,
      alertNeedsReview: false,
    });
    await db.insert(unresolvedSafetyScanIncidents).values({
      outboxId: crypto.randomUUID(),
      generationId: crypto.randomUUID(),
      scanSequence: 1,
      shopId: shop.id,
      tripId: crypto.randomUUID(),
      claimId: crypto.randomUUID(),
    });
    expect(await retainedSafetyShopWarnings(db, shop.id)).toEqual({
      evidence: true,
      alertNeedsReview: true,
    });
    expect(await retainedSafetyShopWarnings(db, other.id)).toEqual({
      evidence: false,
      alertNeedsReview: false,
    });
  });
});
