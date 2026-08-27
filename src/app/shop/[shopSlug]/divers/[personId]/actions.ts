"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { anonymizeDiver } from "@/db/anonymize";
import {
  canPersonDeleteDiver,
  canPersonErasePersonalData,
  canPersonMergeDiver,
  canPersonOverrideGearRequest,
  canPersonRefund,
  loadActiveStaffRoles,
} from "@/db/authz";
import { type AppDb, getDb } from "@/db/client";
import { mergeDiverRecords } from "@/db/diver-merge";
import {
  deleteDiver,
  getDiverProfile,
  isDiverRemoved,
  restoreDiver,
  updateDiver,
} from "@/db/divers";
import {
  createNitroxCertification,
  deleteNitroxCertification,
  restoreNitroxCertification,
  reviewNitroxCertification,
  unreviewNitroxCertification,
} from "@/db/nitrox";
import { addDiverNote, deleteDiverNote } from "@/db/operations";
import { refundOrder } from "@/db/orders";
import {
  type CardSighting,
  type CertificationReviewRefusal,
  createCertification,
  createSpecialtyCertification,
  deleteCertification,
  deleteSpecialtyCertification,
  type LevelCardSighting,
  restoreCertification,
  restoreSpecialtyCertification,
  reviewCertification,
  reviewSpecialtyCertification,
  unreviewCertification,
  unreviewSpecialtyCertification,
} from "@/db/readiness";
import { getRentalFit, saveRentalFit, setNeedsStaffFit } from "@/db/rental-fit";
import { certificationAgency, certificationLevel, people } from "@/db/schema";
import { clearNoCertificationDeclaration } from "@/db/self-declared-cards";
import { getShopById } from "@/db/shops";
import { recordInPersonWaiver } from "@/db/waivers";
import { isPlausibleDateOfBirth } from "@/lib/age";
import { trackEvent } from "@/lib/analytics";
import { canOverrideGearRequest, isStaff } from "@/lib/authz";
import { isValidCalendarDate } from "@/lib/calendar-date";
import { isPlausibleCardNumber } from "@/lib/card-number";
import { revalidateAndRedirect } from "@/lib/navigation";
import { blankableDiverEmailSchema, diverNameSchema, diverPhoneSchema } from "@/lib/person-fields";
import { hasRequiredStepUp, stepUpChallengeUrl } from "@/lib/security-step-up";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

// The pg enum itself, not a copy of it: a card the column accepts is a card the
// form must accept, and a hand-kept list is what let CMAS/RAID/GUE be refused
// here while the database was ready for them (DOM-L1).
const agencySchema = z.enum(certificationAgency.enumValues);
// Same rule, and it matters more since the card sighting started parsing the
// level: a hand-written copy that falls behind the enum makes a legitimate
// submit fail *silently* (`levelSightingFromForm` returns undefined), which
// reads to the staffer as "you did not fill the form in".
const levelSchema = z.enum(certificationLevel.enumValues);
const specialtySchema = z.enum(["deep", "wreck", "night", "drysuit", "nitrox"]);
const personSchema = z.object({
  // Shared diver person-field bounds (src/lib/person-fields.ts); blank-able
  // email is this form's own call — clearing a wrong address to "" is valid.
  fullName: diverNameSchema,
  email: blankableDiverEmailSchema,
  phone: diverPhoneSchema,
  diveInsurance: z.string().trim().max(120),
  // Same bounds as `emergencyContactSchema` (src/lib/contact.ts), the shared
  // shape the diver-facing /ready and /waivers capture already validates
  // against — kept in sync by hand since this form also allows clearing a
  // wrong entry to "", which that schema's `.optional()` fields don't need to.
  emergencyContactName: z.string().trim().max(120),
  emergencyContactPhone: z.string().trim().max(40),
  // Optional on the form and blank-able: H-08's minimum-age gate fails open, so
  // a shop that never fills this in keeps booking exactly as it does today. The
  // plausibility bound is the one place it fails *closed*: a future or
  // pre-1900 date is a typo, and a future one would silently refuse every
  // age-gated course.
  dateOfBirth: z.union([
    z.literal(""),
    z
      .string()
      .refine(isValidCalendarDate, "not a real calendar date")
      // Arrow, not a bare reference: zod passes a second argument to the
      // predicate, which would land in the injectable `now` parameter.
      .refine((value) => isPlausibleDateOfBirth(value), "not a plausible date of birth"),
  ]),
});
// The card number, on every form on this page that takes one. It is the same
// bound everywhere **on purpose**: capturing a card and sighting one are
// different acts (see `sightingSchema`) but they reach the identical `verified`
// state, so a stricter check on only one of them is a speed bump with a door
// beside it — delete the claim, capture the same "xx", tap Mark certified, and
// the `self_declared_at` provenance is gone with it.
const cardNumberSchema = z.string().trim().max(120).refine(isPlausibleCardNumber);
const certificationSchema = z.object({
  agency: agencySchema,
  level: levelSchema,
  identifier: cardNumberSchema,
});
const specialtyCertificationSchema = z.object({
  agency: agencySchema,
  specialty: specialtySchema,
  identifier: cardNumberSchema,
});
/**
 * The card a staffer says they are holding, when the row they are verifying is
 * still only a diver's word (`certifications.selfDeclaredAt`).
 *
 * This is the act the number check above exists for. Capturing a card is a
 * staffer entering a card the shop is looking at; a *sighting* is the single
 * moment a stranger's typing becomes `verified` — the state readiness, trip
 * admission, every course prerequisite and the nitrox fill gate read. It
 * inherited the capture form's 2–120 characters, so **"xx" certified a
 * self-declared "Instructor"**: a required box with no shape is a box a hurried
 * person fills with anything. The check itself stays loose on purpose — see
 * `isPlausibleCardNumber`.
 */
