// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { calendarFeeds, people, personRoles, userAccounts } from "@/db/schema";
import { listStaff } from "@/db/trips";
import { seededShopContext } from "@/test/db";
import {
  issueCalendarFeed,
  listCalendarFeeds,
  revokeCalendarFeeds,
  revokeFeedsForFormerStaff,
  touchCalendarFeed,
  verifyCalendarFeed,
} from "./feed-store";

async function staffWithRole(role: string) {
  const { db, shop } = await seededShopContext();
  const staff = await listStaff(db, shop.id);
  const member = staff.find((entry) => entry.roles.includes(role));
  if (!member) throw new Error(`seeded shop has no ${role}`);
  return { db, shop, personId: member.person.id };
}

describe("issueCalendarFeed", () => {
  it("mints a token whose hash — not the token — is what gets stored", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const issued = await issueCalendarFeed(db, {
      shopId: shop.id,
      personId,
      scope: "assignments",
    });
    expect(issued).not.toBeNull();

    const [row] = await db
      .select({ tokenHash: calendarFeeds.tokenHash })
      .from(calendarFeeds)
      .where(eq(calendarFeeds.personId, personId));
    expect(row.tokenHash).not.toBe(issued?.token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rotating supersedes the old link immediately, so a leaked URL stops working", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const first = await issueCalendarFeed(db, { shopId: shop.id, personId, scope: "assignments" });
    const second = await issueCalendarFeed(db, { shopId: shop.id, personId, scope: "assignments" });
    if (!first || !second) throw new Error("issue failed");

    expect(await verifyCalendarFeed(db, { token: first.token })).toBeNull();
    expect(await verifyCalendarFeed(db, { token: second.token })).not.toBeNull();
    expect(await listCalendarFeeds(db, { shopId: shop.id, personId })).toHaveLength(1);
  });

  it("keeps the two scopes independent — rotating one leaves the other alone", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const assignments = await issueCalendarFeed(db, {
      shopId: shop.id,
      personId,
      scope: "assignments",
    });
    await issueCalendarFeed(db, { shopId: shop.id, personId, scope: "shop_trips" });
    await issueCalendarFeed(db, { shopId: shop.id, personId, scope: "shop_trips" });
    if (!assignments) throw new Error("issue failed");

    expect(await verifyCalendarFeed(db, { token: assignments.token })).not.toBeNull();
    expect(await listCalendarFeeds(db, { shopId: shop.id, personId })).toHaveLength(2);
  });

  it("cannot leave two live feeds for one person and scope, even by direct insert", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const issued = await issueCalendarFeed(db, {
      shopId: shop.id,
      personId,
      scope: "assignments",
    });
    if (!issued) throw new Error("issue failed");

    // The database, not `issueCalendarFeed`'s care, is what holds this line.
    // Two concurrent issues could otherwise each find nothing to revoke and
    // both insert — breaking the promise that minting a link retires the
    // previous one. Writing the second row directly is the only way to reach
    // that state here, since PGlite serializes connections.
    await expect(
      db.insert(calendarFeeds).values({
        shopId: shop.id,
        personId,
        scope: "assignments",
        tokenHash: "a".repeat(64),
      }),
    ).rejects.toThrow();

    expect(await listCalendarFeeds(db, { shopId: shop.id, personId })).toHaveLength(1);
  });

  it("still allows a fresh feed once the previous one is revoked", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    // The uniqueness is partial — on live rows only — so a revoked row must
    // never block re-subscribing, which is the whole rotation path.
    for (let i = 0; i < 3; i += 1) {
      const issued = await issueCalendarFeed(db, {
        shopId: shop.id,
        personId,
        scope: "assignments",
      });
      expect(issued).not.toBeNull();
    }
    expect(await listCalendarFeeds(db, { shopId: shop.id, personId })).toHaveLength(1);
  });

  it("refuses a shop-wide feed to a role that may not see the whole operation", async () => {
    const { db, shop } = await seededShopContext();
    const staff = await listStaff(db, shop.id);
    const crewOnly = staff.find(
      (entry) => !entry.roles.includes("owner") && !entry.roles.includes("manager"),
    );
    if (!crewOnly) throw new Error("seeded shop has no non-manager staff");

    expect(
      await issueCalendarFeed(db, {
        shopId: shop.id,
        personId: crewOnly.person.id,
        scope: "shop_trips",
      }),
    ).toBeNull();
    expect(
      await issueCalendarFeed(db, {
        shopId: shop.id,
        personId: crewOnly.person.id,
        scope: "assignments",
      }),
    ).not.toBeNull();
  });

  it("refuses a person who is not this shop's staff at all", async () => {
    const { db, shop } = await seededShopContext();
    const [diver] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, shop.id))
      .limit(1);
    // Strip every role so the person is a bare contact record.
    await db.delete(personRoles).where(eq(personRoles.personId, diver.id));

    expect(
      await issueCalendarFeed(db, { shopId: shop.id, personId: diver.id, scope: "assignments" }),
    ).toBeNull();
  });
});

