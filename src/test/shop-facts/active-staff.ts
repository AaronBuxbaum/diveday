import { and, eq, inArray } from "drizzle-orm";
import { requireActiveStaffId } from "../../db/authz";
import type { AppDb } from "../../db/client";
import { people, personRoles } from "../../db/schema/index";
import { STAFF_ROLES } from "../../lib/authz";

/**
 * **A staff person the app's own writers will accept as the author**, in a
 * fixed order. A seeded person who holds a staff role is not necessarily one:
 * `requireActiveStaffId` also wants a live person with an active account, and
 * the first role-holder a bare `limit(1)` returns moves with the physical row
 * order, which a snapshot reset changes. Picking the first one the writer's
 * own check accepts keeps a fact from answering `staff_not_found`.
 */
export async function anActiveStaffPerson(
  db: AppDb,
  shopId: string,
): Promise<{ id: string } | null> {
  const rows = await db
    .select({ id: people.id })
    .from(people) // diveday:allow-deleted-people: an e2e seed finds the people it just seeded
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), inArray(personRoles.role, [...STAFF_ROLES])))
    .orderBy(people.fullName, people.id);
  for (const row of new Map(rows.map((r) => [r.id, r])).values()) {
    if (await requireActiveStaffId(db, shopId, row.id)) return row;
  }
  return null;
}
