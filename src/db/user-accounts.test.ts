import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import { people, shops, userAccounts } from "./schema";
import { dismissOrientation, getAccountContact, isOrientationDismissed } from "./user-accounts";

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
    const { db } = await seededShopContext();
    const personId = await seededPersonId(db, DEV_STAFF_LOGINS.owner.email);
    expect(await isOrientationDismissed(db, personId)).toBe(false);
  });

  it("dismissing records the timestamp and reads back as dismissed", async () => {
    const { db } = await seededShopContext();
    const personId = await seededPersonId(db, DEV_STAFF_LOGINS.captain.email);
    expect(await isOrientationDismissed(db, personId)).toBe(false);

    await dismissOrientation(db, personId);
    expect(await isOrientationDismissed(db, personId)).toBe(true);
  });

  it("is scoped per account — dismissing one person's card leaves another's showing", async () => {
    const { db } = await seededShopContext();
    const captainId = await seededPersonId(db, DEV_STAFF_LOGINS.captain.email);
    const instructorId = await seededPersonId(db, DEV_STAFF_LOGINS.instructor.email);

    await dismissOrientation(db, captainId);

    expect(await isOrientationDismissed(db, captainId)).toBe(true);
    expect(await isOrientationDismissed(db, instructorId)).toBe(false);
  });

  it("an unknown person id reads as not dismissed rather than throwing", async () => {
    const { db } = await seededShopContext();
    expect(await isOrientationDismissed(db, "00000000-0000-0000-0000-000000000000")).toBe(false);
  });
});

describe("account-lifecycle mail language (docs ADR 20260731-per-person-notification-locale)", () => {
  it("stays on the shop's locale even when the staff member's person row carries one", async () => {
    // Staff-addressed mail — a welcome, a verify link, a password reset — must
    // never pick up `people.locale`. That column is a *diver's* first-hand
    // signal from their own booking/waiver request; a staff member's row could
    // only have picked one up by accident, and this join is the place that
    // would silently launder it into their inbox.
    const { db, shop } = await seededShopContext();
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
