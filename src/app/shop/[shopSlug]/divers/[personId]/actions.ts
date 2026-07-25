"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  canPersonDeleteDiver,
  canPersonOverrideGearRequest,
  canPersonRefund,
  loadActiveStaffRoles,
} from "@/db/authz";
import { createBooking } from "@/db/bookings";
import { getDb } from "@/db/client";
import { deleteDiver, getDiverProfile, updateDiver } from "@/db/divers";
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
import { getShopById } from "@/db/shops";
import { isPlausibleDateOfBirth } from "@/lib/age";
import { canOverrideGearRequest, isStaff } from "@/lib/authz";
import { isValidCalendarDate } from "@/lib/calendar-date";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { storeCardImage } from "@/lib/storage";

const agencySchema = z.enum(["padi", "ssi", "naui", "sdi", "tdi", "other"]);
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
  fullName: z.string().trim().min(2).max(120),
  email: z.union([z.literal(""), z.email().max(320)]),
  phone: z.string().trim().max(40),
  diveInsurance: z.string().trim().max(120),
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
  bootSize: z.string().trim().max(40),
  finSize: z.string().trim().max(40),
  weightPreference: z.string().trim().max(120),
});

type ResolvedCardImage =
  /** No file offered, or one stored successfully (url undefined when none given). */
  | { url: string | undefined }
  /** Storage isn't set up for this deployment — keep the card, just without a photo. */
  | { unconfigured: true }
  /** The file itself was rejected (wrong type, too large, or the provider failed). */
  | { failed: true };

async function resolveCardImage(formData: FormData): Promise<ResolvedCardImage> {
  const file = formData.get("cardImage");
  if (!(file instanceof File) || file.size === 0) return { url: undefined };
  const stored = await storeCardImage({
    keyPrefix: "cards",
    filename: file.name,
    contentType: file.type,
    bytes: await file.arrayBuffer(),
  });
  // `not_configured` is not a bad photo: no blob storage is wired up, so we save
  // the card without the image rather than rejecting a perfectly valid upload.
  if (stored.status === "not_configured") return { unconfigured: true };
  return stored.status === "stored" ? { url: stored.url } : { failed: true };
}

/** The column is date-only (CR-009); the validated "YYYY-MM-DD" input needs no conversion. */
function dateFromInput(value: string) {
  return value || undefined;
}

export async function savePersonAction(shopSlug: string, personId: string, formData: FormData) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const parsed = personSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base}?notice=invalid`);
  const saved = await updateDiver(await getDb(), {
    shopId: staff.user.shopId,
    personId,
    ...parsed.data,
  });
  revalidateAndRedirect(base, `${base}?notice=${saved ? "person-saved" : "duplicate"}`);
}

export async function addCertificationAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const parsed = certificationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base}?notice=invalid`);
  const image = await resolveCardImage(formData);
  if ("failed" in image) redirect(`${base}?notice=image`);
  const saved = await createCertification(await getDb(), {
    shopId: staff.user.shopId,
    personId,
    agency: parsed.data.agency,
    level: parsed.data.level,
    identifier: parsed.data.identifier,
    expiresAt: dateFromInput(parsed.data.expiresOn),
    cardImageUrl: "url" in image ? image.url : undefined,
  });
  const notice = saved ? ("unconfigured" in image ? "captured-no-photo" : "captured") : "invalid";
  revalidateAndRedirect(base, `${base}?notice=${notice}`);
}

