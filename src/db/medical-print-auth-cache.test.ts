import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { canPersonPrintMedicalAlerts } from "./authz";
import { people, personRoles, userAccounts } from "./schema";

// Vitest normally resolves React's client build, whose cache is a passthrough.
// Model a single React server render's argument-keyed cache to test that a
// second disclosure decision cannot reuse the first decision's role snapshot.
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return {
    ...original,
    cache: (reader: (...args: never[]) => unknown) => {
      const entries: { args: never[]; result: unknown }[] = [];
      return (...args: never[]) => {
        const entry = entries.find((item) => item.args.every((arg, i) => arg === args[i]));
        if (entry) return entry.result;
        const result = reader(...args);
        entries.push({ args, result });
        return result;
      };
    },
  };
});

const ctx = fileScopedShopContext();

describe("medical packet authorization during a server render", () => {
  it("rechecks account status after a prior authorization in the same request", async () => {
    const { db, shop } = ctx;
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Packet printer" })
      .returning();
    if (!person) throw new Error("expected printer");
    await db.insert(personRoles).values({ personId: person.id, role: "crew" });
    await db.insert(userAccounts).values({
      personId: person.id,
      email: "packet-printer@example.com",
      hashedPassword: "x",
      status: "active",
    });

    expect(await canPersonPrintMedicalAlerts(db, shop.id, person.id)).toBe(true);
    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, person.id));
    expect(await canPersonPrintMedicalAlerts(db, shop.id, person.id)).toBe(false);
  });
});
