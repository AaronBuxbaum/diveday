import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { createInvitationUnderCooldown } from "./invite-suggestions";
import { interests, people, personRoles, shops, trips } from "./schema";

/**
 * **The 30-day invite cooldown under real concurrency** (H-20261014-one-to-one-invite; security
 * review N2). Two staffers inviting the same person to two different
 * departures at the same moment must not both pass the cooldown check: the
 * check and the insert run under one advisory lock on (shop, person), so the
 * second sees the first's row. PGlite runs one session and never blocks, so
 * only a real server exercises it. The test asserts the outcome (one invite
 * recorded), never who won; removing the advisory lock lets both through.
 */
describePostgres("createInvitationUnderCooldown under real concurrency", () => {
  it("records exactly one of two simultaneous invites to two departures", async () => {
    const pg = await postgresTestDb();
    const db = pg.db;
    const suffix = randomBytes(4).toString("hex");
    const now = nowDate();
    const [shop] = await db
      .insert(shops)
      .values({ name: `Cooldown ${suffix}`, slug: `cooldown-${suffix}`, timezone: "UTC" })
      .returning();
    const [author, diver] = await db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Desk Author", email: `author-${suffix}@example.com` },
        { shopId: shop.id, fullName: "Asked Twice", email: `diver-${suffix}@example.com` },
      ])
      .returning();
    await db.insert(personRoles).values([
      { personId: author.id, role: "owner" },
      { personId: diver.id, role: "diver" },
    ]);
    const departure = async (days: number) => {
      const startsAt = new Date(now.getTime() + days * DAY_MS);
      const [row] = await db
        .insert(trips)
        .values({
          shopId: shop.id,
          title: `Departure ${days}`,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
          capacity: 8,
        })
        .returning();
      return row;
    };
    const [first, second] = [await departure(5), await departure(9)];
    const input = { shopId: shop.id, personId: diver.id, createdByPersonId: author.id, now };

    const outcomes = await Promise.all([
      createInvitationUnderCooldown(db, { ...input, tripId: first.id }),
      createInvitationUnderCooldown(db, { ...input, tripId: second.id }),
    ]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["cooldown", "created"]);
    const rows = await db
      .select({ id: interests.id })
      .from(interests)
      .where(and(eq(interests.shopId, shop.id), eq(interests.personId, diver.id)));
    expect(rows).toHaveLength(1);
  });
});
