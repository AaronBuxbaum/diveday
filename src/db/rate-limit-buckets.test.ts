import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { refundToBucket, takeFromBucket } from "./rate-limit-buckets";
import { rateLimitBuckets } from "./schema";

const config = { capacity: 3, refillPerMs: 1 / 1000 }; // 3 burst, 1 token/sec refill
const NOW = 1_000_000;

describe("the shared token bucket", () => {
  it("allows a burst up to capacity, then refuses", async () => {
    const { db } = await seededShopContext();
    for (let i = 0; i < 3; i++)
      expect((await takeFromBucket(db, "k", config, NOW)).allowed).toBe(true);
    const fourth = await takeFromBucket(db, "k", config, NOW);
    expect(fourth.allowed).toBe(false);
    expect(fourth.tokens).toBeLessThan(1);
  });

  it("refills one token per interval and never past capacity", async () => {
    const { db } = await seededShopContext();
    for (let i = 0; i < 4; i++) await takeFromBucket(db, "k", config, NOW);
    expect((await takeFromBucket(db, "k", config, NOW + 1000)).allowed).toBe(true);
    expect((await takeFromBucket(db, "k", config, NOW + 1000)).allowed).toBe(false);

    for (let i = 0; i < 3; i++) {
      expect((await takeFromBucket(db, "idle", config, NOW + 10_000_000)).allowed).toBe(true);
    }
    expect((await takeFromBucket(db, "idle", config, NOW + 10_000_000)).allowed).toBe(false);
  });

  it("keeps keys apart", async () => {
    const { db } = await seededShopContext();
    for (let i = 0; i < 4; i++) await takeFromBucket(db, "a", config, NOW);
    expect((await takeFromBucket(db, "b", config, NOW)).allowed).toBe(true);
  });

  it("answers concurrent takes with exactly capacity allowed", async () => {
    const { db } = await seededShopContext();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => takeFromBucket(db, "race", config, NOW)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
  });

  it("gives a token back on refund, capped at capacity, and ignores an unseen key", async () => {
    const { db } = await seededShopContext();
    for (let i = 0; i < 4; i++) await takeFromBucket(db, "k", config, NOW);
    await refundToBucket(db, "k", config, NOW);
    expect((await takeFromBucket(db, "k", config, NOW)).allowed).toBe(true);
    expect((await takeFromBucket(db, "k", config, NOW)).allowed).toBe(false);

    await refundToBucket(db, "never-seen", config, NOW);
    expect(await db.select().from(rateLimitBuckets)).toHaveLength(1);

    await takeFromBucket(db, "full", config, NOW);
    await refundToBucket(db, "full", config, NOW);
    await refundToBucket(db, "full", config, NOW);
    for (let i = 0; i < 3; i++) await takeFromBucket(db, "full", config, NOW);
    expect((await takeFromBucket(db, "full", config, NOW)).allowed).toBe(false);
  });
});