export async function addSpecialtyAction(shopSlug: string, personId: string, formData: FormData) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const parsed = specialtyCertificationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base}?notice=invalid`);
  const image = await resolveCardImage(formData);
  if ("failed" in image) redirect(`${base}?notice=image`);
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
          cardImageUrl: "url" in image ? image.url : undefined,
        });
  const notice = saved ? ("unconfigured" in image ? "captured-no-photo" : "captured") : "invalid";
  revalidateAndRedirect(base, `${base}?notice=${notice}`);
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
  revalidateAndRedirect(base, `${base}?notice=${updated ? "verified" : "invalid"}`);
}

export async function reviewSpecialtyAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const certificationId = String(formData.get("certificationId") ?? "");
  const updated = certificationId
    ? formData.get("cardType") === "nitrox"
      ? await reviewNitroxCertification(await getDb(), {
          shopId: staff.user.shopId,
          certificationId,
          status: "verified",
        })
      : await reviewSpecialtyCertification(await getDb(), {
          shopId: staff.user.shopId,
          certificationId,
          status: "verified",
        })
    : null;
  revalidateAndRedirect(base, `${base}?notice=${updated ? "verified" : "invalid"}`);
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
      : `${base}?notice=invalid`,
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
      : `${base}?notice=invalid`,
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
  revalidateAndRedirect(
    base,
    `${base}?notice=${restored ? "card-restored" : "card-restore-conflict"}`,
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
    revalidateAndRedirect(base, `${base}?notice=not-authorized-fit`);
    return;
  }
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base}?notice=invalid`);
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
    bootSize: parsed.data.bootSize,
    finSize: parsed.data.finSize,
    weightPreference: parsed.data.weightPreference,
  });
  revalidateAndRedirect(base, `${base}?notice=${saved ? "profile-saved" : "invalid"}`);
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
    revalidateAndRedirect(base, `${base}?notice=not-authorized-fit`);
    return;
  }
  const parsed = needsStaffFitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base}?notice=invalid`);
  const needed = parsed.data.needed === "on";
  // Hiding the button is the page layer; this is the server layer ADR-0006
  // asks for. Without it a captain clears a flag by submitting the form with
  // no `needed` field, and the diver goes back on the list at a size the shop
  // already said it was short of — with the attribution wiped in the same
  // statement, so nothing records that it happened.
  if (!needed && !canOverrideGearRequest(roles)) {
    revalidateAndRedirect(base, `${base}?notice=not-authorized-fit`);
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
  revalidateAndRedirect(base, `${base}?notice=${notice}`);
}

export async function refundPaymentAction(shopSlug: string, personId: string, formData: FormData) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const orderId = String(formData.get("orderId") ?? "");
  const db = await getDb();
  // Money leaving the account is owner/manager work (H-14, ADR
  // 20260724-role-authorization), re-checked against live roles.
  if (!(await canPersonRefund(db, staff.user.shopId, staff.user.personId))) {
    revalidateAndRedirect(base, `${base}?notice=not-authorized-refund`);
    return;
  }
  // A demo shop's orders carry fabricated Stripe ids; refunding one would hit
  // live Stripe and fail. The button is rendered disabled to match (PaymentsSection).
  const shop = await getShopById(db, staff.user.shopId);
  if (shop?.isDemo) {
    revalidateAndRedirect(base, `${base}?notice=demo-disabled`);
    return;
  }
  const refunded = orderId ? await refundOrder(db, staff.user.shopId, orderId) : null;
  revalidateAndRedirect(base, `${base}?notice=${refunded ? "refunded" : "refund-failed"}`);
}

export async function bookActivityAction(shopSlug: string, personId: string, formData: FormData) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const tripId = String(formData.get("tripId") ?? "");
  const current = await getDiverProfile(await getDb(), staff.user.shopId, personId);
  if (!tripId || !current?.person.email) redirect(`${base}?notice=booking-invalid`);
  const result = await createBooking(await getDb(), {
    actor: "staff",
    shopId: staff.user.shopId,
    tripId,
    fullName: current.person.fullName,
    email: current.person.email,
    phone: current.person.phone ?? undefined,
  });
  revalidateAndRedirect(base, `${base}?notice=${result.ok ? "booked" : result.reason}`);
}

export async function deletePersonAction(shopSlug: string, personId: string, _formData: FormData) {
  const base = `/shop/${shopSlug}/divers/${personId}`;
  const staff = await requireStaffSession();
  const db = await getDb();
  // Soft-deleting a person frees their email and pulls them from shop work —
  // owner/manager only (H-14, ADR 20260724-role-authorization).
  if (!(await canPersonDeleteDiver(db, staff.user.shopId, staff.user.personId))) {
    revalidateAndRedirect(base, `${base}?notice=not-authorized-delete`);
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
