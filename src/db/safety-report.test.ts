import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { getSafetyMonth } from "./safety-report";
import { activityEvents } from "./schema";
import { listStaff } from "./trips";

// The demo shop with its sailed history, one rolled-back transaction per test.
const ctx = fileScopedShopContext({ history: true });

const OTHER_SHOP = "99999999-8888-4777-8666-555555555555";
const FAR_PAST = new Date("2000-01-01T00:00:00Z");
const FAR_FUTURE = new Date("2100-01-01T00:00:00Z");

describe("getSafetyMonth", () => {
  it("accounts for every departure that came home, closed or not", async () => {
    const { db, shop } = ctx;
    const month = await getSafetyMonth(db, shop.id, FAR_PAST, FAR_FUTURE, shop.timezone);
    expect(month.departuresBack).toBeGreaterThan(0);
    expect(month.rollCallsClosed + month.openRollCalls.length).toBe(month.departuresBack);
  });

  it("counts a card check written past, and only inside the period", async () => {
    const { db, shop } = ctx;
    const owner = (await listStaff(db, shop.id)).find((member) => member.roles.includes("owner"));
    if (!owner) throw new Error("expected an owner");
    const before = await getSafetyMonth(db, shop.id, FAR_PAST, FAR_FUTURE, shop.timezone);
    const params = {
      actor: owner.person.fullName,
      diver: "A diver",
      from: "snorkeler",
      type: "diver",
      certCheck: "overridden",
      cleared: "",
    };
    await db.insert(activityEvents).values([
      {
        shopId: shop.id,
        actorPersonId: owner.person.id,
        code: "participant_type_changed",
        params,
        occurredAt: new Date("2026-06-15T12:00:00Z"),
      },
      {
        shopId: shop.id,
        actorPersonId: owner.person.id,
        code: "participant_type_changed",
        params: { ...params, certCheck: "cleared" },
        occurredAt: new Date("2026-06-15T12:00:00Z"),
      },
    ]);
    const after = await getSafetyMonth(db, shop.id, FAR_PAST, FAR_FUTURE, shop.timezone);
    expect(after.certOverrides).toBe(before.certOverrides + 1);
    const july = await getSafetyMonth(
      db,
      shop.id,
      new Date("2026-07-01T00:00:00Z"),
      new Date("2026-08-01T00:00:00Z"),
      shop.timezone,
    );
    expect(july.certOverrides).toBe(0);
  });

  it("reads nothing of another shop's", async () => {
    const { db, shop } = ctx;
    const month = await getSafetyMonth(db, OTHER_SHOP, FAR_PAST, FAR_FUTURE, shop.timezone);
    expect(month).toMatchObject({ departuresBack: 0, certOverrides: 0, crewSailings: 0 });
  });
});
