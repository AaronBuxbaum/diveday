import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { verifyWaiverIntegrity } from "@/lib/waiver-integrity";
import { seededShopContext } from "@/test/db";
import { waiverRecords } from "./schema";
import { DAY_MS } from "./seed-clock";
import { listWaiverIntegrityAudit } from "./waivers";

/**
 * The shop's signed evidence, as the Signatures tab reads it
 * (src/db/seed-waiver-evidence.ts). Two invariants, and both of them are the
 * point of the scenario rather than a count: a sealed record must actually
 * *verify* (a seal computed over the wrong snapshot reads `invalid`, which is
 * the one thing a demo of an integrity check must never show), and signatures
 * must be spread over the days divers really signed on rather than piled onto
 * this instant.
 */
async function evidence() {
  const { db, shop } = await seededShopContext({ history: true });
  const records = await db
    .select()
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shop.id),
        inArray(waiverRecords.status, ["completed", "medical_review"]),
      ),
    );
  return { db, shop, records };
}

describe("seeded waiver evidence", () => {
  it("holds both integrity states, and every sealed record verifies", async () => {
    const { records } = await evidence();
    const states = records.map(verifyWaiverIntegrity);
    expect(states.filter((state) => state === "valid").length).toBeGreaterThan(0);
    expect(states.filter((state) => state === "unsealed").length).toBeGreaterThan(0);
    // Never `invalid`. A seed that sealed a record and then changed a field
    // inside the seal would land here, and it would teach a reader that the
    // shop's own untampered evidence had been tampered with.
    expect(states.filter((state) => state === "invalid")).toEqual([]);
  });

  it("shows both states on the audit trail's first page, without paging", async () => {
    const { db, shop } = await evidence();
    const page = await listWaiverIntegrityAudit(db, shop.id);
    const states = new Set(page.entries.map((entry) => entry.integrity));
    expect(states).toEqual(new Set(["valid", "unsealed"]));
  });

  it("spreads signatures across previous days instead of one instant", async () => {
    const { records } = await evidence();
    const signed = records
      .map((record) => record.signedAt)
      .filter((value): value is Date => value !== null);
    expect(signed.length).toBeGreaterThan(0);

    // No signature is in the future — a release signed after "now" is the
    // giveaway that a seeded date was pinned to a wall hour rather than
    // measured back from the clock.
    const now = nowMs();
    expect(signed.filter((value) => value.getTime() > now)).toEqual([]);

    // The recent evidence, which is what the audit trail's first pages show,
    // lands on many distinct days rather than all on today.
    const recent = signed.filter((value) => value.getTime() > now - 21 * DAY_MS);
    const days = new Set(recent.map((value) => value.toISOString().slice(0, 10)));
    expect(days.size).toBeGreaterThanOrEqual(14);
    const today = new Date(now).toISOString().slice(0, 10);
    expect(recent.filter((value) => value.toISOString().slice(0, 10) === today).length).toBeLessThan(
      recent.length / 2,
    );
  });

  it("keeps a signed release self-consistent after re-dating", async () => {
    const { records } = await evidence();
    for (const record of records) {
      if (!record.signedAt) continue;
      // Consent, signature and completion are one sitting; the record is
      // created no later than the signature it carries.
      expect(record.consentedAt?.getTime()).toBe(record.signedAt.getTime());
      expect(record.completedAt?.getTime()).toBe(record.signedAt.getTime());
      expect(record.createdAt.getTime()).toBeLessThanOrEqual(record.signedAt.getTime());
    }
  });
});
