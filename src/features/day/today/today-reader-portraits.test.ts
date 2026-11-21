import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { people, personRoles, shops as shopsTable, tripAssignments } from "@/db/schema";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { shopClock } from "../shop-clock";
import { getTodayWork } from "./today-reader";

const EN = staffTranslator("en-US");
const ctx = fileScopedShopContext();

describe("Today crew portraits", () => {
  it("keeps each crew photo paired with its person across multiple roles and leaves roll call unchanged", async () => {
    const { db, shop } = ctx;
    const read = async () =>
      (await getTodayWork(db, shop.id, shop.slug, shopClock(shop), undefined, EN)).departures[0];
    const before = await read();
    if (!before || before.crew.length < 2)
      throw new Error("seed departure needs at least two crew");
    const [first, second] = before.crew;
    await db.update(people).set({ staffPhotoPath: "/first.webp" }).where(eq(people.id, first.id));
    await db.update(people).set({ staffPhotoPath: "/second.webp" }).where(eq(people.id, second.id));
    const extraRole = first.roles.includes("manager") ? "owner" : "manager";
    if (!first.roles.includes(extraRole))
      await db.insert(personRoles).values({ personId: first.id, role: extraRole });
    const [otherShop] = await db
      .insert(shopsTable)
      .values({ name: "Other shop", slug: "portrait-other", timezone: "UTC" })
      .returning();
    const [outsider] = await db
      .insert(people)
      .values({ shopId: otherShop.id, fullName: "Other crew", staffPhotoPath: "/other.webp" })
      .returning();
    // Simulate a corrupt cross-shop assignment; a tenant's board must not expose it.
    await db.insert(tripAssignments).values({ tripId: before.tripId, personId: outsider.id });
    const after = await read();
    expect(after?.crew.filter((member) => member.id === first.id)).toHaveLength(1);
    expect(after?.crew.find((member) => member.id === first.id)?.staffPhotoPath).toBe(
      "/first.webp",
    );
    expect(after?.crew.find((member) => member.id === second.id)?.staffPhotoPath).toBe(
      "/second.webp",
    );
    expect(after?.crew.some((member) => member.id === outsider.id)).toBe(false);
    expect(after?.crewAccountedFor).toBe(before.crewAccountedFor);
    expect(after?.crewReason).toBe(before.crewReason);
  });
  it("keeps historical crew names but hides photos after deletion or removal of staff roles", async () => {
    const { db, shop } = ctx;
    const read = async () =>
      (await getTodayWork(db, shop.id, shop.slug, shopClock(shop), undefined, EN)).departures[0];
    const before = await read();
    if (!before || before.crew.length < 2) throw new Error("seed departure needs two crew");
    const [deleted, removed] = before.crew;
    expect(deleted.staffPhotoPath).toBeTruthy();
    expect(removed.staffPhotoPath).toBeTruthy();
    await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, deleted.id));
    await db.delete(personRoles).where(eq(personRoles.personId, removed.id));
    await db.insert(personRoles).values({ personId: removed.id, role: "diver" });
    const after = await read();
    for (const member of [deleted, removed]) {
      const row = after?.crew.find((entry) => entry.id === member.id);
      expect(row?.fullName).toBe(member.fullName);
      expect(row?.staffPhotoPath).toBeNull();
    }
    await db.insert(personRoles).values({ personId: removed.id, role: "manager" });
    await db
      .update(people)
      .set({ anonymizedAt: nowDate(), deletedAt: nowDate() })
      .where(eq(people.id, removed.id));
    expect(
      (await read())?.crew.find((entry) => entry.id === removed.id)?.staffPhotoPath,
    ).toBeNull();
  });
});
