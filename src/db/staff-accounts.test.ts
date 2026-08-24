import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { upcomingTripsWithCounts } from "@/db/trips";
import type { Role } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { savePushSubscription } from "./push-subscriptions";
import { people, personRoles, pushSubscriptions, shops, userAccounts } from "./schema";
import {
  inviteStaffMember,
  listShopSpokenLanguages,
  listShopStaff,
  removeStaffMember,
  setStaffAccountStatus,
  setStaffEmergencyContact,
  setStaffLanguages,
  setStaffRoles,
} from "./staff-accounts";

let seq = 0;

/** A staff person with a real account, for scenarios that need one already in place. */
async function makeStaff(
  db: AppDb,
  shopId: string,
  roles: Role[],
  opts: { status?: "invited" | "active" | "disabled" } = {},
): Promise<{ personId: string; userAccountId: string }> {
  seq += 1;
  const [person] = await db
    .insert(people)
    .values({ shopId, fullName: `Staff ${seq}`, email: `staff.${seq}@example.com` })
    .returning();
  if (!person) throw new Error("failed to insert staff");
  if (roles.length > 0) {
    await db.insert(personRoles).values(roles.map((role) => ({ personId: person.id, role })));
  }
  const [account] = await db
    .insert(userAccounts)
    .values({
      personId: person.id,
      email: `staff.${seq}@example.com`,
      hashedPassword: "x",
      status: opts.status ?? "active",
    })
    .returning();
  if (!account) throw new Error("failed to insert account");
  return { personId: person.id, userAccountId: account.id };
}

/**
 * The seeded demo shop already has its own owner (the seed's dev login), so a
 * test proving "last owner" behavior must first strip every *other* owner —
 * otherwise the freshly-made test owner is never actually the shop's only one.
 */