const sightingSchema = z.object({
  agency: agencySchema,
  identifier: cardNumberSchema,
});
/**
 * A **level** card's sighting names the rung too. The diver's claim is what the
 * select is prefilled with, so the common submit carries it back unchanged —
 * but it arrives as a posted field that is validated against the closed ladder
 * like any other, never trusted from the row it is about to overwrite.
 */
const levelSightingSchema = sightingSchema.extend({ level: levelSchema });
const needsStaffFitSchema = z.object({
  needed: z.string().optional(),
  needsStaffFitNote: z.string().trim().max(200).optional(),
});
const profileSchema = z.object({
  bcd: z.string().optional(),
  regulator: z.string().optional(),
  wetsuit: z.string().optional(),
  maskFins: z.string().optional(),
  weights: z.string().optional(),
  diveComputer: z.string().optional(),
  gopro: z.string().optional(),
  bcdSize: z.string().trim().max(40),
  wetsuitSize: z.string().trim().max(40),
  finSize: z.string().trim().max(40),
  weightPreference: z.string().trim().max(120),
});

/**
 * Where on the record a form's outcome should put the reader.
 *
 * A server action redirects, and a redirect resets the scroll to the top — so
 * rendering an outcome inside its own section is only half the fix. Without the
 * anchor, saving a rental fit halfway down a ~6,400px record still lands the
 * staffer at the `<h1>` with the confirmation two screens below them, which is
 * the same complaint in the other direction. The ids are `DiverSection`'s
 * (`_components/DiverSections.tsx`) and the destructive tail's own headings.
 */
const FORM_ANCHORS: Record<string, string> = {
  cards: "#cards",
  "specialty-cards": "#cards",
  fit: "#fit",
  payments: "#payments",
  notes: "#notes",
  "book-activity": "#trips",
  remove: "#remove-heading",
  restore: "#removed-heading",
  erase: "#erase-heading",
  merge: "#merge-heading",
  // `details` sits under the header, which is where a redirect lands anyway.
};

/**
 * The record's URL carrying one form's outcome: the code, the form it belongs
 * to (`resolveDiverNotice`), and the anchor that puts that form on screen.
 */
function backTo(base: string, notice: string, form?: string) {
  // The anchor rides on the path so `noticeUrl` keeps the query ahead of it;
  // `form` drops out of the query entirely when there is none.
  return noticeUrl(`${base}${form ? (FORM_ANCHORS[form] ?? "") : ""}`, notice, { form });
}

/**
 * Add a note to the diver record. The successful path revalidates in place so
 * the new line appears beside the field that was just used; the refusal path
 * lands on the Notes anchor with the same section-scoped status treatment as
 * the other long-form record editors.
 */
export async function addDiverNoteAction(shopSlug: string, personId: string, formData: FormData) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-notes",
    "notes",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  const note = await addDiverNote(db, {
    shopId: staff.user.shopId,
    personId,
    actorPersonId: staff.user.personId,
    body: String(formData.get("note") ?? ""),
  });
  if (!note) {
    revalidateAndRedirect(base, backTo(base, "invalid", "notes"));
    return;
  }
  revalidatePath(base);
}

/** Delete a person-scoped note and carry its text to a one-tap undo toast. */
export async function deleteDiverNoteAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-notes",
    "notes",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  const result = await deleteDiverNote(db, {
    shopId: staff.user.shopId,
    personId,
    actorPersonId: staff.user.personId,
    noteId: String(formData.get("noteId") ?? ""),
  });
  revalidateAndRedirect(
    base,
    result.deleted
      ? noticeUrl(`${base}#notes`, "note-deleted", { noteBody: result.body })
      : backTo(base, "invalid", "notes"),
  );
}

/** Restore a deleted diver note through the same audited insert path. */
export async function restoreDiverNoteAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-notes",
    "notes",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  const restored = await addDiverNote(db, {
    shopId: staff.user.shopId,
    personId,
    actorPersonId: staff.user.personId,
    body: String(formData.get("body") ?? ""),
  });
  revalidateAndRedirect(base, backTo(base, restored ? "note-added" : "invalid", "notes"));
}

/**
 * The card a submit names, narrowed to something a `uuid` column can actually
 * be compared against — or `undefined`, which every caller below already
 * handles as "no card named" and answers with its own refusal.
 *
 * Five actions took this straight off the form and put it in
 * `eq(certifications.id, …)`. **Postgres does not coerce a malformed uuid
 * literal — it raises**, so a signed-in staffer editing the posted value turned
 * a delete, a restore or a review into a **500** where that action's own
 * "invalid" belongs one line later. Tenant isolation was never the exposure
 * (every one of those queries is narrowed by `shopId` either way); a staff
 * surface answering a typo with a stack trace instead of a sentence is.
 *
 * It is the same rule and the same helper `pnpm check:repo` already enforces on
 * dynamic route segments (`scripts/check-uuid-segments.mjs`); that script can
 * only see paths, and an id posted in a hidden field reaches the identical
 * query.
 */
function cardIdFromForm(formData: FormData): string | undefined {
  return uuidParam(String(formData.get("certificationId") ?? ""));
}

/**
 * Whether this submit carried a card sighting whose **number** is the thing
 * that was wrong.
 *
 * The distinction is the whole point. A failed `sightingSchema` parse collapses
 * to `undefined`, which is exactly what a submit carrying *no* sighting
 * returns — so a staffer who typed "xx" got `card_sighting_required`: *"Enter
 * the agency and number from the card in front of you to certify it."* They
 * had. At a busy dock that person retypes it once, gets the same sentence, and
 * then goes **around** the form: delete the claim, capture the same "xx" by
 * hand, tap Mark certified. That reaches the identical `verified` state while
 * throwing away `self_declared_at` — the stamp the incident export, the
 * "diver's word" mark and every provenance read depend on. A refusal that will
 * not say what is wrong is how a safety-critical form teaches people to route
 * around it.
 *
 * Checked on the number alone rather than the whole shape, because it is the
 * only field a staffer types free-hand; a malformed agency or level can only
 * come from a hand-built post and keeps the generic refusal.
 */
