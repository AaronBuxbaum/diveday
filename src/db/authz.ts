import { and, eq } from "drizzle-orm";
import {
  canConfigureTrips,
  canDeleteDiver,
  canErasePersonalData,
  canManageMessagingSettings,
  canManageOrders,
  canManagePaymentSettings,
  canManageStaffAccounts,
  canManageWaiverTemplates,
  canOverrideGearRequest,
  canRefund,
  type Role,
} from "@/lib/authz";
import type { DbExecutor } from "./client";
import { people, personRoles, userAccounts } from "./schema";

/**
 * The signed-in person's *live* staff roles, re-read from the database, or
 * `null` when they are not an active staff member of this shop right now — a
 * deleted person or a non-active account. The H-14 role gates check against
 * this rather than the roles baked into the JWT at sign-in, so a demoted,
 * disabled, or deleted staff member loses a gated surface immediately instead
 * of at their next sign-in — the same revocation window the export/import/
 * reports surfaces already close (`canPersonViewShopReports` et al.).
 */
export async function loadActiveStaffRoles(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<Role[] | null> {
  const [person] = await db
    .select({ id: people.id, deletedAt: people.deletedAt })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.shopId, shopId)))
    .limit(1);
  if (!person || person.deletedAt) return null;

  const [account] = await db
    .select({ status: userAccounts.status })
    .from(userAccounts)
    .where(eq(userAccounts.personId, personId))
    .limit(1);
  if (account?.status !== "active") return null;

  const roleRows = await db
    .select({ role: personRoles.role })
    .from(personRoles)
    .where(eq(personRoles.personId, personId));
  return roleRows.map((row) => row.role as Role);
}

async function canPerson(
  db: DbExecutor,
  shopId: string,
  personId: string,
  predicate: (roles: readonly Role[]) => boolean,
): Promise<boolean> {
  const roles = await loadActiveStaffRoles(db, shopId, personId);
  return roles !== null && predicate(roles);
}

/** Live DB-checked companions of the H-14 predicates (src/lib/authz.ts). */
export const canPersonManagePaymentSettings = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canManagePaymentSettings);

export const canPersonManageMessagingSettings = (
  db: DbExecutor,
  shopId: string,
  personId: string,
) => canPerson(db, shopId, personId, canManageMessagingSettings);

export const canPersonRefund = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canRefund);

/**
 * Live DB-checked companion of the invoicing gate (src/lib/authz.ts).
 * `createOrder` calls this itself as well as the route/action above it: an
 * invoice is a bill sent to a real customer on the shop's own Stripe account,
 * so "the caller forgot to check" is not something a later apology undoes.
 */
export const canPersonManageOrders = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canManageOrders);

export const canPersonManageWaiverTemplates = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canManageWaiverTemplates);

export const canPersonDeleteDiver = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canDeleteDiver);

/**
 * Live DB-checked companion of the owner-only erasure gate
 * (ADR 20260802-diver-data-erasure). `anonymizeDiver` calls this itself rather
 * than trusting its caller: the action is one-way, so "the route forgot to
 * check" has no remedy after the fact.
 */
export const canPersonErasePersonalData = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canErasePersonalData);

export const canPersonConfigureTrips = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canConfigureTrips);

/** Live DB-checked companion of the H-06 gear-override gate (src/lib/authz.ts). */
export const canPersonOverrideGearRequest = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canOverrideGearRequest);

/** Live DB-checked companion of the staff-account gate (20260726-staff-invite-accounts). */
export const canPersonManageStaffAccounts = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canManageStaffAccounts);