async function stripOtherOwners(db: AppDb, shopId: string, keepPersonId: string): Promise<void> {
  const others = await db
    .select({ personId: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(eq(people.shopId, shopId), eq(personRoles.role, "owner"), ne(people.id, keepPersonId)),
    );
  for (const other of others) {
    await db
      .delete(personRoles)
      .where(and(eq(personRoles.personId, other.personId), eq(personRoles.role, "owner")));
  }
}

async function makeOtherShop(db: AppDb): Promise<string> {
  seq += 1;
  const [shop] = await db
    .insert(shops)
    .values({ name: `Other Shop ${seq}`, slug: `other-shop-${seq}`, timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("failed to insert shop");
  return shop.id;
}

describe("inviteStaffMember", () => {
  it("creates a new person, roles, and an invited account when no person matches the email", async () => {
    const { db, shop } = await seededShopContext();
    const result = await inviteStaffMember(db, {
      shopId: shop.id,
      fullName: "Nadia Reyes",
      email: "Nadia@Example.com",
      roles: ["instructor"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const [account] = await db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.id, result.userAccountId));
    expect(account?.status).toBe("invited");
    expect(account?.email).toBe("nadia@example.com");

    const roles = await db
      .select({ role: personRoles.role })
      .from(personRoles)
      .where(eq(personRoles.personId, result.personId));
    expect(roles.map((r) => r.role)).toEqual(["instructor"]);
  });

  it("reuses an existing active diver's person record instead of forking a new one", async () => {
    const { db, shop } = await seededShopContext();
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Theo Marsh", email: "theo@example.com" })
      .returning();
    if (!diver) throw new Error("failed to insert diver");
    await db.insert(personRoles).values({ personId: diver.id, role: "diver" });

    const result = await inviteStaffMember(db, {
      shopId: shop.id,
      fullName: "Theo Marsh",
      email: "theo@example.com",
      roles: ["captain"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.personId).toBe(diver.id);

    const roles = (
      await db
        .select({ role: personRoles.role })
        .from(personRoles)
        .where(eq(personRoles.personId, diver.id))
    ).map((r) => r.role);
    expect(roles.sort()).toEqual(["captain", "diver"]);
  });

  it("refuses already_on_team when the matched person already has an account", async () => {
    const { db, shop } = await seededShopContext();
    const existing = await makeStaff(db, shop.id, ["crew"]);
    const [person] = await db.select().from(people).where(eq(people.id, existing.personId));
    if (!person?.email) throw new Error("expected seeded email");

    const result = await inviteStaffMember(db, {
      shopId: shop.id,
      fullName: person.fullName,
      email: person.email,
      roles: ["captain"],
    });
    expect(result).toEqual({ ok: false, reason: "already_on_team" });
  });

  it("refuses email_registered_elsewhere when the email belongs to a different shop's account", async () => {
    const { db, shop } = await seededShopContext();
    const otherShopId = await makeOtherShop(db);
    await makeStaff(db, otherShopId, ["owner"]);
    // makeStaff's account email is staff.<seq>@example.com — reuse that seq for the invite.
    const [account] = await db
      .select({ email: userAccounts.email })
      .from(userAccounts)
      .innerJoin(people, eq(people.id, userAccounts.personId))
      .where(eq(people.shopId, otherShopId));
    if (!account) throw new Error("expected seeded account");

    const result = await inviteStaffMember(db, {
      shopId: shop.id,
      fullName: "Cross Shop",
      email: account.email,
      roles: ["crew"],
    });
    expect(result).toEqual({ ok: false, reason: "email_registered_elsewhere" });
  });

  /**
   * **The demo namespace is an invariant of this write path, not a hope**
   * (security review finding; ADR 20260803-demo-bypass-containment, amended).
   *
   * The demo sign-in bypass's third condition is "the account's email sits in
   * `*.demo.invalid`". Its containment argument was that no *real* account can
   * be there, because this function mails the invite and `.invalid` never
   * resolves — a behavioural argument, not an enforced one. It left exactly one
   * combination open: a tenant that already holds an account in the namespace,
   * then has `is_demo` flipped by an insider or a bad migration, at which point
   * `DEMO_BYPASS_PASSWORD` opens a real shop. Refusing here closes it, and no
   * account row must be written on the way out.
   */
  describe("the reserved demo namespace", () => {
    it.each([
      "mallory@demo.invalid",
      "mallory@coral-cove-divers-a1b2c3.demo.invalid",
      "MALLORY@Demo.Invalid",
    ])("refuses an invite to %s", async (email) => {
      const { db, shop } = await seededShopContext();
      const result = await inviteStaffMember(db, {
        shopId: shop.id,
        fullName: "Mallory",
        email,
        roles: ["crew"],
      });
      expect(result).toEqual({ ok: false, reason: "email_reserved" });

      const rows = await db
        .select({ id: userAccounts.id })
        .from(userAccounts)
        .where(eq(userAccounts.email, email.toLowerCase()));
      expect(rows).toHaveLength(0);
    });

    /** Anchored: a lookalike registrable domain is an ordinary, invitable address. */
    it.each(["crew@notdemo.invalid", "crew@demo.invalid.example.com"])(
      "still invites %s",
      async (email) => {
        const { db, shop } = await seededShopContext();
        const result = await inviteStaffMember(db, {
          shopId: shop.id,
          fullName: "Ordinary Crew",
          email,
          roles: ["crew"],
        });
        expect(result.ok).toBe(true);
      },
    );
  });
});

describe("setStaffRoles", () => {
  it("replaces the staff-role subset without touching a diver role", async () => {
    const { db, shop } = await seededShopContext();
    const staff = await makeStaff(db, shop.id, ["crew"]);
    await db.insert(personRoles).values({ personId: staff.personId, role: "diver" });

    const result = await setStaffRoles(db, {
      shopId: shop.id,
      personId: staff.personId,
      roles: ["divemaster", "instructor"],
    });
    expect(result).toEqual({ ok: true });

    const roles = (
      await db
        .select({ role: personRoles.role })
        .from(personRoles)
        .where(eq(personRoles.personId, staff.personId))
    ).map((r) => r.role);
    expect(roles.sort()).toEqual(["divemaster", "diver", "instructor"]);
  });

  it("refuses to strip the shop's last owner", async () => {
    const { db, shop } = await seededShopContext();
    const owner = await makeStaff(db, shop.id, ["owner"]);
    await stripOtherOwners(db, shop.id, owner.personId);

    const result = await setStaffRoles(db, {
      shopId: shop.id,
      personId: owner.personId,
      roles: ["manager"],
    });
    expect(result).toEqual({ ok: false, reason: "last_owner" });

    const roles = (
      await db
        .select({ role: personRoles.role })
        .from(personRoles)
        .where(eq(personRoles.personId, owner.personId))
    ).map((r) => r.role);
    expect(roles).toEqual(["owner"]);
  });

  it("allows demoting an owner when a second owner remains", async () => {
    const { db, shop } = await seededShopContext();
    const first = await makeStaff(db, shop.id, ["owner"]);
    await makeStaff(db, shop.id, ["owner"]);

    const result = await setStaffRoles(db, {
      shopId: shop.id,
      personId: first.personId,
      roles: ["manager"],
    });
    expect(result).toEqual({ ok: true });
  });
});

describe("setStaffAccountStatus", () => {
  it("refuses to disable the shop's last owner", async () => {
    const { db, shop } = await seededShopContext();
    const owner = await makeStaff(db, shop.id, ["owner"]);
    await stripOtherOwners(db, shop.id, owner.personId);

    const result = await setStaffAccountStatus(db, {
      shopId: shop.id,
      personId: owner.personId,
      userAccountId: owner.userAccountId,
      status: "disabled",
    });
    expect(result).toEqual({ ok: false, reason: "last_owner" });

    const [account] = await db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.id, owner.userAccountId));
    expect(account?.status).toBe("active");
  });

  it("disables a non-owner's account", async () => {
    const { db, shop } = await seededShopContext();
    const crew = await makeStaff(db, shop.id, ["crew"]);

    const result = await setStaffAccountStatus(db, {
      shopId: shop.id,
      personId: crew.personId,
      userAccountId: crew.userAccountId,
      status: "disabled",
    });
    expect(result).toEqual({ ok: true });

    const [account] = await db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.id, crew.userAccountId));
    expect(account?.status).toBe("disabled");
  });
});

describe("removeStaffMember", () => {
  it("revokes the leaver's push subscriptions, which a disabled account does not reach", async () => {
    // The `people` row deliberately survives a removal, so the subscription's
    // ON DELETE CASCADE never fires, and the send path filters on shop and trip
    // rather than on who still works here. Without an explicit delete a
    // departed divemaster's phone keeps being told a boat's manifest changed
    // after their login stopped working (ADR 20260804-manifest-web-push).
    const { db, shop } = await seededShopContext();
    const staff = await makeStaff(db, shop.id, ["crew"]);
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const trip = trips[0];
    if (!trip) throw new Error("expected a seeded trip");
    await savePushSubscription(db, {
      shopId: shop.id,
      tripId: trip.id,
      personId: staff.personId,
      endpoint: "https://fcm.googleapis.com/fcm/send/leaver-device",
      p256dh: "p",
      auth: "a",
    });

    await removeStaffMember(db, {
      shopId: shop.id,
      personId: staff.personId,
      userAccountId: staff.userAccountId,
    });

    expect(
      await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.personId, staff.personId)),
    ).toHaveLength(0);
  });

  it("strips staff roles and disables the account, leaving a diver role in place", async () => {
    const { db, shop } = await seededShopContext();
    const staff = await makeStaff(db, shop.id, ["crew"]);
    await db.insert(personRoles).values({ personId: staff.personId, role: "diver" });

    const result = await removeStaffMember(db, {
      shopId: shop.id,
      personId: staff.personId,
      userAccountId: staff.userAccountId,
    });
    expect(result).toEqual({ ok: true });

    const roles = (
      await db
        .select({ role: personRoles.role })
        .from(personRoles)
        .where(eq(personRoles.personId, staff.personId))
    ).map((r) => r.role);
    expect(roles).toEqual(["diver"]);

    const [account] = await db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.id, staff.userAccountId));
    expect(account?.status).toBe("disabled");
  });

  it("refuses to remove the shop's last owner", async () => {
    const { db, shop } = await seededShopContext();
    const owner = await makeStaff(db, shop.id, ["owner"]);
    await stripOtherOwners(db, shop.id, owner.personId);

    const result = await removeStaffMember(db, {
      shopId: shop.id,
      personId: owner.personId,
      userAccountId: owner.userAccountId,
    });
    expect(result).toEqual({ ok: false, reason: "last_owner" });
  });
});