function sightedNumberRefused(formData: FormData): boolean {
  return (
    formData.has("sightedIdentifier") &&
    !cardNumberSchema.safeParse(formData.get("sightedIdentifier")).success
  );
}

/**
 * **Is this token still somebody's job?** — the liveness gate every card action
 * on this page passes before it writes.
 *
 * Deliberately **not** a role predicate. `isStaff` asks "are you staff at this
 * shop at all", which every crew role answers yes to, so capturing, reviewing,
 * deleting and restoring a card stay exactly as open as they have always been
 * and H-48 — the open product-owner question about *which* roles may sight a
 * card — is untouched. What it adds is the one thing a JWT cannot tell you: an
 * account since demoted, removed or disabled still holds a valid token until it
 * expires, and `requireStaffSession` will hand it back.
 *
 * It matters most on the strongest acts, which is where it was missing longest.
 * `reviewCertification` and `reviewNitroxCertification` are the single moment a
 * stranger's typing becomes `verified` — the state readiness,
 * `decideTripAdmission`, every course prerequisite, the depth advisory and the
 * nitrox fill gate all read — and `createCertification` mints that state
 * outright. A revoked account could do both (`security-reviewer`, 2026-08-15).
 * One helper rather than a copy per action, so the next card action added here
 * cannot quietly ship without it.
 */
async function isLiveStaff(db: AppDb, shopId: string, personId: string): Promise<boolean> {
  const roles = await loadActiveStaffRoles(db, shopId, personId);
  return Boolean(roles && isStaff(roles));
}

async function liveStaffName(db: AppDb, shopId: string, personId: string) {
  const [staff] = await db
    .select({ fullName: people.fullName })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.shopId, shopId)))
    .limit(1);
  return staff?.fullName ?? "staff";
}

/**
 * Shared preamble for every mutation bound to this record's route segment.
 *
 * The subject id is not a form field, but it is still caller-controlled when
 * a server action is replayed by hand. Narrow it before any uuid query, then
 * re-read the staffer's live role before the action's more specific gate. A
 * malformed required subject is a 404, not a notice on a page that cannot
 * render it.
 */
async function requireDiverActionContext(
  shopSlug: string,
  rawPersonId: string,
  unauthorizedNotice: string,
  form?: string,
) {
  const personId = uuidParam(rawPersonId);
  if (!personId) notFound();

  const staff = await requireStaffSession();
  const db = await getDb();
  const base = shopPath(shopSlug, "divers", personId);
  if (!(await isLiveStaff(db, staff.user.shopId, staff.user.personId))) {
    revalidateAndRedirect(base, backTo(base, unauthorizedNotice, form));
  }
  return { base, db, personId, staff };
}

export async function savePersonAction(shopSlug: string, personId: string, formData: FormData) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-details",
    "details",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  const parsed = personSchema.safeParse(Object.fromEntries(formData));
  // `&form=` is how a code half a dozen actions emit finds its way back to the
  // form that emitted it, instead of into a banner at the top of a 6,400px page
  // (`resolveDiverNotice`).
  if (!parsed.success) redirect(backTo(base, "invalid", "details"));
  const saved = await updateDiver(db, {
    shopId: staff.user.shopId,
    personId,
    ...parsed.data,
  });
  // Two very different things come back as null, and only one of them is an
  // email conflict. `updateDiver` will not touch a removed record at all, and
  // this record is reachable now — so telling a staffer to go fix a duplicate
  // email would send them after a conflict that does not exist. The extra read
  // is paid only on the failure path.
  const notice = saved
    ? "person-saved"
    : (await isDiverRemoved(db, staff.user.shopId, personId))
      ? "removed-read-only"
      : "duplicate";
  revalidateAndRedirect(base, backTo(base, notice, "details"));
}

export async function addCertificationAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const parsed = certificationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(backTo(base, "invalid", "cards"));
  // No card photo, anywhere in the model: a shop verifies a card by looking its
  // number up with the issuing agency, which is what "Mark certified" attests
  // to. The upload only ever added a second, unverified artefact to hold
  // (ADR 20260804-card-evidence-is-the-number), and the column that held it is
  // gone too (ADR 20260811-retire-the-digital-card).
  const saved = await createCertification(db, {
    shopId: staff.user.shopId,
    personId,
    agency: parsed.data.agency,
    level: parsed.data.level,
    identifier: parsed.data.identifier,
  });
  const notice = saved ? "captured" : "invalid";
  revalidateAndRedirect(base, backTo(base, notice, "cards"));
}

export async function addSpecialtyAction(shopSlug: string, personId: string, formData: FormData) {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const parsed = specialtyCertificationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(backTo(base, "invalid", "specialty-cards"));
  const saved =
    parsed.data.specialty === "nitrox"
      ? await createNitroxCertification(db, {
          shopId: staff.user.shopId,
          personId,
          agency: parsed.data.agency,
          identifier: parsed.data.identifier,
        })
      : await createSpecialtyCertification(db, {
          shopId: staff.user.shopId,
          personId,
          agency: parsed.data.agency,
          specialty: parsed.data.specialty,
          identifier: parsed.data.identifier,
        });
  const notice = saved ? "captured" : "invalid";
  revalidateAndRedirect(base, backTo(base, notice, "specialty-cards"));
}

