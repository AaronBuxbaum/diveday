"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { anonymizeDiver } from "@/db/anonymize";
import {
  canPersonDeleteDiver,
  canPersonErasePersonalData,
  canPersonOverrideGearRequest,
  canPersonRefund,
  loadActiveStaffRoles,
} from "@/db/authz";
import { getDb } from "@/db/client";
import {
  deleteDiver,
  getDiverProfile,
  isDiverRemoved,
  restoreDiver,
  updateDiver,
} from "@/db/divers";
import {
  archiveNitroxCertification,
  createNitroxCertification,
  restoreNitroxCertification,
  reviewNitroxCertification,
} from "@/db/nitrox";
import { refundOrder } from "@/db/orders";
import {
  archiveCertification,
  archiveSpecialtyCertification,
  createCertification,
  createSpecialtyCertification,
  restoreCertification,
  restoreSpecialtyCertification,
  reviewCertification,
  reviewSpecialtyCertification,
} from "@/db/readiness";
import { getRentalFit, saveRentalFit, setNeedsStaffFit } from "@/db/rental-fit";
import { certificationAgency } from "@/db/schema";
import { getShopById } from "@/db/shops";
import { isPlausibleDateOfBirth } from "@/lib/age";
import { trackEvent } from "@/lib/analytics";
import { canOverrideGearRequest, isStaff } from "@/lib/authz";
import { isValidCalendarDate } from "@/lib/calendar-date";
import { revalidateAndRedirect } from "@/lib/navigation";
import { blankableDiverEmailSchema, diverNameSchema, diverPhoneSchema } from "@/lib/person-fields";
import { requireStaffSession } from "@/lib/session";

// The pg enum itself, not a copy of it: a card the column accepts is a card the
// form must accept, and a hand-kept list is what let CMAS/RAID/GUE be refused
// here while the database was ready for them (DOM-L1).
const agencySchema = z.enum(certificationAgency.enumValues);
const levelSchema = z.enum([
  "open_water",
  "advanced_open_water",
  "rescue",
  "divemaster",
  "instructor",
]);
const specialtySchema = z.enum(["deep", "wreck", "night", "drysuit", "nitrox"]);
// Regex shape alone would accept a normalized impossible date like
// "2026-02-31" (CR-009); isValidCalendarDate rejects those explicitly.
const dateSchema = z.union([
  z.literal(""),
  z.string().refine(isValidCalendarDate, "not a real calendar date"),
]);

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
const certificationSchema = z.object({
  agency: agencySchema,
  level: levelSchema,
  identifier: z.string().trim().min(2).max(120),
  expiresOn: dateSchema,
});
const specialtyCertificationSchema = z.object({
  agency: agencySchema,
  specialty: specialtySchema,
  identifier: z.string().trim().min(2).max(120),
  expiresOn: dateSchema,
});
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

/** The column is date-only (CR-009); the validated "YYYY-MM-DD" input needs no conversion. */
function dateFromInput(value: string) {
  return value || undefined;
}

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
  "book-activity": "#trips",
  remove: "#remove-heading",
  restore: "#removed-heading",
  erase: "#erase-heading",
  // `details` sits under the header, which is where a redirect lands anyway.
};

/**
 * The record's URL carrying one form's outcome: the code, the form it belongs
 * to (`resolveDiverNotice`), and the anchor that puts that form on screen.
 */
function backTo(base: string, notice: string, form?: string) {
  const query = form ? `?notice=${notice}&form=${form}` : `?notice=${notice}`;
  return `${base}${query}${form ? (FORM_ANCHORS[form] ?? "") : ""}`;
}

