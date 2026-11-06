import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { AppDb } from "@/db/client";
import { capabilities, people, personRoles, userAccounts } from "@/db/schema";
import { setStaffAccountStatus, setStaffRoles } from "@/db/staff-accounts";
import type { Role } from "@/lib/authz";
import { fileScopedShopContext } from "@/test/db";
import { issueCalendarFeed, verifyCalendarFeed } from "./feed-store";

/**
 * Calendar feeds across a role change (issue #4012): a feed is a staff credential, so losing the
 * role that earned it ends the link for good, and a later re-promotion does not revive it.
 */
const ctx = fileScopedShopContext();

let seq = 0;

async function makeStaff(db: AppDb, shopId: string, roles: Role[]) {
  seq += 1;
  const [person] = await db
    .insert(people)
    .values({ shopId, fullName: `Feed Staff ${seq}`, email: `feed.staff.${seq}@example.com` })
    .returning();
  if (!person) throw new Error("failed to insert staff");
  await db.insert(personRoles).values(roles.map((role) => ({ personId: person.id, role })));
  return person.id;
}

async function bothFeeds(db: AppDb, shopId: string, personId: string) {
  const shopTrips = await issueCalendarFeed(db, { shopId, personId, scope: "shop_trips" });
  const assignments = await issueCalendarFeed(db, { shopId, personId, scope: "assignments" });
  if (!shopTrips || !assignments) throw new Error("issue failed");
  return { shopTrips: shopTrips.token, assignments: assignments.token };
}

async function liveFeedPurposes(db: AppDb, personId: string) {
  const rows = await db
    .select({ purpose: capabilities.purpose })
    .from(capabilities)
    .where(and(eq(capabilities.personId, personId), isNull(capabilities.revokedAt)));
  return rows.map((row) => row.purpose).sort();
}

describe("setStaffRoles and calendar feeds", () => {
  it("a manager demoted below manager loses the shop feed for good, even if promoted again", async () => {
    const { db, shop } = ctx;
    const personId = await makeStaff(db, shop.id, ["manager"]);
    const feeds = await bothFeeds(db, shop.id, personId);

    expect(await setStaffRoles(db, { shopId: shop.id, personId, roles: ["instructor"] })).toEqual({
      ok: true,
    });
    // The assignments feed is still earned by any staff role.
    expect(await liveFeedPurposes(db, personId)).toEqual(["calendar_assignments"]);
    expect(await verifyCalendarFeed(db, { token: feeds.assignments })).not.toBeNull();

    await setStaffRoles(db, { shopId: shop.id, personId, roles: ["manager"] });
    expect(await verifyCalendarFeed(db, { token: feeds.shopTrips })).toBeNull();
  });

  it("someone left with no staff role loses both feeds for good", async () => {
    const { db, shop } = ctx;
    const personId = await makeStaff(db, shop.id, ["manager", "instructor"]);
    const feeds = await bothFeeds(db, shop.id, personId);

    await setStaffRoles(db, { shopId: shop.id, personId, roles: [] });
    expect(await liveFeedPurposes(db, personId)).toEqual([]);

    await setStaffRoles(db, { shopId: shop.id, personId, roles: ["manager"] });
    expect(await verifyCalendarFeed(db, { token: feeds.shopTrips })).toBeNull();
    expect(await verifyCalendarFeed(db, { token: feeds.assignments })).toBeNull();
  });

  it("keeps the shop feed while the person is still an owner or a manager", async () => {
    const { db, shop } = ctx;
    const personId = await makeStaff(db, shop.id, ["manager"]);
    const feeds = await bothFeeds(db, shop.id, personId);

    await setStaffRoles(db, { shopId: shop.id, personId, roles: ["owner", "crew"] });
    expect(await verifyCalendarFeed(db, { token: feeds.shopTrips })).not.toBeNull();
    expect(await liveFeedPurposes(db, personId)).toEqual([
      "calendar_assignments",
      "calendar_shop_trips",
    ]);
  });

  it("revokes nothing in another shop's name", async () => {
    const { db, shop } = ctx;
    const personId = await makeStaff(db, shop.id, ["manager"]);
    await bothFeeds(db, shop.id, personId);

    const result = await setStaffRoles(db, {
      shopId: "00000000-0000-4000-8000-000000000000",
      personId,
      roles: [],
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(await liveFeedPurposes(db, personId)).toHaveLength(2);
  });
});

describe("a temporary disable", () => {
  it("keeps the feeds, which are refused while disabled and work again on a re-enable", async () => {
    const { db, shop } = ctx;
    const personId = await makeStaff(db, shop.id, ["manager"]);
    const [account] = await db
      .insert(userAccounts)
      .values({
        personId,
        email: `feed.staff.${seq}@example.com`,
        hashedPassword: "x",
        status: "active",
      })
      .returning();
    if (!account) throw new Error("account insert failed");
    const feeds = await bothFeeds(db, shop.id, personId);
    const change = (status: "active" | "disabled") =>
      setStaffAccountStatus(db, {
        shopId: shop.id,
        personId,
        userAccountId: account.id,
        status,
      });

    await change("disabled");
    expect(await verifyCalendarFeed(db, { token: feeds.shopTrips })).toBeNull();
    await change("active");
    expect(await verifyCalendarFeed(db, { token: feeds.shopTrips })).not.toBeNull();
  });
});