describe("tenant isolation (security review finding, 20260726-staff-invite-accounts)", () => {
  it("setStaffRoles refuses a personId that belongs to a different shop", async () => {
    const { db, shop } = await seededShopContext();
    const otherShopId = await makeOtherShop(db);
    const outsider = await makeStaff(db, otherShopId, ["crew"]);

    const result = await setStaffRoles(db, {
      shopId: shop.id,
      personId: outsider.personId,
      roles: ["owner"],
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });

    const roles = (
      await db
        .select({ role: personRoles.role })
        .from(personRoles)
        .where(eq(personRoles.personId, outsider.personId))
    ).map((r) => r.role);
    expect(roles).toEqual(["crew"]);
  });

  it("setStaffAccountStatus refuses a personId/userAccountId pair from a different shop", async () => {
    const { db, shop } = await seededShopContext();
    const otherShopId = await makeOtherShop(db);
    const outsider = await makeStaff(db, otherShopId, ["crew"]);

    const result = await setStaffAccountStatus(db, {
      shopId: shop.id,
      personId: outsider.personId,
      userAccountId: outsider.userAccountId,
      status: "disabled",
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });

    const [account] = await db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.id, outsider.userAccountId));
    expect(account?.status).toBe("active");
  });

  it("setStaffAccountStatus refuses a userAccountId that doesn't belong to the given personId", async () => {
    const { db, shop } = await seededShopContext();
    const a = await makeStaff(db, shop.id, ["crew"]);
    const b = await makeStaff(db, shop.id, ["crew"]);

    // a's personId paired with b's userAccountId — the two must belong to
    // the same person, not merely the same shop.
    const result = await setStaffAccountStatus(db, {
      shopId: shop.id,
      personId: a.personId,
      userAccountId: b.userAccountId,
      status: "disabled",
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });

    const [account] = await db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.id, b.userAccountId));
    expect(account?.status).toBe("active");
  });

  it("removeStaffMember refuses a personId/userAccountId pair from a different shop", async () => {
    const { db, shop } = await seededShopContext();
    const otherShopId = await makeOtherShop(db);
    const outsider = await makeStaff(db, otherShopId, ["crew"]);

    const result = await removeStaffMember(db, {
      shopId: shop.id,
      personId: outsider.personId,
      userAccountId: outsider.userAccountId,
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });

    const roles = (
      await db
        .select({ role: personRoles.role })
        .from(personRoles)
        .where(eq(personRoles.personId, outsider.personId))
    ).map((r) => r.role);
    expect(roles).toEqual(["crew"]);
    const [account] = await db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.id, outsider.userAccountId));
    expect(account?.status).toBe("active");
  });
});