/**
 * The only review outcome is "certified" — a bad card is deleted, not marked
 * for correction.
 *
 * One tap for every card a staffer captured themselves. A **self-declared**
 * card (a diver named their own level on a public opt-in) is the exception: it
 * carries no number, and this form asks for the agency, the number **and the
 * level** off the card in the staffer's hand before it will certify anything.
 * That is the same act as capturing a card, and `reviewCertification` refuses
 * without it — as does the database, whose check constraint will not let a row
 * with a blank or absent number reach `verified`. (It read `identifier is not
 * null` until 2026-08-15, which `''` satisfies, so this sentence was true of
 * NULL and enforced by the application alone for the empty string.)
 *
 * The level is there because the likeliest wrong claim is an overstated one:
 * transcribing the number off a real Open Water card while keeping the diver's
 * typed "Instructor" would verify the one field nobody looked at.
 */
export async function reviewAction(shopSlug: string, personId: string, formData: FormData) {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  // Before anything is read: a number that is not a number gets its own answer,
  // on its own box. Without this the refusal below is the one that fires, and
  // it tells the staffer to do what they just did (`sightedNumberRefused`).
  if (sightedNumberRefused(formData)) redirect(backTo(base, "card-number-implausible", "cards"));
  const certificationId = cardIdFromForm(formData);
  // Present only on the sighting form; absent on the one-tap button, where a
  // blank parse must not turn into an empty-string "sighting".
  const sighting = levelSightingFromForm(formData);
  const outcome = certificationId
    ? await reviewCertification(db, {
        shopId: staff.user.shopId,
        certificationId,
        status: "verified",
        sighting,
        reviewedByPersonId: staff.user.personId,
      })
    : ({ ok: false, reason: "not_found" } as const);
  revalidateAndRedirect(base, backTo(base, reviewNotice(outcome), "cards"));
}

/**
 * The card the staffer says they are looking at, or undefined when this submit
 * carried none. Undefined and "they typed nothing" are the same outcome —
 * `reviewCertification` refuses either way on a row that needs a sighting — but
 * they are kept distinct here so a malformed agency is a refusal rather than a
 * silent fall-through to the shop's first enum member.
 */
function sightingFromForm(formData: FormData): CardSighting | undefined {
  if (!formData.has("sightedIdentifier")) return undefined;
  const parsed = sightingSchema.safeParse({
    agency: formData.get("sightedAgency"),
    identifier: formData.get("sightedIdentifier"),
  });
  return parsed.success ? parsed.data : undefined;
}

/**
 * {@link sightingFromForm} plus the rung the staffer read off the card.
 *
 * A submit missing or malforming the level is `undefined` — the same outcome as
 * a missing number, so `reviewCertification` refuses with
 * `card_sighting_required` rather than certifying a level nobody stated. That
 * is the point of parsing it here: the alternative, falling back to the level
 * already on the row, is precisely the diver's own claim being promoted.
 */
function levelSightingFromForm(formData: FormData): LevelCardSighting | undefined {
  if (!formData.has("sightedIdentifier")) return undefined;
  const parsed = levelSightingSchema.safeParse({
    agency: formData.get("sightedAgency"),
    identifier: formData.get("sightedIdentifier"),
    level: formData.get("sightedLevel"),
  });
  return parsed.success ? parsed.data : undefined;
}

function reviewNotice(
  outcome: { ok: true } | { ok: false; reason: CertificationReviewRefusal },
): string {
  if (outcome.ok) return "verified";
  if (outcome.reason === "card_sighting_required") return "card-sighting-required";
  if (outcome.reason === "duplicate_card") return "duplicate-card";
  return "invalid";
}

export async function reviewSpecialtyAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  // The nitrox twin of the level sighting's own refusal, and it matters at
  // least as much here: this tap authorizes a gas fill.
  if (sightedNumberRefused(formData)) {
    redirect(backTo(base, "card-number-implausible", "specialty-cards"));
  }
  const certificationId = cardIdFromForm(formData);
  // One tap, the same as the level card beside it. The imported-card
  // attestation this used to forward is gone
  // (ADR 20260814-one-tap-imported-card-confirm). A self-declared nitrox card
  // still asks for the card in the staffer's hand — this tap authorizes a gas
  // fill, and nobody has seen anything yet.
  const outcome = certificationId
    ? formData.get("cardType") === "nitrox"
      ? await reviewNitroxCertification(db, {
          shopId: staff.user.shopId,
          certificationId,
          status: "verified",
          sighting: sightingFromForm(formData),
          reviewedByPersonId: staff.user.personId,
        })
      : await reviewSpecialtyCertification(db, {
          shopId: staff.user.shopId,
          certificationId,
          status: "verified",
          // A specialty card the diver typed on their own readiness link asks
          // for the card in the staffer's hand, exactly as the nitrox branch
          // above does — and for a stronger reason: this tap opens a depth gate
          // past 18 m. An imported or staff-captured card is still one tap.
          sighting: sightingFromForm(formData),
          reviewedByPersonId: staff.user.personId,
        })
    : ({ ok: false, reason: "not_found" } as const);
  revalidateAndRedirect(base, backTo(base, reviewNotice(outcome), "specialty-cards"));
}

