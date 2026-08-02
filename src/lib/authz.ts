/**
 * Role vocabulary and staff gating. Keep the Role union aligned with the
 * person_role pg enum in src/db/schema.ts. Route-level gating happens in
 * src/proxy.ts (outer wall); server code re-checks with requireStaffSession()
 * — the proxy is never the only layer (ADR-0006).
 */

export const ALL_ROLES = [
  "owner",
  "manager",
  "instructor",
  "divemaster",
  "captain",
  "crew",
  "diver",
] as const;

export type Role = (typeof ALL_ROLES)[number];

export const STAFF_ROLES: readonly Role[] = [
  "owner",
  "manager",
  "instructor",
  "divemaster",
  "captain",
  "crew",
];

export function isStaff(roles: readonly Role[] | undefined): boolean {
  return (roles ?? []).some((role) => STAFF_ROLES.includes(role));
}

/**
 * Display copy for a role — the team-management UI and invite email
 * (20260726-staff-invite-accounts). Covers every `Role` (not just
 * `STAFF_ROLES`) so it's a plain `Record` any staff-role value can safely
 * index, even though the team UI only ever looks up staff roles.
 */
export const STAFF_ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  manager: "Manager",
  instructor: "Instructor",
  divemaster: "Divemaster",
  captain: "Captain",
  crew: "Crew",
  diver: "Diver",
};

/**
 * The full-shop export hands over more than any staff surface shows — every
 * diver's contact details plus complete signed medical answers — so it is the
 * one staff feature gated past `isStaff`, to the accountable roles
 * (ADR 20260722-full-shop-export).
 */
export function canExportShopData(roles: readonly Role[] | undefined): boolean {
  return (roles ?? []).some((role) => role === "owner" || role === "manager");
}

/**
 * Bulk contact import writes to the roster and carries the whole file's people,
 * cards, and sizes at once — the same accountability weight as the export, so
 * it takes the same owner/manager gate (ADR 20260723-contact-importer).
 */
export function canImportShopData(roles: readonly Role[] | undefined): boolean {
  return canExportShopData(roles);
}

/**
 * Owner reporting is the buyer's "how's my month" — revenue, fill rate, waiver
 * completion across the whole shop. Revenue is owner-grade information the daily
 * crew has no reason to see, so it takes the same accountable owner/manager gate
 * as export and import (ADR 20260723-owner-reporting).
 */
export function canViewShopReports(roles: readonly Role[] | undefined): boolean {
  return canExportShopData(roles);
}

/**
 * Role boundaries on the five surfaces the product owner scoped as "not every
 * staff member's job" (H-14). Until now any staff role could reach all of them;
 * the daily crew — captains, crew, and divemasters — run the water, but money,
 * legal templates, roster deletion, and what a trip *is* are owner/manager work
 * (trip *configuration* also opens to instructors, who own course sessions and
 * their admission rules). Each predicate below is one surface; server actions
 * and route guards call these, and the UI hides the control when they're false
 * so a crew member is never shown a button they'll be bounced from.
 * See ADR 20260724-role-authorization.
 */

/** Owner/manager gate shared by the money/policy/roster-deletion surfaces. */
function isOwnerOrManager(roles: readonly Role[] | undefined): boolean {
  return (roles ?? []).some((role) => role === "owner" || role === "manager");
}

/** Connect/disconnect Stripe, set the rental catalog and its prices. */
export function canManagePaymentSettings(roles: readonly Role[] | undefined): boolean {
  return isOwnerOrManager(roles);
}

/**
 * Invite a staff member, edit their roles, resend an invite, or
 * disable/remove their access — the same accountability weight as payment
 * settings and refunds: it grants logins and role authority over the rest of
 * this list (ADR 20260726-staff-invite-accounts).
 */
export function canManageStaffAccounts(roles: readonly Role[] | undefined): boolean {
  return isOwnerOrManager(roles);
}

/** Issue or record a refund — money leaving the shop's account. */
export function canRefund(roles: readonly Role[] | undefined): boolean {
  return isOwnerOrManager(roles);
}

/** Create or edit the shop's waiver template — the legal instrument itself. */
export function canManageWaiverTemplates(roles: readonly Role[] | undefined): boolean {
  return isOwnerOrManager(roles);
}

/**
 * Soft-delete a diver, which frees their email and drops them from the roster.
 * The daily crew adds and checks in divers; removing a person record is an
 * owner/manager call.
 */
export function canDeleteDiver(roles: readonly Role[] | undefined): boolean {
  return isOwnerOrManager(roles);
}

/**
 * Erase a diver: destroy their identifying and medical data across the shop and
 * re-seal their signed releases as evidence skeletons
 * (ADR 20260802-diver-data-erasure). Deliberately **stricter** than
 * `canDeleteDiver` — owner only, not owner-or-manager.
 *
 * Removal is reversible and loses nothing; erasure is one-way and permanently
 * reduces what the shop can prove about a release it holds. That is a decision
 * about the business's own legal position, not a roster-hygiene chore, so it
 * sits with the one role that answers for it. A manager who needs a diver gone
 * from the active lists already has "Remove"; only the owner can make the data
 * unrecoverable.
 */
export function canErasePersonalData(roles: readonly Role[] | undefined): boolean {
  return (roles ?? []).some((role) => role === "owner");
}

/**
 * Create, edit, cancel a trip, or set its requirements/crew — defining what the
 * dive *is* and who it admits. Opens to instructors as well, since course
 * sessions and their admission rules are instructor-owned, but stays closed to
 * captains, crew, and divemasters, who operate the trips owners/managers set up.
 */
export function canConfigureTrips(roles: readonly Role[] | undefined): boolean {
  return (roles ?? []).some(
    (role) => role === "owner" || role === "manager" || role === "instructor",
  );
}

/**
 * Rewrite what a diver themselves asked for in their rental fit — sizes, and
 * which pieces they want (H-06). Deliberately *not* the same thing as packing
 * the boat: any staff member may substitute a real available item and flag a
 * diver for hands-on fitting, because that is the day's work and the safe
 * fallback. Overwriting the diver's stated request is the in-water judgement
 * call — an instructor, divemaster, or manager decides a diver needs a
 * different size than they believe they do, and owns that if it's wrong.
 * See ADR 20260724-gear-fit-fallback.
 */
export function canOverrideGearRequest(roles: readonly Role[] | undefined): boolean {
  return (roles ?? []).some(
    (role) =>
      role === "owner" || role === "manager" || role === "instructor" || role === "divemaster",
  );
}
