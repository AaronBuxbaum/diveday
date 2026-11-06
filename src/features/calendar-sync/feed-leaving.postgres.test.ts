import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import type { AppDb } from "@/db/client";
import { capabilities, people, personRoles, shops, userAccounts } from "@/db/schema";
import { removeStaffMember, setStaffRoles } from "@/db/staff-accounts";
import type { Role } from "@/lib/authz";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { issueCalendarFeed } from "./feed-store";

/**
 * A calendar feed being issued while its holder is removed or demoted, on two real connections
 * (issues #3996, #4012). `issueCalendarFeed` locks the staffer's `people` row before it reads
 * roles; `removeStaffMember` and `setStaffRoles` take the same lock before they revoke. Without
 * it the issue can read the old roles, the removal can revoke, and the issue can then mint a live
 * feed for someone who no longer holds the role, which a re-promotion would revive.
 *
 * The gate only makes the contenders simultaneous (docs/engineering/testing.md, "Reading a race
 * test correctly"); the assertion is the outcome, a count of live feeds, never who went first.
 */

async function shopWithStaff(db: AppDb, roles: Role[]) {
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await db
    .insert(shops)
    .values({ name: `Feeds ${suffix}`, slug: `feeds-${suffix}`, timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");
  const make = async (label: string, staffRoles: Role[]) => {
    const email = `${label}-${suffix}@example.com`;
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: label, email })
      .returning();
    if (!person) throw new Error("person insert returned no row");
    await db.insert(personRoles).values(staffRoles.map((role) => ({ personId: person.id, role })));
    const [account] = await db
      .insert(userAccounts)
      .values({ personId: person.id, email, hashedPassword: "x", status: "active" })
      .returning();
    if (!account) throw new Error("account insert returned no row");
    return { personId: person.id, userAccountId: account.id };
  };
  // A second owner, so the subject is never the last one.
  await make("other-owner", ["owner"]);
  return { shopId: shop.id, subject: await make("subject", roles) };
}

async function liveFeeds(db: AppDb, personId: string) {
  return db
    .select({ id: capabilities.id })
    .from(capabilities)
    .where(and(eq(capabilities.personId, personId), isNull(capabilities.revokedAt)));
}

describePostgres("calendar feeds against a staffer leaving, on two connections", () => {
  it.each([
    ["removeStaffMember", ["owner"], "shop_trips"],
    ["removeStaffMember", ["instructor"], "assignments"],
    ["setStaffRoles with no staff role", ["owner"], "shop_trips"],
    ["setStaffRoles with no staff role", ["instructor"], "assignments"],
    ["setStaffRoles down to instructor", ["manager"], "shop_trips"],
  ] as const)("%s racing an issue of a %s feed leaves no live feed", async (door, roles, scope) => {
    const pg = await postgresTestDb();
    const { shopId, subject } = await shopWithStaff(pg.db, [...roles]);

    const gate = await holdRowLock(
      pg,
      sql`select id from people where id = ${subject.personId} for update`,
    );
    const issuing = issueCalendarFeed(pg.connect(), {
      shopId,
      personId: subject.personId,
      scope,
    });
    const leaving = door.startsWith("removeStaffMember")
      ? removeStaffMember(pg.connect(), { shopId, ...subject })
      : setStaffRoles(pg.connect(), {
          shopId,
          personId: subject.personId,
          roles: door.endsWith("instructor") ? ["instructor"] : [],
        });
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    const [issued, left] = await Promise.all([issuing, leaving]);

    expect(left).toEqual({ ok: true });
    // Either order is legal: the issue ran first and was revoked, or it ran second and was
    // refused. What may never exist is a live feed the leaver no longer earns.
    const live = await liveFeeds(pg.db, subject.personId);
    expect(live).toEqual([]);
    expect(issued === null || issued.scope === scope).toBe(true);
  });
});