/**
 * **"This diver never told us that"** — the eraser for a *"Not certified yet —
 * diver's word"* stamp somebody else left on their record.
 *
 * `people.no_certification_declared_at` is written by two **unauthenticated**
 * forms (the shop-wide last-minute-deal join, a full trip's wait-list join),
 * both of which resolve a person by shop + email. For a diver the shop holds no
 * card for — the ordinary case for anyone whose card was never captured —
 * anybody holding a name and an email address off any boat's manifest can mark
 * them, permanently, on the staff send lists and in every CSV the shop exports
 * from then on. Until this action the only thing that cleared it was owner-only
 * erasure, which destroys the whole record.
 *
 * **It cannot be a second way to launder a claim into evidence.** Its only
 * effect is to move this person from a *stated* absence of a card to *no
 * statement at all* — the silence of somebody nobody asked. Evidence lives in
 * the three card tables and `clearNoCertificationDeclaration` touches none of
 * them: nothing here raises a level, adds a card, or moves a row toward
 * `verified`. That direction is also what makes the gate right — a staff
 * session and no role predicate, exactly as capturing a card has always been,
 * since this is a weaker act than a capture. H-48 is the open product-owner
 * question about who may *sight* a card, and this deliberately does not
 * pre-empt it by inventing a narrower rule for a smaller thing.
 *
 * The correction is not itself invisible: it is stamped on the row with the
 * staff member who made it (`people.no_certification_cleared_by_person_id`),
 * which outlives the retention window an `activity_events` line would be pruned
 * on, and travels in the export beside the statement it corrects.
 */
export async function clearNoCertificationAction(
  shopSlug: string,
  personId: string,
  _formData: FormData,
) {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const cleared = await clearNoCertificationDeclaration(db, {
    shopId: staff.user.shopId,
    personId,
    byPersonId: staff.user.personId,
  });
  // Both outcomes are page-level, deliberately, and this is the one place on
  // this record where that is the *right* answer rather than a shortcut: the
  // panel holding this control renders only while the stamp is set, so on
  // success it is gone, and on the no-op it was never there. A notice has to
  // land somewhere that survives the state change it reports.
  //
  // The no-op gets its own code rather than the generic `invalid`. A replayed
  // submit or a double tap **succeeded** — the record already says what the
  // staffer wanted it to say — and answering *"Check the details and try
  // again"* in a danger tone tells them their correction failed when it did
  // not. Reporting it as a fresh success would be the opposite lie, putting
  // their name on an act that did not happen.
  revalidateAndRedirect(
    base,
    backTo(base, cleared ? "no-certification-cleared" : "no-certification-nothing-to-clear"),
  );
}

/**
 * Delete a level card. It is a soft-archive: the card leaves the diver's list
 * and stops counting toward readiness, but the row is kept for safety history
 * (ADR 20260719-crud-archive-semantics). Replaces the old "needs correction" flow.
 */
export async function deleteCertificationAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const certificationId = cardIdFromForm(formData);
  const deleted = certificationId
    ? await deleteCertification(db, {
        shopId: staff.user.shopId,
        certificationId,
        deletedByPersonId: staff.user.personId,
      })
    : false;
  const removedBy = deleted
    ? await liveStaffName(db, staff.user.shopId, staff.user.personId)
    : null;
  // Land-then-undo: the delete happens now, and the toast on the next render
  // carries the id + type so a single tap restores it (no confirm dialog).
  revalidateAndRedirect(
    base,
    deleted
      ? noticeUrl(base, "card-deleted", {
          undo: certificationId,
          cardType: "level",
          by: removedBy ?? undefined,
        })
      : backTo(base, "invalid", "cards"),
  );
}

/** Delete a specialty or nitrox card (soft-archive; dispatched by the hidden `cardType`). */
export async function deleteSpecialtyAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const certificationId = cardIdFromForm(formData);
  const cardType = formData.get("cardType") === "nitrox" ? "nitrox" : "specialty";
  const deleted = certificationId
    ? cardType === "nitrox"
      ? await deleteNitroxCertification(db, {
          shopId: staff.user.shopId,
          certificationId,
          deletedByPersonId: staff.user.personId,
        })
      : await deleteSpecialtyCertification(db, {
          shopId: staff.user.shopId,
          certificationId,
          deletedByPersonId: staff.user.personId,
        })
    : false;
  const removedBy = deleted
    ? await liveStaffName(db, staff.user.shopId, staff.user.personId)
    : null;
  revalidateAndRedirect(
    base,
    deleted
      ? noticeUrl(base, "card-deleted", {
          undo: certificationId,
          cardType,
          by: removedBy ?? undefined,
        })
      : backTo(base, "invalid", "specialty-cards"),
  );
}

const cardTypeSchema = z.enum(["level", "specialty", "nitrox"]);
type CardType = z.infer<typeof cardTypeSchema>;

/**
 * Undo a card archive from the land-then-undo toast. Dispatches by the card
 * type stamped into the toast, restoring the exact card that was archived; a
 * re-entered card that now owns the same number blocks the restore rather than
 * being clobbered (readiness.ts).
 */
export async function restoreCardAction(shopSlug: string, personId: string, formData: FormData) {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const certificationId = cardIdFromForm(formData);
  const cardType = cardTypeSchema.safeParse(formData.get("cardType"));
  if (!certificationId || !cardType.success) redirect(base);
  const input = { shopId: staff.user.shopId, certificationId };
  const restored =
    cardType.data === "level"
      ? await restoreCertification(db, input)
      : cardType.data === "specialty"
        ? await restoreSpecialtyCertification(db, input)
        : await restoreNitroxCertification(db, input);
  // Home is the section that card lives in, so an undo that could not land
  // says so beside the list it failed to return to.
  const form = cardType.data === "level" ? "cards" : "specialty-cards";
  revalidateAndRedirect(
    base,
    backTo(base, restored ? "card-restored" : "card-restore-conflict", form),
  );
}

/**
 * What the one-tap review did, for the control that posted it. A **value**,
 * not a redirect: see {@link markCertifiedAction}.
 */
export type MarkCertifiedResult =
  | null
  | {
      ok: true;
      /**
       * `certified` promoted a pending card; `confirmed` cleared an imported
       * card's gate; `undone` is the toast's own Undo landing.
       */
      effect: "certified" | "confirmed" | "undone";
      /**
       * The card to hand back to Undo — absent when this review cannot be
       * taken back (see `unreviewedCardState`), so a toast is never offered
       * with an Undo the server would refuse.
       */
      undo?: { certificationId: string; cardType: CardType };
    }
  | { ok: false; reason: "invalid" | "sighting-required" | "duplicate-card" | "not-undoable" };

