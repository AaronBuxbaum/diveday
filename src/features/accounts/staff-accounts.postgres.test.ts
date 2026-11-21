import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { people, personRoles, shops } from "../../db/schema/index";
import type { Role } from "../../lib/authz";
import { describePostgres, postgresTestDb } from "../../test/postgres";
import { setStaffRoles } from "./staff-accounts";

/**
 * **Staff role saves under real concurrency** (issue #4595). `setStaffRoles` takes the shop row
 * lock before it reads anything, so the baseline comparison and the last-owner check both run
 * with the other writer already committed. PGlite runs one session and never blocks, so only a
 * real server exercises it. The assertions are on the outcome, never on who won.
 */
describePostgres("setStaffRoles under real concurrency", () => {
  async function shopWith(roles: Role[][]) {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Roles ${suffix}`, slug: `roles-${suffix}`, timezone: "UTC" })
      .returning();
    const staff = await pg.db
      .insert(people)
      .values(
        roles.map((_, index) => ({
          shopId: shop.id,
          fullName: `Staff ${index}`,
          email: `staff-${index}-${suffix}@example.com`,
        })),
      )
      .returning();
    await pg.db
      .insert(personRoles)
      .values(
        staff.flatMap((person, index) =>
          (roles[index] ?? []).map((role) => ({ personId: person.id, role })),
        ),
      );
    return { db: pg.db, shop, staff };
  }

  it("lets exactly one of two saves from the same baseline win", async () => {
    const { db, shop, staff } = await shopWith([["owner"], ["crew"]]);
    const target = staff[1];
    const save = (roles: Role[]) =>
      setStaffRoles(db, { shopId: shop.id, personId: target.id, roles, baseline: ["crew"] });
    const results = await Promise.all([save(["captain"]), save(["divemaster"])]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, reason: "roles_conflict" },
    ]);
  });

  it("never lets two simultaneous demotions remove the last owners", async () => {
    const { db, shop, staff } = await shopWith([["owner"], ["owner"]]);
    const demote = (personId: string) =>
      setStaffRoles(db, { shopId: shop.id, personId, roles: ["manager"] });
    const results = await Promise.all(staff.map((person) => demote(person.id)));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const owners = await db
      .select({ id: personRoles.personId })
      .from(personRoles)
      .where(eq(personRoles.role, "owner"));
    expect(owners.filter((row) => staff.some((person) => person.id === row.id))).toHaveLength(1);
  });
});