export async function savePersonAction(shopSlug: string, personId: string, formData: FormData) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const parsed = personSchema.safeParse(Object.fromEntries(formData));
  // `&form=` is how a code half a dozen actions emit finds its way back to the
  // form that emitted it, instead of into a banner at the top of a 6,400px page
  // (`resolveDiverNotice`).
  if (!parsed.success) redirect(backTo(base, "invalid", "details"));
  const db = await getDb();
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
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const parsed = certificationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(backTo(base, "invalid", "cards"));
  // No card photo: a shop verifies a card by looking its number up with the
  // issuing agency, which is what "Mark certified" already attests to — the
  // upload only ever added a second, unverified artefact to hold. Rows that
  // still carry a `card_image_url` from before this keep displaying it.
  const saved = await createCertification(await getDb(), {
    shopId: staff.user.shopId,
    personId,
    agency: parsed.data.agency,
    level: parsed.data.level,
    identifier: parsed.data.identifier,
    expiresAt: dateFromInput(parsed.data.expiresOn),
  });
  const notice = saved ? "captured" : "invalid";
  revalidateAndRedirect(base, backTo(base, notice, "cards"));
}

export async function addSpecialtyAction(shopSlug: string, personId: string, formData: FormData) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const parsed = specialtyCertificationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(backTo(base, "invalid", "specialty-cards"));
  const saved =
    parsed.data.specialty === "nitrox"
      ? await createNitroxCertification(await getDb(), {
          shopId: staff.user.shopId,
          personId,
          agency: parsed.data.agency,
          identifier: parsed.data.identifier,
        })
      : await createSpecialtyCertification(await getDb(), {
          shopId: staff.user.shopId,
          personId,
          agency: parsed.data.agency,
          specialty: parsed.data.specialty,
          identifier: parsed.data.identifier,
          expiresAt: dateFromInput(parsed.data.expiresOn),
        });
  const notice = saved ? "captured" : "invalid";
  revalidateAndRedirect(base, backTo(base, notice, "specialty-cards"));
}

/** The only review outcome is "certified" — a bad card is deleted, not marked for correction. */
export async function reviewAction(shopSlug: string, personId: string, formData: FormData) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const certificationId = String(formData.get("certificationId") ?? "");
  const updated = certificationId
    ? await reviewCertification(await getDb(), {
        shopId: staff.user.shopId,
        certificationId,
        status: "verified",
      })
    : null;
  revalidateAndRedirect(base, backTo(base, updated ? "verified" : "invalid", "cards"));
}

export async function reviewSpecialtyAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const certificationId = String(formData.get("certificationId") ?? "");
  // An imported card's confirm carries an explicit attestation, because that tap
  // is what opens the specialty gate (or the enriched-air fill) on evidence
  // DiveDay never checked itself (H-24). The domain layer refuses without it —
  // this only forwards what the staffer ticked.
  const cardSighted = formData.get("cardSighted") === "on";
  const outcome = certificationId
    ? formData.get("cardType") === "nitrox"
      ? await reviewNitroxCertification(await getDb(), {
          shopId: staff.user.shopId,
          certificationId,
          status: "verified",
          cardSighted,
        })
      : await reviewSpecialtyCertification(await getDb(), {
          shopId: staff.user.shopId,
          certificationId,
          status: "verified",
          cardSighted,
        })
    : null;
  const notice = outcome?.ok
    ? "verified"
    : outcome?.reason === "card_sighting_required"
      ? "card-sighting-required"
      : "invalid";
  revalidateAndRedirect(base, backTo(base, notice, "specialty-cards"));
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
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const certificationId = String(formData.get("certificationId") ?? "");
  const deleted = certificationId
    ? await archiveCertification(await getDb(), { shopId: staff.user.shopId, certificationId })
    : false;
  // Land-then-undo: the delete happens now, and the toast on the next render
  // carries the id + type so a single tap restores it (no confirm dialog).
  revalidateAndRedirect(
    base,
    deleted
      ? `${base}?notice=card-deleted&undo=${certificationId}&cardType=level`
      : backTo(base, "invalid", "cards"),
  );
}