/**
 * **Mark certified, in place — and take it back.**
 *
 * Every other write on this record redirects, which is right for a form whose
 * outcome is a sentence beside it. This one is a **row-level tap in a list**,
 * and a redirect made it the most expensive act on the page: the route's own
 * `loading.tsx` painted over a ~6,400px record, the `#cards` anchor threw the
 * viewport somewhere the staffer had not asked to be, and a desk working down
 * a stack of cards paid that for every single one. So it revalidates and
 * returns; the row settles where it is (`ReviewRowActions` on the reviews queue
 * is the same shape, for the same reason).
 *
 * Returning also buys the thing the banner could not: an **Undo**. "Certification
 * marked verified. It counts toward readiness." was a sentence explaining a
 * status word the row already wears — and it left a mis-tap on the wrong row
 * with no way back but deleting the card. The toast says less and offers more.
 *
 * `intent=undo` routes to the un-review writers, which refuse a card whose
 * review was a *sighting*: that rewrites the row from the card in the staffer's
 * hand and there is nothing to put back. Those cards never reach this action —
 * they wear `CardSightingForm` instead — and the server refuses regardless,
 * because a posted form is caller-controlled.
 */
export async function markCertifiedAction(
  shopSlug: string,
  personId: string,
  _previous: MarkCertifiedResult,
  formData: FormData,
): Promise<MarkCertifiedResult> {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-cards");
  personId = context.personId;
  const { base, db, staff } = context;
  const certificationId = cardIdFromForm(formData);
  const cardType = cardTypeSchema.safeParse(formData.get("cardType"));
  if (!certificationId || !cardType.success) return { ok: false, reason: "invalid" };
  const input = { shopId: staff.user.shopId, certificationId };

  if (formData.get("intent") === "undo") {
    const undone =
      cardType.data === "level"
        ? await unreviewCertification(db, input)
        : cardType.data === "specialty"
          ? await unreviewSpecialtyCertification(db, input)
          : await unreviewNitroxCertification(db, input);
    revalidatePath(base);
    return undone.ok ? { ok: true, effect: "undone" } : { ok: false, reason: "not-undoable" };
  }

  // No `sighting` on any branch: this action is the one-tap path only. A row
  // that needs a card in the staffer's hand is refused below with the same
  // `card_sighting_required` its own form would have raised.
  const reviewed = {
    ...input,
    status: "verified",
    reviewedByPersonId: staff.user.personId,
  } as const;
  const outcome =
    cardType.data === "level"
      ? await reviewCertification(db, reviewed)
      : cardType.data === "specialty"
        ? await reviewSpecialtyCertification(db, reviewed)
        : await reviewNitroxCertification(db, reviewed);
  revalidatePath(base);
  if (!outcome.ok) {
    return {
      ok: false,
      reason:
        outcome.reason === "card_sighting_required"
          ? "sighting-required"
          : outcome.reason === "duplicate_card"
            ? "duplicate-card"
            : "invalid",
    };
  }
  const card = outcome.certification;
  return {
    ok: true,
    // An imported card was already `verified` on arrival; this tap confirmed
    // it rather than certifying it, and the two must not claim the same thing.
    effect: card.importedAt ? "confirmed" : "certified",
    undo:
      card.selfDeclaredAt || card.issuedByShopAt
        ? undefined
        : { certificationId, cardType: cardType.data },
  };
}

export async function saveProfileAction(shopSlug: string, personId: string, formData: FormData) {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-fit", "fit");
  personId = context.personId;
  const { base, db, staff } = context;
  // The gate is on *overriding* a stated request, not on writing the record
  // (H-06, ADR 20260724-gear-fit-fallback). A diver with nothing on file has
  // stated nothing to override, so recording their sizes for the first time is
  // ordinary data entry — the Saturday walk-up whose only staff on the floor
  // are the captain and a deckhand must not end up on a napkin. Changing a fit
  // that already exists is the in-water judgement call, and stays gated.
  const existing = await getRentalFit(db, staff.user.shopId, personId);
  if (
    existing &&
    !(await canPersonOverrideGearRequest(db, staff.user.shopId, staff.user.personId))
  ) {
    revalidateAndRedirect(base, backTo(base, "not-authorized-fit", "fit"));
    return;
  }
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(backTo(base, "invalid", "fit"));
  const saved = await saveRentalFit(db, {
    shopId: staff.user.shopId,
    personId,
    rentsBcd: parsed.data.bcd === "on",
    rentsRegulator: parsed.data.regulator === "on",
    rentsWetsuit: parsed.data.wetsuit === "on",
    rentsMaskFins: parsed.data.maskFins === "on",
    rentsWeights: parsed.data.weights === "on",
    rentsDiveComputer: parsed.data.diveComputer === "on",
    rentsGopro: parsed.data.gopro === "on",
    bcdSize: parsed.data.bcdSize,
    wetsuitSize: parsed.data.wetsuitSize,
    // One shoe-size answer, written to both columns — see RentalFit.tsx.
    bootSize: parsed.data.finSize,
    finSize: parsed.data.finSize,
    weightPreference: parsed.data.weightPreference,
  });
  revalidateAndRedirect(base, backTo(base, saved ? "profile-saved" : "invalid", "fit"));
}

/**
 * Flag (or clear) a diver for hands-on fitting at check-in — the H-06 fallback
 * for a size the shop can't fill.
 *
 * The two directions carry different authority, so they gate differently even
 * though one action serves both. **Raising** is open to every staff member: it
 * is the boat's own work, and it escalates to a human rather than overwriting
 * the diver's stated request. **Clearing** asserts "we can pack their stated
 * size after all" — the judgement call — so it takes the override gate. The
 * clear direction is the *absence* of a form field, which is exactly why this
 * has to be checked here and not left to the button the page renders.
 */