describe("verifyCalendarFeed", () => {
  it("returns null for an unknown token rather than leaking that it is unknown", async () => {
    const { db } = await seededShopContext();
    expect(await verifyCalendarFeed(db, { token: "not-a-real-token" })).toBeNull();
  });

  it("re-derives authorization on every fetch, so losing a role kills a live feed", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const issued = await issueCalendarFeed(db, {
      shopId: shop.id,
      personId,
      scope: "assignments",
    });
    if (!issued) throw new Error("issue failed");
    expect(await verifyCalendarFeed(db, { token: issued.token })).not.toBeNull();

    // The staff member leaves. Nobody revokes the feed row.
    await db.delete(personRoles).where(eq(personRoles.personId, personId));

    expect(await verifyCalendarFeed(db, { token: issued.token })).toBeNull();
  });

  it("kills a shop-wide feed when the holder is demoted below owner/manager", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const issued = await issueCalendarFeed(db, {
      shopId: shop.id,
      personId,
      scope: "shop_trips",
    });
    if (!issued) throw new Error("issue failed");

    await db.delete(personRoles).where(eq(personRoles.personId, personId));
    await db.insert(personRoles).values({ personId, role: "crew" });

    // The credential still exists and is unrevoked; the scope is what fails.
    expect(await verifyCalendarFeed(db, { token: issued.token })).toBeNull();
  });

  it("stops serving a suspended account, which keeps its roles by design", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const issued = await issueCalendarFeed(db, {
      shopId: shop.id,
      personId,
      scope: "assignments",
    });
    if (!issued) throw new Error("issue failed");
    expect(await verifyCalendarFeed(db, { token: issued.token })).not.toBeNull();

    // `setStaffAccountStatus(..., "disabled")` revokes sign-in and deliberately
    // leaves person_roles intact, so a roles-only gate would keep this feed
    // live for someone who has just been suspended.
    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, personId));

    expect(await verifyCalendarFeed(db, { token: issued.token })).toBeNull();
  });

  it("still serves a staff member who has no sign-in account at all", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    await db.delete(userAccounts).where(eq(userAccounts.personId, personId));

    const issued = await issueCalendarFeed(db, {
      shopId: shop.id,
      personId,
      scope: "assignments",
    });
    if (!issued) throw new Error("issue failed");
    expect(await verifyCalendarFeed(db, { token: issued.token })).not.toBeNull();
  });

  it("returns null once the feed is revoked", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const issued = await issueCalendarFeed(db, {
      shopId: shop.id,
      personId,
      scope: "assignments",
    });
    if (!issued) throw new Error("issue failed");

    await revokeCalendarFeeds(db, { shopId: shop.id, personId, scope: "assignments" });
    expect(await verifyCalendarFeed(db, { token: issued.token })).toBeNull();
  });

  it("carries the shop's locale and timezone so the feed can speak the shop's language", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const issued = await issueCalendarFeed(db, {
      shopId: shop.id,
      personId,
      scope: "assignments",
    });
    if (!issued) throw new Error("issue failed");

    const context = await verifyCalendarFeed(db, { token: issued.token });
    expect(context?.shopSlug).toBe(shop.slug);
    expect(context?.shopTimezone).toBe(shop.timezone);
    expect(context?.personId).toBe(personId);
  });
});

describe("feed housekeeping", () => {
  it("stamps the last fetch so staff can tell a live subscription from a dead URL", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const issued = await issueCalendarFeed(db, {
      shopId: shop.id,
      personId,
      scope: "assignments",
    });
    if (!issued) throw new Error("issue failed");

    const [before] = await listCalendarFeeds(db, { shopId: shop.id, personId });
    expect(before.lastAccessedAt).toBeNull();

    const context = await verifyCalendarFeed(db, { token: issued.token });
    if (!context) throw new Error("verify failed");
    const fetchedAt = new Date("2026-08-01T09:00:00.000Z");
    await touchCalendarFeed(db, { feedId: context.feedId, now: fetchedAt });

    const [after] = await listCalendarFeeds(db, { shopId: shop.id, personId });
    expect(after.lastAccessedAt?.toISOString()).toBe(fetchedAt.toISOString());
  });

  it("cleans up feeds held by people who no longer have any staff role", async () => {
    const { db, shop } = await seededShopContext();
    const staff = await listStaff(db, shop.id);
    const leaver = staff.find((entry) => entry.roles.includes("owner"));
    const stayer = staff.find((entry) => entry.person.id !== leaver?.person.id);
    if (!leaver || !stayer) throw new Error("seeded shop needs two staff");

    await issueCalendarFeed(db, {
      shopId: shop.id,
      personId: leaver.person.id,
      scope: "assignments",
    });
    await issueCalendarFeed(db, {
      shopId: shop.id,
      personId: stayer.person.id,
      scope: "assignments",
    });

    await db.delete(personRoles).where(eq(personRoles.personId, leaver.person.id));
    await revokeFeedsForFormerStaff(db, { shopId: shop.id });

    expect(
      await listCalendarFeeds(db, { shopId: shop.id, personId: leaver.person.id }),
    ).toHaveLength(0);
    expect(
      await listCalendarFeeds(db, { shopId: shop.id, personId: stayer.person.id }),
    ).toHaveLength(1);

    // Revoked, not deleted: the row stays as the audit trail of a credential
    // that once existed.
    const [leaverRow] = await db
      .select({ revokedAt: calendarFeeds.revokedAt })
      .from(calendarFeeds)
      .where(and(eq(calendarFeeds.shopId, shop.id), eq(calendarFeeds.personId, leaver.person.id)));
    expect(leaverRow.revokedAt).not.toBeNull();
  });
});
