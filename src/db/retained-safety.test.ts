import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { hasRetainedSafetyAlertNeedsReview, hasRetainedSafetyEvidence } from "./retained-safety";
import { shops, unresolvedSafetyScanIncidents } from "./schema";

const ctx = fileScopedShopContext();
it("keeps a shop warning for an incident whose outbox and trip no longer exist", async () => {
  const { db } = ctx;
  const [shop] = await db
    .insert(shops)
    .values({ name: "Safety test", slug: `safety-${crypto.randomUUID()}`, timezone: "UTC" })
    .returning({ id: shops.id });
  const [other] = await db
    .insert(shops)
    .values({ name: "Other", slug: `other-${crypto.randomUUID()}`, timezone: "UTC" })
    .returning({ id: shops.id });
  expect(await hasRetainedSafetyEvidence(db, shop.id)).toBe(false);
  await db.insert(unresolvedSafetyScanIncidents).values({
    outboxId: crypto.randomUUID(),
    generationId: crypto.randomUUID(),
    scanSequence: 1,
    shopId: shop.id,
    tripId: crypto.randomUUID(),
    claimId: crypto.randomUUID(),
  });
  expect(await hasRetainedSafetyEvidence(db, shop.id)).toBe(true);
  expect(await hasRetainedSafetyAlertNeedsReview(db, shop.id)).toBe(true);
  expect(await hasRetainedSafetyEvidence(db, other.id)).toBe(false);
  expect(await hasRetainedSafetyAlertNeedsReview(db, other.id)).toBe(false);
});
