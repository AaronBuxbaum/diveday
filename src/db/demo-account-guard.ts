import { and, eq, inArray } from "drizzle-orm";
import { isDemoAccountEmail } from "@/lib/demo-identity";
import type { DbExecutor } from "./client";
import { people, personRoles, shops, userAccounts } from "./schema";

/**
 * A demo flag is mutable data, not proof that a shop belongs to the demo.
 * Before writing fabricated demo records, require at least one owner/captain
 * account and ensure every such account is in the reserved, non-routable demo
 * email namespace as an independent gate.
 */
export async function isDemoShopWithDemoOwnerOrCaptainAccount(
  db: DbExecutor,
  shopId: string,
): Promise<boolean> {
  const [shop] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(and(eq(shops.id, shopId), eq(shops.isDemo, true)))
    .limit(1);
  if (!shop) return false;

  const accounts = await db
    .select({ email: userAccounts.email })
    .from(userAccounts)
    .innerJoin(people, eq(people.id, userAccounts.personId))
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), inArray(personRoles.role, ["owner", "captain"])));

  return accounts.length > 0 && accounts.every((account) => isDemoAccountEmail(account.email));
}
