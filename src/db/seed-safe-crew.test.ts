import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { people, personRoles } from "./schema";
import { seedSafeCrew } from "./seed-safe-crew";
import { listStaffCredentials } from "./staff-credentials";

describe("the demo crew’s safety credentials", () => {
  it("records the professional rating or licence for every qualified role", async () => {
    const { db, shop } = await seededShopContext();
    const roles = await db
      .select({ personId: people.id, role: personRoles.role })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), inArray(personRoles.role, [...STAFF_ROLES])));
    const rows = await listStaffCredentials(db, shop.id);
    const expected = {
      instructor: "instructor_rating",
      assistant_instructor: "assistant_instructor_rating",
      divemaster: "divemaster_rating",
      captain: "captains_licence",
    };
    for (const { personId, role } of roles) {
      if (!(role in expected)) continue;
      expect(
        rows.some(
          ({ credential }) =>
            credential.personId === personId &&
            credential.kind === expected[role as keyof typeof expected],
        ),
        role,
      ).toBe(true);
    }
  });
  it("has current reviewed evidence and reseeds without duplicates", async () => {
    const { db, shop } = await seededShopContext();
    const rows = await listStaffCredentials(db, shop.id);
    expect(rows.length).toBeGreaterThan(0);
    const today = nowDate().toISOString().slice(0, 10);
    for (const { credential } of rows) {
      expect(credential.status).toBe("verified");
      expect(credential.reviewedByPersonId).toBeTruthy();
      expect((credential.issuedAt ?? "9999") <= today).toBe(true);
      expect((credential.renewsAt ?? "") > today).toBe(true);
    }
    await seedSafeCrew(db, shop.id);
    expect(await listStaffCredentials(db, shop.id)).toHaveLength(rows.length);
  });
});
