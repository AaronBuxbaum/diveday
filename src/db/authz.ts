import { and, eq, isNotNull, ne } from "drizzle-orm";
import { cache } from "react";
import {
  canAddDiver,
  canBackfillIntegrations,
  canCallDayBlowout,
  canConfigureTrips,
  canDeleteDiver,
  canEmergencyReadMedicalAlert,
  canErasePersonalData,
  canExportDisputeSheet,
  canExportIncidentRecord,
  canManageBilling,
  canManageBoats,
  canManageMessagingSettings,
  canManageOrders,
  canManagePaymentSettings,
  canManageSafetyChecklist,
  canManageShopSettings,
  canManageStaffAccounts,
  canManageTripTags,
  canManageWaiverTemplates,
  canMergeDiver,
  canOverrideCertBlock,
  canOverrideGearRequest,
  canPrintMedicalAlerts,
  canReadDiverMedicalForm,
  canReadEveryIncidentReport,
  canReadMedicalAlert,
  canReadMedicalAnswers,
  canReadMedicalClearanceDocument,
  canReadPrivateRecapPulse,
  canReadShopAnswers,
  canRefund,
  canReplyToReviews,
  canRetireMedicalRefusal,
  canViewShopActivity,
  isStaff,
  type Role,
} from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { type EmergencyReadWindow, emergencyReadWindow } from "@/lib/medical-alert";
import { rolesMayActOnKind, type TodayActionKind } from "@/lib/today";
import type { DbExecutor } from "./client";
import { people, personRoles, shops, tripAssignments, trips, userAccounts } from "./schema";
import { livePerson, liveTrip } from "./trips-live";

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
 * of at their next sign-in.
 *
 * **Shop-scoped on purpose.** Every caller already has an established,
 * verified shop context, so requiring `people.shop_id` to match the caller's
 * own `shopId` is exactly the tenant-isolation check that stops a person from
 * one shop being asked about under another's id. A caller with no shop yet
 * resolved wants `loadActiveStaffRolesByPerson` below instead.
 *
 * This direct read is deliberately uncached. Authorization decisions such as
 * import/export/report gates must not reuse a request-render cache entry. Keep
 * the person, account, and role queries in this order so the shop-scoped live
 * person and fresh active-account/role checks remain intact.
 */
export async function readActiveStaffRoles(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<Role[] | null> {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.shopId, shopId), livePerson()))
    .limit(1);
  if (!person) return null;
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
async function readActiveStaffRolesByPerson(
  db: DbExecutor,
  personId: string,
): Promise<Role[] | null> {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, personId), livePerson()))
    .limit(1);
  if (!person) return null;
  return activeStaffRolesFor(db, personId);
}

/**
 * Memoized per request with React's `cache()` (app audit 2026-10-07, item 2):
 * the staff gate, the shell and every `canPerson*` gate on a page asked this
 * same question of the same connection, two to three statements a time, up
 * to seven times in one trip-page render. Keyed on the executor's identity as
 * well as the ids, so a transaction handle never shares an answer with the
 * pool; outside a render (an action, a route handler, a test) `cache()` calls
 * straight through and every call reads live, as before.
 */
export const loadActiveStaffRoles = cache(readActiveStaffRoles);

/** The live staff person's id for a shop-scoped recorder or attestor, or null. */
export async function requireActiveStaffId(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<string | null> {
  const roles = await loadActiveStaffRoles(db, shopId, personId);
  return roles && isStaff(roles) ? personId : null;
}

/** {@link loadActiveStaffRoles}'s person-scoped sibling, memoized the same way. */
export const loadActiveStaffRolesByPerson = cache(readActiveStaffRolesByPerson);

async function canPerson(
  db: DbExecutor,
  shopId: string,
  personId: string,
  predicate: (roles: readonly Role[]) => boolean,
): Promise<boolean> {
  const roles = await loadActiveStaffRoles(db, shopId, personId);
  return roles !== null && predicate(roles);
}

/**
 * Live DB-checked: may this person act on a Today row of this kind (its
 * `KIND_AUDIENCE`)? What Today hides from a role, the action behind it refuses
 * (issue #2134), read from the database, never from the session's cached roles.
 */
export const canPersonActOnKind = (
  db: DbExecutor,
  shopId: string,
  personId: string,
  kind: TodayActionKind,
) => canPerson(db, shopId, personId, (roles) => rolesMayActOnKind(kind, roles));

/** Live DB-checked companions of the H-14 predicates (src/lib/authz.ts). */
export const canPersonManagePaymentSettings = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canManagePaymentSettings);

/** Live DB-checked companion of the owner-only billing gate (src/lib/authz.ts). */
export const canPersonManageBilling = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canManageBilling);

/** Live DB-checked companion of the owner-only integration backfill gate (src/lib/authz.ts). */
export const canPersonBackfillIntegrations = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canBackfillIntegrations);