export async function setNeedsStaffFitAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const context = await requireDiverActionContext(shopSlug, personId, "not-authorized-fit", "fit");
  personId = context.personId;
  const { base, db, staff } = context;
  const roles = await loadActiveStaffRoles(db, staff.user.shopId, staff.user.personId);
  if (!roles || !isStaff(roles)) {
    revalidateAndRedirect(base, backTo(base, "not-authorized-fit", "fit"));
    return;
  }
  const parsed = needsStaffFitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(backTo(base, "invalid", "fit"));
  const needed = parsed.data.needed === "on";
  // Hiding the button is the page layer; this is the server layer ADR-0006
  // asks for. Without it a captain clears a flag by submitting the form with
  // no `needed` field, and the diver goes back on the list at a size the shop
  // already said it was short of — with the attribution wiped in the same
  // statement, so nothing records that it happened.
  if (!needed && !canOverrideGearRequest(roles)) {
    revalidateAndRedirect(base, backTo(base, "not-authorized-fit", "fit"));
    return;
  }
  const saved = await setNeedsStaffFit(db, {
    shopId: staff.user.shopId,
    personId,
    needed,
    note: parsed.data.needsStaffFitNote,
    byPersonId: staff.user.personId,
  });
  const notice = !saved ? "invalid" : needed ? "fit-flagged" : "fit-cleared";
  revalidateAndRedirect(base, backTo(base, notice, "fit"));
}

/**
 * "This diver signed on paper", recorded from their own record.
 *
 * The third door onto one write path (`recordInPersonWaiver`) — the roster and
 * the check-in queue already have one — and the one a shop reaches when the
 * conversation is about the *person* rather than a departure: a diver phones
 * ahead, or hands the release over at the counter long before they book
 * anything.
 *
 * No booking, by design. A signature is a fact about a person and a shop, so
 * the record is filed against the diver in the URL and nothing else — the
 * subject is this route's own path segment, never a form field
 * (ADR 20260811-person-scoped-paper-waivers).
 */
export async function markWaiverInPersonAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-waiver",
    "waiver",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  const outcome = await recordInPersonWaiver(db, {
    shopId: staff.user.shopId,
    subject: { personId },
    recordedByPersonId: staff.user.personId,
    medicalAttested: formData.get("medicalAttested") === "on",
  });
  revalidateAndRedirect(
    base,
    backTo(
      base,
      outcome.ok
        ? "waiver-paper-recorded"
        : outcome.reason === "medical_attestation_required"
          ? "waiver-medical-attestation"
          : "waiver-error",
      "waiver",
    ),
  );
}

export async function refundPaymentAction(shopSlug: string, personId: string, formData: FormData) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-refund",
    "payments",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  const orderId = uuidParam(String(formData.get("orderId") ?? ""));
  // Money leaving the account is owner/manager work (H-14, ADR
  // 20260724-role-authorization), re-checked against live roles.
  if (!(await canPersonRefund(db, staff.user.shopId, staff.user.personId))) {
    revalidateAndRedirect(base, backTo(base, "not-authorized-refund", "payments"));
    return;
  }
  if (!(await hasRequiredStepUp(db, staff, "money"))) {
    redirect(stepUpChallengeUrl(staff.user.shopSlug, "money", base));
  }
  // A demo shop's orders carry fabricated Stripe ids; refunding one would hit
  // live Stripe and fail. The button is rendered disabled to match (PaymentsSection).
  const shop = await getShopById(db, staff.user.shopId);
  if (shop?.isDemo) {
    revalidateAndRedirect(base, backTo(base, "demo-disabled", "payments"));
    return;
  }
  // `refundOrder` returns a code, never a sentence; the words are picked here
  // (docs ADR 20260731-domain-layer-copy-leaks). `in_progress` — a second tap
  // arriving while the first refund is still at Stripe — is its own notice, not
  // a failure: telling staff it failed invites the third tap (PAY-L3).
  const outcome = orderId
    ? await refundOrder(db, staff.user.shopId, orderId)
    : ({ status: "not_found" } as const);
  if (orderId) {
    await trackEvent({
      name: "refund_issued",
      auto: false,
      status: outcome.status === "refunded" ? "refunded" : "failed",
    });
  }
  const notice =
    outcome.status === "refunded"
      ? "refunded"
      : outcome.status === "in_progress"
        ? "refund-in-progress"
        : outcome.status === "needs_reconciliation"
          ? "refund-needs-reconciliation"
          : "refund-failed";
  revalidateAndRedirect(base, backTo(base, notice, "payments"));
}

/**
 * Merge the route's diver with one of its explicitly surfaced candidates.
 * The posted survivor id is untrusted and the domain transaction checks the
 * shop, active state, diver role, booking collision, and live owner/manager
 * authorization again before moving anything.
 */
export async function mergeDiverAction(shopSlug: string, personId: string, formData: FormData) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-merge",
    "merge",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  if (!(await canPersonMergeDiver(db, staff.user.shopId, staff.user.personId))) {
    revalidateAndRedirect(base, backTo(base, "not-authorized-merge"));
    return;
  }
  const survivorId = uuidParam(String(formData.get("survivorId") ?? ""));
  if (!survivorId) {
    revalidateAndRedirect(base, backTo(base, "merge-invalid", "merge"));
    return;
  }

  const result = await mergeDiverRecords({
    db,
    shopId: staff.user.shopId,
    personId,
    survivorId,
    actorPersonId: staff.user.personId,
  });
  if (!result.ok) {
    const notice =
      result.reason === "not_authorized"
        ? "not-authorized-merge"
        : result.reason === "not_found"
          ? "merge-invalid"
          : `merge-${result.reason}`;
    revalidateAndRedirect(
      base,
      backTo(base, notice, notice === "not-authorized-merge" ? undefined : "merge"),
    );
    return;
  }

  const survivorBase = shopPath(staff.user.shopSlug, "divers", result.survivorId);
  revalidateAndRedirect(survivorBase, noticeUrl(survivorBase, "merged"));
}

