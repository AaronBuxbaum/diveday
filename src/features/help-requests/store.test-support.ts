/** Give a staff actor the active sign-in account every write-time staff check requires. */

/** The helper's sign-in account, made active, with another owner kept so a removal is allowed. */
import { eq } from "drizzle-orm";
import type { AppDb } from "../../db/client";
import { personRoles, userAccounts } from "../../db/schema/index";

export async function withActiveAccount(db: AppDb, personId: string): Promise<void> {
  const [account] = await db
    .update(userAccounts)
    .set({ status: "active" })
    .where(eq(userAccounts.personId, personId))
    .returning({ id: userAccounts.id });
  if (account) return;
  await db.insert(userAccounts).values({ personId, email: `${personId}@example.invalid` });
}

export async function removableHelper(
  db: AppDb,
  helperId: string,
  actorId: string,
): Promise<string> {
  await withActiveAccount(db, helperId);
  await db.insert(personRoles).values({ personId: actorId, role: "owner" }).onConflictDoNothing();
  const [account] = await db
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(eq(userAccounts.personId, helperId));
  if (!account) throw new Error("expected helper account");
  return account.id;
}

export async function setAccountStatus(
  db: AppDb,
  personId: string,
  status: "active" | "disabled",
): Promise<void> {
  await db.update(userAccounts).set({ status }).where(eq(userAccounts.personId, personId));
}
