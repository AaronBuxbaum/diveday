import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { recordMedicalAlertTrailLine } from "./medical-alerts";
import { activityEvents, people, shops } from "./schema";

/**
 * **One read line per reader, diver and departure in ten minutes, under real
 * concurrency** (H-20261023-medical-alert-for-the amendment; security review 2, L5). Parallel taps or
 * parallel offline saves must not each write a line: the check and the
 * insert run under one advisory lock on (shop, code, reader, diver,
 * departure). PGlite runs one session and never blocks, so only a real server
 * exercises it; removing the lock lets several through.
 */
describePostgres("recordMedicalAlertTrailLine under real concurrency", () => {
  it("writes exactly one line for five simultaneous reads", async () => {
    const pg = await postgresTestDb();
    const db = pg.db;
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await db
      .insert(shops)
      .values({ name: `Alert ${suffix}`, slug: `alert-${suffix}`, timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop insert failed");
    const [reader, diver] = await db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Rail Reader" },
        { shopId: shop.id, fullName: "Alerted Diver" },
      ])
      .returning();
    if (!reader || !diver) throw new Error("people insert failed");
    const departureId = crypto.randomUUID();

    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () =>
        recordMedicalAlertTrailLine(db, {
          shopId: shop.id,
          personId: diver.id,
          actorPersonId: reader.id,
          code: "medical_alert_saved_offline",
          departureId,
        }),
      ),
    );

    expect(outcomes).toEqual([true, true, true, true, true]);
    const lines = await db
      .select({ id: activityEvents.id })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.shopId, shop.id),
          eq(activityEvents.subjectPersonId, diver.id),
          eq(activityEvents.code, "medical_alert_saved_offline"),
        ),
      );
    expect(lines).toHaveLength(1);
  });
});
