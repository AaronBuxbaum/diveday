import { and, eq, inArray } from "drizzle-orm";
import { isDemoAccountEmail } from "@/lib/demo-identity";
import type { DbExecutor } from "./client";
import { people, personRoles, shops, userAccounts } from "./schema";

/**
 * Serialize changes that could add or remove the owner/captain identity used
 * to establish a shop's demo namespace. NO KEY UPDATE blocks another shop
 * identity edit while remaining compatible with ordinary foreign-key inserts.
 */
export async function lockDemoShopIdentityChanges(
  db: DbExecutor,
  shopId: string,
): Promise<boolean> {
  const [shop] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1)
    .for("no key update");
  return Boolean(shop);
}

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
  if (!(await lockDemoShopIdentityChanges(db, shopId))) return false;
  const [shop] = await db
    .select({ isDemo: shops.isDemo })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop?.isDemo) return false;

  // Lock the current identities and account rows too. The shared shop lock
  // serializes app role/account creation; these row locks also serialize
  // direct edits to an existing owner/captain and their sign-in email.
  const roles = await db
    .select({ personId: personRoles.personId })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, shopId), inArray(personRoles.role, ["owner", "captain"])))
    .for("update");
  if (roles.length === 0) return false;

  const accounts = await db
    .select({ email: userAccounts.email })
    .from(userAccounts)
    .where(
      inArray(
        userAccounts.personId,
        roles.map((role) => role.personId),
      ),
    )
    .for("update");

  return accounts.length > 0 && accounts.every((account) => isDemoAccountEmail(account.email));
}
