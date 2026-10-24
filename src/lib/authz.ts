/**
 * Role vocabulary and staff gating. Keep the Role union aligned with the
 * person_role pg enum in src/db/schema.ts. Route-level gating happens in
 * src/proxy.ts (outer wall); server code re-checks with requireStaffSession()
 * — the proxy is never the only layer (ADR-0006).
 */

import type { EmergencyReadWindow } from "./medical-alert";
import type { StaffDestinationGates } from "./staff-destinations";

export const ALL_ROLES = [
  "owner",
  "manager",
  "instructor",
  "assistant_instructor",
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
  "assistant_instructor",
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
  assistant_instructor: "Assistant Instructor",
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

/**
 * Read why a crew member is away (issue #2673, decided by Aaron 2026-10-17):
 * the note can be personal ("hospital appointment"), so past the person
 * themself only owners and managers read it. Its own gate rather than a
 * borrowed one, so a change to who manages staff accounts or who exports
 * cannot quietly widen it; `authz.test.ts` pins that every exporter is also
 * a reader, since the shop export hands every note over.
 */
export function canReadCrewAwayNote(roles: readonly Role[] | undefined): boolean {
  return isOwnerOrManager(roles);
}

/**
 * See and change what the shop pays **DiveDay** — the card on file, the plan,
 * cancelling (ADR 20261007-subscription-billing). Owner only, stricter than
 * the shop's own payment settings: this is the business's contract with its
 * vendor, the card is the owner's, and cancelling ends the shop's use of the
 * product. A manager runs the shop's money; the owner decides whether the shop
 * keeps paying for its tools.
 */
export function canManageBilling(roles: readonly Role[] | undefined): boolean {
  return (roles ?? []).some((role) => role === "owner");
}

/**
 * Send the checkouts, tips and refunds that completed before an integration
 * was connected to it (issue #2606). Owner only, stricter than connecting the
 * integration: it posts history into a shop's books, which may have a closed
 * period or a month the owner reconciled by hand, and nothing recalls it.
 */
export function canBackfillIntegrations(roles: readonly Role[] | undefined): boolean {
  return (roles ?? []).some((role) => role === "owner");
}

/**
 * Read the shop's activity log (D5, `src/db/shop-activity.ts`): who refunded,
 * who wrote a seat past a missing card, who changed a departure, across the
 * whole team. It is an account of the staff's own work, named person by
 * person, so it is the accountable roles' reading rather than the crew's —
 * the same owner/manager gate as reports and the export.
 */
export function canViewShopActivity(roles: readonly Role[] | undefined): boolean {
  return isOwnerOrManager(roles);
}

/**
 * Print a seat's dispute sheet (`orders/[id]/print/dispute`, issue #2390): the
 * signed release's date, name and version, the check-in time and every
 * roll-call result for one booking, on a page whose purpose is to be handed to
 * a card network. Owner or manager, the same wall as {@link canRefund} and
 * {@link canExportShopData}: it is a diver's attendance record leaving the shop
 * on the strength of a money argument, and the crew who run the water have no
 * part in that argument. It carries no medical answer at any role
 * (`assembleDisputeSheet`, src/lib/dispute-sheet.ts).
 */
export function canExportDisputeSheet(roles: readonly Role[] | undefined): boolean {
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
 * **The shop's registers each carry their own gate** (Aaron, 2026-10-17, issue
 * #2659; glossary "Register and setting"). Boats, trip tags and the safety
 * checklist used to borrow {@link canManageShopSettings} because they lived in
 * Settings. They now sit beside dive sites and gear at `/shop/<slug>/<noun>`,
 * and a register that can be loosened or tightened separately says so here.
 * Today each answers the same roles as the settings gate did: the fleet's
 * certificate limits, the vocabulary every departure wears and the list the
 * crew ticks before leaving the dock are shop-wide policy, not the day's work.
 */
export function canManageBoats(roles: readonly Role[] | undefined): boolean {
  return isOwnerOrManager(roles);
}

/** The shop's trip tags ("kinds of day"): the vocabulary every departure wears. */
export function canManageTripTags(roles: readonly Role[] | undefined): boolean {
  return isOwnerOrManager(roles);
}

/** The pre-departure safety checklist's items: what the crew must tick before the boat leaves. */
export function canManageSafetyChecklist(roles: readonly Role[] | undefined): boolean {
  return isOwnerOrManager(roles);
}

/**
 * Add a diver from the staff search: create the person a walk-up, a phone call
 * or a name on a clipboard turns out to be. **Every staff role holds it**, a
 * captain included, because the person at the dock may be the one who meets a
 * walk-up (Aaron, 2026-10-13, issue #2340). It is named so the decision is
 * visible here and a role can be taken off it in one place, rather than being
 * the only person-creating door that asks nothing but "are you staff".
 * Removing or merging that record is not this: those are owner/manager work.
 */
export function canAddDiver(roles: readonly Role[] | undefined): boolean {
  return isStaff(roles);
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
 * **Open the signed doctor's form a diver sent from the doctor's page**,
 * before anybody has recorded the physician's answer (issue #2797, ADR
 * 20261024-diver-sent-doctors-form).
 *
 * Exactly the roles that may **record** that answer: every live staff role,
 * the gate `recordMedicalClearanceAction` applies (`isLiveStaff`). The
 * staffer at the rail who records the clearance has to read the form to do
 * it, so a narrower gate would send the diver back to the shop's mailbox.
 * Wider than {@link canReadMedicalClearanceDocument} on purpose, and only
 * until the answer is recorded: then the form is the evaluation, behind that
 * gate, or deleted. Every open is written to the diver's trail
 * (`diver_medical_form_opened`). If recording ever narrows, this narrows
 * with it.
 */
export function canReadDiverMedicalForm(roles: readonly Role[] | undefined): boolean {
  return isStaff(roles);
}

/**
 * Who reads a diver's **whole** medical questionnaire on their signed record
 * (`divers/[personId]/waivers/[recordId]`), every answer and the physician's
 * name. Owner or manager: the same wall as {@link canExportShopData}, which
 * hands over the complete answers in bulk. Every other staff role sees what the
 * trip roster already shows them, the prompts that flagged, so whoever records
 * a clearance can still read what they are clearing.
 */
export function canReadMedicalAnswers(roles: readonly Role[] | undefined): boolean {
  return isOwnerOrManager(roles);
}

/**
 * Who reads the **shop's own questions as a diver answered them** on a signed
 * record (glossary *Shop question*): every staff role that can open the record.
 * The answers are operational (dives logged, how they heard of the shop,
 * insurance), the crew act on them, and hiding them behind owner/manager would
 * mean the people at the rail never see them (dive-domain review, point 1).
 *
 * Its own predicate, never a borrow of whatever gate the record page happens
 * to run, for the reason {@link canReadPrivateRecapPulse} sets out: a reader
 * set that may change needs a name. That answer holds only while health
 * questions stay on the standard questionnaire, which is why the editor warns
 * on a health word; if a medical-class field ever arrives it is not this one.
 * Never the roster, the manifest, the dispute sheet, or a bearer page other
 * than the diver's own waiver.
 */
export function canReadShopAnswers(roles: readonly Role[] | undefined): boolean {
  return isStaff(roles);
}

/**
 * Who reads the **text of a diver's medical alert for the crew** (glossary
 * *Medical alert for the crew*, issue #2960, option 1 as Aaron chose it on
 * 2026-10-23): the owner and a manager always, and any other staff role only
 * for a diver booked on a departure a live owner or manager put them on the
 * crew of (`trip_assignments`, never a row they or another instructor wrote), on that
 * departure's manifest and roll call. The crew are the people who need to
 * know where the EpiPen is; the rest of the staff see that an alert exists
 * and who can read it, never what it says.
 *
 * `crewsDiversDeparture` is the caller's answer, read from the roster for the
 * departure in hand (`canPersonReadMedicalAlertOnTrip`, src/db/authz.ts); a
 * surface with no departure in hand (the signed record) passes false. Never a
 * bearer page other than the diver's own waiver, never the dispute sheet,
 * never the public site.
 */
export function canReadMedicalAlert(
  roles: readonly Role[] | undefined,
  scope: { crewsDiversDeparture: boolean },
): boolean {
  if (isOwnerOrManager(roles)) return true;
  return isStaff(roles) && scope.crewsDiversDeparture;
}

/**
 * Who prints a departure's packet **with the medical alerts' words on it**
 * (issue #2990, H-153 amendment of 2026-10-24): the owner and a manager, the
 * readers who hold the words on every departure. Paper records no read of its
 * own, so the print is the read: the server writes one `medical_alert_printed`
 * line per diver when it produces the sheet. Crew who read the words on
 * screen do not print them; the default print keeps the flag only. Never the
 * dispute sheet, the day's paper or any other print.
 */
export function canPrintMedicalAlerts(roles: readonly Role[] | undefined): boolean {
  return isOwnerOrManager(roles);
}

/**
 * Who may open a diver's medical alert **in an emergency** when
 * {@link canReadMedicalAlert} refuses them (issue #2990, H-153 amendment of
 * 2026-10-24): any active staffer of the shop, only on the days of the
 * diver's trip in the shop's zone (`emergencyReadWindow`: from the start of
 * the day it leaves until the later of the end of the day it is due back and
 * the moment it is marked returned). A captain not on the crew list, or a
 * divemaster added at the dock, can still find where the EpiPen is, on a
 * night boat past midnight and on day two of a course as well. Every such
 * read is loud: `medical_alert_emergency_read` on the diver's trail, never
 * de-duplicated, and listed in the owner's Monday email.
 *
 * `window` is the caller's answer, read from the clock and the shop's zone
 * (`emergencyMedicalAlertStanding`, src/db/authz.ts). Never a bearer page,
 * never an offline copy.
 */
export function canEmergencyReadMedicalAlert(
  roles: readonly Role[] | undefined,
  scope: { window: EmergencyReadWindow },
): boolean {
  return isStaff(roles) && scope.window === "open";
}

/**
 * **Retire a physician's refusal so the seat can take a fresh release** — the
 * supersede act the glossary's *Physician clearance* entry named as the thing
 * to build once a shop hit it (Aaron, 2026-10-06).
 *
 * Owner or manager. It lifts nothing by itself — the refusal keeps outranking
 * every older signature (`isStandingRefusal`) and the diver stays blocked until
 * the new release is signed and, if it refers them again, cleared — but it is
 * the one act that moves a physician's "no" off the seat it was recorded on,
 * and that is the business's call rather than whoever is at the desk.
 */
export function canRetireMedicalRefusal(roles: readonly Role[] | undefined): boolean {
  return isOwnerOrManager(roles);
}

/**
 * **Read what a diver privately asked the shop to fix** — the recap pulse
 * (D40, issue #1200; the owner/manager narrowing is issue #1410).
 *
 * Owner or manager, the same boundary and the same reasoning as
 * {@link canReadMedicalClearanceDocument}: these are the diver's own words,
 * under the diver's name, and they frequently name crew. Nothing on the boat
 * needs them.
 *
 * **Why this is its own predicate and not a call to {@link canViewShopReports}.**
 * The panel and its action borrowed the revenue gate, which happens to carry
 * the same role set. But the pulse form tells the diver who will read it —
 * `recap.pulseAudience`, "Just for the owner and managers at {shop}" — and a
 * sentence like that is only true while the reader set is the one it names.
 * Borrowed, the day somebody opens reports to instructors the panel opens with
 * it and the promise goes quietly false, with nothing to turn red. A reader set
 * a diver was promised needs a name of its own; `authz.test.ts` pins it against
 * that sentence in both locales, so widening this gate without rewriting the
 * promise fails there (security review, the RFH-05 layer).
 */
export function canReadPrivateRecapPulse(roles: readonly Role[] | undefined): boolean {
  return isOwnerOrManager(roles);
}

/**
 * **Answer a review in public** (batch 4, K2): write, change or delete the
 * shop's reply under it. Owner or manager. Moderating a review stays open to
 * every staff role, because publishing releases a diver's own words; a reply
 * is the shop speaking in its own name on its own public page, which is the
 * owner's voice to lend.
 */
export function canReplyToReviews(roles: readonly Role[] | undefined): boolean {
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
 * Read every incident report in the shop, whoever wrote it (ADR
 * 20261012-incident-reports). Owners and managers. Anyone else on staff reads
 * only the reports they started, which `src/lib/incident-reports.ts` decides.
 */
export function canReadEveryIncidentReport(roles: readonly Role[] | undefined): boolean {
  return (roles ?? []).some((role) => role === "owner" || role === "manager");
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
 * **The day's weather call** (ADR 20261009-day-weather-call): cancelling every
 * boat of a morning or a day in one act is the go/no-go of whoever runs the
 * operation — owner, manager, or captain (owner's decision, 2026-10-09). The
 * single-departure blow-out stays open to all staff.
 */
export function canCallDayBlowout(roles: readonly Role[] | undefined): boolean {
  return (roles ?? []).some((role) => role === "owner" || role === "manager" || role === "captain");
}

/**
 * **Seat someone in the water past a missing card**: "Change anyway" when a
 * snorkeler or rider is changed to a diver and the booking-time card check
 * would refuse them (ADR 20261007-participant-types). It is the certification
 * call a trip's own gate is, so it takes the roles that may set that gate:
 * owner, manager and instructor. A divemaster or captain gets the refusal and
 * no way past it. The boarding gate still asks for the card either way.
 */
export function canOverrideCertBlock(roles: readonly Role[] | undefined): boolean {
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

/**
 * Which destination gates these roles pass — the one reading the nav, the
 * palette and a section's tabs share, so a tab never offers a page the nav
 * would hide.
 */
export function staffDestinationGates(
  roles: readonly Role[] | undefined,
  shop: { hasBoatDiving: boolean } = { hasBoatDiving: true },
): StaffDestinationGates {
  return {
    waivers: canManageWaiverTemplates(roles),
    reports: canViewShopReports(roles),
    team: canManageStaffAccounts(roles),
    settings: canManageShopSettings(roles),
    boats: canManageBoats(roles) && shop.hasBoatDiving,
    tripTags: canManageTripTags(roles),
    safetyChecklist: canManageSafetyChecklist(roles),
  };
}
