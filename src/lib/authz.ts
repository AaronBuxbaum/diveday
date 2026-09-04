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
 * Connect or disconnect the shop's own WhatsApp Business sender. Owner/manager
 * work for the same reason payment settings are: the credential it stores can
 * send messages *as the business*, and the number it names is what divers will
 * reply to (ADR 20260802-whatsapp-cloud-api-per-shop).
 */
export function canManageMessagingSettings(roles: readonly Role[] | undefined): boolean {
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

/**
 * Raise an invoice against a diver — an order billed on the shop's own
 * connected Stripe account, which reaches the customer with the shop's name on
 * it and lands in the shop's books. Money *in* is the same accountable work as
 * money out (`canRefund`) and as the pricing that decides what money there is
 * (`canManagePaymentSettings`, which gates discount codes): the daily crew run
 * the water, the shop bills for it. Raising an order only: voiding one and the
 * Today queue's re-send of an existing invoice stay open to any staff member,
 * since neither puts a new bill in front of anyone
 * (ADR 20260803-invoicing-role-gate).
 */
export function canManageOrders(roles: readonly Role[] | undefined): boolean {
  return isOwnerOrManager(roles);
}

/** Create or edit the shop's waiver template — the legal instrument itself. */
export function canManageWaiverTemplates(roles: readonly Role[] | undefined): boolean {
  return isOwnerOrManager(roles);
}

/**
 * Reach the shop's settings at all.
 *
 * Every card on that page changes something shop-wide and lasting: the name
 * divers see, the timezone every departure is read in, the address on the
 * booking page, the units the crew work in, what the review link points at.
 * The individually dangerous ones (money, messaging, import/export, the team)
 * already carried their own gates, so the page was a list of controls a
 * captain could see and mostly not use — and the ones with no gate of their
 * own were shop-wide policy anybody on the water could quietly rewrite.
 *
 * So the page itself is owner/manager work now, in line with every other
 * "changes the shop, not the day" surface (H-14, ADR
 * 20260724-role-authorization).
 *
 * **`/settings/calendar` is deliberately outside this gate.** A staff calendar
 * subscription is a personal feed of that staffer's own shifts, not shop
 * policy — it is filed under Settings by URL only — so it keeps its own door
 * (`calendarFeed` in the destination registry) and stays open to every staff
 * role.
 */
export function canManageShopSettings(roles: readonly Role[] | undefined): boolean {
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
 * Merge two diver records — a reversible-in-the-database identity decision
 * that moves operational history, so it has the same owner/manager boundary
 * as deleting a roster record (issue #730).
 */
export function canMergeDiver(roles: readonly Role[] | undefined): boolean {
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
 * **Open the physician's evaluation a shop stored against a medical
 * clearance** — the most sensitive file the product holds (issue #1283).
 *
 * Owner or manager, and deliberately *not* the staff who may **record** one.
 * Those are two different acts. Recording is counter work: a diver arrives
 * with a letter, and whoever is behind the desk types the date and attaches
 * the paper. Reading it back has no operational use at all — a divemaster at
 * the rail needs to know the diver is cleared, and readiness already answers
 * that. What the cardiologist actually wrote is nobody's business on the boat.
 *
 * **Why not owner-only, given that.** Not for convenience: needing two people
 * in the room for the rarest and most sensitive read would be a feature. The
 * reason is {@link canExportShopData}, which is owner-or-manager and hands
 * over *every diver's contact details plus their complete signed medical
 * answers*, in bulk, in one click. Gating one physician's letter tighter than
 * the bulk export of the questionnaires underneath it moves the door without
 * moving the wall. It runs the other way too: a trip roster already shows any
 * staff member which medical prompts flagged (`RosterSection`), so
 * owner-or-manager here is *stricter* than the surface around it, not looser.
 *
 * **What makes it safe is the trail, not the role list.** Every open is
 * recorded on the diver's own record (`recordDiverActivity`, in the route), so
 * a shop can see who read a diver's file and when. Without that, the role
 * boundary alone would be a promise nobody can check.
 */
export function canReadMedicalClearanceDocument(roles: readonly Role[] | undefined): boolean {
  return isOwnerOrManager(roles);
}

/**
 * Open a departure's incident-ready export — the single document a shop hands
 * to authorities or an insurer after something goes wrong. Owner only, the same
 * strictness as `canErasePersonalData` and deliberately tighter than the
 * owner/manager gate on the full-shop export.
 *
 * The manifest itself stays open to the whole crew: they run the roll call, and
 * gating what they need to sail would be absurd. This is a different act. The
 * export assembles one departure's complete evidentiary record — every diver's
 * certification evidence, waiver status, and the full roll-call timeline with
 * every recorder named — into a signed artefact whose whole purpose is to be
 * handed *outside* the shop, and it stamps whoever generated it into the
 * document. Producing the business's account of an incident is the owner's call
 * to make and answer for, not a control any staff member should find themselves
 * one tap from on the day it matters.
 */
export function canExportIncidentRecord(roles: readonly Role[] | undefined): boolean {
  return (roles ?? []).some((role) => role === "owner");
}

/**
 * Create, edit, or set a trip's admission requirements — defining what the dive
 * *is* and who it admits. Opens to instructors as well, since course sessions
 * and their admission rules are instructor-owned, but stays closed to captains,
 * crew, and divemasters, who operate the trips owners/managers set up.
 *
 * **Not the crew, and not cancelling a single departure for weather.** H-14's
 * own record says so — a `dive-domain-expert` review on 2026-07-24 narrowed
 * this gate to trip *definition* (details, requirements, whole-series
 * operations, creation, reinstate) and left the day-of operating actions the
 * glossary assigns to crew open: predicted conditions, day-of crew assignment
 * for manifest accuracy, and one departure's weather cancellation.
 *
 * This sentence said "requirements/crew" anyway, for thirteen months, while
 * `updateTripCrewAction` gated nobody. The roster in `actions.authz.test.ts`
 * then wrote down *this sentence's* answer rather than the code's, and nothing
 * could notice, because it compared action names and never read a gate (issue
 * #788). Confirmed with Aaron on 2026-08-22 before correcting it: a captain
 * swapping a divemaster at the dock does not wait for an owner, and Today's
 * board offers the same one-tap assign. That roster reads each action's body
 * now, so this docstring cannot drift away from the code in silence again.
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
