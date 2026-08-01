import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { people, personRoles, shops, userAccounts } from "@/db/schema";
import { isStaff, type Role } from "@/lib/authz";

/**
 * The password any demo person signs in with: accepted here for a person in an
 * `isDemo` shop without a real password match. Not a secret — it only ever
 * works on shops the ADR already treats as public, throwaway playgrounds — so
 * it's safe to surface in the UI for a visitor to note down and sign back in
 * with later.
 */
export const DEMO_BYPASS_PASSWORD = "password";

export type VerifiedUser = {
  id: string;
  personId: string;
  shopId: string;
  shopSlug: string;
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
  // TEMP DIAGNOSTIC (remove before merge): PR #286's visual-regression e2e
  // job fails signInAsOwner() deterministically, never reproducible locally.
  // ADR-0006 hides which check failed from the user; this instruments the
  // actual reason to stderr (picked up by Playwright's [WebServer] log
  // capture in CI) without changing the returned value or user-facing copy.
  const diag = (reason: string, extra?: Record<string, unknown>) => {
    if (process.env.DIVEDAY_E2E === "1") {
      console.error(
        `[diag-286] verifyCredentials fail: ${reason} email=${email.toLowerCase()}`,
        extra ?? {},
      );
    }
  };
  const [account] = await db
    .select()
    .from(userAccounts)
    .where(eq(userAccounts.email, email.toLowerCase()))
    .limit(1);
  if (account?.status !== "active") {
    diag("account-not-active", { found: Boolean(account), status: account?.status });
    return null;
  }

  const [person] = await db.select().from(people).where(eq(people.id, account.personId)).limit(1);
  if (!person) {
    diag("no-person", { personId: account.personId });
    return null;
  }

  const [shop] = await db.select().from(shops).where(eq(shops.id, person.shopId)).limit(1);
  if (!shop) {
    diag("no-shop", { shopId: person.shopId });
    return null;
  }

  let ok = await compare(password, account.hashedPassword);
  if (!ok) {
    if (shop.isDemo && password === DEMO_BYPASS_PASSWORD) {
      ok = true;
    }
  }
  if (!ok) {
    diag("password-mismatch", { isDemo: shop.isDemo, shopSlug: shop.slug });
    return null;
  }

  const roleRows = await db
    .select({ role: personRoles.role })
    .from(personRoles)
    .where(eq(personRoles.personId, person.id));
  const roles = roleRows.map((r) => r.role as Role);

  // Staff-only surface for now; customer sign-in arrives with the milestone
  // that needs it (ADR-0006).
  if (!isStaff(roles)) {
    diag("not-staff", { roles });
    return null;
  }

  return {
    id: account.id,
    personId: person.id,
    shopId: person.shopId,
    shopSlug: shop.slug,
    name: person.fullName,
    email: account.email,
    roles,
  };
}
