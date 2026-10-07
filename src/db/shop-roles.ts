import { eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { people, personRoles } from "./schema";

/**
 * Every role at least one of this shop's people holds, deduplicated. The demo
 * role switcher reads it so it never offers a card that would no-op — a shop
 * that seeded no captain has no captain to become.
 */
export async function listShopRolesPresent(db: DbExecutor, shopId: string): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ role: personRoles.role })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(eq(people.shopId, shopId));
  return new Set(rows.map((row) => row.role));
}
