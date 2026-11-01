import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { people, personRoles, userAccounts } from "./schema";

/**
 * The shop's owners with an active login: who a safety email to "the owners"
 * goes to (the stale-roll-call alert, and the shore contact's stop, H-20261014-stale-roll-call-recipients).
 */
export async function ownerLogins(db: DbExecutor, shopId: string) {
  return roleLogins(db, shopId, "owner");
}

/** The shop's people holding one of `roles` with an active login, the same way. */
export async function roleLogins(
  db: DbExecutor,
  shopId: string,
  roles: "owner" | "manager" | readonly ("owner" | "manager")[],
) {
  const hasRole =
    typeof roles === "string" ? eq(personRoles.role, roles) : inArray(personRoles.role, roles);
  return db
    .selectDistinct({
      personId: people.id,
      fullName: people.fullName,
      email: userAccounts.email,
      locale: people.locale,
    })
    .from(userAccounts)
    .innerJoin(people, eq(people.id, userAccounts.personId))
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        eq(userAccounts.status, "active"),
        hasRole,
      ),
    );
}
