import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { mergeDiverRecords } from "./diver-merge";
import { people, personRoles, tripAssignments, trips } from "./schema";
import { createTrip } from "./trips";

const ctx = fileScopedShopContext();
const HOUR = 3_600_000;

/**
 * **A staff record refuses a merge, whichever side holds it** (issue #4600).
 * `assessMerge` asks every staff table in one query for both records; these
 * cases hold a staff-history arm on the merged-away and the kept side, and a
 * clean pair beside them. The capability arm is held in `capabilities.test.ts`.
 */
async function pair(tag: string) {
  const { db, shop } = ctx;
  const [source, survivor] = await db
    .insert(people)
    .values([
      { shopId: shop.id, fullName: `Merge ${tag}`, email: `${tag}-old@example.com` },
      { shopId: shop.id, fullName: `Merge ${tag}`, email: `${tag}-new@example.com` },
    ])
    .returning();
  if (!source || !survivor) throw new Error("fixture insert failed");
  await db.insert(personRoles).values([
    { personId: source.id, role: "diver" },
    { personId: survivor.id, role: "diver" },
  ]);
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!owner) throw new Error("expected the seeded owner");
  return { source, survivor, owner: owner.id };
}

async function departure() {
  const { db, shop } = ctx;
  const now = nowDate();
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Merge staff departure",
    capacity: 6,
    plannedDives: 1,
    startsAt: new Date(now.getTime() + 72 * HOUR),
    endsAt: new Date(now.getTime() + 76 * HOUR),
  });
  if (!trip) throw new Error("departure missing");
  return trip;
}

function merge(p: Awaited<ReturnType<typeof pair>>) {
  return mergeDiverRecords({
    db: ctx.db,
    shopId: ctx.shop.id,
    personId: p.source.id,
    survivorId: p.survivor.id,
    actorPersonId: p.owner,
  });
}

describe("diver merge, staff records", () => {
  it("merges two plain diver records", async () => {
    expect(await merge(await pair("clean"))).toMatchObject({ ok: true });
  });

  for (const side of ["source", "survivor"] as const) {
    it(`refuses when the ${side} is rostered crew on a departure`, async () => {
      const { db, shop } = ctx;
      const p = await pair(`crew-${side}`);
      const trip = await departure();
      await db.insert(tripAssignments).values({
        tripId: trip.id,
        personId: p[side].id,
        shopId: shop.id,
      } as typeof tripAssignments.$inferInsert);
      expect(await merge(p)).toMatchObject({ ok: false, reason: "staff_record" });
    });
  }

  it("keeps a trip's own rows out of it: a departure with no crew leaves a pair mergeable", async () => {
    await departure();
    expect(await ctx.db.select({ id: trips.id }).from(trips)).not.toHaveLength(0);
    expect(await merge(await pair("departure-only"))).toMatchObject({ ok: true });
  });
});
