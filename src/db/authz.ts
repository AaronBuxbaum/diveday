import { and, eq } from "drizzle-orm";
import {
  canConfigureTrips,
  canDeleteDiver,
  canErasePersonalData,
  canExportIncidentRecord,
  canManageMessagingSettings,
  canManageOrders,
  canManagePaymentSettings,
  canManageShopSettings,
  canManageStaffAccounts,
  canManageWaiverTemplates,
  canOverrideGearRequest,
  canRefund,
  type Role,
} from "@/lib/authz";
import type { DbExecutor } from "./client";
import { people, personRoles, userAccounts } from "./schema";

/**
 * The account-and-roles half shared by both functions below: given a person
 * row already confirmed to exist and not be deleted, is their account active,
 * and if so, what do their live `person_roles` say. Neither `userAccounts`
 * nor `personRoles` carries its own `shop_id` — both are keyed by `personId`
 * alone — so this half needs no shop scoping of its own; only *finding* the
 * person row (each caller's own first query) differs between the two.
 */
async function activeStaffRolesFor(db: DbExecutor, personId: string): Promise<Role[] | null> {
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

/**
 * The signed-in person's *live* staff roles, re-read from the database, or
 * `null` when they are not an active staff member of this shop right now — a
 * deleted person or a non-active account. The H-14 role gates check against
 * this rather than the roles baked into the JWT at sign-in, so a demoted,
 * disabled, or deleted staff member loses a gated surface immediately instead
 * of at their next sign-in — the same revocation window the export/import/
 * reports surfaces already close (`canPersonViewShopReports` et al.).
 *
 * **Shop-scoped on purpose.** Every H-14 gate already runs inside an
 * established, verified shop context, so requiring `people.shop_id` to match
 * the caller's own `shopId` here is exactly the tenant-isolation check that
 * stops a person from one shop being asked about under another's id. A
 * caller with no shop yet resolved wants `loadActiveStaffRolesByPerson`
 * below instead.
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
  return activeStaffRolesFor(db, personId);
}

/**
 * The same live check as `loadActiveStaffRoles`, without the shop scope —
 * for `requireStaffSession()` (`src/lib/session.ts`, issue #701), the one
 * caller that runs *before* any shop has been resolved from the session's
 * own claim. A person row belongs to exactly one shop for its whole life
 * (`people.shop_id` is never reassigned), so scoping by `personId` alone is
 * unambiguous — and it deliberately does not check the session's *claimed*
 * `shopId` against anything: if that claim itself has gone stale (the shop
 * it named was deleted, or never matched to begin with), that is
 * `requireShopSurface`'s own tenant assert to catch and 404 on, not a
 * reason for this check to say the account is inactive.
 */
export async function loadActiveStaffRolesByPerson(
  db: DbExecutor,
  personId: string,
): Promise<Role[] | null> {
  const [person] = await db
    .select({ id: people.id, deletedAt: people.deletedAt })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1);
  if (!person || person.deletedAt) return null;
  return activeStaffRolesFor(db, personId);
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

/**
 * Live DB-checked companion of the settings gate (src/lib/authz.ts). The
 * settings page and every one of its mutations call this rather than reading
 * the JWT's roles, so a demoted staff member loses the shop's configuration on
 * their next request instead of at their next sign-in.
 */
export const canPersonManageShopSettings = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canManageShopSettings);

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

/**
 * Live DB-checked companion of the owner-only incident-export gate
 * (src/lib/authz.ts). The export route calls this itself as well as the
 * manifest that links to it: the document names whoever generated it, so
 * "the link was hidden" is not a control.
 */
export const canPersonExportIncidentRecord = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canExportIncidentRecord);

/** Live DB-checked companion of the H-06 gear-override gate (src/lib/authz.ts). */
export const canPersonOverrideGearRequest = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canOverrideGearRequest);

/** Live DB-checked companion of the staff-account gate (20260726-staff-invite-accounts). */
export const canPersonManageStaffAccounts = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canManageStaffAccounts);