describe("listShopStaff", () => {
  it("aggregates each staff person's roles once, sorted by name, excluding divers-only", async () => {
    const { db, shop } = await seededShopContext();
    const zed = await makeStaff(db, shop.id, ["instructor", "divemaster"]);
    const [diverOnly] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Diver Only", email: "diver-only@example.com" })
      .returning();
    if (!diverOnly) throw new Error("failed to insert diver");
    await db.insert(personRoles).values({ personId: diverOnly.id, role: "diver" });

    const staff = await listShopStaff(db, shop.id);
    const zedRow = staff.find((member) => member.personId === zed.personId);
    expect(zedRow?.roles.sort()).toEqual(["divemaster", "instructor"]);
    expect(staff.some((member) => member.personId === diverOnly.id)).toBe(false);

    const names = staff.map((member) => member.fullName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe("setStaffEmergencyContact", () => {
  // Why this exists at all: the printed boat manifest carries every diver's
  // emergency contact and carried none for crew, so the paper a coastguard
  // reads answered "who do we call?" for the paying passengers and for neither
  // of the two staff most reliably in the water (dive-domain review 20260810).
  it("stores both halves and reads them back through listShopStaff", async () => {
    const { db, shop } = await seededShopContext();
    const { personId } = await makeStaff(db, shop.id, ["captain"]);

    const result = await setStaffEmergencyContact(db, {
      shopId: shop.id,
      personId,
      name: "  Marta Okonkwo (sister)  ",
      phone: "  +1-305-555-0114  ",
    });

    expect(result).toEqual({ ok: true });
    const member = (await listShopStaff(db, shop.id)).find((s) => s.personId === personId);
    // Trimmed on the way in — a trailing space is invisible on screen and
    // makes an exact-match read of the stored value fail for no visible reason.
    expect(member).toMatchObject({
      emergencyContactName: "Marta Okonkwo (sister)",
      emergencyContactPhone: "+1-305-555-0114",
    });
  });

  it("clears both halves when both are emptied", async () => {
    const { db, shop } = await seededShopContext();
    const { personId } = await makeStaff(db, shop.id, ["captain"]);
    await setStaffEmergencyContact(db, {
      shopId: shop.id,
      personId,
      name: "Marta",
      phone: "+1-305-555-0114",
    });

    const cleared = await setStaffEmergencyContact(db, {
      shopId: shop.id,
      personId,
      name: "",
      phone: "",
    });

    expect(cleared).toEqual({ ok: true });
    const member = (await listShopStaff(db, shop.id)).find((s) => s.personId === personId);
    // Null, not "" — the manifest renders "Not on file" on absence, and an
    // empty string is a value that prints as a blank instead.
    expect(member).toMatchObject({
      emergencyContactName: null,
      emergencyContactPhone: null,
    });
  });

  it("refuses a name with no number, and a number with no name", async () => {
    // Half a contact is the shape that fails at the exact moment it is needed:
    // a name on the printed sheet with nothing to dial is worse than a blank,
    // because it reads as though somebody can be reached.
    const { db, shop } = await seededShopContext();
    const { personId } = await makeStaff(db, shop.id, ["captain"]);

    expect(
      await setStaffEmergencyContact(db, { shopId: shop.id, personId, name: "Marta", phone: " " }),
    ).toEqual({ ok: false, reason: "half_filled" });
    expect(
      await setStaffEmergencyContact(db, { shopId: shop.id, personId, name: "", phone: "+1-305" }),
    ).toEqual({ ok: false, reason: "half_filled" });

    const member = (await listShopStaff(db, shop.id)).find((s) => s.personId === personId);
    expect(member?.emergencyContactName).toBeNull();
  });

  it("refuses a person in another shop", async () => {
    // `people` is the only table here carrying a shop_id, and the action takes
    // a raw personId from a hidden form field — so this is the whole tenant
    // boundary for the write.
    const { db, shop } = await seededShopContext();
    seq += 1;
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: `other-shop-${seq}`, timezone: "UTC" })
      .returning();
    if (!other) throw new Error("failed to insert shop");
    const { personId } = await makeStaff(db, other.id, ["captain"]);

    const result = await setStaffEmergencyContact(db, {
      shopId: shop.id,
      personId,
      name: "Marta",
      phone: "+1-305-555-0114",
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    const member = (await listShopStaff(db, other.id)).find((s) => s.personId === personId);
    expect(member?.emergencyContactName).toBeNull();
  });

  it("refuses a person in this shop who holds no staff role", async () => {
    // The team page's subjects are staff. Without this the action is a
    // general-purpose writer for any `people` row in the shop — every diver
    // record included — reachable by editing one hidden field.
    const { db, shop } = await seededShopContext();
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Ana Diaz", email: "ana.diaz@example.com" })
      .returning();
    if (!diver) throw new Error("failed to insert diver");

    const result = await setStaffEmergencyContact(db, {
      shopId: shop.id,
      personId: diver.id,
      name: "Marta",
      phone: "+1-305-555-0114",
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    const [row] = await db.select().from(people).where(eq(people.id, diver.id));
    expect(row?.emergencyContactName).toBeNull();
  });

  it("refuses a deleted person", async () => {
    const { db, shop } = await seededShopContext();
    const { personId } = await makeStaff(db, shop.id, ["captain"]);
    await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, personId));

    expect(
      await setStaffEmergencyContact(db, {
        shopId: shop.id,
        personId,
        name: "Marta",
        phone: "+1-305-555-0114",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});

/** Issue #708. */
describe("setStaffLanguages", () => {
  it("records a staff member's languages, deduplicated", async () => {
    const { db, shop } = await seededShopContext();
    const { personId } = await makeStaff(db, shop.id, ["captain"]);

    expect(
      await setStaffLanguages(db, { shopId: shop.id, personId, languages: ["de", "de", "ja"] }),
    ).toBe(true);

    const [row] = await db.select().from(people).where(eq(people.id, personId));
    expect([...(row?.spokenLanguages ?? [])].sort()).toEqual(["de", "ja"]);
  });

  it("clears languages back to empty rather than refusing an empty list", async () => {
    const { db, shop } = await seededShopContext();
    const { personId } = await makeStaff(db, shop.id, ["captain"]);
    await setStaffLanguages(db, { shopId: shop.id, personId, languages: ["de"] });

    expect(await setStaffLanguages(db, { shopId: shop.id, personId, languages: [] })).toBe(true);

    const [row] = await db.select().from(people).where(eq(people.id, personId));
    expect(row?.spokenLanguages).toEqual([]);
  });

  it("drops any tag outside the common set rather than storing it", async () => {
    const { db, shop } = await seededShopContext();
    const { personId } = await makeStaff(db, shop.id, ["captain"]);

    await setStaffLanguages(db, {
      shopId: shop.id,
      personId,
      languages: ["de", "not-a-real-tag"],
    });

    const [row] = await db.select().from(people).where(eq(people.id, personId));
    expect(row?.spokenLanguages).toEqual(["de"]);
  });

  it("refuses a person who holds no staff role", async () => {
    const { db, shop } = await seededShopContext();
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Priya Shah" })
      .returning();
    if (!diver) throw new Error("failed to insert diver");

    expect(
      await setStaffLanguages(db, { shopId: shop.id, personId: diver.id, languages: ["de"] }),
    ).toBe(false);
    const [row] = await db.select().from(people).where(eq(people.id, diver.id));
    expect(row?.spokenLanguages).toEqual([]);
  });

  it("refuses a person in another shop", async () => {
    // `people` is the only table here carrying a shop_id, and the action takes
    // a raw personId — same tenant boundary `setStaffEmergencyContact`'s own
    // cross-shop test above pins for the identical write shape.
    const { db, shop } = await seededShopContext();
    seq += 1;
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: `other-shop-${seq}`, timezone: "UTC" })
      .returning();
    if (!other) throw new Error("failed to insert shop");
    const { personId } = await makeStaff(db, other.id, ["captain"]);

    expect(await setStaffLanguages(db, { shopId: shop.id, personId, languages: ["de"] })).toBe(
      false,
    );
    const [row] = await db.select().from(people).where(eq(people.id, personId));
    expect(row?.spokenLanguages).toEqual([]);
  });
});

describe("listShopSpokenLanguages", () => {
  it("returns the union of every active staff member's languages, deduplicated", async () => {
    const { db, shop } = await seededShopContext();
    const a = await makeStaff(db, shop.id, ["captain"]);
    const b = await makeStaff(db, shop.id, ["divemaster"]);
    await setStaffLanguages(db, { shopId: shop.id, personId: a.personId, languages: ["de", "fr"] });
    await setStaffLanguages(db, { shopId: shop.id, personId: b.personId, languages: ["fr", "ja"] });

    expect([...(await listShopSpokenLanguages(db, shop.id))].sort()).toEqual(["de", "fr", "ja"]);
  });

  it("returns nothing when no active staff member has recorded a language", async () => {
    const { db, shop } = await seededShopContext();
    await makeStaff(db, shop.id, ["captain"]);
    expect(await listShopSpokenLanguages(db, shop.id)).toEqual([]);
  });

  it("excludes a disabled account's recorded languages", async () => {
    const { db, shop } = await seededShopContext();
    const { personId } = await makeStaff(db, shop.id, ["captain"], { status: "disabled" });
    await setStaffLanguages(db, { shopId: shop.id, personId, languages: ["de"] });

    expect(await listShopSpokenLanguages(db, shop.id)).toEqual([]);
  });
});
