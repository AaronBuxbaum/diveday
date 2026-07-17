// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb } from "@/db/client";
import { DEV_STAFF_LOGINS } from "@/db/dev-credentials";
import { userAccounts } from "@/db/schema";
import { seedDemo } from "@/db/seed";
import { verifyCredentials } from "./credentials";

describe("verifyCredentials (in-memory PGlite)", () => {
  it("signs in seeded staff with the right password and returns roles", async () => {
    const db = await createTestDb();
    await seedDemo(db);
    const { email, password } = DEV_STAFF_LOGINS.owner;

    const user = await verifyCredentials(db, email, password);
    expect(user?.name).toBe("Dana Reyes");
    expect(user?.roles).toEqual(expect.arrayContaining(["owner", "manager"]));
    expect(user?.shopId).toBeTruthy();
  });

  it("is case-insensitive on email", async () => {
    const db = await createTestDb();
    await seedDemo(db);
    const { email, password } = DEV_STAFF_LOGINS.captain;
    const user = await verifyCredentials(db, email.toUpperCase(), password);
    expect(user?.name).toBe("Sal Moretti");
  });

  it("rejects a wrong password", async () => {
    const db = await createTestDb();
    await seedDemo(db);
    const { email } = DEV_STAFF_LOGINS.owner;
    expect(await verifyCredentials(db, email, "not-the-password")).toBeNull();
  });

  it("rejects unknown emails", async () => {
    const db = await createTestDb();
    await seedDemo(db);
    expect(await verifyCredentials(db, "nobody@example.com", "whatever")).toBeNull();
  });

  it("rejects a disabled account even with the right password", async () => {
    const db = await createTestDb();
    await seedDemo(db);
    const { email, password } = DEV_STAFF_LOGINS.instructor;
    await db.update(userAccounts).set({ status: "disabled" }).where(eq(userAccounts.email, email));
    expect(await verifyCredentials(db, email, password)).toBeNull();
  });
});
