import { and, eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import { people, processorErasureObligations } from "../../db/schema/index";
import { resetDemoSchedule } from "../../db/seed";
import { recordProcessorErasureObligations } from "../../features/records/processor-erasure";
import { nowDate } from "../../lib/clock";
import { fileScopedShopContext } from "../db";
import { oweStripeTwoErasures } from "./trouble-panels";

const ctx = fileScopedShopContext();

it("resets the erased-diver fixture without discarding a stable staff obligation", async () => {
  const { db, shop } = ctx;
  const [actor] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Dana Reyes")));
  if (!actor) throw new Error("Seeded owner missing");
  await recordProcessorErasureObligations(db, {
    shopId: shop.id,
    personId: actor.id,
    targets: [
      {
        target: "stripe_customer",
        externalId: "cus_retained_control",
        stripeAccountId: "acct_e2e_test",
      },
    ],
  });
  const now = nowDate();
  await oweStripeTwoErasures(db, shop.id, actor.id, now);
  await oweStripeTwoErasures(db, shop.id, actor.id, now);
  const fixtureRows = await db
    .select()
    .from(processorErasureObligations)
    .where(
      and(
        eq(processorErasureObligations.shopId, shop.id),
        inArray(processorErasureObligations.externalId, ["cus_e2e_owed", "in_e2e_owed"]),
      ),
    );
  expect(fixtureRows).toHaveLength(2);
  expect(new Set(fixtureRows.map((row) => row.personId)).size).toBe(1);
  const fixturePersonId = fixtureRows[0]?.personId;
  if (!fixturePersonId) throw new Error("Erasure fixture has no person");
  expect(fixturePersonId).not.toBe(actor.id);
  const [erased] = await db.select().from(people).where(eq(people.id, fixturePersonId));
  expect(erased).toMatchObject({
    fullName: "Erased diver",
    anonymizedAt: now,
    deletedAt: now,
  });

  await resetDemoSchedule(db, shop.id, "lean");

  expect(
    await db
      .select({ externalId: processorErasureObligations.externalId })
      .from(processorErasureObligations)
      .where(eq(processorErasureObligations.shopId, shop.id)),
  ).toEqual([{ externalId: "cus_retained_control" }]);
});