/** Delete a specialty or nitrox card (soft-archive; dispatched by the hidden `cardType`). */
export async function deleteSpecialtyAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const certificationId = String(formData.get("certificationId") ?? "");
  const db = await getDb();
  const cardType = formData.get("cardType") === "nitrox" ? "nitrox" : "specialty";
  const deleted = certificationId
    ? cardType === "nitrox"
      ? await archiveNitroxCertification(db, { shopId: staff.user.shopId, certificationId })
      : await archiveSpecialtyCertification(db, { shopId: staff.user.shopId, certificationId })
    : false;
  revalidateAndRedirect(
    base,
    deleted
      ? `${base}?notice=card-deleted&undo=${certificationId}&cardType=${cardType}`
      : backTo(base, "invalid", "specialty-cards"),
  );
}

const cardTypeSchema = z.enum(["level", "specialty", "nitrox"]);

/**
 * Undo a card archive from the land-then-undo toast. Dispatches by the card
 * type stamped into the toast, restoring the exact card that was archived; a
 * re-entered card that now owns the same number blocks the restore rather than
 * being clobbered (readiness.ts).
 */
export async function restoreCardAction(shopSlug: string, personId: string, formData: FormData) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const certificationId = String(formData.get("certificationId") ?? "");
  const cardType = cardTypeSchema.safeParse(formData.get("cardType"));
  if (!certificationId || !cardType.success) redirect(base);
  const db = await getDb();
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

export async function saveProfileAction(shopSlug: string, personId: string, formData: FormData) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const db = await getDb();
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
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const db = await getDb();
  // Re-read live roles like every other mutation on this page. Even the open
  // direction suppresses a size on the packing list, so a demoted or disabled
  // account must not keep doing it on a stale JWT.
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

export async function refundPaymentAction(shopSlug: string, personId: string, formData: FormData) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const orderId = String(formData.get("orderId") ?? "");
  const db = await getDb();
  // Money leaving the account is owner/manager work (H-14, ADR
  // 20260724-role-authorization), re-checked against live roles.
  if (!(await canPersonRefund(db, staff.user.shopId, staff.user.personId))) {
    revalidateAndRedirect(base, backTo(base, "not-authorized-refund", "payments"));
    return;
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
        : "refund-failed";
  revalidateAndRedirect(base, backTo(base, notice, "payments"));
}

export async function deletePersonAction(shopSlug: string, personId: string, _formData: FormData) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const db = await getDb();
  // Soft-deleting a person frees their email and pulls them from shop work —
  // owner/manager only (H-14, ADR 20260724-role-authorization).
  if (!(await canPersonDeleteDiver(db, staff.user.shopId, staff.user.personId))) {
    revalidateAndRedirect(base, backTo(base, "not-authorized-delete", "remove"));
    return;
  }
  const deleted = await deleteDiver(db, staff.user.shopId, personId);
  revalidateAndRedirect(
    `/shop/${staff.user.shopSlug}/divers`,
    deleted
      ? `/shop/${staff.user.shopSlug}/divers?notice=deleted&deleted=${encodeURIComponent(personId)}`
      : base,
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
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const db = await getDb();
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
 * it. Three things stand between a mis-click and an irreversible write: the gate
 * is owner-only and re-read from the database, `anonymizeDiver` re-checks it
 * again for itself, and the staffer must type the diver's name to confirm —
 * the confirmation is verified here against the stored record, not trusted from
 * a hidden field the form could have carried unchanged.
 */
export async function erasePersonAction(shopSlug: string, personId: string, formData: FormData) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonErasePersonalData(db, staff.user.shopId, staff.user.personId))) {
    revalidateAndRedirect(base, backTo(base, "not-authorized-erase", "erase"));
    return;
  }
  // `includeRemoved`: a diver already off the active roster is exactly who an
  // erasure request tends to name, and without this the name check reads null
  // and reports a mismatch against a record that is right there on screen.
  const profile = await getDiverProfile(db, staff.user.shopId, personId, { includeRemoved: true });
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
  revalidateAndRedirect(
    `/shop/${staff.user.shopSlug}/divers`,
    result.ok
      ? `/shop/${staff.user.shopSlug}/divers?notice=${erasedNotice}`
      : backTo(base, "erase-refused", "erase"),
  );
}