export const canPersonManageMessagingSettings = (
  db: DbExecutor,
  shopId: string,
  personId: string,
) => canPerson(db, shopId, personId, canManageMessagingSettings);

export const canPersonRefund = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canRefund);

/** Live DB-checked companion of the activity-log gate (src/lib/authz.ts). */
export const canPersonViewShopActivity = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canViewShopActivity);

/**
 * Live DB-checked companion of the invoicing gate (src/lib/authz.ts).
 * `createOrder` calls this itself as well as the route/action above it: an
 * invoice is a bill sent to a real customer on the shop's own Stripe account,
 * so "the caller forgot to check" is not something a later apology undoes.
 */
export const canPersonManageOrders = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canManageOrders);

/** Live DB-checked companion of the dispute-sheet gate (src/lib/authz.ts). */
export const canPersonExportDisputeSheet = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canExportDisputeSheet);

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

/** Live DB-checked companions of the three register gates (src/lib/authz.ts, issue #2659). */
export const canPersonManageBoats = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canManageBoats);

export const canPersonManageTripTags = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canManageTripTags);

export const canPersonManageSafetyChecklist = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canManageSafetyChecklist);

/**
 * The rental editors' gate (#1854): shop settings *and* payment settings, the
 * two the hub asked before drawing the Rental gear group at all and the two
 * their actions re-check (`settingsBlock`, `paymentSettingsBlock`). One live
 * read, both predicates over the same roles.
 */
export const canPersonManageRentalSettings = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(
    db,
    shopId,
    personId,
    (roles) => canManageShopSettings(roles) && canManagePaymentSettings(roles),
  );

/** Live DB-checked companion of the add-a-diver gate, which every staff role holds (src/lib/authz.ts). */
export const canPersonAddDiver = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canAddDiver);

export const canPersonDeleteDiver = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canDeleteDiver);

/** Live DB-checked companion of the explicit diver-record merge gate. */
export const canPersonMergeDiver = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canMergeDiver);

/**
 * Live DB-checked companion of the owner-only erasure gate
 * (ADR 20260802-diver-data-erasure). `anonymizeDiver` calls this itself rather
 * than trusting its caller: the action is one-way, so "the route forgot to
 * check" has no remedy after the fact.
 */
export const canPersonErasePersonalData = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canErasePersonalData);

/**
 * The live check behind the physician's-evaluation route (issue #1283). Read
 * from `person_roles` on every request rather than from the session's stamped
 * roles, for the same reason the erasure gate above does: a manager demoted
 * this morning must not still be able to open a diver's medical file with a
 * tab they left open.
 */
export const canPersonReadMedicalClearanceDocument = (
  db: DbExecutor,
  shopId: string,
  personId: string,
) => canPerson(db, shopId, personId, canReadMedicalClearanceDocument);

/** The live check behind the doctor's form a diver sent (`canReadDiverMedicalForm`, issue #2797). */
export const canPersonReadDiverMedicalForm = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canReadDiverMedicalForm);

/** The live check behind a signed record's whole questionnaire (`canReadMedicalAnswers`). */
export const canPersonReadMedicalAnswers = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canReadMedicalAnswers);

/** The live check behind a signed record's answers to the shop's own questions (`canReadShopAnswers`). */
export const canPersonReadShopAnswers = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canReadShopAnswers);

/**
 * The live check behind the **text of a medical alert for the crew** on one
 * departure's manifest and roll call (`canReadMedicalAlert`, issue #2960):
 * live roles, and whether **a live owner or manager of this shop** put this
 * person on that departure's crew (`trip_assignments`, shop-scoped through
 * the live trip). Anyone who can configure trips can write a roster, so an
 * assignment counts only through who made it: not one the person wrote for
 * themselves, not one that names nobody, and not one another instructor made
 * (security review 2, M-1). The assigner's roles are read live, so a manager
 * demoted, disabled or removed since stops vouching for what they assigned.
 * The owner and a manager read it however they got on the roster. A crew
 * member taken off the boat this morning loses the text online with the
 * assignment (a copy saved for offline drops it at the next refresh, or
 * keeps it until it expires at sea, H-153). The caller still confirms the
 * diver is booked on `tripId`.
 */