export async function deletePersonAction(shopSlug: string, personId: string, _formData: FormData) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-delete",
    "remove",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  // Soft-deleting a person frees their email and pulls them from shop work —
  // owner/manager only (H-14, ADR 20260724-role-authorization).
  if (!(await canPersonDeleteDiver(db, staff.user.shopId, staff.user.personId))) {
    revalidateAndRedirect(base, backTo(base, "not-authorized-delete", "remove"));
    return;
  }
  const deleted = await deleteDiver(db, staff.user.shopId, personId);
  const roster = shopPath(staff.user.shopSlug, "divers");
  revalidateAndRedirect(
    roster,
    // No hand-rolled `encodeURIComponent` any more — `noticeUrl` escapes every
    // value it merges.
    deleted ? noticeUrl(roster, "deleted", { deleted: personId }) : base,
  );
}

/**
 * Put a removed diver back on the active roster, from their own record.
 *
 * The roster has its own copy of this bound to the undo toast; this is the one
 * that still works tomorrow, once the toast is long gone and the only way back
 * is the `?filter=removed` view and the record it links to. Same owner/manager
 * gate as the removal it reverses (H-14, ADR 20260724-role-authorization),
 * re-read from the database like every other mutation on this page.
 *
 * `restoreDiver` refuses rather than clobbers when an active diver has since
 * claimed this one's email (CR-008), and refuses an erased record outright —
 * both land here as `restore-refused`, which says what to do about it.
 */
export async function restorePersonAction(shopSlug: string, personId: string, _formData: FormData) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-delete",
    "restore",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  if (!(await canPersonDeleteDiver(db, staff.user.shopId, staff.user.personId))) {
    revalidateAndRedirect(base, backTo(base, "not-authorized-delete", "restore"));
    return;
  }
  const restored = await restoreDiver(db, staff.user.shopId, personId);
  // The two outcomes cannot land in the same place. A refusal leaves the diver
  // removed, so the restore card — and its `#removed-heading` anchor — are both
  // still there to receive it. Success removes both: naming the form would put
  // the confirmation in a card that no longer renders, and the anchor would
  // scroll to a heading that no longer exists. Success goes to the page notice.
  if (restored) {
    revalidateAndRedirect(base, backTo(base, "restored"));
    return;
  }
  revalidateAndRedirect(base, backTo(base, "restore-refused", "restore"));
}

/**
 * Erase a diver's personal and medical data (ADR 20260802-diver-data-erasure).
 *
 * Unlike removal, this cannot be undone and there is no notice offering to undo
 * it. Four things stand between a mis-click and an irreversible write: the gate
 * is owner-only and re-read from the database, `anonymizeDiver` re-checks it
 * again for itself, the diver must already be **deleted**, and the staffer must
 * type the diver's name to confirm — the confirmation is verified here against
 * the stored record, not trusted from a hidden field the form could have
 * carried unchanged.
 */
export async function erasePersonAction(shopSlug: string, personId: string, formData: FormData) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-erase",
    "erase",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  if (!(await canPersonErasePersonalData(db, staff.user.shopId, staff.user.personId))) {
    revalidateAndRedirect(base, backTo(base, "not-authorized-erase", "erase"));
    return;
  }
  // `includeRemoved`: a diver already off the active roster is exactly who an
  // erasure request tends to name, and without this the name check reads null
  // and reports a mismatch against a record that is right there on screen.
  const profile = await getDiverProfile(db, staff.user.shopId, personId, { includeRemoved: true });
  // **An erasure runs on a deleted record only**, which is the same rule the
  // page renders by. Deleting first is reversible, it is the state an erasure
  // request describes anyway, and it makes the one-way write a second decision
  // rather than a scroll to the bottom of a record somebody opened for another
  // reason. Enforced here and not only in the page, because a tab left open on
  // a record that was deleted and then restored would otherwise post an erase
  // at a diver who is back on the roster.
  //
  // The refusal carries no `?form=`: on a live record the erase section is not
  // rendered at all, so an outcome filed under `erase` would land in a section
  // that does not exist. It reads in the page banner, above the Delete control
  // it is asking the staffer to use.
  //
  // A record that reads back as nothing at all falls through to the name check
  // below, which is the honest answer for it: there is no name to match.
  if (profile && !profile.person.deletedAt) {
    revalidateAndRedirect(base, backTo(base, "erase-requires-delete"));
    return;
  }
  const typed = String(formData.get("confirmName") ?? "").trim();
  if (!profile || typed.toLowerCase() !== profile.person.fullName.trim().toLowerCase()) {
    revalidateAndRedirect(base, backTo(base, "erase-name-mismatch", "erase"));
    return;
  }
  const result = await anonymizeDiver(db, {
    shopId: staff.user.shopId,
    personId,
    actorPersonId: staff.user.personId,
  });
  // "Erased" and "erased, but Stripe still owes something" are different facts,
  // and a compliance action must not report the weaker one as the stronger
  // (ADR 20260803-processor-erasure-obligations). The outstanding work is on the
  // reports page; this notice is what sends someone to look.
  const erasedNotice =
    result.ok && result.owedProcessorErasures > 0 ? "erased-processor-owed" : "erased";
  const roster = shopPath(staff.user.shopSlug, "divers");
  revalidateAndRedirect(
    roster,
    result.ok ? noticeUrl(roster, erasedNotice) : backTo(base, "erase-refused", "erase"),
  );
}
