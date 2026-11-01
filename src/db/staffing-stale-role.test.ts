import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "@/lib/authz";
import { HOUR_MS, nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { personRoles, staffShifts } from "./schema";
import { createStaffShift } from "./staffing";
import { listStaff } from "./trips";

const OPEN_TEST_SESSION_OFFSET_MS = 180 * 24 * 60 * 60 * 1000;
const ctx = fileScopedShopContext();

describe("staff shifts after a roster role change", () => {
  it("refuses a shift for a roster member whose staff roles were removed", async () => {
    const { db, shop } = ctx;
    const staff = await listStaff(db, shop.id);
    const candidate = staff[0];
    if (!candidate) throw new Error("seeded staff member missing");

    const rolesBefore = await db
      .select({ role: personRoles.role })
      .from(personRoles)
      .where(eq(personRoles.personId, candidate.person.id));
    const nonStaffRoles = rolesBefore
      .filter(({ role }) => !STAFF_ROLES.includes(role))
      .map(({ role }) => role)
      .sort();
    const shiftsBefore = await db
      .select({ id: staffShifts.id })
      .from(staffShifts)
      .where(and(eq(staffShifts.shopId, shop.id), eq(staffShifts.personId, candidate.person.id)));

    // This person was on the roster when read. Remove only their staff roles;
    // any diver or other non-staff roles remain attached to the person.
    await db
      .delete(personRoles)
      .where(
        and(
          eq(personRoles.personId, candidate.person.id),
          inArray(personRoles.role, [...STAFF_ROLES]),
        ),
      );
    const rolesAfter = await db
      .select({ role: personRoles.role })
      .from(personRoles)
      .where(eq(personRoles.personId, candidate.person.id));
    expect(rolesAfter.map(({ role }) => role).sort()).toEqual(nonStaffRoles);
    expect(await listStaff(db, shop.id)).not.toContainEqual(
      expect.objectContaining({ person: expect.objectContaining({ id: candidate.person.id }) }),
    );

    const startsAt = new Date(nowMs() + OPEN_TEST_SESSION_OFFSET_MS);
    const result = await createStaffShift(db, {
      shopId: shop.id,
      personId: candidate.person.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
      note: null,
      createdByPersonId: candidate.person.id,
    });

    expect(result).toEqual({ ok: false, reason: "staff_not_found" });
    const shiftsAfter = await db
      .select({ id: staffShifts.id })
      .from(staffShifts)
      .where(and(eq(staffShifts.shopId, shop.id), eq(staffShifts.personId, candidate.person.id)));
    expect(shiftsAfter).toHaveLength(shiftsBefore.length);
  });
});