export async function canPersonReadMedicalAlertOnTrip(
  db: DbExecutor,
  shopId: string,
  personId: string,
  tripId: string,
): Promise<boolean> {
  const roles = await loadActiveStaffRoles(db, shopId, personId);
  if (roles === null) return false;
  if (canReadMedicalAlert(roles, { crewsDiversDeparture: false })) return true;
  const [assigned] = await db
    .select({ assignedBy: tripAssignments.assignedByPersonId })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .where(
      and(
        eq(tripAssignments.tripId, tripId),
        eq(tripAssignments.personId, personId),
        isNotNull(tripAssignments.assignedByPersonId),
        ne(tripAssignments.assignedByPersonId, tripAssignments.personId),
        eq(trips.shopId, shopId),
        liveTrip(),
      ),
    )
    .limit(1);
  if (!assigned?.assignedBy) return false;
  const assignerRoles = await loadActiveStaffRoles(db, shopId, assigned.assignedBy);
  const vouched =
    assignerRoles !== null && canReadMedicalAlert(assignerRoles, { crewsDiversDeparture: false });
  return canReadMedicalAlert(roles, { crewsDiversDeparture: vouched });
}

/**
 * The same check with no departure in hand (the signed record page): only the
 * roles that read it everywhere, the owner and a manager.
 */
export const canPersonReadMedicalAlert = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, (roles) =>
    canReadMedicalAlert(roles, { crewsDiversDeparture: false }),
  );

/**
 * The live check behind "Print with medical alerts" (`canPrintMedicalAlerts`,
 * issue #2990): the owner and a manager, read from `person_roles` now, so a
 * manager demoted this morning prints the flag only.
 */
export const canPersonPrintMedicalAlerts = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canPrintMedicalAlerts);

/**
 * **Where one staffer stands for "Emergency: show the alert" on one
 * departure** (`canEmergencyReadMedicalAlert`, issue #2990): `refused` unless
 * they are an active staffer of this shop (live roles) and the departure is
 * a live one of this shop; otherwise the departure's `emergencyReadWindow`
 * in the shop's zone, from the clock (`nowDate()`, never the device's).
 *
 * `open` is the only answer that reads the words. The manifest offers the
 * button while it is `not_yet` too, so a tab opened the night before still
 * has it at sea, and the server answers again on the confirm. The caller
 * still confirms the diver is booked on `tripId`, and offers it only where
 * `canPersonReadMedicalAlertOnTrip` refused.
 */
export async function emergencyMedicalAlertStanding(
  db: DbExecutor,
  shopId: string,
  personId: string,
  tripId: string,
  now: Date = nowDate(),
): Promise<EmergencyReadWindow | "refused"> {
  const roles = await loadActiveStaffRoles(db, shopId, personId);
  if (roles === null) return "refused";
  const [departure] = await db
    .select({ startsAt: trips.startsAt, endsAt: trips.endsAt, timezone: shops.timezone })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  if (!departure) return "refused";
  // Someone the rule would never admit, even on the day, hears nothing about the window.
  if (!canEmergencyReadMedicalAlert(roles, { window: "open" })) return "refused";
  return emergencyReadWindow(departure, departure.timezone, now);
}

/** The live check behind "Send a new waiver" on a refused seat (`retireMedicalRefusal`). */
export const canPersonRetireMedicalRefusal = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canRetireMedicalRefusal);

/**
 * The live check behind the private pulse panel and its "Mark addressed"
 * (issue #1410). Read from `person_roles` on every request rather than the
 * session's stamped roles, for the same reason the medical-document gate above
 * does: a manager demoted this morning must not still be reading what divers
 * told the shop in confidence from a tab they left open.
 */
export const canPersonReadPrivateRecapPulse = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canReadPrivateRecapPulse);

/** Live DB-checked companion of the review-reply gate (src/lib/authz.ts). */
export const canPersonReplyToReviews = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canReplyToReviews);

export const canPersonConfigureTrips = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canConfigureTrips);

/** Live DB-checked companion of the day weather-call gate (src/lib/authz.ts). */
export const canPersonCallDayBlowout = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canCallDayBlowout);

/**
 * Live DB-checked companion of the owner-only incident-export gate
 * (src/lib/authz.ts). The export route calls this itself as well as the
 * manifest that links to it: the document names whoever generated it, so
 * "the link was hidden" is not a control.
 */
export const canPersonExportIncidentRecord = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canExportIncidentRecord);

/** Live DB-checked companion of `canReadEveryIncidentReport` (src/lib/authz.ts). */
export const canPersonReadEveryIncidentReport = (
  db: DbExecutor,
  shopId: string,
  personId: string,
) => canPerson(db, shopId, personId, canReadEveryIncidentReport);

/** Live DB-checked companion of the "Change anyway" card-check override (src/lib/authz.ts). */
export const canPersonOverrideCertBlock = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canOverrideCertBlock);

/** Live DB-checked companion of the H-06 gear-override gate (src/lib/authz.ts). */
export const canPersonOverrideGearRequest = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canOverrideGearRequest);

/** Live DB-checked companion of the staff-account gate (20260726-staff-invite-accounts). */
export const canPersonManageStaffAccounts = (db: DbExecutor, shopId: string, personId: string) =>
  canPerson(db, shopId, personId, canManageStaffAccounts);
