import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { people, personRoles, userAccounts } from "@/db/schema";
import { isStaff, type Role } from "@/lib/authz";

export type VerifiedUser = {
  id: string;
  personId: string;
  shopId: string;
  name: string;
  email: string;
  roles: Role[];
};

/**
 * The whole credentials decision in one testable function: active account,
 * matching password, and at least one staff role — anything less is null,
 * with no hint which check failed (ADR-0006).
 */
export async function verifyCredentials(
  db: AppDb,
  email: string,
  password: string,
): Promise<VerifiedUser | null> {
  const [account] = await db
    .select()
    .from(userAccounts)
    .where(eq(userAccounts.email, email.toLowerCase()))
    .limit(1);
  if (account?.status !== "active") return null;

  const ok = await compare(password, account.hashedPassword);
  if (!ok) return null;

  const [person] = await db.select().from(people).where(eq(people.id, account.personId)).limit(1);
  if (!person) return null;

  const roleRows = await db
    .select({ role: personRoles.role })
    .from(personRoles)
    .where(eq(personRoles.personId, person.id));
  const roles = roleRows.map((r) => r.role as Role);

  // Staff-only surface for now; customer sign-in arrives with the milestone
  // that needs it (ADR-0006).
  if (!isStaff(roles)) return null;

  return {
    id: account.id,
    personId: person.id,
    shopId: person.shopId,
    name: person.fullName,
    email: account.email,
    roles,
  };
}
