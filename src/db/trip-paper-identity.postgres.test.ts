import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { createBoat } from "@/db/boats";
import { boats, shops, trips } from "@/db/schema";
import { readTripPaperIdentity } from "@/db/trip-paper-identity";
import { nowDate } from "@/lib/clock";
import { stablePacket } from "@/lib/stable-packet";
import { describePostgres, postgresTestDb } from "@/test/postgres";

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describePostgres("packet identity against concurrent committed ABA hull edits", () => {
  it("discards sections read across an overlapping hull edit even when its name returns to the original", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Packet ${suffix}`, slug: `packet-${suffix}`, timezone: "UTC" })
      .returning();
    const boat = await createBoat(pg.db, shop.id, "Original Hull", 12);
    const startsAt = new Date(nowDate().getTime() + 24 * 3_600_000);
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        boatId: boat.id,
        title: "Concurrent packet",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
        capacity: 10,
      })
      .returning();
    const writerDb = pg.connect();
    const readerDb = pg.connect();
    let attempts = 0;
    const versions: string[] = [];
    const result = await stablePacket(
      () => readTripPaperIdentity(readerDb, shop.id, trip.id),
      async (identity) => {
        attempts++;
        versions.push(identity.boatVersion ?? "missing");
        if (attempts === 1) {
          const updated = gate();
          const commit = gate();
          const writer = writerDb.transaction(async (tx) => {
            await tx.update(boats).set({ name: "Intermediate Hull" }).where(eq(boats.id, boat.id));
            updated.release();
            await commit.promise;
          });
          try {
            await Promise.race([updated.promise, writer]);
            // A genuinely independent connection reads while the writer transaction
            // is open: MVCC exposes the old hull, not the uncommitted new identity.
            expect((await readTripPaperIdentity(readerDb, shop.id, trip.id))?.vesselName).toBe(
              "Original Hull",
            );
          } finally {
            commit.release();
            await writer;
          }
          expect((await readTripPaperIdentity(readerDb, shop.id, trip.id))?.vesselName).toBe(
            "Intermediate Hull",
          );
          await writerDb.update(boats).set({ name: "Original Hull" }).where(eq(boats.id, boat.id));
        }
        return {
          sections: ["dives", "manifest", "prep"],
          attempt: attempts,
          vessel: identity.vesselName,
        };
      },
    );
    expect(attempts).toBe(2);
    expect(versions[0]).not.toBe(versions[1]);
    expect(result).toEqual({
      status: "stable",
      packet: { sections: ["dives", "manifest", "prep"], attempt: 2, vessel: "Original Hull" },
    });
  });
});
