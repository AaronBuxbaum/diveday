import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import { people, shops, userAccounts } from "./schema";
import {
  activateStaffAccount,
  dismissOrientation,
  getAccountContact,
  getAccountIdForPerson,
  isOrientationDismissed,
} from "./user-accounts";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

async function seededPersonId(db: AppDb, email: string): Promise<string> {
  const [account] = await db
    .select({ personId: userAccounts.personId })
    .from(userAccounts)
    .where(eq(userAccounts.email, email))
    .limit(1);
  if (!account) throw new Error(`seeded account for ${email} missing`);
  return account.personId;
}

describe("orientation dismissal (in-memory PGlite)", () => {
  it("starts undismissed for a freshly seeded account", async () => {
    const { db } = ctx;
    const personId = await seededPersonId(db, DEV_STAFF_LOGINS.owner.email);
    expect(await isOrientationDismissed(db, personId)).toBe(false);
  });

  it("dismissing records the timestamp and reads back as dismissed", async () => {
    const { db } = ctx;
    const personId = await seededPersonId(db, DEV_STAFF_LOGINS.captain.email);
    expect(await isOrientationDismissed(db, personId)).toBe(false);

    await dismissOrientation(db, personId);
    expect(await isOrientationDismissed(db, personId)).toBe(true);
  });

  it("is scoped per account — dismissing one person's card leaves another's showing", async () => {
    const { db } = ctx;
    const captainId = await seededPersonId(db, DEV_STAFF_LOGINS.captain.email);
    const instructorId = await seededPersonId(db, DEV_STAFF_LOGINS.instructor.email);

    await dismissOrientation(db, captainId);

    expect(await isOrientationDismissed(db, captainId)).toBe(true);
    expect(await isOrientationDismissed(db, instructorId)).toBe(false);
  });

  it("an unknown person id reads as not dismissed rather than throwing", async () => {
    const { db } = ctx;
    expect(await isOrientationDismissed(db, "00000000-0000-0000-0000-000000000000")).toBe(false);
  });
});

describe("the account a person signs in with (in-memory PGlite)", () => {
  it("resolves a staff person to their one account", async () => {
    const { db } = ctx;
    const personId = await seededPersonId(db, DEV_STAFF_LOGINS.owner.email);
    const [account] = await db
      .select({ id: userAccounts.id })
      .from(userAccounts)
      .where(eq(userAccounts.personId, personId));
    expect(await getAccountIdForPerson(db, personId)).toBe(account?.id);
  });

  it("is null for a person with no account", async () => {
    const { db } = ctx;
    expect(await getAccountIdForPerson(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("account-lifecycle mail language (docs ADR 20260731-per-person-notification-locale)", () => {
  it("stays on the shop's locale even when the staff member's person row carries one", async () => {
    // Staff-addressed mail — a welcome, a verify link, a password reset — must
    // never pick up `people.locale`. That column is a *diver's* first-hand
    // signal from their own booking/waiver request; a staff member's row could
    // only have picked one up by accident, and this join is the place that
    // would silently launder it into their inbox.
    const { db, shop } = ctx;
    const personId = await seededPersonId(db, DEV_STAFF_LOGINS.owner.email);
    await db.update(shops).set({ defaultLocale: "es-ES" }).where(eq(shops.id, shop.id));
    await db.update(people).set({ locale: "en-US" }).where(eq(people.id, personId));

    const [account] = await db
      .select({ id: userAccounts.id })
      .from(userAccounts)
      .where(eq(userAccounts.personId, personId))
      .limit(1);
    if (!account) throw new Error("seeded owner account missing");

    const contact = await getAccountContact(db, account.id);
    expect(contact?.defaultLocale).toBe("es-ES");
  });
});

describe("activateStaffAccount (issue #3997)", () => {
  async function accountWith(db: AppDb, status: "invited" | "active" | "disabled") {
    const personId = await seededPersonId(db, DEV_STAFF_LOGINS.captain.email);
    const [account] = await db
      .update(userAccounts)
      .set({ status, hashedPassword: "original-hash" })
      .where(eq(userAccounts.personId, personId))
      .returning({ id: userAccounts.id });
    if (!account) throw new Error("seeded captain account missing");
    return account.id;
  }

  async function read(db: AppDb, id: string) {
    const [row] = await db
      .select({ status: userAccounts.status, hashedPassword: userAccounts.hashedPassword })
      .from(userAccounts)
      .where(eq(userAccounts.id, id));
    return row;
  }

  it("sets the password and activates an invited account", async () => {
    const { db } = ctx;
    const id = await accountWith(db, "invited");
    expect(await activateStaffAccount(db, id, "chosen-hash")).toBe(true);
    expect(await read(db, id)).toEqual({ status: "active", hashedPassword: "chosen-hash" });
  });

  it.each(["active", "disabled"] as const)("changes nothing on a %s account", async (status) => {
    const { db } = ctx;
    const id = await accountWith(db, status);
    expect(await activateStaffAccount(db, id, "attacker-hash")).toBe(false);
    expect(await read(db, id)).toEqual({ status, hashedPassword: "original-hash" });
  });
});
